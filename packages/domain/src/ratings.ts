import type { Player, PlayerAttributes, Role, StatLine } from './types';
import { isPace, isSpin } from './types';

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function speedScore(kph: number): number {
  return clamp(((kph - 115) / 37) * 100);
}

/** Derived batting rating. Ratings are derived from attributes, never assigned directly. */
export function battingRating(a: PlayerAttributes): number {
  const b = a.bat;
  const phase = (b.powerplay + b.middle + b.death) / 3;
  return r1(0.26 * b.vsPace + 0.22 * b.vsSpin + 0.2 * b.power + 0.12 * b.rotation + 0.08 * b.defence + 0.12 * phase);
}

export function bowlingRating(a: PlayerAttributes, type: Player['bowlType']): number {
  const w = a.bowl;
  if (type === 'NONE') return r1(Math.min(25, w.control * 0.25));
  if (isPace(type)) {
    return r1(
      0.27 * w.control + 0.22 * w.movement + 0.1 * w.variation + 0.1 * w.yorker + 0.06 * w.slower +
        0.13 * speedScore(w.speed) + 0.06 * w.death + 0.06 * w.powerplay,
    );
  }
  return r1(0.3 * w.control + 0.3 * w.movement + 0.22 * w.variation + 0.08 * w.death + 0.1 * w.powerplay);
}

export function fieldingRating(a: PlayerAttributes): number {
  const f = a.field;
  return r1((f.catching + f.ground + f.throwing + f.athleticism) / 4);
}

export function overallFor(role: Role, a: PlayerAttributes, type: Player['bowlType']): number {
  const bat = battingRating(a);
  const bowl = bowlingRating(a, type);
  const fld = fieldingRating(a);
  switch (role) {
    case 'BAT':
      return r1(0.86 * bat + 0.09 * fld + 0.05 * bowl);
    case 'WK':
      return r1(0.74 * bat + 0.21 * a.field.keeping + 0.05 * fld);
    case 'AR': {
      const hi = Math.max(bat, bowl);
      const lo = Math.min(bat, bowl);
      return r1(0.58 * hi + 0.36 * lo + 0.06 * fld + 3);
    }
    case 'BOWL':
      return r1(0.86 * bowl + 0.05 * bat + 0.09 * fld);
  }
}

export function overall(p: Player): number {
  return overallFor(p.role, p.attrs, p.bowlType);
}

export function ageOf(p: Pick<Player, 'birthYear'>, season: number): number {
  return season - p.birthYear;
}

export function bowlingKind(p: Player): 'pace' | 'spin' | 'none' {
  if (isPace(p.bowlType)) return 'pace';
  if (isSpin(p.bowlType)) return 'spin';
  return 'none';
}

/** A player is a realistic bowling option if their bowling rating is reasonable. */
export function canBowl(p: Player): boolean {
  return p.bowlType !== 'NONE' && bowlingRating(p.attrs, p.bowlType) >= 38;
}

export function isOverseas(p: Pick<Player, 'country'>, domestic: string[]): boolean {
  return !domestic.includes(p.country);
}

/** Fair market estimate in crore, used as a reference by AI valuations and base prices. */
export function marketValue(p: Player, season: number): number {
  const ovr = overall(p);
  const age = ageOf(p, season);
  const ageAdj = age <= 23 ? 1.15 : age <= 30 ? 1 : age <= 33 ? 0.85 : age <= 36 ? 0.62 : 0.4;
  const rep = 0.85 + p.reputation / 330;
  return Math.round(0.3 * Math.exp((ovr - 50) * 0.105) * ageAdj * rep * 100) / 100;
}

/** Base price tiers (crore) mirroring franchise auction conventions. */
export function basePriceFor(p: Player, season: number, minBase: number): number {
  const v = marketValue(p, season);
  const tiers = [2, 1.5, 1.25, 1, 0.75, 0.5, 0.3];
  for (const t of tiers) if (v >= t * 3.2 && t >= minBase) return t;
  return minBase;
}

export function emptyStatLine(): StatLine {
  return {
    matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0,
    highScore: 0, ducks: 0, ballsBowled: 0, runsConceded: 0, wickets: 0, dots: 0, bestWkts: 0, bestRuns: 0,
    catches: 0, stumpings: 0, runOuts: 0,
  };
}

export function battingAverage(s: StatLine): number | null {
  const outs = s.innings - s.notOuts;
  return outs > 0 ? r1(s.runs / outs) : null;
}

export function strikeRate(s: StatLine): number | null {
  return s.balls > 0 ? r1((s.runs / s.balls) * 100) : null;
}

export function economy(s: StatLine): number | null {
  return s.ballsBowled > 0 ? Math.round((s.runsConceded / s.ballsBowled) * 6 * 100) / 100 : null;
}

export function oversString(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

/** Scouted rating band: what a club can see, given scouting quality (1..5). */
export function scoutedRange(p: Player, scouting: number, own: boolean): { lo: number; hi: number } {
  const ovr = overall(p);
  const width = own ? p.ratingUncertainty * 0.4 : p.ratingUncertainty * (1.3 - scouting * 0.2);
  return { lo: Math.round(clamp(ovr - width)), hi: Math.round(clamp(ovr + width)) };
}

export function potentialRange(p: Player, scouting: number): { lo: number; hi: number } {
  const width = 3 + (6 - scouting) * 2.2 + p.ratingUncertainty * 0.5;
  return { lo: Math.round(clamp(p.potential - width)), hi: Math.round(clamp(p.potential + width * 0.6)) };
}

export { clamp };
