import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Empty, PageHeader } from '../components/ui';
import { FixtureRow } from './Fixtures';

export function StandingsTable({ rows, highlight = 0, slots = 0 }: { rows: any[]; highlight?: number; slots?: number }) {
  const { id } = useCareer();
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>#</th><th>Club</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">T</th><th className="text-right">Pts</th><th className="text-right">NRR</th><th>Form</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.clubId} className={r.isUser ? 'bg-lime/5' : ''}>
              <td className="num">
                {r.pos}
                {r.pos <= highlight && <span className="sr-only"> (playoff place)</span>}
              </td>
              <td>
                <Link to={`/c/${id}/club/${r.clubId}`} className={`hover:underline ${r.isUser ? 'font-semibold text-lime' : ''}`}>{r.club}</Link>
                {r.pos <= highlight && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-lime" title="Playoff place" aria-hidden />}
                {slots > 0 && r.pos <= slots && <span className="ml-1 text-[10px] text-info" title="Inside the World Club Championship places">WCC</span>}
              </td>
              <td className="num text-right">{r.played}</td>
              <td className="num text-right">{r.won}</td>
              <td className="num text-right">{r.lost}</td>
              <td className="num text-right">{r.tied}</td>
              <td className="num text-right font-semibold">{r.points}</td>
              <td className="num text-right text-ink-muted">{r.nrr >= 0 ? '+' : ''}{r.nrr.toFixed(3)}</td>
              <td className="space-x-0.5">{r.form.map((x: string, i: number) => <Badge key={i} tone={x === 'W' ? 'lime' : x === 'L' ? 'danger' : 'warn'}>{x}</Badge>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TablePage() {
  const career = useCareer();
  const o = career.overview.data;
  const [league, setLeague] = useState<string | null>(null);
  const meta = useApi<any>('/meta');
  const lid = league ?? o?.club.leagueId ?? 'IPL';
  const state = useApi<any>(`/careers/${career.id}/leagues/${lid}`, [career.tick, lid]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="League table"
        actions={meta.data && (
          <select aria-label="League" className="input w-auto" value={lid} onChange={(e) => setLeague(e.target.value)}>
            {meta.data.leagues.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      />
      <Async state={state}>
        {(d) => (
          <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
            <Card title={d.competition?.name ?? d.league.name} actions={<span className="text-xs text-ink-muted">Reputation {d.state.reputation.toFixed(1)} · {d.state.wccSlots} WCC places · playoffs: {d.league.playoffs}</span>}>
              {d.table.length ? <StandingsTable rows={d.table} highlight={d.league.playoffs === 'ipl4' || d.league.playoffs === 'semis' ? 4 : 2} slots={d.state.wccSlots} /> : <Empty title="Season not started">The table appears once fixtures begin.</Empty>}
              <p className="mt-3 text-xs text-ink-faint">Two points for a win, one for a tie. Ties on points are separated by net run rate; a side bowled out is charged its full 20 overs.</p>
            </Card>
            <Card title="Knockouts & recent results" pad={false}>
              <ul>
                {d.fixtures.filter((f: any) => f.stage !== 'League').map((f: any) => <FixtureRow key={f.id} f={f} season={o?.season ?? 2027} userClubId={o?.club.id} />)}
                {d.fixtures.filter((f: any) => f.status === 'complete').slice(-10).reverse().map((f: any) => <FixtureRow key={`r${f.id}`} f={f} season={o?.season ?? 2027} userClubId={o?.club.id} />)}
              </ul>
              {!d.fixtures.length && <p className="p-4 text-sm text-ink-muted">No fixtures yet.</p>}
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}
