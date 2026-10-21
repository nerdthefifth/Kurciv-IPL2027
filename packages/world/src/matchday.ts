import type { Club, CountryCode, Fixture, InningsSummary, MatchResultSummary, Player, StatLine, WorldState } from '@kurciv/domain';
import { emptyStatLine, isSpin, overall, validateXI } from '@kurciv/domain';
import { leagueById, venueById } from '@kurciv/config';
import { ENGINE_VERSION, T20_RULES, type MatchSetup, type MatchState, type Side } from '@kurciv/simulation';
import { battingOrder, buildTeamSetup, pickXI } from '@kurciv/ai';
import { applyToStandings } from './competition';
import { applyMatchLoad, rollInjury, updateForm, updateMorale } from './condition';
import { matchdayIncome } from './finance';
import { addNews, clamp, squadOf, worldRng } from './util';
import { addTimeline, storiesAfterUserMatch } from './story';

const DIFFICULTY_QUALITY = { rookie: 0.35, professional: 0.55, elite: 0.72, legend: 0.88 } as const;

export function tacticalQuality(w: WorldState, club: Club): number {
  const head = club.coaches.find((c) => c.role === 'head')?.rating ?? 55;
  const coach = (head - 60) / 250;
  if (club.isUser) return clamp(0.5 + coach, 0.2, 0.85);
  return clamp(DIFFICULTY_QUALITY[w.difficulty] + coach, 0.15, 0.97);
}

export function matchImportance(w: WorldState, fx: Fixture): number {
  if (fx.stage === 'Final') return 1;
  if (fx.stage !== 'League' && !fx.group) return 0.85;
  if (fx.group) return 0.6;
  const comp = w.competitions[fx.competitionId];
  const played = comp.standings.main?.[0]?.played ?? 0;
  const total = (comp.clubIds.length - 1) * 2;
  return played > total * 0.75 ? 0.45 : 0.3;
}

function domesticOf(w: WorldState, club: Club, fx: Fixture): CountryCode[] {
  // WCC: each club fields its own league's registration rules.
  return leagueById(club.leagueId).domesticCountries;
}

/** The XI a club will field. The user's saved lineup is used when valid. */
export function selectXI(w: WorldState, club: Club, fx: Fixture): { xi: Player[]; note: string | null } {
  const l = leagueById(club.leagueId);
  const squad = squadOf(w, club);
  if (club.isUser && club.lineup?.length) {
    const xi = club.lineup.map((id) => w.players[id]).filter(Boolean);
    const v = validateXI(xi, club.squad, l.squadRules, l.domesticCountries);
    if (v.ok) return { xi, note: null };
    const auto = pickXI(squad, l.squadRules, domesticOf(w, club, fx));
    return { xi: auto, note: `Saved XI was invalid (${v.errors[0]}); the assistant picked the side.` };
  }
  return { xi: pickXI(squad, l.squadRules, domesticOf(w, club, fx)), note: null };
}

export function buildMatchSetup(w: WorldState, fx: Fixture, userXI?: Player[]): MatchSetup {
  const home = w.clubs[fx.homeId];
  const away = w.clubs[fx.awayId];
  const venue = venueById(fx.venueId || home.venueId);
  const tend = w.scouting;
  const team = (club: Club) => {
    const xi = club.isUser && userXI ? userXI : selectXI(w, club, fx).xi;
    const ordered = club.isUser && (userXI || club.lineup) ? xi : battingOrder(xi);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
    const tendencies = club.isUser && tend.userBattingVsPace.length >= 3
      ? { vsPace: avg(tend.userBattingVsPace)!, vsSpin: avg(tend.userBattingVsSpin.length ? tend.userBattingVsSpin : [1.35])! }
      : undefined;
    return buildTeamSetup(club, ordered, club.defaultTactics, tacticalQuality(w, club), tendencies);
  };
  const userSide: Side | null = fx.homeId === w.userClubId ? 'home' : fx.awayId === w.userClubId ? 'away' : null;
  const comp = w.competitions[fx.competitionId];
  return {
    fixtureId: fx.id, competition: comp.name, stage: fx.stage, home: team(home), away: team(away), venue,
    evening: hashEvening(fx.id), importance: matchImportance(w, fx), rules: T20_RULES, userSide,
  };
}

function hashEvening(id: string): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 4 !== 0;
}

export function matchSeed(w: WorldState, fx: Fixture): string {
  return `${w.seed}|${fx.id}`;
}

// ------------------------------------------------------------------ summarising

export function summarise(s: MatchState, fx: Fixture): MatchResultSummary {
  const sideClub = (side: Side) => (side === 'home' ? fx.homeId : fx.awayId);
  const innings: InningsSummary[] = s.innings.filter((i) => !i.superOver).map((inn) => ({
    battingClubId: sideClub(inn.battingSide),
    runs: inn.runs,
    wickets: inn.wickets,
    balls: inn.legalBalls,
    extras: inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes,
    batting: inn.order.filter((id) => inn.batters[id]).map((id) => {
      const b = inn.batters[id];
      return { playerId: id, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, out: b.out?.text ?? null };
    }),
    bowling: Object.values(inn.bowlers).map((b) => ({ playerId: b.playerId, balls: b.balls, runs: b.runs, wickets: b.wickets, dots: b.dots, wides: b.wides, noBalls: b.noBalls })),
    fow: inn.fow.map((f) => ({ wicket: f.wicket, runs: f.runs, ball: f.balls, playerId: f.playerId })),
  }));
  return {
    winnerId: s.result?.winner ? sideClub(s.result.winner) : null,
    margin: s.result?.margin ?? '',
    tossWinnerId: sideClub(s.toss.winner),
    tossDecision: s.toss.decision ?? 'bat',
    innings,
    playerOfMatch: s.result?.playerOfMatch ?? null,
    seed: s.seed,
    engineVersion: ENGINE_VERSION,
    superOver: s.result?.superOver,
  };
}

// ------------------------------------------------------------------ applying a finished match

function addStats(target: StatLine, src: Partial<StatLine> & { hs?: number; bw?: [number, number] }) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'hs' || k === 'bw' || typeof v !== 'number') continue;
    (target as unknown as Record<string, number>)[k] += v;
  }
  if (src.hs !== undefined) target.highScore = Math.max(target.highScore, src.hs);
  if (src.bw) {
    const [wk, r] = src.bw;
    if (wk > target.bestWkts || (wk === target.bestWkts && wk > 0 && r < target.bestRuns)) {
      target.bestWkts = wk;
      target.bestRuns = r;
    }
  }
}

function eloUpdate(w: WorldState, fx: Fixture, winnerId: string | null) {
  const a = w.clubs[fx.homeId];
  const b = w.clubs[fx.awayId];
  const k = w.competitions[fx.competitionId].kind === 'wcc' ? 32 : 24;
  const ea = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
  const sa = winnerId === null ? 0.5 : winnerId === a.id ? 1 : 0;
  const before = { a: a.elo, b: b.elo };
  a.elo = Math.round(a.elo + k * (sa - ea));
  b.elo = Math.round(b.elo - k * (sa - ea));
  return before;
}

/**
 * Applies a completed engine match to the persistent world: fixture result, standings,
 * statistics, fatigue, injuries, morale, form, Elo, finances, records, rivalries and news.
 * Everything is derived from the recorded deliveries, so all views agree with the engine.
 */
export function applyMatch(w: WorldState, fx: Fixture, s: MatchState) {
  if (fx.status === 'complete') throw new Error(`Fixture ${fx.id} already finalised`);
  if (s.status !== 'complete') throw new Error('Match not complete');
  const summary = summarise(s, fx);
  fx.status = 'complete';
  fx.result = summary;
  applyToStandings(w, fx, summary);
  const comp = w.competitions[fx.competitionId];
  const statKey = `${w.season}:${comp.id}`;
  const rng = worldRng(w, `post-${fx.id}`);

  // --- per-player aggregation from the actual innings data
  const xiIds = new Set([...s.setup.home.xi, ...s.setup.away.xi].map((p) => p.id));
  const lines = new Map<string, Partial<StatLine> & { hs?: number; bw?: [number, number] }>();
  const line = (id: string) => {
    let l = lines.get(id);
    if (!l) lines.set(id, (l = { matches: 1 }));
    return l;
  };
  const perf = new Map<string, number>();
  const load = new Map<string, { ballsFaced: number; ballsBowled: number }>();
  for (const id of xiIds) {
    line(id);
    load.set(id, { ballsFaced: 0, ballsBowled: 0 });
  }
  for (const inn of s.innings.filter((i) => !i.superOver)) {
    for (const b of Object.values(inn.batters)) {
      const l = line(b.playerId);
      l.innings = (l.innings ?? 0) + 1;
      l.runs = (l.runs ?? 0) + b.runs;
      l.balls = (l.balls ?? 0) + b.balls;
      l.fours = (l.fours ?? 0) + b.fours;
      l.sixes = (l.sixes ?? 0) + b.sixes;
      if (!b.out) l.notOuts = (l.notOuts ?? 0) + 1;
      if (b.out && b.runs === 0) l.ducks = (l.ducks ?? 0) + 1;
      if (b.runs >= 100) l.hundreds = (l.hundreds ?? 0) + 1;
      else if (b.runs >= 50) l.fifties = (l.fifties ?? 0) + 1;
      l.hs = b.runs;
      load.get(b.playerId)!.ballsFaced += b.balls;
      const sr = b.balls ? (b.runs / b.balls) * 100 : 0;
      perf.set(b.playerId, (perf.get(b.playerId) ?? 0) + (b.runs - 22) / 12 + (b.balls >= 10 ? (sr - 135) / 60 : 0));
      if (b.runs >= 50) {
        const club = w.players[b.playerId].clubId ? w.clubs[w.players[b.playerId].clubId!] : null;
        if (b.runs >= 100 || club?.isUser) {
          addNews(w, {
            kind: 'milestone', importance: b.runs >= 100 ? 2 : 1,
            headline: `${b.runs >= 100 ? 'Century' : 'Fifty'} for ${w.players[b.playerId].name}`,
            body: `${w.players[b.playerId].name} made ${b.runs} off ${b.balls} balls (${b.fours}×4, ${b.sixes}×6) in ${comp.name}.`,
            clubIds: club ? [club.id] : [], playerIds: [b.playerId], sourceRef: fx.id,
          });
        }
      }
    }
    for (const bw of Object.values(inn.bowlers)) {
      const l = line(bw.playerId);
      l.ballsBowled = (l.ballsBowled ?? 0) + bw.balls;
      l.runsConceded = (l.runsConceded ?? 0) + bw.runs;
      l.wickets = (l.wickets ?? 0) + bw.wickets;
      l.dots = (l.dots ?? 0) + bw.dots;
      l.bw = [bw.wickets, bw.runs];
      load.get(bw.playerId)!.ballsBowled += bw.balls;
      const econ = bw.balls ? (bw.runs / bw.balls) * 6 : 9;
      perf.set(bw.playerId, (perf.get(bw.playerId) ?? 0) + bw.wickets * 1.6 + (bw.balls >= 12 ? (8.5 - econ) * 0.45 : 0));
      if (bw.wickets >= 4) {
        const club = w.players[bw.playerId].clubId ? w.clubs[w.players[bw.playerId].clubId!] : null;
        addNews(w, {
          kind: 'milestone', importance: bw.wickets >= 5 ? 2 : 1,
          headline: `${w.players[bw.playerId].name} takes ${bw.wickets}/${bw.runs}`,
          body: `Figures of ${bw.wickets}/${bw.runs} from ${Math.floor(bw.balls / 6)}.${bw.balls % 6} overs in ${comp.name}.`,
          clubIds: club ? [club.id] : [], playerIds: [bw.playerId], sourceRef: fx.id,
        });
      }
    }
  }
  for (const d of s.deliveries) {
    if (!d.wicket?.fielderId || s.innings[d.innings].superOver) continue;
    const l = line(d.wicket.fielderId);
    if (d.wicket.kind === 'caught' || d.wicket.kind === 'caught behind') l.catches = (l.catches ?? 0) + 1;
    if (d.wicket.kind === 'stumped') l.stumpings = (l.stumpings ?? 0) + 1;
    if (d.wicket.kind === 'run out') l.runOuts = (l.runOuts ?? 0) + 1;
  }

  for (const [id, l] of lines) {
    const p = w.players[id];
    if (!p) continue;
    addStats((p.stats.seasons[statKey] ??= emptyStatLine()), l);
    addStats(p.stats.career, l);
  }

  // --- condition, morale, form
  const winnerId = summary.winnerId;
  for (const clubId of [fx.homeId, fx.awayId]) {
    const club = w.clubs[clubId];
    const won = winnerId === clubId;
    const lost = winnerId !== null && !won;
    for (const pid of club.squad) {
      const p = w.players[pid];
      if (!p) continue;
      if (xiIds.has(pid)) {
        const ld = load.get(pid)!;
        applyMatchLoad(p, { ...ld, fielded: true });
        updateForm(p, clamp(perf.get(pid) ?? 0, -4, 6));
        p.benchStreak = 0;
        const pf = perf.get(pid) ?? 0;
        updateMorale(w, p, club, 0.8 + (won ? 2.5 : lost ? -2.2 : 0) + clamp(pf, -2, 3));
        rollInjury(w, p, club, ld.ballsBowled, rng);
      } else {
        p.benchStreak += 1;
        updateMorale(w, p, club, (won ? 0.8 : lost ? -0.8 : 0) - (overall(p) > 72 ? 1.4 : 0.4));
      }
    }
  }

  // --- Elo, upsets, finances, rivalry, records
  const before = eloUpdate(w, fx, winnerId);
  if (winnerId) {
    const winnerElo = winnerId === fx.homeId ? before.a : before.b;
    const loserElo = winnerId === fx.homeId ? before.b : before.a;
    const loserId = winnerId === fx.homeId ? fx.awayId : fx.homeId;
    if (loserElo - winnerElo > 110) {
      addNews(w, {
        kind: 'upset', importance: comp.kind === 'wcc' ? 3 : 2,
        headline: `Upset! ${w.clubs[winnerId].name} stun ${w.clubs[loserId].name}`,
        body: `${w.clubs[winnerId].name} ${summary.margin} against a side rated ${loserElo - winnerElo} Elo points higher (${comp.name}, ${fx.stage}).`,
        clubIds: [winnerId, loserId], playerIds: [], sourceRef: fx.id,
      });
    }
  }
  matchdayIncome(w, fx.homeId, matchImportance(w, fx));
  updateRivalry(w, fx, winnerId);
  updateRecords(w, fx, summary);
  if (fx.involvesUser) trackUserTendencies(w, fx, s);
  if (fx.involvesUser) storiesAfterUserMatch(w, fx, s);
  if (fx.involvesUser) {
    const u = w.clubs[w.userClubId];
    const opp = w.clubs[fx.homeId === u.id ? fx.awayId : fx.homeId];
    addNews(w, {
      kind: 'result', importance: fx.stage === 'Final' ? 3 : 1,
      headline: winnerId === u.id ? `${u.name} beat ${opp.name}` : winnerId ? `${u.name} lose to ${opp.name}` : `${u.name} and ${opp.name} tie`,
      body: `${w.clubs[winnerId ?? fx.homeId].name} ${summary.margin}. ${summary.innings.map((i) => `${w.clubs[i.battingClubId].shortName} ${i.runs}/${i.wickets}`).join(' · ')}.`,
      clubIds: [u.id, opp.id], playerIds: summary.playerOfMatch ? [summary.playerOfMatch] : [], sourceRef: fx.id,
    });
  }
}

function updateRivalry(w: WorldState, fx: Fixture, winnerId: string | null) {
  const ids = [fx.homeId, fx.awayId].sort() as [string, string];
  const key = ids.join('|');
  const r = (w.rivalries[key] ??= { key, clubIds: ids, meetings: 0, knockoutMeetings: 0, finals: 0, intensity: 0, record: { [ids[0]]: 0, [ids[1]]: 0 } });
  r.meetings++;
  const ko = fx.stage !== 'League' && !fx.group;
  if (ko) r.knockoutMeetings++;
  if (fx.stage === 'Final') r.finals++;
  if (winnerId) r.record[winnerId] = (r.record[winnerId] ?? 0) + 1;
  r.intensity = Math.min(100, Math.round(r.meetings * 2 + r.knockoutMeetings * 9 + r.finals * 15 + (w.clubs[ids[0]].city === w.clubs[ids[1]].city ? 20 : 0)));
  if (ko && r.knockoutMeetings >= 3 && r.knockoutMeetings % 3 === 0) {
    addNews(w, {
      kind: 'rivalry', importance: 2,
      headline: `${w.clubs[ids[0]].name} v ${w.clubs[ids[1]].name}: a knockout rivalry`,
      body: `Their ${r.knockoutMeetings}th knockout meeting. Head-to-head: ${r.record[ids[0]]}–${r.record[ids[1]]}.`,
      clubIds: ids, playerIds: [], sourceRef: fx.id,
    });
  }
}

function updateRecords(w: WorldState, fx: Fixture, r: MatchResultSummary) {
  const rec = w.records;
  for (const inn of r.innings) {
    if (!rec.highestTeamTotal || inn.runs > rec.highestTeamTotal.runs) {
      if (rec.highestTeamTotal && inn.runs > rec.highestTeamTotal.runs) {
        addNews(w, { kind: 'milestone', importance: 3, headline: `Record total: ${w.clubs[inn.battingClubId].name} make ${inn.runs}`, body: `The highest total in Kurciv history, beating ${rec.highestTeamTotal.runs}.`, clubIds: [inn.battingClubId], playerIds: [], sourceRef: fx.id });
        w.hallOfFame.push({ id: `hof-${fx.id}-tot`, season: w.season, kind: 'record', title: `Highest team total: ${inn.runs}`, detail: `${w.clubs[inn.battingClubId].name}, ${fx.stage}`, refs: [fx.id] });
        addTimeline(w, 'record', `World record total: ${inn.runs}`, `${w.clubs[inn.battingClubId].name}, ${fx.stage}.`, [fx.id]);
      }
      rec.highestTeamTotal = { runs: inn.runs, clubId: inn.battingClubId, fixtureId: fx.id, season: w.season };
    }
    if (inn.wickets >= 10 && (!rec.lowestTeamTotal || inn.runs < rec.lowestTeamTotal.runs)) {
      rec.lowestTeamTotal = { runs: inn.runs, clubId: inn.battingClubId, fixtureId: fx.id, season: w.season };
    }
    for (const b of inn.batting) {
      if (!rec.highestScore || b.runs > rec.highestScore.runs) rec.highestScore = { runs: b.runs, balls: b.balls, playerId: b.playerId, fixtureId: fx.id, season: w.season };
    }
    for (const b of inn.bowling) {
      if (!rec.bestBowling || b.wickets > rec.bestBowling.wickets || (b.wickets === rec.bestBowling.wickets && b.runs < rec.bestBowling.runs)) {
        rec.bestBowling = { wickets: b.wickets, runs: b.runs, playerId: b.playerId, fixtureId: fx.id, season: w.season };
      }
    }
  }
}

function trackUserTendencies(w: WorldState, fx: Fixture, s: MatchState) {
  const userSide: Side = fx.homeId === w.userClubId ? 'home' : 'away';
  const inn = s.innings.find((i) => i.battingSide === userSide && !i.superOver);
  if (!inn) return;
  const push = (arr: number[], v: number) => {
    arr.push(Math.round(v * 100) / 100);
    if (arr.length > 8) arr.shift();
  };
  if (inn.observed.pace.balls >= 12) push(w.scouting.userBattingVsPace, inn.observed.pace.runs / inn.observed.pace.balls);
  if (inn.observed.spin.balls >= 12) push(w.scouting.userBattingVsSpin, inn.observed.spin.runs / inn.observed.spin.balls);
  // Tactical DNA drifts toward what the user actually does.
  const u = w.clubs[w.userClubId];
  const bowlInn = s.innings.find((i) => i.bowlingSide === userSide && !i.superOver);
  const spinOvers = bowlInn ? Object.values(bowlInn.bowlers).filter((b) => isSpin(s.setup[userSide].xi.find((p) => p.id === b.playerId)!.bowlType)).reduce((a, b) => a + b.balls, 0) / Math.max(1, bowlInn.legalBalls) : 0.3;
  const sr = inn.legalBalls ? (inn.runs / inn.legalBalls) * 100 : 130;
  const blend = (old: number, v: number) => Math.round(old * 0.85 + v * 0.15);
  u.dna.aggression = blend(u.dna.aggression, clamp((sr - 100) * 1.1, 0, 100));
  u.dna.spinReliance = blend(u.dna.spinReliance, spinOvers * 160);
  u.dna.paceReliance = 100 - u.dna.spinReliance;
  u.dna.samples++;
}
