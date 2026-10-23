import type { Club, Competition, Fixture, Region, WorldState } from '@kurciv/domain';
import { CONTINENTAL, DIVISIONS, REGIONS, leagueById, regionOf, stadiumCatalogue } from '@kurciv/config';
import { emptyRow, finishingOrder, sortRows } from '../competition';
import { recordTransaction } from '../finance';
import { addTimeline } from '../story';
import { addNews, clamp } from '../util';

/**
 * Continental club cups. Each region holds a Champions Cup and a secondary Shield after the
 * divisional season: groups of four, then semi-finals and a final at a neutral ground. Entry is
 * earned from this season's pyramid finish (performance) blended with the club's continental
 * coefficient and brand (reputation). Winners and runners-up qualify for the Global Club
 * Championship.
 */

export const cupId = (region: Region, cup: 'champions' | 'shield', season: number) => `${cup === 'champions' ? 'CC' : 'CS'}-${region.toUpperCase()}-${season}`;

export function clubRegion(c: Club): Region {
  return regionOf(c.country);
}

/** Qualification score: pyramid performance this season blended with reputation. */
export function qualificationScore(w: WorldState, c: Club): { score: number; performance: number; reputation: number } {
  const d = leagueById(c.leagueId);
  const comp = w.competitions[`${c.leagueId}-${w.season}`];
  const order = comp ? finishingOrder(w, comp.id) : [];
  const n = Math.max(1, order.length);
  const pos = order.indexOf(c.id);
  const tier = d.tier ?? DIVISIONS.length;
  const performance = (DIVISIONS.length - tier) * 20 + (pos >= 0 ? (1 - pos / n) * 22 : 0);
  const coef = w.universe?.coefficients[c.id]?.points ?? 0;
  const reputation = c.brand * 0.7 + Math.min(30, coef * 1.5);
  const score = CONTINENTAL.weights.performance * performance + CONTINENTAL.weights.reputation * reputation;
  return { score: Math.round(score * 10) / 10, performance: Math.round(performance * 10) / 10, reputation: Math.round(reputation * 10) / 10 };
}

export function regionalRanking(w: WorldState, region: Region): { clubId: string; score: number; performance: number; reputation: number }[] {
  return Object.values(w.clubs)
    .filter((c) => clubRegion(c) === region)
    .map((c) => ({ clubId: c.id, ...qualificationScore(w, c) }))
    .sort((a, b) => b.score - a.score || a.clubId.localeCompare(b.clubId));
}

function neutralVenue(w: WorldState, region: Region, avoid: string[], salt: number): string {
  const avoidVenues = new Set(avoid.map((id) => w.clubs[id]?.venueId));
  const options = stadiumCatalogue()
    .filter((v) => regionOf(v.country) === region && !avoidVenues.has(v.id))
    .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 6);
  if (!options.length) return stadiumCatalogue()[0].id;
  return options[(w.season + salt) % options.length].id;
}

function addCupFixture(w: WorldState, comp: Competition, stage: string, home: string, away: string, day: number, group: string | null, venueId?: string, neutral = false) {
  const n = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).length + 1;
  const fx: Fixture = {
    id: `${comp.id}-M${n}`, competitionId: comp.id, season: w.season, day, stage, group: group ?? undefined, homeId: home, awayId: away,
    venueId: venueId ?? w.clubs[home].venueId, status: 'scheduled', result: null, involvesUser: home === w.userClubId || away === w.userClubId, neutral,
  };
  w.fixtures[fx.id] = fx;
}

function createCup(w: WorldState, region: Region, cup: 'champions' | 'shield', entrants: string[], day: number): Competition | null {
  const size = entrants.length >= 8 ? 8 : entrants.length >= 4 ? 4 : 0;
  if (!size) return null;
  const teams = entrants.slice(0, size);
  const id = cupId(region, cup, w.season);
  const name = `${CONTINENTAL.cupNames[region][cup === 'champions' ? 0 : 1]} ${w.season}`;
  const comp: Competition = {
    id, kind: 'continental', leagueId: null, season: w.season, name, clubIds: teams, standings: {}, stage: 'league', championId: null, runnerUpId: null,
    meta: { region, cup, round: size === 8 ? 'groups' : 'Semi-final', startDay: day, seeds: teams },
  };
  w.competitions[id] = comp;
  if (size === 8) {
    // Pots by seed: A gets seeds 1, 4, 5, 8; B gets 2, 3, 6, 7.
    const groups: Record<string, string[]> = { A: [teams[0], teams[3], teams[4], teams[7]], B: [teams[1], teams[2], teams[5], teams[6]] };
    comp.meta!.groups = groups;
    for (const g of ['A', 'B']) {
      const ids = groups[g];
      comp.standings[g] = ids.map(emptyRow);
      const rounds: [number, number][][] = [[[0, 3], [1, 2]], [[2, 0], [3, 1]], [[0, 1], [2, 3]]];
      rounds.forEach((pairs, r) => pairs.forEach(([a, b]) => addCupFixture(w, comp, `Group ${g}`, ids[a], ids[b], day + r * 2, g)));
    }
  } else {
    comp.stage = 'playoffs';
    addCupFixture(w, comp, 'Semi-final', teams[0], teams[3], day, null);
    addCupFixture(w, comp, 'Semi-final', teams[1], teams[2], day, null);
  }
  for (const t of teams) {
    if (w.clubs[t].isUser) {
      addTimeline(w, 'qualification', `Qualified for the ${name}`, `Seeded ${teams.indexOf(t) + 1} of ${teams.length}.`, [id]);
      addNews(w, { kind: 'qualification', importance: 3, headline: `${w.clubs[t].name} qualify for the ${name}`, body: `${teams.length} clubs from ${region} contest the cup; the final is at a neutral ground.`, clubIds: [t], playerIds: [], sourceRef: id });
    }
  }
  return comp;
}

/** Creates every region's cups once the divisional season is over. Returns the competitions created. */
export function createContinentalCups(w: WorldState, startDay: number): Competition[] {
  const out: Competition[] = [];
  for (const region of REGIONS) {
    const ranked = regionalRanking(w, region).map((r) => r.clubId);
    const champions = createCup(w, region, 'champions', ranked.slice(0, CONTINENTAL.championsCupSize), startDay);
    if (champions) out.push(champions);
    const rest = ranked.slice(champions?.clubIds.length ?? 0);
    const shield = createCup(w, region, 'shield', rest.slice(0, CONTINENTAL.shieldSize), startDay + 1);
    if (shield) out.push(shield);
  }
  addNews(w, {
    kind: 'qualification', importance: 2, headline: `Continental cups begin: ${out.length} competitions in ${REGIONS.length} regions`,
    body: 'Champions Cups and Shields in Asia, Europe, Africa, the Americas and Oceania. Winners and runners-up reach the Global Club Championship.',
    clubIds: [], playerIds: [], sourceRef: `continental-${w.season}`,
  });
  return out;
}

export function continentalComps(w: WorldState): Competition[] {
  return Object.values(w.competitions).filter((c) => c.kind === 'continental' && c.season === w.season);
}

function coefficient(w: WorldState, clubId: string, pts: number) {
  if (!w.universe) return;
  const c = (w.universe.coefficients[clubId] ??= { clubId, points: 0, history: [] });
  c.points = Math.round((c.points + pts) * 10) / 10;
}

/** Coefficient points for a continental or global match result. */
export function coefficientForMatch(w: WorldState, fx: Fixture) {
  const comp = w.competitions[fx.competitionId];
  if (!comp || (comp.kind !== 'continental' && comp.kind !== 'wcc') || !fx.result) return;
  const mult = comp.kind === 'wcc' ? CONTINENTAL.coefficient.globalMultiplier : comp.meta?.cup === 'shield' ? 0.5 : 1;
  const winner = fx.result.winnerId;
  if (winner) coefficient(w, winner, CONTINENTAL.coefficient.win * mult);
  else {
    coefficient(w, fx.homeId, CONTINENTAL.coefficient.tie * mult);
    coefficient(w, fx.awayId, CONTINENTAL.coefficient.tie * mult);
  }
}

/** Moves each cup forward when its current round is finished. Returns true if anything changed. */
export function progressContinental(w: WorldState): boolean {
  let changed = false;
  for (const comp of continentalComps(w)) {
    if (comp.stage === 'complete') continue;
    const fxs = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id);
    if (fxs.some((f) => f.status !== 'complete')) continue;
    const meta = comp.meta!;
    const region = meta.region as Region;
    const cup = meta.cup as 'champions' | 'shield';
    const prize = CONTINENTAL.prize[cup];
    const lastDay = Math.max(...fxs.map((f) => f.day));
    const winnerOf = (f: Fixture) => f.result!.winnerId ?? f.homeId;
    changed = true;
    if (meta.round === 'groups') {
      for (const id of comp.clubIds) recordTransaction(w, id, 'prize', prize.group, `${comp.name}: group stage`);
      const a = sortRows(comp.standings.A);
      const b = sortRows(comp.standings.B);
      meta.round = 'Semi-final';
      comp.stage = 'playoffs';
      addCupFixture(w, comp, 'Semi-final', a[0].clubId, b[1].clubId, lastDay + 2, null);
      addCupFixture(w, comp, 'Semi-final', b[0].clubId, a[1].clubId, lastDay + 2, null);
      continue;
    }
    if (meta.round === 'Semi-final') {
      const semis = fxs.filter((f) => f.stage === 'Semi-final');
      const finalists = semis.map(winnerOf);
      for (const f of semis) {
        const loser = winnerOf(f) === f.homeId ? f.awayId : f.homeId;
        recordTransaction(w, loser, 'prize', prize.semi, `${comp.name}: semi-final`);
        coefficient(w, loser, CONTINENTAL.coefficient.semi * (cup === 'shield' ? 0.5 : 1));
      }
      meta.round = 'Final';
      const venue = neutralVenue(w, region, finalists, cup === 'champions' ? 0 : 3);
      meta.finalVenue = venue;
      addCupFixture(w, comp, 'Final', finalists[0], finalists[1], lastDay + 2, null, venue, true);
      continue;
    }
    if (meta.round === 'Final') {
      const f = fxs.find((x) => x.stage === 'Final')!;
      comp.championId = winnerOf(f);
      comp.runnerUpId = comp.championId === f.homeId ? f.awayId : f.homeId;
      comp.stage = 'complete';
      finishCup(w, comp, region, cup, f.venueId);
    }
  }
  return changed;
}

function finishCup(w: WorldState, comp: Competition, region: Region, cup: 'champions' | 'shield', venueId: string) {
  const prize = CONTINENTAL.prize[cup];
  const champ = w.clubs[comp.championId!];
  recordTransaction(w, champ.id, 'prize', prize.champion, `${comp.name} winners`);
  recordTransaction(w, comp.runnerUpId!, 'prize', prize.runnerUp, `${comp.name} runners-up`);
  coefficient(w, champ.id, CONTINENTAL.coefficient.title * (cup === 'shield' ? 0.5 : 1));
  coefficient(w, comp.runnerUpId!, CONTINENTAL.coefficient.final * (cup === 'shield' ? 0.5 : 1));
  champ.trophies.push({ season: w.season, competitionId: comp.id, name: comp.name.replace(/ \d{4}$/, '') });
  champ.brand = clamp(champ.brand + (cup === 'champions' ? 3 : 1), 0, 100);
  champ.board.confidence = clamp(champ.board.confidence + (cup === 'champions' ? 8 : 4), 0, 100);
  w.universe?.continental.push({ id: comp.id, season: w.season, region, cup, championId: comp.championId, runnerUpId: comp.runnerUpId, finalVenueId: venueId });
  if (champ.isUser) addTimeline(w, 'title', `${comp.name.replace(/ \d{4}$/, '')} winners`, `Beat ${w.clubs[comp.runnerUpId!].name} in the final.`, [comp.id]);
  addNews(w, {
    kind: 'result', importance: cup === 'champions' ? 3 : 2, headline: `${champ.name} win the ${comp.name}`,
    body: `${champ.name} beat ${w.clubs[comp.runnerUpId!].name} in the final.`, clubIds: [champ.id, comp.runnerUpId!], playerIds: [], sourceRef: comp.id,
  });
}

/** Global Club Championship entrants: continental winners and runners-up, then the best Premier Division clubs. */
export function globalQualifiers(w: WorldState): { clubId: string; leagueId: string; route: string }[] {
  const out: { clubId: string; leagueId: string; route: string }[] = [];
  const add = (id: string | null, route: string) => {
    if (id && !out.some((q) => q.clubId === id)) out.push({ clubId: id, leagueId: w.clubs[id].leagueId, route });
  };
  for (const region of REGIONS) {
    const c = w.competitions[cupId(region, 'champions', w.season)];
    if (c) {
      add(c.championId, `${region} champions`);
      add(c.runnerUpId, `${region} runners-up`);
    }
  }
  const top = w.competitions[`${DIVISIONS[0].id}-${w.season}`];
  if (top) for (const id of finishingOrder(w, top.id)) {
    if (out.length >= CONTINENTAL.globalTeams) break;
    add(id, `${DIVISIONS[0].shortName} finish`);
  }
  // Still short (small regions): the best remaining clubs by qualification score.
  if (out.length < CONTINENTAL.globalTeams) {
    const rest = Object.values(w.clubs).map((c) => ({ id: c.id, s: qualificationScore(w, c).score })).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
    for (const r of rest) {
      if (out.length >= CONTINENTAL.globalTeams) break;
      add(r.id, 'Coefficient place');
    }
  }
  return out;
}

/** End of season: coefficients roll (last three seasons count). */
export function rollCoefficients(w: WorldState) {
  if (!w.universe) return;
  for (const c of Object.values(w.universe.coefficients)) {
    const thisSeason = Math.round((c.points - c.history.slice(-2).reduce((a, h) => a + h.points, 0)) * 10) / 10;
    c.history.push({ season: w.season, points: Math.max(0, thisSeason) });
    c.history = c.history.slice(-3);
    c.points = Math.round(c.history.slice(-2).reduce((a, h) => a + h.points, 0) * 10) / 10;
  }
}

