import { describe, expect, it } from 'vitest';
import { LEAGUES, WORLD, leagueById } from '@kurciv/config';
import { isOverseas, type WorldState } from '@kurciv/domain';
import { advance, advanceCascade, auctionAct, autoFillUserSquad, commitRetentions, createWorld, endSeason, setUserRetentions, squadOf, startSeason } from '../index';
import { allocateSlots, planFormat } from '../wcc';

function checkInvariants(w: WorldState) {
  const seen = new Map<string, string>();
  for (const c of Object.values(w.clubs)) {
    const l = leagueById(c.leagueId);
    for (const id of c.squad) {
      expect(seen.has(id), `${id} registered at ${seen.get(id)} and ${c.id}`).toBe(false);
      seen.set(id, c.id);
      expect(w.players[id].clubId).toBe(c.id);
    }
    const squad = squadOf(w, c);
    expect(squad.length).toBeLessThanOrEqual(l.squadRules.maxSquad);
    const os = squad.filter((p) => isOverseas(p, l.domesticCountries));
    expect(os.length).toBeLessThanOrEqual(l.squadRules.maxOverseas);
    const byC: Record<string, number> = {};
    for (const p of os) byC[p.country] = (byC[p.country] ?? 0) + 1;
    for (const n of Object.values(byC)) expect(n).toBeLessThanOrEqual(l.squadRules.maxPerOverseasCountry);
    expect(c.purse).toBeGreaterThanOrEqual(-1e-6);
  }
  for (const p of Object.values(w.players)) if (p.clubId) expect(w.clubs[p.clubId].squad).toContain(p.id);
}

function runAuctions(w: WorldState) {
  let guard = 0;
  while (!advanceCascade(w) && guard++ < 10) {
    const live = Object.values(w.auctions).find((a) => a.interactive && a.status === 'live')!;
    const r = auctionAct(w, live.id, { type: 'sim', until: 'end', assistant: true }, live.version);
    expect(r.ok, r.error).toBe(true);
  }
  w.phase = 'preseason';
  autoFillUserSquad(w);
}

describe('career', () => {
  it('runs two full seasons with auctions, WCC, reputation and retentions', () => {
    const w = createWorld({ careerId: 'c1', seed: 'career-test', managerName: 'Test', difficulty: 'professional', clubId: 'MUM' });
    expect(w.phase).toBe('auction');
    runAuctions(w);
    checkInvariants(w);
    // Every IPL club has a legal squad; the IPL auctioned first.
    expect(w.auctionOrder[0]).toContain('IPL');
    for (const c of Object.values(w.clubs).filter((x) => x.leagueId === 'IPL')) expect(c.squad.length).toBeGreaterThanOrEqual(18);

    expect(startSeason(w)).toEqual([]);
    const totalSlots = Object.values(w.leagues).reduce((s, l) => s + l.wccSlots, 0);
    expect(totalSlots).toBeLessThanOrEqual(50);
    expect(w.leagues.IPL.wccSlots).toBeGreaterThanOrEqual(Math.max(...Object.values(w.leagues).map((l) => l.wccSlots)));

    const res = advance(w, 'season');
    expect(w.phase).toBe('offseason');
    expect(res.records.length).toBeGreaterThan(400);
    checkInvariants(w);
    // Standings agree with results
    for (const l of LEAGUES) {
      const comp = w.competitions[`${l.id}-${w.season}`];
      expect(comp.stage).toBe('complete');
      const leagueFx = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id && f.stage === 'League');
      const played = comp.standings.main.reduce((s, r) => s + r.played, 0);
      expect(played).toBe(leagueFx.length * 2);
      const pts = comp.standings.main.reduce((s, r) => s + r.points, 0);
      expect(pts).toBe(leagueFx.length * 2);
    }
    const wcc = w.competitions[`WCC-${w.season}`];
    expect(wcc.clubIds.length).toBe(totalSlots);
    expect(wcc.championId).toBeTruthy();
    // Player stats agree with match summaries
    const kohli = w.players['p-virat-kohli'];
    const fromFixtures = Object.values(w.fixtures).filter((f) => f.result).reduce((s, f) => s + f.result!.innings.flatMap((i) => i.batting).filter((b) => b.playerId === kohli.id).reduce((a, b) => a + b.runs, 0), 0);
    expect(kohli.stats.career.runs).toBe(fromFixtures);

    const repBefore = { ...Object.fromEntries(Object.entries(w.leagues).map(([k, v]) => [k, v.reputation])) };
    endSeason(w);
    expect(w.season).toBe(WORLD.startSeason + 1);
    expect(w.phase).toBe('retention');
    expect(Object.entries(w.leagues).some(([k, v]) => v.reputation !== repBefore[k])).toBe(true);
    expect(w.history).toHaveLength(1);

    // Retain the user's best three (validated), then roll into the next cascade.
    const user = w.clubs[w.userClubId];
    const keep = [...user.squad].sort((a, b) => w.players[b].reputation - w.players[a].reputation).slice(0, 3);
    expect(setUserRetentions(w, keep)).toBeNull();
    expect(setUserRetentions(w, user.squad.slice(0, 7))).toMatch(/At most 6/);
    commitRetentions(w);
    for (const c of Object.values(w.clubs)) expect(c.squad.length).toBeLessThanOrEqual(6 + 2);
    expect(user.squad).toEqual(expect.arrayContaining(keep));
    runAuctions(w);
    checkInvariants(w);
    expect(startSeason(w)).toEqual([]);
    advance(w, 'season');
    expect(w.phase).toBe('offseason');
    checkInvariants(w);
  }, 300_000);

  it('rejects invalid custom clubs and duplicate identities', () => {
    expect(() => createWorld({ careerId: 'c2', seed: 's', managerName: 'x', difficulty: 'rookie', customClub: { name: 'Mumbai Indians', shortName: 'MMX', city: 'Mumbai', leagueId: 'IPL', colors: ['#000', '#fff'] } })).toThrow(/already exists/);
    expect(() => createWorld({ careerId: 'c2', seed: 's', managerName: 'x', difficulty: 'rookie', customClub: { name: 'Pune Pythons', shortName: 'MUM', city: 'Pune', leagueId: 'IPL', colors: ['#000', '#fff'] } })).toThrow(/already used/);
    const w = createWorld({ careerId: 'c3', seed: 's', managerName: 'x', difficulty: 'rookie', customClub: { name: 'Pune Pythons', shortName: 'PUP', city: 'Pune', leagueId: 'IPL', colors: ['#000', '#fff'] } });
    expect(w.clubs.PUP.isUser).toBe(true);
    expect(Object.values(w.clubs).filter((c) => c.isUser)).toHaveLength(1);
  });
});

describe('qualification allocation', () => {
  const cfg = WORLD.wcc;
  it('never exceeds 50, respects caps, and is deterministic', () => {
    const leagues = Array.from({ length: 14 }, (_, i) => ({ id: `L${i}`, reputation: 95 - i * 5, clubs: 6 + (i % 5), history: 0.5 }));
    const a = allocateSlots(leagues, cfg);
    const b = allocateSlots(leagues, cfg);
    expect(a).toEqual(b);
    const total = Object.values(a).reduce((s, n) => s + n, 0);
    expect(total).toBeLessThanOrEqual(50);
    for (const l of leagues) {
      expect(a[l.id]).toBeLessThanOrEqual(Math.min(cfg.maxSlotsPerLeague, Math.floor(l.clubs * cfg.maxShareOfClubs)));
      expect(a[l.id]).toBeGreaterThanOrEqual(1);
    }
    // Higher reputation never receives fewer places than a lower one with equal depth.
    expect(a.L0).toBeGreaterThanOrEqual(a.L5);
  });

  it('redistributes places a small league cannot use', () => {
    const r = allocateSlots([{ id: 'BIG', reputation: 95, clubs: 10, history: 0.5 }, { id: 'TINY', reputation: 94, clubs: 2, history: 0.5 }], cfg);
    expect(r.TINY).toBeLessThanOrEqual(1);
    expect(r.BIG).toBe(8);
  });

  it('plans formats for any qualifier count', () => {
    expect(planFormat(50)).toMatchObject({ groups: 8, prelimTeams: 36 });
    expect(planFormat(32)).toMatchObject({ groups: 8, prelimTeams: 0 });
    expect(planFormat(20)).toMatchObject({ groups: 4, prelimTeams: 8 });
    expect(planFormat(5).knockout).toEqual(['Final']);
  });
});
