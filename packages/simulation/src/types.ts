import type {
  BowlingPlan, BowlingType, CountryCode, FieldPoint, FieldTemplate, Hand, Length, Line, PlayerAttributes, Role, TeamTactics, Venue,
} from '@kurciv/domain';
import type { RngState } from './rng';

export type Side = 'home' | 'away';
export const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** Immutable per-match snapshot of a player (world state is not touched during a match). */
export interface MatchPlayer {
  id: string;
  name: string;
  shortName: string;
  country: CountryCode;
  batHand: Hand;
  bowlType: BowlingType;
  role: Role;
  attrs: PlayerAttributes;
  form: number;
  fatigue: number;
  morale: number;
  tags: string[];
}

export interface TeamSetup {
  clubId: string;
  name: string;
  shortName: string;
  colors: [string, string];
  xi: MatchPlayer[]; // initial batting order
  captainId: string;
  keeperId: string;
  tactics: TeamTactics;
  fields: FieldTemplate[];
  /** 0..1 captaincy/analysis quality (difficulty for AI, assistant quality for the user). */
  tacticalQuality: number;
  /** Season-level scouting of this team's batting vs bowling types, used by the opposition. */
  tendencies?: { vsPace: number; vsSpin: number };
}

export interface MatchRules {
  overs: number;
  powerplayOvers: number;
  maxOutsidePP: number;
  maxOutside: number;
  maxBowlerOvers: number;
  reviews: number;
  superOver: boolean;
}

export const T20_RULES: MatchRules = {
  overs: 20,
  powerplayOvers: 6,
  maxOutsidePP: 2,
  maxOutside: 5,
  maxBowlerOvers: 4,
  reviews: 2,
  superOver: true,
};

export interface MatchSetup {
  fixtureId: string;
  competition: string;
  stage: string;
  home: TeamSetup;
  away: TeamSetup;
  venue: Venue;
  evening: boolean;
  importance: number; // 0..1
  rules: MatchRules;
  userSide: Side | null;
}

export type DismissalKind = 'bowled' | 'lbw' | 'caught' | 'caught behind' | 'stumped' | 'run out';

export interface Dismissal {
  kind: DismissalKind;
  playerOutId: string;
  bowlerId: string | null;
  fielderId: string | null;
  text: string;
}

export interface BatterInnings {
  playerId: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dots: number;
  out: (Dismissal & { seq: number }) | null;
  arrivedAt: number; // legal-ball index when they came in
}

export interface BowlerInnings {
  playerId: string;
  balls: number;
  runs: number;
  wickets: number;
  dots: number;
  wides: number;
  noBalls: number;
  maidens: number;
  fours: number;
  sixes: number;
  spellFatigue: number;
}

export interface FieldSetting {
  templateId: string | null;
  name: string;
  positions: FieldPoint[]; // right-hander orientation
  keeperUp: boolean;
}

export type Contact = 'leave' | 'miss' | 'edge' | 'mistimed' | 'good' | 'middle';

export interface DeliveryEvent {
  seq: number;
  innings: number;
  over: number; // 0-based
  ball: number; // legal balls bowled in the over after this delivery (1..6), or same if illegal
  legal: boolean;
  bowlerId: string;
  strikerId: string;
  nonStrikerId: string;
  length: Length;
  line: Line;
  speed: number;
  variation: string | null;
  quality: 'executed' | 'slight-miss' | 'loose';
  shot: string | null;
  contact: Contact;
  angle: number | null;
  end: FieldPoint | null; // where the ball finished (absolute coordinates)
  aerial: boolean;
  zone: number | null;
  batRuns: number;
  extras: { kind: 'wide' | 'no-ball' | 'bye' | 'leg-bye'; runs: number } | null;
  totalRuns: number;
  boundary: 4 | 6 | null;
  wicket: Dismissal | null;
  fielderId: string | null;
  chance: { kind: 'catch' | 'stumping' | 'run-out'; fielderId: string; taken: boolean; difficulty: 'easy' | 'medium' | 'hard' } | null;
  runsSaved: number;
  freeHit: boolean;
  illegalField: boolean;
  review: { by: 'batting' | 'bowling'; overturned: boolean } | null;
  /** Situational pressure on each player for this ball (0 calm .. 1 extreme) and why. */
  pressure: { batter: number; bowler: number; reasons: string[] };
  umpireNote: string | null;
  scoreAfter: { runs: number; wickets: number };
  winProbHome: number;
  commentary: string;
}

export interface OverSummary {
  innings: number;
  over: number;
  bowlerId: string;
  runs: number;
  wickets: number;
  zoneRuns: number[];
  boundaries: number;
  dots: number;
  singles: number;
  chances: number;
  dropped: number;
  runsSaved: number;
  extras: number;
  fieldName: string;
  analysis: string[];
}

export interface InningsState {
  index: number;
  battingSide: Side;
  bowlingSide: Side;
  superOver: boolean;
  maxBalls: number;
  maxWickets: number;
  target: number | null;
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: { wides: number; noBalls: number; byes: number; legByes: number };
  batters: Record<string, BatterInnings>;
  order: string[]; // full batting order (may be edited for not-yet-batted players)
  strikerId: string;
  nonStrikerId: string;
  bowlers: Record<string, BowlerInnings>;
  currentBowlerId: string | null;
  lastOverBowlerId: string | null;
  queuedBowlerId: string | null;
  overRuns: number[];
  overWickets: number[];
  overs: OverSummary[];
  field: FieldSetting;
  fieldOverridePhase: string | null;
  mirror: boolean;
  plan: BowlingPlan;
  intent: number | null; // team-level manual override
  batterIntent: Record<string, number>;
  reviewsLeft: { batting: number; bowling: number };
  freeHit: boolean;
  fow: { wicket: number; runs: number; balls: number; playerId: string }[];
  partnership: { runs: number; balls: number };
  partnerships: { a: string; b: string; runs: number; balls: number }[];
  complete: boolean;
  /** Observed scoring vs bowling types (for in-match AI adaptation). */
  observed: Record<'pace' | 'spin', { runs: number; balls: number; wickets: number }>;
  zoneRuns: number[];
}

export type Pending =
  | { kind: 'toss'; side: Side }
  | { kind: 'bowler'; side: Side; suggestion: string; eligible: string[] }
  | { kind: 'review'; side: Side; by: 'batting' | 'bowling'; reason: string };

export type MatchAction =
  | { type: 'toss'; decision: 'bat' | 'bowl' }
  | { type: 'bowler'; playerId: string }
  | { type: 'field'; positions: FieldPoint[]; keeperUp: boolean; templateId?: string | null; name?: string }
  | { type: 'plan'; plan: BowlingPlan }
  | { type: 'intent'; value: number | null; batterId?: string }
  | { type: 'order'; order: string[] }
  | { type: 'review'; review: boolean }
  | { type: 'mirror'; value: boolean };

export interface LoggedAction {
  seq: number; // delivery sequence number at the time of the action
  side: Side;
  action: MatchAction;
}

export interface MatchState {
  engineVersion: string;
  seed: string;
  rng: RngState;
  setup: MatchSetup;
  toss: { winner: Side; decision: 'bat' | 'bowl' | null };
  innings: InningsState[];
  status: 'toss' | 'live' | 'complete';
  pending: Pending | null;
  pendingEvent: DeliveryEvent | null;
  pendingMeta: { trueOut: boolean; umpireOut: boolean; perceived: number } | null;
  seq: number;
  deliveries: DeliveryEvent[];
  actions: LoggedAction[];
  result: MatchResult | null;
  dew: boolean;
  /** Seeded per-match form swing for each player (rating points, ±7). */
  dayForm: Record<string, number>;
}

export interface MatchResult {
  winner: Side | null;
  margin: string;
  superOver: boolean;
  playerOfMatch: string | null;
}

export type Controller = 'manual' | 'ai';
export interface Controllers {
  home: Controller;
  away: Controller;
}

/** Decision-making interface implemented by the tactical AI (packages/ai). */
export interface Captain {
  tossDecision(s: MatchState, side: Side): 'bat' | 'bowl';
  chooseBowler(s: MatchState, side: Side): string;
  overStart(s: MatchState, side: Side): { field?: FieldSetting; plan?: BowlingPlan; mirror?: boolean };
  battingIntent(s: MatchState, side: Side, batterId: string): number;
  battingOrder(s: MatchState, side: Side): string[] | null;
  review(s: MatchState, side: Side, ev: DeliveryEvent, perceivedOut: number): boolean;
}
