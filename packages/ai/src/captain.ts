import type { BowlingPlan } from '@kurciv/domain';
import { isSpin } from '@kurciv/domain';
import {
  currentInnings, eligibleBowlers, formatOf, hash01, matchBallsUsed, phaseFor, playerById, sideTotals, team,
  type Captain, type DeliveryEvent, type InningsState, type MatchPlayer, type MatchState, type Side,
} from '@kurciv/simulation';

/**
 * Tactical AI. Rule-based constraints + utility scoring + light opponent modelling.
 * It only reads information a real captain would have: visible match state, observed
 * scoring patterns and scouting tendencies — never hidden RNG or future outcomes.
 * Lower `tacticalQuality` adds decision noise and slower adaptation; it never changes
 * player abilities.
 */

const noise = (s: MatchState, side: Side, key: string) => {
  const q = s.setup[side].tacticalQuality;
  return (hash01(`${s.seed}|${s.seq}|${key}`) - 0.5) * 2 * (1 - q) * 14;
};

function bowlerScore(s: MatchState, inn: InningsState, p: MatchPlayer): number {
  const phase = phaseFor(s, inn);
  const b = p.attrs.bowl;
  const spin = isSpin(p.bowlType);
  const striker = playerById(s, inn.strikerId);
  const venue = s.setup.venue;
  const stats = inn.bowlers[p.id];
  let score = 0.35 * b.control + 0.25 * b.movement + 0.15 * b.variation;
  if (phase === 'powerplay') score += 0.35 * b.powerplay + (spin ? -6 : 4) + (spin ? 0 : b.movement * 0.08);
  else if (phase === 'death') score += 0.4 * b.death + 0.15 * b.yorker + (spin ? -5 : 3);
  else score += spin ? 8 : 0;
  // conditions
  score += (spin ? venue.pitch.spin + venue.pitch.wear * inn.index : venue.pitch.pace) * 8;
  if (s.dew && inn.index % 2 === 1 && spin) score -= 6;
  // matchup with striker: turning away from the bat is better
  const awayFromBat = (p.bowlType === 'OB' && striker.batHand === 'L') || ((p.bowlType === 'LB' || p.bowlType === 'SLA') && striker.batHand === 'R');
  if (spin) score += (awayFromBat ? 4 : -1) + (60 - striker.attrs.bat.vsSpin) * 0.25;
  else score += (60 - striker.attrs.bat.vsPace) * 0.25;
  // in-match adaptation: how has the batting side handled this bowling type?
  const kind = spin ? 'spin' : 'pace';
  const obs = inn.observed[kind];
  const q = s.setup[inn.bowlingSide].tacticalQuality;
  if (obs.balls >= 6) {
    const rpb = obs.runs / obs.balls;
    score -= (rpb - 1.35) * 12 * q;
  }
  // season scouting of this opponent
  const tend = s.setup[inn.battingSide].tendencies;
  if (tend) score -= ((spin ? tend.vsSpin : tend.vsPace) - 1.35) * 8 * q;
  // today's figures
  if (stats && stats.balls >= 6) score -= ((stats.runs / stats.balls) * 6 - 8) * 1.2 - stats.wickets * 2;
  if (stats) score -= stats.spellFatigue * 0.8;
  score += p.form * 0.5;
  return score;
}

function feasibleAfter(s: MatchState, inn: InningsState, chosen: string): boolean {
  const quota = s.setup.rules.maxBowlerOvers;
  const oversLeft = Math.ceil((inn.maxBalls - inn.legalBalls) / 6) - 1;
  if (oversLeft <= 0) return true;
  const xi = team(s, inn.bowlingSide).xi.filter((p) => p.bowlType !== 'NONE' && p.id !== team(s, inn.bowlingSide).keeperId);
  const remaining = xi.map((p) => {
    const used = Math.ceil((inn.bowlers[p.id]?.balls ?? 0) / 6) + (p.id === chosen ? 1 : 0);
    return Math.max(0, quota - used);
  });
  const total = remaining.reduce((a, b) => a + b, 0);
  const max = Math.max(...remaining);
  return total >= oversLeft && max <= Math.ceil(oversLeft / 2) + 0;
}

function deathReserve(s: MatchState, inn: InningsState, p: MatchPlayer): number {
  // Keep overs from the best death bowlers for overs 16–20.
  const over = Math.floor(inn.legalBalls / 6);
  const deathStart = s.setup.rules.overs - 5;
  if (over >= deathStart || inn.superOver) return 0;
  const bowlers = team(s, inn.bowlingSide).xi.filter((x) => x.bowlType !== 'NONE');
  const ranked = [...bowlers].sort((a, b) => b.attrs.bowl.death - a.attrs.bowl.death);
  const rank = ranked.findIndex((x) => x.id === p.id);
  if (rank > 2) return 0;
  const used = Math.ceil((inn.bowlers[p.id]?.balls ?? 0) / 6);
  const left = s.setup.rules.maxBowlerOvers - used;
  const want = rank === 0 ? 2 : 1.5;
  const q = s.setup[inn.bowlingSide].tacticalQuality;
  return left <= want ? 14 * q : 0;
}

function chooseBowler(s: MatchState, side: Side): string {
  const inn = currentInnings(s)!;
  const eligible = eligibleBowlers(s, inn);
  let best = eligible[0];
  let bestScore = -Infinity;
  for (const id of eligible) {
    const p = playerById(s, id);
    let sc = bowlerScore(s, inn, p) - deathReserve(s, inn, p) + noise(s, side, `bowl|${id}`);
    if (!inn.superOver && !feasibleAfter(s, inn, id)) sc -= 1000;
    if (sc > bestScore || (sc === bestScore && id < best)) {
      bestScore = sc;
      best = id;
    }
  }
  return best;
}

export function planFor(spin: boolean, phase: 'powerplay' | 'middle' | 'death', striker: MatchPlayer): BowlingPlan {
  if (spin) {
    return {
      lengths: phase === 'death' ? { good: 4, full: 3, back: 3 } : { good: 6, full: 2, back: 2 },
      lines: striker.attrs.bat.vsSpin > 75 ? { stumps: 4, off: 3, wide: 2 } : { stumps: 5, off: 4, leg: 1 },
      variation: phase === 'death' ? 0.35 : 0.25,
      pace: 'normal',
    };
  }
  if (phase === 'powerplay') {
    return { lengths: { good: 5, full: 3, back: 2, short: 1 }, lines: { off: 6, stumps: 3, wide: 1 }, variation: 0.1, pace: 'normal' };
  }
  if (phase === 'death') {
    const hitter = striker.tags.includes('power') || striker.attrs.bat.power > 80;
    return {
      lengths: hitter ? { yorker: 6, full: 1, back: 3, short: 2 } : { yorker: 5, full: 2, back: 2, short: 1 },
      lines: hitter ? { wide: 4, stumps: 3, off: 3 } : { stumps: 4, off: 3, wide: 3 },
      variation: 0.4,
      pace: 'normal',
    };
  }
  return { lengths: { good: 4, back: 3, full: 2, short: 1 }, lines: { off: 5, stumps: 4, wide: 1 }, variation: 0.25, pace: 'normal' };
}

function overStart(s: MatchState, side: Side): { plan?: BowlingPlan } {
  const inn = currentInnings(s)!;
  // The plan depends on who bowls; before the bowler is chosen there is nothing to adjust.
  if (!inn.currentBowlerId) return {};
  const bowler = playerById(s, inn.currentBowlerId!);
  const spin = isSpin(bowler.bowlType);
  const phase = phaseFor(s, inn);
  const striker = playerById(s, inn.strikerId);
  const plan = s.setup.userSide === side && phase !== 'death' ? { ...s.setup[side].tactics.bowlingPlan } : planFor(spin, phase, striker);
  return { plan };
}

/** Test cricket: occupation of the crease first, runs second; the fourth innings follows the target and the clock. */
function testIntent(s: MatchState, side: Side, batterId: string): number {
  const inn = currentInnings(s)!;
  const p = playerById(s, batterId);
  const q = s.setup[side].tacticalQuality;
  const left = s.setup.rules.overs * 6 - matchBallsUsed(s);
  const wk = inn.maxWickets - inn.wickets;
  let intent = 0.15;
  if (inn.target !== null) {
    const need = inn.target - inn.runs;
    const rpo = (need / Math.max(6, left)) * 6;
    // Chase when it is on; otherwise bat for the draw.
    intent = rpo > 4.6 || (wk <= 3 && rpo > 3) ? 0.08 : 0.12 + Math.min(0.4, rpo * 0.07);
  } else {
    const t = sideTotals(s);
    const lead = t[side] - t[side === 'home' ? 'away' : 'home'];
    if (inn.index === 2 && lead > 150) intent += 0.1 + Math.min(0.2, (lead - 150) / 600);
    if (left < 600 && inn.index < 2) intent += 0.06;
  }
  const faced = inn.batters[batterId]?.balls ?? 0;
  if (faced < 20) intent -= 0.05;
  if (faced > 80) intent += 0.04;
  if (p.tags.includes('power')) intent += 0.05;
  if (p.tags.includes('anchor')) intent -= 0.03;
  intent += (hash01(`${s.seed}|ti|${s.seq}`) - 0.5) * 0.06 * (1 - q);
  return Math.max(0.03, Math.min(0.75, intent));
}

function battingIntent(s: MatchState, side: Side, batterId: string): number {
  if (formatOf(s) === 'Test') return testIntent(s, side, batterId);
  const inn = currentInnings(s)!;
  const odi = formatOf(s) === 'ODI';
  const phase = phaseFor(s, inn);
  const t = s.setup[side];
  const q = t.tacticalQuality;
  const p = playerById(s, batterId);
  const base = t.tactics.phaseIntent[phase] * (odi ? 0.72 : 1);
  let situational: number;
  const wicketsInHand = inn.maxWickets - inn.wickets;
  const ballsLeft = inn.maxBalls - inn.legalBalls;
  if (inn.target !== null) {
    const need = inn.target - inn.runs;
    const rrr = (need / Math.max(1, ballsLeft)) * 6;
    const pivot = odi ? 6.6 : 9.5;
    situational = 0.15 + 0.75 / (1 + Math.exp(-(rrr - pivot) / (odi ? 1.8 : 2.4)));
    if (wicketsInHand <= 3 && rrr < pivot + 0.5) situational -= 0.12;
  } else if (odi) {
    situational = phase === 'powerplay' ? 0.34 : phase === 'middle' ? 0.27 : 0.6;
    if (wicketsInHand <= 4 && ballsLeft > 60) situational -= 0.14;
    if (wicketsInHand >= 6 && ballsLeft <= 60) situational += 0.08;
  } else {
    situational = phase === 'powerplay' ? 0.45 : phase === 'middle' ? 0.38 : 0.68;
    if (wicketsInHand <= 4 && ballsLeft > 30) situational -= 0.18;
    if (wicketsInHand >= 7 && ballsLeft <= 36) situational += 0.08;
  }
  if (inn.superOver) situational = 0.85;
  const w = 0.4 + 0.4 * q;
  let intent = base * (1 - w) + situational * w;
  if (p.tags.includes('power')) intent += 0.07;
  if (p.tags.includes('anchor')) intent -= 0.07;
  const faced = inn.batters[batterId]?.balls ?? 0;
  if (faced < 5 && phase !== 'death' && !inn.superOver) intent -= 0.1;
  // dot-ball pressure builds intent
  const recent = s.deliveries.slice(-6).filter((d) => d.innings === inn.index && d.legal);
  if (recent.length >= 4 && recent.filter((d) => d.totalRuns === 0).length >= 4) intent += 0.08;
  return Math.max(0.05, Math.min(0.97, intent));
}

function battingOrder(s: MatchState, side: Side): string[] | null {
  const inn = currentInnings(s)!;
  const q = s.setup[side].tacticalQuality;
  if (q < 0.3) return null;
  const remaining = inn.order.filter((id) => !inn.batters[id]);
  if (remaining.length < 2) return null;
  const over = Math.floor(inn.legalBalls / 6);
  const players = remaining.map((id) => playerById(s, id));
  if (formatOf(s) !== 'Test' && over >= s.setup.rules.overs - 6) {
    // death: send the hitters first
    const hit = (p: MatchPlayer) => p.attrs.bat.power * 0.6 + p.attrs.bat.death * 0.4 + (p.tags.includes('finisher') ? 8 : 0);
    const sorted = [...players].sort((a, b) => hit(b) - hit(a) || remaining.indexOf(a.id) - remaining.indexOf(b.id));
    return sorted.map((p) => p.id);
  }
  if (inn.wickets >= 3 && over < 8) {
    // early collapse: stabilise with the best technician
    const tech = (p: MatchPlayer) => (p.attrs.bat.vsPace + p.attrs.bat.vsSpin) / 2 + p.attrs.bat.defence * 0.3;
    const sorted = [...players].sort((a, b) => tech(b) - tech(a) || remaining.indexOf(a.id) - remaining.indexOf(b.id));
    return [sorted[0].id, ...remaining.filter((id) => id !== sorted[0].id)];
  }
  return null;
}

function tossDecision(s: MatchState, side: Side): 'bat' | 'bowl' {
  const v = s.setup.venue;
  // Test cricket: bat first unless the pitch is green; the surface wears for the side batting last.
  if (formatOf(s) === 'Test') return v.pitch.pace > 0.4 && hash01(`${s.seed}|toss|${side}`) < 0.6 ? 'bowl' : 'bat';
  let chase = 0.58;
  if (s.setup.evening) chase += v.dewChance * 0.3;
  chase -= v.pitch.wear * 0.4;
  return hash01(`${s.seed}|toss|${side}`) < chase ? 'bowl' : 'bat';
}

function review(s: MatchState, side: Side, _ev: DeliveryEvent, perceived: number): boolean {
  const inn = currentInnings(s)!;
  const policy = s.setup[side].tactics.reviewPolicy;
  let threshold = policy === 'aggressive' ? 0.45 : policy === 'conservative' ? 0.68 : 0.56;
  const by = inn.battingSide === side ? 'batting' : 'bowling';
  const left = by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
  if (left === 1 && inn.legalBalls < 60) threshold += 0.08;
  return perceived >= threshold;
}

/** Test cricket: declare with a big first-innings total, or once the lead leaves enough time to bowl the opposition out. */
function declare(s: MatchState, side: Side): boolean {
  const inn = currentInnings(s)!;
  const t = sideTotals(s);
  const lead = t[side] - t[side === 'home' ? 'away' : 'home'];
  const left = s.setup.rules.overs * 6 - matchBallsUsed(s);
  const q = s.setup[side].tacticalQuality;
  if (inn.index <= 1) return inn.runs >= 600 || (inn.runs >= 480 && left < 1500 && lead > 100);
  // Third innings: enough lead, and enough overs left (about 55 balls per wicket) to take ten wickets.
  const need = lead;
  const ballsToWin = 10 * 55;
  return (need >= 260 + (1 - q) * 60 && left <= need * 3.2 + 300 && left >= ballsToWin * 0.75) || need >= 520;
}

function followOn(s: MatchState, _side: Side, lead: number): boolean {
  const left = s.setup.rules.overs * 6 - matchBallsUsed(s);
  return lead >= 250 || left < 1300;
}

export const AiCaptain: Captain = { tossDecision, chooseBowler, overStart, battingIntent, battingOrder, review, declare, followOn };
