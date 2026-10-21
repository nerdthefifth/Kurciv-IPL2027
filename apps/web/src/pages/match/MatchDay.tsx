import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, overs } from '../../lib/api';
import { useCareer } from '../../lib/context';
import { Confirm, Kbd, Segmented } from '../../components/ui';
import { Icon } from '../../components/icons';
import { FieldEditor } from '../../components/FieldEditor';
import { Scorecard, ballChip, nameMap } from '../../components/Scorecard';
import { ClubCrestById } from '../../components/media';
import { MatchCharts, OverAnalysis } from './analysis';
import { ControlCentre, type FieldEditing } from './control';
import { BatterChoice, BowlerChoice, DrsPanel, ReviewChoice, TossOutcome, TossSequence, findPlayer, matchup, phaseOfInn } from './decisions';
import { useMatch, type Speed, type StepMode } from './useMatch';

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}

/** The one-screen matchday: everything essential fits the viewport on desktop; extras open as drawers. */
export function MatchDay({ slot, initial }: { slot: 'match' | 'lab'; initial: any }) {
  const career = useCareer();
  const nav = useNavigate();
  const m = useMatch(slot, initial);
  const { state, deliveries, needs, act, step } = m;
  const names = useMemo(() => nameMap(state), [state]);
  const wide = useMedia('(min-width: 1280px)');
  const inn = state.innings[state.innings.length - 1];
  const user = state.setup.userSide;
  const [drawer, setDrawer] = useState<null | 'scorecard' | 'charts' | 'overs'>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [tossShown, setTossShown] = useState(() => state.innings.length > 0);
  const last = deliveries[deliveries.length - 1];

  // ---- field editing state shared by the ground and the Field tab
  const [draft, setDraft] = useState<{ x: number; y: number }[]>(inn?.field.positions ?? []);
  const [keeperUp, setKeeperUp] = useState<boolean>(inn?.field.keeperUp ?? false);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<{ positions: any[]; keeperUp: boolean; name: string }[]>([]);
  const fieldKey = inn ? JSON.stringify(inn.field.positions) + inn.field.keeperUp + inn.index : '';
  useEffect(() => {
    if (!inn) return;
    setDraft(inn.field.positions);
    setKeeperUp(inn.field.keeperUp);
  }, [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const userBowling = inn && inn.bowlingSide === user;
  const fieldAuto = !!state.autoSettings?.field;
  const fielderNames = useMemo(() => {
    const out: (string | undefined)[] = [];
    for (const f of state.fielders ?? []) out[f.index] = names[f.playerId]?.shortName?.split(' ').slice(-1)[0];
    return out;
  }, [state.fielders, names]);
  const field: FieldEditing = {
    draft, keeperUp, setDraft, setKeeperUp, selected, history, names: fielderNames,
    dirty: !!inn && (JSON.stringify(draft) !== JSON.stringify(inn.field.positions) || keeperUp !== inn.field.keeperUp),
    pushHistory: () => inn && setHistory((h) => [...h.slice(-19), { positions: inn.field.positions, keeperUp: inn.field.keeperUp, name: inn.field.name }]),
    popHistory: () => {
      const prev = history[history.length - 1] ?? null;
      setHistory((h) => h.slice(0, -1));
      return prev;
    },
  };

  // A fresh match has not raised the toss call yet: ask the engine for it.
  useEffect(() => {
    // Before the call, and after the user wins it, the engine has a decision to raise; after a lost call it waits for the user.
    if (state.status === 'toss' && !needs && !m.busy && (state.toss.coin === null || state.toss.winner === user)) void step('toss');
  }, [state.status, needs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="dialog"], [role="slider"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (state.status === 'complete' || needs) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (m.playing) m.pause();
        else m.play();
      } else if (e.key === 'b' || e.key === 'B') step('ball');
      else if (e.key === 'o' || e.key === 'O') step('over');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = async () => {
    if (slot === 'lab') {
      await api(`/careers/${career.id}/lab`, { method: 'DELETE' });
      career.refresh();
      return;
    }
    const r = await career.mutate<any>('/match/finish', {}, { success: 'Result recorded.' });
    if (r?.fixture) nav(`/c/${career.id}/fixtures/${r.fixture.id}`);
  };

  // ---- decisions shown in the control centre (the match stays visible)
  let decision: ReactNode = null;
  if (needs && needs.side === user) {
    if (needs.kind === 'bowler') decision = <BowlerChoice state={state} needs={needs} act={act} />;
    if (needs.kind === 'batter') decision = <BatterChoice state={state} needs={needs} act={act} />;
    if (needs.kind === 'review') decision = <ReviewChoice state={state} needs={needs} act={act} />;
  }
  const tossPending = state.status === 'toss';
  const commentary = <CommentaryList deliveries={deliveries} />;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-66px-3rem)] lg:overflow-hidden">
      {slot === 'lab' && <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-1.5 text-xs text-info">Scenario Lab — an experimental replay. Nothing here changes your career.</div>}
      <TopStrip state={state} last={last} flash={m.flash} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.78fr)]">
        {/* the ground */}
        <section className={`card relative flex min-h-[420px] flex-col overflow-hidden ${m.flash === 'wicket' ? 'flash-wicket' : m.flash ? 'flash-boundary' : ''}`} aria-label="The ground">
          <NextBall state={state} inn={inn} />
          <div className="relative min-h-0 flex-1 px-2">
            {inn ? (
              <FieldEditor
                positions={userBowling && !fieldAuto ? draft : inn.field.positions}
                onChange={userBowling && !fieldAuto ? setDraft : undefined}
                venue={state.setup.venue}
                powerplay={!inn.superOver && Math.floor(inn.legalBalls / 6) < state.setup.rules.powerplayOvers}
                rules={state.setup.rules}
                hand={findPlayer(state, inn.strikerId)?.batHand ?? 'R'}
                mirrorForLeft={inn.mirror}
                keeperUp={userBowling ? keeperUp : inn.field.keeperUp}
                lastBall={last && last.innings === inn.index ? { end: last.end, boundary: last.boundary, wicket: !!last.wicket, aerial: last.aerial } : null}
                names={fielderNames}
                selected={selected}
                onSelect={setSelected}
                svgClassName="h-full w-full"
                className="absolute inset-0 p-1"
                showValidation={false}
                label="Live field"
              />
            ) : <div className="grid h-full place-items-center text-sm text-ink-muted">Players are warming up…</div>}
            {m.drs && <DrsPanel ev={m.drs} state={state} onClose={m.closeDrs} />}
          </div>
          <LastBall last={last} names={names} field={inn && userBowling && field.dirty ? 'Unapplied field changes — apply them in the Field tab.' : null} />
        </section>

        <ControlCentre state={state} act={act} slot={slot} decision={decision} commentary={wide ? null : commentary} field={field} />

        {wide && (
          <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Commentary">
            <div className="border-b border-obsidian-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Commentary</div>
            <div className="min-h-0 flex-1 overflow-y-auto">{commentary}</div>
          </section>
        )}
      </div>

      <ControlStrip m={m} state={state} needs={needs} onEnd={() => setConfirmEnd(true)} onFinish={finish} slot={slot} openDrawer={setDrawer} />

      {tossPending && <TossSequence state={state} needs={needs} act={act} step={(mode: StepMode) => step(mode)} />}
      {!tossPending && !tossShown && state.innings.length > 0 && deliveries.length === 0 && (
        <TossOutcome state={state} onClose={() => setTossShown(true)} />
      )}
      <Confirm open={confirmEnd} title="Simulate the rest of the match?" confirmLabel="Simulate"
        body="Your assistant takes every remaining decision and the engine plays out the match ball by ball, instantly. You can review everything in the match report."
        onClose={() => setConfirmEnd(false)} onConfirm={() => { setConfirmEnd(false); step('end'); }} />
      {drawer && (
        <Drawer title={drawer === 'scorecard' ? 'Scorecard' : drawer === 'charts' ? 'Charts' : 'Over-by-over analysis'} onClose={() => setDrawer(null)}>
          {drawer === 'scorecard' && <Scorecard state={state} />}
          {drawer === 'charts' && <MatchCharts state={state} deliveries={deliveries} />}
          {drawer === 'overs' && <OverAnalysis state={state} names={names} />}
        </Drawer>
      )}
    </div>
  );
}

function TopStrip({ state, last, flash }: { state: any; last: any; flash: string | null }) {
  const inn = state.innings[state.innings.length - 1];
  const first = inn ? state.innings.find((i: any) => i.index === inn.index - 1) : null;
  const wp = last?.winProbHome ?? 0.5;
  const status = state.status === 'complete' ? 'Result' : state.status === 'toss' ? 'Toss' : inn?.superOver ? 'Super over' : inn?.index === 0 ? '1st innings' : '2nd innings';
  const bat = inn ? state.setup[inn.battingSide] : null;
  const need = inn?.target !== null && inn?.target !== undefined ? inn.target - inn.runs : null;
  const left = inn ? inn.maxBalls - inn.legalBalls : 0;
  const crr = inn?.legalBalls ? ((inn.runs / inn.legalBalls) * 6).toFixed(2) : '0.00';
  const rrr = need !== null && left > 0 ? ((need / left) * 6).toFixed(2) : null;
  return (
    <section className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2" aria-live="polite" aria-label="Score">
      <div className="flex items-center gap-2">
        <ClubCrestById clubId={state.setup.home.clubId} size={26} fallback={{ id: state.setup.home.clubId, name: state.setup.home.name, shortName: state.setup.home.shortName, colors: state.setup.home.colors }} />
        <span className="font-display text-lg font-bold uppercase">{state.setup.home.shortName}</span>
        <span className="text-ink-faint">v</span>
        <span className="font-display text-lg font-bold uppercase">{state.setup.away.shortName}</span>
        <ClubCrestById clubId={state.setup.away.clubId} size={26} fallback={{ id: state.setup.away.clubId, name: state.setup.away.name, shortName: state.setup.away.shortName, colors: state.setup.away.colors }} />
      </div>
      <span className="chip">{status}</span>
      {inn && bat && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-ink-muted">{bat.shortName}</span>
            <span className={`num font-display text-3xl font-bold leading-none ${flash === 'four' || flash === 'six' ? 'text-lime' : flash === 'wicket' ? 'text-danger' : ''}`}>{inn.runs}/{inn.wickets}</span>
            <span className="num text-sm text-ink-muted">{overs(inn.legalBalls)} / {inn.maxBalls / 6} ov</span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-ink-muted">
            <span>CRR <b className="num text-ink">{crr}</b></span>
            {need !== null && <span>Target <b className="num text-ink">{inn.target}</b> · need <b className="num text-ink">{Math.max(0, need)}</b> off {left} · RRR <b className="num text-ink">{rrr ?? '—'}</b></span>}
            {first && !inn.superOver && <span>{state.setup[first.battingSide].shortName} {first.runs}/{first.wickets}</span>}
            <span title="Reviews remaining">DRS bat {inn.reviewsLeft.batting} · bowl {inn.reviewsLeft.bowling}</span>
            {inn.freeHit && <span className="font-semibold text-warn">FREE HIT</span>}
          </div>
        </>
      )}
      {state.status === 'complete' && state.result && (
        <span className="font-display text-lg font-bold uppercase text-lime">{state.result.winner ? `${state.setup[state.result.winner].name} ${state.result.margin}` : state.result.margin}</span>
      )}
      <div className="ml-auto flex min-w-[160px] items-center gap-2 text-[11px] text-ink-muted" title="Win probability (engine estimate)">
        <span>{state.setup.home.shortName} {Math.round(wp * 100)}%</span>
        <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-obsidian-700"><span className="bg-lime" style={{ width: `${wp * 100}%` }} /><span className="flex-1 bg-info/70" /></span>
        <span>{Math.round((1 - wp) * 100)}%</span>
      </div>
    </section>
  );
}

/** The tactical set-up for the next ball, as the engine will use it. */
function NextBall({ state, inn }: { state: any; inn: any }) {
  if (!inn || state.status !== 'live') return <div className="h-2" />;
  const bowlerId = inn.currentBowlerId ?? inn.queuedBowlerId;
  const bowler = bowlerId ? findPlayer(state, bowlerId) : null;
  const striker = findPlayer(state, inn.strikerId);
  const plan = inn.planByBatter?.[inn.strikerId] ?? inn.plan;
  const top = (w: Record<string, number>) => Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0];
  const user = state.setup.userSide;
  const team = state.setup[inn.battingSide];
  const phase = phaseOfInn(state, inn);
  const intent = inn.batterIntent[inn.strikerId] ?? inn.intent ?? team.tactics.phaseIntent[phase];
  const aiBat = inn.battingSide !== user || state.autoSettings?.approach;
  const mu = matchup(state, inn, striker, bowler);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-obsidian-700 px-3 py-1.5 text-[11px] text-ink-muted" aria-label="Next delivery set-up">
      <span><b className="text-ink">{bowler ? bowler.shortName : 'Bowler to be chosen'}</b>{bowler ? ` (${bowler.bowlType})` : ''} to <b className="text-ink">{striker?.shortName}</b></span>
      <span>Plan: {top(plan.lengths)} / {top(plan.lines)}{plan.variation >= 0.3 ? ' + variations' : ''}{inn.planByBatter?.[inn.strikerId] ? ' (batter plan)' : ''}</span>
      <span>Intent: {aiBat ? 'set by captain' : `${Math.round(intent * 100)} (${intent < 0.35 ? 'low' : intent < 0.6 ? 'medium' : 'high'} risk)`}</span>
      <span>Field: {inn.field.name}</span>
      {mu && <span className={mu.edge >= 6 ? 'text-warn' : mu.edge <= -6 ? 'text-lime' : ''}>{mu.label}</span>}
    </div>
  );
}

function LastBall({ last, names, field }: { last: any; names: any; field: string | null }) {
  if (!last) return <div className="border-t border-obsidian-700 px-3 py-2 text-xs text-ink-faint">{field ?? 'The umpires are walking out…'}</div>;
  const chip = ballChip(last);
  return (
    <div className="border-t border-obsidian-700 px-3 py-2 text-xs" aria-live="polite">
      <div className="flex items-start gap-2">
        <span className={`num flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded px-1 font-bold ${chip.tone}`}>{chip.text}</span>
        <div className="min-w-0">
          <div className="text-ink">{last.over}.{last.legal ? last.ball : last.ball + 1} · {last.commentary}</div>
          {last.why?.length > 0 && <div className="mt-0.5 text-ink-muted">Why: {last.why.join(' · ')}</div>}
          {field && <div className="mt-0.5 text-warn">{field}</div>}
        </div>
      </div>
      <span className="sr-only">{names[last.strikerId]?.name}</span>
    </div>
  );
}

function CommentaryList({ deliveries }: { deliveries: any[] }) {
  const recent = deliveries.slice(-120).reverse();
  if (!recent.length) return <p className="p-3 text-sm text-ink-muted">No balls bowled yet.</p>;
  return (
    <ol className="divide-y divide-obsidian-800 text-xs">
      {recent.map((d) => {
        const chip = ballChip(d);
        return (
          <li key={d.seq} className={`flex gap-2 px-3 py-2 ${d.wicket ? 'bg-danger/5' : d.boundary === 6 ? 'bg-lime/5' : ''}`}>
            <span className="num w-8 shrink-0 text-ink-muted">{d.over}.{d.legal ? d.ball : d.ball + 1}</span>
            <span className={`num flex h-5 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1 font-bold ${chip.tone}`} aria-hidden>{chip.text}</span>
            <span className="min-w-0">
              {d.commentary}
              {d.review && <span className="block text-info">DRS ({d.review.kind ?? 'lbw'}): {d.review.overturned ? 'overturned' : d.review.umpiresCall ? "umpire's call" : 'stands'}{d.review.decisive ? ` — ${d.review.decisive}` : ''}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const SPEEDS: { id: Speed; label: string }[] = [{ id: 'slow', label: 'Slow' }, { id: 'normal', label: 'Normal' }, { id: 'fast', label: 'Fast' }, { id: 'turbo', label: 'Turbo' }];

function ControlStrip({ m, state, needs, onEnd, onFinish, slot, openDrawer }: { m: ReturnType<typeof useMatch>; state: any; needs: any; onEnd: () => void; onFinish: () => void; slot: string; openDrawer: (d: 'scorecard' | 'charts' | 'overs') => void }) {
  const done = state.status === 'complete';
  const blocked = !!needs || done || state.status === 'toss';
  return (
    <section className="card flex flex-wrap items-center gap-2 px-3 py-2 xl:flex-nowrap" aria-label="Match controls">
      {done ? (
        <button className="btn-primary" onClick={onFinish}>{slot === 'lab' ? 'Close the lab' : 'Confirm result & open the match report'}</button>
      ) : (
        <>
          <button className="btn-primary min-w-[96px]" disabled={blocked && !m.playing} onClick={() => (m.playing ? m.pause() : m.play())} aria-pressed={m.playing}>
            <Icon name={m.playing ? 'pause' : 'play'} size={16} /> {m.playing ? 'Pause' : 'Play'} <span className="hidden 2xl:inline"><Kbd>Space</Kbd></span>
          </button>
          <Segmented label="Playback speed" value={m.speed} onChange={m.setSpeed} options={SPEEDS} />
          <span className="mx-1 hidden h-6 w-px bg-obsidian-700 sm:block" aria-hidden />
          <button className="btn-ghost whitespace-nowrap" disabled={blocked || m.busy} onClick={() => m.step('ball')} title="Exactly one delivery">Next ball <span className="hidden 2xl:inline"><Kbd>B</Kbd></span></button>
          <button className="btn-ghost whitespace-nowrap" disabled={blocked || m.busy} onClick={() => m.step('over')} title="Play to the end of the current over">Finish over <span className="hidden 2xl:inline"><Kbd>O</Kbd></span></button>
          <button className="btn-ghost whitespace-nowrap" disabled={blocked || m.busy} onClick={() => m.step('next-over')} title="Finish this over and play one more">Next over</button>
          <button className="btn-quiet whitespace-nowrap" disabled={blocked || m.busy} onClick={() => m.step('innings')} title="Your assistant plays out this innings instantly">Sim innings</button>
          <button className="btn-quiet whitespace-nowrap" disabled={blocked || m.busy} onClick={onEnd} title="Your assistant plays out the match instantly">Sim match</button>
          {needs && !done && <span className="text-xs text-warn">Decision needed →</span>}
          {m.busy && !m.playing && <span className="text-xs text-ink-muted">Bowling…</span>}
        </>
      )}
      <span className="flex-1" />
      <span className="flex shrink-0 gap-1">
        {([['scorecard', 'Scorecard', 'book'], ['charts', 'Charts', 'league'], ['overs', 'Overs', 'history']] as const).map(([id, label, icon]) => (
          <button key={id} className="btn-quiet px-2 text-xs" onClick={() => openDrawer(id)} aria-label={label} title={label}>
            <Icon name={icon} size={16} /><span className="hidden 2xl:inline">{label}</span>
          </button>
        ))}
      </span>
    </section>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside className="rise fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-obsidian-700 bg-obsidian-900 shadow-lift" role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-obsidian-700 px-4 py-3">
          <h2 className="h-section">{title}</h2>
          <button className="btn-quiet px-2" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>
  );
}
