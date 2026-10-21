/** Lightweight SVG charts for the broadcast views. Each chart has a text summary for screen readers. */

const COLORS = ['#c6ff1a', '#4cc3ff'];

export function Worm({ innings, labels, overs = 20 }: { innings: number[][]; labels: string[]; overs?: number }) {
  const cum = innings.map((runs) => runs.reduce<number[]>((acc, r) => [...acc, (acc[acc.length - 1] ?? 0) + r], [0]));
  const max = Math.max(60, ...cum.flat()) * 1.08;
  const W = 300;
  const H = 150;
  const x = (o: number) => 28 + (o / overs) * (W - 36);
  const y = (r: number) => H - 18 - (r / max) * (H - 30);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Worm chart: ${labels.map((l, i) => `${l} ${cum[i][cum[i].length - 1]}`).join(', ')}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={28} x2={W - 8} y1={y(max * t)} y2={y(max * t)} stroke="#1e2128" />
            <text x={24} y={y(max * t) + 3} textAnchor="end" fontSize="7" fill="#6b7280">{Math.round(max * t)}</text>
          </g>
        ))}
        {[0, 5, 10, 15, 20].map((o) => <text key={o} x={x(o)} y={H - 6} textAnchor="middle" fontSize="7" fill="#6b7280">{o}</text>)}
        {cum.map((c, i) => (
          <polyline key={i} fill="none" stroke={COLORS[i]} strokeWidth="1.8" points={c.map((r, o) => `${x(o)},${y(r)}`).join(' ')} />
        ))}
      </svg>
      <figcaption className="mt-1 flex gap-3 text-xs text-ink-muted">
        {labels.map((l, i) => <span key={l}><span className="mr-1 inline-block h-2 w-3 rounded" style={{ background: COLORS[i] }} />{l}</span>)}
      </figcaption>
    </figure>
  );
}

export function Manhattan({ runs, wickets, label }: { runs: number[]; wickets: number[]; label: string }) {
  const max = Math.max(12, ...runs);
  const W = 300;
  const H = 120;
  const bw = (W - 30) / 20;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Manhattan for ${label}: runs per over ${runs.join(', ')}`}>
        {runs.map((r, i) => {
          const h = (r / max) * (H - 30);
          return (
            <g key={i}>
              <rect x={24 + i * bw + 1} y={H - 16 - h} width={bw - 2} height={h} fill={r >= 12 ? '#c6ff1a' : '#3a3f4a'} rx="1">
                <title>{`Over ${i + 1}: ${r} runs${wickets[i] ? `, ${wickets[i]} wkt` : ''}`}</title>
              </rect>
              {Array.from({ length: wickets[i] ?? 0 }, (_, k) => <circle key={k} cx={24 + i * bw + bw / 2} cy={H - 20 - h - k * 5} r="1.8" fill="#ff5c5c" />)}
              {(i + 1) % 5 === 0 && <text x={24 + i * bw + bw / 2} y={H - 5} textAnchor="middle" fontSize="7" fill="#6b7280">{i + 1}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-ink-muted">{label} — runs per over (red dots = wickets, lime = 12+)</figcaption>
    </figure>
  );
}

export function WinProb({ points, home, away }: { points: number[]; home: string; away: string }) {
  const W = 300;
  const H = 90;
  const x = (i: number) => 4 + (i / Math.max(1, points.length - 1)) * (W - 8);
  const y = (p: number) => 6 + (1 - p) * (H - 12);
  const last = points[points.length - 1] ?? 0.5;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Win probability: ${home} ${Math.round(last * 100)}%, ${away} ${Math.round((1 - last) * 100)}%`}>
        <line x1={0} x2={W} y1={y(0.5)} y2={y(0.5)} stroke="#2a2e37" strokeDasharray="3 3" />
        <polyline fill="none" stroke="#c6ff1a" strokeWidth="1.6" points={points.map((p, i) => `${x(i)},${y(p)}`).join(' ')} />
      </svg>
      <figcaption className="flex justify-between text-xs text-ink-muted">
        <span>{home} {Math.round(last * 100)}%</span>
        <span>{away} {Math.round((1 - last) * 100)}%</span>
      </figcaption>
    </figure>
  );
}

export function Sparkline({ values, width = 120, height = 32, color = '#c6ff1a' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="1.6" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  );
}
