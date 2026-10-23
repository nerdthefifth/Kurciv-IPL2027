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

/** Scoring-rate scale and innings length for each limited-overs format. */
const FORMAT_RATE = { T20: { scale: 1, total: 120 }, ODI: { scale: 0.64, total: 300 }, Test: { scale: 0.38, total: 540 } } as const;

export function expectedRemaining(balls: number, wicketsInHand: number, battingEase = 0, format: 'T20' | 'ODI' | 'Test' = 'T20'): number {
  if (balls <= 0 || wicketsInHand <= 0) return 0;
  const f = FORMAT_RATE[format];
  const rate = (WP.baseRate + WP.deathLift * Math.max(0, 1 - balls / f.total)) * f.scale * (1 + battingEase * 0.08);
  const res = Math.min(1, Math.pow(wicketsInHand / ((balls * 120) / f.total / 13 + 1.6), WP.wicketShape));
  return balls * rate * res;
}

export function chaseWinProbability(need: number, balls: number, wicketsInHand: number, battingEase = 0, format: 'T20' | 'ODI' | 'Test' = 'T20'): number {
  if (need <= 0) return 1;
  if (balls <= 0 || wicketsInHand <= 0) return 0;
  const e = expectedRemaining(balls, wicketsInHand, battingEase, format);
  const sd = WP.sdFloor + WP.sdPerRootBall * Math.sqrt(balls);
  return Math.min(0.995, Math.max(0.005, phi((e - need + 0.5) / sd)));
}

export function winProbabilityHome(s: MatchState): number {
  if (s.status === 'complete' && s.result) return s.result.winner === 'home' ? 1 : s.result.winner === 'away' ? 0 : 0.5;
  const inn = s.innings[s.innings.length - 1];
  if (!inn) return 0.5;
  const ease = s.setup.venue.pitch.batting;
  const format = s.setup.rules.format ?? 'T20';
  if (format === 'Test' && !inn.superOver) return testWinProbabilityHome(s);
  let pBat: number;
  if (inn.target === null) {
    if (inn.superOver) pBat = 0.5;
    else {
      const left = inn.maxBalls - inn.legalBalls;
      const proj = inn.runs + expectedRemaining(left, inn.maxWickets - inn.wickets, ease, format);
      const par = expectedRemaining(inn.maxBalls, 10, ease, format) + 1;
      const sdRem = WP.sdPerRootBall * Math.sqrt(left);
      pBat = phi((proj - par) / Math.sqrt(sdRem * sdRem + WP.firstInningsSd * WP.firstInningsSd));
    }
  } else {
    pBat = chaseWinProbability(inn.target - inn.runs, inn.maxBalls - inn.legalBalls, inn.maxWickets - inn.wickets, ease, format);
  }
  const p = inn.battingSide === 'home' ? pBat : 1 - pBat;
  return Math.round(p * 1000) / 1000;
}

/**
 * Test cricket: probability the home side wins (draws count as half), from the run difference,
 * wickets in hand and how much time is left. A state model, like the limited-overs one.
 */
function testWinProbabilityHome(s: MatchState): number {
  const inns = s.innings.filter((i) => !i.superOver);
  const inn = inns[inns.length - 1];
  const totalBalls = s.setup.rules.overs * 6;
  const used = inns.reduce((a, i) => a + i.legalBalls, 0);
  const left = Math.max(0, totalBalls - used);
  const runs = { home: 0, away: 0 };
  for (const i of inns) runs[i.battingSide] += i.runs;
  const batting = inn.battingSide;
  const bowling = batting === 'home' ? 'away' : 'home';
  let pBatWin: number;
  let pDraw: number;
  if (inn.target !== null) {
    const need = inn.target - inn.runs;
    const wk = inn.maxWickets - inn.wickets;
    const canReach = expectedRemaining(left, wk, s.setup.venue.pitch.batting, 'Test');
    pBatWin = need <= 0 ? 1 : phi((canReach - need) / (18 + Math.sqrt(Math.max(1, need)) * 4));
    // Survival: about 55 balls per wicket in the fourth innings.
    const survive = phi((wk * 55 - left) / (40 + Math.sqrt(left) * 3));
    pDraw = Math.max(0, (1 - pBatWin) * survive);
  } else {
    // Lead including what the batting side's remaining wickets are worth.
    const inHand = (inn.maxWickets - inn.wickets) * 30 * Math.min(1, left / 300);
    const lead = runs[batting] + inHand - runs[bowling];
    const remainingInnings = 3 - inn.index;
    const scale = 120 + remainingInnings * 60;
    const decisive = Math.min(1, left / (remainingInnings * 520 + 200));
    pBatWin = 0.5 + 0.5 * Math.tanh(lead / scale);
    pDraw = 1 - decisive;
    pBatWin *= decisive;
  }
  const pBatLose = Math.max(0, 1 - pBatWin - pDraw);
  const pBat = pBatWin + pDraw / 2;
  const p = batting === 'home' ? pBat : 1 - pBat;
  void pBatLose;
  return Math.round(Math.min(0.995, Math.max(0.005, p)) * 1000) / 1000;
}
