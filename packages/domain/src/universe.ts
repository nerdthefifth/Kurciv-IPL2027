import type { CountryCode } from './countries';
import type { Id, MatchResultSummary, StandingRow } from './types';

/**
 * State of the global cricket universe: the divisional pyramid, continental cups, preseason
 * friendlies and international cricket. Present on pyramid careers only.
 */

export type Region = 'Asia' | 'Europe' | 'Africa' | 'Americas' | 'Oceania';
export type MatchFormat = 'T20' | 'ODI' | 'Test';

export interface PyramidMovement {
  clubId: Id;
  from: Id;
  to: Id;
  kind: 'promoted' | 'relegated';
  /** Final table position in the division the club left. */
  position: number;
  reason: string;
}

export interface PyramidSeason {
  season: number;
  champions: Record<Id, Id>; // divisionId → clubId
  movements: PyramidMovement[];
  /** Division membership at the start of the season. */
  membership: Record<Id, Id[]>;
}

export interface ContinentalCupRecord {
  id: Id; // competition id
  season: number;
  region: Region;
  cup: 'champions' | 'shield';
  championId: Id | null;
  runnerUpId: Id | null;
  finalVenueId: Id | null;
}

export interface ClubCoefficient {
  clubId: Id;
  /** Rolling points from continental and global matches (last three seasons). */
  points: number;
  history: { season: number; points: number }[];
}

export interface FriendlyRequest {
  fixtureId: Id;
  arrangedBy: Id;
  opponentId: Id;
  day: number;
  venueId: Id;
  purpose: 'fitness' | 'selection' | 'tactics' | 'revenue' | 'youth';
  mode: 'play' | 'watch' | 'sim';
}

// ---------------------------------------------------------------- international

export interface NationState {
  id: Id; // `NAT-${country}`
  country: CountryCode;
  name: string;
  /** Full member nations play Tests; associates play ODIs and T20Is. */
  full: boolean;
  region: Region;
  colors: [string, string];
  /** Rating points per format (Elo-style, 1000 = average). */
  rating: Record<MatchFormat, number>;
  managerName: string;
  /** True when the user manages this nation. */
  userManaged: boolean;
  /** Current squads by format (selected before each event). */
  squads: Partial<Record<MatchFormat, Id[]>>;
  captainId: Id | null;
  record: Record<MatchFormat, { played: number; won: number; lost: number; drawn: number; tied: number }>;
  homeVenueIds: Id[];
}

export interface IntlEvent {
  id: Id;
  season: number;
  name: string;
  kind: 'bilateral' | 'tri-series' | 'regional-cup' | 'qualifier' | 'world-cup' | 'test-final';
  format: MatchFormat;
  nationIds: Id[];
  hostCountry: CountryCode | null;
  startDay: number;
  endDay: number;
  status: 'scheduled' | 'live' | 'complete';
  /** Group key → table (tournaments). */
  standings: Record<string, StandingRow[]>;
  stage: 'pending' | 'groups' | 'knockout' | 'complete';
  championId: Id | null;
  runnerUpId: Id | null;
  /** Series score for bilaterals. */
  series?: Record<Id, number>;
  /** Display summary of the format. */
  description: string;
  /** Qualification: which event's results feed this one. */
  feedsInto?: Id;
}

export interface IntlFixture {
  id: Id;
  eventId: Id;
  season: number;
  day: number;
  /** Test matches occupy several days. */
  days: number;
  format: MatchFormat;
  stage: string;
  group?: string;
  homeId: Id; // nation ids
  awayId: Id;
  homeRef?: string;
  awayRef?: string;
  venueId: Id;
  neutral: boolean;
  status: 'scheduled' | 'complete';
  result: MatchResultSummary | null;
  /** The user manages one of the sides. */
  involvesUser: boolean;
}

export interface CallUp {
  playerId: Id;
  nationId: Id;
  eventId: Id;
  fromDay: number;
  toDay: number;
}

export interface InternationalState {
  nations: Record<Id, NationState>;
  events: Record<Id, IntlEvent>;
  fixtures: Record<Id, IntlFixture>;
  callUps: CallUp[];
  /** User's national-team appointment (null = club only). */
  userNationId: Id | null;
  /** Offers the user can accept. */
  offers: { nationId: Id; season: number; expiresDay: number }[];
  history: { season: number; eventId: Id; name: string; format: MatchFormat; championId: Id | null; runnerUpId: Id | null }[];
  rankingsHistory: { season: number; format: MatchFormat; order: Id[] }[];
}

export interface UniverseState {
  /** Configuration snapshot used for this career (pyramid sizes, movement counts). */
  config: { divisions: number; clubsPerDivision: number; promote: number; relegate: number };
  pyramidHistory: PyramidSeason[];
  continental: ContinentalCupRecord[];
  coefficients: Record<Id, ClubCoefficient>;
  friendlies: FriendlyRequest[];
  international: InternationalState;
  /** Season-phase calendar markers (days) for the global calendar view. */
  calendar: { label: string; from: number; to: number; kind: 'auction' | 'preseason' | 'league' | 'continental' | 'global' | 'international' | 'offseason' }[];
}
