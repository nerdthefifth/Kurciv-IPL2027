import { describe, expect, it } from 'vitest';
import { DIVISIONS, PYRAMID, VENUES, stadiumCatalogue } from '@kurciv/config';
import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { overall } from '@kurciv/domain';
import { buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { TEST_RULES, matchBallsUsed } from '@kurciv/simulation';
import { createWorld, emptyRow, enterPreseason, playersOnDuty, previewFriendly, promoteAndRelegate, seedPreview } from '../index';

const world = () => createWorld({ careerId: 'u', seed: 'universe-test', managerName: 'U', difficulty: 'professional', clubId: 'MUM' });

describe('global universe', () => {
  it('builds the pyramid and the player population', () => {
    const w = world();
    expect(w.worldModel).toBe('pyramid');
    for (const d of DIVISIONS) expect(Object.values(w.clubs).filter((c) => c.leagueId === d.id).length).toBe(PYRAMID.clubsPerDivision);
    const ps = Object.values(w.players);
    const real = ps.filter((p) => p.source === 'curated' || p.source === 'registry');
    const fictional = ps.filter((p) => p.source === 'generated' || p.source === 'youth');
    expect(real.length).toBeGreaterThanOrEqual(1300);
    expect(fictional.length).toBeGreaterThanOrEqual(10000);
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    const cricsheet = real.map((p) => p.realWorld?.cricsheetId).filter(Boolean);
    expect(new Set(cricsheet).size).toBe(cricsheet.length);
    // Seeding preview matches the world.
    const preview = seedPreview();
    for (const c of Object.values(w.clubs)) expect(preview[c.id]).toBe(c.leagueId);
    // Every club's home ground is in the catalogue, and fictional grounds carry provenance.
    for (const c of Object.values(w.clubs)) expect(stadiumCatalogue().some((v) => v.id === c.venueId)).toBe(true);
    expect(stadiumCatalogue().filter((v) => v.fictional).every((v) => v.provenance && v.identity)).toBe(true);
  });

  it('promotes and relegates deterministically from final standings', () => {
    const run = () => {
      const w = world();
      for (const d of DIVISIONS) {
        const ids = Object.values(w.clubs).filter((c) => c.leagueId === d.id).map((c) => c.id).sort();
        const rows = ids.map((id, i) => ({ ...emptyRow(id), played: 17, points: 2 * (17 - i), won: 17 - i }));
        w.competitions[`${d.id}-${w.season}`] = { id: `${d.id}-${w.season}`, kind: 'league', leagueId: d.id, season: w.season, name: d.name, clubIds: ids, standings: { main: rows }, stage: 'complete', championId: ids[0], runnerUpId: ids[1] };
      }
      return promoteAndRelegate(w).map((m) => `${m.clubId}:${m.from}>${m.to}`);
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.length).toBe((DIVISIONS.length - 1) * (PYRAMID.promote + PYRAMID.relegate));
  });

  it('schedules internationals without clashes and marks call-ups', () => {
    const w = world();
    enterPreseason(w);
    const st = w.universe!.international;
    const evs = Object.values(st.events);
    expect(evs.length).toBeGreaterThan(5);
    // No nation plays two matches on the same day (Tests occupy five days).
    const busy = new Map<string, number[]>();
    for (const f of Object.values(st.fixtures)) {
      for (const n of [f.homeId, f.awayId]) {
        const days = busy.get(n) ?? [];
        for (let d = f.day; d < f.day + f.days; d++) {
          expect(days.includes(d), `${n} double-booked on day ${d}`).toBe(false);
          days.push(d);
        }
        busy.set(n, days);
      }
    }
    const ev = evs[0];
    expect(playersOnDuty(w, ev.startDay).size).toBeGreaterThan(0);
  });

  it('validates preseason friendlies before booking them', () => {
    const w = world();
    enterPreseason(w);
    const opp = Object.values(w.clubs).find((c) => c.leagueId === w.clubs.MUM.leagueId && c.id !== 'MUM')!;
    expect(previewFriendly(w, { opponentId: opp.id, day: 10, venue: 'home', purpose: 'fitness', mode: 'sim' }).ok).toBe(false);
    expect(previewFriendly(w, { opponentId: 'MUM', day: 50, venue: 'home', purpose: 'fitness', mode: 'sim' }).ok).toBe(false);
  });
});

describe('Test cricket', () => {
  it('plays two innings a side within five days, with results and draws possible', () => {
    const pool = CURATED_PLAYERS.map((r) => expandCurated(r, 2027));
    const side = (c: string) => pickXI(pool.filter((p) => p.country === c).sort((a, b) => overall(b) - overall(a)), { maxSquad: 30, minSquad: 11, maxOverseas: 0, maxPerOverseasCountry: 0, maxOverseasInXI: 0, maxRetentions: 0, retentionCosts: [], uncappedRetentionCost: 0 }, [c as never]);
    for (let i = 0; i < 4; i++) {
      const s = simulateMatch({
        fixtureId: `t-${i}`, competition: 'Test', stage: 'Test', venue: VENUES[i * 7], evening: false, importance: 0.5, rules: TEST_RULES, userSide: null,
        home: buildTeamSetup({ id: 'A', name: 'A', shortName: 'A', colors: ['#fff', '#000'] }, side('IND'), defaultTactics(), 0.6),
        away: buildTeamSetup({ id: 'B', name: 'B', shortName: 'B', colors: ['#fff', '#000'] }, side('AUS'), defaultTactics(), 0.6),
      }, `test-${i}`);
      expect(s.status).toBe('complete');
      expect(s.innings.filter((x) => !x.superOver).length).toBeLessThanOrEqual(4);
      expect(matchBallsUsed(s)).toBeLessThanOrEqual(450 * 6);
      expect(s.innings.slice(3).every((x) => !x.declared)).toBe(true);
      expect(s.result!.drawn || s.result!.winner !== null || /tied/i.test(s.result!.margin)).toBe(true);
    }
  });
});
