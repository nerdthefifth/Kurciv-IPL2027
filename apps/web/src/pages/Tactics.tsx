import { useEffect, useState } from 'react';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Card, Meter, PageHeader, Slider } from '../components/ui';

const LENGTHS = ['yorker', 'full', 'good', 'back', 'short'] as const;
const LINES = ['wide', 'off', 'stumps', 'leg'] as const;

export function TacticsPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/tactics`, [career.tick]);
  return <Async state={state}>{(d) => <TacticsView d={d} />}</Async>;
}

export function PlanEditor({ plan, onChange }: { plan: any; onChange: (p: any) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <div className="label">Length mix</div>
        {LENGTHS.map((l) => (
          <Slider key={l} label={l} min={0} max={10} step={1} value={plan.lengths[l] ?? 0} format={(v) => String(v)} onChange={(v) => onChange({ ...plan, lengths: { ...plan.lengths, [l]: v } })} />
        ))}
      </div>
      <div className="space-y-2">
        <div className="label">Line mix</div>
        {LINES.map((l) => (
          <Slider key={l} label={l} min={0} max={10} step={1} value={plan.lines[l] ?? 0} format={(v) => String(v)} onChange={(v) => onChange({ ...plan, lines: { ...plan.lines, [l]: v } })} />
        ))}
        <Slider label="Variations" value={plan.variation} onChange={(v) => onChange({ ...plan, variation: v })} format={(v) => `${Math.round(v * 100)}%`} left="stock balls" right="mix it up" />
        <div>
          <div className="label mb-1">Pace</div>
          <div className="flex gap-1">
            {(['slower', 'normal', 'quicker'] as const).map((p) => (
              <button key={p} className={`btn-ghost flex-1 py-1 text-xs ${plan.pace === p ? 'border-lime text-lime' : ''}`} aria-pressed={plan.pace === p} onClick={() => onChange({ ...plan, pace: p })}>{p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TacticsView({ d }: { d: any }) {
  const career = useCareer();
  const [t, setT] = useState(d.tactics);
  useEffect(() => setT(d.tactics), [d.tactics]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tactics"
        subtitle="Defaults used by you and your assistant. You can change everything live during a match."
        actions={<button className="btn-primary" onClick={() => career.mutate('/tactics', t, { success: 'Tactics saved.' })}>Save tactics</button>}
      />
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="Batting intent">
            <div className="space-y-4">
              {(['powerplay', 'middle', 'death'] as const).map((ph) => (
                <Slider key={ph} label={`${ph} overs`} value={t.phaseIntent[ph]} onChange={(v) => setT({ ...t, phaseIntent: { ...t.phaseIntent, [ph]: v } })} format={(v) => `${Math.round(v * 100)}`} left="Rotate & protect" right="All-out attack" />
              ))}
              <p className="text-xs text-ink-muted">Higher intent means more lofted and risky shots: more boundaries, and more wickets. The assistant adjusts for the chase when you simulate.</p>
            </div>
          </Card>
          <Card title="Default bowling plan" className="xl:col-span-2">
            <PlanEditor plan={t.bowlingPlan} onChange={(p) => setT({ ...t, bowlingPlan: p })} />
            <p className="mt-3 text-xs text-ink-muted">Used in the powerplay and middle overs; at the death the assistant switches to a yorker-led plan unless you set one live.</p>
          </Card>
          <Card title="Reviews (DRS)">
            <div className="flex gap-1">
              {(['conservative', 'balanced', 'aggressive'] as const).map((p) => (
                <button key={p} className={`btn-ghost flex-1 text-xs ${t.reviewPolicy === p ? 'border-lime text-lime' : ''}`} aria-pressed={t.reviewPolicy === p} onClick={() => setT({ ...t, reviewPolicy: p })}>{p}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">How readily your assistant reviews LBW decisions when you are not making the call yourself.</p>
          </Card>
          <Card title="Tactical DNA">
            <div className="space-y-2">
              <Meter label="Batting aggression" value={d.dna.aggression} />
              <Meter label="Spin reliance" value={d.dna.spinReliance} />
              <Meter label="Pace reliance" value={d.dna.paceReliance} />
            </div>
            <p className="mt-2 text-xs text-ink-muted">Learned from {d.dna.samples} of your matches. Rival analysts scout this identity and try to counter it.</p>
          </Card>
        </div>
    </div>
  );
}
