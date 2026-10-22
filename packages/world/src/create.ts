import type { Club, Coach, CountryCode, Difficulty, Player, WorldState } from '@kurciv/domain';
import { emptyStatLine } from '@kurciv/domain';
import { CLUB_SEEDS, LEAGUES, VENUES, WORLD, leagueById } from '@kurciv/config';
import { CURATED_PLAYERS, expandCurated, generatePlayer, playerDatabase, playerFromDb } from '@kurciv/data-ingestion';
import { Rng } from '@kurciv/simulation';
import { defaultTactics } from '@kurciv/ai';
import { advanceCascade, setupAuctions } from './auction';
import { roleDemand } from './auction-live';
import { addTimeline, storyAuctionEve } from './story';
import { emptyClubWorld } from './clubworld/core';
import { primeClubWorld } from './clubworld/sync';
import { addNews } from './util';

/** Typical depth of domestic T20 talent by country (mean overall of a generated pro). */
export const COUNTRY_DEPTH: Partial<Record<CountryCode, number>> = {
  IND: 61, AUS: 61, ENG: 60, SA: 59, PAK: 59, NZ: 57, WI: 57, SL: 56, BAN: 55, AFG: 56, UAE: 49, USA: 51, OMA: 47, CAN: 47,
  IRE: 52, SCO: 50, NED: 51, ZIM: 52, NEP: 51, NAM: 50,
};

/** Depth for any nation (associates without a listed value are shallow). */
export const depthOf = (c: CountryCode) => COUNTRY_DEPTH[c] ?? 45;

export interface CustomClubInput {
  name: string;
  shortName: string;
  city: string;
  leagueId: string;
  colors: [string, string];
  venueId?: string;
}

export interface CreateCareerInput {
  careerId: string;
  seed: string;
  managerName: string;
  difficulty: Difficulty;
  clubId?: string;
  customClub?: CustomClubInput;
}

const COACH_NAMES = ['R. Menon', 'D. Fleming', 'A. Kumble', 'T. Moody', 'M. Boucher', 'S. Bond', 'P. Upton', 'L. Klusener', 'J. Lewis', 'K. Sangakkara', 'B. McCullum', 'A. Flower', 'R. Ponting', 'C. Silverwood', 'G. Kirsten', 'D. Vettori', 'M. Hussey', 'S. Pollock', 'N. Hussain', 'W. Akram'];

/** Staff salaries scale with the league economy (purse) so a club pays exactly what is listed. */
function coachesFor(rng: Rng, brand: number, purseScale: number): Coach[] {
  const base = 48 + brand * 0.3;
  const mk = (role: Coach['role']): Coach => {
    const rating = Math.round(Math.max(35, Math.min(92, rng.normal(base, 7))));
    // Fictional staff: initials + a surname pool, never presented as real people's records.
    const name = `${String.fromCharCode(65 + rng.int(0, 25))}. ${rng.pick(COACH_NAMES).split(' ')[1]}`;
    return { name, role, rating, salary: Math.round(rating * 0.04 * (purseScale * 0.9 + 0.1) * 100) / 100 };
  };
  return [mk('head'), mk('batting'), mk('bowling'), mk('fielding')];
}

export function validateCustomClub(input: CustomClubInput, existing: Club[]): string | null {
  const name = input.name.trim();
  const short = input.shortName.trim().toUpperCase();
  if (name.length < 3 || name.length > 40) return 'Club name must be 3–40 characters.';
  if (!/^[A-Z]{2,4}$/.test(short)) return 'Short name must be 2–4 letters.';
  if (!LEAGUES.some((l) => l.id === input.leagueId)) return 'Unknown league.';
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) return `A club called "${name}" already exists.`;
  if (existing.some((c) => c.shortName === short || c.id === short)) return `The code ${short} is already used by another club.`;
  if (input.venueId) {
    const v = VENUES.find((x) => x.id === input.venueId);
    if (!v || v.country !== leagueById(input.leagueId).country) return 'Home ground must be in the league’s country.';
  }
  return null;
}

function makeClub(seed: (typeof CLUB_SEEDS)[string][number], leagueId: string, rng: Rng, isUser: boolean, isCustom: boolean): Club {
  const league = leagueById(leagueId);
  const fac = (b: number) => Math.max(1, Math.min(5, Math.round(1 + b / 25 + rng.range(-0.6, 0.6))));
  return {
    id: seed.id, name: seed.name, shortName: seed.shortName, city: seed.city, country: league.country, leagueId, venueId: seed.venueId,
    colors: seed.colors, personality: seed.personality, isUser, isCustom, squad: [], academy: [], purse: league.auctionRules.purse,
    cash: Math.round((10 + seed.brand * 0.35 * (league.commercialValue / 80)) * 100) / 100,
    brand: seed.brand, fanBase: Math.round(seed.brand * 0.9 + rng.range(0, 10)), elo: 1500 + (league.initialReputation - 70) * 6,
    facilities: { training: fac(seed.brand), youth: fac(seed.brand - 5), medical: fac(seed.brand), scouting: fac(seed.brand - 5) },
    coaches: coachesFor(rng, seed.brand, league.auctionRules.purse / 120),
    board: { confidence: 60, objectives: [], warnings: 0 },
    dna: { aggression: 50, spinReliance: 50, paceReliance: 50, youthTrust: 50, fieldAttack: 50, samples: 0 },
    trophies: [], fieldTemplates: [], defaultTactics: defaultTactics(), retentionsLocked: false, retentionChoices: [],
    training: { intensity: 'normal', focus: 'balanced', individual: {} }, lineup: null,
  };
}

export function createWorld(input: CreateCareerInput): WorldState {
  const rng = Rng.from(`world|${input.seed}`);
  const season = WORLD.startSeason;
  const w: WorldState = {
    schemaVersion: WORLD.schemaVersion, careerId: input.careerId, seed: input.seed, managerName: input.managerName, difficulty: input.difficulty,
    season, day: 30, phase: 'auction', userClubId: '', formerClubs: [], leagues: {}, clubs: {}, players: {}, competitions: {}, fixtures: {},
    auctions: {}, auctionOrder: [], ledger: [], finances: {}, news: [], history: [], awards: [], hallOfFame: [],
    records: { highestTeamTotal: null, lowestTeamTotal: null, highestScore: null, bestBowling: null, mostCareerRuns: null, mostCareerWickets: null },
    rivalries: {}, freeAgents: [], counter: 0, settings: { autoPlayUserMatches: false, reducedMotion: false },
    scouting: { userBattingVsPace: [], userBattingVsSpin: [] }, pendingDecisions: [],
    stories: [], timeline: [], chronicles: [], storyKeys: {}, appearances: {}, matchImpacts: {}, clubWorld: emptyClubWorld(),
  };

  for (const l of LEAGUES) {
    w.leagues[l.id] = { id: l.id, reputation: l.initialReputation, wccSlots: 0, reputationHistory: [{ season, reputation: l.initialReputation, delta: 0, reason: 'Initial 2027 seeding' }], champions: [] };
    for (const seed of CLUB_SEEDS[l.id] ?? []) {
      const club = makeClub(seed, l.id, rng, false, false);
      w.clubs[club.id] = club;
      w.finances[club.id] = [];
    }
  }

  if (input.customClub) {
    const err = validateCustomClub(input.customClub, Object.values(w.clubs));
    if (err) throw new Error(err);
    const l = leagueById(input.customClub.leagueId);
    const venue = input.customClub.venueId ?? CLUB_SEEDS[l.id][0].venueId;
    const short = input.customClub.shortName.trim().toUpperCase();
    const club = makeClub(
      { id: short, name: input.customClub.name.trim(), shortName: short, city: input.customClub.city.trim() || l.country, venueId: venue, colors: input.customClub.colors, personality: 'value-hunter', brand: 40 },
      l.id, rng, true, true,
    );
    w.clubs[club.id] = club;
    w.finances[club.id] = [];
    w.userClubId = club.id;
  } else {
    const club = input.clubId ? w.clubs[input.clubId] : undefined;
    if (!club) throw new Error('Choose an existing club or create a custom one.');
    club.isUser = true;
    w.userClubId = club.id;
  }

  // ---------------- players: curated real identities + clearly-labelled generated pros
  // The player database: curated real players, real players from the licensed Cricsheet data
  // (estimated ratings, clearly labelled) and generated players. The game's competitions are
  // men's competitions, and registration needs a known nationality.
  for (const rec of playerDatabase()) {
    if (rec.gender !== 'male') continue;
    if (rec.kind === 'real' && rec.estimates !== 'curated' && (rec.status !== 'active' || !rec.country || rec.nationality === 'unknown')) continue;
    const p = playerFromDb(rec, season);
    w.players[p.id] = p;
  }
  for (const row of CURATED_PLAYERS) {
    // Curated players are always present (a few are outside the database's match window).
    const p = expandCurated(row, season);
    w.players[p.id] ??= p;
  }
  let serial = 0;
  const curatedBy = (c: CountryCode) => Object.values(w.players).filter((p) => p.country === c).length;
  const generateFor = (country: CountryCode, count: number) => {
    const g = rng.fork(`gen-${country}`);
    for (let i = 0; i < count; i++) {
      const age = Math.round(Math.max(18, Math.min(36, g.normal(26, 4))));
      const p = generatePlayer(g, { country, quality: depthOf(country), age, season }, ++serial);
      w.players[p.id] = p;
    }
  };
  for (const l of LEAGUES) {
    const clubs = Object.values(w.clubs).filter((c) => c.leagueId === l.id).length;
    const main = l.domesticCountries[0];
    const need = Math.ceil(clubs * (l.squadRules.maxSquad - Math.min(l.squadRules.maxOverseas, 5)) * 1.3);
    const have = l.id === 'IPL' ? curatedBy('IND') : Math.round(curatedBy(main) * 0.35);
    generateFor(main, Math.max(20, need - have));
    for (const extra of l.domesticCountries.slice(1)) generateFor(extra, 14);
  }
  for (const c of ['AFG', 'ZIM', 'NED', 'NEP', 'IRE', 'SCO', 'NAM'] as CountryCode[]) generateFor(c, 10);

  setupAuctions(w);
  // Higher-tier auctions run instantly; the user's own league auction opens live.
  if (advanceCascade(w)) w.phase = 'preseason';
  const userClubRef = w.clubs[w.userClubId];
  addTimeline(w, 'season', `${w.managerName} takes charge of ${userClubRef.name}`, `The ${season} season begins with the ${leagueById(userClubRef.leagueId).name} auction.`);
  const ua = Object.values(w.auctions).find((a) => a.interactive);
  if (ua && ua.status === 'live') storyAuctionEve(w, roleDemand(w, ua));
  addNews(w, {
    kind: 'auction',
    headline: `${season} season opens with a global auction cascade`,
    body: `${w.auctionOrder.length} leagues will auction in order of reputation, starting with the ${leagueById(w.auctionOrder.map((a) => w.auctions[a].leagueId)[0]).name}.`,
    clubIds: [], playerIds: [], sourceRef: 'season-start', importance: 2,
  });
  primeClubWorld(w);
  return w;
}

export { emptyStatLine };
export type { Player };
