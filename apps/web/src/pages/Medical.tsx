import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, DataTable, Empty, Meter, PageHeader, Stat } from '../components/ui';
import { PlayerName } from '../components/player';

export function MedicalPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/squad`, [career.tick]);
  return (
    <Async state={state}>
      {(d) => {
        const injured = d.players.filter((p: any) => p.injury);
        const tired = d.players.filter((p: any) => !p.injury && p.fatigue >= 60);
        return (
          <div className="space-y-5">
            <PageHeader title="Medical centre" subtitle={`Medical facility level ${d.club.facilities.medical}/5 — speeds rehabilitation and daily recovery.`} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Injured" value={injured.length} />
              <Stat label="Heavily fatigued" value={tired.length} sub="fatigue ≥ 60" />
              <Stat label="Fit & available" value={d.players.length - injured.length} />
            </div>
            <Card title="Injury list">
              {injured.length ? (
                <ul className="space-y-3">
                  {injured.map((p: any) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 p-3">
                      <div><PlayerName p={p} /> <Badge tone="danger">{p.injury.severity}</Badge></div>
                      <div className="text-sm text-ink-muted">{p.injury.type} · about {p.injury.daysRemaining} days left (initial assessment {p.injury.expected})</div>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="No injuries">Everyone is available for selection.</Empty>}
            </Card>
            <Card title="Fatigue & workload" pad={false}>
              <DataTable<any>
                rows={d.players}
                rowKey={(p) => p.id}
                initialSort={{ key: 'f', dir: -1 }}
                columns={[
                  { key: 'n', label: 'Player', render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
                  { key: 'r', label: 'Role', render: (p) => `${p.role} · ${p.bowlType}`, sort: (p) => p.role },
                  { key: 'a', label: 'Age', render: (p) => p.age, sort: (p) => p.age },
                  { key: 'f', label: 'Fatigue', render: (p) => <div className="w-32"><Meter value={p.fatigue} invert /></div>, sort: (p) => p.fatigue },
                  { key: 'm', label: 'Morale', render: (p) => <div className="w-32"><Meter value={p.morale} /></div>, sort: (p) => p.morale },
                  { key: 's', label: 'Status', render: (p) => (p.injury ? <Badge tone="danger">Injured</Badge> : p.fatigue >= 75 ? <Badge tone="warn">Rest advised</Badge> : <Badge tone="lime">Available</Badge>) },
                ]}
              />
              <p className="p-4 text-xs text-ink-faint">Fatigue builds ball by ball (fast bowlers fastest) and recovers on rest days. It never resets after a match. High fatigue lowers execution and raises injury risk, so rotate through the Squad page.</p>
            </Card>
          </div>
        );
      }}
    </Async>
  );
}
