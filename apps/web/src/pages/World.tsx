import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, PageHeader } from '../components/ui';
import { Sparkline } from '../components/charts';

// Approximate geographic anchors for each league's home country (lon, lat).
const GEO: Record<string, [number, number]> = {
  IND: [78, 21], AUS: [134, -25], ENG: [-1.5, 52.5], SA: [24, -29], PAK: [69, 30], UAE: [54, 24], WI: [-61, 13], USA: [-97, 38], NZ: [172, -41], SL: [80.7, 7.8], BAN: [90, 23.7],
};

// Label placement per country: [dx, dy, anchor] so the South Asian cluster stays readable.
const LABEL: Record<string, [number, number, 'start' | 'end']> = {
  IND: [14, 18, 'start'], PAK: [-10, -14, 'end'], UAE: [-12, 8, 'end'], SL: [-10, 20, 'end'], BAN: [12, -16, 'start'],
  AUS: [12, -4, 'start'], NZ: [-12, 4, 'end'], SA: [12, 4, 'start'], ENG: [12, -4, 'start'], WI: [12, 4, 'start'], USA: [12, -4, 'start'],
};

function WorldMap({ leagues, userLeague }: { leagues: any[]; userLeague: string }) {
  const W = 760;
  const H = 400;
  // Cropped to cricket's footprint: longitudes −125…185, latitudes −50…62.
  const x = (lon: number) => 20 + ((lon + 125) / 310) * (W - 40);
  const y = (lat: number) => 20 + ((62 - lat) / 112) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Leagues by location; circle size shows reputation. ${leagues.map((l) => `${l.name} ${l.reputation.toFixed(1)}`).join(', ')}`}>
      <rect width={W} height={H} fill="#0a0c0f" rx="12" />
      {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={x(-120 + i * 30)} x2={x(-120 + i * 30)} y1={10} y2={H - 10} stroke="#151820" />)}
      {Array.from({ length: 5 }, (_, i) => <line key={`h${i}`} y1={y(60 - i * 25)} y2={y(60 - i * 25)} x1={10} x2={W - 10} stroke="#151820" />)}
      <line x1={10} x2={W - 10} y1={y(0)} y2={y(0)} stroke="#1e2128" strokeDasharray="4 4" />
      <text x={W - 16} y={y(0) - 4} textAnchor="end" fontSize="9" fill="#3a3f4a">EQUATOR</text>
      {leagues.map((l) => {
        const g = GEO[l.country];
        if (!g) return null;
        const r = 6 + (l.reputation / 100) * 22;
        const mine = l.id === userLeague;
        const [dx, dy, anchor] = LABEL[l.country] ?? [12, -4, 'start'];
        const cx = x(g[0]);
        const cy = y(g[1]);
        return (
          <g key={l.id}>
            <circle cx={cx} cy={cy} r={r} fill={mine ? '#c6ff1a' : '#4cc3ff'} opacity={0.14} />
            <circle cx={cx} cy={cy} r={4} fill={mine ? '#c6ff1a' : '#4cc3ff'} />
            <line x1={cx} y1={cy} x2={cx + dx * 0.7} y2={cy + dy * 0.7 - 3} stroke="#3a3f4a" />
            <text x={cx + dx} y={cy + dy - 4} textAnchor={anchor} fontSize="12" fontWeight="700" fill={mine ? '#c6ff1a' : '#f4f6f8'}>{l.shortName}</text>
            <text x={cx + dx} y={cy + dy + 9} textAnchor={anchor} fontSize="10" fill="#9aa3b2">{l.reputation.toFixed(1)} · {l.wccSlots} WCC</text>
          </g>
        );
      })}
    </svg>
  );
}

export function WorldPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/world`, [career.tick]);
  const userLeague = career.overview.data?.club.leagueId ?? '';
  return (
    <Async state={state}>
      {(d) => {
        const sorted = [...d.leagues].sort((a: any, b: any) => b.reputation - a.reputation);
        return (
          <div className="space-y-5">
            <PageHeader title="World map" subtitle="League reputation evolves every season from World Club Championship results, and decides next season’s qualification places and auction order." />
            <Card><WorldMap leagues={d.leagues} userLeague={userLeague} /></Card>
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Card title="League reputation" pad={false}>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>#</th><th>League</th><th>Country</th><th className="text-right">Reputation</th><th>Trend</th><th className="text-right">Last change</th><th className="text-right">WCC places</th><th className="text-right">Clubs</th></tr></thead>
                    <tbody>
                      {sorted.map((l: any, i: number) => {
                        const h = l.reputationHistory;
                        const last = h[h.length - 1];
                        return (
                          <tr key={l.id} className={l.id === userLeague ? 'bg-lime/5' : ''}>
                            <td className="num">{i + 1}</td>
                            <td>{l.name} {l.fictional && <Badge tone="muted">fictional</Badge>}</td>
                            <td>{l.countryName}</td>
                            <td className="num text-right font-semibold">{l.reputation.toFixed(1)}</td>
                            <td><Sparkline values={h.map((x: any) => x.reputation)} width={80} height={22} /></td>
                            <td className={`num text-right ${last.delta > 0 ? 'text-lime' : last.delta < 0 ? 'text-danger' : 'text-ink-muted'}`} title={last.reason}>{last.delta > 0 ? '+' : ''}{last.delta}</td>
                            <td className="num text-right">{l.wccSlots}</td>
                            <td className="num text-right">{l.clubs}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Qualification path">
                {d.plan && <p className="mb-3 text-sm text-ink-muted">{d.plan.description}</p>}
                <ul className="space-y-2 text-sm">
                  {d.qualification.filter((q: any) => q.slots > 0).map((q: any) => (
                    <li key={q.leagueId} className="flex flex-wrap justify-between gap-2 border-b border-obsidian-800 pb-2">
                      <span><b>{q.leagueId}</b> — top {q.slots}</span>
                      <span className="text-xs text-ink-muted">{q.clubs.length ? q.clubs.map((c: any) => c.name).join(', ') : 'decided by the final standings'}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-faint">At most 50 clubs qualify. Places blend reputation, recent WCC performance and league depth, with per-league caps and deterministic rounding.</p>
              </Card>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
