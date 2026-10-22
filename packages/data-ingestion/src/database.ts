import type { BowlingType, CountryCode, Hand, Player, Role } from '@kurciv/domain';
import { emptyStatLine, overallFor } from '@kurciv/domain';
import { hash01 } from '@kurciv/simulation';
import raw from '../data/player-db.game.json';
import { CURATED_PLAYERS } from './curated';
import { buildAttributes, expandCurated, shortNameOf } from './players';

/**
 * The Kurciv player database (10,000+ records), built by `npm run ingest` from Cricsheet data
 * (Open Data Commons Attribution License), the curated list and generated players.
 */
export interface DbPlayer {
  id: string;
  kind: 'real' | 'generated';
  name: string;
  gender: 'male' | 'female';
  country: CountryCode | null;
  nationality: 'verified' | 'inferred' | 'unknown' | 'generated';
  status: 'active' | 'stale' | 'generated';
  role: Role;
  batHand: Hand;
  bowlType: BowlingType;
  birthYear: number;
  bat: number;
  bowl: number;
  tags: string[];
  estimates: 'curated' | 'derived' | 'generated';
  record: NonNullable<Player['realWorld']>['record'];
  lastSeen: string | null;
  competitions: string[];
  cricsheetId: string | null;
}

export interface DbSummary {
  total: number;
  real: number;
  activeReal: number;
  activeRealVerifiedNationality: number;
  activeRealInferredNationality: number;
  activeRealUnknownNationality: number;
  activeRealMale: number;
  activeRealFemale: number;
  stale: number;
  curatedMatched: number;
  generated: number;
  matchesRead: number;
  issues: number;
}

const NAT = ['verified', 'inferred', 'unknown', 'generated'] as const;
const STATUS = ['active', 'stale', 'generated'] as const;
const SRC = ['curated', 'derived', 'generated'] as const;

type Row = [string, 0 | 1, string, 0 | 1, string, number, number, Role, Hand, BowlingType, number, number, number, string, number, number[] | 0, string, string, string];

let cache: DbPlayer[] | null = null;

export function playerDatabase(): DbPlayer[] {
  if (cache) return cache;
  cache = (raw.players as unknown as Row[]).map((r) => ({
    id: r[0], kind: r[1] ? 'real' : 'generated', name: r[2], gender: r[3] ? 'female' : 'male', country: (r[4] || null) as CountryCode | null,
    nationality: NAT[r[5]], status: STATUS[r[6]], role: r[7], batHand: r[8], bowlType: r[9], birthYear: r[10], bat: r[11], bowl: r[12],
    tags: r[13] ? r[13].split(' ') : [], estimates: SRC[r[14]],
    record: r[15] ? { matches: r[15][0], runs: r[15][1], balls: r[15][2], outs: r[15][3], fours: r[15][4], sixes: r[15][5], wickets: r[15][6], ballsBowled: r[15][7], runsConceded: r[15][8], catches: r[15][9], stumpings: r[15][10] } : null,
    lastSeen: r[16] || null, competitions: r[17] ? r[17].split('|') : [], cricsheetId: r[18] || null,
  }));
  return cache;
}

export const PLAYER_DB_META: { built: string; source: string; summary: DbSummary } = { built: raw.built, source: raw.source, summary: (raw as unknown as { summary: DbSummary }).summary };

const CURATED_BY_NAME = new Map(CURATED_PLAYERS.map((r) => [r[0], r]));

/** Database record → game player. Curated players expand exactly as before; others are labelled estimates. */
export function playerFromDb(rec: DbPlayer, season: number): Player {
  const realWorld: Player['realWorld'] = rec.kind === 'real'
    ? { nationality: rec.nationality === 'generated' ? 'unknown' : rec.nationality, styles: rec.estimates === 'curated' ? 'curated' : 'estimated', cricsheetId: rec.cricsheetId, lastSeen: rec.lastSeen, competitions: rec.competitions, record: rec.record }
    : undefined;
  const curated = rec.estimates === 'curated' ? CURATED_BY_NAME.get(rec.name) : undefined;
  if (curated) return { ...expandCurated(curated, season), realWorld };
  const country = rec.country ?? 'IND';
  const id = rec.id;
  const jit = (k: string) => hash01(`${id}|${k}`);
  const age = season - rec.birthYear;
  const attrs = buildAttributes(rec.bat, rec.bowl, rec.role, rec.bowlType, rec.tags, age, country, jit);
  const ovr = overallFor(rec.role, attrs, rec.bowlType);
  const growth = age <= 21 ? 6 + jit('pot') * 12 : age <= 24 ? 2 + jit('pot') * 8 : age <= 27 ? jit('pot') * 3 : 0;
  const intl = rec.competitions.includes('International');
  const generated = rec.kind === 'generated';
  return {
    form: 0, fatigue: 0, workload: 0, morale: 65, injury: null, injuryHistory: [], clubId: null, contract: null, isYouth: false, retired: false,
    stats: { career: emptyStatLine(), seasons: {} }, development: [],
    image: { url: null, attribution: null, licence: null, sourceUrl: null, lastChecked: null },
    benchStreak: 0, transferRequest: false,
    id, name: rec.name, shortName: shortNameOf(rec.name), country, birthYear: rec.birthYear, ageConfidence: generated ? 'generated' : 'estimated',
    role: rec.role, batHand: rec.batHand, bowlType: rec.bowlType, capped: intl, source: generated ? 'generated' : 'registry', styleTags: rec.tags, attrs,
    potential: Math.min(95, Math.round(ovr + growth)),
    // Estimated ratings carry more uncertainty than curated ones.
    ratingUncertainty: generated ? 9 : 6.5,
    reputation: Math.round(Math.max(1, Math.min(90, (ovr - 52) * 1.8 + (intl ? 8 : 0) + Math.min(10, (rec.record?.matches ?? 0) / 10)))),
    personality: (['professional', 'ambitious', 'temperamental', 'loyal', 'easygoing'] as const)[Math.floor(jit('pers') * 5)],
    realWorld,
  };
}

