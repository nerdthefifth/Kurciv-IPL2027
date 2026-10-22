import { Suspense, createContext, lazy, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { battingRating, bowlingRating } from '@kurciv/domain';
import { api, overs } from '../../lib/api';
import { useCareer } from '../../lib/context';
import { Icon } from '../../components/icons';
import { ClubCrestById, PlayerPortrait } from '../../components/media';
import { ballChip } from '../../components/Scorecard';
import { useMatch, type Presenter, type Speed } from './useMatch';
import { CapIcon } from '../Table';

/** Current Orange/Purple Cap holders in this match's competition. */
const CapsContext = createContext<{ orange: string | null; purple: string | null } | null>(null);

/** Captain marker and cap icons after a player's name. */
function Marks({ state, id }: { state: any; id: string }) {
  const caps = useContext(CapsContext);
  const captain = state.setup.home.captainId === id || state.setup.away.captainId === id;
  return (
    <>
      {captain && <span className="ml-1 text-[0.8em] opacity-80" title="Captain">(c)</span>}
      {caps?.orange === id && <span className="ml-1 inline-flex align-middle" title="Orange Cap holder"><CapIcon kind="orange" /></span>}
      {caps?.purple === id && <span className="ml-1 inline-flex align-middle" title="Purple Cap holder"><CapIcon kind="purple" /></span>}
    </>
  );
}
import type { View3DSettings } from './three/Match3D';

const Match3D = lazy(() => import('./three/Match3D'));

const VIEW_KEY = 'kurciv.match3d.v1';
function load3D(): View3DSettings & { enabled: boolean } {
  const d: View3DSettings & { enabled: boolean } = { enabled: true, quality: 'medium', camera: 'broadcast', auto: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') };
  } catch {
    return d;
  }
}

/*
 * The matchday screen, laid out after IPL-Edge (github.com/yashksaini/IPL-Edge): a toss screen,
 * "select player" sheets for openers, bowlers and incoming batters, a live board with a HIT
 * button and an over strip, and a full scorecard. The engine underneath is Kurciv's own.
 */

type Act = (a: any, s?: string) => Promise<boolean>;
type Side = 'home' | 'away';

const C = {
  page: 'bg-[#111111]',
  panel: 'bg-[#201f2e]',
  sheet: 'bg-[#151515]',
  line: 'border-[#3a3a44]',
  accent: 'bg-[#5b5bf6]',
  accentDeep: 'bg-[#3d3ddf]',
};

const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const findPlayer = (state: any, id: string) => state.setup.home.xi.find((p: any) => p.id === id) ?? state.setup.away.xi.find((p: any) => p.id === id);
const batPower = (p: any) => Math.round(battingRating(p.attrs));
const bowlPower = (p: any) => (p.bowlType === 'NONE' ? 0 : Math.round(bowlingRating(p.attrs, p.bowlType)));
const sr = (runs: number, balls: number) => (balls ? Math.round((runs / balls) * 100) : 0);
const eco = (runs: number, balls: number) => (balls ? ((runs / balls) * 6).toFixed(1) : '0');

function Crest({ state, side, size = 40 }: { state: any; side: Side; size?: number }) {
  const t = state.setup[side];
  return <ClubCrestById clubId={t.clubId} size={size} fallback={{ id: t.clubId, name: t.name, shortName: t.shortName, colors: t.colors }} />;
}

function Circle({ size, children, className = '' }: { size: number; children: ReactNode; className?: string }) {
  return <span className={`grid shrink-0 place-items-center rounded-full ${C.panel} ${className}`} style={{ width: size, height: size }}>{children}</span>;
}

function Portrait({ p, size = 30 }: { p: any; size?: number }) {
  return <PlayerPortrait player={{ id: p.id, name: p.name, source: p.source }} size={size} className="rounded-full" />;
}

export function MatchDay({ slot, initial }: { slot: 'match' | 'lab'; initial: any }) {
  const career = useCareer();
  const nav = useNavigate();
  const presenter = useRef<Presenter | null>(null);
  const m = useMatch(slot, initial, presenter);
  const { state, deliveries, needs, act, step } = m;
  const user: Side | null = state.setup.userSide;
  const inn = state.innings[state.innings.length - 1] ?? null;
  const [view, setView] = useState<'live' | 'scorecard' | 'commentary'>('live');
  const [v3d, setV3d] = useState(load3D);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const save3D = (next: typeof v3d) => {
    setV3d(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // not persisted
    }
  };
  const show3D = v3d.enabled && !unsupported && view === 'live' && state.status !== 'toss';
  const [openersDone, setOpenersDone] = useState<Record<number, boolean>>({});

  // On this screen you make the calls: bowlers, incoming batters and reviews. The assistant sets bowling plans.
  useEffect(() => {
    const a = state.autoSettings;
    if (a && (a.bowler || a.batter || !a.plan || a.reviews)) void act({ type: 'auto', settings: { bowler: false, batter: false, plan: true, reviews: false } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh match has not raised the toss call yet: ask the engine for it.
  useEffect(() => {
    if (state.status === 'toss' && !needs && !m.busy && (state.toss.coin === null || state.toss.winner === user)) void step('toss');
  }, [state.status, needs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (state.status !== 'live' || needs) return;
      if (e.key === ' ' || e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        void step('ball');
      }
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

  const needOpeners = !!inn && !!user && state.status === 'live' && inn.battingSide === user && !needs
    && !openersDone[inn.index] && !deliveries.some((d: any) => d.innings === inn.index);

  let sheet: ReactNode = null;
  if (needOpeners) sheet = <OpenersSheet state={state} inn={inn} act={act} onDone={() => setOpenersDone((o) => ({ ...o, [inn.index]: true }))} />;
  else if (needs && needs.side === user) {
    if (needs.kind === 'bowler') sheet = <BowlerSheet state={state} inn={inn} needs={needs} act={act} />;
    if (needs.kind === 'batter') sheet = <BatterSheet state={state} inn={inn} needs={needs} act={act} />;
    if (needs.kind === 'review') sheet = <ReviewSheet state={state} inn={inn} needs={needs} act={act} />;
  }

  return (
    <CapsContext.Provider value={initial.caps ?? null}>
    <div className={`${C.page} -mx-4 -my-6 text-white md:-mx-6 ${show3D ? 'flex h-[calc(100dvh-66px)] flex-col overflow-hidden' : 'min-h-[calc(100dvh-66px)]'}`}>
      {slot === 'lab' && <div className="bg-[#1d2a44] px-4 py-1.5 text-xs text-[#9ec1ff]">Scenario Lab — an experimental replay. Nothing here changes your career.</div>}
      {state.status === 'toss' ? (
        <TossScreen state={state} needs={needs} act={act} step={step} user={user} />
      ) : (
        <>
          <TopBar state={state} inn={inn} />
          <div className={`flex justify-center gap-1 border-b ${C.line} ${C.page}`} role="tablist">
            {(['live', 'scorecard', 'commentary'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`px-5 py-2 text-sm font-semibold uppercase tracking-wider ${view === v ? 'border-b-2 border-[#5b5bf6] text-white' : 'text-[#9a9aa5] hover:text-white'}`}>{v}</button>
            ))}
            {view === 'live' && (
              <button className="ml-4 self-center rounded bg-[#2a2a35] px-2 py-0.5 text-xs text-[#cfcfd6] hover:bg-[#34343f]" onClick={() => { setUnsupported(null); save3D({ ...v3d, enabled: !v3d.enabled }); }}>
                {v3d.enabled && !unsupported ? 'Switch to 2D' : '3D view'}
              </button>
            )}
          </div>
          {unsupported && v3d.enabled && view === 'live' && <p className="bg-[#2a1d12] px-4 py-1.5 text-xs text-[#f5c48b]">3D unavailable: {unsupported} Showing the 2D board; every match function still works.</p>}
          {view === 'live' && show3D && (
            <Live3D m={m} inn={inn} user={user} onFinish={finish} slot={slot} presenter={presenter} settings={v3d} onSettings={(x) => save3D({ ...v3d, ...x })} onUnsupported={setUnsupported} />
          )}
          {view === 'live' && !show3D && <LiveBoard m={m} inn={inn} user={user} onFinish={finish} slot={slot} />}
          {view === 'scorecard' && <ScorecardView state={state} />}
          {view === 'commentary' && <Commentary deliveries={deliveries} />}
        </>
      )}
      {sheet}
      {m.drs && <ReviewResult ev={m.drs} state={state} onClose={m.closeDrs} />}
    </div>
    </CapsContext.Provider>
  );
}

// ------------------------------------------------------------------ toss

function TossScreen({ state, needs, act, step, user }: { state: any; needs: any; act: Act; step: (m: any) => Promise<any>; user: Side | null }) {
  const t = state.toss;
  const tossed = t.coin !== null && t.coin !== undefined;
  const [choice, setChoice] = useState<'bat' | 'bowl'>('bat');
  const userWon = tossed && t.winner === user;
  const stage = !tossed ? 1 : userWon && needs?.kind !== 'toss' ? 2 : 3;
  const v = state.setup.venue;
  return (
    <div className="flex flex-col items-center gap-8 px-4 py-8">
      <div className="flex items-center" aria-label={`Toss step ${stage} of 4`}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="flex items-center">
            {i > 1 && <span className={`h-1 w-12 ${i <= stage ? 'bg-[#22c55e]' : 'bg-[#3a3a44]'}`} />}
            <span className={`h-6 w-6 rounded-full ${i <= stage ? 'bg-[#22c55e]' : 'bg-[#3a3a44]'}`} />
          </span>
        ))}
      </div>
      <div className="flex items-center gap-6">
        <Circle size={100}><Crest state={state} side="home" size={64} /></Circle>
        <span className="text-lg">Vs</span>
        <Circle size={100}><Crest state={state} side="away" size={64} /></Circle>
      </div>
      <p className="-mt-4 text-sm text-[#9a9aa5]">{v.name} · {v.pitch.kind} pitch{v.pitch.spin > 0.3 ? ', helps spin' : v.pitch.pace > 0.3 ? ', helps seam' : ''} · dew {Math.round(v.dewChance * 100)}%</p>

      {!tossed && (
        needs?.kind === 'toss-call' ? (
          <>
            <p className="text-2xl">Call the toss</p>
            <div className="flex gap-10">
              {(['heads', 'tails'] as const).map((c) => (
                <button key={c} onClick={() => act({ type: 'toss-call', call: c })} className="rounded-full p-2 ring-[6px] ring-transparent transition hover:ring-white">
                  <Circle size={140}><span className="font-display text-2xl font-bold uppercase text-[#facc15]">{c}</span></Circle>
                </button>
              ))}
            </div>
          </>
        ) : <p className="text-[#9a9aa5]">Tossing…</p>
      )}

      {tossed && (
        <>
          <Circle size={150}><Crest state={state} side={t.winner} size={96} /></Circle>
          <p className="-mt-2 text-2xl">Won the toss</p>
          <p className="-mt-6 text-sm text-[#9a9aa5]">{user && t.call ? `You called ${t.call}; it landed ${t.coin}.` : `It landed ${t.coin}.`}</p>
          {userWon && needs?.kind === 'toss' ? (
            <>
              <div className="flex gap-10">
                {(['bat', 'bowl'] as const).map((c) => (
                  <button key={c} onClick={() => setChoice(c)} aria-pressed={choice === c} aria-label={c === 'bat' ? 'Bat first' : 'Bowl first'}
                    className={`rounded-full p-2 ring-[6px] transition ${choice === c ? 'ring-white' : 'ring-transparent hover:ring-[#3a3a44]'}`}>
                    <Circle size={140}><span className="flex flex-col items-center gap-1 text-[#e5e5e5]"><Icon name={c === 'bat' ? 'bat' : 'ball'} size={56} /><span className="text-sm uppercase tracking-widest">{c}</span></span></Circle>
                  </button>
                ))}
              </div>
              <button className={`${C.accentDeep} w-80 rounded-full py-3 text-2xl uppercase hover:brightness-110`} onClick={() => act({ type: 'toss', decision: choice })}>Start</button>
            </>
          ) : !userWon ? (
            <button className={`${C.accentDeep} w-80 rounded-full py-3 text-2xl uppercase hover:brightness-110`} onClick={() => step('toss')}>Start</button>
          ) : null}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ live board

function TopBar({ state, inn }: { state: any; inn: any }) {
  const t = state.toss;
  const done = state.status === 'complete';
  const need = inn && inn.target !== null ? inn.target - inn.runs : null;
  const left = inn ? inn.maxBalls - inn.legalBalls : 0;
  return (
    <header aria-label="Scoreboard" className={`${C.panel} grid grid-cols-1 items-center gap-3 px-6 py-4 md:grid-cols-[1fr_auto_1fr]`}>
      <div className="flex items-center gap-3">
        <Crest state={state} side="home" size={34} />
        <span className="text-2xl text-[#cfcfd6]">Vs</span>
        <Crest state={state} side="away" size={34} />
      </div>
      {inn ? (
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-1" aria-live="polite">
          <Crest state={state} side={inn.battingSide} size={30} />
          <span className="num text-2xl font-semibold">{inn.runs} - {inn.wickets}</span>
          <span className="num text-2xl text-[#9a9aa5]">({overs(inn.legalBalls)}) <b className="text-[#cfcfd6]">{inn.maxBalls / 6}</b></span>
          <span className="text-lg text-[#9a9aa5]">CRR <span className="num ml-2 text-[#cfcfd6]">{inn.legalBalls ? ((inn.runs / inn.legalBalls) * 6).toFixed(2) : '0.00'}</span></span>
          {need !== null && !done && <span className="text-sm text-[#facc15]">Need {Math.max(0, need)} off {left}</span>}
        </div>
      ) : <span />}
      <div className="flex items-center justify-start gap-2 md:justify-end">
        {done && state.result ? (
          <span className="text-lg font-semibold text-[#22c55e]">{state.result.winner ? `${state.setup[state.result.winner].shortName} ${state.result.margin}` : state.result.margin}</span>
        ) : (
          <>
            <Crest state={state} side={t.winner} size={30} />
            <span className="text-[#cfcfd6]">decided to</span>
            <span className="font-semibold uppercase text-[#22c55e]">{t.decision}</span>
          </>
        )}
      </div>
    </header>
  );
}

const APPROACHES = [
  { id: 'auto', label: 'Auto', v: null },
  { id: 'defend', label: 'Defend', v: 0.2 },
  { id: 'balanced', label: 'Balanced', v: 0.4 },
  { id: 'attack', label: 'Attack', v: 0.7 },
  { id: 'slog', label: 'Slog', v: 0.92 },
] as const;

const SPEEDS: Speed[] = ['slow', 'normal', 'fast', 'turbo'];

function LiveBoard({ m, inn, user, onFinish, slot }: { m: ReturnType<typeof useMatch>; inn: any; user: Side | null; onFinish: () => void; slot: string }) {
  const { state, deliveries, needs, step } = m;
  const done = state.status === 'complete';
  const blocked = !!needs || done || !inn;
  const innBalls = useMemo(() => (inn ? deliveries.filter((d: any) => d.innings === inn.index) : []), [deliveries, inn]);
  const last = innBalls[innBalls.length - 1] ?? deliveries[deliveries.length - 1];
  const batting = inn && inn.battingSide === user;
  const bowlerId = inn ? inn.currentBowlerId ?? inn.lastOverBowlerId : null;

  return (
    <>
      {/* batters */}
      <section className={`${C.panel} mt-2 px-4 py-3`} aria-label="Batters">
        <table className="mx-auto w-full max-w-[680px] text-center">
          <thead>
            <tr className={`border-b-2 ${C.line} text-lg tracking-wide`}>
              <th className="py-2 text-left font-semibold">Batsman</th><th className="font-semibold">Runs</th>
              <th className="font-semibold text-[#22c55e]">SR</th><th className="font-semibold text-[#f97316]">4s</th><th className="font-semibold text-[#d946ef]">6s</th>
            </tr>
          </thead>
          <tbody>
            {inn && [inn.strikerId, inn.nonStrikerId].map((id: string) => {
              const p = findPlayer(state, id);
              const b = inn.batters[id];
              if (!p || !b) return null;
              const on = id === inn.strikerId;
              return (
                <tr key={id} className={on ? 'bg-[#111111] font-semibold' : 'text-[#cfcfd6]'}>
                  <td className="rounded-l-lg py-2 pl-3 text-left"><span className="flex items-center gap-2"><Portrait p={p} />{p.shortName}{on ? ' *' : ''}<Marks state={state} id={id} /></span></td>
                  <td className="num">{b.runs} ( {b.balls} )</td>
                  <td className="num text-[#22c55e]">{sr(b.runs, b.balls)}</td>
                  <td className="num text-[#f97316]">{b.fours}</td>
                  <td className="num rounded-r-lg text-[#d946ef]">{b.sixes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* bowler */}
      <section className={`${C.panel} mt-2 px-4 py-3`} aria-label="Bowler">
        <table className="mx-auto w-full max-w-[680px] text-center">
          <thead>
            <tr className={`border-b-2 ${C.line} text-lg tracking-wide`}>
              <th className="py-2 text-left font-semibold">Bowler</th><th className="font-semibold text-[#22c55e]">Over</th>
              <th className="font-semibold">Runs</th><th className="font-semibold text-[#ef4444]">W</th><th className="font-semibold text-[#f97316]">Eco</th>
            </tr>
          </thead>
          <tbody>
            {bowlerId && inn.bowlers[bowlerId] ? (() => {
              const p = findPlayer(state, bowlerId);
              const b = inn.bowlers[bowlerId];
              return (
                <tr className="bg-[#111111] font-semibold">
                  <td className="rounded-l-lg py-2 pl-3 text-left"><span className="flex items-center gap-2"><Portrait p={p} />{p.shortName}<Marks state={state} id={bowlerId} /></span></td>
                  <td className="num text-[#22c55e]">{overs(b.balls)}</td>
                  <td className="num">{b.runs}</td>
                  <td className="num text-[#ef4444]">{b.wickets}</td>
                  <td className="num rounded-r-lg text-[#f97316]">{eco(b.runs, b.balls)}</td>
                </tr>
              );
            })() : <tr><td colSpan={5} className="py-3 text-sm text-[#9a9aa5]">Bowler to be chosen</td></tr>}
          </tbody>
        </table>
      </section>

      {/* the delivery */}
      <section className="relative flex flex-col items-center gap-4 px-4 py-6" aria-label="Play">
        {m.flash && (
          <div className={`pointer-events-none absolute inset-x-0 top-2 text-center font-display text-6xl font-bold uppercase ${m.flash === 'wicket' ? 'text-[#ef4444]' : m.flash === 'six' ? 'text-[#d946ef]' : 'text-[#f97316]'}`} aria-hidden>
            {m.flash === 'wicket' ? 'Out!' : m.flash}
          </div>
        )}
        {done ? (
          <div className="flex flex-col items-center gap-3 pt-8">
            {state.result && <p className="text-xl font-semibold text-[#22c55e]">{state.result.winner ? `${state.setup[state.result.winner].name} ${state.result.margin}` : state.result.margin}</p>}
            <button className={`${C.accentDeep} rounded-full px-8 py-3 text-lg hover:brightness-110`} onClick={onFinish}>{slot === 'lab' ? 'Close the lab' : 'Confirm result & open the match report'}</button>
          </div>
        ) : (
          <>
            <div className="flex w-full max-w-[900px] flex-col items-center gap-6 md:flex-row md:justify-between">
              <div className="min-h-[3rem] max-w-sm flex-1 text-sm text-[#cfcfd6]" aria-live="polite">
                {last ? (
                  <div className="flex items-start gap-2">
                    <span className={`num flex h-7 min-w-[2rem] shrink-0 items-center justify-center rounded px-1 font-bold ${ballChip(last).tone}`}>{ballChip(last).text}</span>
                    <span>{last.over}.{last.legal ? last.ball : last.ball + 1} · {last.commentary}</span>
                  </div>
                ) : <span className="text-[#9a9aa5]">First ball coming up.</span>}
              </div>
              <HitButton m={m} blocked={blocked} onHit={() => step('ball')} />
              <div className="flex max-w-sm flex-1 flex-wrap justify-center gap-2 md:justify-end">
                <PlayButtons m={m} blocked={blocked} />
              </div>
            </div>
            {batting && <ApproachRow m={m} inn={inn} />}
            {needs && needs.side !== user && <p className="text-sm text-[#9a9aa5]">Waiting for the opposition…</p>}
          </>
        )}
      </section>

      {inn && <OverStrip state={state} inn={inn} balls={innBalls} />}
    </>
  );
}

/** The 3D layout: the scene fills the space between the score bar and the controls; no page scrolling. */
function Live3D({ m, inn, user, onFinish, slot, presenter, settings, onSettings, onUnsupported }: {
  m: ReturnType<typeof useMatch>; inn: any; user: Side | null; onFinish: () => void; slot: string; presenter: { current: Presenter | null };
  settings: View3DSettings; onSettings: (s: View3DSettings) => void; onUnsupported: (why: string) => void;
}) {
  const { state, deliveries, needs, step } = m;
  const done = state.status === 'complete';
  const blocked = !!needs || done || !inn;
  const innBalls = useMemo(() => (inn ? deliveries.filter((d: any) => d.innings === inn.index) : []), [deliveries, inn]);
  const last = innBalls[innBalls.length - 1];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-[#9a9aa5]">Loading the 3D ground…</div>}>
          <Match3D state={state} last={deliveries[deliveries.length - 1] ?? null} speed={m.speed} presenter={presenter} settings={settings} onSettings={onSettings} onUnsupported={onUnsupported} busy={m.busy} />
        </Suspense>
        {inn && <ScoreBug state={state} inn={inn} innBalls={innBalls} />}
        {m.flash && (
          <div className={`pointer-events-none absolute inset-x-0 top-12 text-center font-display text-6xl font-bold uppercase drop-shadow ${m.flash === 'wicket' ? 'text-[#ef4444]' : m.flash === 'six' ? 'text-[#d946ef]' : 'text-[#f97316]'}`} aria-hidden>
            {m.flash === 'wicket' ? 'Out!' : m.flash}
          </div>
        )}
      </div>
      <section className={`${C.panel} flex flex-wrap items-center justify-center gap-3 px-3 py-2`} aria-label="Play">
        {done ? (
          <>
            {state.result && <span className="font-semibold text-[#22c55e]">{state.result.winner ? `${state.setup[state.result.winner].name} ${state.result.margin}` : state.result.margin}</span>}
            <button className={`${C.accentDeep} rounded-full px-6 py-2 hover:brightness-110`} onClick={onFinish}>{slot === 'lab' ? 'Close the lab' : 'Confirm result & open the match report'}</button>
          </>
        ) : (
          <>
            <div className="min-w-0 max-w-md flex-1 truncate text-sm text-[#cfcfd6]" aria-live="polite" title={last?.commentary}>
              {last ? <><span className={`num mr-2 inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded px-1 font-bold ${ballChip(last).tone}`}>{ballChip(last).text}</span>{last.over}.{last.legal ? last.ball : last.ball + 1} · {last.commentary}</> : <span className="text-[#9a9aa5]">First ball coming up.</span>}
            </div>
            <HitButton m={m} blocked={blocked} onHit={() => step('ball')} small />
            <div className="flex flex-wrap items-center gap-1.5"><PlayButtons m={m} blocked={blocked} /></div>
            {inn && inn.battingSide === user && <ApproachRow m={m} inn={inn} />}
            {needs && needs.side !== user && <span className="text-sm text-[#9a9aa5]">Waiting for the opposition…</span>}
          </>
        )}
      </section>
      {inn && <OverStrip state={state} inn={inn} balls={innBalls} />}
    </div>
  );
}

/** Readable text on a team colour: dark on light kits, white on dark ones. */
function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0b0d12' : '#ffffff';
}

/** Darken a hex colour by `k` (0..1) for the panel edges. */
function shade(hex: string, k: number): string {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k)));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Broadcast-style score bar: batting team panel (both batters, overs), the score, then the
 * bowling team panel (bowler figures, this over, economy), each in its team's colours.
 */
function ScoreBug({ state, inn, innBalls }: { state: any; inn: any; innBalls: any[] }) {
  const bat = state.setup[inn.battingSide];
  const bowlSide = inn.battingSide === 'home' ? 'away' : 'home';
  const bowl = state.setup[bowlSide];
  const batBg = bat.colors[0];
  const bowlBg = bowl.colors[0];
  const batInk = inkOn(batBg);
  const bowlInk = inkOn(bowlBg);
  const striker = findPlayer(state, inn.strikerId);
  const other = findPlayer(state, inn.nonStrikerId);
  const sb = inn.batters[inn.strikerId];
  const ob = inn.batters[inn.nonStrikerId];
  const bowlerId = inn.currentBowlerId ?? inn.lastOverBowlerId;
  const bowler = bowlerId ? findPlayer(state, bowlerId) : null;
  const bf = bowlerId ? inn.bowlers[bowlerId] : null;
  const overIdx = innBalls.length ? innBalls[innBalls.length - 1].over : 0;
  const thisOver = innBalls.filter((d: any) => d.over === overIdx);
  const surname = (p: any) => (p?.shortName ?? '').split(' ').slice(-1)[0];
  const need = inn.target !== null && inn.target !== undefined ? inn.target - inn.runs : null;
  const left = inn.maxBalls - inn.legalBalls;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col items-center" aria-label="Score bar">
      {need !== null && state.status !== 'complete' && (
        <div className="mb-1 rounded-sm bg-black/75 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
          {bat.shortName} need {Math.max(0, need)} from {left} ball{left === 1 ? '' : 's'}
        </div>
      )}
      <div className="flex h-[58px] w-full max-w-[1100px] items-stretch overflow-hidden rounded-sm shadow-[0_6px_24px_rgba(0,0,0,0.45)]">
        <div className="grid w-[64px] shrink-0 place-items-center" style={{ background: shade(batBg, 0.25) }}>
          <ClubCrestById clubId={bat.clubId} size={40} fallback={{ id: bat.clubId, name: bat.name, shortName: bat.shortName, colors: bat.colors }} />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-4 px-4" style={{ background: batBg, color: batInk }}>
          <div className="min-w-0 flex-1 leading-tight">
            {other && ob && (
              <div className="truncate text-[13px] opacity-80">
                <span className="font-medium">{surname(other)}</span><Marks state={state} id={other.id} /> <span className="num ml-1">{ob.runs}</span> <span className="num text-[11px] opacity-80">({ob.balls})</span>
              </div>
            )}
            {striker && sb && (
              <div className="truncate text-[19px] font-bold">
                {surname(striker)}<Marks state={state} id={striker.id} /> <span className="num ml-1">{sb.runs}</span> <span className="num text-[13px] font-semibold opacity-80">({sb.balls})</span>
              </div>
            )}
          </div>
          <div className="h-8 w-px shrink-0 opacity-30" style={{ background: batInk }} />
          <div className="shrink-0 text-[15px]">Overs <span className="num ml-1 font-bold">{overs(inn.legalBalls)}</span></div>
        </div>
        <div className="flex shrink-0 items-center bg-[#eef0f4] px-6 text-[#0b0d12]">
          <span className="num font-display text-[30px] font-bold leading-none">{inn.runs}-{inn.wickets}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-4 px-4" style={{ background: bowlBg, color: bowlInk }}>
          {bowler && bf ? (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[19px] font-bold">
                  {surname(bowler)}<Marks state={state} id={bowler.id} /> <span className="num ml-1">{bf.wickets}-{bf.runs}</span> <span className="num text-[13px] font-semibold opacity-80">({overs(bf.balls)})</span>
                </div>
                <div className="mt-1 flex gap-1">
                  {thisOver.map((d: any) => {
                    const t = ballChip(d).text;
                    const bad = !!d.wicket;
                    return (
                      <span key={d.seq} className="num grid h-[18px] min-w-[18px] place-items-center rounded-full border px-1 text-[10px] font-bold leading-none"
                        style={{ borderColor: bowlInk, background: bad ? '#ef4444' : d.boundary ? bowlInk : 'transparent', color: bad ? '#fff' : d.boundary ? bowlBg : bowlInk }}>
                        {t === '•' ? '' : t}
                        {t === '•' && <span className="h-1.5 w-1.5 rounded-full" style={{ background: bowlInk }} />}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="shrink-0 text-[15px]">Econ: <span className="num font-bold">{eco(bf.runs, bf.balls)}</span></div>
            </>
          ) : <div className="text-sm opacity-80">Bowler to be chosen</div>}
        </div>
        <div className="grid w-[64px] shrink-0 place-items-center" style={{ background: shade(bowlBg, 0.25) }}>
          <ClubCrestById clubId={bowl.clubId} size={40} fallback={{ id: bowl.clubId, name: bowl.name, shortName: bowl.shortName, colors: bowl.colors }} />
        </div>
      </div>
    </div>
  );
}

function HitButton({ m, blocked, onHit, small = false }: { m: ReturnType<typeof useMatch>; blocked: boolean; onHit: () => void; small?: boolean }) {
  return (
    <button className={`grid shrink-0 place-items-center rounded-full bg-[#ededed] text-black shadow-lg transition hover:scale-105 active:scale-95 disabled:opacity-40 ${small ? 'h-14 w-14 text-lg' : 'h-24 w-24 text-2xl'}`}
      disabled={blocked || m.busy || m.playing} onClick={onHit} title="Bowl the next ball (Space)">HIT</button>
  );
}

function PlayButtons({ m, blocked }: { m: ReturnType<typeof useMatch>; blocked: boolean }) {
  const btn = 'rounded-md bg-[#2a2a35] px-3 py-1.5 text-sm hover:bg-[#34343f] disabled:opacity-40';
  return (
    <>
      <button className={btn} disabled={blocked && !m.playing} onClick={() => (m.playing ? m.pause() : m.play())}>{m.playing ? 'Pause' : 'Auto play'}</button>
      <button className={btn} disabled={blocked || m.busy} onClick={() => m.step('over')}>Finish over</button>
      <button className={btn} disabled={blocked || m.busy} onClick={() => m.step('innings')} title="Instant: skips the animation">Sim innings</button>
      <button className={btn} disabled={blocked || m.busy} onClick={() => m.step('end')} title="Instant: skips the animation">Sim match</button>
      <select className="rounded-md bg-[#2a2a35] px-2 py-1.5 text-sm" aria-label="Playback speed" value={m.speed} onChange={(e) => m.setSpeed(e.target.value as Speed)}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </>
  );
}

function ApproachRow({ m, inn }: { m: ReturnType<typeof useMatch>; inn: any }) {
  const auto = m.state.autoSettings ?? {};
  const approach = auto.approach ? 'auto' : inn?.intent == null ? 'auto' : APPROACHES.slice(1).reduce((a, b) => (Math.abs((b.v as number) - inn.intent) < Math.abs((a.v as number) - inn.intent) ? b : a)).id;
  const setApproach = async (a: (typeof APPROACHES)[number]) => {
    if (a.v === null) {
      await m.act({ type: 'intent', value: null });
      await m.act({ type: 'auto', settings: { approach: true } }, 'Approach: assistant decides.');
    } else {
      if (auto.approach) await m.act({ type: 'auto', settings: { approach: false } });
      await m.act({ type: 'intent', value: a.v }, `Approach: ${a.label}.`);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="Batting approach">
      <span className="mr-1 text-xs uppercase tracking-widest text-[#9a9aa5]">Approach</span>
      {APPROACHES.map((a) => (
        <button key={a.id} role="radio" aria-checked={approach === a.id} onClick={() => setApproach(a)}
          className={`rounded-full px-3 py-1 text-sm ${approach === a.id ? `${C.accent} text-white` : 'bg-[#2a2a35] text-[#cfcfd6] hover:bg-[#34343f]'}`}>{a.label}</button>
      ))}
    </div>
  );
}

function OverStrip({ state, inn, balls }: { state: any; inn: any; balls: any[] }) {
  const byOver = useMemo(() => {
    const out: { over: number; runs: number; wickets: number; balls: any[] }[] = [];
    for (const d of balls) {
      let o = out.find((x) => x.over === d.over);
      if (!o) out.push((o = { over: d.over, runs: 0, wickets: 0, balls: [] }));
      o.runs += d.totalRuns;
      if (d.wicket) o.wickets++;
      o.balls.push(d);
    }
    if (!out.length || (inn.legalBalls % 6 === 0 && inn.legalBalls > 0 && !inn.complete && out[out.length - 1].over < inn.legalBalls / 6)) out.push({ over: Math.floor(inn.legalBalls / 6), runs: 0, wickets: 0, balls: [] });
    return out;
  }, [balls, inn.legalBalls, inn.complete]);
  const [sel, setSel] = useState<number | null>(null);
  const shown = byOver.find((o) => o.over === sel) ?? byOver[byOver.length - 1];
  return (
    <section aria-label="Overs">
      <div className="flex min-h-[2.5rem] flex-wrap items-center justify-center gap-1.5 px-4 pb-2">
        {shown?.balls.map((d) => {
          const c = ballChip(d);
          return <span key={d.seq} className={`num flex h-8 min-w-[2rem] items-center justify-center rounded-full px-1.5 text-sm font-bold ${c.tone}`} title={d.commentary}>{c.text}</span>;
        })}
      </div>
      <div className={`${C.panel} strip flex justify-center overflow-x-auto`}>
        <div className="flex">
          {byOver.map((o) => (
            <button key={o.over} onClick={() => setSel(o.over)} aria-pressed={shown?.over === o.over}
              className={`min-w-[7rem] px-4 py-3 text-center text-sm ${shown?.over === o.over ? 'bg-[#2b3036]' : 'hover:bg-[#262535]'}`}>
              <div className="font-semibold">Ov {o.over + 1}</div>
              <div className="mt-2 text-[#cfcfd6]">{o.runs} runs{o.wickets ? ` · ${o.wickets}W` : ''}</div>
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only">{state.setup[inn.battingSide].name} batting</p>
    </section>
  );
}

function Commentary({ deliveries }: { deliveries: any[] }) {
  const recent = deliveries.slice(-40).reverse();
  if (!recent.length) return null;
  return (
    <section className="mx-auto max-w-[900px] px-4 py-4" aria-label="Commentary">
      <h3 className="mb-2 text-sm uppercase tracking-widest text-[#9a9aa5]">Commentary</h3>
      <ol className={`divide-y divide-[#26262e] rounded-lg ${C.panel} text-sm`}>
        {recent.map((d) => {
          const c = ballChip(d);
          return (
            <li key={d.seq} className="flex gap-3 px-3 py-2">
              <span className="num w-10 shrink-0 text-[#9a9aa5]">{d.over}.{d.legal ? d.ball : d.ball + 1}</span>
              <span className={`num flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded px-1 text-xs font-bold ${c.tone}`}>{c.text}</span>
              <span className="text-[#cfcfd6]">
                {d.commentary}
                {d.review && <span className="block text-[#9ec1ff]">DRS: {d.review.overturned ? 'overturned' : d.review.umpiresCall ? "umpire's call" : 'decision stands'}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ select-player sheets

interface Row { id: string; p: any; cells: ReactNode[]; note?: string | null }

function PickSheet({ state, side, title, rows, cols, onNext, nextLabel = 'Next', initial = null }: {
  state: any; side: Side; title: string; rows: Row[]; cols: string[]; onNext: (id: string) => void; nextLabel?: string; initial?: string | null;
}) {
  const [sel, setSel] = useState<string | null>(initial);
  useEffect(() => setSel(initial), [title]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3" role="dialog" aria-modal aria-label={title}>
      <div className={`${C.sheet} flex max-h-[92dvh] w-full max-w-[700px] flex-col rounded-xl p-4 text-white shadow-2xl`}>
        <div className="flex items-center justify-between px-1 pb-3">
          <Circle size={62}><Crest state={state} side={side} size={40} /></Circle>
          <h2 className="text-2xl text-[#bdbdc6]">{title}</h2>
        </div>
        <div className="h-0.5 bg-[#5a5a63]" />
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <button disabled={!!r.note} onClick={() => setSel(r.id)} onDoubleClick={() => !r.note && onNext(r.id)} aria-pressed={sel === r.id} title={r.note ?? undefined}
                className={`flex w-full items-center gap-3 border-b ${C.line} px-4 py-2.5 text-left text-lg transition ${sel === r.id ? 'bg-[#2c2c2c]' : 'hover:bg-[#1d1d1d]'} disabled:cursor-not-allowed disabled:opacity-40`}>
                <Portrait p={r.p} size={36} />
                <span className="flex-1 truncate">{r.p.shortName}{r.note ? <span className="ml-2 text-xs text-[#9a9aa5]">{r.note}</span> : null}</span>
                {r.cells.map((c, i) => <span key={i} className={`num w-20 text-right ${i === r.cells.length - 1 ? 'text-[#22c55e]' : ''}`}>{c}</span>)}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 h-1 bg-[#5a5a63]" />
        <div className={`${C.accent} mt-2 flex items-center rounded-md px-4 py-2.5 text-lg`}>
          <span className="flex-1">Select Player</span>
          {cols.map((c) => <span key={c} className="w-20 text-right">{c}</span>)}
        </div>
        <button className={`mx-auto mt-2 w-56 py-2 uppercase transition ${sel ? `${C.accentDeep} text-white hover:brightness-110` : 'bg-[#6b6b6b] text-[#2b2b2b]'}`} disabled={!sel} onClick={() => sel && onNext(sel)}>{nextLabel}</button>
      </div>
    </div>
  );
}

function OpenersSheet({ state, inn, act, onDone }: { state: any; inn: any; act: Act; onDone: () => void }) {
  const [striker, setStriker] = useState<string | null>(null);
  const xi = state.setup[inn.battingSide].xi;
  const rows = (exclude: string | null): Row[] => xi.filter((p: any) => p.id !== exclude).map((p: any) => ({ id: p.id, p, cells: [batPower(p)] }));
  if (!striker) {
    return <PickSheet state={state} side={inn.battingSide} title="Select Opener" rows={rows(null)} cols={['Power']} initial={inn.order[0]} onNext={setStriker} />;
  }
  return (
    <PickSheet state={state} side={inn.battingSide} title="Select Non Striker" rows={rows(striker)} cols={['Power']} initial={inn.order.find((id: string) => id !== striker)} nextLabel="Start innings"
      onNext={async (id) => { if (await act({ type: 'openers', strikerId: striker, nonStrikerId: id })) onDone(); }} />
  );
}

function BowlerSheet({ state, inn, needs, act }: { state: any; inn: any; needs: any; act: Act }) {
  const side: Side = inn.bowlingSide;
  const quota = state.setup.rules.maxBowlerOvers * 6;
  const rows: Row[] = state.setup[side].xi.filter((p: any) => p.bowlType !== 'NONE').map((p: any) => {
    const b = inn.bowlers[p.id];
    const note = p.id === state.setup[side].keeperId ? 'keeping' : p.id === inn.lastOverBowlerId ? 'bowled last over' : b && b.balls >= quota ? 'quota done' : !needs.eligible.includes(p.id) ? 'unavailable' : null;
    return { id: p.id, p, note, cells: [b ? `${overs(b.balls)}` : '0.0', b ? `${b.runs}-${b.wickets}` : '0-0', bowlPower(p)] };
  }).sort((a: Row, b: Row) => Number(!!a.note) - Number(!!b.note));
  return <PickSheet state={state} side={side} title="Select Bowler" rows={rows} cols={['Overs', 'Figures', 'Power']} initial={needs.suggestion} onNext={(id) => act({ type: 'bowler', playerId: id })} />;
}

function BatterSheet({ state, inn, needs, act }: { state: any; inn: any; needs: any; act: Act }) {
  const rows: Row[] = needs.eligible.map((id: string) => {
    const p = findPlayer(state, id);
    return { id, p, cells: [batPower(p)] };
  });
  return <PickSheet state={state} side={inn.battingSide} title="Select Batsman" rows={rows} cols={['Power']} initial={needs.incomingId} onNext={(id) => act({ type: 'batter', playerId: id })} />;
}

function ReviewSheet({ state, inn, needs, act }: { state: any; inn: any; needs: any; act: Act }) {
  const pe = state.pendingEvent;
  const out = state.pendingMeta?.umpireOut;
  const left = needs.by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
  const batter = pe ? findPlayer(state, pe.strikerId) : null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3" role="dialog" aria-modal aria-label="Review the decision">
      <div className={`${C.sheet} w-full max-w-[460px] rounded-xl p-6 text-center text-white`}>
        <div className="text-sm uppercase tracking-widest text-[#9a9aa5]">Umpire’s decision · {needs.decision === 'caught-behind' ? 'Caught behind' : 'LBW'}</div>
        {batter && <div className="mt-3 flex items-center justify-center gap-2"><Portrait p={batter} size={40} /><span className="text-lg">{batter.name}</span></div>}
        <div className={`mt-2 font-display text-5xl font-bold uppercase ${out ? 'text-[#ef4444]' : 'text-white'}`}>{out ? 'Out' : 'Not out'}</div>
        <p className="mt-3 text-sm text-[#cfcfd6]">{needs.by === 'batting' ? 'Review the dismissal?' : 'Review the not-out call?'} {left} review{left === 1 ? '' : 's'} left.</p>
        <div className="mt-5 flex gap-3">
          <button className={`${C.accentDeep} flex-1 rounded-md py-2.5 uppercase hover:brightness-110`} onClick={() => act({ type: 'review', review: true })}>Review</button>
          <button className="flex-1 rounded-md bg-[#2a2a35] py-2.5 uppercase hover:bg-[#34343f]" onClick={() => act({ type: 'review', review: false })}>Accept</button>
        </div>
      </div>
    </div>
  );
}

function ReviewResult({ ev, state, onClose }: { ev: any; state: any; onClose: () => void }) {
  const r = ev.review;
  const batter = findPlayer(state, ev.strikerId);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3" role="dialog" aria-modal aria-label="Review result" onClick={onClose}>
      <div className={`${C.sheet} w-full max-w-[420px] rounded-xl p-6 text-center text-white`}>
        <div className="text-sm uppercase tracking-widest text-[#9a9aa5]">DRS · {r.kind === 'caught-behind' ? 'Caught behind' : 'LBW'} · {batter?.shortName}</div>
        <div className={`mt-3 font-display text-4xl font-bold uppercase ${ev.wicket ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>{ev.wicket ? 'Out' : 'Not out'}</div>
        <p className="mt-2 text-[#cfcfd6]">{r.overturned ? 'Decision overturned.' : r.umpiresCall ? "Umpire's call — the decision stands." : 'The decision stands.'}</p>
        {r.decisive && <p className="mt-1 text-sm text-[#9a9aa5]">{r.decisive}</p>}
        <button className={`${C.accentDeep} mt-5 w-full rounded-md py-2.5 uppercase`} onClick={onClose}>Continue</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ scorecard

function ScorecardView({ state }: { state: any }) {
  if (!state.innings.length) return <p className="p-6 text-center text-[#9a9aa5]">No innings yet.</p>;
  return (
    <div className="mx-auto max-w-[620px] space-y-10 px-4 py-6">
      {state.innings.map((inn: any) => <InningsCard key={inn.index} state={state} inn={inn} />)}
    </div>
  );
}

function InningsCard({ state, inn }: { state: any; inn: any }) {
  const bat = state.setup[inn.battingSide];
  const bowlSide: Side = other(inn.battingSide);
  const batted = inn.order.filter((id: string) => inn.batters[id]);
  const yet = inn.order.filter((id: string) => !inn.batters[id]);
  const bowled = Object.values(inn.bowlers) as any[];
  const yetToBowl = state.setup[bowlSide].xi.filter((p: any) => p.bowlType !== 'NONE' && !inn.bowlers[p.id] && p.id !== state.setup[bowlSide].keeperId);
  const label = inn.superOver ? 'Super Over' : inn.index === 0 ? '1st Innings' : '2nd Innings';
  const ex = inn.extras;
  return (
    <section className="text-white">
      <div className={`flex items-center justify-center gap-3 border-y ${C.line} py-3`}>
        <Circle size={56}><Crest state={state} side={inn.battingSide} size={36} /></Circle>
        <span className="text-lg">{label}</span>
      </div>
      <div className={`grid grid-cols-3 border-b ${C.line} px-3 py-4 text-2xl font-semibold`}>
        <span className="num">{inn.runs} - {inn.wickets}</span>
        <span className="num text-center">{overs(inn.legalBalls)} ({inn.maxBalls / 6})</span>
        <span className="num text-right">{inn.legalBalls ? ((inn.runs / inn.legalBalls) * 6).toFixed(2) : '0.00'}</span>
      </div>
      <div className={`border-b ${C.line} py-3 text-center text-lg`}>Batting ScoreCard</div>
      <table className="w-full text-center">
        <thead>
          <tr className={`border-b-2 ${C.line}`}>
            <th className="py-3 pl-3 text-left font-semibold">Batsman</th><th className="font-semibold">Runs</th>
            <th className="font-semibold text-[#22c55e]">SR</th><th className="font-semibold text-[#f97316]">4s</th><th className="font-semibold text-[#d946ef]">6s</th>
          </tr>
        </thead>
        <tbody>
          {batted.map((id: string) => {
            const b = inn.batters[id];
            const p = findPlayer(state, id);
            return (
              <tr key={id} className={`border-b ${C.line}`}>
                <td className="py-2.5 pl-3 text-left">
                  <span className="flex items-center gap-2">
                    <Portrait p={p} size={30} />
                    <span>
                      <span className="block font-semibold">{p.shortName}<Marks state={state} id={id} /></span>
                      <span className={`block text-xs ${b.out ? 'text-[#9a9aa5]' : 'text-[#22c55e]'}`}>{b.out ? b.out.text : 'not out'}</span>
                    </span>
                  </span>
                </td>
                <td className="num">{b.runs} ( {b.balls} )</td>
                <td className="num text-[#22c55e]">{sr(b.runs, b.balls)}</td>
                <td className="num text-[#f97316]">{b.fours}</td>
                <td className="num text-[#d946ef]">{b.sixes}</td>
              </tr>
            );
          })}
          <tr className={`border-b ${C.line} text-sm text-[#9a9aa5]`}>
            <td className="py-2 pl-3 text-left">Extras</td>
            <td className="num">{ex.wides + ex.noBalls + ex.byes + ex.legByes}</td>
            <td colSpan={3} className="text-left">w {ex.wides}, nb {ex.noBalls}, b {ex.byes}, lb {ex.legByes}</td>
          </tr>
        </tbody>
      </table>
      {yet.length > 0 && (
        <>
          <div className="py-3 text-center font-semibold">Yet to Play</div>
          <Chips names={yet.map((id: string) => findPlayer(state, id).shortName)} />
        </>
      )}
      <div className={`mt-8 flex items-center justify-center gap-3 border-y ${C.line} py-3`}>
        <Circle size={56}><Crest state={state} side={bowlSide} size={36} /></Circle>
        <span className="text-lg">Bowling ScoreCard</span>
      </div>
      <table className="w-full text-center">
        <thead>
          <tr className={`border-b-2 ${C.line}`}>
            <th className="py-3 pl-3 text-left font-normal">Bowler</th><th className="font-semibold text-[#22c55e]">Over</th>
            <th className="font-semibold">Runs</th><th className="font-semibold text-[#ef4444]">W</th><th className="font-semibold text-[#f97316]">Eco</th>
          </tr>
        </thead>
        <tbody>
          {bowled.map((b) => {
            const p = findPlayer(state, b.playerId);
            return (
              <tr key={b.playerId} className={`border-b ${C.line}`}>
                <td className="py-2.5 pl-3 text-left"><span className="flex items-center gap-2"><Portrait p={p} size={30} /><span className="font-semibold">{p.shortName}<Marks state={state} id={b.playerId} /></span></span></td>
                <td className="num text-[#22c55e]">{overs(b.balls)}</td>
                <td className="num">{b.runs}</td>
                <td className="num text-[#ef4444]">{b.wickets}</td>
                <td className="num text-[#f97316]">{eco(b.runs, b.balls)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {yetToBowl.length > 0 && (
        <>
          <div className="py-3 text-center font-semibold">Yet to Bowl</div>
          <Chips names={yetToBowl.map((p: any) => p.shortName)} />
        </>
      )}
    </section>
  );
}

function Chips({ names }: { names: string[] }) {
  return (
    <div className={`flex flex-wrap gap-2 border-b-2 ${C.line} px-2 pb-4`}>
      {names.map((n) => <span key={n} className={`${C.panel} rounded px-2.5 py-1.5 text-sm`}>{n}</span>)}
    </div>
  );
}
