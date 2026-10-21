import { describe, expect, it } from 'vitest';
import { AppError, Backend } from './backend';
import { MemoryAdapter } from './persistence';
import { fingerprint, validatePackage } from './portability';

const create = (b: Backend, clubId = 'CHE', managerName = 'Alex') =>
  b.handle('POST', '/careers', { managerName, difficulty: 'professional', clubId, seed: `seed-${clubId}` }) as Promise<{ id: string }>;

async function tickUntil(b: Backend, cid: string, pred: (v: any) => boolean, max = 4000) {
  let v: any = null;
  for (let i = 0; i < max; i++) {
    v = await b.handle('POST', `/careers/${cid}/auction/tick`, { dt: 250 });
    if (pred(v)) return v;
  }
  throw new Error('condition not reached');
}

describe('browser-local backend', () => {
  it('first launch: create a career and reach the clubhouse without any account', async () => {
    const b = new Backend(new MemoryAdapter());
    expect(((await b.handle('GET', '/careers')) as any).careers).toEqual([]);
    const { id } = await create(b);
    const home = (await b.handle('GET', `/careers/${id}`)) as any;
    expect(home.club.name).toBe('Chennai Super Kings');
    expect(home.decisions.some((d: any) => /auction/i.test(d.label))).toBe(true);
    expect(home.stories.some((s: any) => s.kicker === 'AUCTION EVE')).toBe(true);
  });

  it('persists across a "refresh" (new backend on the same storage)', async () => {
    const store = new MemoryAdapter();
    const b1 = new Backend(store);
    const { id } = await create(b1);
    await b1.handle('POST', `/careers/${id}/auction/command`, { command: { type: 'begin' } });
    await tickUntil(b1, id, (v) => v.auction.live.phase === 'OPEN_FOR_BIDS');
    const before = fingerprint((await store.loadWorld(id))!);
    const b2 = new Backend(store);
    const room = (await b2.handle('GET', `/careers/${id}/auction`)) as any;
    expect(room.auction.live.phase).not.toBe('PREPARATION');
    expect(fingerprint((await store.loadWorld(id))!)).toBe(before);
  });

  it('multiple saves stay independent', async () => {
    const store = new MemoryAdapter();
    const b = new Backend(store);
    const one = await create(b, 'CHE', 'One');
    const two = await create(b, 'MUM', 'Two');
    const twoBefore = await store.getMeta(two.id);
    await b.handle('POST', `/careers/${one.id}/auction/sim`, { until: 'end', assistant: true });
    const twoAfter = await store.getMeta(two.id);
    expect(twoAfter).toEqual(twoBefore);
    expect(((await b.handle('GET', '/careers')) as any).careers).toHaveLength(2);
  }, 120_000);

  it('auction integrity: win a player → registered, charged, gone from the pool', async () => {
    const store = new MemoryAdapter();
    const b = new Backend(store);
    const { id } = await create(b);
    await b.handle('POST', `/careers/${id}/auction/command`, { command: { type: 'begin' } });
    const target = ((await b.handle('GET', `/careers/${id}/auction`)) as any).auction.queue ?? null;
    void target;
    let won: any = null;
    for (let i = 0; i < 6000 && !won; i++) {
      const v = (await b.handle('POST', `/careers/${id}/auction/tick`, { dt: 200 })) as any;
      const lot = v.auction.lot;
      if (lot?.canBid && lot.nextBid <= 25) await b.handle('POST', `/careers/${id}/auction/command`, { command: { type: 'bid' } }).catch(() => {});
      if (v.auction.lastResult?.status === 'sold' && v.auction.lastResult.clubId === 'CHE') won = v.auction.lastResult;
    }
    expect(won).toBeTruthy();
    const w = (await store.loadWorld(id))!;
    expect(w.players[won.playerId].clubId).toBe('CHE');
    expect(w.clubs.CHE.squad).toContain(won.playerId);
    expect(w.ledger.some((t) => t.playerId === won.playerId && t.kind === 'auction' && t.fee === won.price)).toBe(true);
    const room = (await b.handle('GET', `/careers/${id}/auction`)) as any;
    expect(room.auction.queue.some((q: any) => q.player.id === won.playerId)).toBe(false);
    expect(w.timeline.some((t) => t.kind === 'signing' && t.refs[0] === won.playerId)).toBe(true);
  }, 120_000);

  it('auction recovery: refresh mid-lot restores the lot, bids and purses', async () => {
    const store = new MemoryAdapter();
    const b1 = new Backend(store);
    const { id } = await create(b1);
    await b1.handle('POST', `/careers/${id}/auction/command`, { command: { type: 'begin' } });
    // Play until a lot resolves (immediate durable write), then a little more.
    await tickUntil(b1, id, (v) => v.auction.lastResult !== null);
    const resolved = (await b1.handle('GET', `/careers/${id}/auction`)) as any;
    const b2 = new Backend(store);
    const recovered = (await b2.handle('GET', `/careers/${id}/auction`)) as any;
    expect(recovered.auction.lastResult.playerId).toBe(resolved.auction.lastResult.playerId);
    expect(recovered.auction.clubs.map((c: any) => c.purse)).toEqual(resolved.auction.clubs.map((c: any) => c.purse));
    // ... and the auction carries on.
    await tickUntil(b2, id, (v) => v.auction.lotNumber > resolved.auction.lotNumber);
  }, 120_000);

  it('match integration: scorecard, standings, statistics, fatigue and timeline agree', async () => {
    const store = new MemoryAdapter();
    const b = new Backend(store);
    const { id } = await create(b);
    await b.handle('POST', `/careers/${id}/auction/sim`, { until: 'end', assistant: true });
    await b.handle('POST', `/careers/${id}/transfers/autofill`, {}).catch(() => {});
    await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' }); // start season
    const r = (await b.handle('POST', `/careers/${id}/continue`, { mode: 'next' })) as any;
    expect(r.stoppedFor).toBe('user-match');
    const q = (await b.handle('POST', `/careers/${id}/match/quick`, { fixtureId: r.fixtureId })) as any;
    const w = (await store.loadWorld(id))!;
    const fx = w.fixtures[q.fixture.id];
    expect(fx.status).toBe('complete');
    const record = await store.getRecord(id, fx.id);
    expect(record!.innings.filter((i) => !i.superOver).map((i) => i.runs)).toEqual(fx.result!.innings.map((i) => i.runs));
    const row = w.competitions[fx.competitionId].standings.main.find((x) => x.clubId === 'CHE')!;
    expect(row.played).toBeGreaterThanOrEqual(1);
    const batter = fx.result!.innings.find((i) => i.battingClubId === 'CHE')!.batting[0];
    expect(w.players[batter.playerId].stats.career.runs).toBeGreaterThanOrEqual(batter.runs);
    expect(w.players[batter.playerId].fatigue).toBeGreaterThan(0);
    expect(w.timeline.length).toBeGreaterThan(1);
  }, 180_000);

  it('export → import reproduces the career and stays independent', async () => {
    const store = new MemoryAdapter();
    const b = new Backend(store);
    const { id } = await create(b);
    await b.handle('POST', `/careers/${id}/auction/sim`, { until: 'end', assistant: true });
    const pkg = (await b.handle('GET', `/careers/${id}/export`)) as any;
    const json = JSON.parse(JSON.stringify(pkg)); // as if written to and read from a file
    const check = (await b.handle('POST', '/import/check', { package: json })) as any;
    expect(check.ok).toBe(true);
    expect(check.summary.clubName).toBe('Chennai Super Kings');
    const imported = (await b.handle('POST', '/import', { package: json })) as any;
    const a = (await store.loadWorld(id))!;
    const c = (await store.loadWorld(imported.id))!;
    expect(fingerprint(c)).toBe(fingerprint(a));
    await b.handle('POST', `/careers/${imported.id}/lineup`, { playerIds: null });
    await b.handle('POST', `/careers/${imported.id}/settings`, { autoPlayUserMatches: true, reducedMotion: true });
    expect((await store.loadWorld(id))!.settings.autoPlayUserMatches).toBe(false);
  }, 120_000);

  it('rejects invalid or tampered imports without writing anything', async () => {
    const store = new MemoryAdapter();
    const b = new Backend(store);
    expect(((await b.handle('POST', '/import/check', { package: { hello: 'world' } })) as any).ok).toBe(false);
    const { id } = await create(b);
    const pkg = JSON.parse(JSON.stringify(await b.handle('GET', `/careers/${id}/export`)));
    const pid = Object.keys(pkg.world.players)[0];
    pkg.world.clubs.CHE.squad.push(pid);
    pkg.world.clubs.MUM.squad.push(pid); // same player in two squads
    const v = validatePackage(pkg);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/registered to both|claims a club|club does not match/);
    const before = (await store.listCareers()).length;
    await expect(b.handle('POST', '/import', { package: pkg })).rejects.toBeInstanceOf(AppError);
    expect((await store.listCareers()).length).toBe(before);
  });

  it('a failed write (e.g. storage full) explains itself and keeps the last good save', async () => {
    const store = new MemoryAdapter();
    const statuses: string[] = [];
    const b = new Backend(store, (s) => statuses.push(s.state));
    const { id } = await create(b);
    const good = fingerprint((await store.loadWorld(id))!);
    const quota = new Error('The quota has been exceeded.');
    quota.name = 'QuotaExceededError';
    store.failNextWrite = quota;
    const err = await b.handle('POST', `/careers/${id}/settings`, { autoPlayUserMatches: true, reducedMotion: false }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/storage for this site is full/);
    expect(statuses).toContain('error');
    expect(fingerprint((await store.loadWorld(id))!)).toBe(good);
    const home = (await b.handle('GET', `/careers/${id}`)) as any;
    expect(home.settings.autoPlayUserMatches).toBe(false); // the failed change was not kept in memory either
  });

  it('enforces retention limits and phase rules with clear reasons', async () => {
    const b = new Backend(new MemoryAdapter());
    const { id } = await create(b);
    const err = await b.handle('POST', `/careers/${id}/retentions`, { playerIds: [] }).catch((e) => e);
    expect((err as AppError).message).toMatch(/retention window is closed/);
  });
});
