import { useParams } from 'react-router-dom';
import { cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, DataTable, Meter, PageHeader, Stat } from '../components/ui';
import { OvrChip, PlayerName, RoleBadge, ConditionBadges } from '../components/player';

export function ClubPage() {
  const { clubId } = useParams();
  const career = useCareer();
  const club = useApi<any>(`/careers/${career.id}/clubs/${clubId}`, [clubId, career.tick]);
  const intel = useApi<any>(`/careers/${career.id}/intel/${clubId}`, [clubId]);
  return (
    <Async state={club}>
      {(d) => (
        <div className="space-y-5">
          <PageHeader title={d.club.name} subtitle={`${d.club.leagueName} · ${d.club.venue} · ${d.club.personality.replace('-', ' ')} recruitment`} />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Elo rating" value={d.club.elo} />
            <Stat label="Squad" value={`${d.club.squadSize}`} sub={`${d.club.overseas} overseas`} />
            <Stat label="Brand / fans" value={`${d.club.brand} / ${d.club.fanBase}`} />
            <Stat label="Trophies" value={d.club.trophies.length} sub={d.club.trophies.slice(-2).map((t: any) => `${t.name} ${t.season}`).join(', ') || '—'} />
          </div>
          <Card title="Cricket Intelligence Room">
            <Async state={intel}>
              {(i) => (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-3">
                    <ul className="space-y-2">
                      {i.recommendations.map((r: any, k: number) => (
                        <li key={k} className="text-sm"><Badge tone={r.confidence === 'high' ? 'lime' : r.confidence === 'medium' ? 'info' : 'muted'}>{r.confidence}</Badge> <b>{r.text}</b> <span className="text-ink-muted">{r.evidence}</span></li>
                      ))}
                    </ul>
                    <div className="text-sm text-ink-muted">Average first-innings score {i.team.avgFirstInnings ?? '—'} · chases won {i.team.chaseWins}/{i.team.chases} · {i.matches} matches analysed</div>
                    <div className="space-y-2">
                      <Meter label="Tactical DNA: batting aggression" value={i.dna.aggression} />
                      <Meter label="Spin reliance" value={i.dna.spinReliance} />
                    </div>
                  </div>
                  <div>
                    <div className="label mb-1">Where they score (right-hander’s view)</div>
                    <div className="space-y-1">
                      {i.team.zones.map((z: any) => <Meter key={z.zone} tone="lime" label={z.zone} display={`${z.runs} runs`} value={Math.round((z.runs / Math.max(1, ...i.team.zones.map((x: any) => x.runs))) * 100)} />)}
                    </div>
                  </div>
                  <div className="lg:col-span-2 overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>Batter</th><th className="text-right">SR v pace (balls)</th><th className="text-right">SR v spin (balls)</th><th className="text-right">Death SR</th><th>Favourite zone</th></tr></thead>
                      <tbody>{i.batters.slice(0, 9).map((b: any) => <tr key={b.id}><td>{b.name}</td><td className="num text-right">{b.vsPace.sr ?? '—'} ({b.vsPace.balls})</td><td className="num text-right">{b.vsSpin.sr ?? '—'} ({b.vsSpin.balls})</td><td className="num text-right">{b.deathSr ?? '—'}</td><td className="text-ink-muted">{b.favouriteZone ?? '—'}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </Async>
          </Card>
          <Card title="Squad" pad={false}>
            <DataTable<any>
              rows={d.players}
              rowKey={(p) => p.id}
              initialSort={{ key: 'ovr', dir: -1 }}
              columns={[
                { key: 'n', label: 'Player', render: (p) => <span className="flex items-center gap-2"><PlayerName p={p} /><ConditionBadges p={p} /></span>, sort: (p) => p.name },
                { key: 'r', label: 'Role', render: (p) => <RoleBadge role={p.role} />, sort: (p) => p.role },
                { key: 'a', label: 'Age', render: (p) => p.age, sort: (p) => p.age },
                { key: 'ovr', label: 'Ovr (scouted)', render: (p) => <OvrChip p={p} />, sort: (p) => p.ovr },
                { key: 's', label: 'Salary', render: (p) => <span className="num text-ink-muted">{cr(p.contract?.salary)}</span>, sort: (p) => p.contract?.salary ?? 0 },
                { key: 'rw', label: 'Runs/Wkts', render: (p) => <span className="num">{p.season.runs}/{p.season.wickets}</span>, sort: (p) => p.season.runs + 20 * p.season.wickets },
              ]}
            />
          </Card>
        </div>
      )}
    </Async>
  );
}
