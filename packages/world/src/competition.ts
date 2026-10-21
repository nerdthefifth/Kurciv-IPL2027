import type { Competition, Fixture, MatchResultSummary, StandingRow, WorldState } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import { clubsInLeague } from './util';

export const LEAGUE_WINDOW_DAYS = 54;

export function emptyRow(clubId: string): StandingRow {
  return { clubId, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, runsFor: 0, oversFor: 0, runsAgainst: 0, oversAgainst: 0, form: [] };
}

/** Circle-method round robin. Returns rounds of [home, away] pairs; byes dropped. */
export function roundRobin(ids: string[]): [string, string][][] {
  const teams = [...ids];
  if (teams.length % 2) teams.push('BYE');
  const n = teams.length;
  const rounds: [string, string][][] = [];
  const arr = [...teams];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === 'BYE' || b === 'BYE') continue;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

export function nrr(row: StandingRow): number {
  const f = row.oversFor ? row.runsFor / (row.oversFor / 6) : 0;
  const a = row.oversAgainst ? row.runsAgainst / (row.oversAgainst / 6) : 0;
  return Math.round((f - a) * 1000) / 1000;
}

export function sortRows(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((x, y) => y.points - x.points || nrr(y) - nrr(x) || y.won - x.won || x.clubId.localeCompare(y.clubId));
}

export function createLeagueCompetition(w: WorldState, leagueId: string): Competition {
  const l = leagueById(leagueId);
  const clubs = clubsInLeague(w, leagueId);
  const id = `${leagueId}-${w.season}`;
  const comp: Competition = {
    id, kind: 'league', leagueId, season: w.season, name: `${l.name} ${w.season}`, clubIds: clubs.map((c) => c.id),
    standings: { main: clubs.map((c) => emptyRow(c.id)) }, stage: 'league', championId: null, runnerUpId: null,
  };
  w.competitions[id] = comp;
  let rounds = roundRobin(comp.clubIds);
  if (l.rounds === 2) rounds = [...rounds, ...rounds.map((r) => r.map(([h, a]) => [a, h] as [string, string]))];
  const gap = Math.max(2, Math.floor(LEAGUE_WINDOW_DAYS / rounds.length));
  let n = 0;
  rounds.forEach((pairs, r) => {
    pairs.forEach(([home, away], i) => {
      const fx: Fixture = {
        id: `${id}-M${++n}`, competitionId: id, season: w.season, day: l.seasonStartDay + r * gap + (i % gap), stage: 'League',
        homeId: home, awayId: away, venueId: w.clubs[home].venueId, status: 'scheduled', result: null,
        involvesUser: home === w.userClubId || away === w.userClubId,
      };
      w.fixtures[fx.id] = fx;
    });
  });
  return comp;
}

export function lastLeagueDay(w: WorldState, compId: string): number {
  return Math.max(...Object.values(w.fixtures).filter((f) => f.competitionId === compId).map((f) => f.day));
}

/** Records a completed result into the competition's standings (league or group stage only). */
export function applyToStandings(w: WorldState, fx: Fixture, r: MatchResultSummary) {
  const comp = w.competitions[fx.competitionId];
  const key = fx.group ?? 'main';
  const rows = comp.standings[key];
  if (!rows || (fx.stage !== 'League' && !fx.group)) return;
  const home = rows.find((x) => x.clubId === fx.homeId)!;
  const away = rows.find((x) => x.clubId === fx.awayId)!;
  const main = r.innings.slice(0, 2);
  for (const inn of main) {
    const batRow = inn.battingClubId === fx.homeId ? home : away;
    const bowlRow = batRow === home ? away : home;
    // NRR convention: a side bowled out is charged its full quota of overs.
    const balls = inn.wickets >= 10 ? 120 : inn.balls;
    batRow.runsFor += inn.runs;
    batRow.oversFor += balls;
    bowlRow.runsAgainst += inn.runs;
    bowlRow.oversAgainst += balls;
  }
  home.played++;
  away.played++;
  if (r.winnerId === null) {
    home.tied++;
    away.tied++;
    home.points += 1;
    away.points += 1;
    home.form.push('T');
    away.form.push('T');
  } else {
    const [win, lose] = r.winnerId === fx.homeId ? [home, away] : [away, home];
    win.won++;
    lose.lost++;
    win.points += 2;
    win.form.push('W');
    lose.form.push('L');
  }
  home.form = home.form.slice(-5);
  away.form = away.form.slice(-5);
  comp.standings[key] = sortRows(rows);
}

/** Creates the playoff bracket once every league fixture is complete. */
export function maybeCreatePlayoffs(w: WorldState, compId: string): boolean {
  const comp = w.competitions[compId];
  if (comp.kind !== 'league' || comp.stage !== 'league') return false;
  const fxs = Object.values(w.fixtures).filter((f) => f.competitionId === compId);
  if (fxs.some((f) => f.status !== 'complete')) return false;
  const l = leagueById(comp.leagueId!);
  const table = sortRows(comp.standings.main);
  const pos = (i: number) => table[i].clubId;
  const d0 = Math.max(...fxs.map((f) => f.day)) + 3;
  const mk = (n: string, day: number, home: string | null, away: string | null, homeRef?: string, awayRef?: string): Fixture => {
    const fx: Fixture = {
      id: `${compId}-${n.replace(/\s+/g, '')}`, competitionId: compId, season: w.season, day, stage: n,
      homeId: home ?? '', awayId: away ?? '', homeRef, awayRef, venueId: home ? w.clubs[home].venueId : '', status: 'scheduled', result: null,
      involvesUser: home === w.userClubId || away === w.userClubId,
    };
    w.fixtures[fx.id] = fx;
    return fx;
  };
  comp.stage = 'playoffs';
  if (l.playoffs === 'ipl4' && table.length >= 4) {
    const q1 = mk('Qualifier 1', d0, pos(0), pos(1));
    const el = mk('Eliminator', d0 + 1, pos(2), pos(3));
    const q2 = mk('Qualifier 2', d0 + 3, null, null, `loser:${q1.id}`, `winner:${el.id}`);
    mk('Final', d0 + 5, null, null, `winner:${q1.id}`, `winner:${q2.id}`);
  } else if (l.playoffs === 'semis' && table.length >= 4) {
    const s1 = mk('Semi-final 1', d0, pos(0), pos(3));
    const s2 = mk('Semi-final 2', d0 + 1, pos(1), pos(2));
    mk('Final', d0 + 3, null, null, `winner:${s1.id}`, `winner:${s2.id}`);
  } else if (l.playoffs === 'final2' && table.length >= 2) {
    mk('Final', d0, pos(0), pos(1));
  } else {
    comp.stage = 'complete';
    comp.championId = pos(0);
    comp.runnerUpId = table[1]?.clubId ?? null;
  }
  return true;
}

/** Fills in knockout participants whose source fixtures are now complete. */
export function resolveRefs(w: WorldState) {
  for (const fx of Object.values(w.fixtures)) {
    if (fx.status !== 'scheduled') continue;
    for (const side of ['home', 'away'] as const) {
      const ref = side === 'home' ? fx.homeRef : fx.awayRef;
      const cur = side === 'home' ? fx.homeId : fx.awayId;
      if (!ref || cur) continue;
      const [kind, src] = ref.split(':');
      const s = w.fixtures[src];
      if (!s || s.status !== 'complete' || !s.result) continue;
      const winner = s.result.winnerId ?? s.homeId; // ties are always decided by super over in knockouts
      const loser = winner === s.homeId ? s.awayId : s.homeId;
      const id = kind === 'winner' ? winner : loser;
      if (side === 'home') {
        fx.homeId = id;
        fx.venueId = w.clubs[id].venueId;
      } else fx.awayId = id;
      fx.involvesUser = fx.homeId === w.userClubId || fx.awayId === w.userClubId;
    }
    if (fx.homeId && !fx.venueId) fx.venueId = w.clubs[fx.homeId].venueId;
  }
}

/** Marks a league competition complete once its final is played. */
export function maybeCompleteCompetition(w: WorldState, compId: string): boolean {
  const comp = w.competitions[compId];
  if (comp.stage === 'complete') return false;
  const final = Object.values(w.fixtures).find((f) => f.competitionId === compId && f.stage === 'Final');
  if (!final || final.status !== 'complete' || !final.result) return false;
  comp.stage = 'complete';
  comp.championId = final.result.winnerId ?? final.homeId;
  comp.runnerUpId = comp.championId === final.homeId ? final.awayId : final.homeId;
  return true;
}

/** Final finishing order for a league: champion, runner-up, then table order. */
export function finishingOrder(w: WorldState, compId: string): string[] {
  const comp = w.competitions[compId];
  const table = sortRows(comp.standings.main ?? []).map((r) => r.clubId);
  const head = [comp.championId, comp.runnerUpId].filter(Boolean) as string[];
  return [...head, ...table.filter((id) => !head.includes(id))];
}
