import type { ManagerPromise, PromiseKind, WorldEvent, WorldState } from '@kurciv/domain';
import { nextId } from '../util';
import { cw, emit, isPast, sendMessage, staff, subscribe, today } from './core';

/**
 * The commitment tracker. Every promise has a testable condition, evaluated from recorded
 * team sheets (who started, where they batted) or the transfer ledger — never from the
 * fact that a dialogue line was shown.
 */

export const PROMISE_TEXT: Record<PromiseKind, (name: string) => string> = {
  'start-next': (n) => `${n} will start the next match.`,
  'start-two-of-three': (n) => `${n} will start at least two of the next three matches.`,
  'open-batting': (n) => `${n} will open the batting in the next match.`,
  'top-order': (n) => `${n} will bat in the top three in at least two of the next three matches.`,
  'rest-next': (n) => `${n} will be rested for the next match.`,
  retain: (n) => `${n} will be retained at the next retention window.`,
  'board-results': () => 'The team will win at least three of the next five matches.',
};

const WINDOW: Record<PromiseKind, { matches: number | null; target: number }> = {
  'start-next': { matches: 1, target: 1 },
  'start-two-of-three': { matches: 3, target: 2 },
  'open-batting': { matches: 1, target: 1 },
  'top-order': { matches: 3, target: 2 },
  'rest-next': { matches: 1, target: 1 },
  retain: { matches: null, target: 1 },
  'board-results': { matches: 5, target: 3 },
};

export function makePromise(w: WorldState, input: { to: ManagerPromise['to']; kind: PromiseKind; name: string; conversationId: string | null; sourceEvent: string }): ManagerPromise {
  const win = WINDOW[input.kind];
  const p: ManagerPromise = {
    id: nextId(w, 'pr'), to: input.to, kind: input.kind, text: PROMISE_TEXT[input.kind](input.name), made: today(w),
    conversationId: input.conversationId, eventId: input.sourceEvent, matches: win.matches, target: win.target,
    deadline: input.kind === 'retain' ? { season: w.season + 1, day: 0 } : null,
    progress: { seen: 0, satisfied: 0, fixtureIds: [] }, status: 'active',
  };
  cw(w).promises.unshift(p);
  emit(w, { type: 'PROMISE_MADE', key: `promise-made-${p.id}`, source: `promise:${p.id}`, refs: { playerIds: input.to.kind === 'player' ? [input.to.id] : [], clubIds: [w.userClubId] }, data: { promiseId: p.id, kind: p.kind, text: p.text } });
  return p;
}

function settle(w: WorldState, p: ManagerPromise, status: 'fulfilled' | 'broken' | 'void', note: string) {
  if (p.status !== 'active') return;
  p.status = status;
  p.resolved = { ...today(w), note };
  const type = status === 'fulfilled' ? 'PROMISE_FULFILLED' : status === 'broken' ? 'PROMISE_BROKEN' : 'PROMISE_VOIDED';
  emit(w, {
    type, key: `promise-${status}-${p.id}`, source: `promise:${p.id}`, importance: status === 'broken' ? 2 : 1,
    refs: { playerIds: p.to.kind === 'player' ? [p.to.id] : [], clubIds: [w.userClubId] }, data: { promiseId: p.id, kind: p.kind, text: p.text, note },
  });
}

/** Does this team sheet satisfy the promise's condition? null = this match does not count (player unavailable). */
function satisfies(w: WorldState, p: ManagerPromise, xi: string[], won: boolean): boolean | null {
  if (p.kind === 'board-results') return won;
  const pid = p.to.id;
  const pos = xi.indexOf(pid);
  const player = w.players[pid];
  const needsToPlay = p.kind !== 'rest-next';
  if (needsToPlay && pos < 0 && player?.injury) return null; // genuinely unavailable: handled by renegotiation
  switch (p.kind) {
    case 'start-next':
    case 'start-two-of-three': return pos >= 0;
    case 'open-batting': return pos === 0 || pos === 1;
    case 'top-order': return pos >= 0 && pos <= 2;
    case 'rest-next': return pos < 0;
    default: return null;
  }
}

function onMatch(w: WorldState, e: WorldEvent) {
  if (e.type !== 'MATCH_COMPLETED' || !e.data.userMatch) return;
  const fx = e.refs.fixtureId!;
  const sheet = cw(w).teamSheets[fx];
  if (!sheet) return;
  const won = e.data.winnerId === w.userClubId;
  for (const p of cw(w).promises.filter((x) => x.status === 'active' && x.matches !== null)) {
    if (p.progress.fixtureIds.includes(fx)) continue;
    const ok = satisfies(w, p, sheet.xi, won);
    if (ok === null) {
      // The player could not play: the manager may explain rather than be judged on it.
      if (!p.reminded) {
        p.reminded = true;
        const name = w.players[p.to.id]?.name ?? 'The player';
        sendMessage(w, {
          eventId: e.id, from: staff(w, 'head'), category: 'player', priority: 'high',
          subject: `Promise to ${name} on hold`,
          body: `You promised: “${p.text}” ${name} was unavailable for this match through injury, so it did not count. You can explain the situation and release the promise, or keep it open for when ${name} is fit.`,
          refs: { playerIds: [p.to.id], clubIds: [w.userClubId] }, links: [{ label: 'Promises', page: 'conversations' }],
          response: { kind: 'promise-at-risk', required: false, deadline: null, payload: { promiseId: p.id }, options: [{ id: 'explain', label: 'Explain and release the promise', hint: 'Small trust cost; no broken promise.' }, { id: 'keep', label: 'Keep the promise open', hint: 'It will be judged on the next matches they are fit for.' }] },
        });
      }
      continue;
    }
    p.progress.fixtureIds.push(fx);
    p.progress.seen++;
    if (ok) p.progress.satisfied++;
    if (p.progress.satisfied >= p.target) settle(w, p, 'fulfilled', `Kept after ${p.progress.seen} match${p.progress.seen === 1 ? '' : 'es'}.`);
    else if (p.progress.seen - p.progress.satisfied > p.matches! - p.target) settle(w, p, 'broken', `Not kept: ${p.progress.satisfied} of ${p.progress.seen} matches met the commitment.`);
  }
}

function onLedger(w: WorldState, e: WorldEvent) {
  if (e.type !== 'CONTRACT_SIGNED' && e.type !== 'PLAYER_RELEASED' && e.type !== 'PLAYER_ACQUIRED') return;
  const pid = e.refs.playerIds[0];
  for (const p of cw(w).promises.filter((x) => x.status === 'active' && x.kind === 'retain' && x.to.id === pid)) {
    if (e.type === 'CONTRACT_SIGNED') settle(w, p, 'fulfilled', 'Retained at the retention window.');
    else if (e.type === 'PLAYER_RELEASED' && e.data.fromClubId === w.userClubId) settle(w, p, 'broken', 'Released instead of retained.');
  }
}

/** Daily: deadlines and pre-match reminders. */
export function promisesDaily(w: WorldState, nextUserFixture: { id: string; day: number } | null, plannedXI: string[] | null) {
  for (const p of cw(w).promises.filter((x) => x.status === 'active')) {
    if (p.deadline && isPast(w, p.deadline)) settle(w, p, 'broken', 'The deadline passed.');
    // A player who left the club releases the promise.
    if (p.to.kind === 'player' && w.players[p.to.id]?.clubId !== w.userClubId) settle(w, p, 'void', 'The player is no longer at the club.');
  }
  if (!nextUserFixture || nextUserFixture.day !== w.day || !plannedXI) return;
  for (const p of cw(w).promises.filter((x) => x.status === 'active' && x.to.kind === 'player' && x.matches !== null)) {
    const mustNow = p.matches! - p.progress.seen <= p.target - p.progress.satisfied;
    if (!mustNow) continue;
    const ok = satisfies(w, p, plannedXI, false);
    if (ok !== false) continue;
    const key = `remind-${p.id}-${nextUserFixture.id}`;
    if (cw(w).keys[key] !== undefined) continue;
    cw(w).keys[key] = w.season;
    const name = w.players[p.to.id]?.name ?? 'A player';
    sendMessage(w, {
      eventId: p.eventId, from: staff(w, 'head'), category: 'match', priority: 'urgent',
      subject: `Today's XI breaks your promise to ${name}`,
      body: `You promised: “${p.text}” Your current team sheet does not do that, and this is the last chance to keep it. Change the XI in the Match Centre, or accept the consequences.`,
      refs: { playerIds: [p.to.id], clubIds: [w.userClubId], fixtureId: nextUserFixture.id }, links: [{ label: 'Pick the XI', page: 'match' }],
    });
  }
}

export function promiseById(w: WorldState, id: string) {
  return cw(w).promises.find((p) => p.id === id);
}

export function releasePromise(w: WorldState, id: string, note: string) {
  const p = promiseById(w, id);
  if (p) settle(w, p, 'void', note);
}

subscribe(onMatch);
subscribe(onLedger);
