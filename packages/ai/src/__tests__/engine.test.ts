import { describe, expect, it } from 'vitest';
import { BUILT_IN_FIELDS, applyAction, createMatch, step, validateField, type Captain, type MatchState } from '@kurciv/simulation';
import { AiCaptain } from '../captain';
import { replayMatch, runToEnd, simulateMatch } from '../runner';
import { setup } from './fixtures';

const strip = (s: MatchState) => JSON.stringify({ d: s.deliveries, r: s.result });

describe('match engine', () => {
  it('is deterministic for a given seed', () => {
    const a = simulateMatch(setup(), 'seed-1');
    const b = simulateMatch(setup(), 'seed-1');
    const c = simulateMatch(setup(), 'seed-2');
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
  });

  it('scorecards agree with the delivery log', () => {
    for (let i = 0; i < 20; i++) {
      const s = simulateMatch(setup(), `card-${i}`);
      for (const inn of s.innings) {
        const evs = s.deliveries.filter((d) => d.innings === inn.index);
        expect(evs.reduce((a, d) => a + d.totalRuns, 0)).toBe(inn.runs);
        expect(evs.filter((d) => d.wicket).length).toBe(inn.wickets);
        expect(evs.filter((d) => d.legal).length).toBe(inn.legalBalls);
        const batRuns = Object.values(inn.batters).reduce((a, b) => a + b.runs, 0);
        const extras = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
        expect(batRuns + extras).toBe(inn.runs);
        const bowled = Object.values(inn.bowlers).reduce((a, b) => a + b.balls, 0);
        expect(bowled).toBe(inn.legalBalls);
        for (const b of Object.values(inn.bowlers)) expect(b.balls).toBeLessThanOrEqual(inn.superOver ? 6 : 24);
        expect(inn.legalBalls).toBeLessThanOrEqual(inn.maxBalls);
        if (!inn.superOver) for (let o = 1; o < inn.overs.length; o++) expect(inn.overs[o].bowlerId).not.toBe(inn.overs[o - 1].bowlerId);
      }
      expect(s.status).toBe('complete');
    }
  });

  it('replays a manual match exactly from seed + action log', () => {
    const ctl = { home: 'manual' as const, away: 'ai' as const };
    const s = createMatch(setup('replay', 'home'), 'replay-seed');
    let guard = 0;
    while (s.status !== 'complete' && guard++ < 3000) {
      if (s.seq === 30 && s.innings[0]?.battingSide === 'home' && !s.actions.some((a) => a.action.type === 'intent')) {
        applyAction(s, 'home', { type: 'intent', value: 0.9 });
      }
      const r = step(s, ctl, AiCaptain);
      if (r.needs) {
        const n = r.needs;
        if (n.kind === 'toss-call') applyAction(s, 'home', { type: 'toss-call', call: 'heads' });
        else if (n.kind === 'toss') applyAction(s, 'home', { type: 'toss', decision: 'bowl' });
        else if (n.kind === 'batter') applyAction(s, 'home', { type: 'batter', playerId: n.incomingId });
        else if (n.kind === 'bowler') applyAction(s, 'home', { type: 'bowler', playerId: n.suggestion });
        else applyAction(s, 'home', { type: 'review', review: true });
      }
    }
    expect(s.status).toBe('complete');

    const r = replayMatch(setup('replay', 'home'), 'replay-seed', s.actions, ctl);
    expect(strip(r)).toEqual(strip(s));
  });

  it('built-in fields are legal for their situation', () => {
    for (const f of BUILT_IN_FIELDS) {
      const pp = f.situation === 'powerplay' || f.id === 'new-batter';
      const v = validateField(f.positions, 'R', { powerplay: pp, maxOutsidePP: 2, maxOutside: 5 });
      expect(v.errors, f.name).toEqual([]);
    }
  });

  it('tired, out-of-form XIs lose more often, but not always', () => {
    const N = 100;
    const winRate = (weaken: boolean) => {
      let home = 0;
      for (let i = 0; i < N; i++) {
        const st = setup(`up-${i}`);
        if (weaken) st.away.xi = st.away.xi.map((p) => ({ ...p, form: -6, fatigue: 60 }));
        if (runToEnd(createMatch(st, `up-${i}`)).result?.winner === 'home') home++;
      }
      return home / N;
    };
    const base = winRate(false);
    const weakened = winRate(true);
    expect(weakened).toBeGreaterThan(base + 0.05);
    expect(weakened).toBeLessThan(0.95);
  });
});

