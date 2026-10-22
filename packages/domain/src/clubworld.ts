/**
 * The Club World: one event log that every downstream system (inbox, news, player
 * conversations, promises, boardroom, media and the in-game social feed) reacts to.
 * Everything here is fictional in-game content generated from recorded simulation events.
 */

export type WorldEventType =
  | 'SEASON_STARTED'
  | 'MATCH_UPCOMING'
  | 'MATCH_COMPLETED'
  | 'PLAYER_SELECTED'
  | 'PLAYER_DROPPED'
  | 'PLAYER_INJURED'
  | 'PLAYER_RECOVERED'
  | 'PLAYER_MILESTONE_REACHED'
  | 'PLAYER_CONCERN_RAISED'
  | 'PROMISE_MADE'
  | 'PROMISE_FULFILLED'
  | 'PROMISE_BROKEN'
  | 'PROMISE_VOIDED'
  | 'CONTRACT_SIGNED'
  | 'PLAYER_ACQUIRED'
  | 'PLAYER_RELEASED'
  | 'PLAYER_RETIRED'
  | 'AUCTION_COMPLETED'
  | 'BOARD_OBJECTIVE_UPDATED'
  | 'BOARD_CONFIDENCE_CHANGED'
  | 'CLUB_QUALIFIED'
  | 'MANAGER_APPOINTED'
  | 'MANAGER_DISMISSED'
  | 'LOSING_STREAK'
  | 'RUMOUR_PUBLISHED'
  | 'RUMOUR_RESOLVED'
  | 'MEDIA_STATEMENT'
  | 'DISCIPLINARY_INCIDENT';

export interface GameDate {
  season: number;
  day: number;
}

export interface EntityRefs {
  playerIds: string[];
  clubIds: string[];
  fixtureId?: string;
  competitionId?: string;
}

export interface WorldEvent {
  id: string;
  type: WorldEventType;
  season: number;
  day: number;
  /** Idempotency key: the same key never produces a second event. */
  key: string;
  /** Provenance: the simulation record this event was read from (fixture, ledger entry, injury, conversation…). */
  source: string;
  refs: EntityRefs;
  data: Record<string, unknown>;
  importance: 1 | 2 | 3;
}

export type InboxCategory = 'board' | 'player' | 'coaching' | 'medical' | 'contracts' | 'auction' | 'match' | 'media' | 'discipline' | 'competition' | 'news';

export interface InboxOption {
  id: string;
  label: string;
  hint?: string;
}

export interface InboxMessage {
  id: string;
  eventId: string | null;
  season: number;
  /** In-game day the message arrives (it is hidden until the calendar reaches it). */
  day: number;
  from: { name: string; role: string };
  subject: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: InboxCategory;
  read: boolean;
  archived: boolean;
  pinned: boolean;
  refs: EntityRefs;
  links: { label: string; page: string }[];
  response?: {
    /** Which resolver handles the choice (board-warning, media-request, discipline, promise-at-risk, story…). */
    kind: string;
    required: boolean;
    deadline: GameDate | null;
    options: InboxOption[];
    payload?: Record<string, string>;
    chosen?: string;
    outcome?: string;
  };
  storyId?: string;
  conversationId?: string;
}

export type ConversationTopic =
  | 'playing-time'
  | 'dropped'
  | 'batting-position'
  | 'workload'
  | 'form'
  | 'contract'
  | 'broken-promise'
  | 'team-morale'
  | 'praise'
  | 'development';

export type ResponseTone = 'reassure' | 'explain' | 'promise' | 'compromise' | 'challenge' | 'praise' | 'decline';

export type PromiseKind = 'start-next' | 'start-two-of-three' | 'open-batting' | 'top-order' | 'rest-next' | 'retain' | 'board-results';

export interface ConversationOption {
  id: string;
  label: string;
  tone: ResponseTone;
  promise?: PromiseKind;
  hint: string;
}

export interface Conversation {
  id: string;
  playerId: string;
  topic: ConversationTopic;
  eventId: string;
  season: number;
  day: number;
  status: 'open' | 'resolved' | 'expired';
  deadline: GameDate;
  lines: { from: 'player' | 'manager' | 'note'; text: string; season: number; day: number }[];
  options: ConversationOption[];
  chosen?: string;
  outcome?: string;
}

export interface PlayerRelation {
  playerId: string;
  /** 0..100: how much the player believes what the manager tells them. */
  trust: number;
  ambition: number;
  professionalism: number;
  loyalty: number;
  confidence: number;
  history: { season: number; day: number; topic: ConversationTopic | 'promise'; response: string; outcome: string }[];
  lastTalk: GameDate | null;
}

export interface ManagerPromise {
  id: string;
  to: { kind: 'player' | 'board'; id: string };
  kind: PromiseKind;
  /** The commitment in the manager's exact words. */
  text: string;
  made: GameDate;
  conversationId: string | null;
  eventId: string;
  /** Evaluated over the user's next `matches` completed matches (null: by deadline / window). */
  matches: number | null;
  /** How many of those matches must satisfy the condition. */
  target: number;
  deadline: GameDate | null;
  progress: { seen: number; satisfied: number; fixtureIds: string[] };
  status: 'active' | 'fulfilled' | 'broken' | 'void';
  resolved?: GameDate & { note: string };
  reminded?: boolean;
}

export interface BoardProfile {
  clubId: string;
  style: 'trophy-chasers' | 'commercial' | 'sustainable' | 'developmental';
  patience: number;
  riskTolerance: number;
  financialFocus: number;
  sportingAmbition: number;
  commercialExpectation: number;
  youthFocus: number;
  recruitment: 'stars' | 'value' | 'youth' | 'balanced';
  appointed: GameDate;
  /** Confidence changes with the reason, oldest first. */
  history: (GameDate & { confidence: number; delta: number; reason: string })[];
  /** Objective ids renegotiated, with the season they were renegotiated. */
  negotiated: Record<string, number>;
  reviews: (GameDate & { kind: 'mid-season' | 'season'; score: number; verdict: string; lines: string[] })[];
}

export type SocialAccountKind = 'fan' | 'supporters' | 'journalist' | 'analyst' | 'former-player' | 'club' | 'league' | 'broadcaster' | 'rival-fan' | 'player';

export interface SocialAccount {
  id: string;
  handle: string;
  name: string;
  kind: SocialAccountKind;
  clubId: string | null;
  leagueId: string | null;
  playerId?: string;
  bio: string;
  /** 0..100: how far their word carries; for journalists, how often their reports hold up. */
  reputation: number;
  followers: number;
  /** −1 gloomy … +1 upbeat. */
  mood: number;
  avatar: { color: string; initials: string };
}

export interface SocialPost {
  id: string;
  accountId: string;
  eventId: string;
  season: number;
  day: number;
  text: string;
  kind: 'official' | 'opinion' | 'analysis' | 'rumour' | 'report';
  refs: EntityRefs & { articleId?: string };
  tags: string[];
  likes: number;
  replies: number;
  replyTo?: string;
  rumourId?: string;
}

export interface Rumour {
  id: string;
  sourceAccountId: string;
  subject: { playerId: string; clubId: string };
  claim: string;
  /** 0..1: the source's reliability for this claim. */
  reliability: number;
  season: number;
  day: number;
  status: 'open' | 'confirmed' | 'denied' | 'abandoned';
  context: 'auction' | 'unsettled';
  outcome?: string;
  resolved?: GameDate;
  eventId: string;
}

export interface ClubWorld {
  version: 1;
  events: WorldEvent[];
  /** Event keys already emitted (key → season), so nothing is processed twice. */
  keys: Record<string, number>;
  cursors: { ledger: number; tick: string; fixtures: Record<string, 1>; injuries: Record<string, 1> };
  inbox: InboxMessage[];
  conversations: Conversation[];
  promises: ManagerPromise[];
  relations: Record<string, PlayerRelation>;
  boards: Record<string, BoardProfile>;
  accounts: SocialAccount[];
  posts: SocialPost[];
  rumours: Rumour[];
  feed: { following: string[]; muted: string[]; saved: string[] };
  follows: { players: string[]; clubs: string[] };
  media: { pressure: number; history: (GameDate & { pressure: number; reason: string })[] };
  /** The user's team sheet per completed fixture: XI in batting order. */
  teamSheets: Record<string, { xi: string[]; captainId: string; expectation?: number }>;
}
