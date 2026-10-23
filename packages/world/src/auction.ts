import type { AuctionLot, AuctionState, Club, LeagueConfig, LiveAuction, Player, RuleCheck, WorldState } from '@kurciv/domain';
import { ageOf, basePriceFor, bowlingKind, canAfford, canRegister, isOverseas, marketValue, overall } from '@kurciv/domain';
import { COUNTRY_NAMES, EXPORT_RESTRICTIONS, domesticOf, exportAllowed, leagueById } from '@kurciv/config';
import { hash01 } from '@kurciv/simulation';
import { pickXI } from '@kurciv/ai';
import { activeLeagues, addNews, clubsInLeague, formatCr, nextId, round2, squadOf } from './util';
import { recordTransaction } from './finance';
import { addTimeline } from './story';

/**
 * Global auction cascade. Leagues auction in descending reputation; a player bought by a
 * higher league leaves the pool before the next league's auction is built, so nobody is
 * ever sold twice. Every bid — user or AI — is validated against purse, reserve and
 * squad rules on the server.
 */

// ------------------------------------------------------------------ helpers

export function priceScale(l: LeagueConfig): number {
  return l.auctionRules.purse / 120;
}

/**
 * Expected hammer price, calibrated against simulated auctions run through the live engine.
 */
export function auctionEstimate(p: Player, season: number, l: LeagueConfig): number {
  const raw = marketValue(p, season) * priceScale(l);
  const rel = raw / l.auctionRules.purse;
  // Calibrated against simulated auctions: fringe players go near half their raw value, and the
  // multiple rises steadily with quality to about 1.6x for the very best.
  const mult = Math.min(1.7, 0.5 + Math.max(0, rel - 0.015) * 17);
  return Math.round(raw * mult * 100) / 100;
}

export function increment(l: LeagueConfig, price: number): number {
  for (const t of l.auctionRules.increments) if (price < t.upTo) return t.step;
  return l.auctionRules.increments[l.auctionRules.increments.length - 1].step;
}

export function nextBid(l: LeagueConfig, lot: AuctionLot): number {
  if (!lot.bids.length) return lot.basePrice;
  const cur = lot.bids[lot.bids.length - 1].amount;
  return round2(cur + increment(l, cur));
}

export function eligibleForLeague(p: Player, l: LeagueConfig): boolean {
  // In the pyramid, export restrictions apply club by club (see registerCheck).
  const restricted = EXPORT_RESTRICTIONS[p.country];
  if (restricted && l.kind !== 'division' && !restricted.includes(l.id)) return false;
  return !p.retired && !p.isYouth && p.clubId === null;
}

/** Can `club` register `p`? Squad rules relative to the club's own country, plus export restrictions. */
export function registerCheck(w: WorldState, club: Club, p: Player, l: LeagueConfig = leagueById(club.leagueId)): RuleCheck {
  if (!exportAllowed(p.country, club)) return { ok: false, code: 'EXPORT', reason: `${p.name} may only join clubs from ${COUNTRY_NAMES[p.country]}.` };
  return canRegister(squadOf(w, club), p, l.squadRules, domesticOf(club));
}

const REPLACEMENT_LEVEL = 64;

export type Category = 'WK' | 'BAT' | 'AR' | 'PACE' | 'SPIN';

export function categoryOf(p: Player): Category {
  if (p.role === 'WK') return 'WK';
  if (p.role === 'AR') return 'AR';
  if (p.role === 'BOWL') return bowlingKind(p) === 'spin' ? 'SPIN' : 'PACE';
  return 'BAT';
}

export function roleTargets(l: LeagueConfig): Record<Category, number> {
  const S = Math.min(l.squadRules.maxSquad, 23);
  return { WK: 2, BAT: Math.round(S * 0.26), AR: Math.round(S * 0.2), PACE: Math.round(S * 0.22), SPIN: Math.round(S * 0.13) };
}

function xiStrength(players: Player[], l: LeagueConfig, club: Club, replacement = REPLACEMENT_LEVEL): number {
  // Empty slots count at replacement level: what a club can still expect to buy later.
  if (players.length < 11) return players.reduce((a, p) => a + overall(p), 0) + (11 - players.length) * replacement;
  return pickXI(players, l.squadRules, domesticOf(club)).reduce((a, p) => a + overall(p), 0);
}

/**
 * Replacement level: the quality a club can still expect to pick up cheaply later in this
 * auction — the rating of the marginal XI-calibre player left in the pool, given how many
 * XI places are still open across the league. It falls as the good players are bought.
 */
export function replacementLevel(w: WorldState, a: AuctionState, lotIndex: number): number {
  const l = leagueById(a.leagueId);
  const vacancies = clubsInLeague(w, l.id).reduce((s, c) => s + Math.max(0, 11 - Math.min(11, c.squad.length)), 0);
  const pool = a.lots.slice(lotIndex + 1).filter((x) => x.status === 'pending').map((x) => overall(w.players[x.playerId])).sort((x, y) => y - x);
  if (!pool.length || vacancies === 0) return 58;
  const idx = Math.min(pool.length - 1, Math.max(0, vacancies - 1));
  return Math.max(55, Math.min(78, pool[idx]));
}

/** Money per rating point above replacement, from the league's own economics. */
export function pricePerPoint(l: LeagueConfig): number {
  // A club spends roughly three quarters of its purse on an XI about 12 points per place above replacement.
  return (0.75 * l.auctionRules.purse) / (11 * 12);
}

/** Share of the starting purse a club will commit to one player (before exceptional-player headroom). */
const BUDGET_SHARE: Record<string, number> = {
  'aggressive-contender': 0.24, 'star-commercial': 0.22, 'youth-builder': 0.18, 'value-hunter': 0.17,
  'spin-tactician': 0.19, 'pace-first': 0.19, conservative: 0.16, rebuilding: 0.17,
};

// ------------------------------------------------------------------ setup / lots

export function setupAuctions(w: WorldState) {
  // Leagues auction in descending reputation; pyramid divisions in tier order.
  const order = [...activeLeagues(w)].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || w.leagues[b.id].reputation - w.leagues[a.id].reputation || a.id.localeCompare(b.id));
  const userLeague = w.clubs[w.userClubId].leagueId;
  w.auctions = {};
  w.auctionOrder = [];
  order.forEach((l, i) => {
    const id = `AUC-${l.id}-${w.season}`;
    w.auctions[id] = {
      id, leagueId: l.id, season: w.season, order: i, status: 'pending', lots: [], currentLotIndex: 0, version: 0, userProxy: {}, notes: [], log: [],
      interactive: l.id === userLeague,
    };
    w.auctionOrder.push(id);
  });
}

/**
 * Registration. Every uncontracted senior player is eligible; a player is registered for this
 * auction when at least one of its clubs could sign him (export rules). The main catalogue
 * offers the strongest registered players by market value — enough for every open squad place
 * with depth to spare (the rule is shown in the auction room) — and the rest of the registered
 * pool stays callable in the accelerated round, so nobody eligible is invisible.
 */
export function registrationFor(w: WorldState, l: LeagueConfig): { eligible: Player[]; registered: Player[] } {
  const clubs = clubsInLeague(w, l.id);
  const eligible = Object.values(w.players).filter((p) => eligibleForLeague(p, l) && ageOf(p, w.season) >= 16);
  const registered = eligible.filter((p) => clubs.some((c) => exportAllowed(p.country, c)));
  return { eligible, registered };
}

function buildLots(w: WorldState, a: AuctionState): AuctionLot[] {
  const l = leagueById(a.leagueId);
  const clubs = clubsInLeague(w, l.id);
  const { eligible, registered } = registrationFor(w, l);
  const byValue = (x: Player, y: Player) => marketValue(y, w.season) - marketValue(x, w.season) || x.id.localeCompare(y.id);
  // Domestic depth per home-country group (clubs sharing domestic rules), so every club can
  // complete a legal squad; then the overseas market (players overseas to every club here).
  const groups = new Map<string, { countries: Player['country'][]; need: number }>();
  let osVac = 0;
  for (const c of clubs) {
    const dom = domesticOf(c);
    const key = [...dom].sort().join('|');
    const vac = Math.max(0, l.squadRules.maxSquad - c.squad.length);
    const os = Math.max(0, l.squadRules.maxOverseas - squadOf(w, c).filter((p) => isOverseas(p, dom)).length);
    osVac += os;
    const g = groups.get(key) ?? { countries: dom, need: 0 };
    g.need += Math.max(0, vac - Math.min(os, Math.floor(vac * 0.3)));
    groups.set(key, g);
  }
  const picked = new Set<string>();
  const chosen: Player[] = [];
  for (const g of groups.values()) {
    for (const p of registered.filter((x) => g.countries.includes(x.country)).sort(byValue).slice(0, Math.ceil(g.need * 1.6) + 6)) {
      if (!picked.has(p.id)) {
        picked.add(p.id);
        chosen.push(p);
      }
    }
  }
  const domesticSomewhere = (p: Player) => clubs.some((c) => !isOverseas(p, domesticOf(c)));
  for (const p of registered.filter((x) => !domesticSomewhere(x)).sort(byValue).slice(0, Math.ceil(osVac * 2) + 8)) {
    if (!picked.has(p.id)) {
      picked.add(p.id);
      chosen.push(p);
    }
  }
  a.registration = {
    eligible: eligible.length, registered: registered.length, catalogued: chosen.length,
    rule: `Catalogue: ${chosen.length} players — the highest-valued domestic players for each home country here (about 1.6 per open domestic place) plus the best overseas players (about 2 per open overseas slot). The other ${registered.length - chosen.length} registered players can be called up in the accelerated round.`,
  };
  const scale = priceScale(l);
  const roundBase = (v: number) => {
    const step = increment(l, v);
    return Math.max(l.auctionRules.minBase, round2(Math.round(v / step) * step));
  };
  // Sets: marquee first, then capped by role, then uncapped by role (seeded order inside a set).
  const marquee = [...chosen].sort(byValue).slice(0, 10);
  const setName = (p: Player) => {
    if (marquee.includes(p)) return 'Marquee';
    const cat = { WK: 'Wicketkeepers', BAT: 'Batters', AR: 'All-rounders', PACE: 'Fast bowlers', SPIN: 'Spinners' }[categoryOf(p)];
    return `${p.capped ? 'Capped' : 'Uncapped'} ${cat}`;
  };
  const setOrder = ['Marquee', 'Capped Batters', 'Capped All-rounders', 'Capped Wicketkeepers', 'Capped Fast bowlers', 'Capped Spinners', 'Uncapped Batters', 'Uncapped All-rounders', 'Uncapped Wicketkeepers', 'Uncapped Fast bowlers', 'Uncapped Spinners'];
  const lots = chosen.map((p) => ({
    id: `${a.id}-${p.id}`,
    playerId: p.id,
    set: setName(p),
    basePrice: roundBase(Math.min(2 * scale, Math.max(l.auctionRules.minBase, basePriceFor(p, w.season, 0.2) * scale))),
    status: 'pending' as const,
    bids: [],
    soldTo: null,
    price: null,
    round: 1 as const,
  }));
  lots.sort((x, y) => setOrder.indexOf(x.set) - setOrder.indexOf(y.set) || hash01(`${w.seed}|${x.id}`) - hash01(`${w.seed}|${y.id}`));
  return lots;
}

// ------------------------------------------------------------------ AI valuation

const PERSONALITY_NOTES: Record<Club['personality'], string> = {
  'youth-builder': 'youth-first recruitment', 'star-commercial': 'star-driven commercial strategy', 'value-hunter': 'data-led value hunting',
  'spin-tactician': 'spin-heavy tactical plan', 'pace-first': 'pace-first attack', 'aggressive-contender': 'all-in title push',
  conservative: 'conservative budgeting', rebuilding: 'rebuild around younger players',
};

function personalityMult(c: Club, p: Player, season: number): number {
  const age = ageOf(p, season);
  const ovr = overall(p);
  const kind = bowlingKind(p);
  switch (c.personality) {
    case 'youth-builder': return age <= 24 ? 1.3 : age >= 31 ? 0.75 : 1;
    case 'star-commercial': return p.reputation >= 70 ? 1.35 : p.reputation < 30 ? 0.85 : 1;
    case 'value-hunter': return (ovr >= 72 && p.reputation < 55 ? 1.18 : 1) * 0.9;
    case 'spin-tactician': return kind === 'spin' && p.role !== 'BAT' ? 1.3 : 1;
    case 'pace-first': return kind === 'pace' && p.role !== 'BAT' ? 1.3 : 1;
    case 'aggressive-contender': return ovr >= 80 ? 1.2 : 1;
    case 'conservative': return 0.85;
    case 'rebuilding': return age <= 26 ? 1.2 : age >= 30 ? 0.7 : 1;
  }
}

export interface Valuation {
  value: number;
  maxBid: number;
  reason: string;
}

/** Marginal-utility valuation of `p` for `club`, converted into a hard maximum bid. */
export function valuePlayer(w: WorldState, a: AuctionState, club: Club, p: Player, lotIndex: number): Valuation {
  const l = leagueById(a.leagueId);
  const squad = squadOf(w, club);
  const reg = registerCheck(w, club, p, l);
  if (!reg.ok) return { value: 0, maxBid: 0, reason: reg.reason ?? 'ineligible' };
  const scale = priceScale(l);
  const cat = categoryOf(p);
  const tgt = roleTargets(l);
  const have = squad.filter((x) => categoryOf(x) === cat).length;
  // Role cap: a club with this role well covered withdraws rather than stockpiling.
  if (have >= tgt[cat] + 3) return { value: 0, maxBid: 0, reason: `role cap: already ${have} in that role (plan ${tgt[cat]})` };
  const need = have < tgt[cat] ? 1 + (0.45 * (tgt[cat] - have)) / tgt[cat] + (have === 0 && cat === 'WK' ? 0.4 : 0) : Math.pow(0.6, have - tgt[cat] + 1);
  // Contribution: rating points this player adds to the club's likely XI over what it could
  // still buy cheaply (replacement level), priced from the league's economics, with a modest
  // premium for genuinely rare quality. Blended with the market's view of the player.
  const repl = replacementLevel(w, a, lotIndex);
  const before = xiStrength(squad, l, club, repl);
  const after = xiStrength([...squad, p], l, club, repl);
  const deltaXI = Math.max(0, after - before);
  const market = marketValue(p, w.season);
  const contribution = pricePerPoint(l) * deltaXI * (1 + deltaXI / 30);
  let value = 0.55 * contribution * Math.min(1.25, need) + 0.45 * market * need * scale;

  // Replacement availability later in this auction
  const ovr = overall(p);
  const later = a.lots.slice(lotIndex + 1).filter((x) => x.status === 'pending' && categoryOf(w.players[x.playerId]) === cat && overall(w.players[x.playerId]) >= ovr - 4).length;
  const scarcity = later === 0 ? 1.15 : later >= 4 ? 0.88 : 1;
  value *= scarcity;
  // Overseas slots are precious: an overseas player must clearly beat the domestic option.
  const os = isOverseas(p, domesticOf(club));
  if (os) {
    const osHave = squad.filter((x) => isOverseas(x, domesticOf(club))).length;
    value *= 0.85 + Math.max(0, ovr - 72) / 60 - osHave * 0.03;
  }
  // A club that just lost a contested player in this role chases a substitute a little harder.
  const chasing = a.live?.missed[club.id]?.includes(cat) ? 1.12 : 1;
  value *= chasing;
  // Budget pressure: money left unspent after the auction is worth nothing, so a club holding a
  // large purse per open slot is willing to pay more (and a stretched club less).
  const openSlots = Math.max(1, Math.min(l.squadRules.maxSquad, 22) - squad.length);
  const pressure = Math.pow(Math.min(3, Math.max(0.6, club.purse / openSlots / (l.auctionRules.purse / 22))), 0.9);
  value *= pressure;
  const pers = personalityMult(club, p, w.season);
  value *= pers;
  value *= 0.93 + hash01(`${w.seed}|${club.id}|${p.id}`) * 0.14; // scouting disagreement
  if (squad.length >= Math.min(l.squadRules.maxSquad, 23)) value *= 0.3;

  // Purse planning: keep the reserve, and pace spending across remaining slots.
  const slotsLeft = Math.max(1, Math.min(l.squadRules.maxSquad, 22) - squad.length);
  const reserve = Math.max(0, l.squadRules.minSquad - squad.length - 1) * l.auctionRules.minBase;
  const spendable = Math.max(0, club.purse - reserve);
  const fairShare = spendable / slotsLeft;
  const style = club.personality === 'aggressive-contender' ? 1.25 : club.personality === 'star-commercial' ? 1.15 : club.personality === 'conservative' ? 0.85 : club.personality === 'value-hunter' ? 0.9 : 1;
  const allowance = (0.8 + Math.max(0, ovr - 60) * 0.16) * style * (0.9 + hash01(`${w.seed}|cap|${club.id}|${p.id}`) * 0.2);
  // No club sinks most of its purse into one or two players; exceptional players earn headroom.
  const share = (BUDGET_SHARE[club.personality] ?? 0.18) + (ovr >= 86 ? 0.05 : ovr >= 83 ? 0.02 : 0);
  const shareCap = l.auctionRules.purse * share * Math.min(1.5, pressure) * (0.92 + hash01(`${w.seed}|share|${club.id}|${p.id}`) * 0.16);
  let maxBid = Math.min(value, spendable, fairShare * allowance, shareCap);
  maxBid = round2(maxBid);
  const bits: string[] = [];
  if (have < tgt[cat]) bits.push(`short of ${cat === 'PACE' ? 'fast bowlers' : cat === 'SPIN' ? 'spinners' : cat === 'WK' ? 'wicketkeepers' : cat === 'AR' ? 'all-rounders' : 'batters'} (${have}/${tgt[cat]})`);
  else bits.push(`already ${have} in that role`);
  if (deltaXI > 0) bits.push(`+${deltaXI.toFixed(1)} to best-XI rating`);
  if (scarcity > 1) bits.push('few comparable players left');
  if (scarcity < 1) bits.push('similar options still to come');
  if (pers !== 1) bits.push(PERSONALITY_NOTES[club.personality]);
  if (chasing > 1) bits.push('missed out on a target in this role earlier');
  if (pressure > 1.15) bits.push('plenty of purse left per open slot');
  if (maxBid < value * 0.9) bits.push(maxBid >= shareCap * 0.99 ? `capped at ${Math.round(share * 100)}% of the purse for one player` : `capped by purse plan (${formatCr(spendable)} spendable over ${slotsLeft} slots)`);
  return { value: round2(value), maxBid, reason: bits.join('; ') };
}

// ------------------------------------------------------------------ bidding core

export function leader(lot: AuctionLot): string | null {
  return lot.bids.length ? lot.bids[lot.bids.length - 1].clubId : null;
}

export function validBidFor(w: WorldState, a: AuctionState, club: Club, p: Player, amount: number): string | null {
  const l = leagueById(a.leagueId);
  const squad = squadOf(w, club);
  const reg = registerCheck(w, club, p, l);
  if (!reg.ok) return reg.reason!;
  const aff = canAfford(club.purse, amount, squad.length, l.squadRules, l.auctionRules.minBase);
  if (!aff.ok) return aff.reason!;
  return null;
}

/** AI clubs keep raising while anyone other than the leader values the lot above the next bid. */
export function escalate(w: WorldState, a: AuctionState, lot: AuctionLot, userMax: number | null) {
  const l = leagueById(a.leagueId);
  const p = w.players[lot.playerId];
  const ceilings: { clubId: string; max: number }[] = Object.entries(lot.aiMax ?? {}).map(([clubId, max]) => ({ clubId, max }));
  if (userMax !== null && !lot.userOut) ceilings.push({ clubId: w.userClubId, max: userMax });
  let guard = 0;
  while (guard++ < 400) {
    const price = nextBid(l, lot);
    const cur = leader(lot);
    const rivals = ceilings
      .filter((c) => c.clubId !== cur && c.max >= price && !validBidFor(w, a, w.clubs[c.clubId], p, price))
      .sort((x, y) => y.max - x.max || hash01(`${lot.id}|${x.clubId}`) - hash01(`${lot.id}|${y.clubId}`));
    if (!rivals.length) return;
    lot.bids.push({ clubId: rivals[0].clubId, amount: price, at: lot.bids.length, proxy: rivals[0].clubId === w.userClubId || undefined });
  }
}

export function openLot(w: WorldState, a: AuctionState, idx: number) {
  const lot = a.lots[idx];
  const l = leagueById(a.leagueId);
  const p = w.players[lot.playerId];
  lot.status = 'live';
  lot.aiMax = {};
  for (const c of clubsInLeague(w, l.id)) {
    if (c.id === w.userClubId) continue;
    const v = valuePlayer(w, a, c, p, idx);
    if (v.maxBid >= lot.basePrice) {
      lot.aiMax[c.id] = v.maxBid;
      if (v.maxBid >= lot.basePrice * 2.5 || v.maxBid >= 3 * priceScale(l)) {
        a.notes.push({ clubId: c.id, playerId: p.id, lotId: lot.id, valuation: v.value, maxBid: v.maxBid, reason: v.reason });
      }
    }
  }
  if (a.notes.length > 600) a.notes.splice(0, a.notes.length - 600);
}

export function closeLot(w: WorldState, a: AuctionState, lot: AuctionLot) {
  const l = leagueById(a.leagueId);
  const p = w.players[lot.playerId];
  const win = leader(lot);
  if (win) {
    const price = lot.bids[lot.bids.length - 1].amount;
    const club = w.clubs[win];
    const err = validBidFor(w, a, club, p, price);
    if (err) throw new Error(`Invariant: winning bid became invalid (${err})`);
    lot.status = 'sold';
    lot.soldTo = win;
    lot.price = price;
    signPlayer(w, club, p, price, 'auction', l);
    a.log.push(`${p.name} SOLD to ${club.shortName} for ${formatCr(price)}`);
    if (price >= 10 * priceScale(l) || (club.isUser && price >= 2 * priceScale(l))) {
      addNews(w, {
        kind: 'auction', importance: price >= 15 * priceScale(l) ? 3 : 2,
        headline: `${club.name} land ${p.name} for ${formatCr(price)}`,
        body: `${p.name} goes to ${club.name} in the ${l.shortName} auction after ${lot.bids.length} bids.`,
        clubIds: [club.id], playerIds: [p.id], sourceRef: lot.id,
      });
    }
  } else {
    lot.status = 'unsold';
    a.log.push(`${p.name} unsold at base ${formatCr(lot.basePrice)}`);
  }
  delete lot.aiMax;
}

export function signPlayer(w: WorldState, club: Club, p: Player, price: number, kind: 'auction' | 'free-agent' | 'replacement' | 'youth-promotion', l: LeagueConfig) {
  if (p.clubId) throw new Error(`${p.name} is already contracted`);
  p.clubId = club.id;
  p.contract = { clubId: club.id, leagueId: l.id, salary: price, startSeason: w.season, endSeason: w.season, acquired: kind === 'youth-promotion' ? 'youth' : kind, retainedCount: 0 };
  club.squad.push(p.id);
  if (kind === 'auction' || kind === 'free-agent' || kind === 'replacement') club.purse = round2(club.purse - price);
  w.freeAgents = w.freeAgents.filter((id) => id !== p.id);
  w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId: p.id, fromClubId: null, toClubId: club.id, kind, fee: price, note: `${l.shortName} ${kind}` });
  if (price > 0) recordTransaction(w, club.id, 'auction', -price, `${p.name} (${kind})`);
  if (club.isUser && (kind === 'auction' || kind === 'free-agent' || kind === 'replacement')) {
    addTimeline(w, 'signing', `${p.name} signs for ${club.name}`, `${kind === 'auction' ? 'Bought at auction' : 'Signed'} for ${formatCr(price)}.`, [p.id]);
  }
}

// ------------------------------------------------------------------ lifecycle

export function startAuction(w: WorldState, auctionId: string) {
  const a = w.auctions[auctionId];
  if (a.status !== 'pending') return;
  a.lots = buildLots(w, a);
  a.status = 'live';
  a.currentLotIndex = 0;
  a.version++;
  // The user's auction opens in the lobby; the real-time room (auction-live.ts) drives it from there.
  if (a.interactive) a.live = createLiveState();
}

export function createLiveState(): LiveAuction {
  return {
    phase: 'PREPARATION', phaseMs: 0, clock: 0, paused: false, schedule: {}, dropped: [], bidders: [], commentary: [],
    lastResult: null, results: [], missed: {}, accelerated: null, userWatching: false, outbid: false,
  };
}

function canUserBid(w: WorldState, a: AuctionState, lot: AuctionLot): boolean {
  if (lot.userOut) return false;
  const l = leagueById(a.leagueId);
  if (leader(lot) === w.userClubId) return false;
  return !validBidFor(w, a, w.clubs[w.userClubId], w.players[lot.playerId], nextBid(l, lot));
}

/**
 * Runs lots until the user has a meaningful decision on the live lot (they can afford and
 * register the next bid) or the auction ends.
 */
function advanceToUserTurn(w: WorldState, a: AuctionState) {
  let guard = 0;
  while (a.status === 'live' && guard++ < 2000) {
    const lot = a.lots[a.currentLotIndex];
    if (!lot) {
      endRound(w, a);
      continue;
    }
    if (lot.status === 'pending') {
      openLot(w, a, a.currentLotIndex);
      const proxy = a.userProxy[lot.playerId];
      escalate(w, a, lot, proxy ?? null);
      if (proxy !== undefined) lot.userOut = true; // proxy speaks for the user on this lot
    }
    if (lot.status === 'live' && a.interactive && canUserBid(w, a, lot)) return;
    closeLot(w, a, lot);
    a.currentLotIndex++;
  }
}

/**
 * End of a round. In the live room (`selectAccelerated`) the user drafts which unsold players
 * return; instant simulation brings back every unsold player automatically.
 */
export function endRound(w: WorldState, a: AuctionState, selectAccelerated = false) {
  const l = leagueById(a.leagueId);
  const round1Done = a.lots.every((x) => x.round === 2 || x.status !== 'pending');
  const hasRound2 = a.lots.some((x) => x.round === 2);
  if (l.auctionRules.unsoldRound && round1Done && !hasRound2 && a.live && selectAccelerated) {
    // Interactive auction: the user (and AI clubs' nominations) choose who returns.
    const offered = new Set(a.lots.map((x) => x.playerId));
    const uncatalogued = registrationFor(w, l).registered.filter((p) => !offered.has(p.id)).sort((x, y) => marketValue(y, w.season) - marketValue(x, w.season)).slice(0, 120).map((p) => p.id);
    const candidates = [...a.lots.filter((x) => x.status === 'unsold').map((x) => x.playerId).filter((pid) => !w.players[pid].clubId), ...uncatalogued];
    if (candidates.length) {
      const nominated = candidates.filter((pid) =>
        clubsInLeague(w, l.id).some((c) => !c.isUser && valuePlayer(w, a, c, w.players[pid], a.lots.length).maxBid >= l.auctionRules.minBase * 1.2),
      );
      a.live.accelerated = { candidates, selected: nominated.slice(0, 40) };
      a.live.phase = 'ACCELERATED_SELECTION';
      a.live.phaseMs = 0;
      return;
    }
  }
  if (l.auctionRules.unsoldRound && round1Done && !hasRound2 && !selectAccelerated) {
    const unsold = a.lots.filter((x) => x.status === 'unsold').slice(0, 80);
    const fresh: AuctionLot[] = unsold.map((x) => ({ ...x, id: `${x.id}-r2`, status: 'pending', bids: [], soldTo: null, price: null, round: 2, userOut: false }));
    // AI clubs with open places nominate from the uncatalogued registered pool (one per club with a need).
    const offered = new Set(a.lots.map((x) => x.playerId));
    const extra = registrationFor(w, l).registered.filter((p) => !offered.has(p.id)).sort((x, y) => marketValue(y, w.season) - marketValue(x, w.season)).slice(0, 60);
    for (const c of clubsInLeague(w, l.id)) {
      if (c.isUser || c.squad.length >= Math.min(l.squadRules.maxSquad, 20)) continue;
      const pick = extra.find((p) => !fresh.some((f) => f.playerId === p.id) && registerCheck(w, c, p, l).ok);
      if (pick) fresh.push({ id: `${a.id}-${pick.id}-r2`, playerId: pick.id, set: 'Accelerated', basePrice: l.auctionRules.minBase, status: 'pending', bids: [], soldTo: null, price: null, round: 2, userOut: false });
    }
    if (fresh.length) {
      a.lots.push(...fresh);
      a.log.push(`Accelerated round: ${fresh.length} unsold players return.`);
      return;
    }
  }
  finishAuction(w, a);
}

/** After instant simulation inside an interactive auction, the room resumes at the next lot. */
export function resetLiveForNextLot(a: AuctionState) {
  if (!a.live) return;
  a.live.phase = a.status === 'live' ? 'PLAYER_INTRODUCTION' : 'COMPLETED';
  a.live.phaseMs = 2600;
  a.live.schedule = {};
  a.live.dropped = [];
  a.live.bidders = [];
  a.live.outbid = false;
}

export function finishAuction(w: WorldState, a: AuctionState) {
  if (a.live) a.live.phase = 'COMPLETED';
  const l = leagueById(a.leagueId);
  a.status = 'complete';
  a.version++;
  if (a.interactive) {
    // The auction-eve story has played out.
    for (const s of w.stories) {
      if (s.status === 'active' && s.trigger === `auction-${w.season}`) {
        s.status = 'resolved';
        s.resolution = 'The auction is complete.';
      }
    }
  }
  // AI clubs below the minimum squad sign the best remaining eligible free agents at minimum price.
  for (const c of clubsInLeague(w, l.id)) {
    if (c.id === w.userClubId) continue;
    fillSquadToMinimum(w, c, l);
  }
  const sold = a.lots.filter((x) => x.status === 'sold');
  const top = [...sold].sort((x, y) => (y.price ?? 0) - (x.price ?? 0))[0];
  addNews(w, {
    kind: 'auction', importance: 2,
    headline: `${l.shortName} auction complete: ${sold.length} players sold`,
    body: top ? `${w.players[top.playerId].name} was the most expensive buy at ${formatCr(top.price!)} (${w.clubs[top.soldTo!].name}).` : 'No players were sold.',
    clubIds: [], playerIds: top ? [top.playerId] : [], sourceRef: a.id,
  });
}

export function fillSquadToMinimum(w: WorldState, c: Club, l: LeagueConfig): number {
  let added = 0;
  while (c.squad.length < l.squadRules.minSquad) {
    const squad = squadOf(w, c);
    const tgt = roleTargets(l);
    const pool = Object.values(w.players)
      .filter((p) => eligibleForLeague(p, l) && ageOf(p, w.season) >= 16 && registerCheck(w, c, p, l).ok)
      .map((p) => {
        const cat = categoryOf(p);
        const have = squad.filter((x) => categoryOf(x) === cat).length;
        return { p, score: overall(p) + (have < tgt[cat] ? 8 : 0) };
      })
      .sort((x, y) => y.score - x.score || x.p.id.localeCompare(y.p.id));
    const pick = pool[0]?.p;
    if (!pick) break;
    const price = Math.min(l.auctionRules.minBase, Math.max(0, c.purse));
    signPlayer(w, c, pick, price, 'free-agent', l);
    added++;
  }
  return added;
}

// ------------------------------------------------------------------ user actions

export type AuctionAction =
  | { type: 'bid' }
  | { type: 'pass' }
  | { type: 'proxy'; playerId: string; max: number | null }
  | { type: 'flag'; playerId: string; flagged: boolean }
  | { type: 'sim'; until: 'flagged' | 'set' | 'end'; assistant: boolean };

export interface AuctionResult {
  ok: boolean;
  error?: string;
  code?: 'VERSION' | 'RULE' | 'STATE';
}

export function auctionAct(w: WorldState, auctionId: string, action: AuctionAction, expectedVersion: number): AuctionResult {
  const a = w.auctions[auctionId];
  if (!a) return { ok: false, error: 'Unknown auction.', code: 'STATE' };
  if (!a.interactive) return { ok: false, error: 'You are not participating in this auction.', code: 'STATE' };
  if (a.status !== 'live') return { ok: false, error: 'Auction is not live.', code: 'STATE' };
  if (expectedVersion !== a.version) return { ok: false, error: 'The auction moved on — refreshed to the latest state.', code: 'VERSION' };
  const l = leagueById(a.leagueId);
  const lot = a.lots[a.currentLotIndex];
  switch (action.type) {
    case 'bid': {
      if (!lot || lot.status !== 'live') return { ok: false, error: 'No live lot.', code: 'STATE' };
      if (lot.userOut) return { ok: false, error: 'You have already dropped out of this lot.', code: 'RULE' };
      if (leader(lot) === w.userClubId) return { ok: false, error: 'You already hold the highest bid.', code: 'RULE' };
      const amount = nextBid(l, lot);
      const err = validBidFor(w, a, w.clubs[w.userClubId], w.players[lot.playerId], amount);
      if (err) return { ok: false, error: err, code: 'RULE' };
      lot.bids.push({ clubId: w.userClubId, amount, at: lot.bids.length });
      escalate(w, a, lot, null);
      if (leader(lot) === w.userClubId) {
        closeLot(w, a, lot);
        a.currentLotIndex++;
      }
      advanceToUserTurn(w, a);
      break;
    }
    case 'pass': {
      if (!lot || lot.status !== 'live') return { ok: false, error: 'No live lot.', code: 'STATE' };
      lot.userOut = true;
      closeLot(w, a, lot);
      a.currentLotIndex++;
      advanceToUserTurn(w, a);
      break;
    }
    case 'proxy': {
      const p = w.players[action.playerId];
      if (!p) return { ok: false, error: 'Unknown player.', code: 'STATE' };
      if (action.max === null) delete a.userProxy[action.playerId];
      else {
        if (!(action.max > 0) || action.max > w.clubs[w.userClubId].purse) return { ok: false, error: `Proxy maximum must be between 0 and your purse (${formatCr(w.clubs[w.userClubId].purse)}).`, code: 'RULE' };
        a.userProxy[action.playerId] = round2(action.max);
      }
      // A proxy on the live lot takes effect immediately.
      if (lot && lot.status === 'live' && lot.playerId === action.playerId && action.max !== null) {
        escalate(w, a, lot, action.max);
        lot.userOut = true;
        closeLot(w, a, lot);
        a.currentLotIndex++;
        advanceToUserTurn(w, a);
      }
      break;
    }
    case 'flag': {
      const target = a.lots.find((x) => x.playerId === action.playerId && x.status === 'pending');
      if (!target) return { ok: false, error: 'That player is not waiting in the queue.', code: 'STATE' };
      target.flaggedByUser = action.flagged;
      break;
    }
    case 'sim': {
      simulateUserLots(w, a, action.until, action.assistant);
      break;
    }
  }
  a.version++;
  return { ok: true };
}

/** Lets the auction run without the user (optionally with the assistant bidding to the club's plan). */
function simulateUserLots(w: WorldState, a: AuctionState, until: 'flagged' | 'set' | 'end', assistant: boolean) {
  const startSet = a.lots[a.currentLotIndex]?.set;
  const userClub = w.clubs[w.userClubId];
  let guard = 0;
  while (a.status === 'live' && guard++ < 3000) {
    const lot = a.lots[a.currentLotIndex];
    if (!lot) {
      endRound(w, a);
      continue;
    }
    if (until === 'flagged' && lot.flaggedByUser && guard > 1) break;
    if (until === 'set' && lot.set !== startSet) break;
    if (lot.status === 'pending') openLot(w, a, a.currentLotIndex);
    let userMax: number | null = a.userProxy[lot.playerId] ?? null;
    if (userMax === null && assistant) {
      const v = valuePlayer(w, a, userClub, w.players[lot.playerId], a.currentLotIndex);
      userMax = v.maxBid >= lot.basePrice ? v.maxBid : null;
    }
    escalate(w, a, lot, userMax);
    lot.userOut = true;
    closeLot(w, a, lot);
    a.currentLotIndex++;
  }
  if (a.status === 'live') {
    if (a.live) resetLiveForNextLot(a);
    else advanceToUserTurn(w, a);
  }
}

/** Runs a non-interactive auction to completion. */
export function runAuctionInstant(w: WorldState, auctionId: string) {
  const a = w.auctions[auctionId];
  if (a.status === 'pending') startAuction(w, auctionId);
  let guard = 0;
  while (a.status === 'live' && guard++ < 3000) {
    const lot = a.lots[a.currentLotIndex];
    if (!lot) {
      endRound(w, a);
      continue;
    }
    if (lot.status === 'pending') openLot(w, a, a.currentLotIndex);
    escalate(w, a, lot, null);
    closeLot(w, a, lot);
    a.currentLotIndex++;
  }
}

/**
 * Advances the cascade: completes every auction ahead of the user's league instantly, opens
 * the user's interactive auction, and after it completes runs the remaining lower tiers.
 * Returns true once every auction is complete.
 */
export function advanceCascade(w: WorldState): boolean {
  for (const id of w.auctionOrder) {
    const a = w.auctions[id];
    if (a.status === 'complete') continue;
    if (a.interactive) {
      if (a.status === 'pending') startAuction(w, id);
      if (a.status === 'live') return false;
      continue;
    }
    runAuctionInstant(w, id);
  }
  // Everyone left unsigned becomes a free agent.
  w.freeAgents = Object.values(w.players).filter((p) => !p.clubId && !p.retired && !p.isYouth).map((p) => p.id);
  return true;
}

/**
 * Client-safe view: hides AI ceilings, and only reveals AI reasoning for lots that have
 * closed — so explanations help the user learn without leaking live intentions.
 */
export function publicAuction(a: AuctionState): AuctionState {
  const closed = new Set(a.lots.filter((x) => x.status === 'sold' || x.status === 'unsold').map((x) => x.id));
  return {
    ...a,
    lots: a.lots.map(({ aiMax: _hidden, ...rest }) => rest),
    notes: a.notes.filter((n) => closed.has(n.lotId)).map((n) => ({ ...n, maxBid: 0, valuation: 0 })),
  };
}

export function auctionLeague(a: AuctionState): LeagueConfig {
  return leagueById(a.leagueId);
}
