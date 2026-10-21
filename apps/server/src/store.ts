import crypto from 'node:crypto';
import type { WorldState } from '@kurciv/domain';
import type { MatchState } from '@kurciv/simulation';
import { createWorld, type CreateCareerInput, type MatchRecord } from '@kurciv/world';
import { audit, pack, tx, unpack, type DB } from './db';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

interface Cached {
  world: WorldState;
  version: number;
  userId: string;
}

export interface CareerRow {
  id: string;
  name: string;
  club_id: string;
  season: number;
  phase: string;
  updated_at: string;
}

/**
 * Authoritative career state. All mutations for one career run strictly one at a time
 * (an async lock), are applied to the cached world, and are committed together with any
 * match records in a single SQLite transaction guarded by an optimistic version check.
 * If anything throws, the cached copy is discarded so a half-applied change can never be
 * persisted or observed.
 */
export class CareerStore {
  private cache = new Map<string, Cached>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(private db: DB) {}

  list(userId: string): CareerRow[] {
    return this.db.prepare('SELECT id, name, club_id, season, phase, updated_at FROM careers WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as unknown as CareerRow[];
  }

  create(userId: string, input: Omit<CreateCareerInput, 'careerId' | 'seed'> & { seed?: string }): WorldState {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM careers WHERE user_id = ?').get(userId) as { n: number }).n;
    if (count >= 10) throw new HttpError(400, 'You can keep at most 10 save slots. Delete one first.');
    const id = crypto.randomUUID();
    const seed = input.seed?.trim() || crypto.randomBytes(8).toString('hex');
    let world: WorldState;
    try {
      world = createWorld({ ...input, careerId: id, seed });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO careers (id, user_id, name, club_id, season, phase, version, world, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(
      id, userId, `${world.managerName} — ${world.clubs[world.userClubId].name}`, world.userClubId, world.season, world.phase, pack(world), now, now,
    );
    audit(this.db, id, userId, 'career.create', { club: world.userClubId, seed });
    this.cache.set(id, { world, version: 1, userId });
    return world;
  }

  delete(careerId: string, userId: string) {
    this.load(careerId, userId);
    this.db.prepare('DELETE FROM careers WHERE id = ? AND user_id = ?').run(careerId, userId);
    this.cache.delete(careerId);
  }

  load(careerId: string, userId: string): Cached {
    let c = this.cache.get(careerId);
    if (!c) {
      const row = this.db.prepare('SELECT user_id, version, world FROM careers WHERE id = ?').get(careerId) as { user_id: string; version: number; world: Uint8Array } | undefined;
      if (!row) throw new HttpError(404, 'Career not found.');
      c = { world: unpack<WorldState>(row.world), version: row.version, userId: row.user_id };
      this.cache.set(careerId, c);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    }
    // Authorisation: a career is only ever visible to its owner, whatever id is requested.
    if (c.userId !== userId) throw new HttpError(404, 'Career not found.');
    return c;
  }

  async mutate<T>(careerId: string, userId: string, action: string, fn: (w: WorldState) => { result: T; records?: MatchRecord[] }): Promise<{ result: T; version: number }> {
    const prev = this.locks.get(careerId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.locks.set(careerId, prev.then(() => mine));
    await prev;
    try {
      const c = this.load(careerId, userId);
      let out: { result: T; records?: MatchRecord[] };
      try {
        out = fn(c.world);
      } catch (e) {
        this.cache.delete(careerId);
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, (e as Error).message);
      }
      const next = c.version + 1;
      try {
        tx(this.db, () => {
          const r = this.db.prepare('UPDATE careers SET world = ?, version = ?, season = ?, phase = ?, club_id = ?, updated_at = ? WHERE id = ? AND version = ?').run(
            pack(c.world), next, c.world.season, c.world.phase, c.world.userClubId, new Date().toISOString(), careerId, c.version,
          );
          if (r.changes !== 1) throw new HttpError(409, 'This career was changed elsewhere. Reload and try again.', 'VERSION');
          if (out.records?.length) this.saveRecords(careerId, c.world, out.records);
          audit(this.db, careerId, userId, action);
        });
      } catch (e) {
        this.cache.delete(careerId);
        throw e;
      }
      c.version = next;
      return { result: out.result, version: next };
    } finally {
      release();
    }
  }

  private saveRecords(careerId: string, w: WorldState, records: MatchRecord[]) {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO match_records (career_id, fixture_id, season, involves_user, engine_version, seed, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const r of records) {
      const fx = w.fixtures[r.fixtureId];
      stmt.run(careerId, r.fixtureId, fx?.season ?? w.season, fx?.involvesUser ? 1 : 0, r.state.engineVersion, r.state.seed, pack(compactRecord(r.state)), now);
    }
  }

  getRecord(careerId: string, userId: string, fixtureId: string): MatchState | null {
    this.load(careerId, userId);
    const row = this.db.prepare('SELECT data FROM match_records WHERE career_id = ? AND fixture_id = ?').get(careerId, fixtureId) as { data: Uint8Array } | undefined;
    return row ? unpack<MatchState>(row.data) : null;
  }

  seasonRecords(careerId: string, userId: string, season: number, clubIds?: string[]): MatchState[] {
    this.load(careerId, userId);
    const rows = this.db.prepare('SELECT data FROM match_records WHERE career_id = ? AND season = ?').all(careerId, season) as { data: Uint8Array }[];
    const out = rows.map((r) => unpack<MatchState>(r.data));
    return clubIds ? out.filter((s) => clubIds.includes(s.setup.home.clubId) || clubIds.includes(s.setup.away.clubId)) : out;
  }

  // ---------------- live (and scenario-lab) matches
  getLive(careerId: string, userId: string, slot: string): { fixtureId: string; version: number; data: LiveMatch } | null {
    this.load(careerId, userId);
    const row = this.db.prepare('SELECT fixture_id, version, data FROM live_matches WHERE career_id = ? AND slot = ?').get(careerId, slot) as { fixture_id: string; version: number; data: Uint8Array } | undefined;
    return row ? { fixtureId: row.fixture_id, version: row.version, data: unpack<LiveMatch>(row.data) } : null;
  }

  putLive(careerId: string, slot: string, fixtureId: string, version: number, data: LiveMatch, expectVersion: number | null) {
    const now = new Date().toISOString();
    if (expectVersion === null) {
      this.db.prepare('INSERT OR REPLACE INTO live_matches (career_id, slot, fixture_id, version, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(careerId, slot, fixtureId, version, pack(data), now);
      return;
    }
    const r = this.db.prepare('UPDATE live_matches SET version = ?, data = ?, updated_at = ? WHERE career_id = ? AND slot = ? AND version = ?').run(version, pack(data), now, careerId, slot, expectVersion);
    if (r.changes !== 1) throw new HttpError(409, 'The match moved on in another tab. Reloaded the latest state.', 'VERSION');
  }

  deleteLive(careerId: string, slot: string) {
    this.db.prepare('DELETE FROM live_matches WHERE career_id = ? AND slot = ?').run(careerId, slot);
  }

  // ---------------- idempotency
  idempotent(userId: string, key: string | undefined): { status: number; body: unknown } | null {
    if (!key) return null;
    const row = this.db.prepare('SELECT status, body FROM idempotency WHERE user_id = ? AND key = ?').get(userId, key) as { status: number; body: string } | undefined;
    return row ? { status: row.status, body: JSON.parse(row.body) } : null;
  }

  remember(userId: string, key: string | undefined, status: number, body: unknown) {
    if (!key) return;
    this.db.prepare('INSERT OR IGNORE INTO idempotency (user_id, key, status, body, at) VALUES (?, ?, ?, ?, ?)').run(userId, key, status, JSON.stringify(body), new Date().toISOString());
  }
}

export interface LiveMatch {
  state: MatchState;
  /** Controller switches (e.g. "simulate to the end") so the match can be replayed exactly. */
  ctlTimeline: { fromSeq: number; ctl: { home: 'manual' | 'ai'; away: 'manual' | 'ai' } }[];
  experimental: boolean;
}

/** AI-vs-AI records keep every delivery; only bulky per-ball fields are trimmed. */
function compactRecord(s: MatchState): MatchState {
  return { ...s, deliveries: s.deliveries.map((d) => ({ ...d, pressure: { batter: d.pressure.batter, bowler: d.pressure.bowler, reasons: [] } })) };
}
