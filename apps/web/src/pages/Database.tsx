import { useEffect, useState } from 'react';
import { ROLE_LABEL, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { usePlayerModal } from '../components/player';
import { Async, Badge, PageHeader } from '../components/ui';

const NAT_LABEL: Record<string, { label: string; tone: 'lime' | 'info' | 'muted' | 'warn' }> = {
  verified: { label: 'Verified', tone: 'lime' }, inferred: { label: 'Inferred', tone: 'info' }, unknown: { label: 'Unknown', tone: 'warn' }, generated: { label: 'Fictional', tone: 'muted' },
};

/** The full player database: every record, what is fact and what is estimated, and where each player is in this career. */
export function DatabasePage() {
  const career = useCareer();
  const players = usePlayerModal();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [gender, setGender] = useState('all');
  const [nationality, setNationality] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [q, kind, gender, nationality, status]);
  const params = new URLSearchParams({ kind, gender, nationality, status, page: String(page), ...(q ? { search: q } : {}) });
  const state = useApi<any>(`/careers/${career.id}/database?${params}`, [params.toString()]);
  const sel = (label: string, value: string, set: (v: string) => void, options: [string, string][]) => (
    <label className="text-xs text-ink-muted">
      {label}
      <select className="input mt-0.5 block w-full py-1.5 text-sm" value={value} onChange={(e) => set(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div className="space-y-5">
      <PageHeader kicker="World Cricket" title="Player database" subtitle="Every player record, with what is fact and what is a game estimate." />
      <Async state={state}>
        {(d) => {
          const s = d.meta.summary;
          return (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Player records', s.total, 'unique, validated'],
                  ['Real players', s.real, `${s.activeReal} active in 2024–26`],
                  ['Active, nationality verified', s.activeRealVerifiedNationality, 'from international appearances'],
                  ['Generated players', s.generated, 'fictional, marked as such'],
                ].map(([label, n, sub]) => (
                  <div key={label as string} className="card p-4">
                    <div className="label">{label}</div>
                    <div className="num mt-1 text-3xl font-semibold">{Number(n).toLocaleString()}</div>
                    <div className="text-xs text-ink-faint">{sub}</div>
                  </div>
                ))}
              </section>
              <p className="text-xs text-ink-faint">
                Source: {d.meta.source}. Built {d.meta.built} from {Number(s.matchesRead).toLocaleString()} matches; {s.issues} validation issues.
                Nationality is verified only from international appearances, inferred from home-country competitions otherwise, and left unknown when the evidence conflicts.
                Ratings, bowling style, batting hand and age of database players are game estimates. Women players are in the database but the game’s competitions are men’s.
              </p>
              <section className="card p-4">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <label className="text-xs text-ink-muted sm:col-span-3 lg:col-span-2">
                    Search
                    <input className="input mt-0.5 block w-full py-1.5 text-sm" placeholder="Name" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </label>
                  {sel('Type', kind, setKind, [['all', 'All'], ['real', 'Real'], ['generated', 'Generated']])}
                  {sel('Gender', gender, setGender, [['all', 'All'], ['male', 'Men'], ['female', 'Women']])}
                  {sel('Nationality', nationality, setNationality, [['all', 'Any'], ['verified', 'Verified'], ['inferred', 'Inferred'], ['unknown', 'Unknown']])}
                  {sel('Status', status, setStatus, [['all', 'Any'], ['active', 'Active'], ['stale', 'Stale']])}
                </div>
              </section>
              <section className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Player</th><th>Nation</th><th>Role</th><th className="text-right">Real matches</th><th>Last seen</th><th>Estimates</th><th>In this career</th></tr></thead>
                    <tbody>
                      {d.rows.map((r: any) => (
                        <tr key={r.id}>
                          <td>
                            {r.playerId ? <button className="font-medium hover:text-lime hover:underline" onClick={() => players.open(r.playerId)}>{r.name}</button> : <span className="font-medium">{r.name}</span>}
                            <span className="ml-1 text-xs text-ink-faint">{r.gender === 'female' ? 'W' : ''}</span>
                          </td>
                          <td><span className="mr-1">{r.countryName ?? '—'}</span><Badge tone={NAT_LABEL[r.nationality].tone}>{NAT_LABEL[r.nationality].label}</Badge></td>
                          <td className="text-ink-muted">{ROLE_LABEL[r.role]}</td>
                          <td className="num text-right">{r.record?.matches ?? '—'}</td>
                          <td className="text-ink-muted">{r.lastSeen ?? '—'}</td>
                          <td className="text-xs text-ink-muted">{r.estimates === 'curated' ? 'Curated' : r.estimates === 'derived' ? 'Estimated from real record' : 'Generated'}</td>
                          <td className="text-xs">{r.inGame}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-obsidian-700 px-4 py-2 text-sm text-ink-muted">
                  <span>{d.total.toLocaleString()} matching · page {page + 1} of {Math.max(1, Math.ceil(d.total / 50))}</span>
                  <span className="flex gap-2">
                    <button className="btn-quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                    <button className="btn-quiet" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</button>
                  </span>
                </div>
              </section>
            </>
          );
        }}
      </Async>
    </div>
  );
}
