import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Card, PageHeader } from '../components/ui';

const FOCUS = ['balanced', 'batting', 'pace', 'spin', 'fielding', 'fitness'] as const;

export function TrainingPage() {
  const career = useCareer();
  const tactics = useApi<any>(`/careers/${career.id}/tactics`, [career.tick]);
  const squad = useApi<any>(`/careers/${career.id}/squad`, [career.tick]);
  const [plan, setPlan] = useState<any>(null);
  useEffect(() => {
    if (tactics.data) setPlan(tactics.data.training);
  }, [tactics.data]);
  return (
    <Async state={tactics}>
      {() => plan && (
        <div className="space-y-5">
          <PageHeader title="Training" subtitle="Training shapes development at season end and day-to-day recovery." actions={<button className="btn-primary" onClick={() => career.mutate('/training', plan, { success: 'Training plan saved.' })}>Save plan</button>} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Intensity">
              <div className="grid grid-cols-3 gap-2">
                {(['light', 'normal', 'intense'] as const).map((i) => (
                  <button key={i} className={`btn-ghost ${plan.intensity === i ? 'border-lime text-lime' : ''}`} aria-pressed={plan.intensity === i} onClick={() => setPlan({ ...plan, intensity: i })}>{i}</button>
                ))}
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                {plan.intensity === 'light' && 'Faster recovery between matches, slower development (×0.85).'}
                {plan.intensity === 'normal' && 'Balanced recovery and development.'}
                {plan.intensity === 'intense' && 'Faster development (×1.15) but slower recovery and ~20% higher injury risk.'}
              </p>
            </Card>
            <Card title="Squad focus">
              <div className="grid grid-cols-3 gap-2">
                {FOCUS.map((f) => (
                  <button key={f} className={`btn-ghost ${plan.focus === f ? 'border-lime text-lime' : ''}`} aria-pressed={plan.focus === f} onClick={() => setPlan({ ...plan, focus: f })}>{f}</button>
                ))}
              </div>
              <p className="mt-3 text-sm text-ink-muted">The focus area develops faster; others slightly slower. Coaching staff quality and the training facility multiply all gains.</p>
            </Card>
          </div>
          <Card title="Individual plans" pad={false}>
            <Async state={squad}>
              {(s) => (
                <table className="table">
                  <thead><tr><th>Player</th><th>Role</th><th>Age</th><th>Focus</th></tr></thead>
                  <tbody>
                    {[...s.players, ...s.academy].map((p: any) => (
                      <tr key={p.id}>
                        <td>{p.name}{p.isYouth ? ' (academy)' : ''}</td>
                        <td>{p.role}</td>
                        <td className="num">{p.age}</td>
                        <td>
                          <select aria-label={`Training focus for ${p.name}`} className="input w-auto py-1" value={plan.individual[p.id] ?? ''} onChange={(e) => {
                            const next = { ...plan.individual };
                            if (e.target.value) next[p.id] = e.target.value;
                            else delete next[p.id];
                            setPlan({ ...plan, individual: next });
                          }}>
                            <option value="">Squad focus ({plan.focus})</option>
                            {FOCUS.map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Async>
          </Card>
        </div>
      )}
    </Async>
  );
}
