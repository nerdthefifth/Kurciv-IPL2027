import type { WorldState } from '@kurciv/domain';
import type { MatchState } from '@kurciv/simulation';

/**
 * Storage contract for careers. The game engine never touches storage directly: the browser
 * build implements this with IndexedDB, tests with memory, and a future optional cloud service
 * could implement it remotely. Every method that writes is atomic.
 */

export const SAVE_SCHEMA_VERSION = 3;
export const GAME_VERSION = '0.3.0';

export interface CareerMeta {
  id: string;
  name: string;
  managerName: string;
  clubId: string;
  clubName: string;
  clubShort: string;
  colors: [string, string];
  leagueId: string;
  leagueName: string;
  season: number;
  day: number;
  phase: string;
  position: number | null;
  nextFixture: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  gameVersion: string;
  /** Optimistic-concurrency counter, incremented by every commit. */
  version: number;
}

export interface LiveMatch {
  state: MatchState;
  /** Controller switches (e.g. "simulate to the end") so the match can be replayed exactly. */
  ctlTimeline: { fromSeq: number; ctl: { home: 'manual' | 'ai'; away: 'manual' | 'ai' } }[];
  experimental: boolean;
}

export interface LiveRow {
  careerId: string;
  slot: 'main' | 'lab';
  fixtureId: string;
  version: number;
  data: LiveMatch;
}

export interface MatchRow {
  careerId: string;
  fixtureId: string;
  season: number;
  clubIds: string[];
  state: MatchState;
}

export interface BackupRow {
  careerId: string;
  id: string;
  label: string;
  createdAt: string;
  season: number;
  world: WorldState;
}

export class ConflictError extends Error {}

export interface PersistenceAdapter {
  listCareers(): Promise<CareerMeta[]>;
  getMeta(id: string): Promise<CareerMeta | null>;
  loadWorld(id: string): Promise<WorldState | null>;
  /**
   * Atomically writes career meta + world + new match records. Rejects with ConflictError if
   * the stored version is not `expectVersion` (null = must not exist yet).
   */
  commit(meta: CareerMeta, world: WorldState, records: MatchRow[], expectVersion: number | null): Promise<void>;
  updateMeta(id: string, patch: Partial<CareerMeta>): Promise<void>;
  deleteCareer(id: string): Promise<void>;
  getRecord(careerId: string, fixtureId: string): Promise<MatchState | null>;
  seasonRecords(careerId: string, season: number, clubIds?: string[]): Promise<MatchState[]>;
  allRecords(careerId: string): Promise<MatchRow[]>;
  getLive(careerId: string, slot: LiveRow['slot']): Promise<LiveRow | null>;
  putLive(row: LiveRow, expectVersion: number | null): Promise<void>;
  deleteLive(careerId: string, slot: LiveRow['slot']): Promise<void>;
  addBackup(row: BackupRow, keep: number): Promise<void>;
  listBackups(careerId: string): Promise<Omit<BackupRow, 'world'>[]>;
  getBackup(careerId: string, id: string): Promise<BackupRow | null>;
}

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory adapter (tests, and a fallback when IndexedDB is unavailable). */
export class MemoryAdapter implements PersistenceAdapter {
  careers = new Map<string, { meta: CareerMeta; world: WorldState }>();
  records = new Map<string, MatchRow>();
  live = new Map<string, LiveRow>();
  backups = new Map<string, BackupRow>();
  /** Test hook: make the next write fail (e.g. simulate a quota error). */
  failNextWrite: Error | null = null;

  private maybeFail() {
    if (this.failNextWrite) {
      const e = this.failNextWrite;
      this.failNextWrite = null;
      throw e;
    }
  }

  async listCareers() {
    return [...this.careers.values()].map((c) => clone(c.meta)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getMeta(id: string) {
    const c = this.careers.get(id);
    return c ? clone(c.meta) : null;
  }
  async loadWorld(id: string) {
    const c = this.careers.get(id);
    return c ? clone(c.world) : null;
  }
  async commit(meta: CareerMeta, world: WorldState, records: MatchRow[], expectVersion: number | null) {
    this.maybeFail();
    const cur = this.careers.get(meta.id);
    if (expectVersion === null ? !!cur : cur?.meta.version !== expectVersion) throw new ConflictError('This career was changed elsewhere.');
    this.careers.set(meta.id, { meta: clone(meta), world: clone(world) });
    for (const r of records) this.records.set(`${r.careerId}|${r.fixtureId}`, clone(r));
  }
  async updateMeta(id: string, patch: Partial<CareerMeta>) {
    this.maybeFail();
    const c = this.careers.get(id);
    if (c) c.meta = { ...c.meta, ...clone(patch) };
  }
  async deleteCareer(id: string) {
    this.careers.delete(id);
    for (const k of [...this.records.keys()]) if (k.startsWith(`${id}|`)) this.records.delete(k);
    for (const k of [...this.live.keys()]) if (k.startsWith(`${id}|`)) this.live.delete(k);
    for (const k of [...this.backups.keys()]) if (k.startsWith(`${id}|`)) this.backups.delete(k);
  }
  async getRecord(careerId: string, fixtureId: string) {
    const r = this.records.get(`${careerId}|${fixtureId}`);
    return r ? clone(r.state) : null;
  }
  async seasonRecords(careerId: string, season: number, clubIds?: string[]) {
    return [...this.records.values()]
      .filter((r) => r.careerId === careerId && r.season === season && (!clubIds || r.clubIds.some((c) => clubIds.includes(c))))
      .map((r) => clone(r.state));
  }
  async allRecords(careerId: string) {
    return [...this.records.values()].filter((r) => r.careerId === careerId).map(clone);
  }
  async getLive(careerId: string, slot: LiveRow['slot']) {
    const r = this.live.get(`${careerId}|${slot}`);
    return r ? clone(r) : null;
  }
  async putLive(row: LiveRow, expectVersion: number | null) {
    this.maybeFail();
    const cur = this.live.get(`${row.careerId}|${row.slot}`);
    if (expectVersion !== null && cur?.version !== expectVersion) throw new ConflictError('The match moved on in another tab.');
    this.live.set(`${row.careerId}|${row.slot}`, clone(row));
  }
  async deleteLive(careerId: string, slot: LiveRow['slot']) {
    this.live.delete(`${careerId}|${slot}`);
  }
  async addBackup(row: BackupRow, keep: number) {
    this.backups.set(`${row.careerId}|${row.id}`, clone(row));
    const mine = [...this.backups.values()].filter((b) => b.careerId === row.careerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const old of mine.slice(keep)) this.backups.delete(`${old.careerId}|${old.id}`);
  }
  async listBackups(careerId: string) {
    return [...this.backups.values()].filter((b) => b.careerId === careerId).map(({ world: _w, ...rest }) => clone(rest)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getBackup(careerId: string, id: string) {
    const b = this.backups.get(`${careerId}|${id}`);
    return b ? clone(b) : null;
  }
}
