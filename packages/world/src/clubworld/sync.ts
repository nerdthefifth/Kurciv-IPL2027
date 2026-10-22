import type { Fixture, WorldState } from '@kurciv/domain';
import { ageOf, overall } from '@kurciv/domain';
import { leagueById, venueById } from '@kurciv/config';
import type { MatchState } from '@kurciv/simulation';
import { sortRows } from '../competition';
import { selectXI } from '../matchday';
import { nextUserFixture } from '../season';
import { boardMidSeason, boardWeekly } from './board';
import { conversationsDaily, contractTalks } from './conversations';
import { cw, emit } from './core';
import { inboxDaily } from './inbox';
import { auctionRumours, disciplinaryCheck, ensureAccounts, mediaDaily } from './media';
import { promisesDaily } from './promises';
import { ensureCaptaincy } from '../captaincy';

/**
 * The world observer. It reads simulation records — completed fixtures, the transfer
 * ledger, injuries, competition and career state — and emits one event per new record.
 * Cursors and event keys make it idempotent: running it again (a refresh, a reload, a
 * repeated request) finds nothing new and emits nothing.
 */

/** Called from applyMatch for the user's fixtures, before ratings move: who played, in what order. */
export function recordTeamSheet(w: WorldState, fx: Fixture, s: MatchState) {
  const side = fx.homeId === w.userClubId ? 'home' : 'away';
  const me = w.clubs[w.userClubId];
  const opp = w.clubs[side === 'home' ? fx.awayId : fx.homeId];
  const exp = 1 / (1 + 10 ** ((opp.elo - me.elo) / 400));
  cw(w).teamSheets[fx.id] = { xi: s.setup[side].xi.map((p) => p.id), captainId: s.setup[side].captainId, expectation: Math.round(exp * 100) / 100 };
}

export function clubWorldSync(w: WorldState) {
  const c = cw(w);
  if (!c.accounts.length) ensureAccounts(w);
  observeCareer(w);
  observeFixtures(w);
  observeLedger(w);
  observeInjuries(w);
  observeCompetitions(w);
  const tick = `${w.season}:${w.day}`;
  if (c.cursors.tick !== tick) {
    const newSeason = !c.cursors.tick.startsWith(`${w.season}:`);
    c.cursors.tick = tick;
    if (newSeason) prune(w);
    daily(w);
  }
}

/** Marks everything already in a save as seen, so upgrading an old career does not replay history. */
export function primeClubWorld(w: WorldState) {
  const c = cw(w);
  c.cursors.ledger = w.ledger.length;
  for (const fx of Object.values(w.fixtures)) if (fx.status === 'complete') c.cursors.fixtures[fx.id] = 1;
  for (const p of Object.values(w.players)) if (p.injury) c.cursors.injuries[`${p.injury.id}|${p.id}`] = 1;
  for (const a of Object.values(w.auctions)) if (a.status === 'complete') c.keys[`auction-done-${a.id}`] = w.season;
  if (w.phase === 'season' || w.phase === 'wcc' || w.phase === 'offseason') c.keys[`season-start-${w.season}`] = w.season;
  if (w.competitions[`WCC-${w.season}`]) for (const id of w.competitions[`WCC-${w.season}`].clubIds) c.keys[`wcc-q-${w.season}-${id}`] = w.season;
  ensureAccounts(w);
  return c;
}

function prune(w: WorldState) {
  const c = cw(w);
  for (const [k, s] of Object.entries(c.keys)) if (s < w.season - 1) delete c.keys[k];
  for (const id of Object.keys(c.cursors.fixtures)) if (w.fixtures[id]?.season !== w.season) delete c.cursors.fixtures[id];
  const sheets = Object.keys(c.teamSheets);
  for (const id of sheets.slice(0, Math.max(0, sheets.length - 40))) delete c.teamSheets[id];
}

function observeCareer(w: WorldState) {
  const last = w.formerClubs[w.formerClubs.length - 1];
  if (last) {
    emit(w, { type: 'MANAGER_DISMISSED', key: `dismissed-${last.clubId}-${last.to}`, source: `career:${last.clubId}`, importance: 3, refs: { clubIds: [last.clubId] }, data: { reason: `After a season review with confidence below the board's limit and two warnings on record, ${w.clubs[last.clubId].name} ended your contract.` } });
  }
  emit(w, { type: 'MANAGER_APPOINTED', key: `appointed-${w.userClubId}-${w.formerClubs.length}`, source: `career:${w.userClubId}`, importance: 2, refs: { clubIds: [w.userClubId] }, data: {} });
}

function observeFixtures(w: WorldState) {
  const c = cw(w);
  const done = Object.values(w.fixtures).filter((f) => f.season === w.season && f.status === 'complete' && f.result && !c.cursors.fixtures[f.id]).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  for (const fx of done) {
    c.cursors.fixtures[fx.id] = 1;
    matchEvents(w, fx);
  }
}

function matchEvents(w: WorldState, fx: Fixture) {
  const r = fx.result!;
  const u = w.clubs[w.userClubId];
  const userMatch = fx.homeId === u.id || fx.awayId === u.id;
  const upset = w.news.some((n) => n.kind === 'upset' && n.sourceRef === fx.id);
  const importance = fx.stage === 'Final' ? 3 : upset || (fx.stage !== 'League' && !fx.group) ? 2 : 1;
  const bats = r.innings.flatMap((i) => i.batting);
  const bowls = r.innings.flatMap((i) => i.bowling);
  const top = [...bats].sort((a, b) => b.runs - a.runs)[0];
  const best = [...bowls].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
  const pomBat = r.playerOfMatch ? bats.find((b) => b.playerId === r.playerOfMatch) : null;
  const pomBowl = r.playerOfMatch ? bowls.find((b) => b.playerId === r.playerOfMatch) : null;
  const oppId = fx.homeId === u.id ? fx.awayId : fx.homeId;
  const sheet = cw(w).teamSheets[fx.id];
  const e = emit(w, {
    type: 'MATCH_COMPLETED', key: `match-${fx.id}`, source: `fixture:${fx.id}`, importance: userMatch ? Math.max(importance, 2) as 2 | 3 : importance,
    refs: { clubIds: [fx.homeId, fx.awayId], fixtureId: fx.id, competitionId: fx.competitionId, playerIds: r.playerOfMatch ? [r.playerOfMatch] : [] },
    data: {
      userMatch, winnerId: r.winnerId, margin: r.margin, stage: fx.stage, playerOfMatch: r.playerOfMatch,
      scoreline: r.innings.map((i) => `${w.clubs[i.battingClubId].shortName} ${i.runs}/${i.wickets}`).join(' · '),
      pomLine: pomBat && pomBat.runs >= 20 ? `${pomBat.runs} off ${pomBat.balls}` : pomBowl ? `${pomBowl.wickets}/${pomBowl.runs}` : 'player of the match',
      topScore: top ? { playerId: top.playerId, runs: top.runs, balls: top.balls } : null,
      bestBowling: best && best.wickets ? { playerId: best.playerId, wickets: best.wickets, runs: best.runs } : null,
      ...(userMatch ? { opponentName: w.clubs[oppId].name, userWinExpectation: sheet?.expectation ?? 0.5 } : {}),
    },
  });
  if (!e) return;

  // Milestones within the match (anywhere in the world).
  for (const b of bats.filter((x) => x.runs >= 100)) {
    const p = w.players[b.playerId];
    if (p) emit(w, { type: 'PLAYER_MILESTONE_REACHED', key: `ms-${fx.id}-${p.id}-100`, source: `fixture:${fx.id}`, importance: 2, refs: { playerIds: [p.id], clubIds: p.clubId ? [p.clubId] : [], fixtureId: fx.id }, data: { what: `a century (${b.runs} off ${b.balls})`, against: w.clubs[fx.homeId === p.clubId ? fx.awayId : fx.homeId]?.name } });
  }
  for (const b of bowls.filter((x) => x.wickets >= 5)) {
    const p = w.players[b.playerId];
    if (p) emit(w, { type: 'PLAYER_MILESTONE_REACHED', key: `ms-${fx.id}-${p.id}-5w`, source: `fixture:${fx.id}`, importance: 2, refs: { playerIds: [p.id], clubIds: p.clubId ? [p.clubId] : [], fixtureId: fx.id }, data: { what: `five wickets (${b.wickets}/${b.runs})`, against: w.clubs[fx.homeId === p.clubId ? fx.awayId : fx.homeId]?.name } });
  }
  if (!userMatch || !sheet) return;

  // Selection: compare with the previous team sheet.
  const ids = Object.keys(cw(w).teamSheets);
  const prevId = ids[ids.indexOf(fx.id) - 1];
  const prev = prevId ? cw(w).teamSheets[prevId] : null;
  if (prev) {
    const entrants = sheet.xi.filter((id) => !prev.xi.includes(id));
    for (const id of prev.xi.filter((x) => !sheet.xi.includes(x))) {
      const p = w.players[id];
      if (!p || p.clubId !== u.id || p.injury) continue;
      const cat = p.role;
      const repl = entrants.find((x) => w.players[x]?.role === cat) ?? entrants[0];
      emit(w, { type: 'PLAYER_DROPPED', key: `drop-${fx.id}-${id}`, source: `fixture:${fx.id}`, importance: p.reputation >= 70 ? 2 : 1, refs: { playerIds: [id], clubIds: [u.id], fixtureId: fx.id }, data: { replacementId: repl ?? null, opponentName: w.clubs[oppId].name } });
    }
    for (const id of entrants) {
      const p = w.players[id];
      if (p) emit(w, { type: 'PLAYER_SELECTED', key: `sel-${fx.id}-${id}`, source: `fixture:${fx.id}`, refs: { playerIds: [id], clubIds: [u.id], fixtureId: fx.id }, data: { young: ageOf(p, w.season) <= 21 } });
    }
  }

  // Losing streaks.
  const res = Object.values(w.fixtures).filter((f) => f.season === w.season && f.status === 'complete' && f.result && (f.homeId === u.id || f.awayId === u.id)).sort((a, b) => a.day - b.day);
  let streak = 0;
  for (let i = res.length - 1; i >= 0 && res[i].result!.winnerId && res[i].result!.winnerId !== u.id; i--) streak++;
  if (r.winnerId && r.winnerId !== u.id && (streak === 3 || streak === 5)) {
    emit(w, { type: 'LOSING_STREAK', key: `streak-${fx.id}`, source: `fixture:${fx.id}`, importance: 2, refs: { clubIds: [u.id], fixtureId: fx.id }, data: { count: streak, opponentName: w.clubs[oppId].name, captainId: sheet.captainId } });
  }
}

function observeLedger(w: WorldState) {
  const c = cw(w);
  const u = w.clubs[w.userClubId];
  for (let i = c.cursors.ledger; i < w.ledger.length; i++) {
    const t = w.ledger[i];
    const p = w.players[t.playerId];
    if (!p) continue;
    const userInvolved = t.toClubId === u.id || t.fromClubId === u.id;
    const star = overall(p) >= 80;
    const club = t.toClubId ? w.clubs[t.toClubId] : t.fromClubId ? w.clubs[t.fromClubId] : null;
    const userLeague = club?.leagueId === u.leagueId;
    const base = { source: `ledger:${t.id}`, refs: { playerIds: [p.id], clubIds: [t.fromClubId, t.toClubId].filter(Boolean) as string[] } };
    if (t.kind === 'auction' || t.kind === 'replacement' || t.kind === 'free-agent' || t.kind === 'youth-promotion') {
      if (userInvolved || userLeague || star || t.fee >= 8) emit(w, { ...base, type: 'PLAYER_ACQUIRED', key: `acq-${t.id}`, importance: t.fee >= 10 ? 2 : 1, data: { toClubId: t.toClubId, fee: t.fee, how: t.kind } });
    } else if (t.kind === 'retention') {
      if (userInvolved || star) emit(w, { ...base, type: 'CONTRACT_SIGNED', key: `ret-${t.id}`, data: { fee: t.fee } });
    } else if (t.kind === 'release') {
      if (userInvolved || star) emit(w, { ...base, type: 'PLAYER_RELEASED', key: `rel-${t.id}`, data: { fromClubId: t.fromClubId } });
    } else if (t.kind === 'retirement') {
      if (userInvolved || star) emit(w, { ...base, type: 'PLAYER_RETIRED', key: `retire-${t.id}`, importance: star ? 2 : 1, data: { age: ageOf(p, w.season) } });
    }
  }
  c.cursors.ledger = w.ledger.length;
}

function observeInjuries(w: WorldState) {
  const c = cw(w);
  const u = w.clubs[w.userClubId];
  for (const p of Object.values(w.players)) {
    if (!p.injury || !p.clubId) continue;
    const k = `${p.injury.id}|${p.id}`;
    if (c.cursors.injuries[k]) continue;
    const mine = p.clubId === u.id;
    const star = overall(p) >= 80;
    if (!mine && !star) continue;
    c.cursors.injuries[k] = 1;
    emit(w, {
      type: 'PLAYER_INJURED', key: `inj-${p.injury.id}`, source: `injury:${p.injury.id}`, importance: star ? 2 : 1,
      refs: { playerIds: [p.id], clubIds: [p.clubId] }, data: { injuryId: p.injury.id, injuryType: p.injury.type, severity: p.injury.severity, min: p.injury.expectedDaysMin, max: p.injury.expectedDaysMax },
    });
  }
  for (const k of Object.keys(c.cursors.injuries)) {
    const [injId, pid] = k.split('|');
    const p = w.players[pid];
    if (p?.injury?.id === injId) continue;
    delete c.cursors.injuries[k];
    if (!p || p.retired) continue;
    emit(w, { type: 'PLAYER_RECOVERED', key: `rec-${injId}`, source: `injury:${injId}`, importance: overall(p) >= 80 ? 2 : 1, refs: { playerIds: [pid], clubIds: p.clubId ? [p.clubId] : [] }, data: { injuryId: injId } });
  }
}

function observeCompetitions(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const l = leagueById(u.leagueId);
  if (w.phase === 'season' || w.phase === 'wcc') {
    const comp = w.competitions[`${l.id}-${w.season}`];
    emit(w, { type: 'SEASON_STARTED', key: `season-start-${w.season}`, source: `competition:${comp?.id ?? w.season}`, importance: 2, refs: { clubIds: [u.id], competitionId: comp?.id }, data: { leagueName: l.name, matches: Object.values(w.fixtures).filter((f) => f.competitionId === comp?.id && f.stage === 'League' && (f.homeId === u.id || f.awayId === u.id)).length } });
  }
  if (w.phase === 'auction') auctionRumours(w);
  for (const a of Object.values(w.auctions)) {
    if (a.status !== 'complete' || a.season !== w.season) continue;
    const mine = w.ledger.filter((t) => t.season === w.season && t.toClubId === u.id && t.kind === 'auction');
    emit(w, {
      type: 'AUCTION_COMPLETED', key: `auction-done-${a.id}`, source: `auction:${a.id}`, importance: a.leagueId === u.leagueId ? 2 : 1, refs: { clubIds: a.leagueId === u.leagueId ? [u.id] : [] },
      data: { leagueId: a.leagueId, ...(a.leagueId === u.leagueId ? { userSpent: mine.reduce((s, t) => s + t.fee, 0), userBiggestFee: Math.max(0, ...mine.map((t) => t.fee)), userBudget: mine.reduce((s, t) => s + t.fee, 0) + u.purse, userYoungSignings: mine.filter((t) => ageOf(w.players[t.playerId], w.season) <= 23).length } : {}) },
    });
  }
  const wcc = w.competitions[`WCC-${w.season}`];
  if (wcc) for (const id of wcc.clubIds) {
    if (id !== u.id && w.clubs[id]?.leagueId !== u.leagueId) continue;
    emit(w, { type: 'CLUB_QUALIFIED', key: `wcc-q-${w.season}-${id}`, source: `competition:${wcc.id}`, importance: id === u.id ? 2 : 1, refs: { clubIds: [id], competitionId: wcc.id }, data: { competition: wcc.name } });
  }
}

function daily(w: WorldState) {
  ensureAccounts(w);
  // Leaders for the season (covers saves made before captaincy existed, and squad changes).
  if (w.phase === 'season' || w.phase === 'wcc' || w.phase === 'preseason') ensureCaptaincy(w);
  const u = w.clubs[w.userClubId];
  const nf = nextUserFixture(w);
  let planned: string[] | null = null;
  if (nf && nf.day === w.day && nf.homeId && nf.awayId) planned = selectXI(w, u, nf).xi.map((p) => p.id);
  promisesDaily(w, nf ? { id: nf.id, day: nf.day } : null, planned);
  conversationsDaily(w);
  inboxDaily(w);
  mediaDaily(w);
  disciplinaryCheck(w);
  if (nf && nf.homeId && nf.awayId && nf.day - w.day <= 1 && nf.day >= w.day) {
    const oppId = nf.homeId === u.id ? nf.awayId : nf.homeId;
    const opp = w.clubs[oppId];
    const form = Object.values(w.fixtures).filter((f) => f.status === 'complete' && f.result && f.season === w.season && (f.homeId === oppId || f.awayId === oppId)).sort((a, b) => b.day - a.day).slice(0, 5).map((f) => (f.result!.winnerId === oppId ? 'W' : f.result!.winnerId ? 'L' : 'T')).join('');
    const injured = u.squad.map((id) => w.players[id]).filter((p) => p?.injury).map((p) => p.shortName).join(', ');
    const promises = cw(w).promises.filter((p) => p.status === 'active' && p.to.kind === 'player' && p.matches !== null).map((p) => p.text).join(' ');
    emit(w, {
      type: 'MATCH_UPCOMING', key: `upcoming-${nf.id}`, source: `fixture:${nf.id}`, refs: { clubIds: [u.id, oppId], fixtureId: nf.id, competitionId: nf.competitionId },
      data: { homeName: w.clubs[nf.homeId].name, awayName: w.clubs[nf.awayId].name, opponentName: opp.name, opponentId: oppId, stage: nf.stage, venue: venueById(nf.venueId || w.clubs[nf.homeId].venueId).name, opponentForm: form, injured, promises },
    });
  }
  if (w.phase === 'season' || w.phase === 'wcc') {
    if (w.day % 7 === 0) boardWeekly(w);
    const comp = w.competitions[`${u.leagueId}-${w.season}`];
    if (comp?.stage === 'league') {
      const rows = sortRows(comp.standings.main);
      const l = leagueById(u.leagueId);
      const total = (rows.length - 1) * l.rounds;
      const played = rows.find((r) => r.clubId === u.id)?.played ?? 0;
      if (total && played >= total / 2) boardMidSeason(w);
      if (total && played >= total * 0.7) contractTalks(w, comp.id);
    }
  }
}
