import { AiCaptain } from '@kurciv/ai';
import { applyAction, createMatch, currentInnings, step, type Controllers, type DeliveryEvent, type MatchState, type Pending } from '@kurciv/simulation';
import type { LiveMatch } from './persistence';

export type StepMode = 'ball' | 'over' | 'key' | 'innings' | 'end';

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
  if (mode === 'end' && s.setup.userSide) {
    live.ctlTimeline.push({ fromSeq: s.seq, ctl: { home: 'ai', away: 'ai' } });
  }
  const events: DeliveryEvent[] = [];
  const startInnings = s.innings.length;
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 1500) {
    const r = step(s, controllersFor(s, live), AiCaptain);
    if (r.event) events.push(r.event);
    if (r.needs) return { events, needs: r.needs };
    const ev = r.event;
    if (!ev) continue;
    const inn = currentInnings(s)!;
    if (mode === 'ball') break;
    if (s.innings.length !== startInnings && mode !== 'end') break;
    const overDone = ev.legal && inn.legalBalls % 6 === 0 && inn.index === ev.innings;
    if (mode === 'over' && (overDone || inn.index !== ev.innings)) break;
    if (mode === 'key') {
      if (ev.wicket || ev.boundary === 6 || ev.chance || inn.index !== ev.innings) break;
      if (overDone && Math.floor(inn.legalBalls / 6) >= s.setup.rules.overs - 4) break;
      const wp = ev.winProbHome;
      const prev = events.length > 1 ? events[events.length - 2].winProbHome : wp;
      if (Math.abs(wp - prev) > 0.08) break;
    }
  }
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
