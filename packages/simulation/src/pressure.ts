import type { InningsState, MatchPlayer, MatchState } from './types';

/**
 * Situational psychology. Each function returns a skill adjustment in rating points
 * (negative = hurts) plus a 0..1 pressure index for display. Effects are deliberately
 * small: they nudge probabilities, they never decide a ball. Temperament dampens the
 * negatives and match importance amplifies everything.
 */

export interface PressureReading {
  skillAdj: number;
  /** Bowler only: control adjustment. */
  controlAdj: number;
  index: number; // 0 calm .. 1 extreme
  reasons: string[];
}

const recentLegal = (s: MatchState, inn: InningsState, n: number) =>
  s.deliveries.filter((d) => d.innings === inn.index && d.legal).slice(-n);

export function batterPressure(s: MatchState, inn: InningsState, striker: MatchPlayer): PressureReading {
  const reasons: string[] = [];
  let p = 0; // raw pressure
  let boost = 0; // raw confidence
  const me = inn.batters[striker.id];

  // Chase: required rate climbing beyond the gettable
  if (inn.target !== null) {
    const left = inn.maxBalls - inn.legalBalls;
    const rrr = left > 0 ? ((inn.target - inn.runs) / left) * 6 : 36;
    if (rrr > 9) {
      p += Math.min(1, (rrr - 9) / 6) * 0.6;
      reasons.push(`Required rate ${rrr.toFixed(1)}`);
    }
  }
  // Dot-ball squeeze on this batter
  const mine = recentLegal(s, inn, 8).filter((d) => d.strikerId === striker.id);
  let dots = 0;
  for (let i = mine.length - 1; i >= 0 && mine[i].batRuns === 0 && !mine[i].extras; i--) dots++;
  if (dots >= 3) {
    p += Math.min(0.4, (dots - 2) * 0.1);
    reasons.push(`${dots} dots in a row`);
  }
  // Walking in during a collapse
  const lastFow = inn.fow.slice(-3);
  if (me.balls < 6 && lastFow.length >= 2 && inn.legalBalls - lastFow[0].balls <= 18) {
    p += 0.3;
    reasons.push('Collapse in progress');
  }
  // Milestone nerves
  if ((me.runs >= 44 && me.runs < 50) || (me.runs >= 90 && me.runs < 100)) {
    p += 0.15;
    reasons.push('Nearing a milestone');
  }
  // Confidence: set batter, or a boundary in their last three balls
  if (me.balls >= 20 && me.runs >= me.balls) boost += 0.25;
  if (mine.slice(-3).some((d) => d.boundary)) boost += 0.2;

  const imp = 1 + s.setup.importance * 0.6;
  const calm = 1 - (striker.attrs.mental.temperament - 50) / 80; // high temperament → <1
  const index = Math.max(0, Math.min(1, p * imp * Math.max(0.35, calm)));
  const skillAdj = -index * 6 + boost * 3 * (striker.attrs.mental.temperament / 80);
  return { skillAdj, controlAdj: 0, index, reasons };
}

export function bowlerPressure(s: MatchState, inn: InningsState, bowler: MatchPlayer): PressureReading {
  const reasons: string[] = [];
  let p = 0;
  let boost = 0;
  const thisOver = s.deliveries.filter((d) => d.innings === inn.index && d.over === Math.floor(inn.legalBalls / 6) && d.bowlerId === bowler.id);
  const hits = thisOver.filter((d) => d.boundary).length;
  if (hits >= 1) {
    p += Math.min(0.6, hits * 0.22);
    reasons.push(`${hits} boundar${hits > 1 ? 'ies' : 'y'} this over`);
  }
  // Defending a small total late on
  if (inn.target !== null) {
    const left = inn.maxBalls - inn.legalBalls;
    const need = inn.target - inn.runs;
    if (left <= 12 && need <= left * 1.6 && need > 0) {
      p += 0.4;
      reasons.push('Defending a tight finish');
    }
  }
  // Already expensive today
  const fig = inn.bowlers[bowler.id];
  if (fig && fig.balls >= 12 && (fig.runs / fig.balls) * 6 > 11) {
    p += 0.2;
    reasons.push('Expensive spell');
  }
  // Momentum from a wicket in the last six balls
  if (recentLegal(s, inn, 6).some((d) => d.wicket && d.bowlerId === bowler.id)) boost += 0.3;

  const imp = 1 + s.setup.importance * 0.6;
  const calm = 1 - (bowler.attrs.mental.temperament - 50) / 80;
  const index = Math.max(0, Math.min(1, p * imp * Math.max(0.35, calm)));
  return { skillAdj: -index * 4 + boost * 3, controlAdj: -index * 7 + boost * 2, index, reasons };
}
