import { useEffect, useState } from 'react';
import { BOWL_LABEL, ROLE_LABEL, overs } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { Badge, Modal } from '../../components/ui';
import { Icon } from '../../components/icons';

type Act = (a: any, s?: string) => Promise<boolean>;

export const findPlayer = (state: any, id: string) => state.setup.home.xi.find((p: any) => p.id === id) ?? state.setup.away.xi.find((p: any) => p.id === id);
const isSpin = (t: string) => ['OB', 'LB', 'SLA', 'SLC'].includes(t);
export const phaseOfInn = (state: any, inn: any) => (inn.superOver ? 'death' : Math.floor(inn.legalBalls / 6) < state.setup.rules.powerplayOvers ? 'powerplay' : Math.floor(inn.legalBalls / 6) >= state.setup.rules.overs - 5 ? 'death' : 'middle');

/** Attribute-based matchup reading for display (the engine adds form, pressure and conditions). */
export function matchup(state: any, inn: any, batter: any, bowler: any) {
  if (!batter || !bowler) return null;
  const spin = isSpin(bowler.bowlType);
  const phase = phaseOfInn(state, inn);
  const bat = 0.75 * (spin ? batter.attrs.bat.vsSpin : batter.attrs.bat.vsPace) + 0.25 * batter.attrs.bat[phase];
  const b = bowler.attrs.bowl;
  const bowlPhase = phase === 'powerplay' ? b.powerplay : phase === 'death' ? b.death : (b.powerplay + b.death) / 2;
  const bowl = spin ? 0.34 * b.control + 0.32 * b.movement + 0.18 * b.variation + 0.16 * bowlPhase : 0.36 * b.control + 0.3 * b.movement + 0.12 * b.variation + 0.22 * bowlPhase;
  const edge = Math.round(bat - bowl);
  return { bat: Math.round(bat), bowl: Math.round(bowl), edge, label: edge >= 6 ? 'Batter favoured' : edge <= -6 ? 'Bowler favoured' : 'Even contest' };
}

// ------------------------------------------------------------------ toss

export function TossSequence({ state, needs, act, step }: { state: any; needs: any; act: Act; step: (m: any) => Promise<any> }) {
  const { prefs } = usePrefs();
  const [flipping, setFlipping] = useState(false);
  const user = state.setup.userSide;
  const t = state.toss;
  const tossed = t.coin !== null && t.coin !== undefined;
  const v = state.setup.venue;
  const call = async (c: 'heads' | 'tails') => {
    setFlipping(true);
    await act({ type: 'toss-call', call: c });
    setTimeout(() => setFlipping(false), prefs.animations ? 1300 : 0);
  };
  const userWon = tossed && t.winner === user;
  return (
    <Modal open title="The toss" onClose={() => {}} required>
      <div className="space-y-5 text-center">
        <div className="flex items-center justify-center gap-4 font-display text-2xl font-bold uppercase">
          <span>{state.setup.home.shortName}</span><span className="text-ink-faint">v</span><span>{state.setup.away.shortName}</span>
        </div>
        <p className="text-sm text-ink-muted">{v.name}: {v.pitch.kind} pitch{v.pitch.spin > 0.3 ? ', helps spin' : v.pitch.pace > 0.3 ? ', helps seam' : ''} · dew chance {Math.round(v.dewChance * 100)}%{state.setup.evening ? ' (evening)' : ''}</p>
        <div className={`coin mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-warn bg-warn/20 font-display text-lg font-bold uppercase text-warn ${flipping && prefs.animations ? 'coin-flip' : ''}`} aria-live="polite">
          {tossed && !flipping ? t.coin : '?'}
        </div>
        {!tossed && needs?.kind === 'toss-call' && (
          <>
            <p className="font-medium">Your call, captain.</p>
            <div className="flex gap-3">
              <button className="btn-primary flex-1 py-3 text-base" onClick={() => call('heads')}>Heads</button>
              <button className="btn-primary flex-1 py-3 text-base" onClick={() => call('tails')}>Tails</button>
            </div>
          </>
        )}
        {tossed && !flipping && (
          <div className="rise space-y-3">
            <p className="text-lg">
              You called <b>{t.call}</b>. It’s <b>{t.coin}</b>. <b className={userWon ? 'text-lime' : 'text-ink'}>{state.setup[t.winner].name}</b> win the toss.
            </p>
            {userWon && needs?.kind === 'toss' ? (
              <div className="flex gap-3">
                <button className="btn-primary flex-1 py-3" onClick={() => act({ type: 'toss', decision: 'bat' })}><Icon name="bat" /> Bat first</button>
                <button className="btn-primary flex-1 py-3" onClick={() => act({ type: 'toss', decision: 'bowl' })}><Icon name="ball" /> Bowl first</button>
              </div>
            ) : !userWon ? (
              <button className="btn-primary w-full py-3" onClick={() => step('toss')}>Hear their decision</button>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Shown once after the toss: who bats first. */
export function TossOutcome({ state, onClose }: { state: any; onClose: () => void }) {
  const t = state.toss;
  const inn = state.innings[0];
  if (!inn) return null;
  return (
    <Modal open title="Toss result" onClose={onClose}>
      <p className="text-center text-lg"><b>{state.setup[t.winner].name}</b> won the toss and chose to <b>{t.decision}</b>.</p>
      <p className="mt-2 text-center text-sm text-ink-muted">{state.setup[inn.battingSide].name} will bat first.</p>
      <button className="btn-primary mt-5 w-full" onClick={onClose}>To the middle</button>
    </Modal>
  );
}

// ------------------------------------------------------------------ bowler & batter choices (rendered in the control centre)

export function BowlerChoice({ state, needs, act }: { state: any; needs: any; act: Act }) {
  const inn = state.innings[state.innings.length - 1];
  const xi = state.setup[inn.bowlingSide].xi;
  const striker = findPlayer(state, inn.strikerId);
  const quota = state.setup.rules.maxBowlerOvers * 6;
  const reason = (p: any) => {
    const b = inn.bowlers[p.id];
    if (p.id === state.setup[inn.bowlingSide].keeperId) return 'Keeping wicket';
    if (p.bowlType === 'NONE') return 'Does not bowl';
    if (p.id === inn.lastOverBowlerId) return 'Bowled the last over';
    if (b && b.balls >= quota) return `Quota of ${state.setup.rules.maxBowlerOvers} overs used`;
    return null;
  };
  return (
    <div className="space-y-2">
      <div className="kicker">Decision · over {Math.floor(inn.legalBalls / 6) + 1}</div>
      <p className="text-sm text-ink-muted">Choose the bowler. On strike: <b className="text-ink">{striker?.name}</b> ({striker?.batHand === 'L' ? 'left' : 'right'}-handed).</p>
      <ul className="space-y-1">
        {xi.filter((p: any) => p.bowlType !== 'NONE').map((p: any) => {
          const b = inn.bowlers[p.id];
          const r = reason(p);
          const m = matchup(state, inn, striker, p);
          const sug = p.id === needs.suggestion;
          const tired = (b?.spellFatigue ?? 0) > 10;
          return (
            <li key={p.id}>
              <button disabled={!!r} onClick={() => act({ type: 'bowler', playerId: p.id })}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${r ? 'cursor-not-allowed border-obsidian-800 opacity-50' : sug ? 'border-lime/60 bg-lime/5 hover:border-lime' : 'border-obsidian-700 hover:border-obsidian-500'}`}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="flex shrink-0 gap-1">{sug && <Badge tone="lime">Suggested</Badge>}{tired && <Badge tone="warn">Tiring</Badge>}{m && m.edge >= 6 && <Badge tone="danger">Poor matchup</Badge>}</span>
                </div>
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>{p.bowlType} · ctl {Math.round(p.attrs.bowl.control)} · {b ? `${overs(b.balls)}-${b.runs}-${b.wickets}` : 'fresh'} · {Math.max(0, (quota - (b?.balls ?? 0)) / 6)} ov left</span>
                  <span>{r ?? (m ? m.label : '')}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BatterChoice({ state, needs, act }: { state: any; needs: any; act: Act }) {
  const inn = state.innings[state.innings.length - 1];
  const bowlerId = inn.currentBowlerId ?? inn.lastOverBowlerId;
  const bowler = bowlerId ? findPlayer(state, bowlerId) : null;
  return (
    <div className="space-y-2">
      <div className="kicker">Decision · wicket</div>
      <p className="text-sm text-ink-muted">Who walks out at {inn.runs}/{inn.wickets}? {bowler ? <>Facing {bowler.name} ({BOWL_LABEL[bowler.bowlType]}).</> : null}</p>
      <ul className="space-y-1">
        {needs.eligible.map((id: string) => {
          const p = findPlayer(state, id);
          const m = matchup(state, inn, p, bowler);
          const pos = inn.order.indexOf(id) + 1;
          return (
            <li key={id}>
              <button onClick={() => act({ type: 'batter', playerId: id })}
                className={`w-full rounded-lg border px-3 py-2 text-left transition hover:border-lime ${id === needs.incomingId ? 'border-lime/60 bg-lime/5' : 'border-obsidian-700'}`}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium"><span className="num mr-1 text-ink-faint">{pos}</span>{p.name}</span>
                  {id === needs.incomingId && <Badge tone="lime">Next in order</Badge>}
                </div>
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>{ROLE_LABEL[p.role]} · form {p.form > 0 ? '+' : ''}{p.form} · fatigue {Math.round(p.fatigue)}{p.tags.length ? ` · ${p.tags.slice(0, 2).join(', ')}` : ''}</span>
                  <span>{m ? `${m.label} (${m.bat} v ${m.bowl})` : ''}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ reviews

export function ReviewChoice({ state, needs, act }: { state: any; needs: any; act: Act }) {
  const inn = state.innings[state.innings.length - 1];
  const pe = state.pendingEvent;
  const out = state.pendingMeta?.umpireOut;
  const left = needs.by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
  const what = needs.decision === 'caught-behind' ? 'Caught behind' : 'LBW';
  return (
    <div className="space-y-3">
      <div className="kicker">Decision review system</div>
      <div className={`rounded-xl border p-4 text-center ${out ? 'border-danger/50 bg-danger/10' : 'border-obsidian-600 bg-obsidian-850'}`}>
        <div className="text-xs uppercase tracking-widest text-ink-muted">Umpire’s decision · {what}</div>
        <div className={`font-display text-4xl font-bold uppercase ${out ? 'text-danger' : 'text-ink'}`}>{out ? 'Out' : 'Not out'}</div>
        {pe && <div className="mt-1 text-xs text-ink-muted">{findPlayer(state, pe.strikerId)?.name} · {pe.length} length, {pe.line} line · {pe.speed} km/h</div>}
      </div>
      <p className="text-sm">{needs.by === 'batting' ? 'You are batting: you may review the dismissal.' : 'You are fielding: you may review the not-out call.'} <b>{left}</b> review{left === 1 ? '' : 's'} left this innings.</p>
      <p className="text-xs text-ink-faint">A failed review costs one review; an overturn or “umpire’s call” keeps it. The verdict comes from the delivery’s recorded (simulated) tracking, not a fresh roll.</p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => act({ type: 'review', review: true })}>Review</button>
        <button className="btn-ghost flex-1" onClick={() => act({ type: 'review', review: false })}>Accept the decision</button>
      </div>
    </div>
  );
}

/** Broadcast-style DRS presentation, drawn from the delivery's recorded tracking or edge evidence. */
export function DrsPanel({ ev, state, onClose }: { ev: any; state: any; onClose: () => void }) {
  const r = ev.review;
  const { prefs } = usePrefs();
  const [stage, setStage] = useState(prefs.animations ? 0 : 3);
  useEffect(() => {
    if (!prefs.animations) return;
    const ts = [600, 1300, 2000].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [prefs.animations]);
  const out = !!ev.wicket;
  const batter = findPlayer(state, ev.strikerId);
  const verdict = r.overturned ? 'Overturned' : r.umpiresCall ? "Umpire's call" : 'Decision stands';
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-obsidian-950/95 p-4 backdrop-blur" role="dialog" aria-label="Decision review">
      <div className="flex items-center justify-between">
        <div className="kicker">DRS · {r.kind === 'caught-behind' ? 'Caught behind' : 'LBW'} · review by {r.by === 'batting' ? 'batting' : 'fielding'} side</div>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">Simulated evidence</span>
      </div>
      <div className="mt-2 min-h-0 flex-1">
        {r.kind === 'caught-behind' && ev.edge ? <EdgeViz edge={ev.edge} stage={stage} /> : ev.tracking ? <TrackingViz t={ev.tracking} hand={batter?.batHand ?? 'R'} stage={stage} /> : <p className="text-sm text-ink-muted">This older delivery has no recorded tracking.</p>}
      </div>
      {stage >= 3 && (
        <div className="rise mt-3 text-center">
          <div className={`font-display text-3xl font-bold uppercase ${out ? 'text-danger' : 'text-lime'}`}>{out ? 'Out' : 'Not out'} · {verdict}</div>
          <p className="text-sm text-ink-muted">{r.decisive}</p>
          <p className="text-xs text-ink-faint">{r.retained ? 'Review retained.' : 'Review lost.'}</p>
          <button className="btn-primary mt-3" onClick={onClose} autoFocus>Continue</button>
        </div>
      )}
    </div>
  );
}

const SH = 0.1143;
const IN_LINE = SH + 0.036;

function TrackingViz({ t, hand, stage }: { t: any; hand: 'R' | 'L'; stage: number }) {
  // Top-down strip: x across (off side right for a right-hander), distance from the stumps down the page.
  const W = 220;
  const H = 260;
  const sx = (x: number) => W / 2 + (hand === 'L' ? -x : x) * 260;
  const sy = (d: number) => H - 20 - d * 22;
  const pitch = t.pitch;
  const start = { x: pitch ? pitch.x * 1.4 : t.impact.x, d: 10.5 };
  const tag = (label: string, value: string, good: boolean | null) => (
    <div className="rounded-lg border border-obsidian-700 px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`text-sm font-semibold ${good === null ? 'text-warn' : good ? 'text-danger' : 'text-lime'}`}>{value}</div>
    </div>
  );
  const pitchedLabel = t.pitched === 'outside-leg' ? 'Outside leg' : t.pitched === 'outside-off' ? 'Outside off' : t.pitched === 'full-toss' ? 'Full toss' : 'In line';
  const impactLabel = t.impactZone === 'umpires-call' ? "Umpire's call" : t.impactZone === 'outside-off' ? 'Outside off' : t.impactZone === 'outside-leg' ? 'Outside leg' : 'In line';
  const wicketsLabel = t.wickets === 'umpires-call' ? "Umpire's call" : t.wickets === 'hitting' ? 'Hitting' : 'Missing';
  return (
    <div className="grid h-full gap-3 sm:grid-cols-[1fr_1fr]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full max-h-[300px] w-full" role="img" aria-label={`Ball tracking: pitched ${pitchedLabel}, impact ${impactLabel}, wickets ${wicketsLabel}`}>
        <rect x={sx(-1.5)} y={0} width={sx(1.5) - sx(-1.5)} height={H} fill="#b59a6a" opacity="0.25" />
        <rect x={Math.min(sx(-IN_LINE), sx(IN_LINE))} y={0} width={Math.abs(sx(IN_LINE) - sx(-IN_LINE))} height={H} fill="#4E7018" opacity="0.25" />
        <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="#F1F0E8" strokeWidth="1" />
        <rect x={Math.min(sx(-SH), sx(SH))} y={sy(0) - 3} width={Math.abs(sx(SH) - sx(-SH))} height={6} fill="#F1F0E8" />
        <text x={8} y={14} fontSize="9" fill="#A6B09F">{hand === 'L' ? 'OFF' : 'LEG'}</text>
        <text x={W - 8} y={14} fontSize="9" fill="#A6B09F" textAnchor="end">{hand === 'L' ? 'LEG' : 'OFF'}</text>
        {stage >= 1 && pitch && (
          <>
            <line x1={sx(start.x)} y1={sy(start.d)} x2={sx(pitch.x)} y2={sy(pitch.d)} stroke="#D9AE69" strokeWidth="3" opacity="0.9" />
            <circle cx={sx(pitch.x)} cy={sy(pitch.d)} r="5" fill={t.pitched === 'outside-leg' ? '#D97972' : '#C5F36B'} />
          </>
        )}
        {stage >= 2 && (
          <>
            <line x1={sx(pitch ? pitch.x : start.x)} y1={sy(pitch ? pitch.d : start.d)} x2={sx(t.impact.x)} y2={sy(t.impact.d)} stroke="#D9AE69" strokeWidth="3" />
            <circle cx={sx(t.impact.x)} cy={sy(t.impact.d)} r="5" fill={t.impactZone === 'in-line' ? '#C5F36B' : t.impactZone === 'umpires-call' ? '#D9AE69' : '#D97972'} />
          </>
        )}
        {stage >= 3 && (
          <>
            <line x1={sx(t.impact.x)} y1={sy(t.impact.d)} x2={sx(t.projected.x)} y2={sy(0)} stroke="#D9AE69" strokeWidth="3" strokeDasharray="4 3" />
            <circle cx={sx(t.projected.x)} cy={sy(0)} r="5" fill={t.wickets === 'hitting' ? '#D97972' : t.wickets === 'umpires-call' ? '#D9AE69' : '#C5F36B'} />
          </>
        )}
      </svg>
      <div className="flex flex-col gap-2">
        <svg viewBox="-0.35 -0.95 0.7 1.0" className="mx-auto h-36 w-auto" role="img" aria-label={`Projected path at the stumps: ${wicketsLabel}${t.missBy ? `, ${t.missBy}` : ''}`}>
          <rect x={-SH} y={-0.711} width={SH * 2} height={0.711} fill="none" stroke="#F1F0E8" strokeWidth="0.008" />
          {[-SH * 0.66, 0, SH * 0.66].map((x) => <line key={x} x1={x} x2={x} y1={-0.711} y2={0} stroke="#F1F0E8" strokeWidth="0.012" />)}
          <line x1={-0.35} x2={0.35} y1={0} y2={0} stroke="#A6B09F" strokeWidth="0.006" />
          {stage >= 3 && <circle cx={hand === 'L' ? -t.projected.x : t.projected.x} cy={-t.projected.z} r={0.036} fill={t.wickets === 'hitting' ? '#D97972' : t.wickets === 'umpires-call' ? '#D9AE69' : '#C5F36B'} opacity="0.9" />}
        </svg>
        <div className="grid grid-cols-3 gap-1.5">
          {tag('Pitching', pitchedLabel, stage >= 1 ? t.pitched !== 'outside-leg' : null)}
          {tag('Impact', stage >= 2 ? impactLabel : '…', stage >= 2 ? (t.impactZone === 'umpires-call' ? null : t.impactZone === 'in-line' || (t.impactZone === 'outside-off' && !t.shotOffered)) : null)}
          {tag('Wickets', stage >= 3 ? wicketsLabel : '…', stage >= 3 ? (t.wickets === 'umpires-call' ? null : t.wickets === 'hitting') : null)}
        </div>
        <p className="text-[11px] text-ink-faint">Impact height {Math.round(t.impact.z * 100)} cm{t.missBy && stage >= 3 ? ` · ${t.missBy}` : ''}. Red = supports out, lime = not out, amber = umpire’s call.</p>
      </div>
    </div>
  );
}

function EdgeViz({ edge, stage }: { edge: any; stage: number }) {
  const W = 300;
  const H = 120;
  const mid = W / 2;
  const amp = edge.spike === 'clear' ? 46 : edge.spike === 'small' ? 18 : 3;
  const pts = Array.from({ length: 120 }, (_, i) => {
    const x = (i / 119) * W;
    const noise = Math.sin(i * 1.7) * 2 + Math.sin(i * 0.6) * 1.5;
    const spike = Math.abs(x - mid) < 10 ? amp * Math.exp(-((x - mid) ** 2) / 30) * (i % 2 ? 1 : -1) : 0;
    const other = edge.otherNoise && Math.abs(x - (mid + 34)) < 8 ? 16 * (i % 2 ? 1 : -1) : 0;
    return `${x},${H / 2 - noise - spike - other}`;
  }).join(' ');
  return (
    <div className="space-y-2">
      <div className="text-xs text-ink-muted">Simulated edge detection — trace as the ball passes the bat</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Edge trace: ${edge.spike} spike as the ball passes the bat`}>
        <line x1={mid} x2={mid} y1={0} y2={H} stroke="#D9AE69" strokeDasharray="3 3" />
        <text x={mid + 4} y={12} fontSize="9" fill="#D9AE69">ball passes bat</text>
        {stage >= 1 && <polyline points={pts} fill="none" stroke="#C5F36B" strokeWidth="1.5" />}
      </svg>
      {stage >= 2 && (
        <div className="grid grid-cols-3 gap-1.5 text-center text-sm">
          <div className="rounded-lg border border-obsidian-700 p-1.5"><div className="text-[10px] uppercase text-ink-faint">Spike</div>{edge.spike}</div>
          <div className="rounded-lg border border-obsidian-700 p-1.5"><div className="text-[10px] uppercase text-ink-faint">Bat–ball gap</div>{edge.contact ? 'contact' : `${edge.gapCm} cm`}</div>
          <div className="rounded-lg border border-obsidian-700 p-1.5"><div className="text-[10px] uppercase text-ink-faint">Other sound</div>{edge.otherNoise ? 'bat on pad' : 'none'}</div>
        </div>
      )}
    </div>
  );
}
