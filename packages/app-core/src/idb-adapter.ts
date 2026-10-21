import Dexie, { type Table } from 'dexie';
import type { WorldState } from '@kurciv/domain';
import type { MatchState } from '@kurciv/simulation';
import { ConflictError, type BackupRow, type CareerMeta, type LiveRow, type MatchRow, type PersistenceAdapter } from './persistence';

/**
 * IndexedDB persistence (via Dexie). Careers live entirely on this device and browser
 * profile. Each commit writes meta + world + match records in one transaction, guarded by
 * the meta version, so a crash mid-write can never leave a half-saved career.
 */
class KurcivDB extends Dexie {
  careers!: Table<CareerMeta, string>;
  worlds!: Table<{ careerId: string; world: WorldState }, string>;
  matches!: Table<MatchRow, [string, string]>;
  live!: Table<LiveRow, [string, string]>;
  backups!: Table<BackupRow, [string, string]>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      careers: 'id, updatedAt',
      worlds: 'careerId',
      matches: '[careerId+fixtureId], careerId, [careerId+season]',
      live: '[careerId+slot]',
      backups: '[careerId+id], careerId',
    });
  }
}

export class IndexedDBAdapter implements PersistenceAdapter {
  private db: KurcivDB;

  constructor(name = 'kurciv-ipl-2027') {
    this.db = new KurcivDB(name);
  }

  /** Throws a descriptive error if IndexedDB is unavailable (e.g. some private modes). */
  async open(): Promise<void> {
    await this.db.open();
  }

  async listCareers() {
    return (await this.db.careers.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getMeta(id: string) {
    return (await this.db.careers.get(id)) ?? null;
  }

  async loadWorld(id: string) {
    return (await this.db.worlds.get(id))?.world ?? null;
  }

  async commit(meta: CareerMeta, world: WorldState, records: MatchRow[], expectVersion: number | null) {
    await this.db.transaction('rw', this.db.careers, this.db.worlds, this.db.matches, async () => {
      const cur = await this.db.careers.get(meta.id);
      if (expectVersion === null ? !!cur : cur?.version !== expectVersion) throw new ConflictError('This career was changed elsewhere.');
      await this.db.careers.put(meta);
      await this.db.worlds.put({ careerId: meta.id, world });
      if (records.length) await this.db.matches.bulkPut(records);
    });
  }

  async updateMeta(id: string, patch: Partial<CareerMeta>) {
    await this.db.careers.update(id, patch);
  }

  async deleteCareer(id: string) {
    await this.db.transaction('rw', [this.db.careers, this.db.worlds, this.db.matches, this.db.live, this.db.backups], async () => {
      await this.db.careers.delete(id);
      await this.db.worlds.delete(id);
      await this.db.matches.where('careerId').equals(id).delete();
      await this.db.live.where('[careerId+slot]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
      await this.db.backups.where('careerId').equals(id).delete();
    });
  }

  async getRecord(careerId: string, fixtureId: string): Promise<MatchState | null> {
    return (await this.db.matches.get([careerId, fixtureId]))?.state ?? null;
  }

  async seasonRecords(careerId: string, season: number, clubIds?: string[]) {
    const rows = await this.db.matches.where('[careerId+season]').equals([careerId, season]).toArray();
    return rows.filter((r) => !clubIds || r.clubIds.some((c) => clubIds.includes(c))).map((r) => r.state);
  }

  async allRecords(careerId: string) {
    return this.db.matches.where('careerId').equals(careerId).toArray();
  }

  async getLive(careerId: string, slot: LiveRow['slot']) {
    return (await this.db.live.get([careerId, slot])) ?? null;
  }

  async putLive(row: LiveRow, expectVersion: number | null) {
    await this.db.transaction('rw', this.db.live, async () => {
      const cur = await this.db.live.get([row.careerId, row.slot]);
      if (expectVersion !== null && cur?.version !== expectVersion) throw new ConflictError('The match moved on in another tab.');
      await this.db.live.put(row);
    });
  }

  async deleteLive(careerId: string, slot: LiveRow['slot']) {
    await this.db.live.delete([careerId, slot]);
  }

  async addBackup(row: BackupRow, keep: number) {
    await this.db.transaction('rw', this.db.backups, async () => {
      await this.db.backups.put(row);
      const mine = (await this.db.backups.where('careerId').equals(row.careerId).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const old of mine.slice(keep)) await this.db.backups.delete([old.careerId, old.id]);
    });
  }

  async listBackups(careerId: string) {
    const rows = await this.db.backups.where('careerId').equals(careerId).toArray();
    return rows.map(({ world: _w, ...rest }) => rest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBackup(careerId: string, id: string) {
    return (await this.db.backups.get([careerId, id])) ?? null;
  }

  /** Storage usage estimate for the save manager (where supported). */
  static async estimate(): Promise<{ usage: number; quota: number } | null> {
    const nav = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } } }).navigator;
    if (!nav?.storage?.estimate) return null;
    const e = await nav.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  }
}
