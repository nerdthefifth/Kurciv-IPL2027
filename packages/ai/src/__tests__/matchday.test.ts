import { describe, expect, it } from 'vitest';
import {
  applyAction, caughtBehindVerdict, createMatch, lbwReviewVerdict, step,
  type Controllers, type MatchSetup, type MatchState, type Pending, type Side,
} from '@kurciv/simulation';
import { AiCaptain } from '../captain';
import { setup } from './fixtures';

type Answer = (s: MatchState, n: Pending) => void;

/** Default answers for a manual side: call heads, bowl first, accept suggestions, keep the incoming batter, never review. */
const defaults = (side: Side): Answer => (s, n) => {
  if (n.kind === 'toss-call') applyAction(s, side, { type: 'toss-call', call: 'heads' });
  else if (n.kind === 'toss') applyAction(s, side, { type: 'toss', decision: 'bowl' });
  else if (n.kind === 'bowler') applyAction(s, side, { type: 'bowler', playerId: n.suggestion });
  else if (n.kind === 'batter') applyAction(s, side, { type: 'batter', playerId: n.incomingId });
  else if (n.kind === 'review') applyAction(s, side, { type: 'review', review: false });
};

function play(s: MatchState, ctl: Controllers, answer: Answer, beforeStep?: (s: MatchState) => void) {
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 5000) {
    beforeStep?.(s);
    const r = step(s, ctl, AiCaptain);
    if (r.needs) answer(s, r.needs);
  }
  expect(s.status).toBe('complete');
  return s;
}

const HOME: Controllers = { home: 'manual', away: 'ai' };

function checkScorecard(s: MatchState) {
  for (const inn of s.innings) {
    const evs = s.deliveries.filter((d) => d.innings === inn.index);
    expect(evs.reduce((a, d) => a + d.totalRuns, 0)).toBe(inn.runs);
    expect(evs.filter((d) => d.wicket).length).toBe(inn.wickets);
    expect(evs.filter((d) => d.legal).length).toBe(inn.legalBalls);
    expect(Object.values(inn.batters).filter((b) => b.out).length).toBe(inn.wickets);
  }
  const seqs = s.deliveries.map((d) => d.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
}

describe('toss', () => {
  it('is a fair coin, resolved only when the call is made', () => {
    let heads = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const s = createMatch(setup(`toss-${i}`), `toss-${i}`);
      expect(s.toss.coin).toBeNull();
      step(s, { home: 'ai', away: 'ai' }, AiCaptain);
      expect(s.toss.coin === 'heads' || s.toss.coin === 'tails').toBe(true);
      expect(s.toss.winner).toBe(s.toss.call === s.toss.coin ? s.toss.caller : s.toss.caller === 'home' ? 'away' : 'home');
      if (s.toss.coin === 'heads') heads++;
    }
    expect(heads / N).toBeGreaterThan(0.47);
    expect(heads / N).toBeLessThan(0.53);
  });

  it('lets the user call; the call decides who wins and the decision sets the batting side', () => {
    const outcomes = new Set<string>();
    for (const call of ['heads', 'tails'] as const) {
      const s = createMatch(setup('call', 'home'), 'call-seed');
      const r = step(s, HOME, AiCaptain);
      expect(r.needs?.kind).toBe('toss-call');
      expect(applyAction(s, 'home', { type: 'toss', decision: 'bat' }).ok).toBe(false); // no decision before the toss
      expect(applyAction(s, 'home', { type: 'toss-call', call }).ok).toBe(true);
      expect(applyAction(s, 'home', { type: 'toss-call', call }).ok).toBe(false); // cannot re-toss
      outcomes.add(`${s.toss.coin}:${s.toss.winner}`);
      const r2 = step(s, HOME, AiCaptain);
      if (s.toss.winner === 'home') {
        expect(r2.needs?.kind).toBe('toss');
        applyAction(s, 'home', { type: 'toss', decision: 'bat' });
        step(s, HOME, AiCaptain);
        expect(s.innings[0].battingSide).toBe('home');
      } else {
        expect(s.toss.decision).not.toBeNull();
        expect(s.innings[0].battingSide).toBe(s.toss.decision === 'bat' ? 'away' : 'home');
      }
    }
    // Same coin both times, different winners: the call genuinely matters.
    const [a, b] = [...outcomes];
    expect(a.split(':')[0]).toBe(b.split(':')[0]);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });
});

describe('incoming batter', () => {
  it('pauses at each wicket when manual, and accepts only eligible batters', () => {
    let chose = 0;
    for (let k = 0; k < 6 && chose < 3; k++) {
      const s = createMatch(setup(`bat-${k}`, 'home'), `bat-${k}`);
      applyAction(s, 'home', { type: 'auto', settings: { batter: false } });
      const d = defaults('home');
      play(s, HOME, (st, n) => {
        if (n.kind !== 'batter') return d(st, n);
        const inn = st.innings[st.innings.length - 1];
        const dismissed = Object.values(inn.batters).find((b) => b.out)!.playerId;
        expect(applyAction(st, 'home', { type: 'batter', playerId: dismissed }).ok).toBe(false);
        const atCrease = inn.strikerId === n.incomingId ? inn.nonStrikerId : inn.strikerId;
        expect(applyAction(st, 'home', { type: 'batter', playerId: atCrease }).ok).toBe(false);
        const pick = n.eligible[n.eligible.length - 1]; // the tail-ender instead of the default
        expect(applyAction(st, 'home', { type: 'batter', playerId: pick }).ok).toBe(true);
        expect([inn.strikerId, inn.nonStrikerId]).toContain(pick);
        expect(inn.batters[n.incomingId] === undefined || n.incomingId === pick).toBe(true);
        chose++;
      });
      checkScorecard(s);
    }
    expect(chose).toBeGreaterThan(2);
  });
});

describe('automation toggles', () => {
  it('bowler prompts only when bowler selection is manual', () => {
    const count = (auto: boolean) => {
      const s = createMatch(setup('auto', 'home'), 'auto-seed');
      applyAction(s, 'home', { type: 'auto', settings: { bowler: auto } });
      let prompts = 0;
      const d = defaults('home');
      play(s, HOME, (st, n) => {
        if (n.kind === 'bowler') prompts++;
        d(st, n);
      });
      return prompts;
    };
    expect(count(false)).toBeGreaterThan(10);
    expect(count(true)).toBe(0);
  });

  it('manual bowlers with automatic plans: bowling first never asks for a plan before a bowler exists', () => {
    // Regression: the matchday screen sets these; the AI winning the toss and batting made the engine throw.
    for (let k = 0; k < 6; k++) {
      const s = createMatch(setup(`plan-auto-${k}`, 'home'), `plan-auto-${k}`);
      applyAction(s, 'home', { type: 'auto', settings: { bowler: false, batter: false, plan: true } });
      expect(() => play(s, HOME, defaults('home'))).not.toThrow();
      checkScorecard(s);
    }
  });
});

describe('decision review system', () => {
  it('reviews are decided from stored evidence; overturns, upheld calls and umpire\'s call update the right counts', () => {
    const seen = { overturned: 0, upheld: 0, umpiresCall: 0, exhaustedNoPrompt: 0 };
    for (let k = 0; k < 120 && (seen.overturned < 2 || seen.upheld < 2); k++) {
      const s = createMatch(setup(`drs-${k}`, 'home'), `drs-${k}`);
      const d = defaults('home');
      play(s, HOME, (st, n) => {
        if (n.kind !== 'review') return d(st, n);
        const inn = st.innings[st.innings.length - 1];
        const before = n.by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
        expect(before).toBeGreaterThan(0);
        const ev = st.pendingEvent!;
        const meta = st.pendingMeta!;
        const expected = meta.kind === 'caught-behind' ? caughtBehindVerdict(ev.edge!).out : lbwReviewVerdict(ev.tracking!, meta.umpireOut).out;
        const ballsBefore = inn.legalBalls;
        const wktsBefore = inn.wickets;
        expect(applyAction(st, 'home', { type: 'review', review: true }).ok).toBe(true);
        const done = st.deliveries[st.deliveries.length - 1];
        expect(!!done.wicket).toBe(expected);
        expect(inn.wickets).toBe(wktsBefore + (expected ? 1 : 0));
        expect(inn.legalBalls).toBe(ballsBefore + (done.legal ? 1 : 0));
        const after = n.by === 'batting' ? inn.reviewsLeft.batting : inn.reviewsLeft.bowling;
        if (done.review!.overturned) {
          seen.overturned++;
          expect(after).toBe(before);
        } else if (done.review!.umpiresCall) {
          seen.umpiresCall++;
          expect(after).toBe(before);
        } else {
          seen.upheld++;
          expect(after).toBe(before - 1);
        }
        expect(done.review!.decisive!.length).toBeGreaterThan(5);
      });
      checkScorecard(s);
      for (const inn of s.innings) expect(Math.min(inn.reviewsLeft.batting, inn.reviewsLeft.bowling)).toBeGreaterThanOrEqual(0);
    }
    expect(seen.overturned).toBeGreaterThan(0);
    expect(seen.upheld).toBeGreaterThan(0);
  });

  it('rejects illegal review requests and stops prompting once reviews are exhausted', () => {
    const s = createMatch({ ...setup('nodrs', 'home'), rules: { ...setup().rules, reviews: 0 } }, 'nodrs');
    expect(applyAction(s, 'home', { type: 'review', review: true }).ok).toBe(false);
    let prompts = 0;
    const d = defaults('home');
    play(s, HOME, (st, n) => {
      if (n.kind === 'review') prompts++;
      d(st, n);
    });
    expect(prompts).toBe(0);
  });

  it('a review on the last wicket ends the innings or keeps it alive, cleanly', () => {
    const tail = (t: MatchSetup['home']) => [t.xi.find((p) => p.id === t.keeperId)!, ...t.xi.filter((p) => p.id !== t.keeperId).slice(-2)];
    const tiny = (id: string): MatchSetup => {
      const st = setup(id, 'home');
      return {
        ...st,
        // Wicketkeeper plus two tail-enders: two wickets end an innings, so last-wicket reviews are common.
        home: { ...st.home, xi: tail(st.home) },
        away: { ...st.away, xi: tail(st.away) },
        rules: { ...st.rules, overs: 4, maxBowlerOvers: 2, reviews: 9 },
      };
    };
    let ended = 0;
    let kept = 0;
    for (let k = 0; k < 8000 && ended + kept < 2; k++) {
      const s = createMatch(tiny(`end-${k}`), `end-${k}`);
      const d = defaults('home');
      play(s, HOME, (st, n) => {
        if (n.kind !== 'review') return d(st, n);
        const inn = st.innings[st.innings.length - 1];
        const lastWicket = inn.wickets === inn.maxWickets - 1;
        applyAction(st, 'home', { type: 'review', review: true });
        const ev = st.deliveries[st.deliveries.length - 1];
        if (lastWicket && ev.review?.overturned && ev.wicket) {
          expect(inn.complete).toBe(true);
          expect(inn.wickets).toBe(inn.maxWickets);
          ended++;
        }
        if (lastWicket && ev.review?.overturned && !ev.wicket) {
          expect(inn.wickets).toBe(inn.maxWickets - 1);
          kept++;
        }
      });
      checkScorecard(s);
    }
    expect(ended + kept).toBeGreaterThan(0);
  });
});

describe('tactics change outcomes', () => {
  const homeBattingStats = (prep: (s: MatchState) => void, N = 60) => {
    let runs = 0;
    let balls = 0;
    let wkts = 0;
    for (let i = 0; i < N; i++) {
      const s = createMatch(setup(`tac-${i}`, 'home'), `tac-${i}`);
      applyAction(s, 'home', { type: 'auto', settings: { bowler: true } });
      const d = defaults('home');
      play(s, HOME, d, (st) => {
        const inn = st.innings[st.innings.length - 1];
        if (inn?.battingSide === 'home' && inn.legalBalls === 0 && !st.actions.some((a) => a.action.type === 'intent' || a.action.type === 'plan')) prep(st);
      });
      for (const inn of s.innings.filter((x) => x.battingSide === 'home' && !x.superOver)) {
        runs += inn.runs;
        balls += inn.legalBalls;
        wkts += inn.wickets;
      }
    }
    return { rpo: (runs / balls) * 6, ballsPerWicket: balls / Math.max(1, wkts) };
  };

  it('batting approach: all-out attack scores faster and loses wickets faster than defensive', () => {
    const attack = homeBattingStats((s) => applyAction(s, 'home', { type: 'intent', value: 0.9 }));
    const defend = homeBattingStats((s) => applyAction(s, 'home', { type: 'intent', value: 0.2 }));
    expect(attack.rpo).toBeGreaterThan(defend.rpo + 0.5);
    expect(attack.ballsPerWicket).toBeLessThan(defend.ballsPerWicket);
  });

  it('bowling plan: a yorker-heavy plan concedes differently from a short-ball plan', () => {
    const concede = (lengths: Record<string, number>) => {
      let runs = 0;
      let balls = 0;
      for (let i = 0; i < 50; i++) {
        const s = createMatch(setup(`plan-${i}`, 'home'), `plan-${i}`);
        applyAction(s, 'home', { type: 'auto', settings: { bowler: true } });
        const d = defaults('home');
        play(s, HOME, d, (st) => {
          const inn = st.innings[st.innings.length - 1];
          if (inn?.bowlingSide === 'home' && !st.actions.some((a) => a.action.type === 'plan')) {
            applyAction(st, 'home', { type: 'plan', plan: { lengths, lines: { off: 6, stumps: 4 }, variation: 0.1, pace: 'normal' } });
          }
        });
        for (const d2 of s.deliveries) {
          if (s.innings[d2.innings].bowlingSide !== 'home' || !d2.legal) continue;
          runs += d2.totalRuns;
          balls++;
        }
      }
      return (runs / balls) * 6;
    };
    const yorkers = concede({ yorker: 7, full: 3 });
    const short = concede({ short: 7, back: 3 });
    expect(Math.abs(yorkers - short)).toBeGreaterThan(0.4);
  });
});

describe('delivery feedback', () => {
  it('records the tactical set-up and a grounded explanation for each ball', () => {
    const s = play(createMatch(setup('why', 'home'), 'why'), HOME, defaults('home'));
    let explained = 0;
    for (const d of s.deliveries) {
      expect(d.setup).toBeTruthy();
      expect(d.setup!.field.length).toBeGreaterThan(0);
      for (const w of d.why ?? []) {
        explained++;
        if (w.startsWith('Dropped')) expect(d.chance && !d.chance.taken).toBeTruthy();
        if (w.startsWith('Picked out')) expect(d.wicket?.kind).toBe('caught');
        if (w.startsWith('A loose ball')) expect(d.quality).toBe('loose');
        if (w.includes('saved')) expect(d.runsSaved).toBeGreaterThanOrEqual(2);
      }
    }
    expect(explained).toBeGreaterThan(30);
  });
});
