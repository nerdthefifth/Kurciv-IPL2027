import type { BowlingPlan, FieldPoint, Length, Line } from '@kurciv/domain';
import { choosePlayerOfMatch } from './award';
import { isSpin, speedScore } from '@kurciv/domain';
import { SIM } from '@kurciv/config';
import { Rng, clamp, sigmoid } from './rng';
import { STRIKER, direction, distanceToBoundary, fitToVenue, insideCircle, mirror, validateField, zoneOf, ZONES } from './geometry';
import { SHOTS, shotAngle, type ShotDef } from './shots';
import { commentaryFor } from './commentary';
import { winProbabilityHome } from './winprob';
import { batterPressure, bowlerPressure } from './pressure';
import type {
  BatterInnings, BowlerInnings, Captain, Controllers, DeliveryEvent, Dismissal, FieldSetting, InningsState, LoggedAction, MatchAction,
  MatchPlayer, MatchSetup, MatchState, OverSummary, Pending, Side,
} from './types';
import { other } from './types';

export const ENGINE_VERSION = SIM.engineVersion;

const LENGTHS: Length[] = ['yorker', 'full', 'good', 'back', 'short'];
const LINES: Line[] = ['wide', 'off', 'stumps', 'leg'];
const BOWLER_END: FieldPoint = { x: 0, y: SIM.stumpsY };
const STRIKER_END: FieldPoint = { x: 0, y: -SIM.stumpsY };

// ------------------------------------------------------------------ lookups

export function team(s: MatchState, side: Side) {
  return s.setup[side];
}

export function playerById(s: MatchState, id: string): MatchPlayer {
  const p = s.setup.home.xi.find((x) => x.id === id) ?? s.setup.away.xi.find((x) => x.id === id);
  if (!p) throw new Error(`Player ${id} not in match`);
  return p;
}

export function currentInnings(s: MatchState): InningsState | null {
  return s.innings.length ? s.innings[s.innings.length - 1] : null;
}

export function phaseOf(inn: InningsState, rulesPP: number, overs: number): 'powerplay' | 'middle' | 'death' {
  if (inn.superOver) return 'death';
  const over = Math.floor(inn.legalBalls / 6);
  if (over < rulesPP) return 'powerplay';
  if (over >= overs - 5) return 'death';
  return 'middle';
}

export function sideOfPlayer(s: MatchState, id: string): Side {
  return s.setup.home.xi.some((p) => p.id === id) ? 'home' : 'away';
}

export function eligibleBowlers(s: MatchState, inn: InningsState): string[] {
  const xi = team(s, inn.bowlingSide).xi;
  const quota = inn.superOver ? 6 : s.setup.rules.maxBowlerOvers * 6;
  const list = xi
    .filter((p) => p.bowlType !== 'NONE' && p.id !== team(s, inn.bowlingSide).keeperId)
    .filter((p) => (inn.bowlers[p.id]?.balls ?? 0) < quota)
    .filter((p) => inn.superOver || p.id !== inn.lastOverBowlerId)
    .map((p) => p.id);
  if (list.length) return list;
  // Emergency: allow any non-keeper (still never the previous over's bowler unless unavoidable).
  const fallback = xi.filter((p) => p.id !== team(s, inn.bowlingSide).keeperId && p.id !== inn.lastOverBowlerId).map((p) => p.id);
  return fallback.length ? fallback : xi.map((p) => p.id);
}

// ------------------------------------------------------------------ setup

function emptyBatter(id: string, at: number): BatterInnings {
  return { playerId: id, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, out: null, arrivedAt: at };
}

function emptyBowler(id: string): BowlerInnings {
  return { playerId: id, balls: 0, runs: 0, wickets: 0, dots: 0, wides: 0, noBalls: 0, maidens: 0, fours: 0, sixes: 0, spellFatigue: 0 };
}

function fieldFromTemplate(s: MatchState, side: Side, templateId: string): FieldSetting {
  const t = team(s, side).fields.find((f) => f.id === templateId) ?? team(s, side).fields[0];
  return { templateId: t.id, name: t.name, positions: t.positions.map((p) => ({ ...p })), keeperUp: t.keeperUp };
}

function clonePlan(p: BowlingPlan): BowlingPlan {
  return { lengths: { ...p.lengths }, lines: { ...p.lines }, variation: p.variation, pace: p.pace };
}

function startInnings(s: MatchState, battingSide: Side, target: number | null, superOver: boolean, order?: string[]) {
  const bat = team(s, battingSide);
  const bowlSide = other(battingSide);
  const bowl = team(s, bowlSide);
  const ord = order ?? bat.xi.map((p) => p.id);
  const inn: InningsState = {
    index: s.innings.length,
    battingSide,
    bowlingSide: bowlSide,
    superOver,
    maxBalls: superOver ? 6 : s.setup.rules.overs * 6,
    maxWickets: superOver ? 2 : Math.min(10, bat.xi.length - 1),
    target,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    batters: { [ord[0]]: emptyBatter(ord[0], 0), [ord[1]]: emptyBatter(ord[1], 0) },
    order: [...ord],
    strikerId: ord[0],
    nonStrikerId: ord[1],
    bowlers: {},
    currentBowlerId: null,
    lastOverBowlerId: null,
    queuedBowlerId: null,
    overRuns: [],
    overWickets: [],
    overs: [],
    field: fieldFromTemplate(s, bowlSide, superOver ? bowl.tactics.fieldTemplateByPhase.death : bowl.tactics.fieldTemplateByPhase.powerplay),
    fieldOverridePhase: null,
    mirror: bowl.tactics.mirrorForLeftHanders,
    plan: clonePlan(bowl.tactics.bowlingPlan),
    intent: null,
    batterIntent: {},
    reviewsLeft: { batting: superOver ? 0 : s.setup.rules.reviews, bowling: superOver ? 0 : s.setup.rules.reviews },
    freeHit: false,
    fow: [],
    partnership: { runs: 0, balls: 0 },
    partnerships: [],
    complete: false,
    observed: { pace: { runs: 0, balls: 0, wickets: 0 }, spin: { runs: 0, balls: 0, wickets: 0 } },
    zoneRuns: [0, 0, 0, 0, 0, 0, 0, 0],
  };
  s.innings.push(inn);
}

export function createMatch(setup: MatchSetup, seed: string): MatchState {
  const rng = Rng.from(`match|${seed}`);
  const winner: Side = rng.chance(0.5) ? 'home' : 'away';
  const dew = setup.evening && rng.chance(setup.venue.dewChance);
  const dayForm: Record<string, number> = {};
  for (const p of [...setup.home.xi, ...setup.away.xi]) dayForm[p.id] = Math.round(clamp(rng.normal(0, 3), -7, 7) * 10) / 10;
  return {
    engineVersion: ENGINE_VERSION,
    seed,
    rng: rng.state(),
    setup,
    toss: { winner, decision: null },
    innings: [],
    status: 'toss',
    pending: null,
    pendingEvent: null,
    pendingMeta: null,
    seq: 0,
    deliveries: [],
    actions: [],
    result: null,
    dew,
    dayForm,
  };
}

// ------------------------------------------------------------------ actions

export interface ActionResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

/** Applies a tactical action for `side`. All actions are validated and logged for replay. */
export function applyAction(s: MatchState, side: Side, action: MatchAction, log = true): ActionResult {
  if (s.status === 'complete') return { ok: false, error: 'Match is complete.' };
  const inn = currentInnings(s);
  const res = applyActionInner(s, side, action, inn);
  if (res.ok && log) s.actions.push({ seq: s.seq, side, action } satisfies LoggedAction);
  return res;
}

function applyActionInner(s: MatchState, side: Side, action: MatchAction, inn: InningsState | null): ActionResult {
  switch (action.type) {
    case 'toss': {
      if (s.status !== 'toss' || s.toss.winner !== side) return { ok: false, error: 'You did not win the toss.' };
      s.toss.decision = action.decision;
      s.pending = null;
      return { ok: true };
    }
    case 'bowler': {
      if (!inn || inn.bowlingSide !== side) return { ok: false, error: 'Your side is not bowling.' };
      const eligible = eligibleBowlers(s, inn);
      if (!eligible.includes(action.playerId)) {
        const p = team(s, side).xi.find((x) => x.id === action.playerId);
        const b = inn.bowlers[action.playerId];
        if (!p) return { ok: false, error: 'Player is not in your XI.' };
        if (p.id === team(s, side).keeperId) return { ok: false, error: `${p.name} is keeping wicket.` };
        if (p.id === inn.lastOverBowlerId) return { ok: false, error: `${p.name} bowled the previous over — no consecutive overs.` };
        if (b && b.balls >= s.setup.rules.maxBowlerOvers * 6) return { ok: false, error: `${p.name} has completed the ${s.setup.rules.maxBowlerOvers}-over quota.` };
        return { ok: false, error: `${p.name} is not an available bowler.` };
      }
      if (inn.currentBowlerId === null) {
        autoPhaseField(s, inn); // idempotent; keeps replays identical whether or not a prompt was shown
        inn.currentBowlerId = action.playerId;
        inn.bowlers[action.playerId] ??= emptyBowler(action.playerId);
        if (s.pending?.kind === 'bowler') s.pending = null;
      } else {
        inn.queuedBowlerId = action.playerId;
      }
      return { ok: true };
    }
    case 'field': {
      if (!inn || inn.bowlingSide !== side) return { ok: false, error: 'Your side is not bowling.' };
      if (action.positions.length !== 9) return { ok: false, error: 'A field needs exactly 9 outfielders.' };
      for (const p of action.positions) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ok: false, error: 'Invalid coordinates.' };
      inn.field = {
        templateId: action.templateId ?? null,
        name: action.name ?? 'Custom field',
        positions: action.positions.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
        keeperUp: action.keeperUp,
      };
      inn.fieldOverridePhase = phaseOf(inn, s.setup.rules.powerplayOvers, s.setup.rules.overs);
      const v = validateField(inn.field.positions, 'R', {
        powerplay: inn.fieldOverridePhase === 'powerplay' && !inn.superOver,
        maxOutsidePP: s.setup.rules.maxOutsidePP,
        maxOutside: s.setup.rules.maxOutside,
        venue: s.setup.venue,
      });
      return { ok: true, warnings: [...v.errors.map((e) => `ILLEGAL: ${e} Deliveries will be called no-ball until fixed.`), ...v.warnings] };
    }
    case 'plan': {
      if (!inn || inn.bowlingSide !== side) return { ok: false, error: 'Your side is not bowling.' };
      const total = Object.values(action.plan.lengths).reduce((a, b) => a + (b ?? 0), 0);
      const totalL = Object.values(action.plan.lines).reduce((a, b) => a + (b ?? 0), 0);
      if (total <= 0 || totalL <= 0) return { ok: false, error: 'A bowling plan needs at least one length and one line.' };
      inn.plan = clonePlan({ ...action.plan, variation: clamp(action.plan.variation, 0, 1) });
      return { ok: true };
    }
    case 'intent': {
      if (!inn || inn.battingSide !== side) return { ok: false, error: 'Your side is not batting.' };
      const v = action.value === null ? null : clamp(action.value, 0, 1);
      if (action.batterId) {
        if (v === null) delete inn.batterIntent[action.batterId];
        else inn.batterIntent[action.batterId] = v;
      } else inn.intent = v;
      return { ok: true };
    }
    case 'order': {
      if (!inn || inn.battingSide !== side) return { ok: false, error: 'Your side is not batting.' };
      const batted = inn.order.filter((id) => inn.batters[id]);
      const remaining = inn.order.filter((id) => !inn.batters[id]);
      const proposed = action.order.filter((id) => !inn.batters[id]);
      if (proposed.length !== remaining.length || !remaining.every((id) => proposed.includes(id))) {
        return { ok: false, error: 'New order must contain exactly the batters yet to bat.' };
      }
      inn.order = [...batted, ...proposed];
      return { ok: true };
    }
    case 'mirror': {
      if (!inn || inn.bowlingSide !== side) return { ok: false, error: 'Your side is not bowling.' };
      inn.mirror = action.value;
      return { ok: true };
    }
    case 'review': {
      if (s.pending?.kind !== 'review' || s.pending.side !== side || !s.pendingEvent || !s.pendingMeta || !inn) {
        return { ok: false, error: 'No decision to review.' };
      }
      resolveReview(s, inn, s.pending.by, action.review);
      s.pending = null;
      return { ok: true };
    }
  }
}

// ------------------------------------------------------------------ stepping

export interface StepResult {
  event?: DeliveryEvent;
  needs?: Pending;
  done?: boolean;
}

export function step(s: MatchState, ctl: Controllers, captain: Captain): StepResult {
  if (s.status === 'complete') return { done: true };
  if (s.pending) return { needs: s.pending };

  if (s.status === 'toss') {
    const w = s.toss.winner;
    if (!s.toss.decision) {
      if (ctl[w] === 'manual') {
        s.pending = { kind: 'toss', side: w };
        return { needs: s.pending };
      }
      s.toss.decision = captain.tossDecision(s, w);
    }
    startInnings(s, s.toss.decision === 'bat' ? w : other(w), null, false);
    s.status = 'live';
  }

  const inn = currentInnings(s)!;
  if (inn.currentBowlerId === null) {
    const side = inn.bowlingSide;
    const eligible = eligibleBowlers(s, inn);
    if (ctl[side] === 'manual') {
      autoPhaseField(s, inn);
      if (inn.queuedBowlerId && eligible.includes(inn.queuedBowlerId)) {
        inn.currentBowlerId = inn.queuedBowlerId;
        inn.queuedBowlerId = null;
      } else {
        inn.queuedBowlerId = null;
        const suggestion = captain.chooseBowler(s, side);
        s.pending = { kind: 'bowler', side, suggestion, eligible };
        return { needs: s.pending };
      }
    } else {
      inn.currentBowlerId = captain.chooseBowler(s, side);
      const adj = captain.overStart(s, side);
      if (adj.field) inn.field = adj.field;
      if (adj.plan) inn.plan = adj.plan;
      if (adj.mirror !== undefined) inn.mirror = adj.mirror;
    }
    inn.bowlers[inn.currentBowlerId!] ??= emptyBowler(inn.currentBowlerId!);
  }

  const rng = new Rng(s.rng);
  const { ev, lbw } = deliver(s, inn, ctl, captain, rng);

  if (lbw) {
    // Decision Review System: the side wronged by the on-field call may review.
    const by: 'batting' | 'bowling' = lbw.umpireOut ? 'batting' : 'bowling';
    const reviewSide = by === 'batting' ? inn.battingSide : inn.bowlingSide;
    const left = by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
    const perceived = clamp(lbw.trueOut ? rng.range(0.45, 0.92) : rng.range(0.08, 0.55), 0, 1);
    if (left > 0) {
      if (ctl[reviewSide] === 'manual') {
        s.rng = rng.state();
        s.pendingEvent = ev;
        s.pendingMeta = { ...lbw, perceived };
        s.pending = {
          kind: 'review',
          side: reviewSide,
          by,
          reason: by === 'batting' ? 'Given out LBW. Review?' : 'Big LBW appeal turned down. Review?',
        };
        return { needs: s.pending, event: ev };
      }
      const wants = captain.review(s, reviewSide, ev, by === 'batting' ? perceived : perceived);
      s.pendingEvent = ev;
      s.pendingMeta = { ...lbw, perceived };
      s.rng = rng.state();
      resolveReview(s, inn, by, wants);
      return { event: ev };
    }
  }

  s.rng = rng.state();
  finalize(s, inn, ev, ctl, captain);
  return { event: ev };
}

function resolveReview(s: MatchState, inn: InningsState, by: 'batting' | 'bowling', review: boolean) {
  const ev = s.pendingEvent!;
  const meta = s.pendingMeta!;
  if (review) {
    const wrong = meta.umpireOut !== meta.trueOut;
    if (wrong) {
      ev.review = { by, overturned: true };
      if (meta.trueOut) {
        ev.wicket = {
          kind: 'lbw', playerOutId: ev.strikerId, bowlerId: ev.bowlerId, fielderId: null, text: '',
        };
        ev.umpireNote = 'Decision overturned on review — OUT';
      } else {
        ev.wicket = null;
        ev.umpireNote = 'Decision overturned on review — NOT OUT';
      }
    } else {
      ev.review = { by, overturned: false };
      if (by === 'batting') inn.reviewsLeft.batting--;
      else inn.reviewsLeft.bowling--;
      ev.umpireNote = 'Review unsuccessful — on-field decision stands';
    }
  }
  s.pendingEvent = null;
  s.pendingMeta = null;
  // The batting team never gets the ball wrongly removed: finalize the (possibly corrected) event.
  finalize(s, inn, ev, { home: 'ai', away: 'ai' }, null);
}

function autoPhaseField(s: MatchState, inn: InningsState) {
  const phase = phaseOf(inn, s.setup.rules.powerplayOvers, s.setup.rules.overs);
  if (inn.fieldOverridePhase === phase) return;
  const tmpl = team(s, inn.bowlingSide).tactics.fieldTemplateByPhase[phase];
  if (inn.field.templateId !== tmpl) inn.field = fieldFromTemplate(s, inn.bowlingSide, tmpl);
  inn.fieldOverridePhase = phase;
}

// ------------------------------------------------------------------ delivery resolution

interface Fielder {
  id: string;
  pos: FieldPoint;
  catching: number;
  ground: number;
  throwing: number;
  athleticism: number;
  keeper: boolean;
  bowler: boolean;
}

function assignFielders(s: MatchState, inn: InningsState, positions: FieldPoint[], bowlerId: string): Fielder[] {
  const t = team(s, inn.bowlingSide);
  const keeper = t.xi.find((p) => p.id === t.keeperId)!;
  const bowler = t.xi.find((p) => p.id === bowlerId)!;
  const outfield = t.xi.filter((p) => p.id !== keeper.id && p.id !== bowlerId);
  const slots = positions.map((pos, i) => {
    const d = Math.hypot(pos.x - STRIKER.x, pos.y - STRIKER.y);
    const kind = d < 18 ? 0 : insideCircle(pos) ? 1 : 2;
    return { pos, i, kind };
  });
  slots.sort((a, b) => a.kind - b.kind || a.i - b.i);
  const pool = [...outfield];
  const out: Fielder[] = [];
  for (const slot of slots) {
    if (!pool.length) break;
    const score = (p: MatchPlayer) =>
      slot.kind === 0 ? p.attrs.field.catching : slot.kind === 1 ? p.attrs.field.ground + p.attrs.field.athleticism * 0.5 : p.attrs.field.athleticism + p.attrs.field.throwing + p.attrs.field.catching * 0.5;
    pool.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const p = pool.shift()!;
    out.push(mkFielder(p, slot.pos, false, false));
  }
  out.push(mkFielder(keeper, { x: 0, y: inn.field.keeperUp ? SIM.keeperUpY : SIM.keeperBackY }, true, false));
  out.push(mkFielder(bowler, { x: 0.8, y: 5 }, false, true));
  return out;
}

function mkFielder(p: MatchPlayer, pos: FieldPoint, keeper: boolean, bowler: boolean): Fielder {
  const f = p.attrs.field;
  return {
    id: p.id, pos, keeper, bowler,
    catching: keeper ? Math.max(f.catching, f.keeping) : f.catching,
    ground: keeper ? Math.max(f.ground, f.keeping * 0.9) : f.ground,
    throwing: f.throwing,
    athleticism: f.athleticism,
  };
}

const reaction = (f: Fielder) => SIM.reactionBase - f.athleticism * SIM.reactionPerAthleticism;
const runSpeed = (f: Fielder) => SIM.runSpeedBase + f.athleticism * SIM.runSpeedPerAthleticism;
const groundReach = (f: Fielder) => SIM.groundReachBase + f.ground * SIM.groundReachPerSkill;
const catchReach = (f: Fielder) => SIM.catchReachBase + f.catching * SIM.catchReachPerSkill;
/** Time for a fielder to get under a catch `d` metres away (close catchers are already set). */
const aerialNeed = (f: Fielder, d: number) =>
  (d < 4 ? 0.08 : SIM.aerialReaction - f.athleticism * 0.002) + Math.max(0, d - catchReach(f)) / (runSpeed(f) * SIM.catchRunFactor);
const throwSpeed = (f: Fielder) => SIM.throwSpeedBase + f.throwing * SIM.throwSpeedPerSkill;
const dist = (a: FieldPoint, b: FieldPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function ballTime(v0: number, s: number): number {
  const a = SIM.groundDecel;
  const disc = v0 * v0 - 2 * a * s;
  if (disc <= 0) return v0 / a;
  return (v0 - Math.sqrt(disc)) / a;
}

interface RunContext {
  strikerRot: number;
  nonStrikerRot: number;
  intent: number;
  /** Soft-handed rotation shot: the call is early and the non-striker is backing up. */
  rotation: boolean;
}

interface FieldOutcome {
  runs: number;
  boundary: 4 | 6 | null;
  fielderId: string | null;
  end: FieldPoint;
  runOut: { batter: 'striker' | 'non-striker'; fielderId: string } | null;
  chance: DeliveryEvent['chance'];
  caughtBy: Fielder | null;
  runsSaved: number;
}

function runsFromCollection(
  at: FieldPoint, tGather: number, f: Fielder, rc: RunContext, rng: Rng,
): { runs: number; runOut: FieldOutcome['runOut'] } {
  const throwDist = Math.min(dist(at, STRIKER_END), dist(at, BOWLER_END));
  const tBack = tGather + throwDist / throwSpeed(f) + SIM.stumpBreakTime;
  const rot = (rc.strikerRot + rc.nonStrikerRot) / 2;
  const first = SIM.firstRunBase - rot * SIM.firstRunPerRotation - (rc.rotation ? SIM.rotationHeadStart : 0);
  const next = SIM.nextRunBase - rot * SIM.nextRunPerRotation;
  // Batters accept slightly negative margins: a run-out still needs an accurate throw.
  const safety = SIM.runSafetyBase - SIM.runSafetyIntent * rc.intent;
  let runs = 0;
  let cum = first;
  let lastSlack = Infinity;
  // Turning for a second or third run is a bigger risk, so batters want a clearer margin.
  while (runs < 3 && tBack - cum >= safety + (runs === 0 ? 0 : SIM.extraRunCaution)) {
    runs++;
    lastSlack = tBack - cum;
    cum += next;
  }
  if (runs > 0 && lastSlack < 0.25) {
    const accuracy = 0.35 + f.throwing / 250;
    const pOut = clamp((0.25 - lastSlack) * 0.2 * accuracy, 0, 0.45);
    if (rng.chance(pOut)) {
      const batter = rng.chance(0.5) ? 'striker' : 'non-striker';
      return { runs: runs - 1, runOut: { batter, fielderId: f.id } };
    }
  }
  return { runs, runOut: null };
}

function resolveGround(
  start: FieldPoint, dir: FieldPoint, v0: number, t0: number, fielders: Fielder[], venueDims: MatchSetup['venue'], rc: RunContext, rng: Rng, exclude: string | null,
): FieldOutcome {
  const a = SIM.groundDecel;
  const stop = (v0 * v0) / (2 * a);
  const bd = distanceToBoundary(start, dir, venueDims);
  const limit = Math.min(stop, bd);
  let best: { f: Fielder; s: number; t: number; lateral: number } | null = null;
  for (const f of fielders) {
    if (f.id === exclude) continue;
    const r = reaction(f);
    const rs = runSpeed(f);
    const reach = groundReach(f);
    for (let s = 1.5; s <= limit; s += 1.5) {
      const p = { x: start.x + dir.x * s, y: start.y + dir.y * s };
      const tb = t0 + ballTime(v0, s);
      if (best && tb >= best.t) break;
      const d = dist(f.pos, p);
      const need = r + Math.max(0, d - reach) / rs;
      if (need <= tb) {
        best = { f, s, t: tb, lateral: d };
        break;
      }
    }
  }
  const counterfactualRuns = () => {
    if (stop >= bd) return 4;
    return 1;
  };
  if (best) {
    const p = { x: start.x + dir.x * best.s, y: start.y + dir.y * best.s };
    const vAt = Math.sqrt(Math.max(0, v0 * v0 - 2 * a * best.s));
    const diving = best.lateral > groundReach(best.f) * 0.6;
    const pClean = clamp(0.975 - (vAt / 40) * 0.1 - (diving ? 0.08 : 0) + (best.f.ground - 60) / 700, 0.7, 0.995);
    const clean = rng.chance(pClean);
    // A fielder who had to move must stop, gather and set before throwing.
    const moved = Math.max(0, best.lateral - groundReach(best.f));
    const tGather = best.t + SIM.pickupTime + Math.min(0.7, moved * SIM.movingPickupPerMetre) + (clean ? 0 : 1.1);
    const deep = dist(p, STRIKER) > 45;
    if (!clean && deep && rng.chance(0.3)) {
      return { runs: 4, boundary: 4, fielderId: best.f.id, end: p, runOut: null, chance: null, caughtBy: null, runsSaved: 0 };
    }
    const rr = runsFromCollection(p, tGather, best.f, rc, rng);
    const cf = counterfactualRuns();
    return { runs: rr.runs, boundary: null, fielderId: best.f.id, end: p, runOut: rr.runOut, chance: rr.runOut ? { kind: 'run-out', fielderId: best.f.id, taken: true, difficulty: 'medium' } : null, caughtBy: null, runsSaved: Math.max(0, cf - rr.runs) };
  }
  if (stop >= bd) {
    const end = { x: start.x + dir.x * bd, y: start.y + dir.y * bd };
    return { runs: 4, boundary: 4, fielderId: null, end, runOut: null, chance: null, caughtBy: null, runsSaved: 0 };
  }
  // Ball stops in a gap; nearest fielder runs to it.
  const end = { x: start.x + dir.x * stop, y: start.y + dir.y * stop };
  const tStop = t0 + v0 / a;
  let chaser = fielders[0];
  let tReach = Infinity;
  for (const f of fielders) {
    if (f.id === exclude) continue;
    const t = reaction(f) + Math.max(0, dist(f.pos, end) - groundReach(f)) / runSpeed(f);
    if (t < tReach) {
      tReach = t;
      chaser = f;
    }
  }
  const rr = runsFromCollection(end, Math.max(tReach, tStop * 0.8) + SIM.pickupTime, chaser, rc, rng);
  return { runs: rr.runs, boundary: null, fielderId: chaser.id, end, runOut: rr.runOut, chance: rr.runOut ? { kind: 'run-out', fielderId: chaser.id, taken: true, difficulty: 'medium' } : null, caughtBy: null, runsSaved: 0 };
}

function resolveAerial(
  angle: number, hand: 'R' | 'L', carry: number, hang: number, fielders: Fielder[], venue: MatchSetup['venue'], rc: RunContext, rng: Rng, freeHit: boolean,
): FieldOutcome {
  const dir = direction(angle, hand);
  const bd = distanceToBoundary(STRIKER, dir, venue);
  const landing = { x: STRIKER.x + dir.x * carry, y: STRIKER.y + dir.y * carry };
  if (carry > bd) {
    const end = { x: STRIKER.x + dir.x * bd, y: STRIKER.y + dir.y * bd };
    if (carry < bd + 2.5) {
      // Can a boundary rider take it on the rope?
      const edge = { x: STRIKER.x + dir.x * (bd - 1), y: STRIKER.y + dir.y * (bd - 1) };
      let bestF: Fielder | null = null;
      let bestSlack = -Infinity;
      for (const f of fielders) {
        const need = aerialNeed(f, dist(f.pos, edge));
        const slack = hang * 0.92 - need;
        if (slack > bestSlack) {
          bestSlack = slack;
          bestF = f;
        }
      }
      if (bestF && bestSlack >= 0) {
        const p = clamp(SIM.catchBase + SIM.catchPerSkill * bestF.catching + SIM.catchSlackBonus * Math.min(bestSlack, 1.5) - SIM.boundaryCatchPenalty, 0.15, 0.9);
        const taken = rng.chance(p);
        if (taken && !freeHit) {
          return { runs: 0, boundary: null, fielderId: bestF.id, end: edge, runOut: null, chance: { kind: 'catch', fielderId: bestF.id, taken: true, difficulty: 'hard' }, caughtBy: bestF, runsSaved: 6 };
        }
        if (taken && freeHit) {
          return { runs: 0, boundary: null, fielderId: bestF.id, end: edge, runOut: null, chance: null, caughtBy: null, runsSaved: 6 };
        }
        return { runs: 6, boundary: 6, fielderId: bestF.id, end, runOut: null, chance: { kind: 'catch', fielderId: bestF.id, taken: false, difficulty: 'hard' }, caughtBy: null, runsSaved: 0 };
      }
    }
    return { runs: 6, boundary: 6, fielderId: null, end, runOut: null, chance: null, caughtBy: null, runsSaved: 0 };
  }
  // In-field catch?
  let bestF: Fielder | null = null;
  let bestSlack = -Infinity;
  let bestD = 0;
  for (const f of fielders) {
    if (f.bowler && carry > 30) continue;
    const d = dist(f.pos, landing);
    const need = aerialNeed(f, d);
    const slack = hang - need;
    if (slack > bestSlack) {
      bestSlack = slack;
      bestF = f;
      bestD = d;
    }
  }
  if (bestF && bestSlack >= 0) {
    const difficulty: 'easy' | 'medium' | 'hard' = bestSlack > 1.2 && bestD < 8 ? 'easy' : bestSlack > 0.4 ? 'medium' : 'hard';
    const run = Math.max(0, bestD - catchReach(bestF));
    const p = clamp(SIM.catchBase + SIM.catchPerSkill * bestF.catching + SIM.catchSlackBonus * Math.min(bestSlack, 1.5) - run * 0.012 - (difficulty === 'hard' ? 0.1 : 0), 0.2, 0.97);
    const taken = rng.chance(p);
    if (taken) {
      if (freeHit) return { runs: 0, boundary: null, fielderId: bestF.id, end: landing, runOut: null, chance: null, caughtBy: null, runsSaved: 0 };
      return { runs: 0, boundary: null, fielderId: bestF.id, end: landing, runOut: null, chance: { kind: 'catch', fielderId: bestF.id, taken: true, difficulty }, caughtBy: bestF, runsSaved: 0 };
    }
    // Dropped: the ball is near the fielder; batters scamper.
    const rr = runsFromCollection(landing, hang + 1.0, bestF, rc, rng);
    return { runs: rr.runs, boundary: null, fielderId: bestF.id, end: landing, runOut: rr.runOut, chance: { kind: 'catch', fielderId: bestF.id, taken: false, difficulty }, caughtBy: null, runsSaved: 0 };
  }
  // Lands safely, then runs on along the ground.
  const vLand = (carry / hang) * 0.42;
  const res = resolveGround(landing, dir, vLand, hang, fielders, venue, rc, rng, null);
  return res;
}

function weightedKey<K extends string>(rng: Rng, weights: Partial<Record<K, number>>, keys: K[]): K {
  return rng.weighted(keys, keys.map((k) => weights[k] ?? 0));
}

const VARIATIONS: Record<string, string[]> = {
  pace: ['slower ball', 'knuckle ball', 'off-cutter', 'leg-cutter'],
  OB: ['carrom ball', 'arm ball'],
  LB: ['googly', 'flipper'],
  SLA: ['arm ball', 'quicker one'],
  SLC: ['googly', 'quicker one'],
};

function gapScore(angle: number, aerial: boolean, hand: 'R' | 'L', fielders: Fielder[]): number {
  const dir = direction(angle, hand);
  let minSep = 90;
  for (const f of fielders) {
    if (f.keeper || f.bowler) continue;
    const v = { x: f.pos.x - STRIKER.x, y: f.pos.y - STRIKER.y };
    const d = Math.hypot(v.x, v.y);
    if (aerial && d < 30) continue; // ring fielders matter less for lofted hits
    if (!aerial && d > 50 && minSep < 90) continue;
    const cos = clamp((v.x * dir.x + v.y * dir.y) / d, -1, 1);
    const sep = (Math.acos(cos) * 180) / Math.PI;
    if (sep < minSep) minSep = sep;
  }
  return clamp(minSep / 22, 0, 1);
}

function deliver(
  s: MatchState, inn: InningsState, ctl: Controllers, captain: Captain, rng: Rng,
): { ev: DeliveryEvent; lbw: { trueOut: boolean; umpireOut: boolean } | null } {
  const { venue, rules } = s.setup;
  const bowler = playerById(s, inn.currentBowlerId!);
  const striker = playerById(s, inn.strikerId);
  const nonStriker = playerById(s, inn.nonStrikerId);
  const bowlStats = inn.bowlers[bowler.id];
  const phase = phaseOf(inn, rules.powerplayOvers, rules.overs);
  const spin = isSpin(bowler.bowlType);
  const hand = striker.batHand;
  const secondInnings = inn.index % 2 === 1;
  const dewNow = s.dew && secondInnings;

  // ----- field as it actually stands for this batter
  const useMirror = inn.mirror && hand === 'L';
  const rawPositions = useMirror ? inn.field.positions.map(mirror) : inn.field.positions;
  const legality = validateField(rawPositions, hand, {
    powerplay: phase === 'powerplay' && !inn.superOver,
    maxOutsidePP: rules.maxOutsidePP,
    maxOutside: rules.maxOutside,
  });
  const positions = fitToVenue(rawPositions, venue);
  const fielders = assignFielders(s, inn, positions, bowler.id);

  // ----- intent
  const batTeam = team(s, inn.battingSide);
  let intent: number;
  if (ctl[inn.battingSide] === 'manual') {
    intent = inn.batterIntent[striker.id] ?? inn.intent ?? batTeam.tactics.phaseIntent[phase];
  } else {
    intent = captain.battingIntent(s, inn.battingSide, striker.id);
  }
  intent = clamp(intent + rng.normal(0, 0.06), 0, 1);

  // ----- bowler condition
  const fatiguePenalty = bowlStats.spellFatigue * 0.22 + bowler.fatigue * 0.08;
  let control = bowler.attrs.bowl.control - fatiguePenalty + bowler.form * 0.6;
  if (dewNow) control -= spin ? SIM.dewControlPenaltySpin : SIM.dewControlPenaltyPace;
  // situational psychology + "day form" (a seeded good/bad day per player per match)
  const bowlPress = bowlerPressure(s, inn, bowler);
  const batPress = batterPressure(s, inn, striker);
  const bowlerDay = s.dayForm?.[bowler.id] ?? 0;
  control += bowlPress.controlAdj + bowlerDay * 0.6 + rng.normal(0, 2);

  // ----- intended delivery
  const plan = inn.plan;
  let length = weightedKey(rng, plan.lengths, LENGTHS);
  let line = weightedKey(rng, plan.lines, LINES);
  const useVariation = rng.chance(plan.variation * (0.4 + bowler.attrs.bowl.variation / 160));
  let variation: string | null = null;
  if (useVariation) variation = rng.pick(spin ? VARIATIONS[bowler.bowlType] ?? ['quicker one'] : VARIATIONS.pace);

  let pExec = SIM.executionBase + control * SIM.executionPerControl;
  if (length === 'yorker') pExec *= 0.62 + bowler.attrs.bowl.yorker * 0.0036;
  if (variation) pExec *= 0.88 + bowler.attrs.bowl.variation * 0.0012;
  pExec = clamp(pExec, 0.35, 0.97);

  let e: number; // delivery quality from the bowler's perspective, −1..+0.5
  let quality: DeliveryEvent['quality'];
  if (rng.chance(pExec)) {
    quality = 'executed';
    e = 0.08 + (control - 60) / 220;
    if (length === 'yorker') e += 0.18 + bowler.attrs.bowl.yorker / 600;
    if (variation) e += 0.1 + bowler.attrs.bowl.variation / 500;
    if (plan.pace === 'slower' && !spin) e += bowler.attrs.bowl.slower / 900;
  } else if (rng.chance(SIM.badBallShare)) {
    quality = 'loose';
    e = -0.85 + rng.range(-0.1, 0.15);
    length = rng.weighted(['full', 'short', 'full'], [0.45, 0.35, 0.2] as const) as Length;
    if (rng.chance(0.4)) line = rng.pick(['wide', 'leg'] as Line[]);
  } else {
    quality = 'slight-miss';
    e = -0.12;
    const i = LENGTHS.indexOf(length);
    length = LENGTHS[clamp(i + (rng.chance(0.5) ? 1 : -1), 0, LENGTHS.length - 1)];
  }

  // ----- speed
  let speed = spin ? bowler.attrs.bowl.speed + rng.normal(0, 2) : bowler.attrs.bowl.speed - bowlStats.spellFatigue * 0.08 + rng.normal(0, 2.2);
  if (!spin && (variation === 'slower ball' || variation === 'knuckle ball' || variation?.includes('cutter') || plan.pace === 'slower')) speed *= 0.84;
  if (plan.pace === 'quicker' && !spin) speed += 3;
  speed = Math.round(speed * 10) / 10;

  // ----- extras
  const seq = ++s.seq;
  const overBefore = Math.floor(inn.legalBalls / 6);
  const pWide = SIM.wideBase + Math.max(0, 100 - control) * SIM.widePerControlDeficit + (line === 'wide' ? 0.035 : 0) + (line === 'leg' ? 0.02 : 0) + (length === 'yorker' ? 0.008 : 0) + (spin ? -0.008 : 0) + (dewNow ? 0.006 : 0) + (length === 'short' && !spin ? 0.01 : 0);
  const base: Omit<DeliveryEvent, 'commentary' | 'scoreAfter' | 'winProbHome'> = {
    seq, innings: inn.index, over: overBefore, ball: (inn.legalBalls % 6) + 1, legal: true,
    bowlerId: bowler.id, strikerId: striker.id, nonStrikerId: nonStriker.id,
    length, line, speed, variation, quality, shot: null, contact: 'miss', angle: null, end: null, aerial: false, zone: null,
    batRuns: 0, extras: null, totalRuns: 0, boundary: null, wicket: null, fielderId: null, chance: null, runsSaved: 0,
    freeHit: inn.freeHit, illegalField: !legality.legal, review: null, umpireNote: null,
    pressure: { batter: Math.round(batPress.index * 100) / 100, bowler: Math.round(bowlPress.index * 100) / 100, reasons: [...batPress.reasons, ...bowlPress.reasons] },
  };

  if (rng.chance(clamp(pWide, 0.005, 0.2))) {
    const extraRuns = rng.chance(0.012 * (1 - team(s, inn.bowlingSide).xi.find((p) => p.id === team(s, inn.bowlingSide).keeperId)!.attrs.field.keeping / 140)) ? 5 : 1;
    const ev = { ...base, legal: false, ball: inn.legalBalls % 6, contact: 'leave' as const, extras: { kind: 'wide' as const, runs: extraRuns }, totalRuns: extraRuns, boundary: null };
    return { ev: ev as DeliveryEvent, lbw: null };
  }
  const noBall = !legality.legal || rng.chance(SIM.noBallBase + Math.max(0, 100 - control) * SIM.noBallPerControlDeficit);
  if (!legality.legal) base.umpireNote = `No-ball: illegal field (${legality.errors[0]})`;
  if (noBall) {
    base.legal = false;
    base.ball = inn.legalBalls % 6;
    base.extras = { kind: 'no-ball', runs: 1 };
  }
  const freeHit = inn.freeHit || noBall;

  // ----- skills
  const balls = inn.batters[striker.id].balls;
  const setAdj = balls < SIM.newBatterBalls ? -SIM.newBatterPenalty * (1 - balls / SIM.newBatterBalls) : balls > 20 ? SIM.setBatterBonus : 0;
  const phaseBat = striker.attrs.bat[phase];
  let batSkill = 0.75 * (spin ? striker.attrs.bat.vsSpin : striker.attrs.bat.vsPace) + 0.25 * phaseBat + striker.form * SIM.formWeight + setAdj + (striker.morale - 60) * 0.04 - striker.fatigue * 0.05;
  batSkill += batPress.skillAdj + (s.dayForm?.[striker.id] ?? 0) + rng.normal(0, 2.5);
  batSkill += venue.pitch.batting * 4 + (dewNow ? 2 : 0);

  const b = bowler.attrs.bowl;
  const bowlPhase = phase === 'powerplay' ? b.powerplay : phase === 'death' ? b.death : (b.powerplay + b.death) / 2;
  const wear = venue.pitch.wear * inn.index;
  const assist = spin ? venue.pitch.spin + wear : venue.pitch.pace + (overBefore < 3 && !inn.superOver ? 0.35 : 0);
  let bowlSkill = spin
    ? 0.34 * control + 0.32 * b.movement + 0.18 * b.variation + 0.16 * bowlPhase
    : 0.3 * control + 0.26 * b.movement + 0.1 * b.variation + 0.14 * speedScore(speed) + 0.2 * bowlPhase;
  bowlSkill += assist * 6 + bowlPress.skillAdj + bowlerDay + rng.normal(0, 2.5);
  const delta = (batSkill - bowlSkill) / 32;
  const movementThreat = clamp(((b.movement - 50) / 50) * 0.5 + assist * 0.5, -1, 1.2);

  // ----- shot selection
  const kind = spin ? 'spin' : 'pace';
  const candidates = SHOTS.filter((sh) => !sh.only || sh.only === kind);
  const iq = (striker.attrs.mental.adaptability / 100) * 0.5 + batTeam.tacticalQuality * 0.5;
  const tags = striker.tags;
  const weights = candidates.map((sh) => {
    const ls = sh.lengths[length] ?? -0.8;
    const li = sh.lines[line] ?? -0.5;
    let w = Math.exp(SIM.lengthSuitWeight * ls + SIM.lineSuitWeight * li - SIM.intentSharpness * (intent - sh.intent) ** 2);
    if (sh.id !== 'leave' && sh.id !== 'defend') {
      const g = gapScore(shotAngle(sh, line), sh.aerial >= 0.5, hand, fielders);
      w *= 1 + iq * (sh.aerial >= 0.5 ? 0.6 : 1.1) * (g - 0.45);
    }
    if (tags.includes('360') && ['scoop', 'ramp', 'reverse', 'upper-cut'].includes(sh.id)) w *= 2.2;
    if (tags.includes('power') && ['loft', 'slog', 'slog-sweep', 'pull'].includes(sh.id)) w *= 1.5;
    if (tags.includes('anchor') && ['push', 'drive', 'defend', 'late-cut', 'glance'].includes(sh.id)) w *= 1.35;
    if (tags.includes('sweeper') && ['sweep', 'reverse', 'slog-sweep'].includes(sh.id)) w *= 1.8;
    if (freeHit && sh.aerial >= 0.5) w *= 3;
    return Math.max(1e-6, w);
  });
  const shot: ShotDef = rng.weighted(candidates, weights);
  base.shot = shot.id;
  const suit = 0.6 * (shot.lengths[length] ?? -0.8) + 0.4 * (shot.lines[line] ?? -0.5);
  const rc: RunContext = { strikerRot: striker.attrs.bat.rotation, nonStrikerRot: nonStriker.attrs.bat.rotation, intent, rotation: !!shot.rotation };
  const keeper = fielders.find((f) => f.keeper)!;

  const finish = (partial: Partial<DeliveryEvent>): DeliveryEvent => {
    const ev = { ...base, ...partial } as DeliveryEvent;
    const nb = ev.extras?.kind === 'no-ball' ? 1 : 0;
    const extraRuns = ev.extras && ev.extras.kind !== 'no-ball' ? ev.extras.runs : 0;
    ev.totalRuns = ev.batRuns + nb + extraRuns;
    if (ev.extras?.kind === 'no-ball' && ev.extras.runs !== 1) ev.extras.runs = 1;
    if (freeHit && ev.wicket && ev.wicket.kind !== 'run out') ev.wicket = null;
    return ev;
  };

  // ----- leave
  if (shot.id === 'leave') {
    if (line === 'stumps' && ['yorker', 'full', 'good'].includes(length) && rng.chance(0.55)) {
      return { ev: finish({ contact: 'leave', wicket: { kind: 'bowled', playerOutId: striker.id, bowlerId: bowler.id, fielderId: null, text: '' } }), lbw: null };
    }
    return { ev: finish({ contact: 'leave' }), lbw: null };
  }

  // ----- beaten?
  const pMiss = sigmoid(SIM.missBias + SIM.missRisk * shot.risk - SIM.missSkill * delta - SIM.missSuit * suit + SIM.missDelivery * e + SIM.missMovement * movementThreat - (shot.id === 'defend' ? 0.5 : 0));
  if (rng.chance(pMiss)) {
    const lengthHit: Record<Length, number> = { yorker: 1.35, full: 1.1, good: 1, back: 0.45, short: 0.05 };
    const lineHit = line === 'stumps' ? SIM.hitStumpsOnStumpsLine : line === 'off' ? SIM.hitStumpsOnOffLine : 0;
    const wouldHit = rng.chance(clamp(lineHit * lengthHit[length], 0, 0.95));
    // Stumping: spinner, batter charging for a big shot, keeper up.
    if (spin && inn.field.keeperUp && shot.aerial >= 0.5 && rng.chance(0.55)) {
      const p = SIM.stumpingChance * (keeper.catching / 100) * 1.2;
      if (rng.chance(p) && !freeHit) {
        return { ev: finish({ contact: 'miss', wicket: { kind: 'stumped', playerOutId: striker.id, bowlerId: bowler.id, fielderId: keeper.id, text: '' }, chance: { kind: 'stumping', fielderId: keeper.id, taken: true, difficulty: 'medium' }, fielderId: keeper.id }), lbw: null };
      }
    }
    if (wouldHit) {
      const bowledShare = length === 'yorker' ? 0.75 : shot.id === 'defend' || shot.id === 'drive' ? 0.65 : 0.58;
      if (rng.chance(bowledShare)) {
        return { ev: finish({ contact: 'miss', wicket: { kind: 'bowled', playerOutId: striker.id, bowlerId: bowler.id, fielderId: null, text: '' } }), lbw: null };
      }
      // LBW — umpire may miss it.
      const umpireOut = rng.chance(1 - SIM.umpireMissRate);
      const ev = finish({ contact: 'miss', wicket: umpireOut ? { kind: 'lbw', playerOutId: striker.id, bowlerId: bowler.id, fielderId: null, text: '' } : null, umpireNote: umpireOut ? null : 'Big appeal for LBW — not out' });
      return { ev, lbw: freeHit ? null : { trueOut: true, umpireOut } };
    }
    // Pad contact that would miss the stumps.
    const padHit = (line === 'stumps' || line === 'leg' || line === 'off') && ['full', 'good', 'yorker'].includes(length) && rng.chance(0.35);
    if (padHit) {
      if ((line === 'stumps' || line === 'off') && rng.chance(SIM.umpireFalseOutRate / 0.35)) {
        const ev = finish({ contact: 'miss', wicket: { kind: 'lbw', playerOutId: striker.id, bowlerId: bowler.id, fielderId: null, text: '' }, umpireNote: null });
        return { ev, lbw: freeHit ? null : { trueOut: false, umpireOut: true } };
      }
      if (rng.chance(0.3)) {
        return { ev: finish({ contact: 'miss', extras: noBall ? base.extras : { kind: 'leg-bye', runs: 1 }, batRuns: 0 }), lbw: null };
      }
      if (line !== 'leg' && rng.chance(0.25)) {
        const ev = finish({ contact: 'miss', umpireNote: 'Appeal for LBW — not out' });
        return { ev, lbw: freeHit ? null : { trueOut: false, umpireOut: false } };
      }
    }
    const byeChance = 0.006 + (1 - keeper.catching / 100) * 0.02 * (inn.field.keeperUp && !spin ? 3 : 1);
    if (rng.chance(byeChance) && !noBall) {
      const four = rng.chance(0.15);
      return { ev: finish({ contact: 'miss', extras: { kind: 'bye', runs: four ? 4 : 1 }, boundary: null }), lbw: null };
    }
    return { ev: finish({ contact: 'miss' }), lbw: null };
  }

  // ----- edge?
  const edgeLine = line === 'off' || line === 'wide' || (line === 'stumps' && rng.chance(0.5));
  const pEdge = sigmoid(SIM.edgeBias + SIM.edgeRisk * shot.risk - SIM.edgeSkill * delta + SIM.edgeMovement * movementThreat + 0.4 * e - 0.3 * suit) * (spin ? 0.6 : 1) * (edgeLine ? 1 : 0.35);
  if (shot.id !== 'defend' || rng.chance(0.6)) {
    if (rng.chance(pEdge)) {
      const outside = edgeLine && rng.chance(0.82);
      const angle = outside ? rng.range(148, 176) : -rng.range(150, 172);
      if (!outside && rng.chance(0.12) && line !== 'leg') {
        return { ev: finish({ contact: 'edge', angle, wicket: { kind: 'bowled', playerOutId: striker.id, bowlerId: bowler.id, fielderId: null, text: '' }, umpireNote: 'Inside edge onto the stumps' }), lbw: null };
      }
      const paceFactor = spin ? 0.45 : speed / 140;
      const carry = rng.range(6, 26) * paceFactor + (shot.power > 0.6 ? 6 : 0);
      const hang = 0.45 + carry / 45;
      const res = resolveAerial(angle, hand, carry, hang, fielders, venue, rc, rng, freeHit);
      const dir = direction(angle, hand);
      const wicket: Dismissal | null = res.caughtBy
        ? { kind: res.caughtBy.keeper ? 'caught behind' : 'caught', playerOutId: striker.id, bowlerId: bowler.id, fielderId: res.caughtBy.id, text: '' }
        : null;
      const ro = runOutDismissal(res.runOut, striker.id, nonStriker.id);
      return {
        ev: finish({
          contact: 'edge', angle, aerial: true, end: res.end ?? { x: STRIKER.x + dir.x * carry, y: STRIKER.y + dir.y * carry }, zone: zoneOf(angle),
          batRuns: res.runs, boundary: res.boundary, fielderId: res.fielderId, chance: res.chance, runsSaved: res.runsSaved,
          wicket: wicket ?? ro,
        }),
        lbw: null,
      };
    }
  }

  // ----- contact quality
  const dewBonus = dewNow ? 0.03 : 0;
  let q = rng.normal(
    SIM.qualityMean + SIM.qualitySkill * delta + SIM.qualitySuit * suit - SIM.qualityDelivery * e - SIM.qualityRisk * (shot.risk - 0.2) + venue.pitch.batting * 0.03 + dewBonus,
    SIM.qualitySd,
  );
  q = clamp(q, 0.02, 1);
  const contact: DeliveryEvent['contact'] = q < 0.33 ? 'mistimed' : q < 0.66 ? 'good' : 'middle';
  let angle = shotAngle(shot, line) + rng.normal(0, shot.sd * (q < 0.33 ? 1.7 : 1));
  if (shot.id === 'defend') angle = rng.normal(0, 55);
  const aerial = shot.aerial >= 1 || rng.chance(clamp(shot.aerial + (q < 0.33 ? 0.22 : 0) + intent * 0.06, 0, 1));
  const power = striker.attrs.bat.power;
  const alt = 1 + venue.altitude / 9000;
  const paceOn = spin ? 0 : (speed - 115) * 0.04;
  let res: FieldOutcome;
  const dir = direction(angle, hand);
  if (aerial && shot.id !== 'defend') {
    let carry = (SIM.carryBase + SIM.carryPerPower * power) * shot.power * (SIM.carryQualityFloor + SIM.carryQualityGain * q) * alt + paceOn * shot.power;
    if (q < 0.33) carry *= 0.72;
    const hang = 0.42 + carry * 0.027 + (q < 0.33 ? 0.9 : 0) + (shot.id === 'scoop' || shot.id === 'ramp' ? -0.3 : 0);
    res = resolveAerial(angle, hand, carry, hang, fielders, venue, rc, rng, freeHit);
  } else {
    let v0 = (SIM.groundSpeedBase + SIM.groundSpeedPerPower * power) * shot.power * (SIM.groundQualityFloor + SIM.groundQualityGain * q) + paceOn * shot.power * 1.5;
    if (shot.id === 'defend') v0 = rng.range(2, 7);
    res = resolveGround(STRIKER, dir, Math.max(1, v0), 0, fielders, venue, rc, rng, null);
  }
  const wicket: Dismissal | null = res.caughtBy
    ? { kind: res.caughtBy.keeper ? 'caught behind' : 'caught', playerOutId: striker.id, bowlerId: bowler.id, fielderId: res.caughtBy.id, text: '' }
    : runOutDismissal(res.runOut, striker.id, nonStriker.id);
  return {
    ev: finish({
      contact, angle: Math.round(angle), aerial, end: res.end, zone: zoneOf(angle), batRuns: res.runs, boundary: res.boundary,
      fielderId: res.fielderId, chance: res.chance, runsSaved: res.runsSaved, wicket,
    }),
    lbw: null,
  };
}

function runOutDismissal(ro: FieldOutcome['runOut'], strikerId: string, nonStrikerId: string): Dismissal | null {
  if (!ro) return null;
  return { kind: 'run out', playerOutId: ro.batter === 'striker' ? strikerId : nonStrikerId, bowlerId: null, fielderId: ro.fielderId, text: '' };
}

// ------------------------------------------------------------------ applying a delivery

function dismissalText(s: MatchState, d: Dismissal): string {
  const n = (id: string | null) => (id ? playerById(s, id).shortName : '');
  switch (d.kind) {
    case 'bowled': return `b ${n(d.bowlerId)}`;
    case 'lbw': return `lbw b ${n(d.bowlerId)}`;
    case 'caught': return d.fielderId === d.bowlerId ? `c & b ${n(d.bowlerId)}` : `c ${n(d.fielderId)} b ${n(d.bowlerId)}`;
    case 'caught behind': return `c †${n(d.fielderId)} b ${n(d.bowlerId)}`;
    case 'stumped': return `st †${n(d.fielderId)} b ${n(d.bowlerId)}`;
    case 'run out': return `run out (${n(d.fielderId)})`;
  }
}

function finalize(s: MatchState, inn: InningsState, ev: DeliveryEvent, ctl: Controllers, captain: Captain | null) {
  const bowler = inn.bowlers[ev.bowlerId];
  const batter = inn.batters[ev.strikerId];
  const bp = playerById(s, ev.bowlerId);
  const kind = isSpin(bp.bowlType) ? 'spin' : 'pace';
  const isWide = ev.extras?.kind === 'wide';
  const isNoBall = ev.extras?.kind === 'no-ball';

  inn.runs += ev.totalRuns;
  if (ev.extras) {
    if (ev.extras.kind === 'wide') inn.extras.wides += ev.extras.runs;
    if (ev.extras.kind === 'no-ball') inn.extras.noBalls += 1;
    if (ev.extras.kind === 'bye') inn.extras.byes += ev.extras.runs;
    if (ev.extras.kind === 'leg-bye') inn.extras.legByes += ev.extras.runs;
  }
  const conceded = ev.batRuns + (isWide ? ev.extras!.runs : 0) + (isNoBall ? 1 : 0);
  bowler.runs += conceded;
  if (isWide) bowler.wides += ev.extras!.runs;
  if (isNoBall) bowler.noBalls += 1;
  if (ev.legal) {
    bowler.balls += 1;
    bowler.spellFatigue += kind === 'pace' ? SIM.fatiguePerOverPace / 6 : SIM.fatiguePerOverSpin / 6;
    if (ev.totalRuns === 0) bowler.dots += 1;
  }
  if (!isWide) {
    batter.balls += 1;
    batter.runs += ev.batRuns;
    if (ev.batRuns === 0 && ev.legal) batter.dots += 1;
    if (ev.boundary === 4 && ev.batRuns === 4) batter.fours += 1;
    if (ev.boundary === 6) batter.sixes += 1;
    if (ev.boundary === 4 && ev.batRuns === 4) bowler.fours += 1;
    if (ev.boundary === 6) bowler.sixes += 1;
    inn.observed[kind].balls += 1;
    inn.observed[kind].runs += ev.batRuns;
  }
  if (ev.zone !== null && ev.batRuns > 0) inn.zoneRuns[ev.zone] += ev.batRuns;
  inn.partnership.runs += ev.totalRuns;
  if (ev.legal) inn.partnership.balls += 1;
  if (ev.legal) inn.legalBalls += 1;

  // strike rotation from runs actually run
  const ranRuns = ev.boundary ? 0 : ev.batRuns + (ev.extras && (ev.extras.kind === 'bye' || ev.extras.kind === 'leg-bye') ? ev.extras.runs : 0) + (isWide && ev.extras!.runs > 1 && ev.extras!.runs !== 5 ? ev.extras!.runs - 1 : 0);
  if (ranRuns % 2 === 1) [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];

  if (ev.wicket) {
    const w = ev.wicket;
    w.text = dismissalText(s, w);
    const outB = inn.batters[w.playerOutId];
    outB.out = { ...w, seq: ev.seq };
    inn.wickets += 1;
    if (w.kind !== 'run out') {
      bowler.wickets += 1;
      inn.observed[kind].wickets += 1;
    }
    inn.fow.push({ wicket: inn.wickets, runs: inn.runs, balls: inn.legalBalls, playerId: w.playerOutId });
    inn.partnerships.push({ a: inn.strikerId, b: inn.nonStrikerId, runs: inn.partnership.runs, balls: inn.partnership.balls });
    inn.partnership = { runs: 0, balls: 0 };
    if (inn.wickets < inn.maxWickets) {
      if (captain && ctl[inn.battingSide] === 'ai') {
        const ord = captain.battingOrder(s, inn.battingSide);
        if (ord) {
          const batted = inn.order.filter((id) => inn.batters[id]);
          const rest = ord.filter((id) => !inn.batters[id]);
          if (rest.length === inn.order.length - batted.length) inn.order = [...batted, ...rest];
        }
      }
      const next = inn.order.find((id) => !inn.batters[id]);
      if (next) {
        inn.batters[next] = emptyBatter(next, inn.legalBalls);
        if (w.playerOutId === inn.strikerId) inn.strikerId = next;
        else inn.nonStrikerId = next;
      }
    }
  }

  inn.freeHit = isNoBall ? true : ev.legal ? false : inn.freeHit;

  const overDone = ev.legal && inn.legalBalls % 6 === 0;
  const inningsDone = inn.wickets >= inn.maxWickets || inn.legalBalls >= inn.maxBalls || (inn.target !== null && inn.runs >= inn.target);

  ev.scoreAfter = { runs: inn.runs, wickets: inn.wickets };
  s.deliveries.push(ev);

  if (overDone || (inningsDone && inn.currentBowlerId)) closeOver(s, inn, ev, !overDone);
  if (overDone && !inningsDone) [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];

  if (inningsDone) {
    inn.complete = true;
    afterInnings(s);
  }
  ev.winProbHome = winProbabilityHome(s);
  ev.commentary = commentaryFor(s, ev);
}

function closeOver(s: MatchState, inn: InningsState, last: DeliveryEvent, partial: boolean) {
  const overIdx = partial ? Math.floor(inn.legalBalls / 6) : inn.legalBalls / 6 - 1;
  const evs = s.deliveries.filter((d) => d.innings === inn.index && d.over === overIdx);
  const bowler = inn.bowlers[last.bowlerId];
  const runs = evs.reduce((a, d) => a + d.totalRuns, 0);
  const conceded = evs.reduce((a, d) => a + d.batRuns + (d.extras?.kind === 'wide' ? d.extras.runs : 0) + (d.extras?.kind === 'no-ball' ? 1 : 0), 0);
  if (!partial && conceded === 0) bowler.maidens += 1;
  const zoneRuns = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const d of evs) if (d.zone !== null && d.batRuns > 0) zoneRuns[d.zone] += d.batRuns;
  const summary: OverSummary = {
    innings: inn.index,
    over: overIdx,
    bowlerId: last.bowlerId,
    runs,
    wickets: evs.filter((d) => d.wicket).length,
    zoneRuns,
    boundaries: evs.filter((d) => d.boundary).length,
    dots: evs.filter((d) => d.legal && d.totalRuns === 0).length,
    singles: evs.filter((d) => d.batRuns === 1).length,
    chances: evs.filter((d) => d.chance).length,
    dropped: evs.filter((d) => d.chance && !d.chance.taken).length,
    runsSaved: Math.round(evs.reduce((a, d) => a + d.runsSaved, 0)),
    extras: evs.reduce((a, d) => a + (d.extras ? (d.extras.kind === 'no-ball' ? 1 : d.extras.runs) : 0), 0),
    fieldName: inn.field.name,
    analysis: [],
  };
  summary.analysis = overAnalysis(s, inn, summary);
  inn.overs.push(summary);
  inn.overRuns.push(runs);
  inn.overWickets.push(summary.wickets);
  // spell fatigue recovery for everyone not bowling this over
  for (const b of Object.values(inn.bowlers)) if (b.playerId !== last.bowlerId) b.spellFatigue = Math.max(0, b.spellFatigue - 3);
  inn.lastOverBowlerId = last.bowlerId;
  inn.currentBowlerId = null;
}

function overAnalysis(s: MatchState, inn: InningsState, o: OverSummary): string[] {
  const out: string[] = [];
  const positions = inn.field.positions;
  o.zoneRuns.forEach((r, z) => {
    if (r >= 6) {
      // Is there anyone protecting that zone in the deep? (right-hander orientation)
      const covered = positions.some((p) => {
        const ang = (Math.atan2(p.x, p.y - STRIKER.y) * 180) / Math.PI;
        return zoneOf(ang) === z && Math.hypot(p.x, p.y - STRIKER.y) > 40;
      });
      out.push(`${r} runs through ${ZONES[z]}${covered ? '' : ' — no boundary rider there'}.`);
    }
  });
  if (o.runsSaved >= 3) out.push(`Field placements saved an estimated ${o.runsSaved} runs.`);
  if (o.dropped) out.push(`${o.dropped} chance${o.dropped > 1 ? 's' : ''} put down.`);
  if (o.chances && !o.dropped) out.push(`${o.chances} chance${o.chances > 1 ? 's' : ''} created.`);
  if (o.dots >= 4) out.push(`${o.dots} dot balls — pressure building.`);
  if (o.extras >= 3) out.push(`${o.extras} extras conceded.`);
  return out;
}

function afterInnings(s: MatchState) {
  const inn = currentInnings(s)!;
  const { rules } = s.setup;
  if (!inn.superOver && inn.index === 0) {
    startInnings(s, inn.bowlingSide, inn.runs + 1, false);
    return;
  }
  if (inn.superOver && inn.target === null) {
    startInnings(s, inn.bowlingSide, inn.runs + 1, true, superOverOrder(s, inn.bowlingSide));
    return;
  }
  // A chase (main innings or super over) has finished.
  const first = s.innings[inn.index - 1];
  if (inn.runs >= inn.target!) return finishMatch(s, inn.battingSide, inn);
  if (inn.runs < first.runs) return finishMatch(s, first.battingSide, inn);
  // Tie: the side that batted second bats first in the super over.
  const superOvers = s.innings.filter((i) => i.superOver).length / 2;
  if (rules.superOver && superOvers < 3) {
    startInnings(s, inn.battingSide, null, true, superOverOrder(s, inn.battingSide));
    return;
  }
  if (rules.superOver) {
    const b = (side: Side) => s.deliveries.filter((d) => d.boundary && s.innings[d.innings].battingSide === side).length;
    const winner: Side | null = b('home') === b('away') ? null : b('home') > b('away') ? 'home' : 'away';
    return finishMatch(s, winner, inn, 'on boundary count');
  }
  finishMatch(s, null, inn);
}

function superOverOrder(s: MatchState, side: Side): string[] {
  const xi = [...team(s, side).xi];
  xi.sort((a, b) => b.attrs.bat.power + b.attrs.bat.death - (a.attrs.bat.power + a.attrs.bat.death) || a.id.localeCompare(b.id));
  return xi.map((p) => p.id);
}

function finishMatch(s: MatchState, winner: Side | null, last: InningsState, note?: string) {
  const superOver = last.superOver;
  let margin: string;
  if (!winner) margin = 'Match tied';
  else if (note) margin = `won ${note}`;
  else if (superOver) margin = 'won the Super Over';
  else if (winner === last.battingSide) {
    const wl = last.maxWickets - last.wickets;
    const bl = last.maxBalls - last.legalBalls;
    margin = `won by ${wl} wicket${wl === 1 ? '' : 's'} (${bl} ball${bl === 1 ? '' : 's'} left)`;
  } else {
    const first = s.innings[last.index - 1];
    const r = first.runs - last.runs;
    margin = `won by ${r} run${r === 1 ? '' : 's'}`;
  }
  s.status = 'complete';
  s.result = { winner, margin, superOver, playerOfMatch: null };
  s.result.playerOfMatch = playerOfMatch(s);
}

/** Player of the Match from the configurable contribution model (see award.ts). */
export function playerOfMatch(s: MatchState): string | null {
  return choosePlayerOfMatch(s);
}
