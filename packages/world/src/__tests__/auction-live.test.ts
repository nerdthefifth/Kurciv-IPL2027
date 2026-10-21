import { describe, expect, it } from 'vitest';
import { isOverseas, type WorldState } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import { createWorld, liveCommand, liveTick, permittedBids, squadOf } from '../index';

const userAuction = (w: WorldState) => Object.values(w.auctions).find((a) => a.interactive)!;

/** Drive the room like a browser would: small ticks, user passes on everything unless told otherwise. */
function runRoom(w: WorldState, opts: { userPlays?: (w: WorldState) => void; maxTicks?: number } = {}) {
  const a = userAuction(w);
  if (a.live!.phase === 'PREPARATION') expect(liveCommand(w, a, { type: 'begin' }).ok).toBe(true);
  let ticks = 0;
  while (a.live!.phase !== 'COMPLETED' && ticks++ < (opts.maxTicks ?? 400_000)) {
    if (a.live!.phase === 'ACCELERATED_SELECTION') {
      liveCommand(w, a, { type: 'accelerated-start' });
      continue;
    }
    opts.userPlays?.(w);
    liveTick(w, a, 250);
  }
  return a;
}

function checkRegistrations(w: WorldState) {
  const seen = new Set<string>();
  for (const c of Object.values(w.clubs)) {
    const l = leagueById(c.leagueId);
    const sq = squadOf(w, c);
    expect(sq.length).toBeLessThanOrEqual(l.squadRules.maxSquad);
    const os = sq.filter((p) => isOverseas(p, l.domesticCountries));
    expect(os.length).toBeLessThanOrEqual(l.squadRules.maxOverseas);
    const byC: Record<string, number> = {};
    for (const p of os) byC[p.country] = (byC[p.country] ?? 0) + 1;
    for (const n of Object.values(byC)) expect(n).toBeLessThanOrEqual(l.squadRules.maxPerOverseasCountry);
    expect(c.purse).toBeGreaterThanOrEqual(-1e-9);
    for (const id of c.squad) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(w.players[id].clubId).toBe(c.id);
    }
  }
}

describe('live auction room', () => {
  it('opens in the lobby, then paces lots through every phase', () => {
    const w = createWorld({ careerId: 'l1', seed: 'live-1', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
    const a = userAuction(w);
    expect(a.live!.phase).toBe('PREPARATION');
    expect(liveTick(w, a, 10_000)).toBe(false); // nothing happens before the user begins
    liveCommand(w, a, { type: 'begin' });
    const phases = new Set<string>();
    for (let i = 0; i < 200; i++) {
      liveTick(w, a, 250);
      phases.add(a.live!.phase);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['PLAYER_INTRODUCTION', 'OPEN_FOR_BIDS']));
    // Bids arrive over time, not all at once: the first lot is not resolved in a single tick.
    const fresh = createWorld({ careerId: 'l2', seed: 'live-1', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
    const b = userAuction(fresh);
    liveCommand(fresh, b, { type: 'begin' });
    liveTick(fresh, b, 3000); // intro over, bidding opens
    const bidsEarly = b.lots[0].bids.length;
    liveTick(fresh, b, 1000);
    // Rapid early paddles are fine, but one second never settles a contested lot.
    expect(b.lots[0].bids.length).toBeLessThanOrEqual(bidsEarly + 6);
    expect(b.lots[0].status).toBe('live');
  });

  it('a full live auction completes with every rule respected and varied AI targets', () => {
    const w = createWorld({ careerId: 'l3', seed: 'live-full', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
    const a = runRoom(w);
    expect(a.status).toBe('complete');
    checkRegistrations(w);
    const sold = a.lots.filter((l) => l.status === 'sold');
    expect(new Set(sold.map((l) => l.playerId)).size).toBe(sold.length); // nobody sold twice
    const buyers = new Set(sold.map((l) => l.soldTo));
    expect(buyers.size).toBeGreaterThanOrEqual(8);
    // Different clubs prioritise different roles.
    const roleMix = [...buyers].map((cid) => sold.filter((l) => l.soldTo === cid).map((l) => w.players[l.playerId].role).sort().join(''));
    expect(new Set(roleMix).size).toBeGreaterThan(3);
    expect(a.live!.results.length).toBeGreaterThan(100);
    expect(a.live!.results.filter((r) => r.status === 'unsold').every((r) => !!r.reason)).toBe(true);
  }, 300_000);

  it('the user can bid, be outbid, respond and win — and is charged correctly', () => {
    const w = createWorld({ careerId: 'l4', seed: 'live-bid', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
    const a = userAuction(w);
    liveCommand(w, a, { type: 'begin' });
    const purseBefore = w.clubs.CHE.purse;
    const target = a.lots[0].playerId;
    let sawOutbid = false;
    let guard = 0;
    while (a.lots[0].status !== 'sold' && a.lots[0].status !== 'unsold' && guard++ < 5000) {
      const live = a.live!;
      if (live.outbid) sawOutbid = true;
      const lead = a.lots[0].bids[a.lots[0].bids.length - 1]?.clubId;
      if ((live.phase === 'OPEN_FOR_BIDS' || live.phase === 'FINAL_CALL') && lead !== 'CHE') {
        const next = permittedBids(w, a)[0];
        if (next <= 30) expect(liveCommand(w, a, { type: 'bid' }).ok).toBe(true);
      }
      liveTick(w, a, 200);
    }
    expect(a.lots[0].status).toBe('sold');
    expect(a.lots[0].soldTo).toBe('CHE');
    expect(sawOutbid).toBe(true);
    expect(w.players[target].clubId).toBe('CHE');
    expect(w.clubs.CHE.squad).toContain(target);
    expect(w.clubs.CHE.purse).toBeCloseTo(purseBefore - a.lots[0].price!, 6);
    // Stale actions on a closed lot are rejected.
    expect(liveCommand(w, a, { type: 'bid', amount: 999 }).ok).toBe(false);
  });

  it('rejects bids that break rules with the exact reason', () => {
    const w = createWorld({ careerId: 'l5', seed: 'live-rules', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
    const a = userAuction(w);
    liveCommand(w, a, { type: 'begin' });
    expect(liveCommand(w, a, { type: 'bid' }).error).toMatch(/opens in a moment/);
    liveTick(w, a, 3000);
    w.clubs.CHE.purse = 0.2;
    const r = liveCommand(w, a, { type: 'bid' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exceeds remaining purse|must be kept/);
    expect(liveCommand(w, a, { type: 'bid', amount: 0.31 }).error).toMatch(/Bids must be one of/);
  });

  it('recovers exactly after a "refresh" (state round-trips through serialisation)', () => {
    const run = (refreshAt: number | null) => {
      let w = createWorld({ careerId: 'l6', seed: 'live-recover', managerName: 'T', difficulty: 'professional', clubId: 'CHE' });
      liveCommand(w, userAuction(w), { type: 'begin' });
      for (let i = 0; i < 600; i++) {
        if (i === refreshAt) w = JSON.parse(JSON.stringify(w)) as WorldState;
        liveTick(w, userAuction(w), 250);
      }
      const a = userAuction(w);
      return JSON.stringify({ lots: a.lots.slice(0, 12).map((l) => [l.status, l.soldTo, l.price, l.bids.length]), live: [a.live!.phase, a.currentLotIndex] });
    };
    expect(run(277)).toEqual(run(null));
  });

  it('is deterministic for the same seed and inputs', () => {
    const go = () => {
      const w = createWorld({ careerId: 'l7', seed: 'live-det', managerName: 'T', difficulty: 'professional', clubId: 'MUM' });
      const a = userAuction(w);
      liveCommand(w, a, { type: 'begin' });
      for (let i = 0; i < 2000; i++) liveTick(w, a, 250);
      return a.live!.results.map((r) => `${r.playerId}:${r.clubId}:${r.price}`).join('|');
    };
    expect(go()).toEqual(go());
  });
});
