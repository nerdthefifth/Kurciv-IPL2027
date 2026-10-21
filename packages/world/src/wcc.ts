import type { Competition, Fixture, LeagueConfig, WorldState } from '@kurciv/domain';
import { LEAGUES, VENUES, WORLD, leagueById } from '@kurciv/config';
import { pickXI } from '@kurciv/ai';
import { overall } from '@kurciv/domain';
import { emptyRow, finishingOrder, sortRows } from './competition';
import { recordTransaction } from './finance';
import { addNews, clamp, clubsInLeague, squadOf } from './util';
import { addTimeline } from './story';

// ------------------------------------------------------------------ allocation (pure)

export interface AllocationInput {
  id: string;
  reputation: number;
  clubs: number;
  history: number; // 0..1 recent international performance
}

export interface AllocationConfig {
  maxTeams: number;
  regionalReserve: number;
  minSlotsPerLeague: number;
  maxSlotsPerLeague: number;
  maxShareOfClubs: number;
  weights: { reputation: number; history: number; depth: number };
  reputationExponent: number;
}

/**
 * Allocates qualification places. Guarantees: total ≤ maxTeams − regionalReserve, no league
 * above its cap (absolute and share-of-clubs), every league gets the minimum if it has clubs,
 * deterministic largest-remainder rounding with reputation then id as tie-breaks, and places a
 * league cannot use are redistributed rather than lost.
 */
export function allocateSlots(leagues: AllocationInput[], cfg: AllocationConfig): Record<string, number> {
  const cap = (l: AllocationInput) => Math.min(cfg.maxSlotsPerLeague, Math.floor(l.clubs * cfg.maxShareOfClubs));
  const eligible = leagues.filter((l) => cap(l) > 0);
  const out: Record<string, number> = Object.fromEntries(leagues.map((l) => [l.id, 0]));
  const budget = Math.min(cfg.maxTeams - cfg.regionalReserve, eligible.reduce((s, l) => s + cap(l), 0));
  let used = 0;
  for (const l of eligible) {
    const m = Math.min(cfg.minSlotsPerLeague, cap(l));
    if (used + m > budget) break;
    out[l.id] = m;
    used += m;
  }
  const score = (l: AllocationInput) =>
    cfg.weights.reputation * Math.pow(l.reputation / 100, cfg.reputationExponent) + cfg.weights.history * l.history + cfg.weights.depth * Math.min(1, l.clubs / 10);
  let remaining = budget - used;
  let guard = 0;
  while (remaining > 0 && guard++ < 50) {
    const open = eligible.filter((l) => out[l.id] < cap(l));
    if (!open.length) break;
    const total = open.reduce((s, l) => s + score(l), 0);
    const ideal = open.map((l) => ({ l, v: (remaining * score(l)) / total }));
    let given = 0;
    for (const x of ideal) {
      const add = Math.min(Math.floor(x.v), cap(x.l) - out[x.l.id]);
      out[x.l.id] += add;
      given += add;
    }
    remaining -= given;
    if (remaining <= 0) break;
    // Largest remainders, then reputation, then id — fully deterministic.
    const order = ideal
      .filter((x) => out[x.l.id] < cap(x.l))
      .sort((a, b) => (b.v % 1) - (a.v % 1) || b.l.reputation - a.l.reputation || a.l.id.localeCompare(b.l.id));
    for (const x of order) {
      if (remaining <= 0) break;
      out[x.l.id] += 1;
      remaining -= 1;
    }
  }
  return out;
}

export function historyScore(w: WorldState, leagueId: string): number {
  const deltas = w.leagues[leagueId].reputationHistory.filter((h) => h.reason.startsWith('WCC')).slice(-3).map((h) => h.delta);
  if (!deltas.length) return 0.5;
  return clamp(0.5 + deltas.reduce((a, b) => a + b, 0) / deltas.length / 8, 0, 1);
}

export function allocateForWorld(w: WorldState): Record<string, number> {
  const input = LEAGUES.map((l) => ({ id: l.id, reputation: w.leagues[l.id].reputation, clubs: clubsInLeague(w, l.id).length, history: historyScore(w, l.id) }));
  const slots = allocateSlots(input, WORLD.wcc);
  for (const [id, n] of Object.entries(slots)) w.leagues[id].wccSlots = n;
  return slots;
}

// ------------------------------------------------------------------ format generation

export interface WccPlan {
  qualifiers: number;
  groupSize: number;
  groups: number;
  prelimTeams: number;
  knockout: string[];
  description: string;
}

export function planFormat(n: number): WccPlan {
  const G = n >= 32 ? 32 : n >= 16 ? 16 : n >= 8 ? 8 : 4;
  const prelimTeams = 2 * (n - G);
  const groups = G / 4;
  const koTeams = groups * 2;
  const knockout: string[] = [];
  let t = koTeams;
  while (t >= 2) {
    knockout.push(t === 2 ? 'Final' : t === 4 ? 'Semi-final' : t === 8 ? 'Quarter-final' : `Round of ${t}`);
    t /= 2;
  }
  const description = `${n} qualifiers${prelimTeams ? `: the ${prelimTeams} lowest seeds play a preliminary knockout for ${prelimTeams / 2} places` : ''}; ${groups} groups of 4 (single round-robin), top two advance to the ${knockout[0]}${knockout.length > 1 ? `, then ${knockout.slice(1).join(', ')}` : ''}.`;
  return { qualifiers: n, groupSize: 4, groups, prelimTeams, knockout, description };
}

// ------------------------------------------------------------------ edition lifecycle

function hostCountry(w: WorldState): LeagueConfig {
  const order = [...LEAGUES].sort((a, b) => a.id.localeCompare(b.id));
  return order[(w.season - WORLD.startSeason) % order.length];
}

function venueFor(w: WorldState, i: number): string {
  const host = hostCountry(w);
  const vs = VENUES.filter((v) => v.country === host.country);
  return vs[i % vs.length].id;
}

export function qualificationPath(w: WorldState): { leagueId: string; slots: number; clubIds: string[] }[] {
  return LEAGUES.map((l) => {
    const comp = w.competitions[`${l.id}-${w.season}`];
    const slots = w.leagues[l.id].wccSlots;
    const ids = comp && comp.stage === 'complete' ? finishingOrder(w, comp.id).slice(0, slots) : [];
    return { leagueId: l.id, slots, clubIds: ids };
  });
}

export function createWCC(w: WorldState, startDay: number): Competition {
  const path = qualificationPath(w);
  const qualifiers = path.flatMap((p) => p.clubIds.map((c) => ({ clubId: c, leagueId: p.leagueId })));
  const seeded = [...qualifiers].sort((a, b) => w.clubs[b.clubId].elo - w.clubs[a.clubId].elo || a.clubId.localeCompare(b.clubId));
  const plan = planFormat(seeded.length);
  const id = `WCC-${w.season}`;
  const comp: Competition = {
    id, kind: 'wcc', leagueId: null, season: w.season, name: `Kurciv World Club Championship ${w.season}`, clubIds: seeded.map((q) => q.clubId),
    standings: {}, stage: 'league', championId: null, runnerUpId: null,
    meta: {
      plan, host: hostCountry(w).country, startDay, round: plan.prelimTeams ? 'prelim' : 'groups',
      qualifiers: seeded.map((q, i) => ({ ...q, seed: i + 1 })),
      eloAtStart: Object.fromEntries(seeded.map((q) => [q.clubId, w.clubs[q.clubId].elo])),
      direct: seeded.slice(0, seeded.length - plan.prelimTeams).map((q) => q.clubId),
    },
  };
  w.competitions[id] = comp;
  if (plan.prelimTeams) {
    const low = seeded.slice(seeded.length - plan.prelimTeams).map((q) => q.clubId);
    for (let i = 0; i < low.length / 2; i++) addFx(w, comp, `Preliminary`, low[i], low[low.length - 1 - i], startDay + (i % 2), null, i);
  } else createGroups(w, comp, (comp.meta!.direct as string[]), startDay);
  for (const q of qualifiers) {
    if (w.clubs[q.clubId].isUser) {
      addTimeline(w, 'qualification', 'Qualified for the World Club Championship', plan.description, [id]);
      addNews(w, { kind: 'qualification', importance: 3, headline: `${w.clubs[q.clubId].name} qualify for the World Club Championship`, body: plan.description, clubIds: [q.clubId], playerIds: [], sourceRef: id });
    }
  }
  addNews(w, { kind: 'qualification', importance: 2, headline: `${seeded.length} clubs set for the ${w.season} World Club Championship`, body: `${plan.description} Host nation: ${hostCountry(w).country}.`, clubIds: [], playerIds: [], sourceRef: id });
  return comp;
}

function addFx(w: WorldState, comp: Competition, stage: string, home: string, away: string, day: number, group: string | null, i: number) {
  const n = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).length + 1;
  const fx: Fixture = {
    id: `${comp.id}-M${n}`, competitionId: comp.id, season: w.season, day, stage, group: group ?? undefined, homeId: home, awayId: away,
    venueId: venueFor(w, n + i), status: 'scheduled', result: null, involvesUser: home === w.userClubId || away === w.userClubId,
  };
  w.fixtures[fx.id] = fx;
}

function createGroups(w: WorldState, comp: Competition, teams: string[], day: number) {
  const plan = comp.meta!.plan as WccPlan;
  const seeded = [...teams].sort((a, b) => w.clubs[b].elo - w.clubs[a].elo || a.localeCompare(b));
  const groups: Record<string, string[]> = {};
  const letters = 'ABCDEFGH'.slice(0, plan.groups).split('');
  seeded.forEach((id, i) => {
    const pot = Math.floor(i / plan.groups);
    const idx = pot % 2 === 0 ? i % plan.groups : plan.groups - 1 - (i % plan.groups);
    (groups[letters[idx]] ??= []).push(id);
  });
  comp.meta!.groups = groups;
  comp.meta!.round = 'groups';
  for (const g of letters) {
    const ids = groups[g];
    comp.standings[g] = ids.map(emptyRow);
    const pairs: [number, number][][] = [[[0, 3], [1, 2]], [[0, 2], [3, 1]], [[0, 1], [2, 3]]];
    pairs.forEach((round, r) => round.forEach(([a, b], k) => ids[a] && ids[b] && addFx(w, comp, `Group ${g}`, ids[a], ids[b], day + r * 2 + (k % 2), g, k)));
  }
}

/** Moves the championship forward when the current round is finished. */
export function progressWCC(w: WorldState): boolean {
  const comp = w.competitions[`WCC-${w.season}`];
  if (!comp || comp.stage === 'complete') return false;
  const fxs = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id);
  if (fxs.some((f) => f.status !== 'complete')) return false;
  const meta = comp.meta!;
  const lastDay = Math.max(...fxs.map((f) => f.day));
  const plan = meta.plan as WccPlan;
  const winnerOf = (f: Fixture) => f.result!.winnerId ?? f.homeId;
  if (meta.round === 'prelim') {
    const winners = fxs.filter((f) => f.stage === 'Preliminary').map(winnerOf);
    createGroups(w, comp, [...(meta.direct as string[]), ...winners], lastDay + 2);
    return true;
  }
  if (meta.round === 'groups') {
    const groups = meta.groups as Record<string, string[]>;
    const letters = Object.keys(groups).sort();
    const first = letters.map((g) => sortRows(comp.standings[g])[0].clubId);
    const second = letters.map((g) => sortRows(comp.standings[g])[1].clubId);
    const pairs: [string, string][] = [];
    for (let i = 0; i < letters.length; i += 2) {
      pairs.push([first[i], second[i + 1] ?? second[i]]);
      if (letters.length > 1) pairs.push([first[i + 1], second[i]]);
    }
    meta.round = plan.knockout[0];
    comp.stage = 'playoffs';
    pairs.forEach(([a, b], i) => addFx(w, comp, plan.knockout[0], a, b, lastDay + 2 + (i % 2), null, i));
    return true;
  }
  // knockout rounds
  const roundIdx = plan.knockout.indexOf(meta.round as string);
  const roundFx = fxs.filter((f) => f.stage === meta.round).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (meta.round === 'Final') {
    const f = roundFx[0];
    comp.championId = winnerOf(f);
    comp.runnerUpId = comp.championId === f.homeId ? f.awayId : f.homeId;
    comp.stage = 'complete';
    finishWCC(w, comp);
    return true;
  }
  const winners = roundFx.map(winnerOf);
  const next = plan.knockout[roundIdx + 1];
  meta.round = next;
  for (let i = 0; i < winners.length; i += 2) addFx(w, comp, next, winners[i], winners[i + 1], lastDay + 2 + ((i / 2) % 2), null, i);
  return true;
}

function finishWCC(w: WorldState, comp: Competition) {
  const prize = WORLD.wcc.prize;
  const champ = w.clubs[comp.championId!];
  recordTransaction(w, champ.id, 'prize', prize.champion, 'World Club Championship winners');
  recordTransaction(w, comp.runnerUpId!, 'prize', prize.runnerUp, 'World Club Championship runners-up');
  champ.trophies.push({ season: w.season, competitionId: comp.id, name: 'World Club Championship' });
  champ.brand = Math.min(100, champ.brand + 4);
  addNews(w, {
    kind: 'result', importance: 3, headline: `${champ.name} are world club champions`,
    body: `${champ.name} (${leagueById(champ.leagueId).shortName}) beat ${w.clubs[comp.runnerUpId!].name} in the final.`,
    clubIds: [champ.id, comp.runnerUpId!], playerIds: [], sourceRef: comp.id,
  });
  w.hallOfFame.push({ id: `hof-${comp.id}`, season: w.season, kind: 'dynasty', title: `${w.season} World Club Champions`, detail: champ.name, refs: [comp.id] });
}

// ------------------------------------------------------------------ reputation

const STAGE_KEY = (stage: string) => (stage === 'Preliminary' ? 'prelim' : stage.startsWith('Group') ? 'group' : stage === 'Final' ? 'final' : 'knockout');

/**
 * Exponentially weighted league reputation update from WCC results: for every match the
 * residual (actual − Elo-expected) is weighted by stage; the league's mean residual moves its
 * reputation by a learning rate, with mean reversion toward structural strength and a cap.
 */
export function updateReputations(w: WorldState): Record<string, { delta: number; reason: string }> {
  const cfg = WORLD.reputation;
  const comp = w.competitions[`WCC-${w.season}`];
  const elo0 = (comp?.meta?.eloAtStart ?? {}) as Record<string, number>;
  const residual: Record<string, { sum: number; weight: number; n: number }> = {};
  if (comp) {
    for (const f of Object.values(w.fixtures).filter((x) => x.competitionId === comp.id && x.result)) {
      const wgt = cfg.stageWeights[STAGE_KEY(f.stage)] ?? 1;
      const ea = 1 / (1 + Math.pow(10, ((elo0[f.awayId] ?? 1500) - (elo0[f.homeId] ?? 1500)) / 400));
      const sa = f.result!.winnerId === null ? 0.5 : f.result!.winnerId === f.homeId ? 1 : 0;
      for (const [club, s, e] of [[f.homeId, sa, ea], [f.awayId, 1 - sa, 1 - ea]] as [string, number, number][]) {
        const lid = w.clubs[club].leagueId;
        const r = (residual[lid] ??= { sum: 0, weight: 0, n: 0 });
        r.sum += wgt * (s - e);
        r.weight += wgt;
        r.n++;
      }
    }
  }
  // Squad-quality signal: average best-XI rating versus the global mean.
  const quality: Record<string, number> = {};
  for (const l of LEAGUES) {
    const xs = clubsInLeague(w, l.id).map((c) => {
      const sq = squadOf(w, c);
      return sq.length >= 11 ? pickXI(sq, l.squadRules, l.domesticCountries).reduce((a, p) => a + overall(p), 0) / 11 : 50;
    });
    quality[l.id] = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  }
  const globalQ = Object.values(quality).reduce((a, b) => a + b, 0) / Object.values(quality).length;
  const out: Record<string, { delta: number; reason: string }> = {};
  for (const l of LEAGUES) {
    const st = w.leagues[l.id];
    const r = residual[l.id];
    const perf = r ? (r.sum / Math.max(1, r.weight)) * Math.sqrt(r.n) : 0;
    // Structural strength anchors each league to its founding level, commercial scale and current talent.
    const structural = 0.5 * l.initialReputation + 0.25 * l.commercialValue + 0.25 * clamp(l.initialReputation + (quality[l.id] - globalQ) * 3, 0, 100);
    let delta = cfg.learningRate * perf + cfg.reversion * (structural - st.reputation) + cfg.squadQualityWeight * (quality[l.id] - globalQ) * 0.2;
    delta = clamp(delta, -cfg.maxDelta, cfg.maxDelta);
    const prev = st.reputation;
    st.reputation = Math.round(clamp(prev + delta, cfg.min, cfg.max) * 10) / 10;
    const d = Math.round((st.reputation - prev) * 10) / 10;
    const reason = r ? `WCC ${w.season}: ${r.n} matches, weighted residual ${(r.sum / Math.max(1, r.weight)).toFixed(2)}` : `No WCC representation in ${w.season}; drift toward structural strength`;
    st.reputationHistory.push({ season: w.season, reputation: st.reputation, delta: d, reason });
    out[l.id] = { delta: d, reason };
    if (Math.abs(d) >= 2) {
      addNews(w, {
        kind: 'reputation', importance: 2,
        headline: `${l.name} reputation ${d > 0 ? 'rises' : 'falls'} to ${st.reputation.toFixed(1)}`,
        body: `${reason}. Reputation shapes future qualification places, sponsorship and the league's pull on overseas stars.`,
        clubIds: [], playerIds: [], sourceRef: `rep-${l.id}-${w.season}`,
      });
    }
  }
  return out;
}
