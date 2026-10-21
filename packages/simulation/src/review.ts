import type { Length, Line } from '@kurciv/domain';
import type { Rng } from './rng';
import type { EdgeEvidence, LbwTracking } from './types';

/**
 * Decision Review System geometry. All of this is simulated — there is no real tracking data.
 * Tracking is generated when the ball is bowled, consistently with what the engine already
 * decided physically (whether the ball would go on to hit the stumps). The umpire's on-field
 * call is a noisy reading of that geometry; a review reads the geometry itself.
 */

const STUMP_HALF = 0.1143; // half the width of the stumps (22.86 cm)
const STUMP_TOP = 0.711;
const BALL_R = 0.036;
const IN_LINE = STUMP_HALF + BALL_R; // any part of the ball over the stumps line

const r3 = (v: number) => Math.round(v * 1000) / 1000;

const PITCH_DIST: Record<Length, [number, number]> = { yorker: [0.2, 1.2], full: [1.8, 3.6], good: [4.0, 6.2], back: [6.2, 7.8], short: [7.8, 10] };
const IMPACT_HEIGHT: Record<Length, [number, number]> = { yorker: [0.06, 0.2], full: [0.14, 0.38], good: [0.3, 0.55], back: [0.45, 0.72], short: [0.62, 0.95] };
const PITCH_X: Record<Line, [number, number]> = { wide: [0.32, 0.6], off: [0.12, 0.36], stumps: [-0.1, 0.12], leg: [-0.36, -0.13] };

export function makeLbwTracking(
  rng: Rng,
  o: { line: Line; length: Length; wouldHit: boolean; shotOffered: boolean; spin: boolean },
): LbwTracking {
  const [pd0, pd1] = PITCH_DIST[o.length];
  const pitchD = rng.range(pd0, pd1);
  const impactD = o.length === 'yorker' ? rng.range(0.25, 0.9) : rng.range(0.6, 2.2);
  const fullToss = pitchD <= impactD;
  const [px0, px1] = PITCH_X[o.line];
  // Where the ball ends up at the stumps, chosen to agree with the engine's physical outcome.
  let projX: number;
  let projZ: number;
  const [z0, z1] = IMPACT_HEIGHT[o.length];
  const impactZ = rng.range(z0, z1);
  if (o.wouldHit) {
    projX = rng.range(-STUMP_HALF * 0.95, STUMP_HALF * 0.95);
    if (rng.chance(0.18)) projX = (rng.chance(0.5) ? 1 : -1) * rng.range(STUMP_HALF - BALL_R * 0.4, STUMP_HALF + BALL_R * 0.6); // clipping
    projZ = Math.min(impactZ * rng.range(1.0, 1.25), STUMP_TOP - 0.02);
  } else if (impactZ > 0.5 && rng.chance(0.5)) {
    projX = rng.range(-STUMP_HALF, STUMP_HALF);
    projZ = STUMP_TOP + rng.range(0.03, 0.2); // going over
  } else {
    projX = (rng.chance(0.6) ? 1 : -1) * rng.range(IN_LINE + 0.005, IN_LINE + 0.16);
    projZ = Math.min(impactZ * rng.range(1.0, 1.2), STUMP_TOP - 0.05);
  }
  // Lateral path: straight line from the pitching point through the stumps projection.
  const pitchX = o.wouldHit && o.line === 'leg' ? rng.range(-IN_LINE + 0.01, -0.06) : rng.range(px0, px1);
  const impactX = fullToss ? projX + rng.normal(0, 0.02) : projX + (pitchX - projX) * (impactD / pitchD) + rng.normal(0, 0.012);
  const pitched: LbwTracking['pitched'] = fullToss ? 'full-toss' : pitchX < -IN_LINE ? 'outside-leg' : pitchX > IN_LINE ? 'outside-off' : 'in-line';
  const impactZone: LbwTracking['impactZone'] = Math.abs(impactX) <= STUMP_HALF ? 'in-line'
    : Math.abs(impactX) <= IN_LINE ? 'umpires-call' : impactX > 0 ? 'outside-off' : 'outside-leg';
  const hitting = Math.abs(projX) <= STUMP_HALF - BALL_R * 0.5 && projZ <= STUMP_TOP - BALL_R * 0.5;
  const clipping = Math.abs(projX) <= IN_LINE && projZ <= STUMP_TOP + BALL_R;
  const wickets: LbwTracking['wickets'] = hitting ? 'hitting' : clipping ? 'umpires-call' : 'missing';
  let missBy: string | null = null;
  if (wickets === 'missing') {
    if (projZ > STUMP_TOP + BALL_R) missBy = `going over by ${Math.round((projZ - STUMP_TOP - BALL_R) * 100)} cm`;
    else missBy = `missing ${projX > 0 ? 'off' : 'leg'} stump by ${Math.round((Math.abs(projX) - IN_LINE) * 100)} cm`;
  }
  return {
    pitch: fullToss ? null : { x: r3(pitchX), d: r3(pitchD) },
    impact: { x: r3(impactX), z: r3(impactZ), d: r3(impactD) },
    projected: { x: r3(projX), z: r3(projZ) },
    pitched, impactZone, wickets, missBy, shotOffered: o.shotOffered,
  };
}

/** The law, applied to perfect tracking: is the batter out LBW? */
export function lbwTrueOut(t: LbwTracking): boolean {
  if (t.pitched === 'outside-leg') return false;
  if (t.impactZone === 'outside-leg') return false;
  if (t.impactZone === 'outside-off' && t.shotOffered) return false;
  return t.wickets !== 'missing';
}

/**
 * The on-field umpire sees the same ball imperfectly. Returns the umpire's confidence that it
 * is out (a noisy reading of the geometry). Repeated readings average towards the truth.
 */
export function umpireReading(rng: Rng, t: LbwTracking): number {
  let outVotes = 0;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const px = t.projected.x + rng.normal(0, 0.075);
    const pz = t.projected.z + rng.normal(0, 0.09);
    const ix = t.impact.x + rng.normal(0, 0.04);
    const pitchX = t.pitch ? t.pitch.x + rng.normal(0, 0.05) : 0;
    const legOk = !t.pitch || pitchX >= -IN_LINE;
    const lineOk = ix >= -IN_LINE && (ix <= IN_LINE || !t.shotOffered);
    const hits = Math.abs(px) <= IN_LINE && pz <= STUMP_TOP + BALL_R;
    if (legOk && lineOk && hits) outVotes++;
  }
  return outVotes / N;
}

/**
 * DRS verdict for an LBW review: the on-field call stands unless the tracking clearly
 * contradicts it. "Umpire's call" (marginal impact or wickets) keeps the original decision.
 */
export function lbwReviewVerdict(t: LbwTracking, umpireOut: boolean): { out: boolean; umpiresCall: boolean; decisive: string } {
  if (t.pitched === 'outside-leg') return { out: false, umpiresCall: false, decisive: 'Pitched outside leg stump.' };
  if (t.impactZone === 'outside-leg') return { out: false, umpiresCall: false, decisive: 'Impact outside the line of leg stump.' };
  if (t.impactZone === 'outside-off' && t.shotOffered) return { out: false, umpiresCall: false, decisive: 'Impact outside off stump while playing a shot.' };
  if (t.wickets === 'missing') return { out: false, umpiresCall: false, decisive: `Ball tracking shows the ball ${t.missBy ?? 'missing the stumps'}.` };
  const marginal = t.impactZone === 'umpires-call' || t.wickets === 'umpires-call';
  if (marginal) {
    const what = t.impactZone === 'umpires-call' ? 'impact' : 'wickets';
    return { out: umpireOut, umpiresCall: true, decisive: `Umpire's call on ${what}: the on-field decision stands.` };
  }
  return { out: true, umpiresCall: false, decisive: `Pitched ${t.pitched === 'full-toss' ? 'on the full' : 'in line'}, impact in line, hitting the stumps.` };
}

/** Simulated edge-detection evidence. Labelled as simulated everywhere it is shown. */
export function edgeEvidence(rng: Rng, contact: boolean): EdgeEvidence {
  if (!contact) {
    const gapCm = Math.round(rng.range(1, 9) * 10) / 10;
    const otherNoise = rng.chance(0.35);
    return { contact: false, thickness: 'none', gapCm, spike: otherNoise ? 'small' : 'flat', otherNoise };
  }
  const roll = rng.next();
  const thickness: EdgeEvidence['thickness'] = roll < 0.3 ? 'faint' : roll < 0.7 ? 'thin' : 'thick';
  return { contact: true, thickness, gapCm: 0, spike: thickness === 'faint' ? 'small' : 'clear', otherNoise: false };
}

/** How likely the umpire is to hear and see an edge of this thickness. */
export function umpireHearsEdge(e: EdgeEvidence): number {
  return e.thickness === 'thick' ? 0.995 : e.thickness === 'thin' ? 0.93 : e.thickness === 'faint' ? 0.7 : 0;
}

/** Caught-behind review verdict, from the evidence (the engine knows whether the ball touched the bat). */
export function caughtBehindVerdict(e: EdgeEvidence): { out: boolean; decisive: string } {
  if (e.contact) return { out: true, decisive: `Simulated edge detection shows a ${e.spike === 'clear' ? 'clear' : 'small'} spike as the ball passes the bat: ${e.thickness} edge.` };
  return {
    out: false,
    decisive: `No spike as the ball passes the bat (gap about ${e.gapCm} cm)${e.otherNoise ? '; the sound came from bat hitting pad' : ''}.`,
  };
}
