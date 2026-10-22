import type { ClubWorld, EntityRefs, GameDate, InboxMessage, WorldEvent, WorldEventType, WorldState } from '@kurciv/domain';
import { Rng } from '@kurciv/simulation';
import { nextId } from '../util';

/**
 * The Club World event bus. Simulation code and the world observer emit structured events;
 * subscribers (news, inbox, conversations, promises, board, feed) turn one event into
 * consistent reactions that all cite that event's id. Every emit is keyed, so replaying a
 * state transition, reloading a save or refreshing a page can never produce a second copy.
 */

export function emptyClubWorld(): ClubWorld {
  return {
    version: 1, events: [], keys: {}, cursors: { ledger: 0, tick: '', fixtures: {}, injuries: {} },
    inbox: [], conversations: [], promises: [], relations: {}, boards: {},
    accounts: [], posts: [], rumours: [],
    feed: { following: [], muted: [], saved: [] }, follows: { players: [], clubs: [] },
    media: { pressure: 20, history: [] }, teamSheets: {},
  };
}

export function cw(w: WorldState): ClubWorld {
  return (w.clubWorld ??= emptyClubWorld());
}

export const today = (w: WorldState): GameDate => ({ season: w.season, day: w.day });

/** A date `days` after today, kept within the current season. */
export const later = (w: WorldState, days: number): GameDate => ({ season: w.season, day: w.day + days });

export function isVisible(w: WorldState, d: GameDate): boolean {
  return d.season < w.season || (d.season === w.season && d.day <= w.day);
}

export function isPast(w: WorldState, d: GameDate): boolean {
  return d.season < w.season || (d.season === w.season && d.day < w.day);
}

export const refs = (r: Partial<EntityRefs>): EntityRefs => ({ playerIds: r.playerIds ?? [], clubIds: r.clubIds ?? [], ...(r.fixtureId ? { fixtureId: r.fixtureId } : {}), ...(r.competitionId ? { competitionId: r.competitionId } : {}) });

/** Deterministic random stream for reactions to one event. */
export const eventRng = (w: WorldState, e: WorldEvent, label = '') => Rng.from(`${w.seed}|cw|${e.id}|${label}`);

type Subscriber = (w: WorldState, e: WorldEvent) => void;
const subscribers: Subscriber[] = [];

/** Systems register once at module load; dispatch order is registration order. */
export function subscribe(fn: Subscriber) {
  subscribers.push(fn);
}

export interface EmitInput {
  type: WorldEventType;
  key: string;
  source: string;
  refs?: Partial<EntityRefs>;
  data?: Record<string, unknown>;
  importance?: 1 | 2 | 3;
}

/** Records and dispatches an event, unless an event with the same key already exists. */
export function emit(w: WorldState, input: EmitInput): WorldEvent | null {
  const c = cw(w);
  if (c.keys[input.key] !== undefined) return null;
  c.keys[input.key] = w.season;
  const e: WorldEvent = {
    id: nextId(w, 'ev'), type: input.type, season: w.season, day: w.day, key: input.key, source: input.source,
    refs: refs(input.refs ?? {}), data: input.data ?? {}, importance: input.importance ?? 1,
  };
  c.events.push(e);
  if (c.events.length > 2500) c.events.splice(0, c.events.length - 2500);
  for (const s of subscribers) s(w, e);
  return e;
}

export function eventById(w: WorldState, id: string | null | undefined): WorldEvent | undefined {
  return id ? cw(w).events.find((e) => e.id === id) : undefined;
}

// ------------------------------------------------------------------ inbox

export type NewMessage = Omit<InboxMessage, 'id' | 'season' | 'day' | 'read' | 'archived' | 'pinned' | 'refs' | 'links'> & {
  refs?: Partial<EntityRefs>;
  links?: InboxMessage['links'];
  /** Delivery delay in days (messages arrive in a believable order). */
  delay?: number;
};

export function sendMessage(w: WorldState, m: NewMessage): InboxMessage {
  const c = cw(w);
  const { delay = 0, refs: r, links, ...rest } = m;
  const msg: InboxMessage = {
    ...rest, id: nextId(w, 'msg'), season: w.season, day: w.day + delay, read: false, archived: false, pinned: false,
    refs: refs(r ?? {}), links: links ?? [],
  };
  c.inbox.unshift(msg);
  // Keep the inbox bounded: drop the oldest archived or read low-priority mail first.
  if (c.inbox.length > 500) {
    const drop = c.inbox.findLastIndex((x) => !x.pinned && (x.archived || x.read) && !(x.response?.required && !x.response.chosen));
    c.inbox.splice(drop >= 0 ? drop : c.inbox.length - 1, 1);
  }
  return msg;
}

/** The staff member who signs a category of message for the user's club. */
export function staff(w: WorldState, role: 'head' | 'batting' | 'bowling' | 'fielding' | 'medical' | 'scout' | 'board' | 'media' | 'analyst'): { name: string; role: string } {
  const u = w.clubs[w.userClubId];
  const coach = (r: string) => u.coaches.find((c) => c.role === r);
  switch (role) {
    case 'head': return { name: coach('head')?.name ?? 'Head coach', role: 'Head coach' };
    case 'batting': return { name: coach('batting')?.name ?? 'Batting coach', role: 'Batting coach' };
    case 'bowling': return { name: coach('bowling')?.name ?? 'Bowling coach', role: 'Bowling coach' };
    case 'fielding': return { name: coach('fielding')?.name ?? 'Fielding coach', role: 'Fielding coach' };
    case 'medical': return { name: 'Club physio', role: 'Head of medical' };
    case 'scout': return { name: 'Chief scout', role: 'Recruitment' };
    case 'board': return { name: `${u.name} board`, role: 'Board of directors' };
    case 'media': return { name: 'Media officer', role: 'Communications' };
    case 'analyst': return { name: 'Performance analyst', role: 'Analysis' };
  }
}
