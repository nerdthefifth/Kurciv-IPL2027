import { useEffect, useState } from 'react';
import type { FieldPoint } from '@kurciv/domain';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, InfoTip, Kbd, Meter, PageHeader, Slider, Tabs } from '../components/ui';
import { FieldEditor } from '../components/FieldEditor';

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
  const fields: any[] = d.fields;
  const [tab, setTab] = useState<'plan' | 'fields'>('plan');
  const [editId, setEditId] = useState<string>(t.fieldTemplateByPhase.powerplay);
  const tpl = fields.find((f) => f.id === editId) ?? fields[0];
  const [positions, setPositions] = useState<FieldPoint[]>(tpl.positions);
  const [keeperUp, setKeeperUp] = useState<boolean>(tpl.keeperUp);
  const [name, setName] = useState('');
  const [hand, setHand] = useState<'R' | 'L'>('R');
  const [pp, setPp] = useState(true);
  useEffect(() => {
    setPositions(tpl.positions);
    setKeeperUp(tpl.keeperUp);
    setName(tpl.builtIn ? `${tpl.name} (custom)` : tpl.name);
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(positions) !== JSON.stringify(tpl.positions) || keeperUp !== tpl.keeperUp;

  const save = async (asNew: boolean) => {
    const r = await career.mutate<any>('/fields', { id: asNew || tpl.builtIn ? undefined : tpl.id, name, positions, keeperUp }, { success: 'Field saved.' });
    if (r?.template) setEditId(r.template.id);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tactics"
        subtitle="Defaults used by you and your assistant. You can change everything live during a match."
        actions={<button className="btn-primary" onClick={() => career.mutate('/tactics', t, { success: 'Tactics saved.' })}>Save tactics</button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plan', label: 'Batting & bowling plans' }, { id: 'fields', label: 'Field editor' }]} />
      {tab === 'plan' && (
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
          <Card title="Fields by phase">
            <div className="space-y-3">
              {(['powerplay', 'middle', 'death'] as const).map((ph) => (
                <div key={ph}>
                  <label className="label" htmlFor={`f-${ph}`}>{ph}</label>
                  <select id={`f-${ph}`} className="input mt-1" value={t.fieldTemplateByPhase[ph]} onChange={(e) => setT({ ...t, fieldTemplateByPhase: { ...t.fieldTemplateByPhase, [ph]: e.target.value } })}>
                    {fields.map((f) => <option key={f.id} value={f.id}>{f.name}{f.builtIn ? '' : ' ★'}</option>)}
                  </select>
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-[#c6ff1a]" checked={t.mirrorForLeftHanders} onChange={(e) => setT({ ...t, mirrorForLeftHanders: e.target.checked })} />
                Mirror fields for left-handers <InfoTip text="If off, a field designed for right-handers stays put for a left-hander — slips become leg-side fielders and the field may become illegal." />
              </label>
            </div>
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
      )}
      {tab === 'fields' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card title={`Editing: ${tpl.name}${dirty ? ' • unsaved' : ''}`}>
            <FieldEditor positions={positions} onChange={setPositions} powerplay={pp} hand={hand} keeperUp={keeperUp} label={`Field editor: ${tpl.name}`} />
            <p className="mt-3 text-xs text-ink-muted">
              Drag fielders, or Tab to a fielder and use <Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>→</Kbd><Kbd>↓</Kbd> (hold <Kbd>Shift</Kbd> for 5 m). Lime dots are outside the 30-yard circle. Positions are physical: a fielder only stops or catches balls they can actually reach.
            </p>
          </Card>
          <div className="space-y-4">
            <Card title="Template">
              <label className="label" htmlFor="tpl">Load</label>
              <select id="tpl" className="input mt-1" value={editId} onChange={(e) => setEditId(e.target.value)}>
                <optgroup label="Built-in">{fields.filter((f) => f.builtIn).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>
                {fields.some((f) => !f.builtIn) && <optgroup label="Your fields">{fields.filter((f) => !f.builtIn).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>}
              </select>
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#c6ff1a]" checked={keeperUp} onChange={(e) => setKeeperUp(e.target.checked)} /> Keeper standing up</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#c6ff1a]" checked={pp} onChange={(e) => setPp(e.target.checked)} /> Check against powerplay rules</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[#c6ff1a]" checked={hand === 'L'} onChange={(e) => setHand(e.target.checked ? 'L' : 'R')} /> Preview for a left-hander</label>
              </div>
              <label className="label mt-4 block" htmlFor="fname">Name</label>
              <input id="fname" className="input mt-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-2">
                {!tpl.builtIn && <button className="btn-primary" disabled={!dirty && name === tpl.name} onClick={() => save(false)}>Save changes</button>}
                <button className={tpl.builtIn ? 'btn-primary' : 'btn-ghost'} onClick={() => save(true)} disabled={!name.trim()}>Save as new</button>
                <button className="btn-ghost" onClick={() => { setPositions(tpl.positions); setKeeperUp(tpl.keeperUp); }} disabled={!dirty}>Reset</button>
                {!tpl.builtIn && <button className="btn-danger" onClick={async () => { if (await career.mutate(`/fields/${tpl.id}`, undefined, { method: 'DELETE', success: 'Field deleted.' })) setEditId(fields[0].id); }}>Delete</button>}
              </div>
            </Card>
            <Card title="How the field works">
              <ul className="space-y-2 text-xs text-ink-muted">
                <li><Badge tone="lime">Ground balls</Badge> Each fielder has a reaction time, speed and reach. A ball is stopped only if someone can get to its path before it passes.</li>
                <li><Badge tone="info">Catches</Badge> Hang time against the distance a fielder must run decides whether there is a chance. Catching skill decides whether it is held.</li>
                <li><Badge tone="warn">Edges</Badge> Slips and gully only matter when the batter edges it. Without them, edges run away to third man.</li>
                <li><Badge tone="danger">Legality</Badge> Illegal fields are never moved for you. Every delivery bowled with one is called a no-ball.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
