import type { MatchState } from './types';

/**
 * Win probability from game state. Expected remaining runs come from a resource curve
 * (balls and wickets in hand) whose constants were fitted with the simulation lab;
 * team strength is deliberately not used, so the estimate stays a pure state model.
 */

function phi(x: number): number {
  // Abramowitz–Stegun approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export const WP = {
  baseRate: 1.43, // runs per ball with full resources
  deathLift: 0.32,
  wicketShape: 0.55,
  sdPerRootBall: 1.35,
  sdFloor: 3,
  firstInningsSd: 21,
};

export function expectedRemaining(balls: number, wicketsInHand: number, battingEase = 0): number {
  if (balls <= 0 || wicketsInHand <= 0) return 0;
  const rate = (WP.baseRate + WP.deathLift * (1 - balls / 120)) * (1 + battingEase * 0.08);
  const res = Math.min(1, Math.pow(wicketsInHand / (balls / 13 + 1.6), WP.wicketShape));
  return balls * rate * res;
}

export function chaseWinProbability(need: number, balls: number, wicketsInHand: number, battingEase = 0): number {
  if (need <= 0) return 1;
  if (balls <= 0 || wicketsInHand <= 0) return 0;
  const e = expectedRemaining(balls, wicketsInHand, battingEase);
  const sd = WP.sdFloor + WP.sdPerRootBall * Math.sqrt(balls);
  return Math.min(0.995, Math.max(0.005, phi((e - need + 0.5) / sd)));
}

export function winProbabilityHome(s: MatchState): number {
  if (s.status === 'complete' && s.result) return s.result.winner === 'home' ? 1 : s.result.winner === 'away' ? 0 : 0.5;
  const inn = s.innings[s.innings.length - 1];
  if (!inn) return 0.5;
  const ease = s.setup.venue.pitch.batting;
  let pBat: number;
  if (inn.target === null) {
    if (inn.superOver) pBat = 0.5;
    else {
      const left = inn.maxBalls - inn.legalBalls;
      const proj = inn.runs + expectedRemaining(left, inn.maxWickets - inn.wickets, ease);
      const par = expectedRemaining(120, 10, ease) + 1;
      const sdRem = WP.sdPerRootBall * Math.sqrt(left);
      pBat = phi((proj - par) / Math.sqrt(sdRem * sdRem + WP.firstInningsSd * WP.firstInningsSd));
    }
  } else {
    pBat = chaseWinProbability(inn.target - inn.runs, inn.maxBalls - inn.legalBalls, inn.maxWickets - inn.wickets, ease);
  }
  const p = inn.battingSide === 'home' ? pBat : 1 - pBat;
  return Math.round(p * 1000) / 1000;
}
