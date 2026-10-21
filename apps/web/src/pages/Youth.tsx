import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Empty, Meter, PageHeader } from '../components/ui';
import { OvrChip, PlayerName, RoleBadge } from '../components/player';

export function YouthPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/squad`, [career.tick]);
  return (
    <Async state={state}>
      {(d) => (
        <div className="space-y-5">
          <PageHeader title="Youth academy" subtitle={`Academy facility level ${d.club.facilities.youth}/5 · scouting level ${d.club.facilities.scouting}/5. New prospects arrive every off-season.`} />
          {d.academy.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {d.academy.map((p: any) => (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <PlayerName p={p} className="text-lg" />
                      <div className="text-xs text-ink-muted">{p.countryName} · age {p.age} · {p.batHand}HB</div>
                    </div>
                    <RoleBadge role={p.role} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div><div className="label">Current</div><OvrChip p={p} /></div>
                    <div><div className="label">Potential (scouted)</div><div className="num text-lg">{p.potential.lo}–{p.potential.hi}</div></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Meter label="Batting" value={p.batting} />
                    <Meter label="Bowling" value={p.bowling} />
                  </div>
                  {p.potential.hi >= 80 && <Badge tone="lime">High ceiling</Badge>}
                  <div className="mt-4 flex gap-2">
                    <button className="btn-primary flex-1" disabled={p.age < 16} onClick={() => career.mutate(`/youth/${p.id}/promote`, {}, { success: `${p.name} promoted.` })}>Promote to squad</button>
                    <button className="btn-ghost" onClick={() => career.mutate(`/youth/${p.id}/release`, {}, { success: `${p.name} released.` })}>Release</button>
                  </div>
                  {p.age < 16 && <p className="mt-2 text-xs text-ink-faint">Too young to register (16+).</p>}
                </Card>
              ))}
            </div>
          ) : (
            <Empty title="Academy is empty">Prospects are generated each off-season from your country’s talent pool. Better youth facilities and scouting improve quality and reduce uncertainty. Elite prospects are rare.</Empty>
          )}
          <Card title="Development philosophy">
            <ul className="space-y-1 text-sm text-ink-muted">
              <li>▸ Potential is a scouted <i>range</i>, not a promise. Growth depends on playing time, coaching, facilities, training focus, morale and injuries.</li>
              <li>▸ Promoted players take a registered squad slot at the league minimum salary.</li>
              <li>▸ Debuting under-23 players can satisfy board youth objectives and builds your club’s youth-trust identity.</li>
            </ul>
          </Card>
        </div>
      )}
    </Async>
  );
}
