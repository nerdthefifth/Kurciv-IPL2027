import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WorldState } from '@kurciv/domain';
import { canAfford, canRegister, isOverseas, validateXI } from '@kurciv/domain';
import { CLUB_SEEDS, COUNTRY_NAMES, FEATURE_FLAGS, LEAGUES, VENUES, leagueById } from '@kurciv/config';
import { pickXI, simulateMatch } from '@kurciv/ai';
import { BUILT_IN_FIELDS, applyAction, createMatch, validateField, type MatchAction } from '@kurciv/simulation';
import {
  advance, advanceCascade, auctionAct, autoFillUserSquad, buildMatchSetup, clubsInLeague, commitRetentions, completeUserFixture, endSeason,
  facilityUpgradeCost, freeAgentsFor, matchSeed, nextBid, nextUserFixture, planFormat, promoteYouth, publicAuction, qualificationPath, releasePlayer,
  releaseYouth, selectXI, setUserRetentions, signFreeAgent, squadOf, squadProblems, startSeason, upgradeFacility, valuePlayer,
} from '@kurciv/world';
import { createSession, destroySession, hashPassword, rateLimit, requireUser, verifyPassword } from './auth';
import { audit, type DB } from './db';
import { opponentReport } from './intel';
import { rebuildTo, runSteps, type StepMode } from './match';
import { HttpError, type CareerStore, type LiveMatch } from './store';
import { clubView, financeView, fixtureView, liveView, overview, playerView, retentionView, standingsView } from './views';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).then((body) => {
    if (body !== undefined && !res.headersSent) res.json(body);
  }, next);
};

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

const id = z.string().min(1).max(120);

export function apiRouter(db: DB, store: CareerStore) {
  const r = express.Router();

  // ---------------------------------------------------------------- auth
  const authLimit = rateLimit(20, 60_000);
  const creds = z.object({ username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, 'letters, digits, _ . - only'), password: z.string().min(8).max(200) });

  r.post('/auth/register', authLimit, wrap((req, res) => {
    const { username, password } = parse(creds, req.body);
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw new HttpError(409, 'That username is taken.');
    const uid = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(uid, username, hashPassword(password), new Date().toISOString());
    createSession(db, res, uid);
    audit(db, null, uid, 'auth.register');
    return { id: uid, username };
  }));

  r.post('/auth/login', authLimit, wrap((req, res) => {
    const { username, password } = parse(creds, req.body);
    const u = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as { id: string; username: string; password_hash: string } | undefined;
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Wrong username or password.');
    createSession(db, res, u.id);
    return { id: u.id, username: u.username };
  }));

  r.post('/auth/logout', wrap((req, res) => {
    destroySession(db, req, res);
    return { ok: true };
  }));

  r.get('/auth/me', wrap((req) => {
    if (!req.userId) return { user: null };
    const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId) as { id: string; username: string } | undefined;
    return { user: u ?? null };
  }));

  // ---------------------------------------------------------------- static metadata
  r.get('/meta', wrap(() => ({
    leagues: LEAGUES.map((l) => ({ id: l.id, name: l.name, shortName: l.shortName, country: l.country, countryName: COUNTRY_NAMES[l.country], reputation: l.initialReputation, fictional: l.fictional, squadRules: l.squadRules, purse: l.auctionRules.purse, clubs: (CLUB_SEEDS[l.id] ?? []).map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, city: c.city, colors: c.colors, personality: c.personality, brand: c.brand, venueId: c.venueId })) })),
    venues: VENUES.map((v) => ({ id: v.id, name: v.name, city: v.city, country: v.country })),
    fields: BUILT_IN_FIELDS,
    flags: FEATURE_FLAGS,
  })));

  // ---------------------------------------------------------------- careers
  r.use('/careers', requireUser);
  r.get('/careers', wrap((req) => ({ careers: store.list(req.userId!) })));

  const createSchema = z.object({
    managerName: z.string().trim().min(2).max(40),
    difficulty: z.enum(['rookie', 'professional', 'elite', 'legend']),
    seed: z.string().max(64).optional(),
    clubId: z.string().max(8).optional(),
    customClub: z.object({
      name: z.string().max(40), shortName: z.string().max(4), city: z.string().max(40), leagueId: z.string().max(8),
      colors: z.tuple([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)]), venueId: z.string().max(40).optional(),
    }).optional(),
  }).refine((v) => !!v.clubId !== !!v.customClub, 'Choose exactly one: an existing club or a custom club.');

  r.post('/careers', wrap((req) => {
    const body = parse(createSchema, req.body);
    const w = store.create(req.userId!, body);
    return { id: w.careerId };
  }));

  r.delete('/careers/:cid', wrap((req) => {
    store.delete(req.params.cid, req.userId!);
    return { ok: true };
  }));

  // All routes below operate on one career the caller must own.
  const c = express.Router({ mergeParams: true });
  r.use('/careers/:cid', c);
  const world = (req: Request) => store.load(req.params.cid, req.userId!);
  const mutate = async <T>(req: Request, res: Response, action: string, fn: (w: WorldState) => { result: T; records?: { fixtureId: string; state: import('@kurciv/simulation').MatchState }[] }) => {
    const key = req.header('Idempotency-Key') ?? undefined;
    const prior = store.idempotent(req.userId!, key);
    if (prior) {
      res.status(prior.status).json(prior.body);
      return undefined;
    }
    const out = await store.mutate(req.params.cid, req.userId!, action, fn);
    const body = { ok: true, version: out.version, ...((out.result as object) ?? {}) };
    store.remember(req.userId!, key, 200, body);
    return body;
  };

  c.get('/', wrap((req) => {
    const { world: w, version } = world(req);
    return { version, ...overview(w) };
  }));

  c.get('/squad', wrap((req) => {
    const { world: w } = world(req);
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
    };
  }));

  c.get('/players', wrap((req) => {
    const { world: w } = world(req);
    const q = parse(z.object({
      search: z.string().max(60).optional(), role: z.enum(['BAT', 'WK', 'AR', 'BOWL']).optional(), country: z.string().max(4).optional(),
      league: z.string().max(8).optional(), status: z.enum(['all', 'free', 'contracted', 'mine']).optional(),
      sort: z.enum(['ovr', 'age', 'value', 'runs', 'wickets', 'name']).optional(), page: z.coerce.number().int().min(0).max(500).optional(),
    }), req.query);
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

  c.get('/players/:pid', wrap((req) => {
    const { world: w } = world(req);
    const p = w.players[req.params.pid];
    if (!p) throw new HttpError(404, 'Player not found.');
    return playerView(w, p, { detail: true });
  }));

  c.get('/clubs/:clubId', wrap((req) => {
    const { world: w } = world(req);
    const club = w.clubs[req.params.clubId];
    if (!club) throw new HttpError(404, 'Club not found.');
    return { club: clubView(w, club), players: squadOf(w, club).map((p) => playerView(w, p)), fixtures: Object.values(w.fixtures).filter((f) => f.homeId === club.id || f.awayId === club.id).sort((a, b) => a.day - b.day).map((f) => fixtureView(w, f)) };
  }));

  c.get('/leagues/:leagueId', wrap((req) => {
    const { world: w } = world(req);
    const l = LEAGUES.find((x) => x.id === req.params.leagueId);
    if (!l) throw new HttpError(404, 'League not found.');
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

  c.get('/fixtures', wrap((req) => {
    const { world: w } = world(req);
    const mine = req.query.mine === '1';
    return { day: w.day, fixtures: Object.values(w.fixtures).filter((f) => !mine || f.involvesUser).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)) };
  }));

  c.get('/fixtures/:fid', wrap((req) => {
    const { world: w } = world(req);
    const f = w.fixtures[req.params.fid];
    if (!f) throw new HttpError(404, 'Fixture not found (older seasons keep scorecards in History).');
    const record = f.status === 'complete' ? store.getRecord(req.params.cid, req.userId!, f.id) : null;
    return { fixture: fixtureView(w, f), result: f.result, match: record ? liveView(record) : null };
  }));

  c.get('/world', wrap((req) => {
    const { world: w } = world(req);
    const path = qualificationPath(w);
    const total = path.reduce((s, p) => s + p.slots, 0);
    return {
      season: w.season, phase: w.phase,
      leagues: LEAGUES.map((l) => ({ ...w.leagues[l.id], id: l.id, name: l.name, shortName: l.shortName, country: l.country, countryName: COUNTRY_NAMES[l.country], fictional: l.fictional, clubs: clubsInLeague(w, l.id).length, champion: w.competitions[`${l.id}-${w.season}`]?.championId ?? null })),
      qualification: path.map((p) => ({ ...p, clubs: p.clubIds.map((x) => ({ id: x, name: w.clubs[x].name })) })),
      plan: total ? planFormat(total) : null,
    };
  }));

  c.get('/wcc', wrap((req) => {
    const { world: w } = world(req);
    const season = Number(req.query.season ?? w.season);
    const comp = w.competitions[`WCC-${season}`];
    if (!comp) return { competition: null };
    const groups = (comp.meta?.groups ?? {}) as Record<string, string[]>;
    return {
      competition: { id: comp.id, name: comp.name, stage: comp.stage, championId: comp.championId, runnerUpId: comp.runnerUpId, meta: { plan: comp.meta?.plan, host: comp.meta?.host, round: comp.meta?.round, qualifiers: comp.meta?.qualifiers } },
      groups: Object.keys(groups).sort().map((g) => ({ group: g, table: standingsView(w, comp.id, g) })),
      fixtures: Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)),
    };
  }));

  c.get('/news', wrap((req) => ({ news: world(req).world.news })));

  c.get('/history', wrap((req) => {
    const { world: w } = world(req);
    const name = (pid: string) => w.players[pid]?.name ?? pid;
    const rec = w.records;
    return {
      seasons: w.history, awards: w.awards.map((a) => ({ ...a, playerName: name(a.playerId), competition: w.competitions[a.competitionId]?.name ?? a.competitionId })),
      hallOfFame: w.hallOfFame, formerClubs: w.formerClubs.map((f) => ({ ...f, name: w.clubs[f.clubId]?.name })),
      records: {
        highestTeamTotal: rec.highestTeamTotal && { ...rec.highestTeamTotal, club: w.clubs[rec.highestTeamTotal.clubId]?.name },
        lowestTeamTotal: rec.lowestTeamTotal && { ...rec.lowestTeamTotal, club: w.clubs[rec.lowestTeamTotal.clubId]?.name },
        highestScore: rec.highestScore && { ...rec.highestScore, player: name(rec.highestScore.playerId) },
        bestBowling: rec.bestBowling && { ...rec.bestBowling, player: name(rec.bestBowling.playerId) },
        mostCareerRuns: rec.mostCareerRuns && { ...rec.mostCareerRuns, player: name(rec.mostCareerRuns.playerId) },
        mostCareerWickets: rec.mostCareerWickets && { ...rec.mostCareerWickets, player: name(rec.mostCareerWickets.playerId) },
      },
      rivalries: Object.values(w.rivalries).filter((x) => x.clubIds.includes(w.userClubId)).sort((a, b) => b.intensity - a.intensity).slice(0, 10).map((x) => ({ ...x, names: x.clubIds.map((cid) => w.clubs[cid].name) })),
      trophies: w.clubs[w.userClubId].trophies,
      champions: Object.values(w.leagues).flatMap((l) => l.champions.map((ch) => ({ ...ch, leagueId: l.id }))),
    };
  }));

  c.get('/finances', wrap((req) => {
    const { world: w } = world(req);
    const club = w.clubs[w.userClubId];
    const facilities = (['training', 'youth', 'medical', 'scouting'] as const).map((f) => ({ id: f, level: club.facilities[f], upgradeCost: facilityUpgradeCost(w, club.id, f) }));
    return { ...financeView(w), facilities, board: club.board, coaches: club.coaches };
  }));

  c.get('/transfers', wrap((req) => {
    const { world: w } = world(req);
    const club = w.clubs[w.userClubId];
    const name = (pid: string | null) => (pid ? w.clubs[pid]?.shortName ?? pid : '—');
    return {
      window: w.phase === 'preseason' ? 'open' : w.phase === 'season' || w.phase === 'wcc' ? 'replacements' : 'closed',
      ledger: [...w.ledger].reverse().slice(0, 300).map((t) => ({ ...t, player: w.players[t.playerId]?.name ?? t.playerId, from: name(t.fromClubId), to: name(t.toClubId) })),
      freeAgents: freeAgentsFor(w, club).slice(0, 120).map((p) => playerView(w, p)),
      purse: club.purse, squadSize: club.squad.length, rules: leagueById(club.leagueId).squadRules,
    };
  }));

  c.get('/retentions', wrap((req) => retentionView(world(req).world)));

  c.get('/intel/:clubId', wrap((req) => {
    const { world: w } = world(req);
    if (!w.clubs[req.params.clubId]) throw new HttpError(404, 'Club not found.');
    const records = [...store.seasonRecords(req.params.cid, req.userId!, w.season, [req.params.clubId]), ...store.seasonRecords(req.params.cid, req.userId!, w.season - 1, [req.params.clubId])];
    return opponentReport(w, req.params.clubId, records);
  }));

  c.get('/prematch/:fid', wrap((req) => {
    const { world: w } = world(req);
    const fx = w.fixtures[req.params.fid];
    if (!fx?.involvesUser || !fx.homeId || !fx.awayId) throw new HttpError(404, 'Fixture not found.');
    const venue = VENUES.find((v) => v.id === (fx.venueId || w.clubs[fx.homeId].venueId))!;
    const user = w.clubs[w.userClubId];
    const oppId = fx.homeId === user.id ? fx.awayId : fx.homeId;
    const opp = w.clubs[oppId];
    const mine = selectXI(w, user, fx);
    const theirs = selectXI(w, opp, fx);
    const records = [...store.seasonRecords(req.params.cid, req.userId!, w.season, [oppId]), ...store.seasonRecords(req.params.cid, req.userId!, w.season - 1, [oppId])];
    const intel = opponentReport(w, oppId, records);
    const key = [user.id, oppId].sort().join('|');
    return {
      fixture: fixtureView(w, fx), today: fx.day === w.day,
      venue: { name: venue.name, city: venue.city, boundaryStraight: venue.boundaryStraight, boundarySquare: venue.boundarySquare, altitude: venue.altitude, pitch: venue.pitch, dewChance: venue.dewChance },
      user: clubView(w, user), opponent: clubView(w, opp),
      userXI: mine.xi.map((p) => playerView(w, p)), userXINote: mine.note, lineupSaved: !!user.lineup,
      opponentXI: theirs.xi.map((p) => playerView(w, p)),
      intel: { recommendations: intel.recommendations, matches: intel.matches, team: intel.team },
      headToHead: w.rivalries[key] ?? null,
    };
  }));

  // ---------------------------------------------------------------- auction
  c.get('/auction', wrap((req) => {
    const { world: w } = world(req);
    const ids = w.auctionOrder;
    const a = ids.map((x) => w.auctions[x]).find((x) => x.interactive) ?? null;
    const cascade = ids.map((x) => ({ id: x, leagueId: w.auctions[x].leagueId, status: w.auctions[x].status, interactive: w.auctions[x].interactive }));
    if (!a) return { phase: w.phase, cascade, auction: null };
    const pub = publicAuction(a);
    const l = leagueById(a.leagueId);
    const lot = a.status === 'live' ? a.lots[a.currentLotIndex] : null;
    const user = w.clubs[w.userClubId];
    let bidState: { next: number; canBid: boolean; reason: string | null; advice: string | null } | null = null;
    if (lot) {
      const p = w.players[lot.playerId];
      const next = nextBid(l, lot);
      const reg = canRegister(squadOf(w, user), p, l.squadRules, l.domesticCountries);
      const aff = canAfford(user.purse, next, user.squad.length, l.squadRules, l.auctionRules.minBase);
      const leading = lot.bids[lot.bids.length - 1]?.clubId === user.id;
      const val = valuePlayer(w, a, user, p, a.currentLotIndex);
      bidState = {
        next, canBid: reg.ok && aff.ok && !leading && !lot.userOut,
        reason: leading ? 'You hold the highest bid.' : !reg.ok ? reg.reason! : !aff.ok ? aff.reason! : null,
        advice: val.maxBid > 0 ? `Assistant values ${p.name} at up to ₹${val.maxBid.toFixed(2)} Cr for this squad: ${val.reason}.` : `Assistant would not bid: ${val.reason}.`,
      };
    }
    const clubs = clubsInLeague(w, l.id).map((cl) => {
      const sq = squadOf(w, cl);
      const roles = { BAT: 0, WK: 0, AR: 0, BOWL: 0 } as Record<string, number>;
      for (const p of sq) roles[p.role]++;
      return { id: cl.id, shortName: cl.shortName, name: cl.name, colors: cl.colors, purse: cl.purse, squad: sq.length, overseas: sq.filter((p) => isOverseas(p, l.domesticCountries)).length, roles, isUser: cl.isUser, personality: cl.personality };
    });
    return {
      phase: w.phase, cascade, rules: { ...l.squadRules, purse: l.auctionRules.purse, minBase: l.auctionRules.minBase, bidSeconds: l.auctionRules.bidSeconds },
      auction: {
        id: pub.id, leagueId: pub.leagueId, leagueName: l.name, status: pub.status, version: pub.version, currentLotIndex: pub.currentLotIndex, totalLots: pub.lots.length,
        sets: [...new Set(pub.lots.map((x) => x.set))],
        lot: lot ? { ...pub.lots[a.currentLotIndex], player: playerView(w, w.players[lot.playerId], { detail: true }) } : null,
        bidState,
        queue: pub.lots.slice(a.currentLotIndex + 1, a.currentLotIndex + 61).map((x) => ({ lotId: x.id, set: x.set, basePrice: x.basePrice, round: x.round, flagged: !!x.flaggedByUser, proxy: a.userProxy[x.playerId] ?? null, player: playerView(w, w.players[x.playerId]) })),
        recent: pub.lots.filter((x) => x.status === 'sold' || x.status === 'unsold').slice(-40).reverse().map((x) => ({ lotId: x.id, playerId: x.playerId, name: w.players[x.playerId].name, role: w.players[x.playerId].role, status: x.status, price: x.price, soldTo: x.soldTo ? w.clubs[x.soldTo].shortName : null, bids: x.bids.length })),
        notes: pub.notes.slice(-30).reverse().map((n) => ({ ...n, club: w.clubs[n.clubId].shortName, player: w.players[n.playerId].name })),
        log: pub.log.slice(-20),
      },
      clubs,
    };
  }));

  const auctionAction = z.object({
    version: z.number().int(),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('bid') }),
      z.object({ type: z.literal('pass') }),
      z.object({ type: z.literal('proxy'), playerId: id, max: z.number().positive().max(500).nullable() }),
      z.object({ type: z.literal('flag'), playerId: id, flagged: z.boolean() }),
      z.object({ type: z.literal('sim'), until: z.enum(['flagged', 'set', 'end']), assistant: z.boolean() }),
    ]),
  });

  c.post('/auction/act', wrap((req, res) => {
    const body = parse(auctionAction, req.body);
    return mutate(req, res, `auction.${body.action.type}`, (w) => {
      const a = w.auctionOrder.map((x) => w.auctions[x]).find((x) => x.interactive && x.status === 'live');
      if (!a) throw new HttpError(409, 'No live auction.');
      const out = auctionAct(w, a.id, body.action, body.version);
      if (!out.ok) throw new HttpError(out.code === 'VERSION' ? 409 : 400, out.error!, out.code);
      if (a.status === 'complete' && advanceCascade(w)) w.phase = 'preseason';
      return { result: { auctionStatus: a.status, phase: w.phase } };
    });
  }));

  // ---------------------------------------------------------------- phase progression
  c.post('/continue', wrap((req, res) => {
    const { mode } = parse(z.object({ mode: z.enum(['day', 'next', 'season']).default('next') }), req.body ?? {});
    if (store.getLive(req.params.cid, req.userId!, 'main')) throw new HttpError(409, 'Finish your live match first (Match Centre).');
    return mutate<Record<string, unknown>>(req, res, `continue.${mode}`, (w) => {
      switch (w.phase) {
        case 'auction': {
          if (!advanceCascade(w)) throw new HttpError(409, 'Your league’s auction is still live.');
          w.phase = 'preseason';
          return { result: { phase: w.phase, messages: ['All auctions complete. Finalise your squad and start the season.'] } };
        }
        case 'preseason': {
          const problems = startSeason(w);
          if (problems.length) throw new HttpError(400, problems.join(' '));
          return { result: { phase: w.phase, messages: ['The season has begun.'] } };
        }
        case 'season':
        case 'wcc': {
          const out = advance(w, mode);
          return { result: { phase: w.phase, stoppedFor: out.stoppedFor, fixtureId: out.fixtureId, messages: out.messages, simulated: out.records.length }, records: out.records };
        }
        case 'offseason': {
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
  }));

  c.post('/retentions', wrap((req, res) => {
    const { playerIds } = parse(z.object({ playerIds: z.array(id).max(10) }), req.body);
    return mutate(req, res, 'retentions.set', (w) => {
      const err = setUserRetentions(w, playerIds);
      if (err) throw new HttpError(400, err);
      return { result: retentionView(w) };
    });
  }));

  // ---------------------------------------------------------------- squad, tactics, training
  c.post('/lineup', wrap((req, res) => {
    const { playerIds } = parse(z.object({ playerIds: z.array(id).length(11).nullable() }), req.body);
    return mutate(req, res, 'lineup.set', (w) => {
      const club = w.clubs[w.userClubId];
      if (playerIds) {
        const l = leagueById(club.leagueId);
        const v = validateXI(playerIds.map((pid) => w.players[pid]).filter(Boolean), club.squad, l.squadRules, l.domesticCountries);
        if (!v.ok) throw new HttpError(400, v.errors.join(' '));
        club.lineup = playerIds;
        return { result: { warnings: v.warnings } };
      }
      club.lineup = null;
      return { result: { warnings: [] } };
    });
  }));

  const plan = z.object({
    lengths: z.record(z.enum(['yorker', 'full', 'good', 'back', 'short']), z.number().min(0).max(10)),
    lines: z.record(z.enum(['wide', 'off', 'stumps', 'leg']), z.number().min(0).max(10)),
    variation: z.number().min(0).max(1),
    pace: z.enum(['normal', 'slower', 'quicker']),
  });
  const tactics = z.object({
    battingIntent: z.number().min(0).max(1),
    phaseIntent: z.object({ powerplay: z.number().min(0).max(1), middle: z.number().min(0).max(1), death: z.number().min(0).max(1) }),
    bowlingPlan: plan,
    fieldTemplateByPhase: z.object({ powerplay: id, middle: id, death: id }),
    mirrorForLeftHanders: z.boolean(),
    reviewPolicy: z.enum(['conservative', 'balanced', 'aggressive']),
  });
  c.get('/tactics', wrap((req) => {
    const { world: w } = world(req);
    const club = w.clubs[w.userClubId];
    return { tactics: club.defaultTactics, fields: [...BUILT_IN_FIELDS, ...club.fieldTemplates], custom: club.fieldTemplates, dna: club.dna, training: club.training };
  }));
  c.post('/tactics', wrap((req, res) => {
    const t = parse(tactics, req.body);
    return mutate(req, res, 'tactics.set', (w) => {
      const club = w.clubs[w.userClubId];
      const all = [...BUILT_IN_FIELDS, ...club.fieldTemplates].map((f) => f.id);
      for (const fid of Object.values(t.fieldTemplateByPhase)) if (!all.includes(fid)) throw new HttpError(400, `Unknown field template ${fid}.`);
      const pp = [...BUILT_IN_FIELDS, ...club.fieldTemplates].find((f) => f.id === t.fieldTemplateByPhase.powerplay)!;
      const v = validateField(pp.positions, 'R', { powerplay: true, maxOutsidePP: 2, maxOutside: 5 });
      club.defaultTactics = t;
      return { result: { warnings: v.legal ? [] : [`Your powerplay field "${pp.name}" is illegal in the powerplay: ${v.errors.join(' ')} Deliveries would be no-balls.`] } };
    });
  }));

  const point = z.object({ x: z.number().min(-100).max(100), y: z.number().min(-100).max(100) });
  c.post('/fields', wrap((req, res) => {
    const f = parse(z.object({ id: z.string().max(40).optional(), name: z.string().trim().min(1).max(40), positions: z.array(point).length(9), keeperUp: z.boolean(), situation: z.string().max(30).optional() }), req.body);
    return mutate(req, res, 'fields.save', (w) => {
      const club = w.clubs[w.userClubId];
      if (BUILT_IN_FIELDS.some((b) => b.id === f.id)) throw new HttpError(400, 'Built-in fields cannot be overwritten — save under a new name.');
      if (!f.id && club.fieldTemplates.length >= 30) throw new HttpError(400, 'You can save at most 30 custom fields.');
      const tid = f.id ?? `custom-${crypto.randomBytes(4).toString('hex')}`;
      const tpl = { id: tid, name: f.name, positions: f.positions, keeperUp: f.keeperUp, situation: f.situation, builtIn: false };
      const i = club.fieldTemplates.findIndex((x) => x.id === tid);
      if (i >= 0) club.fieldTemplates[i] = tpl;
      else club.fieldTemplates.push(tpl);
      const pp = validateField(f.positions, 'R', { powerplay: true, maxOutsidePP: 2, maxOutside: 5 });
      const other = validateField(f.positions, 'R', { powerplay: false, maxOutsidePP: 2, maxOutside: 5 });
      return { result: { template: tpl, legalInPowerplay: pp.legal, legalOutsidePowerplay: other.legal, errors: other.errors, warnings: [...pp.errors.map((e) => `Powerplay: ${e}`), ...other.warnings] } };
    });
  }));
  c.delete('/fields/:fieldId', wrap((req, res) => mutate(req, res, 'fields.delete', (w) => {
    const club = w.clubs[w.userClubId];
    const used = Object.values(club.defaultTactics.fieldTemplateByPhase).includes(req.params.fieldId);
    if (used) throw new HttpError(400, 'That field is assigned to a phase in your tactics — reassign it first.');
    club.fieldTemplates = club.fieldTemplates.filter((x) => x.id !== req.params.fieldId);
    return { result: {} };
  })));

  const focus = z.enum(['balanced', 'batting', 'pace', 'spin', 'fielding', 'fitness']);
  c.post('/training', wrap((req, res) => {
    const t = parse(z.object({ intensity: z.enum(['light', 'normal', 'intense']), focus, individual: z.record(id, focus) }), req.body);
    return mutate(req, res, 'training.set', (w) => {
      const club = w.clubs[w.userClubId];
      for (const pid of Object.keys(t.individual)) if (!club.squad.includes(pid) && !club.academy.includes(pid)) throw new HttpError(400, 'Individual plans are only for your own players.');
      club.training = t;
      return { result: {} };
    });
  }));

  c.post('/facilities/:facility/upgrade', wrap((req, res) => {
    const facility = parse(z.enum(['training', 'youth', 'medical', 'scouting']), req.params.facility);
    return mutate(req, res, `facility.${facility}`, (w) => {
      const err = upgradeFacility(w, w.userClubId, facility);
      if (err) throw new HttpError(400, err);
      return { result: {} };
    });
  }));

  c.post('/transfers/sign', wrap((req, res) => {
    const { playerId } = parse(z.object({ playerId: id }), req.body);
    return mutate(req, res, 'transfer.sign', (w) => {
      const err = signFreeAgent(w, playerId);
      if (err) throw new HttpError(400, err);
      return { result: {} };
    });
  }));
  c.post('/transfers/release', wrap((req, res) => {
    const { playerId } = parse(z.object({ playerId: id }), req.body);
    return mutate(req, res, 'transfer.release', (w) => {
      const err = releasePlayer(w, playerId);
      if (err) throw new HttpError(400, err);
      return { result: {} };
    });
  }));
  c.post('/transfers/autofill', wrap((req, res) => mutate(req, res, 'transfer.autofill', (w) => {
    if (w.phase !== 'preseason') throw new HttpError(400, 'Auto-fill is available in pre-season.');
    return { result: { signed: autoFillUserSquad(w) } };
  })));

  c.post('/youth/:pid/:action', wrap((req, res) => {
    const action = parse(z.enum(['promote', 'release']), req.params.action);
    return mutate(req, res, `youth.${action}`, (w) => {
      const club = w.clubs[w.userClubId];
      if (!club.academy.includes(req.params.pid)) throw new HttpError(400, 'Player is not in your academy.');
      if (action === 'promote') {
        const err = promoteYouth(w, club, req.params.pid);
        if (err) throw new HttpError(400, err);
      } else releaseYouth(w, club, req.params.pid);
      return { result: {} };
    });
  }));

  c.post('/settings', wrap((req, res) => {
    const s = parse(z.object({ autoPlayUserMatches: z.boolean(), reducedMotion: z.boolean() }), req.body);
    return mutate(req, res, 'settings', (w) => {
      w.settings = s;
      return { result: {} };
    });
  }));

  // ---------------------------------------------------------------- matches
  const xiSchema = z.object({ fixtureId: id, xi: z.array(id).length(11).optional() });

  c.post('/match/quick', wrap((req, res) => {
    const { fixtureId } = parse(xiSchema, req.body);
    if (store.getLive(req.params.cid, req.userId!, 'main')) throw new HttpError(409, 'A live match is in progress.');
    return mutate(req, res, 'match.quick', (w) => {
      const fx = w.fixtures[fixtureId];
      if (!fx?.involvesUser || fx.status !== 'scheduled') throw new HttpError(400, 'That is not your next match.');
      if (fx.day !== w.day) throw new HttpError(400, 'Advance to match day first.');
      const state = simulateMatch(buildMatchSetup(w, fx), matchSeed(w, fx));
      completeUserFixture(w, fx.id, state);
      return { result: { fixture: fixtureView(w, fx) }, records: [{ fixtureId: fx.id, state }] };
    });
  }));

  c.post('/match/start', wrap((req, res) => {
    const { fixtureId, xi } = parse(xiSchema, req.body);
    if (store.getLive(req.params.cid, req.userId!, 'main')) throw new HttpError(409, 'A live match is already in progress.');
    return mutate(req, res, 'match.start', (w) => {
      const fx = w.fixtures[fixtureId];
      if (!fx?.involvesUser || fx.status !== 'scheduled') throw new HttpError(400, 'That is not your next match.');
      if (fx.day !== w.day) throw new HttpError(400, 'Advance to match day first.');
      const club = w.clubs[w.userClubId];
      let userXI = undefined;
      if (xi) {
        const l = leagueById(club.leagueId);
        const players = xi.map((pid) => w.players[pid]).filter(Boolean);
        const v = validateXI(players, club.squad, l.squadRules, l.domesticCountries);
        if (!v.ok) throw new HttpError(400, v.errors.join(' '));
        userXI = players;
      } else userXI = selectXI(w, club, fx).xi;
      const setup = buildMatchSetup(w, fx, userXI);
      const state = createMatch(setup, matchSeed(w, fx));
      const live: LiveMatch = { state, ctlTimeline: [], experimental: false };
      store.putLive(req.params.cid, 'main', fx.id, 1, live, null);
      fx.status = 'live';
      return { result: { fixtureId: fx.id } };
    });
  }));

  const getLive = (req: Request, slot: string) => {
    const live = store.getLive(req.params.cid, req.userId!, slot);
    if (!live) throw new HttpError(404, 'No match in progress.');
    return live;
  };

  for (const slot of ['main', 'lab'] as const) {
    const base = slot === 'main' ? '/match' : '/lab';
    c.get(base, wrap((req) => {
      const live = store.getLive(req.params.cid, req.userId!, slot);
      if (!live) return { live: null };
      return { live: { fixtureId: live.fixtureId, version: live.version, experimental: live.data.experimental, state: liveView(live.data.state, Number(req.query.since ?? 0)) } };
    }));

    c.post(`${base}/step`, wrap((req) => {
      const { mode, version, since } = parse(z.object({ mode: z.enum(['ball', 'over', 'key', 'innings', 'end']), version: z.number().int(), since: z.number().int().min(0).default(0) }), req.body);
      const live = getLive(req, slot);
      if (live.version !== version) throw new HttpError(409, 'The match moved on in another tab.', 'VERSION');
      const { needs } = runSteps(live.data, mode as StepMode);
      store.putLive(req.params.cid, slot, live.fixtureId, version + 1, live.data, version);
      return { version: version + 1, needs, state: liveView(live.data.state, since) };
    }));

    const matchAction: z.ZodType<MatchAction> = z.discriminatedUnion('type', [
      z.object({ type: z.literal('toss'), decision: z.enum(['bat', 'bowl']) }),
      z.object({ type: z.literal('bowler'), playerId: id }),
      z.object({ type: z.literal('field'), positions: z.array(point).length(9), keeperUp: z.boolean(), templateId: z.string().max(40).nullable().optional(), name: z.string().max(40).optional() }),
      z.object({ type: z.literal('plan'), plan }),
      z.object({ type: z.literal('intent'), value: z.number().min(0).max(1).nullable(), batterId: id.optional() }),
      z.object({ type: z.literal('order'), order: z.array(id).max(11) }),
      z.object({ type: z.literal('review'), review: z.boolean() }),
      z.object({ type: z.literal('mirror'), value: z.boolean() }),
    ]) as unknown as z.ZodType<MatchAction>;

    c.post(`${base}/action`, wrap((req) => {
      const { action, version, since } = parse(z.object({ action: matchAction, version: z.number().int(), since: z.number().int().min(0).default(0) }), req.body);
      const live = getLive(req, slot);
      if (live.version !== version) throw new HttpError(409, 'The match moved on in another tab.', 'VERSION');
      const side = live.data.state.setup.userSide;
      if (!side) throw new HttpError(400, 'You are not playing in this match.');
      const res = applyAction(live.data.state, side, action);
      if (!res.ok) throw new HttpError(400, res.error!);
      store.putLive(req.params.cid, slot, live.fixtureId, version + 1, live.data, version);
      return { version: version + 1, warnings: res.warnings ?? [], state: liveView(live.data.state, since) };
    }));
  }

  c.post('/match/finish', wrap((req, res) => {
    const live = getLive(req, 'main');
    if (live.data.state.status !== 'complete') throw new HttpError(400, 'The match is not over yet.');
    return mutate<Record<string, unknown>>(req, res, 'match.finish', (w) => {
      const fx = w.fixtures[live.fixtureId];
      if (fx.status === 'complete') {
        store.deleteLive(req.params.cid, 'main');
        return { result: { fixture: fixtureView(w, fx), duplicate: true } };
      }
      fx.status = 'scheduled';
      completeUserFixture(w, fx.id, live.data.state);
      store.deleteLive(req.params.cid, 'main');
      return { result: { fixture: fixtureView(w, fx) }, records: [{ fixtureId: fx.id, state: live.data.state }] };
    });
  }));

  // Scenario Lab: replay a recorded user match from any delivery with different decisions.
  // Lab matches live in their own slot and are never written to the canonical career.
  c.post('/lab/start', wrap((req) => {
    const { fixtureId, fromSeq } = parse(z.object({ fixtureId: id, fromSeq: z.number().int().min(0) }), req.body);
    const record = store.getRecord(req.params.cid, req.userId!, fixtureId);
    if (!record) throw new HttpError(404, 'No recorded match for that fixture.');
    if (!record.setup.userSide) throw new HttpError(400, 'Scenario Lab replays your own matches.');
    const state = rebuildTo(record, fromSeq, []);
    const live: LiveMatch = { state, ctlTimeline: [], experimental: true };
    store.putLive(req.params.cid, 'lab', fixtureId, 1, live, null);
    return { ok: true, version: 1 };
  }));
  c.delete('/lab', wrap((req) => {
    store.deleteLive(req.params.cid, 'lab');
    return { ok: true };
  }));

  // ---------------------------------------------------------------- errors
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Your career has not been changed.' });
  });
  return r;
}

