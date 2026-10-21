import { useEffect, useState } from 'react';
import { api, overs } from '../../lib/api';
import { useCareer, useToast } from '../../lib/context';
import { Badge, Segmented, Slider, Tabs } from '../../components/ui';
import { Toggle } from '../Home';
import { PlanEditor } from '../Tactics';
import { findPlayer, matchup, phaseOfInn } from './decisions';

type Act = (a: any, s?: string) => Promise<boolean>;

export const APPROACHES = [
  { id: 'defensive', label: 'Defensive', v: 0.2 },
  { id: 'balanced', label: 'Balanced', v: 0.4 },
  { id: 'positive', label: 'Positive', v: 0.55 },
  { id: 'aggressive', label: 'Aggressive', v: 0.7 },
  { id: 'all-out', label: 'All-out', v: 0.9 },
];
const nearest = (v: number) => APPROACHES.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));
const risk = (v: number) => (v < 0.35 ? 'Low' : v < 0.6 ? 'Medium' : v < 0.8 ? 'High' : 'Very high');

const AUTO_LABELS: { id: string; label: string; hint: string }[] = [
  { id: 'bowler', label: 'Bowler selection', hint: 'The assistant picks the bowler for each over.' },
  { id: 'batter', label: 'Incoming batter', hint: 'Follow the batting order at each wicket. Off: you choose at every wicket.' },
  { id: 'field', label: 'Field setting', hint: 'The assistant sets the field every over.' },
  { id: 'approach', label: 'Batting approach', hint: 'The assistant sets batting intent ball by ball.' },
  { id: 'plan', label: 'Bowling plan', hint: 'The assistant sets lines, lengths and variations.' },
  { id: 'reviews', label: 'Reviews', hint: 'The assistant decides whether to review.' },
];

export function ByChip({ ai }: { ai: boolean }) {
  return <Badge tone={ai ? 'info' : 'lime'} title={ai ? 'Controlled by your assistant' : 'Controlled by you'}>{ai ? 'AI' : 'You'}</Badge>;
}

export function ControlCentre(props: {
  state: any; act: Act; slot: 'match' | 'lab'; decision: React.ReactNode | null; commentary: React.ReactNode | null;
  field: FieldEditing;
}) {
  const { state, act, decision, commentary, field } = props;
  const inn = state.innings[state.innings.length - 1];
  const user = state.setup.userSide;
  const batting = inn && inn.battingSide === user;
  const bowling = inn && inn.bowlingSide === user;
  type T = 'approach' | 'batters' | 'order' | 'bowlers' | 'plan' | 'field' | 'auto' | 'commentary';
  const tabs: { id: T; label: string }[] = [
    ...(batting ? [{ id: 'approach' as T, label: 'Approach' }, { id: 'batters' as T, label: 'Batters' }, { id: 'order' as T, label: 'Order' }] : []),
    ...(bowling ? [{ id: 'bowlers' as T, label: 'Bowlers' }, { id: 'plan' as T, label: 'Plan' }, { id: 'field' as T, label: 'Field' }] : []),
    { id: 'auto', label: 'Auto' },
    ...(commentary ? [{ id: 'commentary' as T, label: 'Commentary' }] : []),
  ];
  const [tab, setTab] = useState<T>(tabs[0].id);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [batting, bowling]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = state.autoSettings ?? {};
  return (
    <section className="card relative flex min-h-0 flex-col overflow-hidden" aria-label="Tactical control centre">
      <div className="flex items-center justify-between gap-2 border-b border-obsidian-700 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Tactics · {!inn ? 'pre-match' : batting ? 'batting' : bowling ? 'bowling' : 'watching'}</div>
      </div>
      <div className="strip overflow-x-auto px-2 pt-2">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {decision && <div className="rise mb-3 rounded-xl border border-lime/40 bg-lime/[0.03] p-2.5">{decision}</div>}
        {(
          <>
            {tab === 'approach' && inn && <ApproachTab state={state} inn={inn} act={act} ai={!!auto.approach} />}
            {tab === 'batters' && inn && <BattersTab state={state} inn={inn} act={act} />}
            {tab === 'order' && inn && <OrderTab state={state} inn={inn} act={act} />}
            {tab === 'bowlers' && inn && <BowlersTab state={state} inn={inn} act={act} ai={!!auto.bowler} />}
            {tab === 'plan' && inn && <PlanTab state={state} inn={inn} act={act} ai={!!auto.plan} />}
            {tab === 'field' && inn && <FieldTab state={state} inn={inn} act={act} ai={!!auto.field} field={field} slot={props.slot} />}
            {tab === 'auto' && <AutoTab state={state} act={act} />}
            {tab === 'commentary' && commentary}
            {!inn && tab !== 'auto' && tab !== 'commentary' && <p className="text-sm text-ink-muted">Tactics open once the toss is done.</p>}
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ batting

function ApproachTab({ state, inn, act, ai }: { state: any; inn: any; act: Act; ai: boolean }) {
  const team = state.setup[inn.battingSide];
  const phase = phaseOfInn(state, inn);
  const current = inn.intent ?? team.tactics.phaseIntent[phase];
  const running = state.running?.[inn.battingSide] ?? 'balanced';
  const need = inn.target !== null ? inn.target - inn.runs : null;
  const ballsLeft = inn.maxBalls - inn.legalBalls;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1.5 flex items-center justify-between"><span className="label">Team approach</span><ByChip ai={ai} /></div>
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Team batting approach">
          {APPROACHES.map((a) => {
            const on = inn.intent !== null && nearest(inn.intent).id === a.id;
            return (
              <button key={a.id} role="radio" aria-checked={on} disabled={ai} onClick={() => act({ type: 'intent', value: a.v }, `Approach: ${a.label}.`)}
                className={`rounded-lg border px-1 py-2 text-xs font-semibold ${on ? 'border-lime bg-lime/10 text-lime' : 'border-obsidian-700 hover:border-obsidian-500'} disabled:opacity-50`}>{a.label}</button>
            );
          })}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-muted">
          <span>{inn.intent === null ? `Following the ${phase} default (${nearest(current).label})` : `Set to ${nearest(current).label}`} · risk {risk(current)}</span>
          {inn.intent !== null && !ai && <button className="text-lime hover:underline" onClick={() => act({ type: 'intent', value: null })}>Use phase plan</button>}
        </div>
        {need !== null && ballsLeft > 0 && <p className="mt-1 text-xs text-ink-faint">Required {((need / ballsLeft) * 6).toFixed(2)} an over with {inn.maxWickets - inn.wickets} wickets in hand.</p>}
      </div>
      <div>
        <div className="label mb-1.5">Phase plan</div>
        {(['powerplay', 'middle', 'death'] as const).map((ph) => (
          <PhaseRow key={ph} label={ph} value={team.tactics.phaseIntent[ph]} active={ph === phase} disabled={ai} onCommit={(v) => act({ type: 'phase-intent', phase: ph, value: v })} />
        ))}
      </div>
      <div>
        <div className="label mb-1.5">Running between the wickets</div>
        <Segmented label="Running style" value={running} onChange={(v) => act({ type: 'running', value: v }, `Running: ${v}.`)} options={[{ id: 'conservative', label: 'Conservative' }, { id: 'balanced', label: 'Balanced' }, { id: 'aggressive', label: 'Aggressive' }]} />
        <p className="mt-1 text-xs text-ink-faint">Aggressive running takes more twos and risks more run-outs.</p>
      </div>
    </div>
  );
}

function PhaseRow({ label, value, active, disabled, onCommit }: { label: string; value: number; active: boolean; disabled: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className={`flex items-center gap-2 py-1 ${active ? '' : 'opacity-80'}`}>
      <span className={`w-20 text-xs capitalize ${active ? 'font-semibold text-lime' : 'text-ink-muted'}`}>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={v} disabled={disabled} aria-label={`${label} intent`} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => v !== value && onCommit(v)} onKeyUp={() => v !== value && onCommit(v)} className="flex-1 accent-lime" />
      <span className="w-20 text-right text-xs">{nearest(v).label}</span>
    </div>
  );
}

function BatterCard({ state, inn, id, on, act }: { state: any; inn: any; id: string; on: boolean; act: Act }) {
  const p = findPlayer(state, id);
  const b = inn.batters[id];
  const bowlerId = inn.currentBowlerId ?? inn.queuedBowlerId ?? inn.lastOverBowlerId;
  const bowler = bowlerId ? findPlayer(state, bowlerId) : null;
  const m = matchup(state, inn, p, bowler);
  const set = inn.batterIntent[id];
  const plan = inn.batterPlans?.[id] ?? {};
  const strengths = [p.attrs.bat.vsPace >= 75 && 'v pace', p.attrs.bat.vsSpin >= 75 && 'v spin', p.attrs.bat.power >= 78 && 'power', p.attrs.bat.rotation >= 75 && 'rotates strike', p.attrs.bat.death >= 75 && 'death overs'].filter(Boolean);
  const weaknesses = [p.attrs.bat.vsPace < 55 && 'v pace', p.attrs.bat.vsSpin < 55 && 'v spin', p.attrs.bat.power < 45 && 'limited power', p.attrs.bat.rotation < 50 && 'gets stuck'].filter(Boolean);
  return (
    <div className={`rounded-xl border p-3 ${on ? 'border-lime/50' : 'border-obsidian-700'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">{p.name}{on ? ' *' : ''}</span>
        <span className="num text-sm">{b?.runs ?? 0} ({b?.balls ?? 0})</span>
      </div>
      <div className="mt-0.5 text-[11px] text-ink-muted">form {p.form > 0 ? '+' : ''}{p.form} · stamina {Math.round(100 - p.fatigue)} · confidence {Math.round(p.morale)}{m ? ` · ${m.label}` : ''}</div>
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="mt-1 text-[11px]"><span className="text-lime">{strengths.join(', ')}</span>{strengths.length && weaknesses.length ? ' · ' : ''}<span className="text-warn">{weaknesses.join(', ')}</span></div>
      )}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {[['Preserve', 0.2], ['Rotate', 0.38], ['Attack', 0.7], ['Slog', 0.92]].map(([l, v]) => (
          <button key={l as string} onClick={() => act({ type: 'intent', value: v, batterId: id }, `${p.shortName}: ${l}.`)}
            className={`rounded-md border px-1 py-1 text-[11px] ${set === v ? 'border-lime text-lime' : 'border-obsidian-700 hover:border-obsidian-500'}`}>{l}</button>
        ))}
      </div>
      {set !== undefined && <button className="mt-1 text-[11px] text-ink-faint hover:text-ink" onClick={() => act({ type: 'intent', value: null, batterId: id })}>Clear individual role</button>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['vsPace', 'vsSpin'] as const).map((k) => (
          <label key={k} className="text-[11px] text-ink-muted">
            {k === 'vsPace' ? 'Against pace' : 'Against spin'}
            <select className="input mt-0.5 w-full py-1 text-xs" value={plan[k] ?? 0} onChange={(e) => {
              const v = Number(e.target.value);
              act({ type: 'batter-plan', batterId: id, vsPace: k === 'vsPace' ? (v === 0 ? null : v) : plan.vsPace ?? null, vsSpin: k === 'vsSpin' ? (v === 0 ? null : v) : plan.vsSpin ?? null });
            }}>
              <option value={-0.2}>See it off</option><option value={0}>As planned</option><option value={0.15}>Take on</option><option value={0.3}>Target</option>
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function BattersTab({ state, inn, act }: { state: any; inn: any; act: Act }) {
  const next = inn.order.find((id: string) => !inn.batters[id]);
  return (
    <div className="space-y-2">
      <BatterCard state={state} inn={inn} id={inn.strikerId} on act={act} />
      <BatterCard state={state} inn={inn} id={inn.nonStrikerId} on={false} act={act} />
      {next && <p className="text-xs text-ink-muted">Next in: <b className="text-ink">{findPlayer(state, next).name}</b>{state.autoSettings?.batter === false ? ' (you will be asked at the wicket)' : ''}</p>}
    </div>
  );
}

function OrderTab({ state, inn, act }: { state: any; inn: any; act: Act }) {
  const remaining = inn.order.filter((id: string) => !inn.batters[id]);
  const [order, setOrder] = useState<string[]>(remaining);
  useEffect(() => setOrder(remaining), [remaining.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const n = [...o];
    const j = i + d;
    if (j < 0 || j >= n.length) return n;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  if (!remaining.length) return <p className="text-sm text-ink-muted">Everyone has batted.</p>;
  return (
    <div className="space-y-2 text-sm">
      <div className="label">Yet to bat</div>
      <ol className="space-y-1">
        {order.map((id, i) => {
          const p = findPlayer(state, id);
          return (
            <li key={id} className="flex items-center gap-2 rounded-lg border border-obsidian-700 px-2 py-1">
              <span className="num w-5 text-ink-faint">{inn.order.length - order.length + i + 1}</span>
              <span className="flex-1 truncate">{p.name} <span className="text-[11px] text-ink-faint">{p.role}{p.tags.includes('power') ? ' · pinch-hitter' : ''}</span></span>
              <button className="btn-quiet px-1.5 py-0 text-xs" aria-label={`Promote ${p.name}`} onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
              <button className="btn-quiet px-1.5 py-0 text-xs" aria-label={`Demote ${p.name}`} onClick={() => move(i, 1)} disabled={i === order.length - 1}>▼</button>
            </li>
          );
        })}
      </ol>
      <button className="btn-primary w-full py-1.5 text-sm" disabled={order.join() === remaining.join()} onClick={() => act({ type: 'order', order }, 'Batting order updated.')}>Confirm order</button>
      <p className="text-xs text-ink-faint">Turn off “Incoming batter” in Auto to choose at every wicket instead.</p>
    </div>
  );
}

// ------------------------------------------------------------------ bowling

function BowlersTab({ state, inn, act, ai }: { state: any; inn: any; act: Act; ai: boolean }) {
  const side = inn.bowlingSide;
  const xi = state.setup[side].xi.filter((p: any) => p.bowlType !== 'NONE' && p.id !== state.setup[side].keeperId);
  const quota = state.setup.rules.maxBowlerOvers * 6;
  const striker = findPlayer(state, inn.strikerId);
  const presets = state.fieldByBowler?.[side] ?? {};
  const fields = state.setup[side].fields;
  const remainingOvers = Math.ceil((inn.maxBalls - inn.legalBalls) / 6);
  const capacity = xi.reduce((a: number, p: any) => a + Math.max(0, quota - (inn.bowlers[p.id]?.balls ?? 0)) / 6, 0);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between"><span className="label">Next over</span><ByChip ai={ai} /></div>
      {capacity < remainingOvers && <p className="text-xs text-danger">Not enough overs left in your bowlers’ quotas to finish the innings.</p>}
      <ul className="space-y-1">
        {xi.map((p: any) => {
          const b = inn.bowlers[p.id];
          const left = Math.max(0, (quota - (b?.balls ?? 0)) / 6);
          const blocked = left === 0 ? 'Quota used' : p.id === inn.currentBowlerId && inn.legalBalls % 6 !== 0 ? 'Bowling now' : p.id === (inn.currentBowlerId ?? inn.lastOverBowlerId) ? 'No consecutive overs' : null;
          const m = matchup(state, inn, striker, p);
          const tired = (b?.spellFatigue ?? 0) > 10;
          const econ = b?.balls ? ((b.runs / b.balls) * 6).toFixed(1) : '—';
          return (
            <li key={p.id} className={`rounded-lg border px-2 py-1.5 ${inn.queuedBowlerId === p.id ? 'border-lime/60' : 'border-obsidian-700'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{p.shortName} <span className="text-[11px] text-ink-faint">{p.bowlType}</span></span>
                <span className="flex items-center gap-1">
                  {inn.currentBowlerId === p.id && <Badge tone="lime">Bowling</Badge>}
                  {inn.queuedBowlerId === p.id && <Badge tone="info">Next</Badge>}
                  {tired && <Badge tone="warn">Tiring</Badge>}
                  <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={ai || !!blocked} title={blocked ?? 'Bowl the next over'} onClick={() => act({ type: 'bowler', playerId: p.id }, `${p.shortName} bowls next.`)}>Next</button>
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-[11px] text-ink-muted">
                <span className="num">{b ? `${overs(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}` : 'yet to bowl'} · econ {econ} · {left} left · ctl {Math.round(p.attrs.bowl.control)}</span>
                <span>{blocked ?? (m ? m.label : '')}</span>
              </div>
              <label className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                Field for {p.shortName}:
                <select className="input py-0.5 text-[11px]" value={presets[p.id] ?? ''} onChange={(e) => act({ type: 'bowler-field', bowlerId: p.id, templateId: e.target.value || null }, 'Bowler field preset saved.')}>
                  <option value="">Phase default</option>
                  {fields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-faint">Max {state.setup.rules.maxBowlerOvers} overs each; no bowler may bowl consecutive overs.</p>
    </div>
  );
}

function PlanTab({ state, inn, act, ai }: { state: any; inn: any; act: Act; ai: boolean }) {
  const striker = findPlayer(state, inn.strikerId);
  const forStriker = inn.planByBatter?.[inn.strikerId];
  const [plan, setPlan] = useState(forStriker ?? inn.plan);
  useEffect(() => setPlan(forStriker ?? inn.plan), [inn.strikerId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between"><span className="label">Bowling plan {forStriker ? `· vs ${striker.shortName}` : ''}</span><ByChip ai={ai} /></div>
      <PlanEditor plan={plan} onChange={setPlan} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary py-1.5 text-xs" disabled={ai} onClick={() => act({ type: 'plan', plan }, 'Bowling plan applied.')}>Apply to all batters</button>
        <button className="btn-ghost py-1.5 text-xs" disabled={ai} onClick={() => act({ type: 'plan', plan, batterId: inn.strikerId }, `Plan set for ${striker.shortName}.`)}>Use only against {striker.shortName}</button>
      </div>
      <p className="text-xs text-ink-faint">Plans take effect from the next ball. Yorkers and variations depend on each bowler’s skills; tired bowlers execute less often.</p>
    </div>
  );
}

export interface FieldEditing {
  draft: { x: number; y: number }[];
  keeperUp: boolean;
  setDraft: (p: { x: number; y: number }[]) => void;
  setKeeperUp: (v: boolean) => void;
  dirty: boolean;
  selected: number | null;
  history: { positions: { x: number; y: number }[]; keeperUp: boolean; name: string }[];
  pushHistory: () => void;
  popHistory: () => { positions: { x: number; y: number }[]; keeperUp: boolean; name: string } | null;
  names: (string | undefined)[];
}

function FieldTab({ state, inn, act, ai, field, slot }: { state: any; inn: any; act: Act; ai: boolean; field: FieldEditing; slot: string }) {
  const career = useCareer();
  const toast = useToast();
  const fields = state.setup[inn.bowlingSide].fields;
  const [name, setName] = useState('');
  const sel = field.selected !== null ? state.fielders?.find((f: any) => f.index === field.selected) : null;
  const sp = sel ? findPlayer(state, sel.playerId) : null;
  const apply = async (positions: any, keeperUp: boolean, label: string) => {
    field.pushHistory();
    await act({ type: 'field', positions, keeperUp, name: label }, `Field: ${label}.`);
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between"><span className="label">Field · {inn.field.name}</span><ByChip ai={ai} /></div>
      {ai && <p className="text-xs text-info">The assistant sets the field each over. Turn off “Field setting” in Auto to place it yourself.</p>}
      <label className="block">
        <span className="text-xs text-ink-muted">Preset</span>
        <select className="input mt-0.5 w-full" disabled={ai} value="" onChange={(e) => {
          const t = fields.find((x: any) => x.id === e.target.value);
          if (t) apply(t.positions, t.keeperUp, t.name);
        }}>
          <option value="">Choose a preset…</option>
          {fields.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.situation ? ` · ${t.situation}` : ''}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-lime" disabled={ai} checked={field.keeperUp} onChange={(e) => field.setKeeperUp(e.target.checked)} /> Keeper up</label>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-lime" disabled={ai} checked={inn.mirror} onChange={(e) => act({ type: 'mirror', value: e.target.checked })} /> Mirror for left-handers</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary py-1.5 text-xs" disabled={ai || !field.dirty} onClick={() => apply(field.draft, field.keeperUp, 'Custom field')}>Apply dragged field</button>
        <button className="btn-ghost py-1.5 text-xs" disabled={!field.dirty} onClick={() => { field.setDraft(inn.field.positions); field.setKeeperUp(inn.field.keeperUp); }}>Discard changes</button>
        <button className="btn-ghost py-1.5 text-xs" disabled={ai || !field.history.length} onClick={async () => {
          const prev = field.popHistory();
          if (prev) await act({ type: 'field', positions: prev.positions, keeperUp: prev.keeperUp, name: prev.name }, 'Previous field restored.');
        }}>Undo last change</button>
      </div>
      <div className="flex gap-2">
        <input className="input flex-1 py-1 text-xs" placeholder="Name this field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Preset name" />
        <button className="btn-ghost py-1 text-xs" disabled={ai || !name.trim()} onClick={async () => {
          if (await act({ type: 'save-field', name: name.trim() }, `Saved “${name.trim()}”.`)) {
            if (slot === 'match') {
              api(`/careers/${career.id}/fields`, { body: { name: name.trim(), positions: inn.field.positions, keeperUp: inn.field.keeperUp } }).catch((e) => toast.push('error', (e as Error).message));
            }
            setName('');
          }
        }}>Save preset</button>
      </div>
      <div className="rounded-lg border border-obsidian-700 p-2">
        <div className="label mb-1">Fielder</div>
        {sp ? (
          <div className="text-xs">
            <div className="font-semibold">{sp.name}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-muted">
              <span>Catching <b className="num text-ink">{Math.round(sp.attrs.field.catching)}</b></span>
              <span>Ground fielding <b className="num text-ink">{Math.round(sp.attrs.field.ground)}</b></span>
              <span>Arm (throwing) <b className="num text-ink">{Math.round(sp.attrs.field.throwing)}</b></span>
              <span>Agility <b className="num text-ink">{Math.round(sp.attrs.field.athleticism)}</b></span>
            </div>
            <p className="mt-1 text-ink-faint">The engine places your best catchers close in, best ground fielders in the ring and strongest arms on the boundary.</p>
          </div>
        ) : <p className="text-xs text-ink-muted">Select a fielder on the ground to inspect them. Drag to move (when you set the field).</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ automation

function AutoTab({ state, act }: { state: any; act: Act }) {
  const auto = state.autoSettings;
  if (!auto) return <p className="text-sm text-ink-muted">You are watching this match.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">Choose what your assistant handles. Automation never overrides something you set by hand.</p>
      {AUTO_LABELS.map((a) => (
        <Toggle key={a.id} label={`${a.label}: ${auto[a.id] ? 'AI' : 'you'}`} hint={a.hint} value={!!auto[a.id]} onChange={(v) => act({ type: 'auto', settings: { [a.id]: v } })} />
      ))}
    </div>
  );
}
