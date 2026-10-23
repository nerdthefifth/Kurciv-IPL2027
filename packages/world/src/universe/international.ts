import type { CallUp, CountryCode, Fixture, IntlEvent, IntlFixture, MatchFormat, NationState, Player, StandingRow, WorldState } from '@kurciv/domain';
import { ageOf, canBowl, emptyStatLine, overall } from '@kurciv/domain';
import { INTERNATIONAL, NATIONS, PRESEASON, WORLD, nationName, regionOf, stadiumById, stadiumCatalogue } from '@kurciv/config';
import { battingOrder, buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { rulesFor, type MatchState, type Side } from '@kurciv/simulation';
import { categoryOf, type Category } from '../auction';
import { emptyRow, sortRows } from '../competition';
import { applyMatchLoad } from '../condition';
import { depthOf } from '../create';
import { summarise } from '../matchday';
import { addTimeline } from '../story';
import { addNews, clamp, worldRng } from '../util';

/**
 * International cricket: national teams with AI (or user) managers, eligibility by nationality,
 * format-specific squad selection, a calendar of bilateral tours, tri-series, an associate
 * qualifier, regional cups and rotating world events, in T20, ODI and Test formats. Players called
 * up are unavailable to their clubs for the event. Nations never play two matches on one day,
 * and international windows never overlap the competitive club calendar.
 */

export const nationId = (c: CountryCode) => `NAT-${c}`;
const intl = (w: WorldState) => w.universe!.international;

const MANAGER_SURNAMES = ['Ashworth', 'Bhandari', 'Coetzer', 'Dlamini', 'Everett', 'Fernando', 'Gibbs', 'Hollins', 'Iqbal', 'Jayasena', 'Kambli', 'Lindqvist', 'Mahmood', 'Nkosi', 'Okafor', 'Pereira', 'Quayle', 'Rangana', 'Sewell', 'Tahir', 'Umeed', 'Vaughan', 'Whitlock', 'Yousaf', 'Zondi'];

// ------------------------------------------------------------------ nations

export function initNations(w: WorldState) {
  const st = intl(w);
  if (Object.keys(st.nations).length) return;
  const rng = worldRng(w, 'nations');
  for (const n of NATIONS) {
    const base = (n.full ? 1000 : 880) + (depthOf(n.country) - 55) * 14;
    const homes = stadiumCatalogue().filter((v) => v.country === n.country).map((v) => v.id);
    const id = nationId(n.country);
    st.nations[id] = {
      id, country: n.country, name: nationName(n.country), full: n.full, region: regionOf(n.country), colors: n.colors,
      rating: { T20: Math.round(base), ODI: Math.round(base + (n.full ? 10 : -20)), Test: Math.round(n.full ? base + 20 : 700) },
      managerName: `${String.fromCharCode(65 + rng.int(0, 25))}. ${rng.pick(MANAGER_SURNAMES)}`, userManaged: false,
      squads: {}, captainId: null,
      record: { T20: rec(), ODI: rec(), Test: rec() },
      homeVenueIds: homes,
    };
  }
}

const rec = () => ({ played: 0, won: 0, lost: 0, drawn: 0, tied: 0 });

/** Eligibility: the player's nationality (the game models one sporting nationality per player). */
export function eligibleFor(w: WorldState, nation: NationState): Player[] {
  return Object.values(w.players).filter((p) => p.country === nation.country && !p.retired && !p.isYouth && ageOf(p, w.season) >= 17);
}

/** Format-specific rating: Test cricket values defence and control; ODIs sit between Tests and T20. */
export function formatRating(p: Player, f: MatchFormat): number {
  if (f === 'T20') return overall(p);
  const a = p.attrs;
  const bat = f === 'Test'
    ? 0.33 * a.bat.vsPace + 0.29 * a.bat.vsSpin + 0.28 * a.bat.defence + 0.1 * a.bat.middle
    : 0.29 * a.bat.vsPace + 0.27 * a.bat.vsSpin + 0.14 * a.bat.rotation + 0.12 * a.bat.defence + 0.18 * a.bat.middle;
  const bowls = canBowl(p);
  const bowl = !bowls ? 0 : f === 'Test'
    ? 0.34 * a.bowl.control + 0.36 * a.bowl.movement + 0.15 * a.bowl.stamina + 0.15 * a.bowl.variation
    : 0.36 * a.bowl.control + 0.26 * a.bowl.movement + 0.14 * a.bowl.variation + 0.1 * a.bowl.death + 0.14 * a.bowl.stamina;
  switch (p.role) {
    case 'BAT': return bat;
    case 'WK': return bat * 0.8 + a.field.keeping * 0.2;
    case 'BOWL': return bowl;
    case 'AR': return Math.max(bat, bowl) * 0.6 + Math.min(bat, bowl) * 0.4 + 3;
  }
}

const SHAPE: Record<MatchFormat, Record<Category, number>> = {
  T20: { WK: 2, BAT: 4, AR: 3, PACE: 4, SPIN: 2 },
  ODI: { WK: 2, BAT: 5, AR: 2, PACE: 4, SPIN: 2 },
  Test: { WK: 2, BAT: 6, AR: 2, PACE: 4, SPIN: 2 },
};

/** The selectors' squad: best by format rating within a balanced shape, fit players only. */
export function autoSquad(w: WorldState, nation: NationState, f: MatchFormat): string[] {
  const size = INTERNATIONAL.squadSize[f];
  const pool = eligibleFor(w, nation).filter((p) => !p.injury || p.injury.daysRemaining <= 5).sort((a, b) => formatRating(b, f) - formatRating(a, f) || a.id.localeCompare(b.id));
  const out: Player[] = [];
  for (const [cat, n] of Object.entries(SHAPE[f]) as [Category, number][]) out.push(...pool.filter((p) => categoryOf(p) === cat && !out.includes(p)).slice(0, n));
  for (const p of pool) {
    if (out.length >= size) break;
    if (!out.includes(p)) out.push(p);
  }
  return out.slice(0, size).map((p) => p.id);
}

export function validateSquad(w: WorldState, nation: NationState, f: MatchFormat, ids: string[]): string | null {
  const size = INTERNATIONAL.squadSize[f];
  if (new Set(ids).size !== ids.length) return 'A player is listed twice.';
  if (ids.length < 11 || ids.length > size) return `A ${f} squad has 11 to ${size} players.`;
  const eligible = new Set(eligibleFor(w, nation).map((p) => p.id));
  for (const id of ids) {
    const p = w.players[id];
    if (!p || !eligible.has(id)) return `${p?.name ?? 'That player'} is not eligible for ${nation.name}.`;
  }
  if (!ids.some((id) => w.players[id].role === 'WK')) return 'The squad needs a wicketkeeper.';
  if (ids.filter((id) => canBowl(w.players[id]) && w.players[id].role !== 'BAT').length < 5) return 'The squad needs at least five bowling options.';
  return null;
}

function squadFor(w: WorldState, nation: NationState, f: MatchFormat): string[] {
  const chosen = nation.squads[f];
  if (nation.userManaged && chosen && !validateSquad(w, nation, f, chosen)) return chosen;
  const auto = autoSquad(w, nation, f);
  nation.squads[f] = auto;
  return auto;
}

// ------------------------------------------------------------------ duty

export function playersOnDuty(w: WorldState, day: number): Set<string> {
  const out = new Set<string>();
  const st = w.universe?.international;
  if (!st) return out;
  for (const c of st.callUps) if (day >= c.fromDay && day <= c.toDay && st.events[c.eventId]?.season === w.season) out.add(c.playerId);
  return out;
}

export function dutyOf(w: WorldState, playerId: string, day: number): CallUp | null {
  return w.universe?.international.callUps.find((c) => c.playerId === playerId && day >= c.fromDay && day <= c.toDay && w.universe!.international.events[c.eventId]?.season === w.season) ?? null;
}

function callUp(w: WorldState, ev: IntlEvent, nation: NationState) {
  const ids = squadFor(w, nation, ev.format);
  const st = intl(w);
  for (const pid of ids) st.callUps.push({ playerId: pid, nationId: nation.id, eventId: ev.id, fromDay: ev.startDay - INTERNATIONAL.releaseDays, toDay: ev.endDay + INTERNATIONAL.releaseDays });
  const user = w.clubs[w.userClubId];
  const mine = ids.filter((pid) => w.players[pid].clubId === user.id);
  if (mine.length) {
    addNews(w, {
      kind: 'board', importance: 2, headline: `${mine.length} ${user.shortName} player${mine.length === 1 ? '' : 's'} called up by ${nation.name}`,
      body: `${mine.map((pid) => w.players[pid].name).join(', ')} join${mine.length === 1 ? 's' : ''} the ${ev.name} squad (days ${ev.startDay}–${ev.endDay}) and will miss club matches in that window.`,
      clubIds: [user.id], playerIds: mine, sourceRef: `callup-${ev.id}-${nation.id}`,
    });
  }
}

// ------------------------------------------------------------------ scheduling

function venueIn(w: WorldState, country: CountryCode | null, salt: number, avoid: CountryCode[] = []): string {
  const all = stadiumCatalogue();
  let vs = country ? all.filter((v) => v.country === country) : [];
  if (!vs.length) vs = all.filter((v) => !avoid.includes(v.country) && !v.fictional).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0)).slice(0, 12);
  return vs[(salt + w.season) % vs.length].id;
}

function addFixture(w: WorldState, ev: IntlEvent, stage: string, home: string, away: string, day: number, venueId: string, neutral: boolean, group?: string, refs?: { homeRef?: string; awayRef?: string }) {
  const st = intl(w);
  const n = Object.values(st.fixtures).filter((f) => f.eventId === ev.id).length + 1;
  const fx: IntlFixture = {
    id: `${ev.id}-M${n}`, eventId: ev.id, season: w.season, day, days: ev.format === 'Test' ? INTERNATIONAL.testDays : 1, format: ev.format, stage, group,
    homeId: home, awayId: away, ...refs, venueId, neutral, status: 'scheduled', result: null,
    involvesUser: !!st.userNationId && (home === st.userNationId || away === st.userNationId),
  };
  st.fixtures[fx.id] = fx;
  return fx;
}

function newEvent(w: WorldState, id: string, name: string, kind: IntlEvent['kind'], format: MatchFormat, nationIds: string[], host: CountryCode | null, startDay: number, endDay: number, description: string): IntlEvent {
  const ev: IntlEvent = {
    id, season: w.season, name, kind, format, nationIds, hostCountry: host, startDay, endDay, status: 'scheduled', standings: {},
    stage: kind === 'bilateral' ? 'groups' : 'pending', championId: null, runnerUpId: null, description,
  };
  intl(w).events[id] = ev;
  return ev;
}

const byRating = (w: WorldState, f: MatchFormat) => (a: NationState, b: NationState) => b.rating[f] - a.rating[f] || a.id.localeCompare(b.id);

/**
 * Preseason window: bilateral tours between full members (paired by a rotating round-robin),
 * the associate T20 qualifier and an associate ODI tri-series.
 */
export function schedulePreseasonInternationals(w: WorldState) {
  const st = intl(w);
  if (Object.values(st.events).some((e) => e.season === w.season && e.startDay < PRESEASON.lastDay + 2)) return;
  initNations(w);
  const full = Object.values(st.nations).filter((n) => n.full).sort((a, b) => a.id.localeCompare(b.id));
  const assoc = Object.values(st.nations).filter((n) => !n.full).sort(byRating(w, 'T20'));
  const win = INTERNATIONAL.preseasonWindow;
  // Rotating pairings: circle method, a different round each season.
  const ids = full.map((n) => n.id);
  const rot = (w.season - WORLD.startSeason) % (ids.length - 1);
  const arr = [...ids];
  for (let r = 0; r < rot; r++) arr.splice(1, 0, arr.pop()!);
  for (let i = 0; i < arr.length / 2; i++) {
    const host = st.nations[arr[i]];
    const guest = st.nations[arr[arr.length - 1 - i]];
    const test = (i + w.season) % 2 === 0;
    if (test) {
      const ev = newEvent(w, `INT-${w.season}-T${i}`, `${host.name} v ${guest.name} Test series`, 'bilateral', 'Test', [host.id, guest.id], host.country, win.from + 2, win.from + 16, 'Two Tests, five days each.');
      ev.series = { [host.id]: 0, [guest.id]: 0 };
      addFixture(w, ev, '1st Test', host.id, guest.id, win.from + 2, venueIn(w, host.country, 0), false);
      addFixture(w, ev, '2nd Test', host.id, guest.id, win.from + 10, venueIn(w, host.country, 1), false);
      callUp(w, ev, host);
      callUp(w, ev, guest);
    } else {
      const ev = newEvent(w, `INT-${w.season}-O${i}`, `${host.name} v ${guest.name} ODI series`, 'bilateral', 'ODI', [host.id, guest.id], host.country, win.from + 2, win.from + 6, 'Three one-day internationals.');
      ev.series = { [host.id]: 0, [guest.id]: 0 };
      [0, 2, 4].forEach((d, k) => addFixture(w, ev, `${k + 1}${['st', 'nd', 'rd'][k]} ODI`, host.id, guest.id, win.from + 2 + d, venueIn(w, host.country, k), false));
      callUp(w, ev, host);
      callUp(w, ev, guest);
      const t20 = newEvent(w, `INT-${w.season}-TT${i}`, `${host.name} v ${guest.name} T20I series`, 'bilateral', 'T20', [host.id, guest.id], host.country, win.from + 10, win.from + 12, 'Two T20 internationals.');
      t20.series = { [host.id]: 0, [guest.id]: 0 };
      [0, 2].forEach((d, k) => addFixture(w, t20, `${k + 1}${['st', 'nd'][k]} T20I`, host.id, guest.id, win.from + 10 + d, venueIn(w, host.country, k + 3), false));
      callUp(w, t20, host);
      callUp(w, t20, guest);
    }
  }
  // Associate T20 qualifier: the top eight associates, two groups of four, semi-finals and a final.
  const q8 = assoc.slice(0, 8);
  if (q8.length === 8) {
    const host = q8[(w.season - WORLD.startSeason) % 8].country;
    const ev = newEvent(w, `INT-${w.season}-Q`, `World Cup Qualifier ${w.season}`, 'qualifier', 'T20', q8.map((n) => n.id), host, win.from + 4, win.from + 14, 'Eight associates, two groups of four; semi-finals and a final. Finalists earn the associate places at the next T20 World Cup.');
    const groups: Record<string, string[]> = { A: [q8[0], q8[3], q8[4], q8[7]].map((n) => n.id), B: [q8[1], q8[2], q8[5], q8[6]].map((n) => n.id) };
    scheduleGroups(w, ev, groups, win.from + 4, host);
    ev.stage = 'groups';
    for (const n of q8) callUp(w, ev, n);
  }
  // Tri-series among the next associates.
  const tri = assoc.slice(8, 11);
  if (tri.length === 3) {
    const host = tri[0].country;
    const ev = newEvent(w, `INT-${w.season}-TRI`, `${nationName(host)} ODI Tri-Series ${w.season}`, 'tri-series', 'ODI', tri.map((n) => n.id), host, win.from + 6, win.from + 20, 'Three associates play each other twice; the top two meet in the final.');
    ev.standings.main = tri.map((n) => emptyRow(n.id));
    const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0], [1, 0], [2, 1], [0, 2]];
    pairs.forEach(([a, b], k) => addFixture(w, ev, 'Round robin', tri[a].id, tri[b].id, win.from + 6 + k * 2, venueIn(w, host, k), tri[a].country !== host && tri[b].country !== host, 'main'));
    ev.stage = 'groups';
    for (const n of tri) callUp(w, ev, n);
  }
  updateCalendar(w);
}

function scheduleGroups(w: WorldState, ev: IntlEvent, groups: Record<string, string[]>, day: number, host: CountryCode | null) {
  const st = intl(w);
  let salt = 0;
  for (const [g, ids] of Object.entries(groups)) {
    ev.standings[g] = ids.map((id) => emptyRow(id));
    const pairs: [number, number][][] = ids.length === 4 ? [[[0, 3], [1, 2]], [[0, 2], [3, 1]], [[0, 1], [2, 3]]] : roundsFor(ids.length);
    pairs.forEach((round, r) => round.forEach(([a, b]) => {
      if (!ids[a] || !ids[b]) return;
      const neutral = !!host && st.nations[ids[a]].country !== host && st.nations[ids[b]].country !== host;
      addFixture(w, ev, `Group ${g}`, ids[a], ids[b], day + r * 2 + (g.charCodeAt(0) % 2), venueIn(w, host, salt++), neutral, g);
    }));
  }
}

function roundsFor(n: number): [number, number][][] {
  const teams = Array.from({ length: n % 2 ? n + 1 : n }, (_, i) => i);
  const rounds: [number, number][][] = [];
  const arr = [...teams];
  for (let r = 0; r < arr.length - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < arr.length / 2; i++) {
      const a = arr[i];
      const b = arr[arr.length - 1 - i];
      if (a < n && b < n) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

/**
 * Postseason window, after the Global Club Championship: the rotating world event, plus the
 * Asia Cup in seasons when the world event is a single match.
 */
export function schedulePostseasonInternationals(w: WorldState, startDay: number) {
  const st = intl(w);
  initNations(w);
  if (Object.values(st.events).some((e) => e.season === w.season && e.startDay >= startDay)) return;
  const all = Object.values(st.nations);
  const kind = INTERNATIONAL.worldRotation[(w.season - WORLD.startSeason) % INTERNATIONAL.worldRotation.length];
  const hostOrder = all.filter((n) => n.full).sort((a, b) => a.id.localeCompare(b.id));
  const host = hostOrder[(w.season - WORLD.startSeason) % hostOrder.length].country;
  if (kind === 'T20 World Cup') {
    const q = Object.values(st.events).find((e) => e.season === w.season && e.kind === 'qualifier');
    const qualified = q ? [q.championId, q.runnerUpId].filter(Boolean) as string[] : [];
    const assoc = all.filter((n) => !n.full && !qualified.includes(n.id)).sort(byRating(w, 'T20'));
    const teams = [...all.filter((n) => n.full).map((n) => n.id), ...qualified, ...assoc.map((n) => n.id)].slice(0, 16);
    const seeded = teams.map((id) => st.nations[id]).sort(byRating(w, 'T20'));
    const ev = newEvent(w, `INT-${w.season}-WC`, `T20 World Cup ${w.season}`, 'world-cup', 'T20', seeded.map((n) => n.id), host, startDay, startDay + 20, 'Sixteen nations (all full members plus the qualifier finalists and best-ranked associates), four groups of four; quarter-finals, semi-finals and a final.');
    const groups: Record<string, string[]> = { A: [], B: [], C: [], D: [] };
    const letters = ['A', 'B', 'C', 'D'];
    seeded.forEach((n, i) => {
      const pot = Math.floor(i / 4);
      const idx = pot % 2 === 0 ? i % 4 : 3 - (i % 4);
      groups[letters[idx]].push(n.id);
    });
    scheduleGroups(w, ev, groups, startDay, host);
    ev.stage = 'groups';
    for (const n of seeded) callUp(w, ev, n);
  } else if (kind === 'ODI World Cup' || kind === 'Champions Trophy') {
    const size = kind === 'ODI World Cup' ? 10 : 8;
    const seeded = [...all].sort(byRating(w, 'ODI')).slice(0, size);
    const ev = newEvent(w, `INT-${w.season}-WC`, `${kind} ${w.season}`, 'world-cup', 'ODI', seeded.map((n) => n.id), host, startDay, startDay + 22,
      `${size} best-ranked ODI nations, two groups of ${size / 2}; semi-finals and a final.`);
    const groups: Record<string, string[]> = { A: [], B: [] };
    seeded.forEach((n, i) => groups[i % 4 === 0 || i % 4 === 3 ? 'A' : 'B'].push(n.id));
    scheduleGroups(w, ev, groups, startDay, host);
    ev.stage = 'groups';
    for (const n of seeded) callUp(w, ev, n);
  } else {
    const top = all.filter((n) => n.full).sort(byRating(w, 'Test')).slice(0, 2);
    const ev = newEvent(w, `INT-${w.season}-WTC`, `World Test Championship Final ${w.season}`, 'test-final', 'Test', top.map((n) => n.id), null, startDay, startDay + 5,
      'The two top-ranked Test nations meet in a one-off final at a neutral ground. A draw shares the title.');
    addFixture(w, ev, 'Final', top[0].id, top[1].id, startDay, venueIn(w, null, 3, top.map((n) => n.country)), true);
    ev.stage = 'knockout';
    for (const n of top) callUp(w, ev, n);
    const asia = all.filter((n) => n.region === 'Asia' && !top.includes(n)).sort(byRating(w, 'T20')).slice(0, 6);
    if (asia.length >= 4) {
      const hostAsia = asia[(w.season - WORLD.startSeason) % asia.length].country;
      const cup = newEvent(w, `INT-${w.season}-ASIA`, `Asia Cup ${w.season}`, 'regional-cup', 'T20', asia.map((n) => n.id), hostAsia, startDay, startDay + 14, 'Asian nations in two groups; the top two of each group meet in the semi-finals.');
      const groups: Record<string, string[]> = { A: [], B: [] };
      asia.forEach((n, i) => groups[i % 4 === 0 || i % 4 === 3 ? 'A' : 'B'].push(n.id));
      scheduleGroups(w, cup, groups, startDay, hostAsia);
      cup.stage = 'groups';
      for (const n of asia) callUp(w, cup, n);
    }
  }
  updateCalendar(w);
}

// ------------------------------------------------------------------ playing

export function intlFixturesOnDay(w: WorldState, day: number): IntlFixture[] {
  const st = w.universe?.international;
  if (!st) return [];
  return Object.values(st.fixtures).filter((f) => f.season === w.season && f.day === day && f.status === 'scheduled' && f.homeId && f.awayId).sort((a, b) => a.id.localeCompare(b.id));
}

function nationSide(w: WorldState, n: NationState, f: MatchFormat, venueId: string) {
  const squad = squadFor(w, n, f).map((id) => w.players[id]).filter((p) => p && !p.retired);
  const fit = squad.filter((p) => !p.injury);
  const pool = fit.length >= 11 ? fit : squad;
  const pitch = stadiumById(venueId).pitch;
  const xi = pickXI(pool, { maxSquad: 30, minSquad: 11, maxOverseas: 0, maxPerOverseasCountry: 0, maxOverseasInXI: 0, maxRetentions: 0, retentionCosts: [], uncappedRetentionCost: 0 }, [n.country], pitch);
  const captainId = n.captainId && xi.some((p) => p.id === n.captainId) ? n.captainId : null;
  const quality = n.userManaged ? 0.62 : clamp(0.5 + (n.rating[f] - 900) / 1200, 0.35, 0.85);
  return buildTeamSetup({ id: n.id, name: n.name, shortName: n.country, colors: n.colors }, battingOrder(xi), defaultTactics(), quality, undefined, captainId);
}

/** Plays an international (always simulated) and applies its consequences. */
export function playInternational(w: WorldState, fx: IntlFixture): MatchState {
  const st = intl(w);
  const ev = st.events[fx.eventId];
  const home = st.nations[fx.homeId];
  const away = st.nations[fx.awayId];
  const venue = stadiumById(fx.venueId);
  const knockout = !fx.group && ev.kind !== 'bilateral';
  const rules = { ...rulesFor(fx.format), superOver: fx.format !== 'Test' && knockout };
  const setup = {
    fixtureId: fx.id, competition: ev.name, stage: fx.stage, home: nationSide(w, home, fx.format, fx.venueId), away: nationSide(w, away, fx.format, fx.venueId),
    venue, evening: fx.format === 'T20', importance: knockout ? 0.9 : 0.6, rules, userSide: null as Side | null,
  };
  const s = simulateMatch(setup, `${w.seed}|${fx.id}`);
  applyInternational(w, fx, s);
  return s;
}

function applyInternational(w: WorldState, fx: IntlFixture, s: MatchState) {
  const st = intl(w);
  const ev = st.events[fx.eventId];
  const summary = summarise(s, { homeId: fx.homeId, awayId: fx.awayId } as Fixture);
  fx.status = 'complete';
  fx.result = summary;
  if (ev.status === 'scheduled') ev.status = 'live';
  const home = st.nations[fx.homeId];
  const away = st.nations[fx.awayId];
  const drawn = !!s.result?.drawn;
  const winner = summary.winnerId;
  // Ratings (Elo-style, with home advantage unless neutral).
  const f = fx.format;
  const adv = fx.neutral ? 0 : 40;
  const ea = 1 / (1 + Math.pow(10, (away.rating[f] - home.rating[f] - adv) / 400));
  const sa = winner === home.id ? 1 : winner === away.id ? 0 : 0.5;
  const k = INTERNATIONAL.ratingK[f];
  home.rating[f] = Math.round(home.rating[f] + k * (sa - ea));
  away.rating[f] = Math.round(away.rating[f] - k * (sa - ea));
  for (const n of [home, away]) {
    const r = n.record[f];
    r.played++;
    if (drawn) r.drawn++;
    else if (!winner) r.tied++;
    else if (winner === n.id) r.won++;
    else r.lost++;
  }
  if (ev.series && winner) ev.series[winner] = (ev.series[winner] ?? 0) + 1;
  if (fx.group && ev.standings[fx.group]) intlStandings(ev, fx, s);
  // Player records: international statistics are kept apart from club cricket.
  const key = `${w.season}:INTL-${f}`;
  for (const inn of s.innings.filter((i) => !i.superOver)) {
    for (const b of Object.values(inn.batters)) {
      const p = w.players[b.playerId];
      if (!p) continue;
      const l = (p.stats.seasons[key] ??= emptyStatLine());
      l.innings++;
      l.runs += b.runs;
      l.balls += b.balls;
      l.fours += b.fours;
      l.sixes += b.sixes;
      if (!b.out) l.notOuts++;
      if (b.runs >= 100) l.hundreds++;
      else if (b.runs >= 50) l.fifties++;
      l.highScore = Math.max(l.highScore, b.runs);
      if (b.runs >= 100) addNews(w, { kind: 'milestone', importance: 2, headline: `International century for ${p.name}`, body: `${b.runs} off ${b.balls} for ${nationName(p.country)} in the ${ev.name}.`, clubIds: p.clubId ? [p.clubId] : [], playerIds: [p.id], sourceRef: `${fx.id}-${p.id}` });
    }
    for (const bw of Object.values(inn.bowlers)) {
      const p = w.players[bw.playerId];
      if (!p) continue;
      const l = (p.stats.seasons[key] ??= emptyStatLine());
      l.ballsBowled += bw.balls;
      l.runsConceded += bw.runs;
      l.wickets += bw.wickets;
      l.dots += bw.dots;
      if (bw.wickets > l.bestWkts || (bw.wickets === l.bestWkts && bw.runs < l.bestRuns)) {
        l.bestWkts = bw.wickets;
        l.bestRuns = bw.runs;
      }
    }
  }
  for (const mp of [...s.setup.home.xi, ...s.setup.away.xi]) {
    const p = w.players[mp.id];
    if (!p) continue;
    (p.stats.seasons[key] ??= emptyStatLine()).matches++;
    const faced = s.innings.reduce((a, i) => a + (i.batters[p.id]?.balls ?? 0), 0);
    const bowled = s.innings.reduce((a, i) => a + (i.bowlers[p.id]?.balls ?? 0), 0);
    const scale = f === 'Test' ? 5 : f === 'ODI' ? 2.5 : 1;
    applyMatchLoad(p, { ballsFaced: faced / scale, ballsBowled: bowled / scale, fielded: true });
    if (!p.capped) p.capped = true;
    p.reputation = clamp(p.reputation + 0.3, 0, 100);
  }
  const userNation = st.userNationId;
  if (userNation && (fx.homeId === userNation || fx.awayId === userNation)) {
    const me = st.nations[userNation];
    const opp = st.nations[fx.homeId === userNation ? fx.awayId : fx.homeId];
    addNews(w, {
      kind: 'result', importance: knockoutStage(fx) ? 3 : 2,
      headline: drawn ? `${me.name} draw with ${opp.name}` : winner === me.id ? `${me.name} beat ${opp.name}` : winner ? `${me.name} lose to ${opp.name}` : `${me.name} and ${opp.name} tie`,
      body: `${ev.name}, ${fx.stage}: ${summary.margin}. ${summary.innings.map((i) => `${st.nations[i.battingClubId]?.country ?? ''} ${i.runs}/${i.wickets}`).join(' · ')}.`,
      clubIds: [], playerIds: summary.playerOfMatch ? [summary.playerOfMatch] : [], sourceRef: fx.id,
    });
  }
}

const knockoutStage = (fx: IntlFixture) => !fx.group && /Final|Semi|Quarter/.test(fx.stage);

function intlStandings(ev: IntlEvent, fx: IntlFixture, s: MatchState) {
  const rows = ev.standings[fx.group!];
  const home = rows.find((r) => r.clubId === fx.homeId);
  const away = rows.find((r) => r.clubId === fx.awayId);
  if (!home || !away) return;
  const quota = (s.setup.rules.overs ?? 20) * 6;
  for (const inn of s.innings.filter((i) => !i.superOver)) {
    const bat = inn.battingSide === 'home' ? home : away;
    const bowl = bat === home ? away : home;
    const balls = inn.wickets >= 10 ? quota : inn.legalBalls;
    bat.runsFor += inn.runs;
    bat.oversFor += balls;
    bowl.runsAgainst += inn.runs;
    bowl.oversAgainst += balls;
  }
  home.played++;
  away.played++;
  const winner = s.result?.winner;
  if (!winner) {
    home.tied++;
    away.tied++;
    home.points += 1;
    away.points += 1;
    home.form.push('T');
    away.form.push('T');
  } else {
    const [wn, ls] = winner === 'home' ? [home, away] : [away, home];
    wn.won++;
    ls.lost++;
    wn.points += 2;
    wn.form.push('W');
    ls.form.push('L');
  }
  ev.standings[fx.group!] = sortRows(rows);
}

/** Advances tournaments between rounds and closes finished events. Returns true if anything changed. */
export function progressInternational(w: WorldState): boolean {
  const st = w.universe?.international;
  if (!st) return false;
  let changed = false;
  for (const ev of Object.values(st.events)) {
    if (ev.season !== w.season || ev.status === 'complete') continue;
    const fxs = Object.values(st.fixtures).filter((f) => f.eventId === ev.id);
    if (!fxs.length || fxs.some((f) => f.status !== 'complete')) continue;
    changed = true;
    const last = Math.max(...fxs.map((f) => f.day + f.days - 1));
    const winnerOf = (f: IntlFixture) => f.result!.winnerId ?? f.homeId;
    const venue = (salt: number) => venueIn(w, ev.hostCountry, salt + 7);
    if (ev.kind === 'bilateral') {
      const [a, b] = ev.nationIds;
      const sa = ev.series?.[a] ?? 0;
      const sb = ev.series?.[b] ?? 0;
      ev.championId = sa === sb ? null : sa > sb ? a : b;
      ev.runnerUpId = ev.championId ? (ev.championId === a ? b : a) : null;
      closeEvent(w, ev, sa === sb ? `Series drawn ${sa}–${sb}` : `${st.nations[ev.championId!].name} win ${Math.max(sa, sb)}–${Math.min(sa, sb)}`);
      continue;
    }
    if (ev.kind === 'test-final') {
      const f = fxs[0];
      ev.championId = f.result!.winnerId;
      ev.runnerUpId = ev.championId ? (ev.championId === f.homeId ? f.awayId : f.homeId) : null;
      closeEvent(w, ev, ev.championId ? `${st.nations[ev.championId].name} are world Test champions` : 'The final is drawn; the title is shared');
      continue;
    }
    if (ev.kind === 'tri-series' && ev.stage === 'groups') {
      const t = sortRows(ev.standings.main);
      ev.stage = 'knockout';
      addFixture(w, ev, 'Final', t[0].clubId, t[1].clubId, last + 2, venue(0), st.nations[t[0].clubId].country !== ev.hostCountry && st.nations[t[1].clubId].country !== ev.hostCountry);
      release(w, ev, t.slice(2).map((r) => r.clubId), last);
      continue;
    }
    if (ev.stage === 'groups') {
      const letters = Object.keys(ev.standings).sort();
      const first = letters.map((g) => sortRows(ev.standings[g])[0].clubId);
      const second = letters.map((g) => sortRows(ev.standings[g])[1].clubId);
      const out = letters.flatMap((g) => sortRows(ev.standings[g]).slice(2).map((r) => r.clubId));
      ev.stage = 'knockout';
      const round = letters.length >= 4 ? 'Quarter-final' : 'Semi-final';
      const pairs: [string, string][] = [];
      for (let i = 0; i < letters.length; i += 2) {
        pairs.push([first[i], second[i + 1] ?? second[i]]);
        if (letters.length > 1) pairs.push([first[i + 1], second[i]]);
      }
      pairs.forEach(([a, b], i) => addFixture(w, ev, round, a, b, last + 2 + (i % 2), venue(i), true));
      release(w, ev, out, last);
      continue;
    }
    // Knockout rounds
    const latestStage = ['Final', 'Semi-final', 'Quarter-final'].find((sname) => fxs.some((f) => f.stage === sname))!;
    const roundFx = fxs.filter((f) => f.stage === latestStage).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    if (latestStage === 'Final') {
      const f = roundFx[0];
      ev.championId = winnerOf(f);
      ev.runnerUpId = ev.championId === f.homeId ? f.awayId : f.homeId;
      closeEvent(w, ev, `${st.nations[ev.championId].name} win the ${ev.name}`);
      continue;
    }
    const winners = roundFx.map(winnerOf);
    const losers = roundFx.map((f) => (winnerOf(f) === f.homeId ? f.awayId : f.homeId));
    const next = latestStage === 'Quarter-final' ? 'Semi-final' : 'Final';
    for (let i = 0; i < winners.length; i += 2) addFixture(w, ev, next, winners[i], winners[i + 1], last + 2 + ((i / 2) % 2), venue(i + 3), true);
    release(w, ev, losers, last);
  }
  return changed;
}

/** Eliminated nations' players return to their clubs. */
function release(w: WorldState, ev: IntlEvent, nationIds: string[], day: number) {
  for (const c of intl(w).callUps) if (c.eventId === ev.id && nationIds.includes(c.nationId)) c.toDay = Math.min(c.toDay, day + INTERNATIONAL.releaseDays);
}

function closeEvent(w: WorldState, ev: IntlEvent, headline: string) {
  const st = intl(w);
  ev.status = 'complete';
  ev.stage = 'complete';
  const last = Math.max(...Object.values(st.fixtures).filter((f) => f.eventId === ev.id).map((f) => f.day + f.days - 1));
  ev.endDay = last;
  for (const c of st.callUps) if (c.eventId === ev.id) c.toDay = Math.min(c.toDay, last + INTERNATIONAL.releaseDays);
  st.history.push({ season: w.season, eventId: ev.id, name: ev.name, format: ev.format, championId: ev.championId, runnerUpId: ev.runnerUpId });
  const big = ev.kind === 'world-cup' || ev.kind === 'test-final';
  addNews(w, { kind: 'result', importance: big ? 3 : 1, headline, body: `${ev.name}: ${ev.description}`, clubIds: [], playerIds: [], sourceRef: ev.id });
  if (st.userNationId && ev.championId === st.userNationId) {
    addTimeline(w, 'title', `${ev.name} won`, `As ${st.nations[st.userNationId].name} manager.`, [ev.id]);
  }
}

export function internationalWindowOpen(w: WorldState): boolean {
  const st = w.universe?.international;
  if (!st) return false;
  return Object.values(st.events).some((e) => e.season === w.season && e.status !== 'complete');
}

export function postseasonComplete(w: WorldState, fromDay: number): boolean {
  const st = w.universe?.international;
  if (!st) return true;
  return Object.values(st.events).filter((e) => e.season === w.season && e.startDay >= fromDay).every((e) => e.status === 'complete');
}

// ------------------------------------------------------------------ rankings & appointments

export function rankings(w: WorldState, f: MatchFormat): NationState[] {
  const st = w.universe?.international;
  if (!st) return [];
  return Object.values(st.nations).filter((n) => f !== 'Test' || n.full).sort((a, b) => b.rating[f] - a.rating[f] || a.id.localeCompare(b.id));
}

export function snapshotRankings(w: WorldState) {
  const st = w.universe?.international;
  if (!st) return;
  for (const f of ['T20', 'ODI', 'Test'] as MatchFormat[]) st.rankingsHistory.push({ season: w.season, format: f, order: rankings(w, f).map((n) => n.id) });
  st.rankingsHistory = st.rankingsHistory.slice(-30);
  st.callUps = st.callUps.filter((c) => st.events[c.eventId]?.season === w.season);
  for (const id of Object.keys(st.fixtures)) if (st.fixtures[id].season < w.season - 1) delete st.fixtures[id];
}

/** National-team job offers: the user's own nation when the club is prominent, plus an associate. */
export function refreshOffers(w: WorldState) {
  const st = intl(w);
  initNations(w);
  if (st.userNationId) {
    st.offers = [];
    return;
  }
  const user = w.clubs[w.userClubId];
  const offers: string[] = [];
  const own = st.nations[nationId(user.country)];
  if (own && (!own.full || user.brand >= 60 || (user.board.confidence >= 70 && w.season > WORLD.startSeason))) offers.push(own.id);
  const assoc = Object.values(st.nations).filter((n) => !n.full && !offers.includes(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (assoc.length) offers.push(assoc[(w.season * 7 + user.id.charCodeAt(0)) % assoc.length].id);
  st.offers = offers.map((id) => ({ nationId: id, season: w.season, expiresDay: PRESEASON.lastDay }));
}

export function acceptNationalJob(w: WorldState, id: string): string | null {
  const st = intl(w);
  if (st.userNationId) return `You already manage ${st.nations[st.userNationId].name}.`;
  const offer = st.offers.find((o) => o.nationId === id);
  if (!offer) return 'There is no offer from that nation.';
  const n = st.nations[id];
  n.userManaged = true;
  n.managerName = w.managerName;
  st.userNationId = id;
  st.offers = [];
  for (const fx of Object.values(st.fixtures)) fx.involvesUser = fx.homeId === id || fx.awayId === id;
  addTimeline(w, 'achievement', `Appointed ${n.name} manager`, 'A national role alongside club duties: pick the squads; matches are simulated with your selections.', [id]);
  addNews(w, { kind: 'board', importance: 3, headline: `${w.managerName} named ${n.name} manager`, body: `${w.managerName} will combine the role with club duties.`, clubIds: [w.userClubId], playerIds: [], sourceRef: `nat-${id}-${w.season}` });
  return null;
}

export function resignNationalJob(w: WorldState): string | null {
  const st = intl(w);
  if (!st.userNationId) return 'You do not manage a national team.';
  const n = st.nations[st.userNationId];
  n.userManaged = false;
  n.managerName = `${String.fromCharCode(65 + (w.season % 26))}. ${MANAGER_SURNAMES[w.season % MANAGER_SURNAMES.length]}`;
  for (const fx of Object.values(st.fixtures)) fx.involvesUser = false;
  st.userNationId = null;
  addNews(w, { kind: 'board', importance: 2, headline: `${w.managerName} steps down as ${n.name} manager`, body: `${n.managerName} takes over.`, clubIds: [], playerIds: [], sourceRef: `nat-res-${n.id}-${w.season}-${w.day}` });
  return null;
}

/** The user's squad for a format. Applies to events not yet started (call-ups are updated). */
export function setNationalSquad(w: WorldState, f: MatchFormat, ids: string[], captainId: string | null): string | null {
  const st = intl(w);
  if (!st.userNationId) return 'You do not manage a national team.';
  const n = st.nations[st.userNationId];
  const err = validateSquad(w, n, f, ids);
  if (err) return err;
  if (captainId && !ids.includes(captainId)) return 'The captain must be in the squad.';
  n.squads[f] = [...ids];
  if (captainId) n.captainId = captainId;
  for (const ev of Object.values(st.events)) {
    if (ev.season !== w.season || ev.format !== f || ev.startDay <= w.day || !ev.nationIds.includes(n.id)) continue;
    st.callUps = st.callUps.filter((c) => !(c.eventId === ev.id && c.nationId === n.id));
    for (const pid of ids) st.callUps.push({ playerId: pid, nationId: n.id, eventId: ev.id, fromDay: ev.startDay - INTERNATIONAL.releaseDays, toDay: ev.endDay + INTERNATIONAL.releaseDays });
  }
  return null;
}

function updateCalendar(w: WorldState) {
  if (!w.universe) return;
  const evs = Object.values(intl(w).events).filter((e) => e.season === w.season);
  w.universe.calendar = w.universe.calendar.filter((c) => c.kind !== 'international');
  for (const e of evs) w.universe.calendar.push({ label: e.name, from: e.startDay, to: e.endDay, kind: 'international' });
}
