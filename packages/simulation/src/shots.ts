import type { Length, Line } from '@kurciv/domain';

/**
 * Shot catalogue. Angles are batter-relative degrees (0 = straight back past the bowler,
 * positive = off side, ±180 = behind the keeper). `aerial` is the base chance the shot is
 * played in the air; `intent` is the aggression level at which a batter favours the shot.
 */
export interface ShotDef {
  id: string;
  label: string;
  angle: number | ((line: Line) => number);
  sd: number;
  aerial: number;
  power: number; // share of the batter's full power
  risk: number; // 0..1 inherent difficulty
  intent: number;
  lengths: Partial<Record<Length, number>>;
  lines: Partial<Record<Line, number>>;
  only?: 'pace' | 'spin';
  rotation?: boolean; // played to pick up singles
}

export const SHOTS: ShotDef[] = [
  { id: 'leave', label: 'leaves it', angle: 0, sd: 0, aerial: 0, power: 0, risk: 0.02, intent: 0, lengths: { good: 0.6, back: 0.6, short: 0.5 }, lines: { wide: 1, off: 0.1, stumps: -3, leg: -1.5 } },
  { id: 'defend', label: 'defends', angle: 0, sd: 50, aerial: 0, power: 0.1, risk: 0.04, intent: 0, lengths: { yorker: 0.6, full: 0.2, good: 1, back: 0.7, short: -0.3 }, lines: { stumps: 0.6, off: 0.4, leg: 0, wide: -0.5 } },
  { id: 'push', label: 'works it', angle: (l) => (l === 'leg' ? -45 : l === 'stumps' ? -10 : 35), sd: 40, aerial: 0, power: 0.45, risk: 0.09, intent: 0.15, lengths: { full: 0.5, good: 0.7, back: 0.6, yorker: 0.2, short: -0.2 }, lines: { stumps: 0.5, off: 0.5, leg: 0.5, wide: 0.2 }, rotation: true },
  { id: 'drive', label: 'drives', angle: (l) => (l === 'wide' ? 60 : l === 'off' ? 40 : l === 'stumps' ? 5 : -22), sd: 14, aerial: 0.06, power: 0.78, risk: 0.2, intent: 0.3, lengths: { full: 1, good: 0.2, yorker: -0.5, back: -0.6, short: -1 }, lines: { wide: 0.3, off: 0.9, stumps: 0.6, leg: 0.2 } },
  { id: 'cut', label: 'cuts', angle: 98, sd: 15, aerial: 0.12, power: 0.72, risk: 0.26, intent: 0.35, lengths: { short: 0.8, back: 1, good: -0.2, full: -0.8, yorker: -1 }, lines: { wide: 1, off: 0.5, stumps: -0.7, leg: -1.2 } },
  { id: 'late-cut', label: 'runs it down', angle: 140, sd: 14, aerial: 0.02, power: 0.45, risk: 0.24, intent: 0.22, lengths: { back: 0.8, good: 0.4, short: 0.4, full: -0.6 }, lines: { wide: 0.8, off: 0.8, stumps: -0.6, leg: -1.2 }, rotation: true },
  { id: 'pull', label: 'pulls', angle: -78, sd: 24, aerial: 0.32, power: 0.85, risk: 0.3, intent: 0.45, lengths: { short: 1, back: 0.7, good: -0.4, full: -1, yorker: -1.2 }, lines: { stumps: 0.6, leg: 0.5, off: 0.3, wide: -0.6 } },
  { id: 'hook', label: 'hooks', angle: -120, sd: 18, aerial: 0.85, power: 0.85, risk: 0.42, intent: 0.72, lengths: { short: 1.1, back: 0.2, good: -0.8, full: -1.2 }, lines: { stumps: 0.6, leg: 0.6, off: 0, wide: -0.8 }, only: 'pace' },
  { id: 'flick', label: 'flicks', angle: -42, sd: 20, aerial: 0.08, power: 0.6, risk: 0.16, intent: 0.28, lengths: { full: 0.7, good: 0.5, yorker: 0.1, back: 0.2, short: -0.3 }, lines: { leg: 1.1, stumps: 0.6, off: -0.5, wide: -1.3 } },
  { id: 'glance', label: 'glances', angle: -150, sd: 14, aerial: 0.02, power: 0.45, risk: 0.18, intent: 0.18, lengths: { full: 0.5, good: 0.6, back: 0.4, yorker: 0.1 }, lines: { leg: 1.1, stumps: 0.2, off: -0.9, wide: -1.5 }, rotation: true },
  { id: 'sweep', label: 'sweeps', angle: -88, sd: 26, aerial: 0.15, power: 0.65, risk: 0.3, intent: 0.42, lengths: { good: 0.7, full: 0.5, back: -0.2, short: -0.6 }, lines: { stumps: 0.6, leg: 0.6, off: 0.1, wide: -0.6 }, only: 'spin' },
  { id: 'reverse', label: 'reverse-sweeps', angle: 102, sd: 22, aerial: 0.3, power: 0.55, risk: 0.42, intent: 0.7, lengths: { good: 0.6, full: 0.4, back: -0.3 }, lines: { off: 0.6, stumps: 0.4, wide: 0.5, leg: -0.4 }, only: 'spin' },
  { id: 'loft', label: 'lofts it straight', angle: 0, sd: 15, aerial: 1, power: 1, risk: 0.38, intent: 0.8, lengths: { full: 1, good: 0.35, yorker: -0.9, back: -0.6, short: -0.9 }, lines: { stumps: 0.8, off: 0.5, leg: 0.3, wide: -0.2 } },
  { id: 'slog', label: 'slogs to cow corner', angle: -48, sd: 18, aerial: 1, power: 1, risk: 0.48, intent: 0.92, lengths: { full: 0.9, good: 0.4, back: 0.3, short: 0, yorker: -0.8 }, lines: { stumps: 0.8, leg: 0.8, off: 0.1, wide: -0.6 } },
  { id: 'inside-out', label: 'goes inside-out over cover', angle: 48, sd: 15, aerial: 1, power: 0.92, risk: 0.46, intent: 0.85, lengths: { full: 0.8, good: 0.45, back: -0.2, yorker: -0.8, short: -0.6 }, lines: { off: 0.8, wide: 0.7, stumps: 0.2, leg: -0.6 } },
  { id: 'slog-sweep', label: 'slog-sweeps', angle: -58, sd: 16, aerial: 1, power: 0.98, risk: 0.45, intent: 0.88, lengths: { good: 0.7, full: 0.7, back: 0, short: -0.5 }, lines: { stumps: 0.7, leg: 0.7, off: 0.2, wide: -0.5 }, only: 'spin' },
  { id: 'scoop', label: 'scoops', angle: -168, sd: 12, aerial: 1, power: 0.72, risk: 0.55, intent: 0.95, lengths: { yorker: 0.5, full: 0.7, good: -0.3, short: -1 }, lines: { stumps: 0.6, off: 0.3, leg: 0.4, wide: -0.6 }, only: 'pace' },
  { id: 'ramp', label: 'ramps over the keeper', angle: 165, sd: 12, aerial: 1, power: 0.72, risk: 0.55, intent: 0.95, lengths: { back: 0.6, short: 0.6, good: 0.2, full: -0.5 }, lines: { off: 0.6, wide: 0.6, stumps: 0.2, leg: -0.8 }, only: 'pace' },
  { id: 'upper-cut', label: 'upper-cuts', angle: 132, sd: 14, aerial: 1, power: 0.78, risk: 0.4, intent: 0.78, lengths: { short: 1.1, back: 0.3, good: -0.8, full: -1.2 }, lines: { wide: 1, off: 0.7, stumps: -0.6, leg: -1.2 }, only: 'pace' },
  { id: 'dig-out', label: 'digs it out', angle: (l) => (l === 'leg' ? -35 : 10), sd: 35, aerial: 0, power: 0.35, risk: 0.18, intent: 0.22, lengths: { yorker: 1.1, full: 0.2, good: -0.6, back: -1, short: -1.2 }, lines: { stumps: 0.6, off: 0.4, leg: 0.4, wide: 0 }, rotation: true },
];

export function shotById(id: string): ShotDef {
  const s = SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown shot ${id}`);
  return s;
}

export function shotAngle(s: ShotDef, line: Line): number {
  return typeof s.angle === 'function' ? s.angle(line) : s.angle;
}
