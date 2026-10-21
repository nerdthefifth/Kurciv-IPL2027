import type { Club, Fixture, Player, WorldState } from '@kurciv/domain';
import {
  ageOf, battingAverage, battingRating, bowlingRating, economy, emptyStatLine, fieldingRating, isOverseas, marketValue, overall, potentialRange,
  scoutedRange, strikeRate,
} from '@kurciv/domain';
import { COUNTRY_NAMES, leagueById, venueById } from '@kurciv/config';
import type { MatchState } from '@kurciv/simulation';
import { askingPrice, financeSummary, nextUserFixture, nrr, payrollOf, retentionCost, sortRows, squadOf } from '@kurciv/world';

export function playerView(w: WorldState, p: Player, opts: { detail?: boolean } = {}) {
  const viewer = w.clubs[w.userClubId];
  const own = p.clubId === viewer.id || viewer.academy.includes(p.id);
  const range = scoutedRange(p, viewer.facilities.scouting, own);
  const club = p.clubId ? w.clubs[p.clubId] : null;
  const seasonKey = Object.keys(p.stats.seasons).filter((k) => k.startsWith(`${w.season}:`));
  const season = seasonKey.reduce((acc, k) => {
    const s = p.stats.seasons[k];
    for (const [f, v] of Object.entries(s)) (acc as unknown as Record<string, number>)[f] += v as number;
    acc.highScore = Math.max(acc.highScore, s.highScore);
    return acc;
  }, emptyStatLine());
  const r = (v: number) => (own ? Math.round(v) : Math.round(v / 5) * 5);
  const base = {
    id: p.id, name: p.name, shortName: p.shortName, country: p.country, countryName: COUNTRY_NAMES[p.country], age: ageOf(p, w.season),
    ageConfidence: p.ageConfidence, role: p.role, batHand: p.batHand, bowlType: p.bowlType, capped: p.capped, source: p.source, tags: p.styleTags,
    ovr: own ? Math.round(overall(p)) : Math.round((range.lo + range.hi) / 2), range, potential: potentialRange(p, viewer.facilities.scouting),
    batting: r(battingRating(p.attrs)), bowling: r(bowlingRating(p.attrs, p.bowlType)), fielding: r(fieldingRating(p.attrs)),
    form: own ? p.form : null, fatigue: Math.round(p.fatigue), morale: own ? Math.round(p.morale) : null,
    injury: p.injury ? { type: p.injury.type, severity: p.injury.severity, daysRemaining: Math.ceil(p.injury.daysRemaining), expected: `${p.injury.expectedDaysMin}–${p.injury.expectedDaysMax} days` } : null,
    clubId: p.clubId, clubShort: club?.shortName ?? null, clubName: club?.name ?? null, isYouth: p.isYouth, retired: p.retired,
    overseas: isOverseas(p, leagueById(viewer.leagueId).domesticCountries),
    contract: p.contract ? { salary: p.contract.salary, acquired: p.contract.acquired, retainedCount: p.contract.retainedCount } : null,
    reputation: p.reputation, marketValue: marketValue(p, w.season), transferRequest: own ? p.transferRequest : false,
    asking: !p.clubId && !p.isYouth ? askingPrice(w, p, viewer) : null,
    image: p.image,
    season: statView(season),
    career: statView(p.stats.career),
  };
  if (!opts.detail) return base;
  return {
    ...base,
    attrs: own ? p.attrs : coarseAttrs(p),
    personality: own ? p.personality : null,
    development: p.development,
    injuryHistory: p.injuryHistory,
    bySeason: Object.entries(p.stats.seasons).map(([k, s]) => {
      const [season, compId] = k.split(':');
      return { season: Number(season), competition: w.competitions[compId]?.name ?? compId, ...statView(s) };
    }).sort((a, b) => b.season - a.season),
    dataNote: p.source === 'curated'
      ? 'Real player identity. Ratings and age are Kurciv editorial estimates; statistics are from this career only.'
      : p.source === 'youth' ? 'Academy prospect generated in this career.' : 'Generated player — not a real person.',
  };
}

function coarseAttrs(p: Player) {
  const round = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'speed' ? Math.round(v as number) : Math.round((v as number) / 5) * 5]));
  return { bat: round(p.attrs.bat), bowl: round(p.attrs.bowl), field: round(p.attrs.field), mental: round(p.attrs.mental), phys: round(p.attrs.phys) };
}

export function statView(s: ReturnType<typeof emptyStatLine>) {
  return {
    ...s,
    average: battingAverage(s),
    strikeRate: strikeRate(s),
    economy: economy(s),
    bowlingAverage: s.wickets ? Math.round((s.runsConceded / s.wickets) * 10) / 10 : null,
    best: s.bestWkts ? `${s.bestWkts}/${s.bestRuns}` : null,
  };
}

export function clubView(w: WorldState, c: Club) {
  const l = leagueById(c.leagueId);
  const squad = squadOf(w, c);
  return {
    id: c.id, name: c.name, shortName: c.shortName, city: c.city, country: c.country, leagueId: c.leagueId, leagueName: l.name, leagueShort: l.shortName,
    venue: venueById(c.venueId).name, colors: c.colors, personality: c.personality, isUser: c.isUser, isCustom: c.isCustom,
    purse: c.purse, cash: c.cash, brand: c.brand, fanBase: c.fanBase, elo: c.elo, facilities: c.facilities, coaches: c.coaches,
    board: c.board, dna: c.dna, trophies: c.trophies, squadSize: squad.length,
    overseas: squad.filter((p) => isOverseas(p, l.domesticCountries)).length,
    rules: l.squadRules, payroll: payrollOf(w, c),
  };
}

export function fixtureView(w: WorldState, f: Fixture) {
  const comp = w.competitions[f.competitionId];
  return {
    id: f.id, competitionId: f.competitionId, competition: comp?.name ?? f.competitionId, season: f.season, day: f.day, stage: f.stage, group: f.group ?? null,
    homeId: f.homeId, awayId: f.awayId, home: f.homeId ? w.clubs[f.homeId]?.shortName : f.homeRef ?? 'TBD', away: f.awayId ? w.clubs[f.awayId]?.shortName : f.awayRef ?? 'TBD',
    homeName: f.homeId ? w.clubs[f.homeId]?.name : 'To be decided', awayName: f.awayId ? w.clubs[f.awayId]?.name : 'To be decided',
    venue: f.venueId ? venueById(f.venueId).name : 'TBD', status: f.status, involvesUser: f.involvesUser,
    result: f.result ? {
      winnerId: f.result.winnerId, margin: f.result.margin, superOver: !!f.result.superOver,
      innings: f.result.innings.map((i) => ({ clubId: i.battingClubId, runs: i.runs, wickets: i.wickets, balls: i.balls })),
      playerOfMatch: f.result.playerOfMatch ? { id: f.result.playerOfMatch, name: w.players[f.result.playerOfMatch]?.name } : null,
    } : null,
  };
}

export function standingsView(w: WorldState, compId: string, key = 'main') {
  const comp = w.competitions[compId];
  if (!comp) return [];
  return sortRows(comp.standings[key] ?? []).map((r, i) => ({ pos: i + 1, ...r, nrr: nrr(r), club: w.clubs[r.clubId].name, short: w.clubs[r.clubId].shortName, isUser: r.clubId === w.userClubId }));
}

export function overview(w: WorldState) {
  const c = w.clubs[w.userClubId];
  const next = nextUserFixture(w);
  const comp = w.competitions[`${c.leagueId}-${w.season}`];
  const squad = squadOf(w, c);
  const table = comp ? standingsView(w, comp.id) : [];
  const recent = Object.values(w.fixtures).filter((f) => f.involvesUser && f.status === 'complete').sort((a, b) => b.day - a.day).slice(0, 5);
  const urgent: string[] = [];
  if (w.phase === 'retention') urgent.push('Choose up to 6 players to retain before the auction.');
  if (w.phase === 'auction') urgent.push('Your league auction is live.');
  if (w.phase === 'preseason') urgent.push('Finalise your squad and tactics, then start the season.');
  if (squad.some((p) => p.transferRequest)) urgent.push('A player has asked about their future (see Squad).');
  const injured = squad.filter((p) => p.injury);
  if (injured.length) urgent.push(`${injured.length} player(s) injured.`);
  if (c.board.confidence < 30) urgent.push(`Board confidence is low (${c.board.confidence}).`);
  return {
    season: w.season, day: w.day, phase: w.phase, managerName: w.managerName, difficulty: w.difficulty,
    club: clubView(w, c),
    nextFixture: next ? fixtureView(w, next) : null,
    recent: recent.map((f) => fixtureView(w, f)),
    position: table.find((r) => r.isUser) ?? null,
    table: table.slice(0, 10),
    fitness: squad.map((p) => ({ id: p.id, name: p.shortName, fatigue: Math.round(p.fatigue), injury: p.injury?.type ?? null, morale: Math.round(p.morale), form: p.form })).sort((a, b) => b.fatigue - a.fatigue).slice(0, 8),
    news: w.news.slice(0, 12),
    urgent,
    finance: { purse: c.purse, cash: c.cash, payroll: payrollOf(w, c) },
  };
}

export function retentionView(w: WorldState) {
  const c = w.clubs[w.userClubId];
  const l = leagueById(c.leagueId);
  const cost = retentionCost(w, c, c.retentionChoices);
  return {
    maxRetentions: l.squadRules.maxRetentions, purse: l.auctionRules.purse, slabs: l.squadRules.retentionCosts, uncappedCost: l.squadRules.uncappedRetentionCost,
    chosen: c.retentionChoices, costs: cost.perPlayer, total: cost.total, remainingPurse: Math.round((l.auctionRules.purse - cost.total) * 100) / 100,
    squad: squadOf(w, c).map((p) => ({ ...playerView(w, p), valueToClub: Math.round(marketValue(p, w.season) * (l.auctionRules.purse / 120) * 100) / 100 })),
  };
}

/** Live match view for the client: hides RNG state and hidden per-match form. */
export function liveView(state: MatchState, sinceSeq = 0) {
  const { rng: _r, dayForm: _d, deliveries, ...rest } = state;
  return { ...rest, deliveries: deliveries.filter((d) => d.seq > sinceSeq), totalDeliveries: deliveries.length };
}

export function financeView(w: WorldState) {
  return financeSummary(w, w.userClubId);
}
