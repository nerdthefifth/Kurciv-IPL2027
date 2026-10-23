import { applyAction, createMatch, step, type Controllers, type LoggedAction, type MatchSetup, type MatchState } from '@kurciv/simulation';
import { AiCaptain } from './captain';

/** Instant simulation: same engine, same rules, AI (or assistant) making every decision. */
export function simulateMatch(setup: MatchSetup, seed: string, ctl: Controllers = { home: 'ai', away: 'ai' }): MatchState {
  const s = createMatch(setup, seed);
  return runToEnd(s, ctl);
}

export function runToEnd(s: MatchState, ctl: Controllers = { home: 'ai', away: 'ai' }): MatchState {
  let guard = 0;
  while (s.status !== 'complete') {
    const r = step(s, ctl, AiCaptain);
    if (r.needs) throw new Error(`Manual decision required (${r.needs.kind}) while simulating`);
    if (++guard > 20000) throw new Error('Match did not terminate');
  }
  return s;
}

/**
 * Rebuilds a match from its seed and the logged user actions. Each action is re-applied
 * at the delivery sequence where it was originally taken; an action that answered a
 * pending decision is applied once that decision comes up again. Stops early (returning
 * the paused state) if the log runs out while a decision is pending — i.e. a live match.
 * `controllerTimeline` lets callers reproduce mode switches (e.g. "simulate to end").
 */
export function replayMatch(
  setup: MatchSetup,
  seed: string,
  actions: LoggedAction[],
  ctl: Controllers,
  controllerTimeline: { fromSeq: number; ctl: Controllers }[] = [],
): MatchState {
  const r = createMatch(setup, seed);
  const log = [...actions];
  let guard = 0;
  const ctlAt = (seq: number) => {
    let c = ctl;
    for (const t of controllerTimeline) if (seq >= t.fromSeq) c = t.ctl;
    return c;
  };
  while (r.status !== 'complete' && guard++ < 5000) {
    while (log.length && log[0].seq === r.seq) {
      const res = applyAction(r, log[0].side, log[0].action);
      if (!res.ok) break; // answers a decision that has not been raised yet
      log.shift();
    }
    const res = step(r, ctlAt(r.seq), AiCaptain);
    if (res.needs) {
      if (!log.length) return r;
      const a = log.shift()!;
      const applied = applyAction(r, a.side, a.action);
      if (!applied.ok) throw new Error(`Replay diverged at seq ${r.seq}: ${applied.error}`);
    }
  }
  return r;
}
