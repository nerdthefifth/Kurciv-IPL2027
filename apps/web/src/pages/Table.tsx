import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Empty, PageHeader } from '../components/ui';
import { FixtureRow } from './Fixtures';
import { usePlayerModal } from '../components/player';

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
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
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
      <CapsCard lid={lid} />
    </div>
  );
}

/** The live Orange Cap (most runs) and Purple Cap (most wickets) races for a league this season. */
function CapsCard({ lid }: { lid: string }) {
  const career = useCareer();
  const players = usePlayerModal();
  const [comp, setComp] = useState<'league' | 'WCC'>('league');
  const state = useApi<any>(`/careers/${career.id}/caps?league=${comp === 'WCC' ? 'WCC' : lid}`, [career.tick, lid, comp]);
  const table = (rows: any[], kind: 'orange' | 'purple') => (
    <table className="table text-sm">
      <thead><tr><th>#</th><th>Player</th><th className="text-right">M</th>{kind === 'orange' ? <><th className="text-right">Runs</th><th className="text-right">Avg</th><th className="text-right">SR</th><th className="text-right">HS</th></> : <><th className="text-right">Wkts</th><th className="text-right">Econ</th><th className="text-right">Best</th></>}</tr></thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={r.playerId} className={i === 0 ? (kind === 'orange' ? 'bg-[#f97316]/10' : 'bg-[#a855f7]/10') : ''}>
            <td className="num text-ink-muted">{i === 0 ? <CapIcon kind={kind} /> : i + 1}</td>
            <td><button className="font-medium hover:text-lime" onClick={() => players.open(r.playerId)}>{r.name}</button> <span className="text-xs text-ink-faint">{r.clubShort}</span></td>
            <td className="num text-right text-ink-muted">{r.matches}</td>
            {kind === 'orange'
              ? <><td className="num text-right font-semibold">{r.runs}</td><td className="num text-right">{r.average ?? '—'}</td><td className="num text-right">{r.strikeRate ?? '—'}</td><td className="num text-right">{r.highScore}</td></>
              : <><td className="num text-right font-semibold">{r.wickets}</td><td className="num text-right">{r.economy ?? '—'}</td><td className="num text-right">{r.best ?? '—'}</td></>}
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={7} className="py-3 text-center text-ink-muted">No matches played yet.</td></tr>}
      </tbody>
    </table>
  );
  return (
    <Card title="Orange & Purple Cap" actions={
      <span className="flex gap-1 text-xs">
        <button className={`rounded px-2 py-0.5 ${comp === 'league' ? 'bg-lime/15 text-lime' : 'text-ink-muted'}`} onClick={() => setComp('league')}>League</button>
        <button className={`rounded px-2 py-0.5 ${comp === 'WCC' ? 'bg-lime/15 text-lime' : 'text-ink-muted'}`} onClick={() => setComp('WCC')}>World Club Championship</button>
      </span>
    }>
      <Async state={state}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[#f97316]"><CapIcon kind="orange" /> Orange Cap · most runs{d.competition ? ` · ${d.competition.name}` : ''}</div>
              <div className="overflow-x-auto">{table(d.orange, 'orange')}</div>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[#a855f7]"><CapIcon kind="purple" /> Purple Cap · most wickets{d.competition ? ` · ${d.competition.name}` : ''}</div>
              <div className="overflow-x-auto">{table(d.purple, 'purple')}</div>
            </div>
          </div>
        )}
      </Async>
    </Card>
  );
}

export function CapIcon({ kind, size = 14 }: { kind: 'orange' | 'purple'; size?: number }) {
  const c = kind === 'orange' ? '#f97316' : '#a855f7';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={kind === 'orange' ? 'Orange Cap' : 'Purple Cap'} className="inline-block shrink-0">
      <path d="M2 10c0-4 2.7-7 6-7s6 3 6 7z" fill={c} />
      <path d="M1 10h10.5c1.6 0 3 .6 3.5 1.5H1z" fill={c} opacity="0.8" />
    </svg>
  );
}
