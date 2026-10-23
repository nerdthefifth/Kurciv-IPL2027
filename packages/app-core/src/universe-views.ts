import type { Club, IntlFixture, MatchFormat, Region, WorldState } from '@kurciv/domain';
import { ageOf, marketValue, overall } from '@kurciv/domain';
import {
  COUNTRY_NAMES, DIVISIONS, FICTIONAL_CLUB_SEEDS, INTERNATIONAL, PRESEASON, PYRAMID, REGIONS, leagueById, regionOf, stadiumById, stadiumCatalogue,
} from '@kurciv/config';
import {
  activeLeagues, auctionEstimate, autoSquad, categoryOf, clubRegion, clubsInLeague, cupId, eligibleFor, formatRating, friendlyCompId,
  isPyramid, playersOnDuty, qualificationScore, rankings, registrationFor, roleTargets, sortRows, squadOf, valuePlayer,
} from '@kurciv/world';
import { clubView, fixtureView, playerView, standingsView } from './views';

/** Read models for the global universe screens. Everything is derived from the world state. */

export function populationCounts(w: WorldState) {
  const ps = Object.values(w.players);
  const active = ps.filter((p) => !p.retired);
  const user = w.clubs[w.userClubId];
  const l = leagueById(user.leagueId);
  const reg = registrationFor(w, l);
  return {
    total: ps.length,
    active: active.length,
    real: active.filter((p) => p.source === 'curated' || p.source === 'registry').length,
    fictional: active.filter((p) => p.source === 'generated' || p.source === 'youth').length,
    contracted: active.filter((p) => p.clubId).length,
    academy: active.filter((p) => p.isYouth).length,
    freeAgents: active.filter((p) => !p.clubId && !p.isYouth).length,
    auctionEligible: reg.eligible.length,
    retired: ps.length - active.length,
  };
}

export function universeOverview(w: WorldState) {
  const pyramid = isPyramid(w);
  const comps = Object.values(w.competitions).filter((c) => c.season === w.season);
  const st = w.universe?.international;
  return {
    worldModel: w.worldModel ?? 'leagues', season: w.season, day: w.day, phase: w.phase,
    counts: {
      ...populationCounts(w),
      clubs: Object.keys(w.clubs).length,
      fictionalClubs: Object.values(w.clubs).filter((c) => FICTIONAL_CLUB_SEEDS.some((s) => s.id === c.id)).length,
      divisions: pyramid ? DIVISIONS.length : 0,
      leagues: activeLeagues(w).length,
      stadiums: stadiumCatalogue().length,
      fictionalStadiums: stadiumCatalogue().filter((v) => v.fictional).length,
      competitions: comps.length,
      nations: st ? Object.keys(st.nations).length : 0,
      internationalEvents: st ? Object.values(st.events).filter((e) => e.season === w.season).length : 0,
    },
    divisions: activeLeagues(w).map((d) => {
      const comp = w.competitions[`${d.id}-${w.season}`];
      const table = comp ? standingsView(w, comp.id) : [];
      return {
        id: d.id, name: d.name, shortName: d.shortName, tier: d.tier ?? null, clubs: clubsInLeague(w, d.id).length, purse: d.auctionRules.purse,
        reputation: w.leagues[d.id]?.reputation ?? d.initialReputation, leader: table[0] ? { id: table[0].clubId, name: table[0].club } : null,
        champion: comp?.championId ? w.clubs[comp.championId].name : null,
      };
    }),
    calendar: w.universe?.calendar ?? [],
  };
}

export function pyramidView(w: WorldState, season?: number) {
  if (!w.universe) return { enabled: false as const };
  const cfg = w.universe.config;
  const divisions = DIVISIONS.map((d) => {
    const comp = w.competitions[`${d.id}-${w.season}`];
    const table = comp ? standingsView(w, comp.id) : clubsInLeague(w, d.id).map((c, i) => ({ pos: i + 1, clubId: c.id, club: c.name, short: c.shortName, isUser: c.isUser, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, nrr: 0, form: [] as string[] }));
    const tier = d.tier!;
    return {
      id: d.id, name: d.name, shortName: d.shortName, tier, purse: d.auctionRules.purse, prize: d.prizeMoney, playoffs: d.playoffs,
      reputation: w.leagues[d.id]?.reputation ?? d.initialReputation,
      zones: { promote: tier > 1 ? cfg.promote : 0, relegate: tier < DIVISIONS.length ? cfg.relegate : 0 },
      stage: comp?.stage ?? 'pending', championId: comp?.championId ?? null,
      table: table.map((r) => ({ ...r, colors: w.clubs[r.clubId].colors, country: w.clubs[r.clubId].country, region: regionOf(w.clubs[r.clubId].country) })),
    };
  });
  const history = w.universe.pyramidHistory.filter((h) => season === undefined || h.season === season).map((h) => ({
    season: h.season,
    champions: Object.entries(h.champions).map(([div, id]) => ({ division: leagueById(div).shortName, clubId: id, club: w.clubs[id]?.name ?? id })),
    movements: h.movements.map((m) => ({ ...m, club: w.clubs[m.clubId]?.name ?? m.clubId, short: w.clubs[m.clubId]?.shortName ?? m.clubId, fromName: leagueById(m.from).shortName, toName: leagueById(m.to).shortName })),
  })).reverse();
  return {
    enabled: true as const, config: cfg, rules: {
      text: `${cfg.divisions} divisions of ${cfg.clubsPerDivision}. Single round-robin, then playoffs (top four). The top ${cfg.promote} in each lower division by finishing order (champion, runner-up, then table) go up; the bottom ${cfg.relegate} by table go down. Table ties: points, net run rate, wins, then club code.`,
      parachute: `Relegated clubs receive ${Math.round(PYRAMID.parachuteShare * 100)}% of the purse difference; promoted clubs a bonus of ${Math.round(PYRAMID.promotionBonusShare * 100)}% of their new purse.`,
    },
    divisions, history,
  };
}

export function clubDirectory(w: WorldState, q: { search?: string; region?: string; division?: string; country?: string; sort?: string }) {
  const s = q.search?.trim().toLowerCase();
  let clubs = Object.values(w.clubs);
  if (s) clubs = clubs.filter((c) => c.name.toLowerCase().includes(s) || c.city.toLowerCase().includes(s) || c.shortName.toLowerCase().includes(s));
  if (q.region) clubs = clubs.filter((c) => regionOf(c.country) === q.region);
  if (q.division) clubs = clubs.filter((c) => c.leagueId === q.division);
  if (q.country) clubs = clubs.filter((c) => c.country === q.country);
  const strength = (c: Club) => {
    const sq = squadOf(w, c);
    return sq.length ? Math.round(sq.map(overall).sort((a, b) => b - a).slice(0, 11).reduce((a, b) => a + b, 0) / Math.min(11, sq.length)) : 0;
  };
  const rows = clubs.map((c) => {
    const l = leagueById(c.leagueId);
    const v = stadiumById(c.venueId);
    return {
      id: c.id, name: c.name, shortName: c.shortName, city: c.city, country: c.country, countryName: COUNTRY_NAMES[c.country], region: regionOf(c.country),
      division: l.shortName, divisionId: l.id, tier: l.tier ?? null, colors: c.colors, brand: c.brand, elo: c.elo, strength: strength(c), squad: c.squad.length,
      venue: v.name, capacity: v.capacity ?? null, fictional: FICTIONAL_CLUB_SEEDS.some((x) => x.id === c.id) || c.isCustom, isUser: c.isUser,
      trophies: c.trophies.length, coefficient: w.universe?.coefficients[c.id]?.points ?? 0,
    };
  });
  const key = q.sort ?? 'tier';
  rows.sort((a, b) => key === 'name' ? a.name.localeCompare(b.name) : key === 'strength' ? b.strength - a.strength : key === 'brand' ? b.brand - a.brand
    : (a.tier ?? 9) - (b.tier ?? 9) || b.elo - a.elo || a.name.localeCompare(b.name));
  return { total: rows.length, clubs: rows, regions: REGIONS, divisions: activeLeagues(w).map((d) => ({ id: d.id, name: d.shortName })) };
}

export function continentalView(w: WorldState) {
  if (!w.universe) return { enabled: false as const };
  const cups = REGIONS.flatMap((region) => (['champions', 'shield'] as const).map((cup) => {
    const comp = w.competitions[cupId(region, cup, w.season)];
    if (!comp) return null;
    const groups = (comp.meta?.groups ?? {}) as Record<string, string[]>;
    return {
      id: comp.id, region, cup, name: comp.name, stage: comp.stage, round: comp.meta?.round ?? null,
      championId: comp.championId, champion: comp.championId ? w.clubs[comp.championId].name : null, runnerUp: comp.runnerUpId ? w.clubs[comp.runnerUpId].name : null,
      clubs: comp.clubIds.map((id) => ({ id, name: w.clubs[id].name, short: w.clubs[id].shortName, colors: w.clubs[id].colors, isUser: w.clubs[id].isUser })),
      groups: Object.keys(groups).sort().map((g) => ({ group: g, table: standingsView(w, comp.id, g) })),
      fixtures: Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => fixtureView(w, f)),
      finalVenue: comp.meta?.finalVenue ? stadiumById(comp.meta.finalVenue as string).name : null,
    };
  }).filter(Boolean));
  const global = w.competitions[`WCC-${w.season}`];
  const ranking = (region: Region) => Object.values(w.clubs)
    .filter((c) => clubRegion(c) === region)
    .map((c) => ({ id: c.id, name: c.name, short: c.shortName, division: leagueById(c.leagueId).shortName, isUser: c.isUser, ...qualificationScore(w, c), coefficient: w.universe!.coefficients[c.id]?.points ?? 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    enabled: true as const, season: w.season,
    rules: 'After the divisional season each region holds a Champions Cup (top eight by qualification score) and a Shield (next eight). Score = 70% pyramid performance this season + 30% reputation (brand and three-season coefficient). Groups of four, semi-finals, final at a neutral ground. Winners and runners-up of every Champions Cup, plus the best Premier Division finishers, make the 16-club Global Club Championship.',
    cups,
    global: global ? { id: global.id, name: global.name, stage: global.stage, champion: global.championId ? w.clubs[global.championId].name : null, qualifiers: (global.meta?.qualifiers ?? []) as unknown[] } : null,
    rankings: Object.fromEntries(REGIONS.map((r) => [r, ranking(r).slice(0, 20)])),
    history: [...w.universe.continental].reverse().slice(0, 60).map((h) => ({ ...h, champion: h.championId ? w.clubs[h.championId]?.name : null, runnerUp: h.runnerUpId ? w.clubs[h.runnerUpId]?.name : null, venue: h.finalVenueId ? stadiumById(h.finalVenueId).name : null })),
  };
}

function intlFixtureView(w: WorldState, f: IntlFixture) {
  const st = w.universe!.international;
  const n = (id: string) => st.nations[id];
  return {
    id: f.id, eventId: f.eventId, event: st.events[f.eventId]?.name ?? f.eventId, day: f.day, days: f.days, format: f.format, stage: f.stage, group: f.group ?? null,
    homeId: f.homeId, awayId: f.awayId, home: n(f.homeId)?.name ?? 'TBD', away: n(f.awayId)?.name ?? 'TBD', homeCode: n(f.homeId)?.country ?? '', awayCode: n(f.awayId)?.country ?? '',
    venue: stadiumById(f.venueId).name, neutral: f.neutral, status: f.status, involvesUser: f.involvesUser,
    result: f.result ? { winnerId: f.result.winnerId, margin: f.result.margin, innings: f.result.innings.map((i) => ({ nationId: i.battingClubId, runs: i.runs, wickets: i.wickets, balls: i.balls })), playerOfMatch: f.result.playerOfMatch ? { id: f.result.playerOfMatch, name: w.players[f.result.playerOfMatch]?.name } : null } : null,
  };
}

export function internationalView(w: WorldState) {
  const st = w.universe?.international;
  if (!st) return { enabled: false as const };
  const nationRow = (id: string) => {
    const n = st.nations[id];
    return { id: n.id, country: n.country, name: n.name, full: n.full, region: n.region, colors: n.colors, rating: n.rating, manager: n.managerName, userManaged: n.userManaged, record: n.record };
  };
  const events = Object.values(st.events).filter((e) => e.season === w.season).sort((a, b) => a.startDay - b.startDay || a.id.localeCompare(b.id));
  return {
    enabled: true as const, season: w.season, day: w.day,
    userNationId: st.userNationId,
    offers: st.offers.map((o) => ({ ...o, nation: nationRow(o.nationId) })),
    rankings: Object.fromEntries((['Test', 'ODI', 'T20'] as MatchFormat[]).map((f) => [f, rankings(w, f).map((n, i) => ({ pos: i + 1, ...nationRow(n.id), points: n.rating[f] }))])),
    events: events.map((e) => ({
      id: e.id, name: e.name, kind: e.kind, format: e.format, startDay: e.startDay, endDay: e.endDay, status: e.status, stage: e.stage, description: e.description,
      host: e.hostCountry ? COUNTRY_NAMES[e.hostCountry] : 'Neutral', nations: e.nationIds.map(nationRow),
      champion: e.championId ? st.nations[e.championId].name : null, runnerUp: e.runnerUpId ? st.nations[e.runnerUpId].name : null,
      series: e.series ? Object.entries(e.series).map(([id, wins]) => ({ nation: st.nations[id].name, wins })) : null,
      groups: Object.keys(e.standings).sort().map((g) => ({ group: g, table: sortRows(e.standings[g]).map((r, i) => ({ pos: i + 1, nation: st.nations[r.clubId].name, ...r })) })),
      fixtures: Object.values(st.fixtures).filter((f) => f.eventId === e.id).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true })).map((f) => intlFixtureView(w, f)),
    })),
    history: [...st.history].reverse().slice(0, 60).map((h) => ({ ...h, champion: h.championId ? st.nations[h.championId]?.name : 'Shared', runnerUp: h.runnerUpId ? st.nations[h.runnerUpId]?.name : null })),
    calledUpFromMyClub: [...playersOnDuty(w, w.day)].filter((pid) => w.players[pid]?.clubId === w.userClubId).map((pid) => ({ id: pid, name: w.players[pid].name })),
    formats: { T20: 'T20: 20 overs a side.', ODI: 'ODI: 50 overs a side, 10 overs per bowler.', Test: 'Test: two innings each over five days of 90 overs, with declarations, the follow-on (200 runs) and draws.' },
  };
}

export function nationView(w: WorldState, id: string, format: MatchFormat) {
  const st = w.universe?.international;
  const n = st?.nations[id];
  if (!st || !n) return null;
  const eligible = eligibleFor(w, n).sort((a, b) => formatRating(b, format) - formatRating(a, format)).slice(0, 60);
  const squad = n.squads[format] ?? autoSquad(w, n, format);
  return {
    nation: { id: n.id, name: n.name, country: n.country, full: n.full, colors: n.colors, rating: n.rating, manager: n.managerName, userManaged: n.userManaged, captainId: n.captainId, record: n.record },
    format, squadSize: INTERNATIONAL.squadSize[format],
    squad: squad.map((pid) => ({ ...playerView(w, w.players[pid]), formatRating: Math.round(formatRating(w.players[pid], format)), category: categoryOf(w.players[pid]) })),
    pool: eligible.map((p) => ({ ...playerView(w, p), formatRating: Math.round(formatRating(p, format)), category: categoryOf(p) })),
    eligibility: `Players with ${n.name} nationality aged 17 or over, not retired and not in an academy (${eligibleFor(w, n).length} eligible).`,
    fixtures: Object.values(st.fixtures).filter((f) => f.season === w.season && (f.homeId === id || f.awayId === id)).sort((a, b) => a.day - b.day).map((f) => intlFixtureView(w, f)),
  };
}

export function intlFixtureDetail(w: WorldState, fid: string) {
  const f = w.universe?.international.fixtures[fid];
  if (!f) return null;
  const st = w.universe!.international;
  return {
    fixture: intlFixtureView(w, f),
    scorecard: f.result ? f.result.innings.map((i) => ({
      nation: st.nations[i.battingClubId]?.name ?? i.battingClubId, runs: i.runs, wickets: i.wickets, balls: i.balls, extras: i.extras,
      batting: i.batting.map((b) => ({ ...b, name: w.players[b.playerId]?.name ?? b.playerId })),
      bowling: i.bowling.map((b) => ({ ...b, name: w.players[b.playerId]?.name ?? b.playerId })),
    })) : [],
  };
}

export function preseasonView(w: WorldState, q: { search?: string; region?: string; division?: string }) {
  const user = w.clubs[w.userClubId];
  const comp = friendlyCompId(w.season);
  const mine = Object.values(w.fixtures).filter((f) => f.competitionId === comp && f.involvesUser).sort((a, b) => a.day - b.day).map((f) => fixtureView(w, f));
  const all = Object.values(w.fixtures).filter((f) => f.competitionId === comp);
  const s = q.search?.trim().toLowerCase();
  let opponents = Object.values(w.clubs).filter((c) => !c.isUser);
  if (s) opponents = opponents.filter((c) => c.name.toLowerCase().includes(s) || c.city.toLowerCase().includes(s) || c.shortName.toLowerCase().includes(s));
  if (q.region) opponents = opponents.filter((c) => regionOf(c.country) === q.region);
  if (q.division) opponents = opponents.filter((c) => c.leagueId === q.division);
  const tier = (c: Club) => leagueById(c.leagueId).tier ?? 0;
  opponents.sort((a, b) => Math.abs(tier(a) - tier(user)) - Math.abs(tier(b) - tier(user)) || (regionOf(a.country) === regionOf(user.country) ? 0 : 1) - (regionOf(b.country) === regionOf(user.country) ? 0 : 1) || b.elo - a.elo);
  const booked = (id: string) => all.filter((f) => f.homeId === id || f.awayId === id).map((f) => f.day);
  return {
    enabled: isPyramid(w) && w.phase === 'preseason', phase: w.phase, day: w.day,
    window: { from: Math.max(w.day + 1, PRESEASON.firstDay), to: PRESEASON.lastDay }, max: PRESEASON.maxFriendlies, minGap: PRESEASON.minGap,
    rules: `Up to ${PRESEASON.maxFriendlies} friendlies between day ${PRESEASON.firstDay} and day ${PRESEASON.lastDay}, at least ${PRESEASON.minGap} days apart. Friendlies never affect tables; they count ${Math.round(PRESEASON.reputationWeight * 100)}% toward reputation and ${Math.round(PRESEASON.boardWeight * 100)}% toward board confidence. Players on international duty are unavailable.`,
    mine, aiFriendlies: all.filter((f) => !f.involvesUser).length,
    myClub: { id: user.id, name: user.name, venueId: user.venueId, venue: stadiumById(user.venueId).name, region: regionOf(user.country), tier: tier(user) },
    opponents: opponents.slice(0, 60).map((c) => ({
      id: c.id, name: c.name, short: c.shortName, colors: c.colors, division: leagueById(c.leagueId).shortName, tier: tier(c), region: regionOf(c.country), country: COUNTRY_NAMES[c.country],
      venueId: c.venueId, venue: stadiumById(c.venueId).name, elo: c.elo, booked: booked(c.id),
    })),
    neutralVenues: stadiumCatalogue().filter((v) => regionOf(v.country) === regionOf(user.country)).map((v) => ({ id: v.id, name: v.name, city: v.city })),
    onDutyToday: [...playersOnDuty(w, w.day)].filter((pid) => w.players[pid]?.clubId === user.id).length,
  };
}

export function stadiumDirectory(w: WorldState, q: { search?: string; region?: string; country?: string; kind?: string; sort?: string }) {
  const home = new Map<string, string[]>();
  for (const c of Object.values(w.clubs)) home.set(c.venueId, [...(home.get(c.venueId) ?? []), c.name]);
  const s = q.search?.trim().toLowerCase();
  let list = stadiumCatalogue();
  if (s) list = list.filter((v) => v.name.toLowerCase().includes(s) || v.city.toLowerCase().includes(s));
  if (q.region) list = list.filter((v) => regionOf(v.country) === q.region);
  if (q.country) list = list.filter((v) => v.country === q.country);
  if (q.kind === 'real') list = list.filter((v) => !v.fictional);
  if (q.kind === 'fictional') list = list.filter((v) => v.fictional);
  const rows = list.map((v) => ({
    id: v.id, name: v.name, city: v.city, country: v.country, countryName: COUNTRY_NAMES[v.country], region: regionOf(v.country), capacity: v.capacity ?? null,
    fictional: !!v.fictional, climate: v.climate ?? null, altitude: v.altitude, boundary: { straight: v.boundaryStraight, square: v.boundarySquare },
    pitch: v.pitch, dewChance: v.dewChance, identity: v.identity ?? null, provenance: v.provenance ?? null, homeOf: home.get(v.id) ?? [],
  }));
  rows.sort((a, b) => q.sort === 'name' ? a.name.localeCompare(b.name) : (b.capacity ?? 0) - (a.capacity ?? 0) || a.name.localeCompare(b.name));
  return { total: rows.length, real: stadiumCatalogue().filter((v) => !v.fictional).length, fictional: stadiumCatalogue().filter((v) => v.fictional).length, stadiums: rows };
}

export function calendarView(w: WorldState) {
  const user = w.clubs[w.userClubId];
  const st = w.universe?.international;
  const clubDays = Object.values(w.fixtures).filter((f) => f.season === w.season && f.involvesUser).sort((a, b) => a.day - b.day).map((f) => ({ day: f.day, label: `${w.clubs[f.homeId]?.shortName ?? f.homeRef ?? 'TBD'} v ${w.clubs[f.awayId]?.shortName ?? f.awayRef ?? 'TBD'}`, kind: w.competitions[f.competitionId]?.kind ?? 'league', status: f.status, id: f.id }));
  const mine = new Set(user.squad);
  const callUps = st ? st.callUps.filter((c) => mine.has(c.playerId) && st.events[c.eventId]?.season === w.season).map((c) => ({ player: w.players[c.playerId].name, nation: st.nations[c.nationId].name, event: st.events[c.eventId].name, from: c.fromDay, to: c.toDay })) : [];
  const intlDays = st ? Object.values(st.fixtures).filter((f) => f.season === w.season).map((f) => ({ day: f.day, days: f.days, label: `${st.nations[f.homeId]?.country ?? '?'} v ${st.nations[f.awayId]?.country ?? '?'} (${f.format})`, event: st.events[f.eventId]?.name ?? '' })) : [];
  return { season: w.season, day: w.day, phase: w.phase, windows: w.universe?.calendar ?? [], club: clubDays, callUps, internationals: intlDays.sort((a, b) => a.day - b.day) };
}

/** Auction preparation: who is registered, what the squad needs, and recruitment signals for targets. */
export function auctionPrep(w: WorldState) {
  const user = w.clubs[w.userClubId];
  const l = leagueById(user.leagueId);
  const { eligible, registered } = registrationFor(w, l);
  const sq = squadOf(w, user);
  const tgt = roleTargets(l);
  const needs = (Object.keys(tgt) as (keyof typeof tgt)[]).map((k) => ({ role: k, have: sq.filter((p) => categoryOf(p) === k).length, target: tgt[k] }));
  const a = Object.values(w.auctions).find((x) => x.interactive && x.status !== 'complete');
  const byRole: Record<string, number> = {};
  for (const p of registered) byRole[categoryOf(p)] = (byRole[categoryOf(p)] ?? 0) + 1;
  const targets = registered
    .filter((p) => overall(p) >= 55)
    .sort((x, y) => marketValue(y, w.season) - marketValue(x, w.season))
    .slice(0, 120)
    .map((p) => {
      const est = auctionEstimate(p, w.season, l);
      const cat = categoryOf(p);
      const need = needs.find((n) => n.role === cat)!;
      const v = a ? valuePlayer(w, a, user, p, a.currentLotIndex) : null;
      const signals: string[] = [];
      if (need.have < need.target && overall(p) >= 68) signals.push('High tactical fit');
      if (ageOf(p, w.season) <= 24 && p.potential >= overall(p) + 8) signals.push('Strong long-term value');
      if (est > user.purse * 0.25) signals.push('Budget risk');
      if (v && v.maxBid >= est * 1.15) signals.push('Undervalued for your plan');
      if (v && v.maxBid > 0 && v.maxBid < est * 0.7) signals.push('Likely to cost more than your plan allows');
      if (!signals.length) signals.push(need.have >= need.target ? 'Depth option' : 'Fills a need');
      return { ...playerView(w, p), estimate: est, category: cat, signals, planMax: v?.maxBid ?? null, planReason: v?.reason ?? null };
    });
  return {
    division: l.name, purse: user.purse, squad: sq.length, maxSquad: l.squadRules.maxSquad, minSquad: l.squadRules.minSquad, maxOverseas: l.squadRules.maxOverseas,
    counts: { ...populationCounts(w), eligible: eligible.length, registered: registered.length, catalogued: a?.registration?.catalogued ?? null },
    rule: a?.registration?.rule ?? 'The catalogue is built when your auction opens.',
    needs, byRole, targets,
  };
}
