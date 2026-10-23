import type { Club, PyramidMovement, UniverseState, WorldState } from '@kurciv/domain';
import { CLUB_SEEDS, DIVISIONS, FICTIONAL_CLUB_SEEDS, LEAGUES, PYRAMID, leagueById } from '@kurciv/config';
import { finishingOrder, sortRows } from '../competition';
import { recordTransaction } from '../finance';
import { addTimeline } from '../story';
import { addNews, clamp, clubsInLeague, round2 } from '../util';

/**
 * The global pyramid: five divisions of eighteen clubs mixing every cricket region. Clubs keep
 * their squads, finances, history and staff when they move; only the division changes.
 */

export function emptyUniverse(): UniverseState {
  return {
    config: { divisions: PYRAMID.divisions, clubsPerDivision: PYRAMID.clubsPerDivision, promote: PYRAMID.promote, relegate: PYRAMID.relegate },
    pyramidHistory: [],
    continental: [],
    coefficients: {},
    friendlies: [],
    international: { nations: {}, events: {}, fixtures: {}, callUps: [], userNationId: null, offers: [], history: [], rankingsHistory: [] },
    calendar: [],
  };
}

/** Strength used to seed the first season: the club's home league standing and its own profile. */
function seedScore(c: Club, originRep: number): number {
  return originRep * 0.62 + c.brand * 0.38;
}

/**
 * Places clubs into divisions by seed score (deterministic: ties broken by id). A custom club
 * always starts in the bottom division.
 */
export function seedDivisions(w: WorldState, origin: Record<string, string | null>) {
  const repOf = (c: Club) => {
    const o = origin[c.id];
    return o ? LEAGUES.find((l) => l.id === o)?.initialReputation ?? 45 : 42;
  };
  const custom = Object.values(w.clubs).filter((c) => c.isCustom);
  const ranked = Object.values(w.clubs).filter((c) => !c.isCustom).sort((a, b) => seedScore(b, repOf(b)) - seedScore(a, repOf(a)) || a.id.localeCompare(b.id));
  const per = PYRAMID.clubsPerDivision;
  ranked.forEach((c, i) => assignDivision(w, c, DIVISIONS[Math.min(DIVISIONS.length - 1, Math.floor(i / per))].id));
  for (const c of custom) assignDivision(w, c, DIVISIONS[DIVISIONS.length - 1].id);
}

function assignDivision(w: WorldState, c: Club, divisionId: string) {
  const l = leagueById(divisionId);
  c.leagueId = divisionId;
  c.purse = l.auctionRules.purse;
  c.elo = 1500 + (l.initialReputation - 70) * 6;
}

/** The starting division of every seed club in a new pyramid career (same rule as seedDivisions). */
export function seedPreview(): Record<string, string> {
  const rows: { id: string; score: number }[] = [];
  for (const l of LEAGUES) for (const c of CLUB_SEEDS[l.id] ?? []) rows.push({ id: c.id, score: l.initialReputation * 0.62 + c.brand * 0.38 });
  for (const c of FICTIONAL_CLUB_SEEDS) rows.push({ id: c.id, score: 42 * 0.62 + c.brand * 0.38 });
  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return Object.fromEntries(rows.map((r, i) => [r.id, DIVISIONS[Math.min(DIVISIONS.length - 1, Math.floor(i / PYRAMID.clubsPerDivision))].id]));
}

export function divisionTier(leagueId: string): number {
  return leagueById(leagueId).tier ?? 0;
}

/** Records who is in each division as a season starts (the pyramid history view uses it). */
export function snapshotMembership(w: WorldState) {
  if (!w.universe) return;
  const membership = Object.fromEntries(DIVISIONS.map((d) => [d.id, clubsInLeague(w, d.id).map((c) => c.id)]));
  const existing = w.universe.pyramidHistory.find((h) => h.season === w.season);
  if (existing) existing.membership = membership;
  else w.universe.pyramidHistory.push({ season: w.season, champions: {}, movements: [], membership });
}

/**
 * End-of-season promotion and relegation. Promotion goes to the champion, the runner-up and then
 * the best-placed remaining clubs by table; relegation to the bottom clubs by table. Ties in the
 * table are already broken deterministically (points, net run rate, wins, club id).
 */
export function promoteAndRelegate(w: WorldState): PyramidMovement[] {
  if (!w.universe) return [];
  const { promote, relegate } = w.universe.config;
  const moves: PyramidMovement[] = [];
  for (let i = 0; i < DIVISIONS.length - 1; i++) {
    const upper = DIVISIONS[i];
    const lower = DIVISIONS[i + 1];
    const up = w.competitions[`${upper.id}-${w.season}`];
    const lo = w.competitions[`${lower.id}-${w.season}`];
    if (!up || !lo) continue;
    const upTable = sortRows(up.standings.main).map((r) => r.clubId);
    const down = upTable.slice(-relegate);
    const loOrder = finishingOrder(w, lo.id);
    const ups = loOrder.slice(0, promote);
    down.forEach((id) => moves.push({ clubId: id, from: upper.id, to: lower.id, kind: 'relegated', position: upTable.indexOf(id) + 1, reason: `Finished ${upTable.indexOf(id) + 1}th of ${upTable.length} in the ${upper.shortName}` }));
    ups.forEach((id, k) => {
      const pos = sortRows(lo.standings.main).findIndex((r) => r.clubId === id) + 1;
      const why = id === lo.championId ? `${lower.shortName} champions` : id === lo.runnerUpId ? `${lower.shortName} runners-up` : `Best remaining table position (${pos})`;
      moves.push({ clubId: id, from: lower.id, to: upper.id, kind: 'promoted', position: k + 1, reason: why });
    });
  }
  const hist = w.universe.pyramidHistory.find((h) => h.season === w.season);
  const champions = Object.fromEntries(DIVISIONS.map((d) => [d.id, w.competitions[`${d.id}-${w.season}`]?.championId ?? ''] as [string, string]).filter(([, c]) => c));
  if (hist) {
    hist.movements = moves;
    hist.champions = champions;
  } else w.universe.pyramidHistory.push({ season: w.season, champions, movements: moves, membership: {} });

  for (const m of moves) {
    const c = w.clubs[m.clubId];
    const from = leagueById(m.from);
    const to = leagueById(m.to);
    c.leagueId = m.to;
    if (m.kind === 'relegated') {
      // Parachute payment cushions the fall in broadcast income.
      const parachute = round2(Math.max(0, from.auctionRules.purse - to.auctionRules.purse) * PYRAMID.parachuteShare);
      if (parachute > 0) recordTransaction(w, c.id, 'prize', parachute, `Parachute payment (${from.shortName} → ${to.shortName})`);
      c.board.confidence = clamp(c.board.confidence - 14, 0, 100);
      c.brand = clamp(c.brand - 2, 0, 100);
    } else {
      const bonus = round2(to.auctionRules.purse * PYRAMID.promotionBonusShare);
      recordTransaction(w, c.id, 'prize', bonus, `Promotion bonus (${to.shortName})`);
      c.board.confidence = clamp(c.board.confidence + 12, 0, 100);
      c.brand = clamp(c.brand + 2, 0, 100);
      c.fanBase = clamp(c.fanBase + 2, 0, 100);
    }
    if (c.isUser) {
      addTimeline(w, 'season', m.kind === 'promoted' ? `Promoted to the ${to.name}` : `Relegated to the ${to.name}`, m.reason, [c.id]);
    }
  }
  const promotedNames = moves.filter((m) => m.kind === 'promoted').map((m) => w.clubs[m.clubId].shortName);
  const relegatedNames = moves.filter((m) => m.kind === 'relegated').map((m) => w.clubs[m.clubId].shortName);
  addNews(w, {
    kind: 'qualification', importance: 2, headline: `Pyramid ${w.season}: ${promotedNames.length} up, ${relegatedNames.length} down`,
    body: `Promoted: ${promotedNames.join(', ')}. Relegated: ${relegatedNames.join(', ')}.`, clubIds: moves.map((m) => m.clubId), playerIds: [], sourceRef: `pyramid-${w.season}`,
  });
  const u = moves.find((m) => m.clubId === w.userClubId);
  if (u) {
    addNews(w, {
      kind: 'board', importance: 3,
      headline: u.kind === 'promoted' ? `${w.clubs[u.clubId].name} promoted to the ${leagueById(u.to).name}` : `${w.clubs[u.clubId].name} relegated to the ${leagueById(u.to).name}`,
      body: `${u.reason}. Next season's purse: ₹${leagueById(u.to).auctionRules.purse} Cr. Squad, staff and history move with the club.`,
      clubIds: [u.clubId], playerIds: [], sourceRef: `move-${w.season}-${u.clubId}`,
    });
  }
  return moves;
}
