import { describe, expect, it } from 'vitest';
import { VENUES } from '@kurciv/config';
import { contributions } from '@kurciv/simulation';
import { simulateMatch } from '../runner';
import { setup } from './fixtures';

/**
 * Keeps match scoring in the game's target band. Strong IPL-standard sides, rotated across
 * every venue (a single small ground hides problems), should score about 7–8 an over
 * (roughly 135–160 an innings) with 6–8 wickets, about a third of balls dotted, and big
 * overs (15+) uncommon.
 */
describe('scoring calibration', () => {
  it('produces realistic T20 innings across venues', () => {
    const N = 100;
    let inns = 0;
    let runs = 0;
    let wkts = 0;
    let fours = 0;
    let sixes = 0;
    let balls = 0;
    let dots = 0;
    for (let i = 0; i < N; i++) {
      const s = simulateMatch({ ...setup(`cal-${i}`), venue: VENUES[i % VENUES.length] }, `cal-${i}`);
      for (const inn of s.innings.filter((x) => !x.superOver)) {
        inns++;
        runs += inn.runs;
        wkts += inn.wickets;
      }
      for (const d of s.deliveries) {
        if (s.innings[d.innings].superOver) continue;
        if (d.legal) balls++;
        if (d.legal && d.totalRuns === 0 && !d.wicket) dots++;
        if (d.boundary === 4) fours++;
        if (d.boundary === 6) sixes++;
      }
    }
    const avg = runs / inns;
    expect(avg).toBeGreaterThan(132);
    expect(avg).toBeLessThan(162);
    expect(sixes / inns).toBeGreaterThan(3);
    expect(sixes / inns).toBeLessThan(8);
    expect(fours / inns).toBeGreaterThan(10);
    expect(fours / inns).toBeLessThan(16);
    expect(wkts / inns).toBeGreaterThan(5.8);
    expect(wkts / inns).toBeLessThan(8);
    expect(dots / balls).toBeGreaterThan(0.29);
    expect(dots / balls).toBeLessThan(0.45);
  }, 300_000);

  it('awards Player of the Match to the top contributor, usually on the winning side', () => {
    // Regression: the award was decided before the final ball's win probability existed,
    // which poisoned the scores and handed it to an arbitrary player.
    const N = 60;
    let losing = 0;
    for (let i = 0; i < N; i++) {
      const s = simulateMatch({ ...setup(`pom-${i}`), venue: VENUES[i % VENUES.length] }, `pom-${i}`);
      const c = contributions(s);
      expect(c.every((x) => Number.isFinite(x.total))).toBe(true);
      expect(s.result!.playerOfMatch).toBe(c[0].playerId);
      const side = s.setup.home.xi.some((p) => p.id === s.result!.playerOfMatch) ? 'home' : 'away';
      if (s.result!.winner && side !== s.result!.winner) losing++;
    }
    expect(losing / N).toBeLessThan(0.2);
  }, 300_000);
});
