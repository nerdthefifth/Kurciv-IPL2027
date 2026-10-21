import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { FieldPoint } from '@kurciv/domain';
import { SIM } from '@kurciv/config';
import { STRIKER, ZONES, boundaryAxes, insideBoundary, insideCircle, mirror, nearestPositionName, validateField } from '@kurciv/simulation';

export interface VenueDims {
  boundaryStraight: number;
  boundarySquare: number;
  name?: string;
}

const DEFAULT_VENUE: VenueDims = { boundaryStraight: 72, boundarySquare: 67 };

const ABBR: Record<string, string> = {
  'Slip 1': '1S', 'Slip 2': '2S', 'Slip 3': '3S', Gully: 'GU', 'Leg slip': 'LS', 'Short leg': 'SL', 'Silly point': 'SP', Point: 'PT', 'Backward point': 'BP',
  Cover: 'CV', 'Extra cover': 'XC', 'Mid-off': 'MO', 'Mid-on': 'MN', Midwicket: 'MW', 'Square leg': 'SQ', 'Short fine leg': 'SF', 'Short third man': 'ST',
  'Third man': '3M', 'Deep backward point': 'DB', 'Deep point': 'DP', 'Deep cover': 'DC', 'Long off': 'LO', 'Long on': 'LN', 'Deep midwicket': 'DM',
  'Cow corner': 'CC', 'Deep square leg': 'DS', 'Deep backward square': 'BS', 'Fine leg': 'FL',
};

function capsulePath(): string {
  const r = SIM.circleRadius;
  const s = SIM.stumpsY;
  // SVG y is flipped (bowler's end at the top)
  return `M ${-r} ${-s} A ${r} ${r} 0 0 1 ${r} ${-s} L ${r} ${s} A ${r} ${r} 0 0 1 ${-r} ${s} Z`;
}

export interface FieldEditorProps {
  positions: FieldPoint[]; // right-hander orientation
  onChange?: (p: FieldPoint[]) => void;
  venue?: VenueDims;
  powerplay?: boolean;
  hand?: 'R' | 'L';
  mirrorForLeft?: boolean;
  keeperUp?: boolean;
  zoneRuns?: number[];
  lastBall?: { end: FieldPoint | null; boundary: 4 | 6 | null; wicket: boolean; aerial: boolean } | null;
  wagon?: { end: FieldPoint; runs: number }[];
  className?: string;
  /** Classes for the SVG itself (e.g. to fill a fixed-height panel). */
  svgClassName?: string;
  showValidation?: boolean;
  label?: string;
  /** Competition field restrictions (defaults: 2 outside the circle in the powerplay, 5 otherwise). */
  rules?: { maxOutsidePP: number; maxOutside: number };
  /** Optional player label per position (e.g. surname) and selection. */
  names?: (string | undefined)[];
  selected?: number | null;
  onSelect?: (i: number | null) => void;
}

/**
 * Top-down ground drawn to scale (metres). Viewed from behind the striker: the bowler's end is
 * at the top and, for a right-hander, the off side is on the right.
 */
export function FieldEditor({
  positions, onChange, venue = DEFAULT_VENUE, powerplay = false, hand = 'R', mirrorForLeft = true, keeperUp = false, zoneRuns, lastBall, wagon,
  className = '', svgClassName = 'h-auto w-full', showValidation = true, label = 'Field placement', rules = { maxOutsidePP: 2, maxOutside: 5 }, names, selected = null, onSelect,
}: FieldEditorProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const editable = !!onChange;
  const { a, b } = boundaryAxes(venue);
  const showMirrored = hand === 'L' && mirrorForLeft;
  const display = showMirrored ? positions.map(mirror) : positions;
  const validation = useMemo(() => validateField(display, hand, { powerplay, maxOutsidePP: rules.maxOutsidePP, maxOutside: rules.maxOutside, venue }), [display, hand, powerplay, venue, rules.maxOutsidePP, rules.maxOutside]);
  const maxOut = powerplay ? rules.maxOutsidePP : rules.maxOutside;

  const toWorld = (clientX: number, clientY: number): FieldPoint | null => {
    const el = svg.current;
    if (!el) return null;
    const pt = el.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = el.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    return { x: Math.round(p.x * 2) / 2, y: Math.round(-p.y * 2) / 2 };
  };

  const clampInside = (p: FieldPoint): FieldPoint => {
    if (insideBoundary(p, venue, 1.5)) return p;
    const len = Math.hypot(p.x, p.y) || 1;
    const scale = 1 / Math.sqrt((p.x * p.x) / ((a - 2) * (a - 2)) + (p.y * p.y) / ((b - 2) * (b - 2)));
    return { x: Math.round(((p.x / len) * len * scale) * 2) / 2, y: Math.round(((p.y / len) * len * scale) * 2) / 2 };
  };

  const setAt = (i: number, displayPoint: FieldPoint) => {
    if (!onChange) return;
    const p = clampInside(displayPoint);
    const stored = showMirrored ? mirror(p) : p;
    onChange(positions.map((q, j) => (j === i ? stored : q)));
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    const p = toWorld(e.clientX, e.clientY);
    if (p) setAt(drag, p);
  };

  const onKey = (i: number) => (e: KeyboardEvent<SVGGElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const cur = display[i];
    const d: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (d[e.key] && editable) {
      e.preventDefault();
      setAt(i, { x: cur.x + d[e.key][0], y: cur.y + d[e.key][1] });
    }
  };

  // zone wedges for the heatmap (batter-relative zones, drawn for the current hand)
  const maxZone = zoneRuns ? Math.max(1, ...zoneRuns) : 1;
  const wedge = (z: number) => {
    const offStart = z < 4 ? z * 45 : -180 + (z - 4) * 45;
    const angles = [offStart, offStart + 45].map((deg) => ((hand === 'L' ? -deg : deg) * Math.PI) / 180);
    const R = Math.max(a, b) + 12;
    const p = (ang: number) => `${STRIKER.x + Math.sin(ang) * R} ${-(STRIKER.y + Math.cos(ang) * R)}`;
    return `M ${STRIKER.x} ${-STRIKER.y} L ${p(angles[0])} L ${p(angles[1])} Z`;
  };

  const vbW = a + 8;
  const vbH = Math.max(b, 70) + 8;
  return (
    <div className={className}>
      <svg
        ref={svg}
        viewBox={`${-vbW} ${-vbH} ${vbW * 2} ${vbH * 2}`}
        className={`${svgClassName} touch-none select-none`}
        role="group"
        aria-label={`${label}. ${hand === 'L' ? 'Left-handed' : 'Right-handed'} batter view; off side is on the ${hand === 'L' ? 'left' : 'right'}.`}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <defs>
          <radialGradient id="grass" cx="50%" cy="50%" r="60%">
            <stop offset="0" stopColor="#13311d" />
            <stop offset="1" stopColor="#0b1d12" />
          </radialGradient>
          <clipPath id="ground-clip">
            <ellipse cx="0" cy="0" rx={a} ry={b} />
          </clipPath>
        </defs>
        <ellipse cx="0" cy="0" rx={a} ry={b} fill="url(#grass)" stroke="#c6ff1a" strokeOpacity="0.55" strokeWidth="0.6" />
        {/* mowing stripes */}
        <g clipPath="url(#ground-clip)" opacity="0.18">
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={-a + i * ((2 * a) / 16)} y={-b} width={(2 * a) / 32} height={2 * b} fill="#1f4a2b" />
          ))}
        </g>
        {zoneRuns && (
          <g clipPath="url(#ground-clip)">
            {zoneRuns.map((r, z) => (
              <path key={z} d={wedge(z)} fill="#c6ff1a" opacity={(r / maxZone) * 0.32}>
                <title>{`${ZONES[z]}: ${r} runs`}</title>
              </path>
            ))}
          </g>
        )}
        <path d={capsulePath()} fill="none" stroke="#f4f6f8" strokeOpacity="0.35" strokeWidth="0.35" strokeDasharray="1.4 1.2" />
        {/* pitch, creases, stumps */}
        <rect x={-1.5} y={-SIM.stumpsY - 1.2} width={3} height={(SIM.stumpsY + 1.2) * 2} fill="#b59a6a" opacity="0.85" rx="0.3" />
        {[SIM.stumpsY, -SIM.stumpsY].map((y) => (
          <g key={y}>
            <line x1={-1.6} x2={1.6} y1={-y} y2={-y} stroke="#fff" strokeWidth="0.15" />
            <line x1={-1.6} x2={1.6} y1={-(y + (y > 0 ? -1.22 : 1.22))} y2={-(y + (y > 0 ? -1.22 : 1.22))} stroke="#fff" strokeWidth="0.15" />
            <rect x={-0.12} y={-y - 0.12} width={0.24} height={0.24} fill="#fff" />
          </g>
        ))}
        {/* side labels */}
        <text x={vbW - 6} y={-vbH + 7} textAnchor="end" fontSize="3.4" fill="#9aa3b2">{hand === 'L' ? 'LEG' : 'OFF'}</text>
        <text x={-vbW + 6} y={-vbH + 7} fontSize="3.4" fill="#9aa3b2">{hand === 'L' ? 'OFF' : 'LEG'}</text>
        <text x={0} y={-b - 2} textAnchor="middle" fontSize="3" fill="#6b7280">BOWLER’S END</text>

        {wagon?.map((w, i) => (
          <line key={i} x1={STRIKER.x} y1={-STRIKER.y} x2={w.end.x} y2={-w.end.y} strokeWidth={w.runs >= 4 ? 0.5 : 0.3} stroke={w.runs === 6 ? '#c6ff1a' : w.runs === 4 ? '#4cc3ff' : w.runs > 0 ? '#f4f6f8' : '#6b7280'} opacity={w.runs ? 0.75 : 0.35} />
        ))}
        {lastBall?.end && (
          <g>
            <line x1={STRIKER.x} y1={-STRIKER.y} x2={lastBall.end.x} y2={-lastBall.end.y} stroke={lastBall.wicket ? '#ff5c5c' : lastBall.boundary ? '#c6ff1a' : '#f4f6f8'} strokeWidth="0.6" strokeDasharray={lastBall.aerial ? '1.6 1' : undefined} />
            <circle cx={lastBall.end.x} cy={-lastBall.end.y} r="1.2" fill={lastBall.wicket ? '#ff5c5c' : lastBall.boundary ? '#c6ff1a' : '#fff'} />
          </g>
        )}

        {/* keeper, bowler, batter */}
        <circle cx={0} cy={-(keeperUp ? SIM.keeperUpY : SIM.keeperBackY)} r="1.8" fill="#4cc3ff" stroke="#07080a" strokeWidth="0.4">
          <title>Wicketkeeper ({keeperUp ? 'standing up' : 'standing back'})</title>
        </circle>
        <circle cx={0.8} cy={-5} r="1.5" fill="#9aa3b2"><title>Bowler</title></circle>
        <circle cx={hand === 'L' ? 0.6 : -0.6} cy={-STRIKER.y} r="1.2" fill="#ffb020"><title>Striker</title></circle>

        {display.map((p, i) => {
          const name = nearestPositionName(showMirrored ? mirror(p) : p);
          const out = !insideCircle(p);
          const isFocus = focus === i;
          return (
            <g
              key={i}
              tabIndex={editable ? 0 : -1}
              role={editable ? 'slider' : 'img'}
              aria-label={`Fielder ${i + 1}: ${name}, ${out ? 'outside' : 'inside'} the circle. ${editable ? 'Arrow keys move 1 metre, Shift+Arrow 5 metres.' : ''}`}
              aria-valuetext={`${name} at ${Math.round(p.x)}, ${Math.round(p.y)}`}
              onKeyDown={onKey(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              onPointerDown={(e) => {
                onSelect?.(i);
                if (!editable) return;
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDrag(i);
              }}
              style={{ cursor: editable ? (drag === i ? 'grabbing' : 'grab') : 'default', outline: 'none' }}
            >
              <circle cx={p.x} cy={-p.y} r={editable ? 3.6 : 2.6} fill="transparent" />
              <circle cx={p.x} cy={-p.y} r="2.2" fill={out ? '#C5F36B' : '#F1F0E8'} stroke={isFocus || drag === i || selected === i ? '#D9AE69' : '#101210'} strokeWidth={isFocus || drag === i || selected === i ? 0.8 : 0.4} />
              <text x={p.x} y={-p.y + 0.9} textAnchor="middle" fontSize="2.2" fontWeight="700" fill="#101210" pointerEvents="none">
                {ABBR[name] ?? i + 1}
              </text>
              {names?.[i] && (
                <text x={p.x} y={-p.y + 5.2} textAnchor="middle" fontSize="2.3" fill="#F1F0E8" opacity="0.85" pointerEvents="none">{names[i]}</text>
              )}
              <title>{names?.[i] ? `${names[i]} — ${name}` : name}</title>
            </g>
          );
        })}
      </svg>
      {showValidation && (
        <div className="mt-2 space-y-1 text-xs" aria-live="polite">
          <div className="flex flex-wrap gap-3 text-ink-muted">
            <span>Outside circle: <b className={validation.outsideCircle > maxOut ? 'text-danger' : 'text-ink'}>{validation.outsideCircle}</b> / {maxOut}{powerplay ? ' (powerplay)' : ''}</span>
            <span>Leg side behind square: <b className={validation.legBehindSquare > 2 ? 'text-danger' : 'text-ink'}>{validation.legBehindSquare}</b> / 2</span>
          </div>
          {validation.errors.map((e) => <p key={e} className="text-danger">⚠ Illegal: {e} (deliveries would be called no-ball)</p>)}
          {validation.warnings.map((w) => <p key={w} className="text-warn">△ {w}</p>)}
        </div>
      )}
    </div>
  );
}
