import { describe, expect, it } from 'vitest';
import { Backend } from '../backend';
import { MemoryAdapter } from '../persistence';

/** Creates a career, lets the assistant finish the auction, starts the season, plays to the user's first match. */
async function seasonUnderway(store: MemoryAdapter, clubId = 'RAJ') {
  const b = new Backend(store);
  const { id } = (await b.handle('POST', '/careers', { managerName: 'Reporter', difficulty: 'professional', clubId, seed: `rep-${clubId}` })) as { id: string };
  await b.handle('POST', `/careers/${id}/auction/sim`, { until: 'end', assistant: true });
  await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' }); // auction → preseason if needed
  const home = (await b.handle('GET', `/careers/${id}`)) as any;
  if (home.phase === 'preseason') await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' });
  const r = (await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' })) as any;
  return { b, id, fixtureId: r.fixtureId as string };
}

describe('post-match centre', () => {
  it('builds a validated, deterministic report for a user match, with career impact', async () => {
    const store = new MemoryAdapter();
    const { b, id, fixtureId } = await seasonUnderway(store);
    expect(fixtureId).toBeTruthy();
    await b.handle('POST', `/careers/${id}/match/quick`, { fixtureId });
    const recordBefore = JSON.stringify(await store.getRecord(id, fixtureId));
    const rep = (await b.handle('GET', `/careers/${id}/fixtures/${fixtureId}/report`)) as any;

    expect(rep.validation.issues).toEqual([]);
    expect(rep.validation.ok).toBe(true);
    // Scorecard agrees with the canonical fixture result.
    const world = (await store.loadWorld(id))!;
    const fx = world.fixtures[fixtureId];
    expect(rep.innings.map((i: any) => [i.runs, i.wickets, i.legalBalls])).toEqual(fx.result!.innings.map((i) => [i.runs, i.wickets, i.balls]));
    expect(rep.result.winnerClubId).toBe(fx.result!.winnerId);
    expect(rep.playerOfMatch?.playerId ?? null).toBe(fx.result!.playerOfMatch);
    for (const inn of rep.innings) {
      expect(inn.batting.reduce((a: number, x: any) => a + x.runs, 0) + inn.extras.total).toBe(inn.runs);
    }
    expect(rep.headline.title.length).toBeGreaterThan(3);
    expect(rep.moments.length).toBeGreaterThan(2);
    expect(rep.moments.at(-1).kind).toBe('final');
    expect(rep.impact).not.toBeNull();
    expect(rep.impact.players.length).toBeGreaterThan(10);
    expect(rep.impact.odds).not.toBeNull();

    // Reopening (even after a "refresh") reproduces the same report and never mutates the record.
    const again = await b.handle('GET', `/careers/${id}/fixtures/${fixtureId}/report`);
    expect(again).toEqual(rep);
    const reopened = await new Backend(store).handle('GET', `/careers/${id}/fixtures/${fixtureId}/report`);
    expect(reopened).toEqual(rep);
    expect(JSON.stringify(await store.getRecord(id, fixtureId))).toBe(recordBefore);

    const archive = (await b.handle('GET', `/careers/${id}/archive`)) as any;
    expect(archive.matches.some((m: any) => m.fixtureId === fixtureId)).toBe(true);
  }, 300_000);

  it('every AI-simulated match produces a valid report with justified headlines', async () => {
    const store = new MemoryAdapter();
    const { b, id, fixtureId } = await seasonUnderway(store, 'BEN');
    await b.handle('POST', `/careers/${id}/match/quick`, { fixtureId });
    for (let i = 0; i < 2; i++) {
      const r = (await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' })) as any;
      if (r.stoppedFor === 'user-match') await b.handle('POST', `/careers/${id}/match/quick`, { fixtureId: r.fixtureId });
    }
    const w = (await store.loadWorld(id))!;
    const done = Object.values(w.fixtures).filter((f) => f.status === 'complete' && !f.involvesUser).slice(0, 40);
    expect(done.length).toBeGreaterThan(5);
    const roles = new Map<string, number>();
    for (const fx of done) {
      const rep = (await b.handle('GET', `/careers/${id}/fixtures/${fx.id}/report`)) as any;
      expect(rep.validation.issues, fx.id).toEqual([]);
      if (rep.headline.title === 'A last-over thriller') {
        const close = (rep.result.kind === 'wickets' && rep.result.ballsRemaining <= 6) || (rep.result.kind === 'runs' && rep.result.value <= 8);
        expect(close).toBe(true);
      }
      if (rep.playerOfMatch) {
        const p = w.players[rep.playerOfMatch.playerId];
        roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
      }
    }
    // The award model is not "most runs wins": bowlers win it too.
    expect((roles.get('BOWL') ?? 0) + (roles.get('AR') ?? 0)).toBeGreaterThan(0);
  }, 300_000);
});
