import type { AuctionLot, AuctionState, AuctioneerLine, LiveAuction, LotResult, WorldState } from '@kurciv/domain';
import { marketValue, overall } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import { hash01 } from '@kurciv/simulation';
import {
  advanceCascade, categoryOf, closeLot, createLiveState, endRound, escalate, increment, leader, nextBid, openLot, priceScale, roleTargets, validBidFor,
} from './auction';
import { clubsInLeague, formatCr, round2, squadOf } from './util';

/**
 * Real-time auction room. A deterministic state machine driven by elapsed time:
 *
 *   PREPARATION → PLAYER_INTRODUCTION → OPEN_FOR_BIDS ⇄ FINAL_CALL → SOLD | UNSOLD → (next lot)
 *                                         ↑ any valid bid resets the countdown (bid extension)
 *   … → ACCELERATED_SELECTION (unsold players picked for a second round) → COMPLETED
 *
 * AI franchises act on seeded "reaction times": each interested club is scheduled to respond
 * after a human-like pause, hesitating longer as the price approaches its private ceiling.
 * The ceilings themselves come from the same marginal-value model used everywhere else
 * (valuePlayer), so the live room and instant simulation can never disagree about who wants whom.
 * The clock only advances while the room is open, so a closed tab pauses the auction.
 */

export const AUCTION_TIMING = {
  introMs: 1900,
  bidWindowMs: 5500,
  emptyWindowMs: 2600, // no club interested at the base price: short last call
  finalCallMs: 2500,
  soldMs: 3200,
  unsoldMs: 1500,
  minReactMs: 650,
  maxReactMs: 2600,
  userProxyReactMs: 450,
};

type Live = LiveAuction;

function say(live: Live, text: string, kind: AuctioneerLine['kind'], clubId?: string) {
  live.commentary.push({ t: live.clock, text, kind, clubId });
  if (live.commentary.length > 60) live.commentary.splice(0, live.commentary.length - 60);
}

function pickLine(seed: string, lines: string[]): string {
  return lines[Math.floor(hash01(seed) * lines.length)];
}

function currentLot(a: AuctionState): AuctionLot | null {
  return a.status === 'live' ? a.lots[a.currentLotIndex] ?? null : null;
}

/** Ceiling for a bidder on the current lot: AI valuation, or the user's proxy. */
function ceilingOf(w: WorldState, a: AuctionState, lot: AuctionLot, clubId: string): number {
  if (clubId === w.userClubId) return lot.userOut ? 0 : a.userProxy[lot.playerId] ?? 0;
  return lot.aiMax?.[clubId] ?? 0;
}

function reactionDelay(w: WorldState, a: AuctionState, lot: AuctionLot, clubId: string): number {
  if (clubId === w.userClubId) return AUCTION_TIMING.userProxyReactMs;
  const club = w.clubs[clubId];
  const l = leagueById(a.leagueId);
  const price = nextBid(l, lot);
  const max = Math.max(price, ceilingOf(w, a, lot, clubId));
  const r = hash01(`${w.seed}|${lot.id}|${clubId}|${lot.bids.length}`);
  const temperament = club.personality === 'aggressive-contender' || club.personality === 'star-commercial' ? 0.75 : club.personality === 'conservative' ? 1.3 : 1;
  // Cheap relative to the ceiling → rapid-fire paddles; near the ceiling → long, visible hesitation.
  const ratio = price / max;
  const hesitation = 1 + 2.4 * Math.pow(ratio, 4);
  const lo = 260 + (AUCTION_TIMING.minReactMs - 260) * ratio * ratio;
  const hi = 900 + (AUCTION_TIMING.maxReactMs - 900) * ratio * ratio;
  const base = lo + r * (hi - lo);
  return Math.round(base * temperament * hesitation);
}

/** (Re)schedules every interested bidder except the current leader. */
function scheduleBidders(w: WorldState, a: AuctionState, lot: AuctionLot, live: Live) {
  const l = leagueById(a.leagueId);
  const lead = leader(lot);
  const price = nextBid(l, lot);
  live.schedule = {};
  const ids = [...Object.keys(lot.aiMax ?? {}), ...(a.userProxy[lot.playerId] && !lot.userOut ? [w.userClubId] : [])];
  for (const id of ids) {
    if (id === lead || live.dropped.includes(id)) continue;
    if (ceilingOf(w, a, lot, id) < price) {
      if (live.bidders.includes(id) && !live.dropped.includes(id)) {
        live.dropped.push(id);
        if (id !== w.userClubId) say(live, pickLine(`${lot.id}|drop|${id}`, [`${w.clubs[id].shortName} shake their heads.`, `${w.clubs[id].shortName} are out.`, `That's enough for ${w.clubs[id].shortName}.`]), 'drop', id);
      }
      continue;
    }
    live.schedule[id] = live.clock + reactionDelay(w, a, lot, id);
  }
}

function placeBid(w: WorldState, a: AuctionState, lot: AuctionLot, live: Live, clubId: string, amount: number, proxy = false) {
  const prevLeader = leader(lot);
  lot.bids.push({ clubId, amount, at: lot.bids.length, proxy: proxy || undefined });
  if (!live.bidders.includes(clubId)) live.bidders.push(clubId);
  const club = w.clubs[clubId];
  const first = lot.bids.length === 1;
  const text = first
    ? `${club.name} open the bidding at ${formatCr(amount)}.`
    : pickLine(`${lot.id}|bid|${lot.bids.length}`, [`${club.shortName} come in at ${formatCr(amount)}.`, `${formatCr(amount)} from ${club.shortName}.`, `${club.shortName} go to ${formatCr(amount)}.`, `New bid — ${club.shortName}, ${formatCr(amount)}.`]);
  say(live, text, clubId === w.userClubId ? 'user' : 'bid', clubId);
  live.outbid = prevLeader === w.userClubId && clubId !== w.userClubId;
  if (clubId === w.userClubId) live.userWatching = false;
  // Bid extension: every valid bid re-opens a full bidding window.
  live.phase = 'OPEN_FOR_BIDS';
  live.phaseMs = AUCTION_TIMING.bidWindowMs;
  scheduleBidders(w, a, lot, live);
}

/** An AI club (or the user's proxy) acts on its scheduled reaction. */
function act(w: WorldState, a: AuctionState, lot: AuctionLot, live: Live, clubId: string) {
  delete live.schedule[clubId];
  if (leader(lot) === clubId) return;
  const l = leagueById(a.leagueId);
  const price = nextBid(l, lot);
  const max = ceilingOf(w, a, lot, clubId);
  const p = w.players[lot.playerId];
  const invalid = validBidFor(w, a, w.clubs[clubId], p, price);
  if (price > max || invalid) {
    if (!live.dropped.includes(clubId)) live.dropped.push(clubId);
    if (live.bidders.includes(clubId) && clubId !== w.userClubId) say(live, `${w.clubs[clubId].shortName} drop out.`, 'drop', clubId);
    return;
  }
  // Occasionally a confident AI jumps the price early to scare rivals off.
  let amount = price;
  const club = w.clubs[clubId];
  if (clubId !== w.userClubId && lot.bids.length < 4 && (club.personality === 'aggressive-contender' || club.personality === 'star-commercial')) {
    if (hash01(`${w.seed}|${lot.id}|jump|${clubId}`) < 0.35) {
      const jump = round2(price + increment(l, price) * 2);
      if (jump <= max * 0.8 && !validBidFor(w, a, club, p, jump)) amount = jump;
    }
  }
  placeBid(w, a, lot, live, clubId, amount, clubId === w.userClubId);
}

function introduceLot(w: WorldState, a: AuctionState, live: Live) {
  const lot = currentLot(a);
  if (!lot) return;
  const p = w.players[lot.playerId];
  live.phase = 'PLAYER_INTRODUCTION';
  live.phaseMs = AUCTION_TIMING.introMs;
  live.schedule = {};
  live.dropped = [];
  live.bidders = [];
  live.outbid = false;
  live.userWatching = false;
  const round = lot.round === 2 ? ' (accelerated round)' : '';
  say(live, `Lot ${a.currentLotIndex + 1}${round}: ${p.name}, ${p.country} — ${lot.set}. Base price ${formatCr(lot.basePrice)}.`, 'intro');
}

function openBidding(w: WorldState, a: AuctionState, live: Live) {
  const lot = currentLot(a)!;
  if (lot.status === 'pending') openLot(w, a, a.currentLotIndex);
  live.phase = 'OPEN_FOR_BIDS';
  live.phaseMs = AUCTION_TIMING.bidWindowMs;
  scheduleBidders(w, a, lot, live);
  if (!Object.keys(live.schedule).length) {
    live.phaseMs = AUCTION_TIMING.emptyWindowMs;
    say(live, 'Any interest at the base price?', 'call');
  }
}

function unsoldReason(w: WorldState, a: AuctionState, lot: AuctionLot): string {
  const l = leagueById(a.leagueId);
  const p = w.players[lot.playerId];
  const clubs = clubsInLeague(w, l.id).filter((c) => !c.isUser);
  const canAffordBase = clubs.filter((c) => c.purse - lot.basePrice >= Math.max(0, l.squadRules.minSquad - c.squad.length - 1) * l.auctionRules.minBase).length;
  const cat = categoryOf(p);
  const target = roleTargets(l)[cat];
  const stocked = clubs.filter((c) => squadOf(w, c).filter((x) => categoryOf(x) === cat).length >= target).length;
  const full = clubs.filter((c) => c.squad.length >= l.squadRules.maxSquad).length;
  if (full >= clubs.length * 0.6) return 'Most franchises have no roster slots left.';
  if (canAffordBase <= clubs.length * 0.3) return `Limited budgets — only ${canAffordBase} franchise${canAffordBase === 1 ? '' : 's'} could commit the base price.`;
  if (stocked >= clubs.length * 0.5) return `Poor squad fit — ${stocked} franchises are already well stocked in that role.`;
  return `High valuation — no franchise rated ${p.shortName} above the ${formatCr(lot.basePrice)} base price.`;
}

function resolveLot(w: WorldState, a: AuctionState, live: Live) {
  const lot = currentLot(a)!;
  const p = w.players[lot.playerId];
  const l = leagueById(a.leagueId);
  const estimate = round2(marketValue(p, w.season) * priceScale(l));
  const contenders = [...live.bidders];
  const ceilings = { ...(lot.aiMax ?? {}) };
  const reason = leader(lot) ? null : unsoldReason(w, a, lot);
  closeLot(w, a, lot);
  let result: LotResult;
  if (lot.status === 'sold') {
    const club = w.clubs[lot.soldTo!];
    const price = lot.price!;
    const ratio = price / Math.max(0.01, estimate);
    const headline = ratio < 0.7
      ? `Bargain! ${club.name} snap up ${p.name}`
      : ratio > 1.6
        ? `${club.name} go big for ${p.name}`
        : `${p.name} joins ${club.name}`;
    result = { lotId: lot.id, playerId: p.id, status: 'sold', clubId: club.id, price, estimate, bids: lot.bids.length, bidders: contenders.length, headline, reason: null };
    say(live, `SOLD! ${p.name} to ${club.name} for ${formatCr(price)}.`, 'sold', club.id);
    // Losing bidders who valued him highly will chase a substitute in the same role.
    for (const id of contenders) {
      if (id === club.id || id === w.userClubId) continue;
      if ((ceilings[id] ?? 0) >= lot.basePrice * 2) (live.missed[id] ??= []).push(categoryOf(p));
    }
    live.phase = 'SOLD';
    live.phaseMs = AUCTION_TIMING.soldMs;
  } else {
    result = { lotId: lot.id, playerId: p.id, status: 'unsold', clubId: null, price: null, estimate, bids: 0, bidders: 0, headline: `${p.name} goes unsold`, reason };
    say(live, `No takers. ${p.name} is unsold.`, 'unsold');
    live.phase = 'UNSOLD';
    live.phaseMs = AUCTION_TIMING.unsoldMs;
  }
  live.lastResult = result;
  live.results.push(result);
  live.schedule = {};
}

function nextLot(w: WorldState, a: AuctionState, live: Live) {
  a.currentLotIndex++;
  if (!a.lots[a.currentLotIndex]) {
    endRound(w, a, true);
    if (a.status !== 'live') {
      live.phase = 'COMPLETED';
      say(live, 'That concludes the auction. Thank you, franchises.', 'info');
      return;
    }
    if (live.phase === 'ACCELERATED_SELECTION') {
      say(live, `Round one complete. ${live.accelerated?.candidates.length ?? 0} unsold players can return in an accelerated round.`, 'info');
      return;
    }
  }
  introduceLot(w, a, live);
}

/**
 * Advances the auction clock by `dt` ms, processing every AI reaction and phase change due in
 * that window in strict time order. Returns true if anything observable changed (bids, phase).
 */
export function liveTick(w: WorldState, a: AuctionState, dt: number): boolean {
  const live = a.live;
  if (!live || a.status !== 'live' || live.paused) return false;
  if (live.phase === 'PREPARATION' || live.phase === 'ACCELERATED_SELECTION' || live.phase === 'COMPLETED') return false;
  const target = live.clock + Math.max(0, Math.min(dt, 5000));
  let changed = false;
  let guard = 0;
  while (guard++ < 500) {
    const lot = currentLot(a);
    if (!lot) break;
    const bidding = live.phase === 'OPEN_FOR_BIDS' || live.phase === 'FINAL_CALL';
    let aiId: string | null = null;
    let aiAt = Infinity;
    if (bidding) {
      for (const [id, at] of Object.entries(live.schedule)) {
        if (at < aiAt || (at === aiAt && id < (aiId ?? ''))) {
          aiAt = at;
          aiId = id;
        }
      }
    }
    const endAt = live.clock + live.phaseMs;
    const next = Math.min(aiAt, endAt);
    if (next > target) {
      live.phaseMs -= target - live.clock;
      live.clock = target;
      break;
    }
    live.phaseMs -= next - live.clock;
    live.clock = next;
    changed = true;
    if (aiId && aiAt <= endAt) {
      act(w, a, lot, live, aiId);
      continue;
    }
    // phase end
    switch (live.phase) {
      case 'PLAYER_INTRODUCTION':
        openBidding(w, a, live);
        break;
      case 'OPEN_FOR_BIDS': {
        const lead = leader(lot);
        live.phase = 'FINAL_CALL';
        live.phaseMs = AUCTION_TIMING.finalCallMs;
        say(live, lead ? `Going once… going twice… at ${formatCr(lot.bids[lot.bids.length - 1].amount)} to ${w.clubs[lead].shortName}.` : `Last call at ${formatCr(lot.basePrice)}…`, 'call');
        break;
      }
      case 'FINAL_CALL':
        resolveLot(w, a, live);
        break;
      case 'SOLD':
      case 'UNSOLD':
        nextLot(w, a, live);
        break;
    }
    if ((live.phase as string) === 'COMPLETED' || (live.phase as string) === 'ACCELERATED_SELECTION') break;
  }
  return changed;
}

// ------------------------------------------------------------------ user commands

export type LiveCommand =
  | { type: 'begin' }
  | { type: 'bid'; amount?: number }
  | { type: 'pass' }
  | { type: 'watch' }
  | { type: 'proxy'; playerId: string; max: number | null }
  | { type: 'flag'; playerId: string; flagged: boolean }
  | { type: 'pause'; paused: boolean }
  | { type: 'skip-lot' }
  | { type: 'accelerated-toggle'; playerId: string }
  | { type: 'accelerated-start' };

export interface LiveResult {
  ok: boolean;
  error?: string;
}

/** Bid amounts the user may choose from right now: the next increment plus a few jumps. */
export function permittedBids(w: WorldState, a: AuctionState): number[] {
  const lot = currentLot(a);
  if (!lot) return [];
  const l = leagueById(a.leagueId);
  const out: number[] = [];
  let p = nextBid(l, lot);
  for (let i = 0; i < 4; i++) {
    out.push(p);
    p = round2(p + increment(l, p) * (i === 0 ? 1 : 2));
  }
  return out;
}

export function liveCommand(w: WorldState, a: AuctionState, cmd: LiveCommand): LiveResult {
  const live = a.live;
  if (!live) return { ok: false, error: 'This auction is not running in the live room.' };
  const lot = currentLot(a);
  const l = leagueById(a.leagueId);
  switch (cmd.type) {
    case 'begin': {
      if (live.phase !== 'PREPARATION') return { ok: false, error: 'The auction has already started.' };
      if (!lot) return { ok: false, error: 'No lots to auction.' };
      say(live, `Welcome to the ${l.name} auction. ${a.lots.length} players, ${clubsInLeague(w, l.id).length} franchises.`, 'info');
      introduceLot(w, a, live);
      return { ok: true };
    }
    case 'bid': {
      if (!lot || (live.phase !== 'OPEN_FOR_BIDS' && live.phase !== 'FINAL_CALL')) {
        return { ok: false, error: live.phase === 'PLAYER_INTRODUCTION' ? 'Bidding opens in a moment.' : 'Bidding is closed for this lot.' };
      }
      if (lot.userOut) return { ok: false, error: 'You passed on this player.' };
      if (leader(lot) === w.userClubId) return { ok: false, error: 'You already hold the highest bid.' };
      const allowed = permittedBids(w, a);
      const amount = cmd.amount === undefined ? allowed[0] : round2(cmd.amount);
      if (!allowed.some((x) => Math.abs(x - amount) < 0.001)) return { ok: false, error: `Bids must be one of ${allowed.map(formatCr).join(', ')}.` };
      const err = validBidFor(w, a, w.clubs[w.userClubId], w.players[lot.playerId], amount);
      if (err) return { ok: false, error: err };
      placeBid(w, a, lot, live, w.userClubId, amount);
      return { ok: true };
    }
    case 'pass': {
      if (!lot || lot.status !== 'live') return { ok: false, error: 'No player is up for bidding.' };
      lot.userOut = true;
      delete live.schedule[w.userClubId];
      if (!live.dropped.includes(w.userClubId)) live.dropped.push(w.userClubId);
      // Nobody else interested: move straight to the final call.
      if (!Object.keys(live.schedule).length && live.phase === 'OPEN_FOR_BIDS') live.phaseMs = Math.min(live.phaseMs, 900);
      return { ok: true };
    }
    case 'watch':
      live.userWatching = true;
      return { ok: true };
    case 'proxy': {
      const purse = w.clubs[w.userClubId].purse;
      if (cmd.max === null) delete a.userProxy[cmd.playerId];
      else {
        if (!(cmd.max > 0) || cmd.max > purse) return { ok: false, error: `Proxy maximum must be between 0 and your purse (${formatCr(purse)}).` };
        a.userProxy[cmd.playerId] = round2(cmd.max);
      }
      if (lot && lot.playerId === cmd.playerId && lot.status === 'live' && cmd.max !== null && leader(lot) !== w.userClubId && !lot.userOut) {
        live.schedule[w.userClubId] = live.clock + AUCTION_TIMING.userProxyReactMs;
      }
      return { ok: true };
    }
    case 'flag': {
      const target = a.lots.find((x) => x.playerId === cmd.playerId && x.status === 'pending');
      if (!target) return { ok: false, error: 'That player is not waiting in the queue.' };
      target.flaggedByUser = cmd.flagged;
      return { ok: true };
    }
    case 'pause':
      live.paused = cmd.paused;
      say(live, cmd.paused ? 'The auctioneer calls a short break.' : 'We resume.', 'info');
      return { ok: true };
    case 'skip-lot': {
      if (!lot || (live.phase !== 'PLAYER_INTRODUCTION' && live.phase !== 'OPEN_FOR_BIDS' && live.phase !== 'FINAL_CALL')) return { ok: false, error: 'Nothing to skip right now.' };
      if (lot.status === 'pending') openLot(w, a, a.currentLotIndex);
      lot.userOut = true;
      escalate(w, a, lot, null);
      for (const b of lot.bids) if (!live.bidders.includes(b.clubId)) live.bidders.push(b.clubId);
      resolveLot(w, a, live);
      live.phaseMs = 1200;
      return { ok: true };
    }
    case 'accelerated-toggle': {
      const acc = live.accelerated;
      if (live.phase !== 'ACCELERATED_SELECTION' || !acc) return { ok: false, error: 'The accelerated round is not being drafted.' };
      if (!acc.candidates.includes(cmd.playerId)) return { ok: false, error: 'That player is not in the unsold pool.' };
      acc.selected = acc.selected.includes(cmd.playerId) ? acc.selected.filter((x) => x !== cmd.playerId) : [...acc.selected, cmd.playerId];
      return { ok: true };
    }
    case 'accelerated-start': {
      const acc = live.accelerated;
      if (live.phase !== 'ACCELERATED_SELECTION' || !acc) return { ok: false, error: 'The accelerated round is not being drafted.' };
      const picks = acc.selected.filter((pid) => !w.players[pid].clubId);
      const fresh: AuctionLot[] = picks.map((pid) => {
        const old = a.lots.find((x) => x.playerId === pid)!;
        return { ...old, id: `${old.id}-r2`, status: 'pending', bids: [], soldTo: null, price: null, round: 2, userOut: false, flaggedByUser: false };
      });
      live.accelerated = null;
      if (!fresh.length) {
        endRound(w, a); // no round 2 lots → finishes
        if (a.status !== 'live') live.phase = 'COMPLETED';
        return { ok: true };
      }
      a.lots.push(...fresh);
      say(live, `Accelerated round: ${fresh.length} players return to the block.`, 'info');
      introduceLot(w, a, live);
      return { ok: true };
    }
  }
}

/** Runs the user's auction to the end without the room (assistant decides, or user abstains). */
export function completeCascadeIfDone(w: WorldState): boolean {
  if (advanceCascade(w)) {
    w.phase = 'preseason';
    return true;
  }
  return false;
}

/** Projected demand per role across AI clubs — used for the Squad Needs panel. */
export function roleDemand(w: WorldState, a: AuctionState): Record<string, { clubs: number; elitePool: number }> {
  const l = leagueById(a.leagueId);
  const tgt = roleTargets(l);
  const out: Record<string, { clubs: number; elitePool: number }> = {};
  const pending = a.lots.filter((x) => x.status === 'pending' || x.status === 'live').map((x) => w.players[x.playerId]);
  for (const cat of Object.keys(tgt) as (keyof typeof tgt)[]) {
    const clubs = clubsInLeague(w, l.id).filter((c) => !c.isUser && squadOf(w, c).filter((p) => categoryOf(p) === cat).length < tgt[cat]).length;
    const elitePool = pending.filter((p) => categoryOf(p) === cat && overall(p) >= 78).length;
    out[cat] = { clubs, elitePool };
  }
  return out;
}

export { createLiveState };
