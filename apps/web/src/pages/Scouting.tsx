import { useEffect, useState } from 'react';
import { cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Meter, Modal, PageHeader } from '../components/ui';
import { ConditionBadges, OvrChip, PlayerName, RoleBadge } from '../components/player';

export function ScoutingPage() {
  const career = useCareer();
  const meta = useApi<any>('/meta');
  const [q, setQ] = useState({ search: '', role: '', league: '', status: 'all', sort: 'ovr', page: 0 });
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams(Object.entries(debounced).filter(([, v]) => v !== '' && v !== 'all').map(([k, v]) => [k, String(v)]));
  const state = useApi<any>(`/careers/${career.id}/players?${params}`, [career.tick, params.toString()]);
  const [compare, setCompare] = useState<any[]>([]);
  const toggleCompare = (p: any) => setCompare((c) => (c.some((x) => x.id === p.id) ? c.filter((x) => x.id !== p.id) : [...c.slice(-1), p]));
  return (
    <div className="space-y-5">
      <PageHeader title="Scouting & player database" subtitle="Ratings for other clubs’ players are scouted ranges; better scouting narrows them." actions={compare.length === 2 && <CompareButton players={compare} />} />
      <div className="card flex flex-wrap gap-2 p-3">
        <input className="input w-56" placeholder="Search players" aria-label="Search players" value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value, page: 0 })} />
        <select className="input w-auto" aria-label="Role" value={q.role} onChange={(e) => setQ({ ...q, role: e.target.value, page: 0 })}><option value="">All roles</option><option value="BAT">Batters</option><option value="WK">Wicketkeepers</option><option value="AR">All-rounders</option><option value="BOWL">Bowlers</option></select>
        <select className="input w-auto" aria-label="League" value={q.league} onChange={(e) => setQ({ ...q, league: e.target.value, page: 0 })}><option value="">Any league</option>{meta.data?.leagues.map((l: any) => <option key={l.id} value={l.id}>{l.shortName}</option>)}</select>
        <select className="input w-auto" aria-label="Status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 0 })}><option value="all">All</option><option value="contracted">Contracted</option><option value="free">Free agents</option><option value="mine">My squad</option></select>
        <select className="input w-auto" aria-label="Sort" value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value, page: 0 })}><option value="ovr">Overall</option><option value="value">Market value</option><option value="runs">Season runs</option><option value="wickets">Season wickets</option><option value="age">Youngest</option><option value="name">Name</option></select>
      </div>
      <Async state={state}>
        {(d) => (
          <Card pad={false} title={`${d.total} players`} actions={
            <div className="flex items-center gap-2 text-sm">
              <button className="btn-ghost px-2 py-1" disabled={q.page === 0} onClick={() => setQ({ ...q, page: q.page - 1 })}>‹ Prev</button>
              <span className="num">{q.page + 1}/{Math.max(1, Math.ceil(d.total / d.pageSize))}</span>
              <button className="btn-ghost px-2 py-1" disabled={(q.page + 1) * d.pageSize >= d.total} onClick={() => setQ({ ...q, page: q.page + 1 })}>Next ›</button>
            </div>
          }>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Compare</th><th>Player</th><th>Role</th><th>Ctry</th><th>Age</th><th>Club</th><th>Ovr</th><th>Pot.</th><th className="text-right">Value</th><th className="text-right">Season</th></tr></thead>
                <tbody>
                  {d.players.map((p: any) => (
                    <tr key={p.id}>
                      <td><input type="checkbox" className="accent-[#c6ff1a]" aria-label={`Compare ${p.name}`} checked={compare.some((x) => x.id === p.id)} onChange={() => toggleCompare(p)} /></td>
                      <td><span className="flex items-center gap-2"><PlayerName p={p} /><ConditionBadges p={p} /></span></td>
                      <td><RoleBadge role={p.role} /></td>
                      <td>{p.country}</td>
                      <td className="num">{p.age}</td>
                      <td>{p.clubShort ?? <Badge tone="muted">FA</Badge>}</td>
                      <td><OvrChip p={p} /></td>
                      <td className="num text-ink-muted">{p.potential.lo}–{p.potential.hi}</td>
                      <td className="num text-right">{cr(p.marketValue)}</td>
                      <td className="num text-right text-ink-muted">{p.season.runs}r · {p.season.wickets}w</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Async>
    </div>
  );
}

function CompareButton({ players }: { players: any[] }) {
  const [open, setOpen] = useState(false);
  const rows: [string, (p: any) => number | string][] = [
    ['Overall', (p) => p.ovr], ['Batting', (p) => p.batting], ['Bowling', (p) => (p.bowlType === 'NONE' ? 0 : p.bowling)], ['Fielding', (p) => p.fielding],
    ['Age', (p) => p.age], ['Value (₹ Cr)', (p) => p.marketValue], ['Season runs', (p) => p.season.runs], ['Season SR', (p) => p.season.strikeRate ?? 0],
    ['Season wickets', (p) => p.season.wickets], ['Season economy', (p) => p.season.economy ?? 0],
  ];
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>Compare {players[0].shortName} v {players[1].shortName}</button>
      <Modal open={open} title="Player comparison" onClose={() => setOpen(false)} wide>
        <table className="table">
          <thead><tr><th></th>{players.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, f]) => {
              const [a, b] = players.map(f);
              return (
                <tr key={label}>
                  <td className="text-ink-muted">{label}</td>
                  {[a, b].map((v, i) => <td key={i} className={`num ${typeof v === 'number' && v > ([a, b][1 - i] as number) && label !== 'Age' && label !== 'Season economy' ? 'text-lime' : ''}`}>{v}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {players.map((p) => (
            <div key={p.id} className="space-y-2">
              <div className="label">{p.name}</div>
              <Meter label="Batting" value={p.batting} />
              <Meter label="Bowling" value={p.bowlType === 'NONE' ? 0 : p.bowling} />
              <Meter label="Fielding" value={p.fielding} />
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
