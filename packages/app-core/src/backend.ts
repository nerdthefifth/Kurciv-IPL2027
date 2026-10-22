import { z } from 'zod';
import type { Fixture, WorldState } from '@kurciv/domain';
import { canBowl, validateXI } from '@kurciv/domain';
import { CLUB_SEEDS, COUNTRY_NAMES, FEATURE_FLAGS, IMAGE_LOOKUP, LEAGUES, VENUES, leagueById } from '@kurciv/config';
import { PLAYER_DB_META, playerDatabase } from '@kurciv/data-ingestion';
import { defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { BUILT_IN_FIELDS, applyAction, createMatch, type MatchAction, type MatchState } from '@kurciv/simulation';
import {
  advance, advanceCascade, applyStoryAction, auctionAct, autoFillUserSquad, buildMatchSetup, clubsInLeague, commitRetentions, completeUserFixture,
  createWorld, endSeason, fastForward, facilityUpgradeCost, freeAgentsFor, liveCommand, liveTick, matchSeed, nextUserFixture, planFormat, promoteYouth,
  qualificationPath, releasePlayer, releaseYouth, selectXI, setUserRetentions, signFreeAgent, squadOf, squadProblems, startSeason, upgradeFacility,
  capHolders, capRaces, setCaptaincy, suggestLeaders,
  clubWorldSync, negotiateObjective, replyToConversation, respondToMessage, cw,
  type LiveCommand, type MatchRecord,
} from '@kurciv/world';
import { boardView, conversationsView, feedView, inboxView, newsView } from './clubworld-views';
import { auctionRoomView, auctionSummary, userAuctionOf } from './auction-view';
import { clubhouse, qualificationOdds } from './clubhouse';
import { buildMatchReport } from './report/match-report';
import { archiveEntry } from './report/archive';
import { opponentReport } from './intel';
import { rebuildTo, runSteps, type StepMode } from './match';
import { ConflictError, GAME_VERSION, SAVE_SCHEMA_VERSION, type CareerMeta, type LiveMatch, type MatchRow, type PersistenceAdapter } from './persistence';
import { buildPackage, fingerprint, migrateWorld, validatePackage } from './portability';
import { clubView, financeView, fixtureView, liveView, playerView, retentionView, standingsView } from './views';

export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type SaveStatus = { state: 'saving' | 'saved' | 'error'; careerId: string; message?: string; at: string };

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return r.data;
}

const id = z.string().min(1).max(120);
const plan = z.object({
  lengths: z.record(z.enum(['yorker', 'full', 'good', 'back', 'short']), z.number().min(0).max(10)),
  lines: z.record(z.enum(['wide', 'off', 'stumps', 'leg']), z.number().min(0).max(10)),
  variation: z.number().min(0).max(1),
  pace: z.enum(['normal', 'slower', 'quicker']),
});

type Ctx = { params: Record<string, string>; query: URLSearchParams; body: any };
type Route = { method: string; pattern: RegExp; keys: string[]; handler: (ctx: Ctx) => Promise<unknown> | unknown };

function friendlyStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'QuotaExceededError' || /quota/i.test(String((e as Error)?.message))) {
    return 'Your browser’s storage for this site is full. Export or delete an old career, then try again — nothing was lost.';
  }
  if (e instanceof ConflictError) return 'This career was changed in another tab. Reloaded the latest save.';
  return `Could not save to browser storage (${(e as Error)?.message ?? 'unknown error'}). Your last saved state is intact.`;
}

/**
 * The game's command and query layer. In the browser it runs inside a Web Worker on top of
 * IndexedDB; tests run it on the in-memory adapter. Every mutation for a career is serialised,
 * applied to the in-memory world, and committed atomically before success is reported.
 */
export class Backend {
  private routes: Route[] = [];
  private cache = new Map<string, { world: WorldState; meta: CareerMeta }>();
  private locks = new Map<string, Promise<unknown>>();
  private dirty = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private store: PersistenceAdapter, private onSave: (s: SaveStatus) => void = () => {}) {
    this.registerRoutes();
  }

  // ---------------------------------------------------------------- routing

  private route(method: string, path: string, handler: Route['handler']) {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_m, k) => {
      keys.push(k);
      return '([^/]+)';
    })}$`);
    this.routes.push({ method, pattern, keys, handler });
  }

  async handle(method: string, url: string, body?: unknown): Promise<unknown> {
    const [path, qs] = url.split('?');
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler({ params, query: new URLSearchParams(qs ?? ''), body: body ?? {} });
    }
    throw new AppError(404, `Unknown request ${method} ${path}`);
  }

  // ---------------------------------------------------------------- career state

  private async withLock<T>(cid: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(cid) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.locks.set(cid, prev.then(() => mine));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async load(cid: string): Promise<{ world: WorldState; meta: CareerMeta }> {
    const c = this.cache.get(cid);
    if (c) return c;
    const meta = await this.store.getMeta(cid);
    const world = meta && (await this.store.loadWorld(cid));
    if (!meta || !world) throw new AppError(404, 'Career not found on this device.');
    if ((meta.schemaVersion ?? 1) < SAVE_SCHEMA_VERSION || (world.schemaVersion ?? 1) < SAVE_SCHEMA_VERSION) migrateWorld(world, world.schemaVersion ?? 1);
    const entry = { world, meta };
    this.cache.clear(); // one career active at a time keeps memory small
    this.cache.set(cid, entry);
    return entry;
  }

  private deriveMeta(w: WorldState, prev: Partial<CareerMeta> | null): CareerMeta {
    const club = w.clubs[w.userClubId];
    const l = leagueById(club.leagueId);
    const comp = w.competitions[`${l.id}-${w.season}`];
    const rows = comp ? standingsView(w, comp.id) : [];
    const pos = rows.find((r) => r.isUser)?.pos ?? null;
    const next = nextUserFixture(w);
    const now = new Date().toISOString();
    return {
      id: w.careerId,
      name: prev?.name ?? `${w.managerName} — ${club.name}`,
      managerName: w.managerName, clubId: club.id, clubName: club.name, clubShort: club.shortName, colors: club.colors,
      leagueId: l.id, leagueName: l.name, season: w.season, day: w.day, phase: w.phase, position: pos,
      nextFixture: next ? `${w.clubs[next.homeId]?.shortName ?? 'TBD'} v ${w.clubs[next.awayId]?.shortName ?? 'TBD'}` : null,
      createdAt: prev?.createdAt ?? now, updatedAt: now, schemaVersion: SAVE_SCHEMA_VERSION, gameVersion: GAME_VERSION,
      version: (prev?.version ?? 0) + 1,
    };
  }

  private toRows(w: WorldState, records: MatchRecord[]): MatchRow[] {
    return records.map((r) => ({
      careerId: w.careerId, fixtureId: r.fixtureId, season: w.fixtures[r.fixtureId]?.season ?? w.season,
      clubIds: [r.state.setup.home.clubId, r.state.setup.away.clubId], state: compact(r.state),
    }));
  }

  private async commit(cid: string, entry: { world: WorldState; meta: CareerMeta }, records: MatchRecord[]) {
    const meta = this.deriveMeta(entry.world, entry.meta);
    this.onSave({ state: 'saving', careerId: cid, at: meta.updatedAt });
    try {
      await this.store.commit(meta, entry.world, this.toRows(entry.world, records), entry.meta.version);
    } catch (e) {
      this.cache.delete(cid);
      const message = friendlyStorageError(e);
      this.onSave({ state: 'error', careerId: cid, message, at: new Date().toISOString() });
      throw new AppError(e instanceof ConflictError ? 409 : 507, message, e instanceof ConflictError ? 'VERSION' : 'STORAGE');
    }
    entry.meta = meta;
    this.onSave({ state: 'saved', careerId: cid, at: meta.updatedAt });
  }

  /** Apply a change and persist it before reporting success. */
  private async mutate<T>(cid: string, fn: (w: WorldState) => { result: T; records?: MatchRecord[] } | T, opts: { backup?: string } = {}): Promise<T & { version: number }> {
    return this.withLock(cid, async () => {
      await this.flushNow(cid);
      const entry = await this.load(cid);
      let out: { result: T; records?: MatchRecord[] };
      try {
        const r = fn(entry.world);
        out = r && typeof r === 'object' && 'result' in (r as object) ? (r as { result: T; records?: MatchRecord[] }) : { result: r as T };
        // Turn whatever just happened in the simulation into Club World events (idempotent).
        try {
          clubWorldSync(entry.world);
        } catch (e) {
          console.error('Club World sync failed', e); // never block the user's action on a reaction
        }
      } catch (e) {
        this.cache.delete(cid); // never keep a half-applied change
        if (e instanceof AppError) throw e;
        throw new AppError(400, (e as Error).message);
      }
      await this.commit(cid, entry, out.records ?? []);
      if (opts.backup) await this.backup(cid, entry.world, opts.backup);
      return { ...(out.result as object), version: entry.meta.version } as T & { version: number };
    });
  }

  /** For high-frequency auction ticks: persist soon, not on every call. */
  private scheduleFlush(cid: string) {
    if (this.dirty.has(cid)) return;
    this.dirty.set(cid, setTimeout(() => {
      this.withLock(cid, () => this.flushNow(cid)).catch(() => {});
    }, 1200));
  }

  private async flushNow(cid: string) {
    const t = this.dirty.get(cid);
    if (!t) return;
    clearTimeout(t);
    this.dirty.delete(cid);
    const entry = this.cache.get(cid);
    if (entry) await this.commit(cid, entry, []);
  }

  private async backup(cid: string, w: WorldState, label: string) {
    try {
      await this.store.addBackup({ careerId: cid, id: `b${Date.now().toString(36)}`, label, createdAt: new Date().toISOString(), season: w.season, world: structuredClone(w) }, 3);
    } catch {
      // backups are best-effort; the main save already succeeded
    }
  }

  private async view<T>(cid: string, fn: (w: WorldState) => T): Promise<T> {
    const { world } = await this.load(cid);
    return fn(world);
  }

  // ---------------------------------------------------------------- routes

  private registerRoutes() {
    const r = this.route.bind(this);

    r('GET', '/meta', () => ({
      leagues: LEAGUES.map((l) => ({
        id: l.id, name: l.name, shortName: l.shortName, country: l.country, countryName: COUNTRY_NAMES[l.country], reputation: l.initialReputation, fictional: l.fictional,
        playoffs: l.playoffs, rounds: l.rounds, squadRules: l.squadRules, purse: l.auctionRules.purse, minBase: l.auctionRules.minBase, domesticCountries: l.domesticCountries,
        clubs: (CLUB_SEEDS[l.id] ?? []).map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, city: c.city, colors: c.colors, personality: c.personality, brand: c.brand, venueId: c.venueId, venue: VENUES.find((v) => v.id === c.venueId)?.name })),
      })),
      venues: VENUES.map((v) => ({ id: v.id, name: v.name, city: v.city, country: v.country })),
      fields: BUILT_IN_FIELDS, flags: FEATURE_FLAGS, imageLookup: IMAGE_LOOKUP, gameVersion: GAME_VERSION, schemaVersion: SAVE_SCHEMA_VERSION,
    }));

    // -------- save slots
    r('GET', '/careers', async () => ({ careers: await this.store.listCareers() }));

    const createSchema = z.object({
      managerName: z.string().trim().min(2).max(40),
      difficulty: z.enum(['rookie', 'professional', 'elite', 'legend']),
      philosophy: z.enum(['balanced', 'aggressive', 'anchored', 'spin', 'pace']).default('balanced'),
      seed: z.string().max(64).optional(),
      clubId: z.string().max(8).optional(),
      customClub: z.object({
        name: z.string().max(40), shortName: z.string().max(4), city: z.string().max(40), leagueId: z.string().max(8),
        colors: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]), venueId: z.string().max(40).optional(),
      }).optional(),
    }).refine((v) => !!v.clubId !== !!v.customClub, 'Choose exactly one: an existing club or a custom club.');

    r('POST', '/careers', async ({ body }) => {
      const input = parse(createSchema, body);
      const careerId = crypto.randomUUID();
      const seed = input.seed?.trim() || careerId.slice(0, 8);
      let world: WorldState;
      try {
        world = createWorld({ ...input, careerId, seed });
      } catch (e) {
        throw new AppError(400, (e as Error).message);
      }
      applyPhilosophy(world, input.philosophy);
      clubWorldSync(world);
      const meta = this.deriveMeta(world, null);
      this.onSave({ state: 'saving', careerId, at: meta.createdAt });
      try {
        await this.store.commit(meta, world, [], null);
      } catch (e) {
        const message = friendlyStorageError(e);
        this.onSave({ state: 'error', careerId, message, at: new Date().toISOString() });
        throw new AppError(507, message, 'STORAGE');
      }
      this.onSave({ state: 'saved', careerId, at: meta.updatedAt });
      this.cache.clear();
      this.cache.set(careerId, { world, meta });
      return { id: careerId };
    });

    r('PATCH', '/careers/:cid', async ({ params, body }) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), body);
      if (!(await this.store.getMeta(params.cid))) throw new AppError(404, 'Career not found.');
      await this.store.updateMeta(params.cid, { name });
      const c = this.cache.get(params.cid);
      if (c) c.meta.name = name;
      return { ok: true };
    });

    r('DELETE', '/careers/:cid', async ({ params }) => {
      await this.store.deleteCareer(params.cid);
      this.cache.delete(params.cid);
      return { ok: true };
    });

    r('GET', '/careers/:cid/export', async ({ params }) => {
      await this.withLock(params.cid, () => this.flushNow(params.cid));
      const { world, meta } = await this.load(params.cid);
      const records = await this.store.allRecords(params.cid);
      return buildPackage(meta, world, records);
    });

    r('POST', '/careers/:cid/duplicate', async ({ params }) => {
      await this.withLock(params.cid, () => this.flushNow(params.cid));
      const { world, meta } = await this.load(params.cid);
      const pkg = buildPackage(meta, structuredClone(world), await this.store.allRecords(params.cid));
      return this.importPackage(pkg, `${meta.name} (copy)`);
    });

    r('POST', '/import/check', ({ body }) => {
      const check = validatePackage(body?.package);
      return { ok: check.ok, errors: check.errors, warnings: check.warnings, summary: check.summary };
    });

    r('POST', '/import', async ({ body }) => {
      const check = validatePackage(body?.package);
      if (!check.ok || !check.pkg) throw new AppError(400, check.errors.join(' '));
      return this.importPackage(check.pkg, `${check.pkg.meta.name} (imported)`);
    });

    r('GET', '/careers/:cid/backups', async ({ params }) => ({ backups: await this.store.listBackups(params.cid) }));
    r('POST', '/careers/:cid/backups/:bid/restore', async ({ params }) => {
      const b = await this.store.getBackup(params.cid, params.bid);
      if (!b) throw new AppError(404, 'Backup not found.');
      const meta = (await this.store.getMeta(params.cid))!;
      const records = (await this.store.allRecords(params.cid)).filter((x) => x.season <= b.season);
      return this.importPackage(buildPackage(meta, b.world, records), `${meta.name} (restored ${b.label})`);
    });

    // -------- the clubhouse and core views
    r('GET', '/careers/:cid', ({ params }) => this.view(params.cid, (w) => ({ ...clubhouse(w), version: this.cache.get(params.cid)!.meta.version })));

    r('GET', '/careers/:cid/squad', ({ params }) => this.view(params.cid, (w) => {
      const club = w.clubs[w.userClubId];
      const l = leagueById(club.leagueId);
      const squad = squadOf(w, club);
      return {
        club: clubView(w, club),
        players: squad.map((p) => playerView(w, p)),
        academy: club.academy.map((pid) => playerView(w, w.players[pid])),
        lineup: club.lineup,
        suggestedXI: squad.length >= 11 ? pickXI(squad, l.squadRules, l.domesticCountries).map((p) => p.id) : [],
        problems: squadProblems(w, club),
        lineupCheck: club.lineup ? validateXI(club.lineup.map((pid) => w.players[pid]), club.squad, l.squadRules, l.domesticCountries) : null,
        captaincy: club.captaincy ?? null,
        suggestedLeaders: suggestLeaders(w, club),
        leadership: Object.fromEntries(squad.map((p) => [p.id, Math.round(p.attrs.mental.leadership)])),
      };
    }));

    r('POST', '/careers/:cid/captaincy', async ({ params, body }) => {
      const { captainId, viceCaptainId } = parse(z.object({ captainId: id, viceCaptainId: id }), body);
      return this.mutate(params.cid, (w) => {
        const err = setCaptaincy(w, captainId, viceCaptainId);
        if (err) throw new AppError(400, err);
        return { result: {} };
      });
    });

    r('GET', '/careers/:cid/caps', ({ params, query }) => this.view(params.cid, (w) => {
      const lid = query.get('league') ?? w.clubs[w.userClubId].leagueId;
      const compId = lid === 'WCC' ? `WCC-${w.season}` : `${lid}-${w.season}`;
      const comp = w.competitions[compId];
      const races = comp ? capRaces(w, compId) : { orange: [], purple: [] };
      return { season: w.season, competition: comp ? { id: comp.id, name: comp.name, stage: comp.stage } : null, ...races };
    }));

    r('GET', '/careers/:cid/players', ({ params, query }) => this.view(params.cid, (w) => {
      const q = parse(z.object({
        search: z.string().max(60).optional(), role: z.enum(['BAT', 'WK', 'AR', 'BOWL']).optional(), country: z.string().max(4).optional(),
        league: z.string().max(8).optional(), status: z.enum(['all', 'free', 'contracted', 'mine']).optional(),
        sort: z.enum(['ovr', 'age', 'value', 'runs', 'wickets', 'name']).optional(), page: z.coerce.number().int().min(0).max(500).optional(),
      }), Object.fromEntries(query));
      const s = q.search?.toLowerCase();
      let list = Object.values(w.players).filter((p) => !p.retired && !p.isYouth);
      if (s) list = list.filter((p) => p.name.toLowerCase().includes(s));
      if (q.role) list = list.filter((p) => p.role === q.role);
      if (q.country) list = list.filter((p) => p.country === q.country);
      if (q.league) list = list.filter((p) => p.clubId && w.clubs[p.clubId].leagueId === q.league);
      if (q.status === 'free') list = list.filter((p) => !p.clubId);
      if (q.status === 'contracted') list = list.filter((p) => p.clubId);
      if (q.status === 'mine') list = list.filter((p) => p.clubId === w.userClubId);
      const key = q.sort ?? 'ovr';
      const views = list.map((p) => playerView(w, p));
      views.sort((a, b) =>
        key === 'name' ? a.name.localeCompare(b.name) : key === 'age' ? a.age - b.age : key === 'value' ? b.marketValue - a.marketValue
          : key === 'runs' ? b.season.runs - a.season.runs : key === 'wickets' ? b.season.wickets - a.season.wickets : b.ovr - a.ovr);
      const page = q.page ?? 0;
      return { total: views.length, page, pageSize: 50, players: views.slice(page * 50, page * 50 + 50) };
    }));

    r('GET', '/careers/:cid/players/:pid', ({ params }) => this.view(params.cid, (w) => {
      const p = w.players[params.pid];
      if (!p) throw new AppError(404, 'Player not found.');
      return playerView(w, p, { detail: true });
    }));

    r('GET', '/careers/:cid/clubs/:clubId', ({ params }) => this.view(params.cid, (w) => {
      const club = w.clubs[params.clubId];
      if (!club) throw new AppError(404, 'Club not found.');
      return { club: clubView(w, club), players: squadOf(w, club).map((p) => playerView(w, p)), fixtures: Object.values(w.fixtures).filter((f) => f.homeId === club.id || f.awayId === club.id).sort((a, b) => a.day - b.day).map((f) => fixtureView(w, f)) };
    }));

    r('GET', '/careers/:cid/leagues/:leagueId', ({ params }) => this.view(params.cid, (w) => {
      const l = LEAGUES.find((x) => x.id === params.leagueId);
      if (!l) throw new AppError(404, 'League not found.');
      const compId = `${l.id}-${w.season}`;
      const comp = w.competitions[compId];
      return {
        league: { id: l.id, name: l.name, shortName: l.shortName, country: l.country, fictional: l.fictional, playoffs: l.playoffs, rules: l.squadRules, purse: l.auctionRules.purse },
        state: w.leagues[l.id], competition: comp ? { id: comp.id, name: comp.name, stage: comp.stage, championId: comp.championId, runnerUpId: comp.runnerUpId } : null,
        table: comp ? standingsView(w, compId) : [],
        fixtures: Object.values(w.fixtures).filter((f) => f.competitionId === compId).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)),
        clubs: clubsInLeague(w, l.id).map((cl) => clubView(w, cl)),
      };
    }));

    r('GET', '/careers/:cid/fixtures', ({ params, query }) => this.view(params.cid, (w) => {
      const mine = query.get('mine') === '1';
      return { day: w.day, fixtures: Object.values(w.fixtures).filter((f) => !mine || f.involvesUser).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)) };
    }));

    r('GET', '/careers/:cid/fixtures/:fid', async ({ params }) => {
      const { world: w } = await this.load(params.cid);
      const f = w.fixtures[params.fid];
      if (!f) throw new AppError(404, 'Fixture not found (older seasons keep scorecards in History).');
      const record = f.status === 'complete' ? await this.store.getRecord(params.cid, f.id) : null;
      return { fixture: fixtureView(w, f), result: f.result, match: record ? liveView(record) : null };
    });

    // -------- post-match centre (built on this device from the stored, immutable match record)
    r('GET', '/careers/:cid/fixtures/:fid/report', async ({ params }) => {
      const { world: w } = await this.load(params.cid);
      const record = await this.store.getRecord(params.cid, params.fid);
      if (!record) throw new AppError(404, 'No recorded match for this fixture yet.');
      const fixture = w.fixtures[params.fid] ?? null;
      return buildMatchReport(record, { world: w, fixture, season: fixture?.season ?? w.season });
    });

    // -------- the player database (all records, with each one's status in this career)
    r('GET', '/careers/:cid/database', async ({ params, query }) => {
      const { world: w } = await this.load(params.cid);
      const q = parse(z.object({
        search: z.string().max(60).optional(), kind: z.enum(['all', 'real', 'generated']).optional(), gender: z.enum(['all', 'male', 'female']).optional(),
        nationality: z.enum(['all', 'verified', 'inferred', 'unknown']).optional(), status: z.enum(['all', 'active', 'stale']).optional(),
        country: z.string().max(4).optional(), page: z.coerce.number().int().min(0).max(1000).optional(),
      }), Object.fromEntries(query));
      const s = q.search?.trim().toLowerCase();
      let list = playerDatabase();
      if (q.kind && q.kind !== 'all') list = list.filter((r) => r.kind === q.kind);
      if (q.gender && q.gender !== 'all') list = list.filter((r) => r.gender === q.gender);
      if (q.nationality && q.nationality !== 'all') list = list.filter((r) => r.nationality === q.nationality);
      if (q.status && q.status !== 'all') list = list.filter((r) => r.status === q.status);
      if (q.country) list = list.filter((r) => r.country === q.country);
      if (s) list = list.filter((r) => r.name.toLowerCase().includes(s));
      const page = q.page ?? 0;
      const rows = list.slice(page * 50, page * 50 + 50).map((r) => {
        const p = w.players[r.id];
        return {
          ...r, countryName: r.country ? COUNTRY_NAMES[r.country] : null,
          inGame: p ? (p.retired ? 'Retired' : p.clubId ? w.clubs[p.clubId].name : p.isYouth ? 'Academy' : 'Free agent') : r.gender === 'female' ? 'Not in game (men’s competitions only)' : 'Not in this world',
          playerId: p ? p.id : null,
        };
      });
      return { total: list.length, page, pageSize: 50, rows, meta: PLAYER_DB_META };
    });

    r('GET', '/careers/:cid/archive', async ({ params, query }) => {
      const { world: w } = await this.load(params.cid);
      const { season, club } = parse(z.object({ season: z.coerce.number().int().min(2000).max(2200).default(w.season), club: id.optional() }), { season: query.get('season') ?? undefined, club: query.get('club') ?? undefined });
      const clubId = club ?? w.userClubId;
      if (!w.clubs[clubId]) throw new AppError(404, 'Club not found.');
      const records = await this.store.seasonRecords(params.cid, season, [clubId]);
      return { season, clubId, matches: records.map((s) => archiveEntry(w, s, season)).sort((a, b) => (b.day ?? 0) - (a.day ?? 0)) };
    });

    r('GET', '/careers/:cid/world', ({ params }) => this.view(params.cid, (w) => {
      const path = qualificationPath(w);
      const total = path.reduce((s, p) => s + p.slots, 0);
      return {
        season: w.season, phase: w.phase,
        leagues: LEAGUES.map((l) => ({ ...w.leagues[l.id], id: l.id, name: l.name, shortName: l.shortName, country: l.country, countryName: COUNTRY_NAMES[l.country], fictional: l.fictional, clubs: clubsInLeague(w, l.id).length, champion: w.competitions[`${l.id}-${w.season}`]?.championId ?? null })),
        qualification: path.map((p) => ({ ...p, clubs: p.clubIds.map((x) => ({ id: x, name: w.clubs[x].name })) })),
        plan: total ? planFormat(total) : null,
      };
    }));

    r('GET', '/careers/:cid/wcc', ({ params, query }) => this.view(params.cid, (w) => {
      const season = Number(query.get('season') ?? w.season);
      const comp = w.competitions[`WCC-${season}`];
      if (!comp) return { competition: null };
      const groups = (comp.meta?.groups ?? {}) as Record<string, string[]>;
      return {
        competition: { id: comp.id, name: comp.name, stage: comp.stage, championId: comp.championId, runnerUpId: comp.runnerUpId, meta: { plan: comp.meta?.plan, host: comp.meta?.host, round: comp.meta?.round, qualifiers: comp.meta?.qualifiers } },
        groups: Object.keys(groups).sort().map((g) => ({ group: g, table: standingsView(w, comp.id, g) })),
        fixtures: Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)),
      };
    }));

    r('GET', '/careers/:cid/news', ({ params }) => this.view(params.cid, (w) => ({ news: w.news })));

    // -------- the Club World: inbox, world news, conversations, boardroom, cricket feed
    r('GET', '/careers/:cid/inbox', ({ params, query }) => this.view(params.cid, (w) => inboxView(w, { box: query.get('box') ?? undefined, category: query.get('category') ?? undefined, search: query.get('q') ?? undefined })));
    r('POST', '/careers/:cid/inbox/:mid', async ({ params, body }) => {
      const { op } = parse(z.object({ op: z.enum(['read', 'unread', 'archive', 'unarchive', 'pin', 'unpin']) }), body);
      return this.mutate(params.cid, (w) => {
        const m = cw(w).inbox.find((x) => x.id === params.mid);
        if (!m) throw new AppError(404, 'Message not found.');
        if (op === 'read' || op === 'unread') m.read = op === 'read';
        if (op === 'archive' || op === 'unarchive') m.archived = op === 'archive';
        if (op === 'pin' || op === 'unpin') m.pinned = op === 'pin';
        return { result: {} };
      });
    });
    r('POST', '/careers/:cid/inbox-read-all', ({ params }) => this.mutate(params.cid, (w) => {
      for (const m of cw(w).inbox) if (m.season < w.season || m.day <= w.day) m.read = true;
      return { result: {} };
    }));
    r('POST', '/careers/:cid/inbox/:mid/respond', async ({ params, body }) => {
      const { optionId } = parse(z.object({ optionId: z.string().max(40) }), body);
      return this.mutate(params.cid, (w) => {
        const res = respondToMessage(w, params.mid, optionId, {
          story: (sid, index) => {
            const r = applyStoryAction(w, sid, index, { promoteYouth, releasePlayer });
            return r.ok ? null : r.error ?? 'That action failed.';
          },
        });
        if (!res.ok) throw new AppError(400, res.error!);
        return { result: { outcome: res.outcome } };
      });
    });
    r('GET', '/careers/:cid/world-news', ({ params, query }) => this.view(params.cid, (w) => newsView(w, { filter: query.get('filter') ?? undefined, page: Number(query.get('page') ?? 0) || 0 })));
    r('GET', '/careers/:cid/conversations', ({ params }) => this.view(params.cid, conversationsView));
    r('POST', '/careers/:cid/conversations/:id/reply', async ({ params, body }) => {
      const { optionId } = parse(z.object({ optionId: z.string().max(40) }), body);
      return this.mutate(params.cid, (w) => {
        const res = replyToConversation(w, params.id, optionId);
        if (!res.ok) throw new AppError(400, res.error!);
        return { result: { outcome: res.outcome } };
      });
    });
    r('GET', '/careers/:cid/board', ({ params }) => this.view(params.cid, boardView));
    r('POST', '/careers/:cid/board/negotiate', async ({ params, body }) => {
      const { objectiveId } = parse(z.object({ objectiveId: id }), body);
      return this.mutate(params.cid, (w) => {
        const err = negotiateObjective(w, objectiveId);
        if (err) throw new AppError(400, err);
        return { result: {} };
      });
    });
    r('GET', '/careers/:cid/feed', ({ params, query }) => this.view(params.cid, (w) => feedView(w, { filter: query.get('filter') ?? undefined, page: Number(query.get('page') ?? 0) || 0 })));
    r('POST', '/careers/:cid/follow', async ({ params, body }) => {
      const f = parse(z.object({ kind: z.enum(['player', 'club', 'account']), id, on: z.boolean() }), body);
      return this.mutate(params.cid, (w) => {
        const c = cw(w);
        const list = f.kind === 'account' ? c.feed.following : f.kind === 'player' ? c.follows.players : c.follows.clubs;
        const i = list.indexOf(f.id);
        if (f.on && i < 0) list.push(f.id);
        if (!f.on && i >= 0) list.splice(i, 1);
        return { result: {} };
      });
    });
    r('POST', '/careers/:cid/feed/mute', async ({ params, body }) => {
      const f = parse(z.object({ topic: z.string().max(20), on: z.boolean() }), body);
      return this.mutate(params.cid, (w) => {
        const m = cw(w).feed.muted;
        const i = m.indexOf(f.topic);
        if (f.on && i < 0) m.push(f.topic);
        if (!f.on && i >= 0) m.splice(i, 1);
        return { result: {} };
      });
    });
    r('POST', '/careers/:cid/feed/save', async ({ params, body }) => {
      const f = parse(z.object({ postId: id, on: z.boolean() }), body);
      return this.mutate(params.cid, (w) => {
        const m = cw(w).feed.saved;
        const i = m.indexOf(f.postId);
        if (f.on && i < 0) m.push(f.postId);
        if (!f.on && i >= 0) m.splice(i, 1);
        return { result: {} };
      });
    });
    r('GET', '/careers/:cid/stories', ({ params }) => this.view(params.cid, (w) => ({ active: w.stories.filter((s) => s.status === 'active'), recent: w.stories.slice(0, 40), timeline: [...w.timeline].reverse() })));

    r('POST', '/careers/:cid/stories/:sid/act', async ({ params, body }) => {
      const { index } = parse(z.object({ index: z.number().int().min(0).max(10) }), body);
      return this.mutate(params.cid, (w) => {
        const res = applyStoryAction(w, params.sid, index, { promoteYouth, releasePlayer });
        if (!res.ok) throw new AppError(400, res.error!);
        return { result: { ok: true } };
      });
    });

    r('GET', '/careers/:cid/history', ({ params }) => this.view(params.cid, (w) => {
      const name = (pid: string) => w.players[pid]?.name ?? pid;
      const rec = w.records;
      return {
        seasons: w.history, chronicles: w.chronicles, timeline: [...w.timeline].reverse(),
        awards: w.awards.map((a) => ({ ...a, playerName: name(a.playerId), competition: w.competitions[a.competitionId]?.name ?? a.competitionId })),
        hallOfFame: w.hallOfFame, formerClubs: w.formerClubs.map((f) => ({ ...f, name: w.clubs[f.clubId]?.name })),
        records: {
          highestTeamTotal: rec.highestTeamTotal && { ...rec.highestTeamTotal, club: w.clubs[rec.highestTeamTotal.clubId]?.name },
          lowestTeamTotal: rec.lowestTeamTotal && { ...rec.lowestTeamTotal, club: w.clubs[rec.lowestTeamTotal.clubId]?.name },
          highestScore: rec.highestScore && { ...rec.highestScore, player: name(rec.highestScore.playerId) },
          bestBowling: rec.bestBowling && { ...rec.bestBowling, player: name(rec.bestBowling.playerId) },
          mostCareerRuns: rec.mostCareerRuns && { ...rec.mostCareerRuns, player: name(rec.mostCareerRuns.playerId) },
          mostCareerWickets: rec.mostCareerWickets && { ...rec.mostCareerWickets, player: name(rec.mostCareerWickets.playerId) },
        },
        rivalries: Object.values(w.rivalries).filter((x) => x.clubIds.includes(w.userClubId)).sort((a, b) => b.intensity - a.intensity).slice(0, 10).map((x) => ({ ...x, names: x.clubIds.map((c) => w.clubs[c].name) })),
        trophies: w.clubs[w.userClubId].trophies,
        champions: Object.values(w.leagues).flatMap((l) => l.champions.map((ch) => ({ ...ch, leagueId: l.id }))),
      };
    }));

    r('GET', '/careers/:cid/finances', ({ params }) => this.view(params.cid, (w) => {
      const club = w.clubs[w.userClubId];
      const facilities = (['training', 'youth', 'medical', 'scouting'] as const).map((f) => ({ id: f, level: club.facilities[f], upgradeCost: facilityUpgradeCost(w, club.id, f) }));
      return { ...financeView(w), facilities, board: club.board, coaches: club.coaches };
    }));

    r('GET', '/careers/:cid/transfers', ({ params }) => this.view(params.cid, (w) => {
      const club = w.clubs[w.userClubId];
      const name = (cid: string | null) => (cid ? w.clubs[cid]?.shortName ?? cid : '—');
      return {
        window: w.phase === 'preseason' ? 'open' : w.phase === 'season' || w.phase === 'wcc' ? 'replacements' : 'closed',
        ledger: [...w.ledger].reverse().slice(0, 300).map((t) => ({ ...t, player: w.players[t.playerId]?.name ?? t.playerId, from: name(t.fromClubId), to: name(t.toClubId) })),
        freeAgents: freeAgentsFor(w, club).slice(0, 120).map((p) => playerView(w, p)),
        purse: club.purse, squadSize: club.squad.length, rules: leagueById(club.leagueId).squadRules,
      };
    }));

    r('GET', '/careers/:cid/retentions', ({ params }) => this.view(params.cid, retentionView));

    r('GET', '/careers/:cid/intel/:clubId', async ({ params }) => {
      const { world: w } = await this.load(params.cid);
      if (!w.clubs[params.clubId]) throw new AppError(404, 'Club not found.');
      const records = [...(await this.store.seasonRecords(params.cid, w.season, [params.clubId])), ...(await this.store.seasonRecords(params.cid, w.season - 1, [params.clubId]))];
      return opponentReport(w, params.clubId, records);
    });

    r('GET', '/careers/:cid/prematch/:fid', async ({ params }) => {
      const { world: w } = await this.load(params.cid);
      const fx = w.fixtures[params.fid];
      if (!fx?.involvesUser || !fx.homeId || !fx.awayId) throw new AppError(404, 'Fixture not found.');
      const venue = VENUES.find((v) => v.id === (fx.venueId || w.clubs[fx.homeId].venueId))!;
      const user = w.clubs[w.userClubId];
      const oppId = fx.homeId === user.id ? fx.awayId : fx.homeId;
      const opp = w.clubs[oppId];
      const mine = selectXI(w, user, fx);
      const theirs = selectXI(w, opp, fx);
      const assistant = user.lineup ? selectXI(w, { ...user, lineup: null }, fx) : mine;
      const records = [...(await this.store.seasonRecords(params.cid, w.season, [oppId])), ...(await this.store.seasonRecords(params.cid, w.season - 1, [oppId]))];
      const intel = opponentReport(w, oppId, records);
      return {
        fixture: fixtureView(w, fx), today: fx.day === w.day,
        venue: { id: venue.id, name: venue.name, city: venue.city, boundaryStraight: venue.boundaryStraight, boundarySquare: venue.boundarySquare, altitude: venue.altitude, pitch: venue.pitch, dewChance: venue.dewChance },
        user: clubView(w, user), opponent: clubView(w, opp),
        userXI: mine.xi.map((p) => playerView(w, p)), userXINote: mine.note, lineupSaved: !!user.lineup,
        opponentXI: theirs.xi.map((p) => playerView(w, p)), opponentReasons: theirs.reasons,
        squad: squadOf(w, user).map((p) => ({ ...playerView(w, p), canBowl: canBowl(p), keeper: p.role === 'WK' || p.attrs.field.keeping >= 60 })),
        suggestedXI: assistant.xi.map((p) => p.id), suggestedReasons: assistant.reasons,
        maxOverseas: leagueById(user.leagueId).squadRules.maxOverseasInXI,
        promises: cw(w).promises.filter((p) => p.status === 'active' && p.to.kind === 'player' && p.matches !== null).map((p) => ({ playerId: p.to.id, kind: p.kind, text: p.text })),
        intel: { recommendations: intel.recommendations, matches: intel.matches, team: intel.team },
        headToHead: w.rivalries[[user.id, oppId].sort().join('|')] ?? null,
      };
    });

    // -------- auction house
    r('GET', '/careers/:cid/auction', ({ params, query }) => this.view(params.cid, (w) => auctionRoomView(w, query.get('lite') !== '1')));
    r('GET', '/careers/:cid/auction/summary', ({ params }) => this.view(params.cid, auctionSummary));

    r('POST', '/careers/:cid/auction/tick', async ({ params, body }) => {
      const { dt } = parse(z.object({ dt: z.number().min(0).max(5000) }), body);
      return this.withLock(params.cid, async () => {
        const entry = await this.load(params.cid);
        const w = entry.world;
        const a = userAuctionOf(w);
        if (!a?.live || a.status !== 'live') return auctionRoomView(w, false);
        const resultsBefore = a.live.results.length;
        const changed = liveTick(w, a, dt);
        const resolved = a.live.results.length !== resultsBefore || (a.status as string) !== 'live';
        if ((a.status as string) === 'complete') {
          if (advanceCascade(w)) w.phase = 'preseason';
        }
        // A sold or unsold lot is a completed transaction: write it immediately.
        if (resolved) {
          const t = this.dirty.get(params.cid);
          if (t) clearTimeout(t);
          this.dirty.delete(params.cid);
          await this.commit(params.cid, entry, []);
          if ((a.status as string) === 'complete') await this.backup(params.cid, w, 'Auction complete');
        } else if (changed) this.scheduleFlush(params.cid);
        return auctionRoomView(w, false);
      });
    });

    const command = z.discriminatedUnion('type', [
      z.object({ type: z.literal('begin') }),
      z.object({ type: z.literal('bid'), amount: z.number().positive().max(500).optional(), upTo: z.number().positive().max(500).optional() }),
      z.object({ type: z.literal('pass') }),
      z.object({ type: z.literal('watch') }),
      z.object({ type: z.literal('proxy'), playerId: id, max: z.number().positive().max(500).nullable() }),
      z.object({ type: z.literal('flag'), playerId: id, flagged: z.boolean() }),
      z.object({ type: z.literal('pause'), paused: z.boolean() }),
      z.object({ type: z.literal('skip-lot') }),
      z.object({ type: z.literal('accelerated-toggle'), playerId: id }),
      z.object({ type: z.literal('accelerated-start') }),
      z.object({ type: z.literal('clock'), setting: z.enum(['brisk', 'standard', 'relaxed']) }),
    ]);

    // In-room commands are validated before anything changes. Bids, passes and pauses are saved
    // like clock ticks (soon, not synchronously) so the room stays responsive; anything that
    // completes a transaction or edits the shortlist is committed before success is reported.
    const COMMIT_NOW = new Set<LiveCommand['type']>(['begin', 'pause', 'clock', 'proxy', 'flag', 'skip-lot', 'accelerated-toggle', 'accelerated-start']);
    r('POST', '/careers/:cid/auction/command', async ({ params, body }) => {
      const cmd = parse(command, body?.command) as LiveCommand;
      return this.withLock(params.cid, async () => {
        const entry = await this.load(params.cid);
        const w = entry.world;
        const a = userAuctionOf(w);
        if (!a || a.status !== 'live') throw new AppError(409, 'There is no live auction for your league.');
        const resultsBefore = a.live?.results.length ?? 0;
        const res = liveCommand(w, a, cmd);
        if (!res.ok) throw new AppError(400, res.error!);
        if ((a.status as string) === 'complete' && advanceCascade(w)) w.phase = 'preseason';
        const resolved = (a.live?.results.length ?? 0) !== resultsBefore || (a.status as string) !== 'live';
        if (resolved || COMMIT_NOW.has(cmd.type)) {
          const t = this.dirty.get(params.cid);
          if (t) clearTimeout(t);
          this.dirty.delete(params.cid);
          await this.commit(params.cid, entry, []);
          if ((a.status as string) === 'complete') await this.backup(params.cid, w, 'Auction complete');
        } else this.scheduleFlush(params.cid);
        return { ...auctionRoomView(w, false), version: entry.meta.version };
      });
    });

    // Skip Auction: the same live engine, run at high speed, committed atomically.
    r('POST', '/careers/:cid/auction/skip', async ({ params, body }) => {
      const { mode } = parse(z.object({ mode: z.enum(['assistant', 'without-me', 'until-flagged']) }), body);
      return this.mutate(params.cid, (w) => {
        const a = userAuctionOf(w);
        if (!a || a.status !== 'live' || !a.live) throw new AppError(409, 'There is no live auction for your league.');
        const res = fastForward(w, a, mode);
        if ((a.status as string) === 'complete' && advanceCascade(w)) w.phase = 'preseason';
        return { result: { status: a.status, phase: w.phase, stoppedAt: res.stoppedAt ? w.players[res.stoppedAt].name : null, lots: res.lots } };
      }, { backup: 'Auction complete' });
    });

    r('POST', '/careers/:cid/auction/sim', async ({ params, body }) => {
      const { until, assistant } = parse(z.object({ until: z.enum(['flagged', 'set', 'end']), assistant: z.boolean() }), body);
      return this.mutate(params.cid, (w) => {
        const a = userAuctionOf(w);
        if (!a || a.status !== 'live') throw new AppError(409, 'There is no live auction for your league.');
        const res = auctionAct(w, a.id, { type: 'sim', until, assistant }, a.version);
        if (!res.ok) throw new AppError(400, res.error!);
        if ((a.status as string) === 'complete' && advanceCascade(w)) w.phase = 'preseason';
        return { result: { status: a.status, phase: w.phase } };
      }, { backup: undefined });
    });

    // -------- phase progression
    r('POST', '/careers/:cid/continue', async ({ params, body }) => {
      const { mode } = parse(z.object({ mode: z.enum(['day', 'next', 'season']).default('next') }), body ?? {});
      if (await this.store.getLive(params.cid, 'main')) throw new AppError(409, 'Finish your live match first (Match Centre).');
      let label: string | undefined;
      const out = await this.mutate<Record<string, unknown>>(params.cid, (w) => {
        switch (w.phase) {
          case 'auction': {
            if (!advanceCascade(w)) throw new AppError(409, 'Your league’s auction is still in progress — finish it in the Auction House.');
            w.phase = 'preseason';
            return { result: { phase: w.phase, messages: ['All auctions complete. Finalise your squad and start the season.'] } };
          }
          case 'preseason': {
            const problems = startSeason(w);
            if (problems.length) throw new AppError(400, problems.join(' '));
            return { result: { phase: w.phase, messages: ['The season has begun.'] } };
          }
          case 'season':
          case 'wcc': {
            const res = advance(w, mode);
            return { result: { phase: w.phase, stoppedFor: res.stoppedFor, fixtureId: res.fixtureId, messages: res.messages, simulated: res.records.length }, records: res.records };
          }
          case 'offseason': {
            label = `End of ${w.season}`;
            endSeason(w);
            return { result: { phase: w.phase, messages: [`Welcome to ${w.season}. Choose your retentions.`] } };
          }
          case 'retention': {
            commitRetentions(w);
            if (advanceCascade(w)) w.phase = 'preseason';
            return { result: { phase: w.phase, messages: ['Retentions committed. The auction cascade has begun.'] } };
          }
        }
      });
      if (label) {
        const { world } = await this.load(params.cid);
        await this.backup(params.cid, world, label);
      }
      return out;
    });

    r('POST', '/careers/:cid/retentions', async ({ params, body }) => {
      const { playerIds } = parse(z.object({ playerIds: z.array(id).max(10) }), body);
      return this.mutate(params.cid, (w) => {
        const err = setUserRetentions(w, playerIds);
        if (err) throw new AppError(400, err);
        return { result: retentionView(w) };
      });
    });

    // -------- squad, tactics, training
    r('POST', '/careers/:cid/lineup', async ({ params, body }) => {
      const { playerIds } = parse(z.object({ playerIds: z.array(id).length(11).nullable() }), body);
      return this.mutate(params.cid, (w) => {
        const club = w.clubs[w.userClubId];
        if (playerIds) {
          const l = leagueById(club.leagueId);
          const v = validateXI(playerIds.map((pid) => w.players[pid]).filter(Boolean), club.squad, l.squadRules, l.domesticCountries);
          if (!v.ok) throw new AppError(400, v.errors.join(' '));
          club.lineup = playerIds;
          return { result: { warnings: v.warnings } };
        }
        club.lineup = null;
        return { result: { warnings: [] } };
      });
    });

    const tactics = z.object({
      battingIntent: z.number().min(0).max(1),
      phaseIntent: z.object({ powerplay: z.number().min(0).max(1), middle: z.number().min(0).max(1), death: z.number().min(0).max(1) }),
      bowlingPlan: plan,
      reviewPolicy: z.enum(['conservative', 'balanced', 'aggressive']),
    });
    r('GET', '/careers/:cid/tactics', ({ params }) => this.view(params.cid, (w) => {
      const club = w.clubs[w.userClubId];
      return { tactics: club.defaultTactics, dna: club.dna, training: club.training, venue: VENUES.find((v) => v.id === club.venueId) };
    }));
    r('POST', '/careers/:cid/tactics', async ({ params, body }) => {
      const t = parse(tactics, body);
      return this.mutate(params.cid, (w) => {
        const club = w.clubs[w.userClubId];
        club.defaultTactics = { ...club.defaultTactics, ...t };
        return { result: { warnings: [] } };
      });
    });

    const focus = z.enum(['balanced', 'batting', 'pace', 'spin', 'fielding', 'fitness']);
    r('POST', '/careers/:cid/training', async ({ params, body }) => {
      const t = parse(z.object({ intensity: z.enum(['light', 'normal', 'intense']), focus, individual: z.record(id, focus) }), body);
      return this.mutate(params.cid, (w) => {
        const club = w.clubs[w.userClubId];
        for (const pid of Object.keys(t.individual)) if (!club.squad.includes(pid) && !club.academy.includes(pid)) throw new AppError(400, 'Individual plans are only for your own players.');
        club.training = t;
        return { result: {} };
      });
    });

    r('POST', '/careers/:cid/facilities/:facility/upgrade', async ({ params }) => {
      const facility = parse(z.enum(['training', 'youth', 'medical', 'scouting']), params.facility);
      return this.mutate(params.cid, (w) => {
        const err = upgradeFacility(w, w.userClubId, facility);
        if (err) throw new AppError(400, err);
        return { result: {} };
      });
    });

    r('POST', '/careers/:cid/transfers/sign', async ({ params, body }) => {
      const { playerId } = parse(z.object({ playerId: id }), body);
      return this.mutate(params.cid, (w) => {
        const err = signFreeAgent(w, playerId);
        if (err) throw new AppError(400, err);
        return { result: {} };
      });
    });
    r('POST', '/careers/:cid/transfers/release', async ({ params, body }) => {
      const { playerId } = parse(z.object({ playerId: id }), body);
      return this.mutate(params.cid, (w) => {
        const err = releasePlayer(w, playerId);
        if (err) throw new AppError(400, err);
        return { result: {} };
      });
    });
    r('POST', '/careers/:cid/transfers/autofill', ({ params }) => this.mutate(params.cid, (w) => {
      if (w.phase !== 'preseason') throw new AppError(400, 'Auto-fill is available in pre-season.');
      return { result: { signed: autoFillUserSquad(w) } };
    }));

    r('POST', '/careers/:cid/youth/:pid/:action', async ({ params }) => {
      const action = parse(z.enum(['promote', 'release']), params.action);
      return this.mutate(params.cid, (w) => {
        const club = w.clubs[w.userClubId];
        if (!club.academy.includes(params.pid)) throw new AppError(400, 'Player is not in your academy.');
        if (action === 'promote') {
          const err = promoteYouth(w, club, params.pid);
          if (err) throw new AppError(400, err);
        } else releaseYouth(w, club, params.pid);
        return { result: {} };
      });
    });

    r('POST', '/careers/:cid/settings', async ({ params, body }) => {
      const s = parse(z.object({ autoPlayUserMatches: z.boolean(), reducedMotion: z.boolean() }), body);
      return this.mutate(params.cid, (w) => {
        w.settings = s;
        return { result: {} };
      });
    });

    // -------- matches
    const xiSchema = z.object({ fixtureId: id, xi: z.array(id).length(11).optional() });

    /** The user's XI for this fixture: the one chosen before the match if valid, else the saved lineup or the assistant's pick. */
    const userXIFor = (w: WorldState, fx: Fixture, xi?: string[]) => {
      const club = w.clubs[w.userClubId];
      if (!xi) return selectXI(w, club, fx).xi;
      const l = leagueById(club.leagueId);
      const players = xi.map((pid) => w.players[pid]).filter(Boolean);
      const v = validateXI(players, club.squad, l.squadRules, l.domesticCountries);
      if (!v.ok) throw new AppError(400, v.errors.join(' '));
      return players;
    };

    r('POST', '/careers/:cid/match/quick', async ({ params, body }) => {
      const { fixtureId, xi } = parse(xiSchema, body);
      if (await this.store.getLive(params.cid, 'main')) throw new AppError(409, 'A live match is in progress.');
      return this.mutate(params.cid, (w) => {
        const fx = w.fixtures[fixtureId];
        if (!fx?.involvesUser || fx.status !== 'scheduled') throw new AppError(400, 'That is not your next match.');
        if (fx.day !== w.day) throw new AppError(400, 'Advance to match day first.');
        const state = simulateMatch(buildMatchSetup(w, fx, userXIFor(w, fx, xi)), matchSeed(w, fx));
        completeUserFixture(w, fx.id, state);
        recordOdds(w, fx.id);
        return { result: { fixture: fixtureView(w, fx) }, records: [{ fixtureId: fx.id, state }] };
      });
    });

    r('POST', '/careers/:cid/match/start', async ({ params, body }) => {
      const { fixtureId, xi } = parse(xiSchema, body);
      if (await this.store.getLive(params.cid, 'main')) throw new AppError(409, 'A live match is already in progress.');
      let live: LiveMatch | null = null;
      const out = await this.mutate(params.cid, (w) => {
        const fx = w.fixtures[fixtureId];
        if (!fx?.involvesUser || fx.status !== 'scheduled') throw new AppError(400, 'That is not your next match.');
        if (fx.day !== w.day) throw new AppError(400, 'Advance to match day first.');
        live = { state: createMatch(buildMatchSetup(w, fx, userXIFor(w, fx, xi)), matchSeed(w, fx)), ctlTimeline: [], experimental: false };
        fx.status = 'live';
        return { result: { fixtureId: fx.id } };
      });
      await this.store.putLive({ careerId: params.cid, slot: 'main', fixtureId, version: 1, data: live! }, null);
      return out;
    });

    const matchAction = z.discriminatedUnion('type', [
      z.object({ type: z.literal('toss-call'), call: z.enum(['heads', 'tails']) }),
      z.object({ type: z.literal('toss'), decision: z.enum(['bat', 'bowl']) }),
      z.object({ type: z.literal('batter'), playerId: id }),
      z.object({ type: z.literal('auto'), settings: z.object({ bowler: z.boolean(), batter: z.boolean(), approach: z.boolean(), plan: z.boolean(), reviews: z.boolean() }).partial() }),
      z.object({ type: z.literal('running'), value: z.enum(['conservative', 'balanced', 'aggressive']) }),
      z.object({ type: z.literal('phase-intent'), phase: z.enum(['powerplay', 'middle', 'death']), value: z.number().min(0).max(1) }),
      z.object({ type: z.literal('batter-plan'), batterId: id, vsPace: z.number().min(-0.3).max(0.3).nullable(), vsSpin: z.number().min(-0.3).max(0.3).nullable() }),
      z.object({ type: z.literal('bowler'), playerId: id }),
      z.object({ type: z.literal('plan'), plan, batterId: id.nullable().optional() }),
      z.object({ type: z.literal('intent'), value: z.number().min(0).max(1).nullable(), batterId: id.optional() }),
      z.object({ type: z.literal('order'), order: z.array(id).max(11) }),
      z.object({ type: z.literal('openers'), strikerId: id, nonStrikerId: id }),
      z.object({ type: z.literal('review'), review: z.boolean() }),
    ]);

    for (const slot of ['main', 'lab'] as const) {
      const base = slot === 'main' ? 'match' : 'lab';
      const getLive = async (cid: string) => {
        const live = await this.store.getLive(cid, slot);
        if (!live) throw new AppError(404, 'No match in progress.');
        return live;
      };
      r('GET', `/careers/:cid/${base}`, async ({ params, query }) => {
        await this.load(params.cid);
        const live = await this.store.getLive(params.cid, slot);
        if (!live) return { live: null };
        const { world: w } = await this.load(params.cid);
        const compId = w.fixtures[live.fixtureId]?.competitionId;
        const caps = compId ? capHolders(w)[compId] ?? null : null;
        return { live: { fixtureId: live.fixtureId, version: live.version, experimental: live.data.experimental, caps, state: liveView(live.data.state, Number(query.get('since') ?? 0)) } };
      });
      r('POST', `/careers/:cid/${base}/step`, async ({ params, body }) => {
        const { mode, version, since } = parse(z.object({ mode: z.enum(['toss', 'ball', 'over', 'next-over', 'key', 'innings', 'end']), version: z.number().int(), since: z.number().int().min(0).default(0) }), body);
        return this.withLock(`${params.cid}:${slot}`, async () => {
          const live = await getLive(params.cid);
          if (live.version !== version) throw new AppError(409, 'The match moved on in another tab.', 'VERSION');
          const { needs } = runSteps(live.data, mode as StepMode);
          await this.store.putLive({ ...live, version: version + 1 }, version).catch((e) => {
            throw new AppError(e instanceof ConflictError ? 409 : 507, friendlyStorageError(e));
          });
          return { version: version + 1, needs, state: liveView(live.data.state, since) };
        });
      });
      r('POST', `/careers/:cid/${base}/action`, async ({ params, body }) => {
        const { action, version, since } = parse(z.object({ action: matchAction, version: z.number().int(), since: z.number().int().min(0).default(0) }), body);
        return this.withLock(`${params.cid}:${slot}`, async () => {
          const live = await getLive(params.cid);
          if (live.version !== version) throw new AppError(409, 'The match moved on in another tab.', 'VERSION');
          const side = live.data.state.setup.userSide;
          if (!side) throw new AppError(400, 'You are not playing in this match.');
          const res = applyAction(live.data.state, side, action as MatchAction);
          if (!res.ok) throw new AppError(400, res.error!);
          await this.store.putLive({ ...live, version: version + 1 }, version);
          return { version: version + 1, warnings: res.warnings ?? [], state: liveView(live.data.state, since) };
        });
      });
    }

    r('POST', '/careers/:cid/match/finish', async ({ params }) => {
      const live = await this.store.getLive(params.cid, 'main');
      if (!live) throw new AppError(404, 'No match in progress.');
      if (live.data.state.status !== 'complete') throw new AppError(400, 'The match is not over yet.');
      const out = await this.mutate<Record<string, unknown>>(params.cid, (w) => {
        const fx = w.fixtures[live.fixtureId];
        if (fx.status === 'complete') return { result: { fixture: fixtureView(w, fx), duplicate: true } };
        fx.status = 'scheduled';
        completeUserFixture(w, fx.id, live.data.state);
        recordOdds(w, fx.id);
        return { result: { fixture: fixtureView(w, fx) }, records: [{ fixtureId: fx.id, state: live.data.state }] };
      });
      await this.store.deleteLive(params.cid, 'main');
      return out;
    });

    r('POST', '/careers/:cid/lab/start', async ({ params, body }) => {
      const { fixtureId, fromSeq } = parse(z.object({ fixtureId: id, fromSeq: z.number().int().min(0) }), body);
      const record = await this.store.getRecord(params.cid, fixtureId);
      if (!record) throw new AppError(404, 'No recorded match for that fixture.');
      if (!record.setup.userSide) throw new AppError(400, 'Scenario Lab replays your own matches.');
      const state = rebuildTo(record, fromSeq, []);
      await this.store.putLive({ careerId: params.cid, slot: 'lab', fixtureId, version: 1, data: { state, ctlTimeline: [], experimental: true } }, null);
      return { ok: true, version: 1 };
    });
    r('DELETE', '/careers/:cid/lab', async ({ params }) => {
      await this.store.deleteLive(params.cid, 'lab');
      return { ok: true };
    });
  }

  private async importPackage(pkg: ReturnType<typeof buildPackage>, name: string) {
    const careerId = crypto.randomUUID();
    const world = migrateWorld(structuredClone(pkg.world), pkg.schemaVersion);
    world.careerId = careerId;
    const meta = { ...this.deriveMeta(world, null), name, createdAt: pkg.meta.createdAt ?? new Date().toISOString(), version: 1 };
    const rows = pkg.records.map((r) => ({ ...r, careerId }));
    this.onSave({ state: 'saving', careerId, at: meta.updatedAt });
    try {
      await this.store.commit(meta, world, rows, null);
    } catch (e) {
      await this.store.deleteCareer(careerId).catch(() => {});
      const message = friendlyStorageError(e);
      this.onSave({ state: 'error', careerId, message, at: new Date().toISOString() });
      throw new AppError(507, message, 'STORAGE');
    }
    // Verify what was written before reporting success.
    const back = await this.store.loadWorld(careerId);
    if (!back || fingerprint(back) !== fingerprint(world)) {
      await this.store.deleteCareer(careerId);
      throw new AppError(500, 'The imported career did not verify after saving, so it was removed. Your existing saves are untouched.');
    }
    this.onSave({ state: 'saved', careerId, at: meta.updatedAt });
    return { id: careerId, name };
  }
}

/** Starting tactical identity chosen during career creation. */
function applyPhilosophy(w: WorldState, philosophy: 'balanced' | 'aggressive' | 'anchored' | 'spin' | 'pace') {
  const club = w.clubs[w.userClubId];
  const t = defaultTactics();
  if (philosophy === 'aggressive') t.phaseIntent = { powerplay: 0.58, middle: 0.48, death: 0.78 };
  if (philosophy === 'anchored') t.phaseIntent = { powerplay: 0.38, middle: 0.32, death: 0.6 };
  club.defaultTactics = t;
  club.dna.aggression = philosophy === 'aggressive' ? 65 : philosophy === 'anchored' ? 38 : 50;
  club.dna.spinReliance = philosophy === 'spin' ? 65 : philosophy === 'pace' ? 35 : 50;
  club.dna.paceReliance = 100 - club.dna.spinReliance;
}

/** Records keep every delivery; only per-ball pressure reasons are dropped to save space. */
function compact(s: MatchState): MatchState {
  return { ...s, deliveries: s.deliveries.map((d) => ({ ...d, pressure: { batter: d.pressure.batter, bowler: d.pressure.bowler, reasons: [] } })) };
}


/** Stores the post-match qualification estimate on the match's impact snapshot. */
function recordOdds(w: WorldState, fixtureId: string) {
  const m = w.matchImpacts?.[fixtureId];
  if (m) m.odds = qualificationOdds(w);
}
