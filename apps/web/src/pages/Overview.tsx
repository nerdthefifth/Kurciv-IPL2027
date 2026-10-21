import { Link } from 'react-router-dom';
import { cr, dayLabel } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Empty, Meter, PageHeader, Stat } from '../components/ui';

export function OverviewPage() {
  const { overview, id } = useCareer();
  return (
    <Async state={overview}>
      {(o) => {
        const c = o.club;
        return (
          <div className="space-y-5">
            <PageHeader title={c.name} subtitle={`${c.leagueName} · ${c.venue} · Manager ${o.managerName}`} />
            {o.urgent.length > 0 && (
              <div className="rounded-xl border border-lime/40 bg-lime/5 p-4" role="region" aria-label="Urgent decisions">
                <div className="label mb-2 text-lime">Decisions waiting</div>
                <ul className="space-y-1 text-sm">{o.urgent.map((u) => <li key={u}>▸ {u}</li>)}</ul>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="League position" value={o.position ? `${o.position.pos}` : '—'} sub={o.position ? `${o.position.points} pts · NRR ${o.position.nrr.toFixed(3)}` : 'Season not started'} />
              <Stat label="Auction purse" value={cr(o.finance.purse)} sub={`Payroll ${cr(o.finance.payroll)}`} />
              <Stat label="Cash reserves" value={cr(o.finance.cash)} sub="Operating finances" />
              <Stat label="Board confidence" value={c.board.confidence} sub={c.board.warnings ? `${c.board.warnings} warning(s)` : 'Stable'} />
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Next fixture" className="xl:col-span-2">
                {o.nextFixture ? (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="label">{o.nextFixture.competition} · {o.nextFixture.stage}</div>
                      <div className="mt-1 font-display text-3xl font-bold uppercase">{o.nextFixture.homeName} <span className="text-ink-faint">v</span> {o.nextFixture.awayName}</div>
                      <div className="text-sm text-ink-muted">{dayLabel(o.season, o.nextFixture.day)} · {o.nextFixture.venue}{o.nextFixture.day === o.day ? ' · TODAY' : ''}</div>
                    </div>
                    <Link to={`/c/${id}/match`} className="btn-primary">Match Centre</Link>
                  </div>
                ) : (
                  <Empty title={o.phase === 'season' ? 'No fixture scheduled' : 'Out of season'}>
                    {o.phase === 'auction' ? 'Build your squad in the auction room first.' : o.phase === 'preseason' ? 'Start the season from the top bar when your squad is ready.' : 'Your next fixtures appear here once scheduled.'}
                  </Empty>
                )}
                {o.recent.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2" aria-label="Recent results">
                    {o.recent.map((f) => {
                      const won = f.result?.winnerId === c.id;
                      const tie = f.result && !f.result.winnerId;
                      return (
                        <Link key={f.id} to={`/c/${id}/fixtures/${f.id}`} className="rounded-lg border border-obsidian-700 px-3 py-2 text-xs hover:border-lime/50" title={f.result?.margin}>
                          <Badge tone={won ? 'lime' : tie ? 'warn' : 'danger'}>{won ? 'W' : tie ? 'T' : 'L'}</Badge>{' '}
                          v {f.homeId === c.id ? f.away : f.home}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Card>
              <Card title="Board objectives">
                {c.board.objectives.length ? (
                  <ul className="space-y-2 text-sm">
                    {c.board.objectives.map((ob: any) => (
                      <li key={ob.id} className="flex items-start gap-2">
                        <Badge tone={ob.status === 'met' ? 'lime' : ob.status === 'failed' ? 'danger' : 'muted'}>{ob.status}</Badge>
                        <span>{ob.description} <span className="text-ink-faint">({ob.importance})</span></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-ink-muted">Objectives are set when the season starts.</p>}
              </Card>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="League table" actions={<Link to={`/c/${id}/table`} className="text-xs text-lime">Full table</Link>}>
                {o.table.length ? (
                  <table className="table">
                    <thead><tr><th>#</th><th>Club</th><th>P</th><th>Pts</th><th>NRR</th></tr></thead>
                    <tbody>{o.table.map((r) => <tr key={r.clubId} className={r.isUser ? 'bg-lime/5 text-lime' : ''}><td className="num">{r.pos}</td><td>{r.club}</td><td className="num">{r.played}</td><td className="num">{r.points}</td><td className="num">{r.nrr.toFixed(2)}</td></tr>)}</tbody>
                  </table>
                ) : <p className="text-sm text-ink-muted">The table appears once the season starts.</p>}
              </Card>
              <Card title="Fitness watch" actions={<Link to={`/c/${id}/medical`} className="text-xs text-lime">Medical centre</Link>}>
                {o.fitness.length ? (
                  <ul className="space-y-2">
                    {o.fitness.map((p) => (
                      <li key={p.id} className="grid grid-cols-[1fr_96px] items-center gap-2 text-sm">
                        <span className="truncate">{p.name} {p.injury && <Badge tone="danger">{p.injury}</Badge>}</span>
                        <Meter value={p.fatigue} invert compact />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-ink-muted">No registered players yet.</p>}
              </Card>
              <Card title="World chronicle">
                <ul className="space-y-3">
                  {o.news.slice(0, 7).map((n) => (
                    <li key={n.id} className="border-l-2 border-obsidian-600 pl-3 text-sm" style={{ borderColor: n.importance === 3 ? '#c6ff1a' : undefined }}>
                      <div className="font-semibold">{n.headline}</div>
                      <div className="text-xs text-ink-muted">{n.body}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
