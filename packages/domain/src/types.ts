// Core domain entities for the Kurciv universe. Everything in a career's world
// state is expressed with these types; the simulation, AI and server all share them.

export type Id = string;

export type Role = 'BAT' | 'WK' | 'AR' | 'BOWL';
export type Hand = 'R' | 'L';
/** RF/RFM/RM = right-arm pace, LF/LFM/LM = left-arm pace, OB off-break, LB leg-break,
 * SLA slow left-arm orthodox, SLC left-arm wrist spin, NONE = does not bowl. */
export type BowlingType = 'RF' | 'RFM' | 'RM' | 'LF' | 'LFM' | 'LM' | 'OB' | 'LB' | 'SLA' | 'SLC' | 'NONE';

export const PACE_TYPES: BowlingType[] = ['RF', 'RFM', 'RM', 'LF', 'LFM', 'LM'];
export const SPIN_TYPES: BowlingType[] = ['OB', 'LB', 'SLA', 'SLC'];
export const isPace = (t: BowlingType) => PACE_TYPES.includes(t);
export const isSpin = (t: BowlingType) => SPIN_TYPES.includes(t);

export type CountryCode =
  | 'IND' | 'AUS' | 'ENG' | 'PAK' | 'SA' | 'NZ' | 'SL' | 'BAN' | 'WI' | 'AFG'
  | 'IRE' | 'ZIM' | 'NED' | 'SCO' | 'USA' | 'NEP' | 'UAE' | 'NAM' | 'OMA' | 'CAN';

/** All attributes use a 0–100 internal scale unless stated otherwise. */
export interface BattingAttributes {
  vsPace: number;
  vsSpin: number;
  power: number;
  rotation: number; // strike rotation / running skill
  defence: number;
  powerplay: number;
  middle: number;
  death: number;
}

export interface BowlingAttributes {
  speed: number; // km/h, typical 80–155
  control: number;
  movement: number; // swing/seam for pace, turn for spin
  variation: number;
  yorker: number;
  slower: number;
  powerplay: number;
  death: number;
  stamina: number;
}

export interface FieldingAttributes {
  catching: number;
  ground: number;
  throwing: number;
  athleticism: number;
  keeping: number;
}

export interface MentalAttributes {
  temperament: number;
  leadership: number;
  adaptability: number;
  workEthic: number;
}

export interface PhysicalAttributes {
  fitness: number;
  durability: number; // high = less injury prone
}

export interface PlayerAttributes {
  bat: BattingAttributes;
  bowl: BowlingAttributes;
  field: FieldingAttributes;
  mental: MentalAttributes;
  phys: PhysicalAttributes;
}

export type PlayerSource = 'curated' | 'generated' | 'youth';

export interface StatLine {
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  notOuts: number;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
  highScore: number;
  ducks: number;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  dots: number;
  bestWkts: number;
  bestRuns: number;
  catches: number;
  stumpings: number;
  runOuts: number;
}

export interface Injury {
  id: Id;
  type: string;
  kind: 'soft-tissue' | 'impact' | 'recurring' | 'workload';
  severity: 'minor' | 'moderate' | 'major';
  sustainedDay: number;
  sustainedSeason: number;
  expectedDaysMin: number;
  expectedDaysMax: number;
  daysRemaining: number;
  reinjuryRisk: number; // 0–1, extra risk once back
}

export interface Contract {
  clubId: Id;
  leagueId: Id;
  salary: number; // crore per season
  startSeason: number;
  endSeason: number; // inclusive
  acquired: 'auction' | 'retention' | 'replacement' | 'youth' | 'free-agent' | 'trade';
  retainedCount: number; // how many times the player has been retained by this club
  rolePromise?: 'key' | 'rotation' | 'squad';
}

export interface PlayerImage {
  url: string | null; // null → silhouette fallback
  attribution: string | null;
  licence: string | null;
  sourceUrl: string | null;
  lastChecked: string | null;
}

export interface DevelopmentSnapshot {
  season: number;
  overall: number;
  bat: number;
  bowl: number;
  potential: number;
  note?: string;
}

export interface Player {
  id: Id;
  name: string;
  shortName: string;
  country: CountryCode;
  birthYear: number;
  ageConfidence: 'curated' | 'estimated' | 'generated';
  role: Role;
  secondaryRole?: Role;
  batHand: Hand;
  bowlType: BowlingType;
  capped: boolean;
  source: PlayerSource;
  styleTags: string[];
  attrs: PlayerAttributes;
  /** Hidden "true" ceiling. The UI only shows a scouted range. */
  potential: number;
  /** Width of the uncertainty band on ratings (0 = certain). */
  ratingUncertainty: number;
  reputation: number; // public profile / star power
  form: number; // −10..+10, shrinks toward 0
  fatigue: number; // 0 fresh .. 100 exhausted
  workload: number; // rolling bowling load (balls, decayed)
  morale: number; // 0..100
  injury: Injury | null;
  injuryHistory: { season: number; type: string; days: number }[];
  clubId: Id | null;
  contract: Contract | null;
  isYouth: boolean; // in an academy, not registered
  retired: boolean;
  stats: { career: StatLine; seasons: Record<string, StatLine> }; // key `${season}:${competitionId}`
  development: DevelopmentSnapshot[];
  image: PlayerImage;
  personality: 'professional' | 'ambitious' | 'temperamental' | 'loyal' | 'easygoing';
  benchStreak: number;
  transferRequest: boolean;
}

export type AuctionPersonality =
  | 'youth-builder'
  | 'star-commercial'
  | 'value-hunter'
  | 'spin-tactician'
  | 'pace-first'
  | 'aggressive-contender'
  | 'conservative'
  | 'rebuilding';

export interface Facilities {
  training: number; // 1..5
  youth: number;
  medical: number;
  scouting: number;
}

export interface Coach {
  name: string;
  role: 'head' | 'batting' | 'bowling' | 'fielding';
  rating: number; // 0..100
  salary: number;
}

export interface FinancialTransaction {
  id: Id;
  season: number;
  day: number;
  category:
    | 'auction'
    | 'retention'
    | 'salary'
    | 'sponsorship'
    | 'tickets'
    | 'prize'
    | 'broadcast'
    | 'facility'
    | 'staff'
    | 'medical'
    | 'youth'
    | 'merchandise'
    | 'board';
  amount: number; // + income, − expense (crore)
  memo: string;
}

export interface BoardState {
  confidence: number; // 0..100
  objectives: BoardObjective[];
  warnings: number;
}

export interface BoardObjective {
  id: Id;
  description: string;
  kind: 'league-position' | 'playoffs' | 'title' | 'youth-debuts' | 'finance' | 'wcc-qualify';
  target: number;
  importance: 'low' | 'medium' | 'high';
  status: 'pending' | 'met' | 'failed';
}

export interface TacticalDNA {
  aggression: number; // 0..100
  spinReliance: number;
  paceReliance: number;
  youthTrust: number;
  fieldAttack: number;
  samples: number;
}

export interface Club {
  id: Id;
  name: string;
  shortName: string;
  city: string;
  country: CountryCode;
  leagueId: Id;
  venueId: Id;
  colors: [string, string];
  personality: AuctionPersonality;
  isUser: boolean;
  isCustom: boolean;
  squad: Id[];
  academy: Id[];
  purse: number; // auction purse remaining for the current window (crore)
  cash: number; // operating cash reserves (crore)
  brand: number; // 0..100
  fanBase: number; // 0..100
  elo: number;
  facilities: Facilities;
  coaches: Coach[];
  board: BoardState;
  dna: TacticalDNA;
  trophies: { season: number; competitionId: Id; name: string }[];
  fieldTemplates: FieldTemplate[];
  defaultTactics: TeamTactics;
  retentionsLocked: boolean;
  /** Ids of players the club has flagged as retained for the upcoming season. */
  retentionChoices: Id[];
}

// ---------------------------------------------------------------- fields

export interface FieldPoint {
  /** Metres. Origin = centre of pitch. +y towards bowler's end, +x = off side for a right-hander. */
  x: number;
  y: number;
}

export interface FieldTemplate {
  id: Id;
  name: string;
  /** Nine outfielders (keeper and bowler are implicit). Coordinates in right-hander orientation. */
  positions: FieldPoint[];
  keeperUp: boolean;
  situation?: string;
  builtIn?: boolean;
}

// ---------------------------------------------------------------- tactics

export type Length = 'yorker' | 'full' | 'good' | 'back' | 'short';
export type Line = 'wide' | 'off' | 'stumps' | 'leg';

export interface BowlingPlan {
  /** Relative preferences, normalised by the engine. */
  lengths: Partial<Record<Length, number>>;
  lines: Partial<Record<Line, number>>;
  variation: number; // 0..1 how often to use variations
  pace: 'normal' | 'slower' | 'quicker';
}

export interface TeamTactics {
  battingIntent: number; // 0 (block) .. 1 (all-out)
  phaseIntent: { powerplay: number; middle: number; death: number };
  bowlingPlan: BowlingPlan;
  fieldTemplateByPhase: { powerplay: Id; middle: Id; death: Id };
  mirrorForLeftHanders: boolean;
  reviewPolicy: 'conservative' | 'balanced' | 'aggressive';
}

// ---------------------------------------------------------------- leagues & competitions

export type PlayoffFormat = 'ipl4' | 'semis' | 'final2' | 'none';

export interface SquadRules {
  maxSquad: number;
  minSquad: number;
  maxOverseas: number;
  maxPerOverseasCountry: number;
  maxOverseasInXI: number;
  maxRetentions: number;
  retentionCosts: number[]; // crore per retention slot (capped players)
  uncappedRetentionCost: number;
}

export interface AuctionRules {
  purse: number;
  minBase: number;
  increments: { upTo: number; step: number }[];
  unsoldRound: boolean;
  bidSeconds: number;
}

export interface LeagueConfig {
  id: Id;
  name: string;
  shortName: string;
  country: CountryCode;
  region: 'Asia' | 'Oceania' | 'Europe' | 'Africa' | 'Americas';
  initialReputation: number;
  commercialValue: number; // 0..100
  audience: number; // 0..100
  fictional: boolean;
  format: 'T20';
  rounds: 1 | 2;
  playoffs: PlayoffFormat;
  squadRules: SquadRules;
  auctionRules: AuctionRules;
  /** Countries treated as domestic for registration. */
  domesticCountries: CountryCode[];
  seasonStartDay: number;
  prizeMoney: { champion: number; runnerUp: number; playoff: number };
}

export interface LeagueState {
  id: Id;
  reputation: number;
  wccSlots: number;
  reputationHistory: { season: number; reputation: number; delta: number; reason: string }[];
  champions: { season: number; clubId: Id; clubName: string }[];
}

export interface Venue {
  id: Id;
  name: string;
  city: string;
  country: CountryCode;
  boundaryStraight: number; // metres from pitch centre
  boundarySquare: number;
  altitude: number; // metres
  pitch: PitchProfile;
  dewChance: number; // 0..1 for evening matches
}

export interface PitchProfile {
  kind: 'flat' | 'green' | 'dry' | 'slow' | 'balanced';
  pace: number; // −1..1 assistance for seamers
  spin: number; // −1..1 assistance for spinners
  bounce: number; // −1..1
  batting: number; // −1..1 ease of scoring
  wear: number; // 0..1 deterioration per innings
}

export interface StandingRow {
  clubId: Id;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  runsFor: number;
  oversFor: number; // in balls
  runsAgainst: number;
  oversAgainst: number; // in balls
  form: ('W' | 'L' | 'T')[];
}

export type CompetitionKind = 'league' | 'wcc';

export interface Competition {
  id: Id; // e.g. "IPL-2027" or "WCC-2027"
  kind: CompetitionKind;
  leagueId: Id | null;
  season: number;
  name: string;
  clubIds: Id[];
  standings: Record<string, StandingRow[]>; // group key → rows ("main" for leagues)
  stage: 'pending' | 'league' | 'playoffs' | 'complete';
  championId: Id | null;
  runnerUpId: Id | null;
  /** WCC: path & seeding info for display. */
  meta?: Record<string, unknown>;
}

export interface InningsSummary {
  battingClubId: Id;
  runs: number;
  wickets: number;
  balls: number;
  extras: number;
  batting: { playerId: Id; runs: number; balls: number; fours: number; sixes: number; out: string | null }[];
  bowling: { playerId: Id; balls: number; runs: number; wickets: number; dots: number; wides: number; noBalls: number }[];
  fow: { wicket: number; runs: number; ball: number; playerId: Id }[];
}

export interface MatchResultSummary {
  winnerId: Id | null;
  margin: string;
  tossWinnerId: Id;
  tossDecision: 'bat' | 'bowl';
  innings: InningsSummary[];
  playerOfMatch: Id | null;
  seed: string;
  engineVersion: string;
  superOver?: boolean;
}

export interface Fixture {
  id: Id;
  competitionId: Id;
  season: number;
  day: number;
  stage: string; // "League", "Qualifier 1", "Group A", ...
  group?: string;
  homeId: Id;
  awayId: Id;
  venueId: Id;
  /** For knockouts generated later: references to resolve, e.g. "winner:fx-12". */
  homeRef?: string;
  awayRef?: string;
  status: 'scheduled' | 'live' | 'complete';
  result: MatchResultSummary | null;
  involvesUser: boolean;
}

// ---------------------------------------------------------------- auctions

export type LotStatus = 'pending' | 'live' | 'sold' | 'unsold' | 'withdrawn';

export interface AuctionBid {
  clubId: Id;
  amount: number;
  at: number; // sequence
  proxy?: boolean;
}

export interface AuctionLot {
  id: Id;
  playerId: Id;
  set: string;
  basePrice: number;
  status: LotStatus;
  bids: AuctionBid[];
  soldTo: Id | null;
  price: number | null;
  round: 1 | 2;
  flaggedByUser?: boolean;
}

export interface AiDecisionNote {
  clubId: Id;
  playerId: Id;
  lotId: Id;
  valuation: number;
  maxBid: number;
  reason: string;
}

export interface AuctionState {
  id: Id;
  leagueId: Id;
  season: number;
  order: number; // position in the global cascade
  status: 'pending' | 'live' | 'complete';
  lots: AuctionLot[];
  currentLotIndex: number;
  version: number;
  userProxy: Record<string, number>; // lotId → max proxy bid
  notes: AiDecisionNote[];
  log: string[];
  interactive: boolean;
}

// ---------------------------------------------------------------- ledgers, news, history

export interface TransferLedgerEntry {
  id: Id;
  season: number;
  day: number;
  playerId: Id;
  fromClubId: Id | null;
  toClubId: Id | null;
  kind: 'auction' | 'retention' | 'release' | 'replacement' | 'youth-promotion' | 'free-agent' | 'retirement' | 'unsold';
  fee: number;
  note: string;
}

export interface NewsItem {
  id: Id;
  season: number;
  day: number;
  kind:
    | 'result'
    | 'upset'
    | 'injury'
    | 'auction'
    | 'youth'
    | 'reputation'
    | 'qualification'
    | 'award'
    | 'board'
    | 'morale'
    | 'milestone'
    | 'retirement'
    | 'rivalry';
  headline: string;
  body: string;
  clubIds: Id[];
  playerIds: Id[];
  /** The domain event this headline is generated from (fixture id, ledger id, ...). */
  sourceRef: string;
  importance: 1 | 2 | 3;
}

export interface SeasonAward {
  season: number;
  competitionId: Id;
  award: 'Orange Cap' | 'Purple Cap' | 'MVP' | 'Emerging Player' | 'Best Fielder';
  playerId: Id;
  value: string;
}

export interface SeasonHistory {
  season: number;
  champions: { competitionId: Id; name: string; clubId: Id; clubName: string; runnerUpName: string }[];
  userClub: { clubId: Id; competitionId: Id; position: number; played: number; won: number; result: string };
  awards: SeasonAward[];
  reputations: Record<Id, number>;
  wccSlots: Record<Id, number>;
}

export interface HallOfFameEntry {
  id: Id;
  season: number;
  kind: 'record' | 'upset' | 'dynasty' | 'legend' | 'milestone';
  title: string;
  detail: string;
  refs: string[];
}

export interface RecordBook {
  highestTeamTotal: { runs: number; clubId: Id; fixtureId: Id; season: number } | null;
  lowestTeamTotal: { runs: number; clubId: Id; fixtureId: Id; season: number } | null;
  highestScore: { runs: number; balls: number; playerId: Id; fixtureId: Id; season: number } | null;
  bestBowling: { wickets: number; runs: number; playerId: Id; fixtureId: Id; season: number } | null;
  mostCareerRuns: { runs: number; playerId: Id } | null;
  mostCareerWickets: { wickets: number; playerId: Id } | null;
}

export type SeasonPhase = 'retention' | 'auction' | 'preseason' | 'season' | 'wcc' | 'offseason';
export type Difficulty = 'rookie' | 'professional' | 'elite' | 'legend';

export interface Rivalry {
  key: string; // sorted club ids
  clubIds: [Id, Id];
  meetings: number;
  knockoutMeetings: number;
  finals: number;
  intensity: number; // 0..100
  record: Record<Id, number>;
}

export interface WorldState {
  schemaVersion: number;
  careerId: Id;
  seed: string;
  managerName: string;
  difficulty: Difficulty;
  season: number;
  day: number;
  phase: SeasonPhase;
  userClubId: Id;
  formerClubs: { clubId: Id; from: number; to: number }[];
  leagues: Record<Id, LeagueState>;
  clubs: Record<Id, Club>;
  players: Record<Id, Player>;
  competitions: Record<Id, Competition>;
  fixtures: Record<Id, Fixture>;
  auctions: Record<Id, AuctionState>;
  auctionOrder: Id[];
  ledger: TransferLedgerEntry[];
  finances: Record<Id, FinancialTransaction[]>; // clubId → current + previous season
  news: NewsItem[];
  history: SeasonHistory[];
  awards: SeasonAward[];
  hallOfFame: HallOfFameEntry[];
  records: RecordBook;
  rivalries: Record<string, Rivalry>;
  freeAgents: Id[];
  counter: number;
  settings: {
    autoPlayUserMatches: boolean;
    reducedMotion: boolean;
  };
  /** Per-season tactical observations used by AI to counter the user. */
  scouting: { userBattingVsPace: number[]; userBattingVsSpin: number[] };
  pendingDecisions: string[];
}
