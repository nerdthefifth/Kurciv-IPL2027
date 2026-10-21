import type { BoardObjective, Club, Fixture, Player, SeasonAward, WorldState } from '@kurciv/domain';
import { ageOf, isOverseas, marketValue, overall } from '@kurciv/domain';
import { LEAGUES, WORLD, leagueById } from '@kurciv/config';
import { generatePlayer } from '@kurciv/data-ingestion';
import { pickXI, simulateMatch } from '@kurciv/ai';
import type { MatchState } from '@kurciv/simulation';
import { advanceCascade, setupAuctions } from './auction';
import { createLeagueCompetition, finishingOrder, lastLeagueDay, maybeCompleteCompetition, maybeCreatePlayoffs, resolveRefs, sortRows } from './competition';
import { developPlayer, recoverDay, retirementChance } from './condition';
import { COUNTRY_DEPTH } from './create';
import { recordTransaction, seasonStartFinances } from './finance';
import { applyMatch, buildMatchSetup, matchSeed } from './matchday';
import { addNews, clamp, clubsInLeague, nextId, round2, squadOf, worldRng } from './util';
import { aiInjuryCover } from './transfers';
import { allocateForWorld, createWCC, progressWCC, updateReputations } from './wcc';
import { roleDemand } from './auction-live';
import { addTimeline, buildChronicle, storiesDaily, storyAuctionEve } from './story';
import { pruneImpacts } from './impact';

export interface MatchRecord {
  fixtureId: string;
  state: MatchState;
}

// ------------------------------------------------------------------ preseason

export function squadProblems(w: WorldState, club: Club): string[] {
  const l = leagueById(club.leagueId);
  const squad = squadOf(w, club);
  const out: string[] = [];
  if (squad.length < l.squadRules.minSquad) out.push(`Squad has ${squad.length} players; the ${l.shortName} minimum is ${l.squadRules.minSquad}. Sign free agents in Transfers.`);
  if (squad.length > l.squadRules.maxSquad) out.push(`Squad has ${squad.length} players; the maximum is ${l.squadRules.maxSquad}.`);
  const os = squad.filter((p) => isOverseas(p, l.domesticCountries));
  if (os.length > l.squadRules.maxOverseas) out.push(`${os.length} overseas players registered; the maximum is ${l.squadRules.maxOverseas}.`);
  const byC: Record<string, number> = {};
  for (const p of os) byC[p.country] = (byC[p.country] ?? 0) + 1;
  for (const [c, n] of Object.entries(byC)) if (n > l.squadRules.maxPerOverseasCountry) out.push(`${n} overseas players from ${c}; the maximum is ${l.squadRules.maxPerOverseasCountry}.`);
  return out;
}

function boardObjectives(w: WorldState, club: Club): BoardObjective[] {
  const l = leagueById(club.leagueId);
  const clubs = clubsInLeague(w, l.id);
  const strength = (c: Club) => {
    const sq = squadOf(w, c);
    return sq.length >= 11 ? pickXI(sq, l.squadRules, l.domesticCountries).reduce((a, p) => a + overall(p), 0) : 0;
  };
  const rank = [...clubs].sort((a, b) => strength(b) - strength(a)).findIndex((c) => c.id === club.id) + 1;
  const objs: BoardObjective[] = [];
  // Never easier than "avoid the wooden spoon"; stronger squads are expected to finish near their ranking.
  const target = Math.min(clubs.length - 1, Math.max(1, rank + 1));
  objs.push({ id: nextId(w, 'obj'), description: `Finish in the top ${target} of the ${l.shortName} table (squad ranked #${rank} by the board).`, kind: 'league-position', target, importance: 'high', status: 'pending' });
  if (rank <= 4) objs.push({ id: nextId(w, 'obj'), description: 'Reach the playoffs.', kind: 'playoffs', target: 4, importance: 'medium', status: 'pending' });
  if (w.leagues[l.id].wccSlots > 0 && rank <= w.leagues[l.id].wccSlots + 1) objs.push({ id: nextId(w, 'obj'), description: 'Qualify for the World Club Championship.', kind: 'wcc-qualify', target: 1, importance: 'medium', status: 'pending' });
  objs.push({ id: nextId(w, 'obj'), description: 'Give at least one academy or under-23 player a debut.', kind: 'youth-debuts', target: 1, importance: 'low', status: 'pending' });
  objs.push({ id: nextId(w, 'obj'), description: 'Keep cash reserves above zero.', kind: 'finance', target: 0, importance: 'medium', status: 'pending' });
  return objs;
}

/** Called when auctions are done and the user's squad is valid. */
export function startSeason(w: WorldState): string[] {
  const problems = squadProblems(w, w.clubs[w.userClubId]);
  if (problems.length) return problems;
  if (!Object.values(w.leagues).some((l) => l.wccSlots > 0)) allocateForWorld(w);
  for (const l of LEAGUES) createLeagueCompetition(w, l.id);
  for (const c of Object.values(w.clubs)) {
    c.board.objectives = boardObjectives(w, c);
    // Initial Elo reflects the squad actually assembled at auction.
    if (w.season === WORLD.startSeason) {
      const l = leagueById(c.leagueId);
      const sq = squadOf(w, c);
      const xi = sq.length >= 11 ? pickXI(sq, l.squadRules, l.domesticCountries).reduce((a, p) => a + overall(p), 0) / 11 : 55;
      c.elo = Math.round(1500 + (xi - 68) * 18);
    }
  }
  seasonStartFinances(w);
  w.phase = 'season';
  w.day = Math.min(...LEAGUES.map((l) => l.seasonStartDay)) - 1;
  addTimeline(w, 'season', `The ${w.season} season begins`, w.clubs[w.userClubId].board.objectives.map((o) => o.description).join(' '));
  addNews(w, { kind: 'board', importance: 2, headline: `${w.season} season under way`, body: w.clubs[w.userClubId].board.objectives.map((o) => o.description).join(' '), clubIds: [w.userClubId], playerIds: [], sourceRef: `season-${w.season}` });
  return [];
}

// ------------------------------------------------------------------ the calendar

export function fixturesOnDay(w: WorldState, day: number): Fixture[] {
  return Object.values(w.fixtures).filter((f) => f.day === day && f.status === 'scheduled' && f.homeId && f.awayId).sort((a, b) => a.id.localeCompare(b.id));
}

export function nextUserFixture(w: WorldState): Fixture | null {
  return Object.values(w.fixtures)
    .filter((f) => f.involvesUser && f.status !== 'complete' && f.homeId && f.awayId)
    .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))[0] ?? null;
}

export interface AdvanceResult {
  records: MatchRecord[];
  stoppedFor: 'user-match' | 'phase' | 'limit' | 'idle';
  fixtureId?: string;
  messages: string[];
}

/** Simulate every AI fixture due today, then rest/recover everyone. */
function processDay(w: WorldState, records: MatchRecord[], autoUser: boolean): Fixture | null {
  resolveRefs(w);
  for (const fx of fixturesOnDay(w, w.day)) {
    if (fx.involvesUser && !autoUser) return fx;
    const setup = buildMatchSetup(w, fx);
    const state = simulateMatch(setup, matchSeed(w, fx));
    applyMatch(w, fx, state);
    records.push({ fixtureId: fx.id, state });
  }
  return null;
}

function endOfDay(w: WorldState) {
  for (const c of Object.values(w.clubs)) recoverDay(w, c);
  if (w.day % 3 === 0) aiInjuryCover(w);
  storiesDaily(w);
  for (const l of LEAGUES) {
    const id = `${l.id}-${w.season}`;
    if (!w.competitions[id]) continue;
    maybeCreatePlayoffs(w, id);
    resolveRefs(w);
    if (maybeCompleteCompetition(w, id)) onLeagueComplete(w, id);
  }
  if (w.phase === 'season' && LEAGUES.every((l) => w.competitions[`${l.id}-${w.season}`]?.stage === 'complete')) {
    w.phase = 'wcc';
    const start = Math.max(...LEAGUES.map((l) => lastLeagueDay(w, `${l.id}-${w.season}`))) + WORLD.wcc.startDayAfterLeagues;
    createWCC(w, start);
  }
  if (w.phase === 'wcc') {
    while (progressWCC(w)) resolveRefs(w);
    if (w.competitions[`WCC-${w.season}`]?.stage === 'complete') {
      w.phase = 'offseason';
      seasonAwards(w);
    }
  }
  w.day++;
}

/**
 * Advances the world. `mode`:
 *  - 'day': one calendar day
 *  - 'next': until the user's next match (or a phase change)
 *  - 'season': through to the end of the season, auto-playing the user's matches with the assistant
 */
export function advance(w: WorldState, mode: 'day' | 'next' | 'season'): AdvanceResult {
  const records: MatchRecord[] = [];
  const messages: string[] = [];
  if (w.phase !== 'season' && w.phase !== 'wcc') return { records, stoppedFor: 'phase', messages: ['Not in season.'] };
  const autoUser = mode === 'season' || w.settings.autoPlayUserMatches;
  let guard = 0;
  const startPhase = w.phase;
  while (guard++ < 400) {
    const blocked = processDay(w, records, autoUser);
    if (blocked) return { records, stoppedFor: 'user-match', fixtureId: blocked.id, messages };
    endOfDay(w);
    if ((w.phase as string) === 'offseason') return { records, stoppedFor: 'phase', messages: ['Season complete — review the awards, then begin the off-season.'] };
    if (w.phase !== startPhase && mode !== 'season') return { records, stoppedFor: 'phase', messages: ['The World Club Championship is about to begin.'] };
    if (mode === 'day') return { records, stoppedFor: 'limit', messages };
    if (mode === 'next') {
      const nf = nextUserFixture(w);
      if (nf && nf.day === w.day) return { records, stoppedFor: 'user-match', fixtureId: nf.id, messages };
    }
  }
  return { records, stoppedFor: 'idle', messages };
}

/** Finalises a user match that was played interactively (or quick-simmed) on the server. */
export function completeUserFixture(w: WorldState, fixtureId: string, state: MatchState) {
  const fx = w.fixtures[fixtureId];
  if (!fx || !fx.involvesUser) throw new Error('Not your fixture');
  if (fx.day !== w.day) throw new Error('That fixture is not scheduled for today');
  applyMatch(w, fx, state);
}

function onLeagueComplete(w: WorldState, compId: string) {
  const comp = w.competitions[compId];
  const l = leagueById(comp.leagueId!);
  const champ = w.clubs[comp.championId!];
  champ.trophies.push({ season: w.season, competitionId: compId, name: l.name });
  if (champ.isUser) addTimeline(w, 'title', `${l.name} champions`, `${champ.name} win the ${w.season} title.`, [compId]);
  champ.brand = Math.min(100, champ.brand + 3);
  champ.fanBase = Math.min(100, champ.fanBase + 3);
  w.leagues[l.id].champions.push({ season: w.season, clubId: champ.id, clubName: champ.name });
  recordTransaction(w, champ.id, 'prize', l.prizeMoney.champion, `${l.shortName} champions`);
  if (comp.runnerUpId) recordTransaction(w, comp.runnerUpId, 'prize', l.prizeMoney.runnerUp, `${l.shortName} runners-up`);
  const titles = champ.trophies.filter((t) => t.competitionId.startsWith(`${l.id}-`)).length;
  addNews(w, {
    kind: 'result', importance: 3, headline: `${champ.name} win the ${l.name}`,
    body: `${champ.name} beat ${w.clubs[comp.runnerUpId!].name} in the final — title #${titles}.`, clubIds: [champ.id], playerIds: [], sourceRef: compId,
  });
  const recent = w.leagues[l.id].champions.slice(-3);
  if (recent.length === 3 && recent.every((c) => c.clubId === champ.id)) {
    w.hallOfFame.push({ id: `hof-${compId}-dyn`, season: w.season, kind: 'dynasty', title: `${champ.name}: three in a row`, detail: `${l.name} ${recent.map((r) => r.season).join(', ')}`, refs: [compId] });
  }
  const slots = w.leagues[l.id].wccSlots;
  const order = finishingOrder(w, compId);
  const u = order.indexOf(w.userClubId);
  if (comp.clubIds.includes(w.userClubId) && u >= slots && slots > 0) {
    addNews(w, { kind: 'qualification', importance: 2, headline: `${w.clubs[w.userClubId].name} miss out on the World Club Championship`, body: `${l.shortName} had ${slots} places; ${w.clubs[w.userClubId].name} finished ${u + 1}.`, clubIds: [w.userClubId], playerIds: [], sourceRef: compId });
  }
}

// ------------------------------------------------------------------ awards & season end

function seasonAwards(w: WorldState) {
  for (const l of LEAGUES) {
    const compId = `${l.id}-${w.season}`;
    const key = `${w.season}:${compId}`;
    const ps = Object.values(w.players).filter((p) => p.stats.seasons[key]);
    if (!ps.length) continue;
    const s = (p: Player) => p.stats.seasons[key];
    const add = (award: SeasonAward['award'], p: Player | undefined, value: string) => {
      if (!p) return;
      const a: SeasonAward = { season: w.season, competitionId: compId, award, playerId: p.id, value };
      w.awards.push(a);
      if (p.clubId === w.userClubId || l.id === w.clubs[w.userClubId].leagueId) {
        addNews(w, { kind: 'award', importance: 2, headline: `${award}: ${p.name}`, body: `${l.shortName} ${w.season} — ${value}.`, clubIds: p.clubId ? [p.clubId] : [], playerIds: [p.id], sourceRef: `${compId}-${award}` });
      }
    };
    const orange = [...ps].sort((a, b) => s(b).runs - s(a).runs)[0];
    add('Orange Cap', orange, `${s(orange).runs} runs`);
    const purple = [...ps].sort((a, b) => s(b).wickets - s(a).wickets || s(a).runsConceded - s(b).runsConceded)[0];
    add('Purple Cap', purple, `${s(purple).wickets} wickets`);
    const impact = (p: Player) => s(p).runs + s(p).wickets * 22 + s(p).catches * 8 + s(p).sixes * 2;
    const mvp = [...ps].sort((a, b) => impact(b) - impact(a))[0];
    add('MVP', mvp, `${s(mvp).runs} runs, ${s(mvp).wickets} wickets`);
    const young = ps.filter((p) => ageOf(p, w.season) <= 23).sort((a, b) => impact(b) - impact(a))[0];
    add('Emerging Player', young, young ? `${s(young).runs} runs, ${s(young).wickets} wickets (age ${ageOf(young, w.season)})` : '');
    const fielder = [...ps].sort((a, b) => s(b).catches + s(b).runOuts + s(b).stumpings - (s(a).catches + s(a).runOuts + s(a).stumpings))[0];
    add('Best Fielder', fielder, `${s(fielder).catches} catches, ${s(fielder).runOuts} run-outs`);
  }
}

function evaluateBoard(w: WorldState, club: Club) {
  const comp = w.competitions[`${club.leagueId}-${w.season}`];
  const order = finishingOrder(w, comp.id);
  const pos = order.indexOf(club.id) + 1;
  const table = sortRows(comp.standings.main).findIndex((r) => r.clubId === club.id) + 1;
  const wcc = w.competitions[`WCC-${w.season}`];
  let delta = 0;
  for (const o of club.board.objectives) {
    let met = false;
    if (o.kind === 'league-position') met = table <= o.target || pos === 1;
    if (o.kind === 'playoffs') met = Object.values(w.fixtures).some((f) => f.competitionId === comp.id && f.stage !== 'League' && (f.homeId === club.id || f.awayId === club.id));
    if (o.kind === 'wcc-qualify') met = !!wcc?.clubIds.includes(club.id);
    if (o.kind === 'youth-debuts') met = squadOf(w, club).some((p) => ageOf(p, w.season) <= 23 && (p.stats.seasons[`${w.season}:${comp.id}`]?.matches ?? 0) > 0);
    if (o.kind === 'finance') met = club.cash >= 0;
    o.status = met ? 'met' : 'failed';
    const weight = o.importance === 'high' ? 14 : o.importance === 'medium' ? 8 : 4;
    delta += met ? weight * 0.6 : -weight;
  }
  if (comp.championId === club.id) delta += 15;
  if (wcc?.championId === club.id) delta += 15;
  club.board.confidence = clamp(Math.round(club.board.confidence + delta), 0, 100);
  if (club.board.confidence < 25) club.board.warnings++;
  else if (club.board.confidence > 50) club.board.warnings = 0;
}

/** Moves the user to a new club after dismissal — the old club's history is preserved. */
function sackAndReassign(w: WorldState) {
  const old = w.clubs[w.userClubId];
  const myRep = w.leagues[old.leagueId].reputation;
  const options = Object.values(w.clubs)
    .filter((c) => c.id !== old.id && w.leagues[c.leagueId].reputation <= myRep)
    .sort((a, b) => a.brand - b.brand || a.id.localeCompare(b.id));
  const next = options[0] ?? Object.values(w.clubs).find((c) => c.id !== old.id)!;
  const from = w.formerClubs.length ? w.formerClubs[w.formerClubs.length - 1].to + 1 : WORLD.startSeason;
  w.formerClubs.push({ clubId: old.id, from, to: w.season });
  old.isUser = false;
  next.isUser = true;
  next.board = { confidence: 55, objectives: [], warnings: 0 };
  w.userClubId = next.id;
  for (const f of Object.values(w.fixtures)) f.involvesUser = f.homeId === next.id || f.awayId === next.id;
  for (const a of Object.values(w.auctions)) a.interactive = a.leagueId === next.leagueId;
  addTimeline(w, 'board', `Leaving ${old.name}`, `The board ended ${w.managerName}'s tenure; ${next.name} offered a new job.`, [old.id, next.id]);
  addNews(w, { kind: 'board', importance: 3, headline: `${old.name} part ways with ${w.managerName}`, body: `After repeated failures to meet objectives, the board has acted. ${next.name} (${leagueById(next.leagueId).shortName}) have offered ${w.managerName} a fresh start.`, clubIds: [old.id, next.id], playerIds: [], sourceRef: `sack-${w.season}` });
}

/**
 * Season rollover: history, development, ageing, retirements, youth intake, reputation,
 * qualification allocation, board review, then open the retention window.
 */
export function endSeason(w: WorldState) {
  if (w.phase !== 'offseason') throw new Error('Season not finished');
  const rng = worldRng(w, 'season-end');
  const user = w.clubs[w.userClubId];
  const userComp = w.competitions[`${user.leagueId}-${w.season}`];
  const pos = sortRows(userComp.standings.main).findIndex((r) => r.clubId === user.id) + 1;
  const row = userComp.standings.main.find((r) => r.clubId === user.id)!;

  updateReputations(w);
  for (const c of Object.values(w.clubs)) evaluateBoard(w, c);
  w.chronicles.push(buildChronicle(w));
  addTimeline(w, 'season', `${w.season} season complete`, w.chronicles[w.chronicles.length - 1].summary);

  // History snapshot
  w.history.push({
    season: w.season,
    champions: [...LEAGUES.map((l) => `${l.id}-${w.season}`), `WCC-${w.season}`].map((id) => w.competitions[id]).filter((c) => c?.championId).map((c) => ({
      competitionId: c.id, name: c.name, clubId: c.championId!, clubName: w.clubs[c.championId!].name, runnerUpName: c.runnerUpId ? w.clubs[c.runnerUpId].name : '',
    })),
    userClub: { clubId: user.id, competitionId: userComp.id, position: pos, played: row.played, won: row.won, result: userComp.championId === user.id ? 'Champions' : userComp.runnerUpId === user.id ? 'Runners-up' : `${pos}th in league` },
    awards: w.awards.filter((a) => a.season === w.season),
    reputations: Object.fromEntries(Object.entries(w.leagues).map(([k, v]) => [k, v.reputation])),
    wccSlots: Object.fromEntries(Object.entries(w.leagues).map(([k, v]) => [k, v.wccSlots])),
  });

  // Development, ageing and retirements
  const matchesBy = (p: Player) => Object.entries(p.stats.seasons).filter(([k]) => k.startsWith(`${w.season}:`)).reduce((s, [, v]) => s + v.matches, 0);
  for (const p of Object.values(w.players)) {
    if (p.retired) continue;
    const club = p.clubId ? w.clubs[p.clubId] : p.isYouth ? Object.values(w.clubs).find((c) => c.academy.includes(p.id)) ?? null : null;
    developPlayer(w, p, club, matchesBy(p), rng);
    if (p.injury) {
      // The off-season heals most injuries; either way the injury stays on the record.
      if (p.injury.daysRemaining > 60) p.injury = { ...p.injury, daysRemaining: p.injury.daysRemaining - 60 };
      else {
        p.injuryHistory.push({ season: w.season, type: p.injury.type, days: p.injury.expectedDaysMax });
        p.injury = null;
      }
    }
    p.fatigue = 0;
    p.workload = 0;
    p.form = Math.round(p.form * 0.3 * 10) / 10;
    p.benchStreak = 0;
    p.transferRequest = false;
    p.morale = Math.round(p.morale * 0.6 + 65 * 0.4);
    if (!p.isYouth && rng.chance(retirementChance(p, w.season + 1))) {
      p.retired = true;
      if (p.clubId === w.userClubId && p.stats.career.matches >= 25) {
        addTimeline(w, 'retirement', `${p.name} retires`, `A club servant: ${p.stats.career.matches} matches, ${p.stats.career.runs} runs, ${p.stats.career.wickets} wickets.`, [p.id]);
      }
      if (p.clubId) {
        w.clubs[p.clubId].squad = w.clubs[p.clubId].squad.filter((x) => x !== p.id);
        w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId: p.id, fromClubId: p.clubId, toClubId: null, kind: 'retirement', fee: 0, note: `Retired aged ${ageOf(p, w.season)}` });
      }
      p.clubId = null;
      p.contract = null;
      if (p.stats.career.matches >= 20 || overall(p) >= 80 || p.source === 'curated') {
        addNews(w, { kind: 'retirement', importance: overall(p) >= 80 ? 2 : 1, headline: `${p.name} retires`, body: `${p.name} calls time aged ${ageOf(p, w.season)} with ${p.stats.career.runs} runs and ${p.stats.career.wickets} wickets in Kurciv cricket.`, clubIds: [], playerIds: [p.id], sourceRef: `ret-${p.id}` });
        if (p.stats.career.runs >= 2500 || p.stats.career.wickets >= 120) {
          w.hallOfFame.push({ id: `hof-${p.id}`, season: w.season, kind: 'legend', title: `${p.name}`, detail: `${p.stats.career.matches} matches, ${p.stats.career.runs} runs, ${p.stats.career.wickets} wickets`, refs: [p.id] });
        }
      }
    }
  }

  // Career records
  const active = Object.values(w.players);
  const topRuns = active.reduce((b, p) => (p.stats.career.runs > (b?.stats.career.runs ?? -1) ? p : b), active[0]);
  const topWk = active.reduce((b, p) => (p.stats.career.wickets > (b?.stats.career.wickets ?? -1) ? p : b), active[0]);
  w.records.mostCareerRuns = { runs: topRuns.stats.career.runs, playerId: topRuns.id };
  w.records.mostCareerWickets = { wickets: topWk.stats.career.wickets, playerId: topWk.id };

  // Youth intake (rare elites, quality from country depth and academy facility)
  for (const c of Object.values(w.clubs)) youthIntake(w, c, rng);
  // Replenish domestic pools so lower leagues never run dry (all clearly marked as generated)
  replenishPools(w, rng);

  // Board consequences (never an immediate game-over: dismissal moves you to a new club)
  if (user.board.warnings >= 2 && user.board.confidence < 15) sackAndReassign(w);

  // Next season
  w.season += 1;
  w.day = 20;
  w.appearances = {};
  pruneImpacts(w);
  w.phase = 'retention';
  for (const c of Object.values(w.clubs)) {
    c.retentionsLocked = false;
    c.retentionChoices = c.isUser ? [] : aiRetentions(w, c);
    c.lineup = null;
  }
  allocateForWorld(w);
  // Prune per-season working state; results stay in history and the match-record store.
  for (const id of Object.keys(w.fixtures)) if (w.fixtures[id].season < w.season - 1) delete w.fixtures[id];
  for (const id of Object.keys(w.competitions)) if (w.competitions[id].season < w.season - 2) delete w.competitions[id];
  w.auctions = {};
  w.auctionOrder = [];
  w.scouting = { userBattingVsPace: w.scouting.userBattingVsPace.slice(-4), userBattingVsSpin: w.scouting.userBattingVsSpin.slice(-4) };
  for (const id of Object.keys(w.finances)) w.finances[id] = w.finances[id].filter((t) => t.season >= w.season - 2);
}

function youthIntake(w: WorldState, c: Club, rng: ReturnType<typeof worldRng>) {
  const [lo, hi] = WORLD.youth.prospectsPerSeason;
  const n = rng.int(lo, hi);
  const l = leagueById(c.leagueId);
  for (let i = 0; i < n; i++) {
    if (c.academy.length >= WORLD.youth.academyMax) break;
    const country = l.domesticCountries[0];
    const elite = rng.chance(WORLD.youth.eliteChance * (0.6 + c.facilities.youth * 0.15));
    const quality = COUNTRY_DEPTH[country] - 12 + c.facilities.youth * 1.2 + (elite ? 8 : 0);
    const p = generatePlayer(rng, { country, quality, age: rng.int(16, 19), season: w.season + 1, source: 'youth', idPrefix: `y${w.season}` }, w.counter++);
    p.isYouth = true;
    p.potential = Math.min(96, Math.round(p.potential + (elite ? rng.range(14, 22) : rng.range(4, 14)) + c.facilities.youth));
    w.players[p.id] = p;
    c.academy.push(p.id);
    if (c.isUser) {
      addNews(w, { kind: 'youth', importance: elite ? 2 : 1, headline: `New academy prospect: ${p.name}`, body: `${p.name} (${p.role}, age ${ageOf(p, w.season + 1)}) joins the academy. Scouts are ${elite ? 'very excited' : 'cautiously positive'}.`, clubIds: [c.id], playerIds: [p.id], sourceRef: `youth-${p.id}` });
    }
  }
}

function replenishPools(w: WorldState, rng: ReturnType<typeof worldRng>) {
  for (const l of LEAGUES) {
    const country = l.domesticCountries[0];
    const active = Object.values(w.players).filter((p) => p.country === country && !p.retired && !p.isYouth).length;
    const need = clubsInLeague(w, l.id).length * l.squadRules.maxSquad * 1.4;
    for (let i = active; i < need; i++) {
      const p = generatePlayer(rng, { country, quality: COUNTRY_DEPTH[country], age: rng.int(19, 24), season: w.season + 1, idPrefix: `g${w.season}` }, w.counter++);
      w.players[p.id] = p;
    }
  }
}

// ------------------------------------------------------------------ retention window

export function retentionCost(w: WorldState, club: Club, ids: string[]): { perPlayer: Record<string, number>; total: number } {
  const l = leagueById(club.leagueId);
  const r = l.squadRules;
  const sorted = [...ids].sort((a, b) => marketValue(w.players[b], w.season) - marketValue(w.players[a], w.season));
  const perPlayer: Record<string, number> = {};
  let capped = 0;
  for (const id of sorted) {
    const p = w.players[id];
    perPlayer[id] = p.capped ? r.retentionCosts[Math.min(capped++, r.retentionCosts.length - 1)] : r.uncappedRetentionCost;
  }
  return { perPlayer, total: round2(Object.values(perPlayer).reduce((a, b) => a + b, 0)) };
}

export function validateRetentions(w: WorldState, club: Club, ids: string[]): string | null {
  const l = leagueById(club.leagueId);
  if (new Set(ids).size !== ids.length) return 'A player is listed twice.';
  if (ids.length > l.squadRules.maxRetentions) return `At most ${l.squadRules.maxRetentions} players can be retained.`;
  for (const id of ids) if (!club.squad.includes(id)) return 'You can only retain players in your squad.';
  const ps = ids.map((id) => w.players[id]);
  const os = ps.filter((p) => isOverseas(p, l.domesticCountries));
  if (os.length > l.squadRules.maxOverseas) return `Retentions cannot exceed the overseas limit (${l.squadRules.maxOverseas}).`;
  const byC: Record<string, number> = {};
  for (const p of os) byC[p.country] = (byC[p.country] ?? 0) + 1;
  if (Object.values(byC).some((n) => n > l.squadRules.maxPerOverseasCountry)) return `Retentions cannot exceed ${l.squadRules.maxPerOverseasCountry} overseas players from one country.`;
  const { total } = retentionCost(w, club, ids);
  const reserve = (l.squadRules.minSquad - ids.length) * l.auctionRules.minBase;
  if (l.auctionRules.purse - total < reserve) return `Retention cost ₹${total.toFixed(2)} Cr leaves too little purse to complete a ${l.squadRules.minSquad}-player squad.`;
  return null;
}

function aiRetentions(w: WorldState, c: Club): string[] {
  const l = leagueById(c.leagueId);
  const scale = l.auctionRules.purse / 120;
  const squad = squadOf(w, c).filter((p) => !p.retired);
  const scored = squad
    .map((p) => ({ p, v: marketValue(p, w.season) * scale * (c.personality === 'youth-builder' && ageOf(p, w.season) <= 24 ? 1.3 : 1) }))
    .sort((a, b) => b.v - a.v);
  const chosen: string[] = [];
  for (const { p, v } of scored) {
    if (chosen.length >= l.squadRules.maxRetentions) break;
    const trial = [...chosen, p.id];
    const cost = retentionCost(w, c, trial);
    if (v < cost.perPlayer[p.id] * 0.95) continue;
    if (cost.total > l.auctionRules.purse * 0.62) continue;
    if (validateRetentions(w, c, trial)) continue;
    chosen.push(p.id);
  }
  return chosen;
}

export function setUserRetentions(w: WorldState, ids: string[]): string | null {
  if (w.phase !== 'retention') return 'The retention window is closed.';
  const club = w.clubs[w.userClubId];
  const err = validateRetentions(w, club, ids);
  if (err) return err;
  club.retentionChoices = [...ids];
  return null;
}

/** Commits every club's retentions, releases everyone else, resets purses and opens the auction cascade. */
export function commitRetentions(w: WorldState) {
  if (w.phase !== 'retention') throw new Error('Not in the retention window');
  for (const c of Object.values(w.clubs)) {
    const l = leagueById(c.leagueId);
    const keep = c.isUser ? c.retentionChoices : c.retentionChoices.filter((id) => !validateRetentions(w, c, [id]));
    const cost = retentionCost(w, c, keep);
    for (const id of [...c.squad]) {
      const p = w.players[id];
      if (keep.includes(id)) {
        p.contract = { ...(p.contract ?? { clubId: c.id, leagueId: l.id, acquired: 'retention', retainedCount: 0, startSeason: w.season, endSeason: w.season, salary: 0 }), salary: cost.perPlayer[id], startSeason: w.season, endSeason: w.season, acquired: 'retention', retainedCount: (p.contract?.retainedCount ?? 0) + 1 };
        w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId: id, fromClubId: c.id, toClubId: c.id, kind: 'retention', fee: cost.perPlayer[id], note: `${l.shortName} retention` });
      } else {
        p.clubId = null;
        p.contract = null;
        w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId: id, fromClubId: c.id, toClubId: null, kind: 'release', fee: 0, note: 'Released into the auction pool' });
      }
    }
    c.squad = c.squad.filter((id) => keep.includes(id));
    c.purse = round2(l.auctionRules.purse - cost.total);
    recordTransaction(w, c.id, 'retention', -cost.total, `${keep.length} retentions`);
    c.retentionsLocked = true;
    // Academy promotions by AI clubs: high-potential prospects aged 18+ join the squad.
    if (!c.isUser) {
      for (const id of [...c.academy]) {
        const p = w.players[id];
        if (ageOf(p, w.season) >= 18 && p.potential >= 70 && c.squad.length < l.squadRules.maxSquad - 15) promoteYouth(w, c, id);
        else if (ageOf(p, w.season) >= 21) releaseYouth(w, c, id);
      }
    }
  }
  w.phase = 'auction';
  setupAuctions(w);
  advanceCascade(w);
  const ua = Object.values(w.auctions).find((a) => a.interactive);
  if (ua && ua.status === 'live') storyAuctionEve(w, roleDemand(w, ua));
}

export function promoteYouth(w: WorldState, c: Club, id: string): string | null {
  const p = w.players[id];
  const l = leagueById(c.leagueId);
  if (!c.academy.includes(id)) return 'Player is not in your academy.';
  if (ageOf(p, w.season) < 16) return `${p.name} is too young to register (minimum age 16).`;
  if (c.squad.length >= l.squadRules.maxSquad) return 'Registered squad is full.';
  if (!l.domesticCountries.includes(p.country)) return 'Academy graduates must be domestic players.';
  c.academy = c.academy.filter((x) => x !== id);
  p.isYouth = false;
  p.clubId = c.id;
  p.contract = { clubId: c.id, leagueId: l.id, salary: l.auctionRules.minBase, startSeason: w.season, endSeason: w.season, acquired: 'youth', retainedCount: 0 };
  c.squad.push(id);
  w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId: id, fromClubId: null, toClubId: c.id, kind: 'youth-promotion', fee: 0, note: 'Promoted from the academy' });
  if (c.isUser) addNews(w, { kind: 'youth', importance: 1, headline: `${p.name} promoted to the senior squad`, body: `${c.name} register academy graduate ${p.name}.`, clubIds: [c.id], playerIds: [id], sourceRef: `promo-${id}-${w.season}` });
  return null;
}

export function releaseYouth(w: WorldState, c: Club, id: string) {
  c.academy = c.academy.filter((x) => x !== id);
  const p = w.players[id];
  p.isYouth = false;
}
