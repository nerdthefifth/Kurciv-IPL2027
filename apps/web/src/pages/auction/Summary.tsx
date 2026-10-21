import { useState } from 'react';
import { cr, useApi } from '../../lib/api';
import { useCareer } from '../../lib/context';
import { ClubCrestById } from '../../components/media';
import { ContinueButton } from '../../components/Shell';
import { PlayerName } from '../../components/player';
import { Async, Badge, Meter, Tabs } from '../../components/ui';

export function AuctionSummary() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/auction/summary`, [career.tick]);
  const [tab, setTab] = useState<'mine' | 'clubs' | 'market'>('mine');
  return (
    <Async state={state}>
      {(s) => {
        if (!s) return <p className="text-ink-muted">No auction this season.</p>;
        const mine = s.clubs.find((c: any) => c.isUser);
        const rank = s.clubs.findIndex((c: any) => c.isUser) + 1;
        return (
          <div className="space-y-6">
            <section className="card grain relative overflow-hidden p-6 md:p-8">
              <div className="kicker">Auction complete · {s.leagueName}</div>
              <h1 className="headline mt-2 text-4xl">The hammer falls for the last time.</h1>
              {mine && (
                <p className="mt-3 max-w-2xl text-ink-muted">
                  {mine.name} signed <b className="text-ink">{mine.signings.length}</b> player{mine.signings.length === 1 ? '' : 's'} for <b className="text-ink">{cr(mine.spent)}</b>, finishing with a squad of {mine.squad} and {cr(mine.purse)} left.
                  On paper, theirs is the <b className="text-ink">{rank}{['th', 'st', 'nd', 'rd'][rank % 10 > 3 || [11, 12, 13].includes(rank % 100) ? 0 : rank % 10]}</b> strongest XI in the league.
                </p>
              )}
              <div className="mt-5"><ContinueButton big /></div>
            </section>

            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'Your auction' }, { id: 'clubs', label: 'Every franchise' }, { id: 'market', label: 'Market moments' }]} />

            {tab === 'mine' && mine && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="card overflow-hidden">
                  <table className="table">
                    <thead><tr><th>Signing</th><th>Role</th><th className="text-right">Price</th><th className="text-right">Estimate</th><th className="text-right">Value</th></tr></thead>
                    <tbody>
                      {mine.signings.map((x: any) => {
                        const d = x.estimate - x.price;
                        return (
                          <tr key={x.playerId}>
                            <td><PlayerName p={{ id: x.playerId, name: x.name }} /></td><td className="text-ink-muted">{x.role}</td>
                            <td className="num text-right">{cr(x.price)}</td><td className="num text-right text-ink-muted">{cr(x.estimate)}</td>
                            <td className={`num text-right ${d >= 0 ? 'text-lime' : 'text-warn'}`}>{d >= 0 ? '+' : ''}{d.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!mine.signings.length && <p className="p-4 text-sm text-ink-muted">No signings at this auction.</p>}
                </div>
                <aside className="card space-y-3 p-5 text-sm">
                  <h2 className="h-section">Squad balance</h2>
                  {mine.balance.map((b: any) => <Meter key={b.label} label={b.label} display={`${b.have}/${b.target}`} value={Math.min(100, (b.have / Math.max(1, b.target)) * 100)} />)}
                  <p className="text-ink-muted">Strongest area: <b className="text-ink">{mine.strongest}</b>. Thinnest: <b className="text-ink">{mine.weakest}</b>.</p>
                  <p className="text-ink-muted">Overseas: {mine.overseas} · Vacancies: {mine.vacancies}. Free agents can fill gaps in pre-season.</p>
                </aside>
              </div>
            )}

            {tab === 'clubs' && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {s.clubs.map((c: any, i: number) => (
                  <div key={c.id} className={`card p-4 ${c.isUser ? 'border-lime/60' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="num w-5 text-ink-faint">{i + 1}</span>
                      <ClubCrestById clubId={c.id} size={36} fallback={c} />
                      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{c.name}</div><div className="text-xs text-ink-muted">XI strength {c.strength}</div></div>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-ink-faint">Spent</dt><dd className="num text-sm">{cr(c.spent)}</dd></div>
                      <div><dt className="text-ink-faint">Left</dt><dd className="num text-sm">{cr(c.purse)}</dd></div>
                      <div><dt className="text-ink-faint">Squad</dt><dd className="num text-sm">{c.squad}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-ink-muted">Best signing: {c.signings.length ? [...c.signings].sort((a: any, b: any) => b.price - a.price)[0].name : '—'} · strongest {c.strongest.toLowerCase()}</p>
                  </div>
                ))}
              </div>
            )}

            {tab === 'market' && (
              <div className="grid gap-6 lg:grid-cols-3">
                <List title="Most expensive" rows={s.mostExpensive.map((x: any) => ({ ...x, right: cr(x.price) }))} />
                <List title="Best value" rows={s.bestValue.map((x: any) => ({ ...x, right: `${cr(x.price)} (est. ${cr(x.estimate)})` }))} />
                <List title="Biggest bidding wars" rows={s.biggestContests.map((x: any) => ({ ...x, right: `${x.bids} bids` }))} />
                <div className="card p-4 lg:col-span-3">
                  <div className="label mb-2">Unsold — now free agents</div>
                  <div className="flex flex-wrap gap-1.5">{s.unsold.slice(0, 60).map((u: any) => <Badge key={u.playerId} tone="muted">{u.name} · {u.role}</Badge>)}</div>
                  {!s.unsold.length && <p className="text-sm text-ink-muted">Every player found a club.</p>}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </Async>
  );
}

function List({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="card p-4">
      <div className="label mb-2">{title}</div>
      <ol className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.playerId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate"><PlayerName p={{ id: r.playerId, name: r.name }} /> <span className="text-xs text-ink-faint">{r.club}</span></span>
            <span className="num shrink-0 text-xs text-ink-muted">{r.right}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
