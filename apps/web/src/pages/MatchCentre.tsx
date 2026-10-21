import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FieldPoint } from '@kurciv/domain';
import { ZONES } from '@kurciv/simulation';
import { BOWL_LABEL, api, dayLabel, overs, useApi } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Async, Badge, Card, Confirm, Empty, Kbd, Meter, Modal, PageHeader, Slider, Tabs } from '../components/ui';
import { FieldEditor } from '../components/FieldEditor';
import { Manhattan, WinProb, Worm } from '../components/charts';
import { Scorecard, ballChip, nameMap } from '../components/Scorecard';
import { OvrChip, PlayerName } from '../components/player';
import { PlanEditor } from './Tactics';

export function MatchCentrePage() {
  const career = useCareer();
  const live = useApi<any>(`/careers/${career.id}/match`, [career.tick]);
  return (
    <Async state={live}>
      {(d) => (d.live ? <LiveMatch slot="match" initial={d.live} /> : <PreMatch />)}
    </Async>
  );
}

// ------------------------------------------------------------------ pre-match

function PreMatch() {
  const career = useCareer();
  const o = career.overview.data;
  const nav = useNavigate();
  const fx = o?.nextFixture;
  const pre = useApi<any>(fx ? `/careers/${career.id}/prematch/${fx.id}` : null, [career.tick, fx?.id]);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!o) return null;
  if (!fx) {
    return (
      <>
        <PageHeader title="Match Centre" />
        <Empty title="No upcoming match">{o.phase === 'season' || o.phase === 'wcc' ? 'Your season is over — keep advancing to follow the rest of the world.' : 'Matches begin once the season starts.'}</Empty>
      </>
    );
  }
  const start = async () => {
    setBusy(true);
    const r = await career.mutate('/match/start', { fixtureId: fx.id });
    setBusy(false);
    if (r) career.refresh();
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Match Centre" subtitle={`${fx.competition} · ${fx.stage} · ${dayLabel(o.season, fx.day)}`} />
      <Async state={pre}>
        {(p) => (
          <div className="space-y-5">
            <div className="card relative overflow-hidden p-6">
              <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(110deg, ${p.user.colors[0]} 0%, transparent 45%, transparent 55%, ${p.opponent.colors[0]} 100%)` }} aria-hidden />
              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div className="font-display text-4xl font-bold uppercase leading-none md:text-5xl">
                  {fx.homeName} <span className="text-ink-faint">v</span> {fx.awayName}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.today ? (
                    <>
                      <button className="btn-primary" disabled={busy} onClick={start}>▶ Play live</button>
                      <button className="btn-ghost" disabled={busy} onClick={() => setQuick(true)}>Quick simulate</button>
                    </>
                  ) : (
                    <Badge tone="info">Advance to match day ({dayLabel(o.season, fx.day)}) with Continue</Badge>
                  )}
                </div>
              </div>
              <p className="relative mt-2 text-sm text-ink-muted">{p.venue.name}, {p.venue.city}{p.headToHead ? ` · Head-to-head ${p.headToHead.record[p.user.id] ?? 0}–${p.headToHead.record[p.opponent.id] ?? 0} in ${p.headToHead.meetings} meetings` : ''}</p>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Pitch & conditions">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Surface</dt><dd className="capitalize">{p.venue.pitch.kind}</dd>
                  <dt className="text-ink-muted">Batting</dt><dd>{p.venue.pitch.batting > 0.3 ? 'Very good' : p.venue.pitch.batting > 0 ? 'Good' : 'Tricky'}</dd>
                  <dt className="text-ink-muted">Help for seam</dt><dd>{p.venue.pitch.pace > 0.3 ? 'Significant' : p.venue.pitch.pace > 0 ? 'Some' : 'Little'}</dd>
                  <dt className="text-ink-muted">Help for spin</dt><dd>{p.venue.pitch.spin > 0.3 ? 'Significant' : p.venue.pitch.spin > 0 ? 'Some' : 'Little'}{p.venue.pitch.wear > 0.3 ? ', more later' : ''}</dd>
                  <dt className="text-ink-muted">Dew risk</dt><dd>{Math.round(p.venue.dewChance * 100)}% (evening)</dd>
                  <dt className="text-ink-muted">Boundaries</dt><dd>{p.venue.boundaryStraight} m straight · {p.venue.boundarySquare} m square</dd>
                  {p.venue.altitude > 300 && <><dt className="text-ink-muted">Altitude</dt><dd>{p.venue.altitude} m — ball carries further</dd></>}
                </dl>
              </Card>
              <Card title="Cricket Intelligence Room" className="xl:col-span-2" actions={<Link to={`/c/${career.id}/club/${p.opponent.id}`} className="text-xs text-lime">Opponent dossier</Link>}>
                <ul className="space-y-2">
                  {p.intel.recommendations.map((r: any, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Badge tone={r.confidence === 'high' ? 'lime' : r.confidence === 'medium' ? 'info' : 'muted'}>{r.confidence}</Badge>
                      <span><b>{r.text}</b> <span className="text-ink-muted">{r.evidence}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-faint">Based on {p.intel.matches} recorded matches. These are probabilistic tendencies, not certainties.</p>
              </Card>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Card title={`Your XI${p.lineupSaved ? ' (saved lineup)' : ' (assistant’s pick)'}`} actions={<Link to={`/c/${career.id}/squad`} className="text-xs text-lime">Change</Link>}>
                {p.userXINote && <p className="mb-2 text-xs text-warn">{p.userXINote}</p>}
                <XIList players={p.userXI} />
              </Card>
              <Card title={`${p.opponent.name} — predicted XI`}>
                <XIList players={p.opponentXI} />
              </Card>
            </div>
          </div>
        )}
      </Async>
      <Confirm
        open={quick}
        title="Quick simulate?"
        body="The full ball-by-ball engine plays the match instantly, with your assistant making decisions from your saved XI and tactics. You can review the full scorecard afterwards."
        confirmLabel="Simulate"
        onClose={() => setQuick(false)}
        onConfirm={async () => {
          const r = await career.mutate<any>('/match/quick', { fixtureId: fx.id }, { success: 'Match simulated.' });
          if (r?.fixture) nav(`/c/${career.id}/fixtures/${r.fixture.id}`);
        }}
      />
    </div>
  );
}

function XIList({ players }: { players: any[] }) {
  return (
    <ol className="space-y-1 text-sm">
      {players.map((p, i) => (
        <li key={p.id} className="flex items-center gap-2">
          <span className="num w-5 text-ink-faint">{i + 1}</span>
          <PlayerName p={p} className="flex-1 truncate" />
          <span className="text-[11px] text-ink-faint">{p.role}{p.overseas ? ' · OS' : ''}</span>
          <OvrChip p={p} />
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ live match

export function LiveMatch({ slot, initial }: { slot: 'match' | 'lab'; initial: any }) {
  const career = useCareer();
  const toast = useToast();
  const nav = useNavigate();
  const base = `/careers/${career.id}/${slot}`;
  const [version, setVersion] = useState<number>(initial.version);
  const [state, setState] = useState<any>(initial.state);
  const [deliveries, setDeliveries] = useState<any[]>(initial.state.deliveries);
  const [needs, setNeeds] = useState<any>(initial.state.pending);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'live' | 'card' | 'charts' | 'analysis'>('live');
  const [planOpen, setPlanOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const lastSeq = deliveries.length ? deliveries[deliveries.length - 1].seq : 0;

  const apply = useCallback((r: any) => {
    setVersion(r.version);
    const { deliveries: fresh, ...rest } = r.state;
    setState(rest);
    setNeeds(r.needs ?? rest.pending);
    if (fresh?.length) {
      setDeliveries((d) => [...d, ...fresh.filter((x: any) => !d.some((y) => y.seq === x.seq))]);
      const last = fresh[fresh.length - 1];
      setFlash(last.wicket ? 'wicket' : last.boundary === 6 ? 'six' : last.boundary === 4 ? 'four' : null);
    }
  }, []);

  const resync = useCallback(async () => {
    const r = await api<any>(base);
    if (r.live) {
      setVersion(r.live.version);
      setDeliveries(r.live.state.deliveries);
      const { deliveries: _d, ...rest } = r.live.state;
      setState(rest);
      setNeeds(rest.pending);
    }
  }, [base]);

  const step = useCallback(async (mode: string) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await api(`${base}/step`, { body: { mode, version, since: lastSeq } }));
    } catch (e) {
      toast.push('error', (e as Error).message);
      await resync();
    } finally {
      setBusy(false);
    }
  }, [busy, base, version, lastSeq, apply, toast, resync]);

  const act = useCallback(async (action: any, success?: string) => {
    setBusy(true);
    try {
      const r = await api<any>(`${base}/action`, { body: { action, version, since: lastSeq } });
      apply(r);
      for (const w of r.warnings ?? []) toast.push(w.startsWith('ILLEGAL') ? 'error' : 'info', w);
      if (success) toast.push('ok', success);
      return true;
    } catch (e) {
      toast.push('error', (e as Error).message);
      await resync();
      return false;
    } finally {
      setBusy(false);
    }
  }, [base, version, lastSeq, apply, toast, resync]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.getAttribute('role') === 'slider' || needs || state.status === 'complete') return;
      if (e.key === ' ' || e.key === 'b') { e.preventDefault(); step('ball'); }
      if (e.key === 'o') step('over');
      if (e.key === 'k') step('key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, needs, state.status]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  const names = useMemo(() => nameMap(state), [state]);
  const userSide: 'home' | 'away' | null = state.setup.userSide;
  const inn = state.innings[state.innings.length - 1];
  const userBatting = inn && userSide === inn.battingSide;
  const userBowling = inn && userSide === inn.bowlingSide;
  const innDeliveries = deliveries.filter((d) => inn && d.innings === inn.index);
  const last = deliveries[deliveries.length - 1];
  const striker = inn ? state.setup[inn.battingSide].xi.find((p: any) => p.id === inn.strikerId) : null;

  const finish = async () => {
    if (slot === 'lab') {
      await api(`/careers/${career.id}/lab`, { method: 'DELETE' });
      career.refresh();
      return;
    }
    const r = await career.mutate<any>('/match/finish', {}, { success: 'Result recorded.' });
    if (r?.fixture) nav(`/c/${career.id}/fixtures/${r.fixture.id}`);
  };

  return (
    <div className="space-y-4">
      {slot === 'lab' && <div className="rounded-lg border border-info/40 bg-info/10 px-4 py-2 text-sm text-info">Scenario Lab — an experimental replay. Nothing here changes your career.</div>}
      <Scoreboard state={state} names={names} last={last} flash={flash} deliveries={deliveries} />

      {state.status === 'complete' ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="label">Result</div>
              <div className="font-display text-3xl font-bold uppercase">{state.result.winner ? `${state.setup[state.result.winner].name} ${state.result.margin}` : state.result.margin}</div>
              {state.result.playerOfMatch && <div className="text-sm text-ink-muted">Player of the match: {names[state.result.playerOfMatch]?.name}</div>}
            </div>
            <button className="btn-primary" onClick={finish}>{slot === 'lab' ? 'Close the lab' : 'Confirm result & continue'}</button>
          </div>
        </Card>
      ) : (
        <div className="card sticky top-[58px] z-10 flex flex-wrap items-center gap-2 p-2">
          <button className="btn-primary" disabled={busy || !!needs} onClick={() => step('ball')}>Next ball <Kbd>Space</Kbd></button>
          <button className="btn-ghost" disabled={busy || !!needs} onClick={() => step('over')}>Next over <Kbd>O</Kbd></button>
          <button className="btn-ghost" disabled={busy || !!needs} onClick={() => step('key')}>Key moments <Kbd>K</Kbd></button>
          <button className="btn-ghost" disabled={busy || !!needs} onClick={() => step('innings')}>End of innings</button>
          <button className="btn-ghost" disabled={busy || !!needs} onClick={() => step('end')} title="Your assistant takes every remaining decision">Simulate to end</button>
          {busy && <span className="text-xs text-ink-muted">Bowling…</span>}
          <div className="ml-auto flex gap-1">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'live', label: 'Live' }, { id: 'card', label: 'Scorecard' }, { id: 'charts', label: 'Charts' }, { id: 'analysis', label: 'Overs' }]} />
          </div>
        </div>
      )}

      {tab === 'live' && inn && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <LiveField state={state} inn={inn} editable={!!userBowling && state.status !== 'complete'} last={last} striker={striker} onApply={(positions, keeperUp, name) => act({ type: 'field', positions, keeperUp, name }, 'Field set.')} onMirror={(v) => act({ type: 'mirror', value: v })} busy={busy} />
            {userBowling && state.status !== 'complete' && (
              <Card title="Bowling" actions={<button className="btn-ghost text-xs" onClick={() => setPlanOpen(true)}>Bowling plan</button>}>
                <BowlerQueue state={state} inn={inn} names={names} onQueue={(id) => act({ type: 'bowler', playerId: id }, 'Bowler lined up for the next over.')} />
              </Card>
            )}
            {userBatting && state.status !== 'complete' && <BattingControls state={state} inn={inn} names={names} act={act} />}
          </div>
          <div className="space-y-4">
            <PressurePanel last={last} names={names} />
            <Commentary deliveries={deliveries} names={names} />
          </div>
        </div>
      )}
      {tab === 'card' && <Card><Scorecard state={state} /></Card>}
      {tab === 'charts' && <MatchCharts state={state} deliveries={deliveries} />}
      {tab === 'analysis' && <OverAnalysis state={state} names={names} />}

      {needs && state.status !== 'complete' && <DecisionDialog needs={needs} state={state} names={names} act={act} />}
      {planOpen && inn && (
        <PlanModal plan={inn.plan} onClose={() => setPlanOpen(false)} onSave={async (plan) => { if (await act({ type: 'plan', plan }, 'Bowling plan updated.')) setPlanOpen(false); }} />
      )}
    </div>
  );
}

function Scoreboard({ state, names, last, flash, deliveries }: { state: any; names: any; last: any; flash: string | null; deliveries: any[] }) {
  const inn = state.innings[state.innings.length - 1];
  if (!inn) {
    return (
      <div className="card p-5">
        <div className="font-display text-3xl font-bold uppercase">{state.setup.home.name} v {state.setup.away.name}</div>
        <p className="text-sm text-ink-muted">{state.setup.venue.name} · Toss: {state.setup[state.toss.winner].name} won{state.toss.decision ? ` and chose to ${state.toss.decision}` : ''}</p>
      </div>
    );
  }
  const bat = state.setup[inn.battingSide];
  const bowlTeam = state.setup[inn.bowlingSide];
  const rr = inn.legalBalls ? ((inn.runs / inn.legalBalls) * 6).toFixed(2) : '0.00';
  const need = inn.target !== null ? inn.target - inn.runs : null;
  const left = inn.maxBalls - inn.legalBalls;
  const rrr = need !== null && left > 0 ? ((need / left) * 6).toFixed(2) : null;
  const first = state.innings.find((i: any) => i.index === inn.index - 1);
  const s = inn.batters[inn.strikerId];
  const ns = inn.batters[inn.nonStrikerId];
  const bw = inn.currentBowlerId ? inn.bowlers[inn.currentBowlerId] : last && inn.bowlers[last.bowlerId];
  // Balls of the over in progress (or the over just completed).
  const overNo = inn.legalBalls % 6 === 0 && inn.legalBalls > 0 && !inn.currentBowlerId ? inn.legalBalls / 6 - 1 : Math.floor(inn.legalBalls / 6);
  const overBalls = deliveries.filter((d) => d.innings === inn.index && d.over === overNo);
  const wp = last?.winProbHome ?? 0.5;
  return (
    <div className={`card overflow-hidden ${flash === 'wicket' ? 'flash' : ''}`} aria-live="polite">
      <div className="grid gap-4 p-4 md:grid-cols-[1.2fr_1fr_1fr] md:p-5">
        <div>
          <div className="label flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: bat.colors[0] }} aria-hidden /> {bat.name} batting {inn.superOver && <Badge tone="warn">Super Over</Badge>}
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className={`num text-5xl font-bold ${flash === 'six' || flash === 'four' ? 'text-lime' : ''}`}>{inn.runs}/{inn.wickets}</span>
            <span className="num text-xl text-ink-muted">{overs(inn.legalBalls)} <span className="text-sm">ov</span></span>
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            RR {rr}
            {need !== null && <> · Need <b className="text-ink">{Math.max(0, need)}</b> off {left} · RRR {rrr}</>}
            {first && !inn.superOver && <> · {state.setup[first.battingSide].shortName} {first.runs}/{first.wickets}</>}
            {inn.freeHit && <> · <Badge tone="warn">Free hit</Badge></>}
          </div>
        </div>
        <div className="space-y-1 text-sm">
          {[{ b: s, id: inn.strikerId, on: true }, { b: ns, id: inn.nonStrikerId, on: false }].map((x) => x.b && (
            <div key={x.id} className="flex items-center justify-between gap-2">
              <span className={x.on ? 'font-semibold text-ink' : 'text-ink-muted'}>{names[x.id]?.shortName}{x.on ? ' *' : ''}</span>
              <span className="num">{x.b.runs} <span className="text-ink-muted">({x.b.balls})</span></span>
            </div>
          ))}
          {bw && (
            <div className="flex items-center justify-between gap-2 border-t border-obsidian-700 pt-1 text-ink-muted">
              <span>{names[bw.playerId]?.shortName} ({bowlTeam.shortName})</span>
              <span className="num">{bw.wickets}-{bw.runs} ({overs(bw.balls)})</span>
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-ink-muted"><span>{state.setup.home.shortName}</span><span>Win probability</span><span>{state.setup.away.shortName}</span></div>
          <div className="flex h-3 overflow-hidden rounded-full bg-obsidian-700" role="meter" aria-label={`Win probability ${state.setup.home.shortName} ${Math.round(wp * 100)}%`} aria-valuenow={Math.round(wp * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="bg-lime" style={{ width: `${wp * 100}%` }} />
            <div className="flex-1 bg-info/70" />
          </div>
          <div className="mt-1 flex justify-between text-xs"><span className="num">{Math.round(wp * 100)}%</span><span className="num">{Math.round((1 - wp) * 100)}%</span></div>
          <div className="mt-2 text-xs text-ink-muted">{state.setup.venue.name}{state.dew && inn.index % 2 === 1 ? ' · dew is settling' : ''}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1" aria-label={`Over ${overNo + 1}: ${overBalls.map((d) => ballChip(d).text).join(' ')}`}>
            <span className="mr-1 text-xs text-ink-faint">Over {overNo + 1}</span>
            {overBalls.map((d) => {
              const c = ballChip(d);
              return <span key={d.seq} className={`num flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1 text-xs font-bold ${c.tone}`}>{c.text}</span>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveField({ state, inn, editable, last, striker, onApply, onMirror, busy }: { state: any; inn: any; editable: boolean; last: any; striker: any; onApply: (p: FieldPoint[], keeperUp: boolean, name: string) => void; onMirror: (v: boolean) => void; busy: boolean }) {
  const [draft, setDraft] = useState<FieldPoint[]>(inn.field.positions);
  const [keeperUp, setKeeperUp] = useState<boolean>(inn.field.keeperUp);
  const [showZones, setShowZones] = useState(true);
  const fieldKey = JSON.stringify(inn.field.positions) + inn.field.keeperUp;
  useEffect(() => {
    setDraft(inn.field.positions);
    setKeeperUp(inn.field.keeperUp);
  }, [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(inn.field.positions) || keeperUp !== inn.field.keeperUp;
  const powerplay = !inn.superOver && Math.floor(inn.legalBalls / 6) < state.setup.rules.powerplayOvers;
  const userSide = state.setup.userSide;
  const templates = userSide ? state.setup[userSide].fields : [];
  const lastBall = last && last.innings === inn.index ? { end: last.end, boundary: last.boundary, wicket: !!last.wicket, aerial: last.aerial } : null;
  return (
    <Card title={`Field — ${inn.field.name}`} actions={
      <>
        <label className="flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" className="accent-[#c6ff1a]" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Scoring zones</label>
        {editable && <label className="flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" className="accent-[#c6ff1a]" checked={inn.mirror} onChange={(e) => onMirror(e.target.checked)} disabled={busy} /> Mirror for LHB</label>}
      </>
    }>
      <FieldEditor
        positions={draft}
        onChange={editable ? setDraft : undefined}
        venue={state.setup.venue}
        powerplay={powerplay}
        hand={striker?.batHand ?? 'R'}
        mirrorForLeft={inn.mirror}
        keeperUp={keeperUp}
        zoneRuns={showZones ? inn.zoneRuns : undefined}
        lastBall={lastBall}
        label="Live field"
      />
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="input max-w-[220px]" aria-label="Load a field template" value="" onChange={(e) => {
            const t = templates.find((x: any) => x.id === e.target.value);
            if (t) { setDraft(t.positions); setKeeperUp(t.keeperUp); }
          }}>
            <option value="">Load template…</option>
            {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" className="accent-[#c6ff1a]" checked={keeperUp} onChange={(e) => setKeeperUp(e.target.checked)} /> Keeper up</label>
          <button className="btn-primary" disabled={!dirty || busy} onClick={() => onApply(draft, keeperUp, 'Custom field')}>Apply field</button>
          <button className="btn-ghost" disabled={!dirty} onClick={() => { setDraft(inn.field.positions); setKeeperUp(inn.field.keeperUp); }}>Undo</button>
        </div>
      )}
      {!editable && <p className="mt-2 text-xs text-ink-faint">Opposition field (read-only). The AI captain adjusts it each over and moves boundary riders into zones you are scoring in.</p>}
    </Card>
  );
}

function BowlerQueue({ state, inn, names, onQueue }: { state: any; inn: any; names: any; onQueue: (id: string) => void }) {
  const xi = state.setup[inn.bowlingSide].xi.filter((p: any) => p.bowlType !== 'NONE' && p.id !== state.setup[inn.bowlingSide].keeperId);
  return (
    <div className="space-y-2">
      <table className="table">
        <thead><tr><th>Bowler</th><th>Type</th><th className="text-right">Figures</th><th className="text-right">Spell</th><th></th></tr></thead>
        <tbody>
          {xi.map((p: any) => {
            const b = inn.bowlers[p.id];
            const done = b && b.balls >= state.setup.rules.maxBowlerOvers * 6;
            return (
              <tr key={p.id}>
                <td>{names[p.id].shortName} {inn.currentBowlerId === p.id && <Badge tone="lime">bowling</Badge>} {inn.queuedBowlerId === p.id && <Badge tone="info">next</Badge>}</td>
                <td className="text-xs text-ink-muted">{p.bowlType}</td>
                <td className="num text-right">{b ? `${overs(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}` : '—'}</td>
                <td className="text-right"><Meter value={b?.spellFatigue ?? 0} max={30} invert compact /></td>
                <td className="text-right">
                  <button className="btn-ghost px-2 py-0.5 text-xs" disabled={done || inn.lastOverBowlerId === p.id && !inn.currentBowlerId} onClick={() => onQueue(p.id)}>Next over</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-ink-faint">Max {state.setup.rules.maxBowlerOvers} overs each, no consecutive overs. Spell fatigue lowers control and pace.</p>
    </div>
  );
}

function BattingControls({ state, inn, names, act }: { state: any; inn: any; names: any; act: (a: any, s?: string) => Promise<boolean> }) {
  const team = state.setup[inn.battingSide];
  const phase = inn.superOver ? 'death' : Math.floor(inn.legalBalls / 6) < 6 ? 'powerplay' : Math.floor(inn.legalBalls / 6) >= 15 ? 'death' : 'middle';
  const def = team.tactics.phaseIntent[phase];
  const [teamIntent, setTeamIntent] = useState<number>(inn.intent ?? def);
  const strikerIntent = inn.batterIntent[inn.strikerId];
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
  return (
    <Card title="Batting">
      <div className="space-y-4">
        <div>
          <Slider label={`Team intent (${phase} default ${Math.round(def * 100)})`} value={teamIntent} onChange={setTeamIntent} format={(v) => `${Math.round(v * 100)}`} left="Rotate & protect" right="All-out attack" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary py-1 text-xs" onClick={() => act({ type: 'intent', value: teamIntent }, 'Batting intent set.')}>Apply</button>
            <button className="btn-ghost py-1 text-xs" onClick={() => { setTeamIntent(def); act({ type: 'intent', value: null }, 'Back to phase defaults.'); }}>Use phase default</button>
            <span className="self-center text-xs text-ink-muted">Current: {inn.intent === null ? 'phase default' : Math.round(inn.intent * 100)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Striker {names[inn.strikerId]?.shortName}:</span>
          {[['Defend', 0.15], ['Rotate', 0.35], ['Attack', 0.7], ['Slog', 0.92]].map(([l, v]) => (
            <button key={l as string} className={`btn-ghost px-2 py-1 text-xs ${strikerIntent === v ? 'border-lime text-lime' : ''}`} onClick={() => act({ type: 'intent', value: v, batterId: inn.strikerId }, `${names[inn.strikerId]?.shortName}: ${l}`)}>{l}</button>
          ))}
          {strikerIntent !== undefined && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => act({ type: 'intent', value: null, batterId: inn.strikerId })}>Clear</button>}
        </div>
        {order.length > 0 && (
          <div>
            <div className="label mb-1">Batting order (yet to bat)</div>
            <ol className="space-y-1">
              {order.map((id, i) => (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <span className="num w-5 text-ink-faint">{inn.order.length - order.length + i + 1}</span>
                  <span className="flex-1">{names[id]?.name}</span>
                  <button className="btn-ghost px-1.5 py-0 text-xs" aria-label={`Promote ${names[id]?.name}`} onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                  <button className="btn-ghost px-1.5 py-0 text-xs" aria-label={`Demote ${names[id]?.name}`} onClick={() => move(i, 1)} disabled={i === order.length - 1}>▼</button>
                </li>
              ))}
            </ol>
            <button className="btn-ghost mt-2 py-1 text-xs" disabled={order.join() === remaining.join()} onClick={() => act({ type: 'order', order }, 'Batting order updated.')}>Confirm order</button>
          </div>
        )}
      </div>
    </Card>
  );
}

function PressurePanel({ last, names }: { last: any; names: any }) {
  if (!last) return null;
  return (
    <Card title="Pressure gauge">
      <div className="grid grid-cols-2 gap-4">
        <div><Meter label={`Batter · ${names[last.strikerId]?.shortName}`} value={Math.round(last.pressure.batter * 100)} invert /></div>
        <div><Meter label={`Bowler · ${names[last.bowlerId]?.shortName}`} value={Math.round(last.pressure.bowler * 100)} invert /></div>
      </div>
      {last.pressure.reasons.length > 0 && <p className="mt-2 text-xs text-ink-muted">{last.pressure.reasons.join(' · ')}</p>}
    </Card>
  );
}

function Commentary({ deliveries, names }: { deliveries: any[]; names: any }) {
  const recent = deliveries.slice(-80).reverse();
  void names;
  return (
    <Card title="Ball-by-ball" pad={false}>
      {recent.length ? (
        <ol className="max-h-[560px] divide-y divide-obsidian-800 overflow-y-auto">
          {recent.map((d) => {
            const chip = ballChip(d);
            return (
              <li key={d.seq} className={`flex gap-3 px-4 py-2.5 text-sm ${d.wicket ? 'bg-danger/5' : d.boundary === 6 ? 'bg-lime/5' : ''}`}>
                <span className="num w-9 shrink-0 text-ink-muted">{d.over}.{d.legal ? d.ball : d.ball + 1}</span>
                <span className={`num flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded px-1 text-xs font-bold ${chip.tone}`} aria-hidden>{chip.text}</span>
                <span className="min-w-0">
                  {d.commentary}
                  {d.review && <span className="block text-xs text-info">DRS: review by {d.review.by} side — {d.review.overturned ? 'overturned' : 'decision stands'}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : <p className="p-4 text-sm text-ink-muted">The umpires are walking out…</p>}
    </Card>
  );
}

function OverAnalysis({ state, names }: { state: any; names: any }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {state.innings.filter((i: any) => i.overs.length).map((inn: any) => (
        <Card key={inn.index} title={`${state.setup[inn.battingSide].shortName} innings — tactical analysis`}>
          <ol className="space-y-2">
            {[...inn.overs].reverse().map((o: any) => (
              <li key={o.over} className="rounded-lg border border-obsidian-700 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>Over {o.over + 1}</b> · {names[o.bowlerId]?.shortName} · <span className="text-ink-muted">{o.fieldName}</span></span>
                  <span className="num">{o.runs} runs{o.wickets ? `, ${o.wickets} wkt` : ''}</span>
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  Dots {o.dots} · singles {o.singles} · boundaries {o.boundaries} · extras {o.extras} · runs saved ≈{o.runsSaved}
                  {o.chances ? ` · chances ${o.chances}${o.dropped ? ` (${o.dropped} dropped)` : ''}` : ''}
                </div>
                {o.zoneRuns.some((z: number) => z > 0) && (
                  <div className="mt-1 text-xs text-ink-faint">By zone: {o.zoneRuns.map((z: number, i: number) => (z ? `${ZONES[i]} ${z}` : null)).filter(Boolean).join(', ')}</div>
                )}
                {o.analysis.length > 0 && <ul className="mt-1 text-xs text-lime">{o.analysis.map((a: string) => <li key={a}>▸ {a}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </Card>
      ))}
      {!state.innings.some((i: any) => i.overs.length) && <Empty title="No overs completed yet" />}
    </div>
  );
}

export function MatchCharts({ state, deliveries }: { state: any; deliveries: any[] }) {
  const main = state.innings.filter((i: any) => !i.superOver);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Worm"><Worm innings={main.map((i: any) => i.overRuns)} labels={main.map((i: any) => state.setup[i.battingSide].shortName)} /></Card>
      <Card title="Win probability"><WinProb points={[0.5, ...deliveries.map((d) => d.winProbHome)]} home={state.setup.home.shortName} away={state.setup.away.shortName} /></Card>
      {main.map((inn: any) => (
        <Card key={inn.index} title={`Manhattan — ${state.setup[inn.battingSide].shortName}`}><Manhattan runs={inn.overRuns} wickets={inn.overWickets} label={state.setup[inn.battingSide].name} /></Card>
      ))}
      {main.map((inn: any) => (
        <Card key={`w${inn.index}`} title={`Wagon wheel — ${state.setup[inn.battingSide].shortName}`}>
          <FieldEditor positions={inn.field.positions} venue={state.setup.venue} showValidation={false} wagon={deliveries.filter((d) => d.innings === inn.index && d.end && d.batRuns + (d.boundary ?? 0) >= 0 && d.shot && d.contact !== 'miss').map((d) => ({ end: d.end, runs: d.batRuns }))} label="Wagon wheel" />
          <p className="mt-1 text-xs text-ink-muted">Lime = six, blue = four, white = runs, grey = dot. Shown from the right-hander’s view.</p>
        </Card>
      ))}
    </div>
  );
}

function DecisionDialog({ needs, state, names, act }: { needs: any; state: any; names: any; act: (a: any, s?: string) => Promise<boolean> }) {
  if (needs.kind === 'toss') {
    return (
      <Modal open title="You won the toss" onClose={() => {}} required>
        <p className="text-sm text-ink-muted">{state.setup.venue.name}: {state.setup.venue.pitch.kind} pitch, dew chance {Math.round(state.setup.venue.dewChance * 100)}%{state.setup.evening ? ' (evening match)' : ''}.</p>
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" onClick={() => act({ type: 'toss', decision: 'bat' })}>Bat first</button>
          <button className="btn-primary flex-1" onClick={() => act({ type: 'toss', decision: 'bowl' })}>Bowl first</button>
        </div>
      </Modal>
    );
  }
  if (needs.kind === 'review') {
    return (
      <Modal open title="Decision review" onClose={() => {}} required>
        <p className="text-sm">{needs.reason}</p>
        <p className="mt-2 text-xs text-ink-muted">An unsuccessful review costs one of your reviews; a correct one is kept.</p>
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" onClick={() => act({ type: 'review', review: true })}>Review</button>
          <button className="btn-ghost flex-1" onClick={() => act({ type: 'review', review: false })}>Accept the decision</button>
        </div>
      </Modal>
    );
  }
  // bowler
  const inn = state.innings[state.innings.length - 1];
  const xi = state.setup[inn.bowlingSide].xi;
  const striker = state.setup[inn.battingSide].xi.find((p: any) => p.id === inn.strikerId);
  return (
    <Modal open title={`Choose the bowler for over ${Math.floor(inn.legalBalls / 6) + 1}`} onClose={() => {}} required wide>
      <p className="mb-3 text-sm text-ink-muted">
        On strike: <b className="text-ink">{striker?.name}</b> ({striker?.batHand === 'L' ? 'left' : 'right'}-handed) · {inn.runs}/{inn.wickets} after {overs(inn.legalBalls)}
        {inn.observed.pace.balls > 0 && <> · their batters v pace {(inn.observed.pace.runs / inn.observed.pace.balls * 6).toFixed(1)} rpo, v spin {inn.observed.spin.balls ? (inn.observed.spin.runs / inn.observed.spin.balls * 6).toFixed(1) : '—'} rpo</>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {needs.eligible.map((id: string) => {
          const p = xi.find((x: any) => x.id === id);
          const b = inn.bowlers[id];
          const sug = id === needs.suggestion;
          return (
            <button key={id} onClick={() => act({ type: 'bowler', playerId: id })} className={`rounded-lg border p-3 text-left transition hover:border-lime ${sug ? 'border-lime/60 bg-lime/5' : 'border-obsidian-700'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.name}</span>
                {sug && <Badge tone="lime">Assistant’s pick</Badge>}
              </div>
              <div className="text-xs text-ink-muted">{BOWL_LABEL[p.bowlType]} · control {Math.round(p.attrs.bowl.control)} · death {Math.round(p.attrs.bowl.death)}</div>
              <div className="mt-1 text-xs">{b ? `${overs(b.balls)} ov, ${b.runs} runs, ${b.wickets} wkt` : 'Yet to bowl'}{b?.spellFatigue > 8 ? ' · tiring' : ''}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-faint">Only bowlers with overs left who did not bowl the previous over are shown. {names[needs.suggestion]?.shortName} is suggested from matchups, conditions, fatigue and death-over planning.</p>
    </Modal>
  );
}

function PlanModal({ plan, onClose, onSave }: { plan: any; onClose: () => void; onSave: (p: any) => void }) {
  const [p, setP] = useState(plan);
  return (
    <Modal open title="Bowling plan" onClose={onClose} wide>
      <PlanEditor plan={p} onChange={setP} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(p)}>Apply plan</button>
      </div>
    </Modal>
  );
}
