import { AiCaptain } from '@kurciv/ai';
import { applyAction, createMatch, currentInnings, step, type Controllers, type DeliveryEvent, type MatchState, type Pending } from '@kurciv/simulation';
import type { LiveMatch } from './persistence';

export type StepMode = 'toss' | 'ball' | 'over' | 'next-over' | 'key' | 'innings' | 'end';

export function controllersFor(state: MatchState, live: LiveMatch): Controllers {
  let ctl: Controllers = { home: 'ai', away: 'ai' };
  const u = state.setup.userSide;
  if (u) ctl = { ...ctl, [u]: 'manual' };
  for (const t of live.ctlTimeline) if (state.seq >= t.fromSeq) ctl = t.ctl;
  return ctl;
}

/**
 * Advances a live match. Every mode runs the same engine one delivery at a time; modes only
 * differ in where they pause. Pending decisions (toss, bowler, review) always pause.
 */
export function runSteps(live: LiveMatch, mode: StepMode): { events: DeliveryEvent[]; needs: Pending | null } {
  const s = live.state;
  const userSide = s.setup.userSide;
  const before = controllersFor(s, live);
  // Instant simulation: the assistant takes the decisions for the simulated stretch.
  if ((mode === 'end' || mode === 'innings') && userSide) {
    live.ctlTimeline.push({ fromSeq: s.seq, ctl: { home: 'ai', away: 'ai' } });
  }
  const events: DeliveryEvent[] = [];
  const startInnings = s.innings.length;
  // 'next-over' finishes the current over (if one is in progress) and then plays one more.
  const cur = currentInnings(s);
  let oversToFinish = mode === 'next-over' && cur && cur.legalBalls % 6 !== 0 && !cur.complete ? 2 : 1;
  let guard = 0;
  const restore = () => {
    if (mode === 'innings' && userSide && s.status !== 'complete') live.ctlTimeline.push({ fromSeq: s.seq, ctl: before });
  };
  while (s.status !== 'complete' && guard++ < 1500) {
    if (mode === 'toss' && s.status !== 'toss') break;
    const r = step(s, controllersFor(s, live), AiCaptain);
    if (r.event) events.push(r.event);
    if (r.needs) {
      restore();
      return { events, needs: r.needs };
    }
    const ev = r.event;
    if (!ev) continue;
    const inn = currentInnings(s)!;
    if (mode === 'ball') break;
    if (s.innings.length !== startInnings && mode !== 'end') break;
    const overDone = ev.legal && inn.legalBalls % 6 === 0 && inn.index === ev.innings;
    if ((mode === 'over' || mode === 'next-over') && (overDone || inn.index !== ev.innings)) {
      if (mode === 'next-over' && overDone && --oversToFinish > 0 && inn.index === ev.innings) continue;
      break;
    }
    if (mode === 'key') {
      if (ev.wicket || ev.boundary === 6 || ev.chance || inn.index !== ev.innings) break;
      if (overDone && Math.floor(inn.legalBalls / 6) >= s.setup.rules.overs - 4) break;
      const wp = ev.winProbHome;
      const prev = events.length > 1 ? events[events.length - 2].winProbHome : wp;
      if (Math.abs(wp - prev) > 0.08) break;
    }
  }
  restore();
  return { events, needs: s.pending };
}

/** Rebuilds a recorded match up to `fromSeq` for the Scenario Lab, re-using the logged decisions. */
export function rebuildTo(record: MatchState, fromSeq: number, timeline: LiveMatch['ctlTimeline']): MatchState {
  const s = createMatch(record.setup, record.seed);
  const log = record.actions.filter((a) => a.seq < fromSeq);
  const ctlAt = (seq: number): Controllers => {
    const u = record.setup.userSide;
    let c: Controllers = { home: 'ai', away: 'ai' };
    if (u) c = { ...c, [u]: 'manual' };
    for (const t of timeline) if (seq >= t.fromSeq) c = t.ctl;
    return c;
  };
  let guard = 0;
  while (s.status !== 'complete' && s.seq < fromSeq && guard++ < 3000) {
    while (log.length && log[0].seq === s.seq) {
      const res = applyAction(s, log[0].side, log[0].action);
      if (!res.ok) break;
      log.shift();
    }
    const r = step(s, ctlAt(s.seq), AiCaptain);
    if (r.needs) {
      const a = log.shift();
      if (!a) break;
      applyAction(s, a.side, a.action);
    }
  }
  return s;
}
