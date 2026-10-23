import type { FieldPoint, FieldTemplate, Hand, Venue } from '@kurciv/domain';
import { SIM } from '@kurciv/config';

/**
 * Field geometry. Coordinates are metres with the origin at the centre of the pitch,
 * +y towards the bowler's end and +x towards the off side *for a right-handed batter*.
 * Templates are stored in right-hander orientation and mirrored for left-handers.
 */

export const STRIKER: FieldPoint = { x: 0, y: SIM.strikerY };

export function mirror(p: FieldPoint): FieldPoint {
  return { x: -p.x, y: p.y };
}

/** Distance from point to the segment joining the two sets of stumps. */
function distToStumpLine(p: FieldPoint): number {
  const y = Math.max(-SIM.stumpsY, Math.min(SIM.stumpsY, p.y));
  return Math.hypot(p.x, p.y - y);
}

/** Inside the fielding-restriction circle (two semicircles joined by straight lines). */
export function insideCircle(p: FieldPoint): boolean {
  return distToStumpLine(p) <= SIM.circleRadius;
}

/** Ellipse semi-axes from the pitch centre: venue straight boundary is quoted from the striker. */
export function boundaryAxes(venue: Pick<Venue, 'boundaryStraight' | 'boundarySquare'>): { a: number; b: number } {
  return { a: venue.boundarySquare, b: venue.boundaryStraight + SIM.strikerY };
}

export function insideBoundary(p: FieldPoint, venue: Pick<Venue, 'boundaryStraight' | 'boundarySquare'>, margin = 0): boolean {
  const { a, b } = boundaryAxes(venue);
  return (p.x * p.x) / ((a - margin) * (a - margin)) + (p.y * p.y) / ((b - margin) * (b - margin)) <= 1;
}

/** Unit direction for a batter-relative angle (deg; 0 = straight, + = off side). */
export function direction(angleDeg: number, hand: Hand): FieldPoint {
  const r = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(r) * (hand === 'R' ? 1 : -1), y: Math.cos(r) };
}

/** Distance from `from` along unit `dir` to the boundary ellipse. */
export function distanceToBoundary(from: FieldPoint, dir: FieldPoint, venue: Pick<Venue, 'boundaryStraight' | 'boundarySquare'>): number {
  const { a, b } = boundaryAxes(venue);
  const A = (dir.x * dir.x) / (a * a) + (dir.y * dir.y) / (b * b);
  const B = 2 * ((from.x * dir.x) / (a * a) + (from.y * dir.y) / (b * b));
  const C = (from.x * from.x) / (a * a) + (from.y * from.y) / (b * b) - 1;
  const disc = B * B - 4 * A * C;
  return (-B + Math.sqrt(Math.max(0, disc))) / (2 * A);
}

/** Pull any fielder that would stand beyond the rope back inside it (does not alter the template). */
export function fitToVenue(points: FieldPoint[], venue: Pick<Venue, 'boundaryStraight' | 'boundarySquare'>): FieldPoint[] {
  return points.map((p) => {
    if (insideBoundary(p, venue, 3)) return p;
    const len = Math.hypot(p.x, p.y) || 1;
    const dir = { x: p.x / len, y: p.y / len };
    const d = distanceToBoundary({ x: 0, y: 0 }, dir, venue) - 3.5;
    return { x: Math.round(dir.x * d * 10) / 10, y: Math.round(dir.y * d * 10) / 10 };
  });
}

// ------------------------------------------------------------------ named positions

export const POSITIONS: Record<string, FieldPoint> = {
  'Slip 1': { x: 3.5, y: -21.5 },
  'Slip 2': { x: 6, y: -21 },
  'Slip 3': { x: 8.5, y: -20.5 },
  Gully: { x: 13, y: -16 },
  'Leg slip': { x: -3.5, y: -21.5 },
  'Short leg': { x: -4.5, y: -6.5 },
  'Silly point': { x: 4.5, y: -6.5 },
  Point: { x: 21, y: -7.5 },
  'Backward point': { x: 18, y: -15 },
  Cover: { x: 20, y: 5 },
  'Extra cover': { x: 15, y: 15 },
  'Mid-off': { x: 8, y: 24 },
  'Mid-on': { x: -8, y: 24 },
  Midwicket: { x: -20, y: 6 },
  'Square leg': { x: -21, y: -7.5 },
  'Short fine leg': { x: -11, y: -24 },
  'Short third man': { x: 16, y: -25 },
  'Third man': { x: 32, y: -62 },
  'Deep backward point': { x: 56, y: -38 },
  'Deep point': { x: 68, y: -8 },
  'Deep cover': { x: 56, y: 34 },
  'Long off': { x: 24, y: 68 },
  'Long on': { x: -24, y: 68 },
  'Deep midwicket': { x: -56, y: 34 },
  'Cow corner': { x: -42, y: 54 },
  'Deep square leg': { x: -68, y: -6 },
  'Deep backward square': { x: -56, y: -38 },
  'Fine leg': { x: -30, y: -62 },
};

export function nearestPositionName(p: FieldPoint): string {
  let best = 'Fielder';
  let bd = Infinity;
  for (const [name, q] of Object.entries(POSITIONS)) {
    // compare in polar-ish space so deep fielders map to deep names even when pulled in
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) {
      bd = d;
      best = name;
    }
  }
  return best;
}

const t = (id: string, name: string, names: string[], keeperUp: boolean, situation: string): FieldTemplate => ({
  id,
  name,
  positions: names.map((n) => {
    const p = POSITIONS[n];
    if (!p) throw new Error(`Unknown position ${n}`);
    return { ...p };
  }),
  keeperUp,
  situation,
  builtIn: true,
});

export const BUILT_IN_FIELDS: FieldTemplate[] = [
  t('pp-attack', 'Powerplay Attack', ['Slip 1', 'Slip 2', 'Point', 'Cover', 'Mid-off', 'Mid-on', 'Square leg', 'Third man', 'Fine leg'], false, 'powerplay'),
  t('pp-control', 'Powerplay Control', ['Slip 1', 'Point', 'Cover', 'Extra cover', 'Mid-off', 'Mid-on', 'Midwicket', 'Third man', 'Fine leg'], false, 'powerplay'),
  t('pp-spin', 'Powerplay Spin', ['Slip 1', 'Point', 'Cover', 'Mid-off', 'Mid-on', 'Midwicket', 'Short fine leg', 'Deep midwicket', 'Long off'], true, 'powerplay'),
  t('mid-spin', 'Middle-Over Spin Control', ['Point', 'Cover', 'Mid-off', 'Short fine leg', 'Long off', 'Long on', 'Deep midwicket', 'Deep cover', 'Deep square leg'], true, 'middle'),
  t('mid-pace', 'Middle-Over Pace Balanced', ['Point', 'Cover', 'Mid-off', 'Square leg', 'Third man', 'Fine leg', 'Deep cover', 'Long on', 'Deep midwicket'], false, 'middle'),
  t('death-yorker', 'Death-Over Yorkers', ['Short third man', 'Short fine leg', 'Point', 'Extra cover', 'Long off', 'Long on', 'Deep midwicket', 'Deep square leg', 'Deep cover'], false, 'death'),
  t('boundary', 'Boundary Protection', ['Point', 'Cover', 'Mid-off', 'Midwicket', 'Third man', 'Fine leg', 'Deep cover', 'Deep midwicket', 'Long on'], false, 'death'),
  t('new-batter', 'New Batter Attack', ['Slip 1', 'Slip 2', 'Gully', 'Short leg', 'Cover', 'Mid-off', 'Mid-on', 'Third man', 'Fine leg'], false, 'wicket'),
  t('chase-defend', 'Defensive Chase Management', ['Point', 'Short third man', 'Short fine leg', 'Mid-off', 'Long off', 'Long on', 'Deep midwicket', 'Deep cover', 'Deep square leg'], false, 'defend'),
  t('test-pace', 'Test Match Attack', ['Slip 1', 'Slip 2', 'Slip 3', 'Gully', 'Point', 'Cover', 'Mid-off', 'Mid-on', 'Square leg'], false, 'test'),
  t('test-spin', 'Test Match Spin', ['Slip 1', 'Short leg', 'Silly point', 'Point', 'Cover', 'Mid-off', 'Mid-on', 'Midwicket', 'Square leg'], true, 'test'),
  t('short-ball', 'Short-Ball Plan', ['Slip 1', 'Cover', 'Mid-off', 'Mid-on', 'Fine leg', 'Deep square leg', 'Deep midwicket', 'Third man', 'Deep point'], false, 'short'),
];

export function builtInField(id: string): FieldTemplate {
  const f = BUILT_IN_FIELDS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown field ${id}`);
  return f;
}

// ------------------------------------------------------------------ legality

export interface FieldValidation {
  legal: boolean;
  errors: string[];
  warnings: string[];
  outsideCircle: number;
  legBehindSquare: number;
}

/**
 * Validates a field as it would stand against a batter of `hand`.
 * `points` are in the orientation actually used for that delivery (i.e. already mirrored if applicable).
 */
export function validateField(
  points: FieldPoint[],
  hand: Hand,
  opts: { powerplay: boolean; maxOutsidePP: number; maxOutside: number; venue?: Pick<Venue, 'boundaryStraight' | 'boundarySquare'> },
): FieldValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (points.length !== 9) errors.push(`A field needs exactly 9 outfielders besides bowler and keeper (has ${points.length}).`);
  const outside = points.filter((p) => !insideCircle(p)).length;
  const limit = opts.powerplay ? opts.maxOutsidePP : opts.maxOutside;
  if (outside > limit) errors.push(`${outside} fielders outside the 30-yard circle; maximum is ${limit}${opts.powerplay ? ' during the powerplay' : ''}.`);
  const legSign = hand === 'R' ? -1 : 1;
  const legBehind = points.filter((p) => p.x * legSign > 0.5 && p.y < SIM.strikerY).length;
  if (legBehind > 2) errors.push(`${legBehind} fielders behind square on the leg side; the laws allow at most 2.`);
  if (opts.venue) {
    const off = points.filter((p) => !insideBoundary(p, opts.venue!, 1)).length;
    if (off) warnings.push(`${off} fielder(s) placed beyond the boundary at this venue; they will stand on the rope.`);
  }
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 2) warnings.push('Two fielders are standing on top of each other.');
  const closeToBat = points.filter((p) => Math.hypot(p.x - STRIKER.x, p.y - STRIKER.y) < 4).length;
  if (closeToBat) errors.push('A fielder is standing on the pitch / inside the protected area.');
  const offSide = points.filter((p) => p.x * -legSign > 0).length;
  if (offSide >= 8) warnings.push('Leg side almost empty — expect batters to target it.');
  if (offSide <= 1) warnings.push('Off side almost empty — expect batters to target it.');
  return { legal: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], outsideCircle: outside, legBehindSquare: legBehind };
}

// ------------------------------------------------------------------ zones

export const ZONES = ['Long off', 'Cover', 'Point', 'Third man', 'Fine leg', 'Square leg', 'Midwicket', 'Long on'] as const;

/** Zone index from batter-relative angle (deg, + off side). */
export function zoneOf(angle: number): number {
  const a = ((angle % 360) + 540) % 360 - 180; // −180..180
  if (a >= 0) return Math.min(3, Math.floor(a / 45));
  return 4 + Math.min(3, Math.floor((180 + a) / 45));
}
