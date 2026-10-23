import { describe, expect, it } from 'vitest';
import { overall } from '@kurciv/domain';
import { auditLeague, createWorld, fastForward, liveCommand } from '../index';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('auction economics', () => {
  for (const mode of ['assistant', 'without-me'] as const) {
    it(`skip (${mode}) runs the live engine to completion with valid budgets and squads`, () => {
      const w = createWorld({ managerName: 'Econ', difficulty: 'professional', clubId: 'CHE', careerId: 'x', seed: `econ-${mode}`, worldModel: 'leagues' });
      const a = Object.values(w.auctions).find((x) => x.interactive)!;
      fastForward(w, a, mode);
      expect(a.status).toBe('complete');
      const audit = auditLeague(w, a.leagueId);
      expect(audit.issues).toEqual([]);
      const sold = a.lots.filter((x) => x.status === 'sold');
      const purse = 120;
      // No single player takes an extreme share of a purse, and quality tiers stay ordered.
      expect(Math.max(...sold.map((x) => x.price!))).toBeLessThanOrEqual(purse * 0.32);
      const band = (lo: number, hi: number) => sold.filter((x) => { const o = overall(w.players[x.playerId]); return o >= lo && o < hi; }).map((x) => x.price!);
      expect(median(band(75, 80))).toBeLessThan(8);
      expect(median(band(65, 70))).toBeLessThan(2);
      expect(median(band(80, 85))).toBeGreaterThan(median(band(75, 80)));
      if (mode === 'without-me') expect(w.clubs.CHE.squad.length).toBe(0);
    }, 120_000);
  }

  it('until-flagged stops when a shortlisted player is introduced', () => {
    const w = createWorld({ managerName: 'Flag', difficulty: 'professional', clubId: 'CHE', careerId: 'x', seed: 'flag', worldModel: 'leagues' });
    const a = Object.values(w.auctions).find((x) => x.interactive)!;
    const target = a.lots[30];
    liveCommand(w, a, { type: 'flag', playerId: target.playerId, flagged: true });
    const r = fastForward(w, a, 'until-flagged');
    expect(r.stoppedAt).toBe(target.playerId);
    expect(a.lots[a.currentLotIndex].id).toBe(target.id);
    expect(a.live!.phase).toBe('PLAYER_INTRODUCTION');
  }, 120_000);

  it('the bid clock lengthens bidding windows', () => {
    const w = createWorld({ managerName: 'Clock', difficulty: 'professional', clubId: 'CHE', careerId: 'x', seed: 'clock', worldModel: 'leagues' });
    const a = Object.values(w.auctions).find((x) => x.interactive)!;
    expect(liveCommand(w, a, { type: 'clock', setting: 'relaxed' }).ok).toBe(true);
    liveCommand(w, a, { type: 'begin' });
    expect(a.live!.phaseMs).toBe(Math.round(3200 * 1.5));
    expect(liveCommand(w, a, { type: 'clock', setting: 'nonsense' as never }).ok).toBe(false);
  });
});
