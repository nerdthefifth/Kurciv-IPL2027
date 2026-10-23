import type { AuctionState, Player, WorldState } from '@kurciv/domain';
import { ageOf, canAfford, canRegister, isOverseas, marketValue, overall, reserveNeeded } from '@kurciv/domain';
import { COUNTRY_NAMES, domesticOf, leagueById } from '@kurciv/config';
import { pickXI } from '@kurciv/ai';
import { AUCTION_TIMING, auditLeague, registerCheck, auctionEstimate, categoryOf, clubsInLeague, leader, nextBid, permittedBids, priceScale, roleDemand, roleTargets, squadOf, valuePlayer } from '@kurciv/world';
import { playerView } from './views';
const formatCr = (v: number) => `₹${v.toFixed(2)} Cr`;

const CAT_LABEL: Record<string, string> = { WK: 'Wicketkeepers', BAT: 'Batters', AR: 'All-rounders', PACE: 'Fast bowlers', SPIN: 'Spinners' };

export function userAuctionOf(w: WorldState): AuctionState | null {
  return w.auctionOrder.map((id) => w.auctions[id]).find((a) => a?.interactive) ?? null;
}

function clubCard(w: WorldState, a: AuctionState, clubId: string) {
  const l = leagueById(a.leagueId);
  const c = w.clubs[clubId];
  const sq = squadOf(w, c);
  const tgt = roleTargets(l);
  const needs = (Object.keys(tgt) as (keyof typeof tgt)[])
    .map((k) => ({ cat: k, gap: tgt[k] - sq.filter((p) => categoryOf(p) === k).length }))
    .filter((x) => x.gap > 0)
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 2)
    .map((x) => CAT_LABEL[x.cat]);
  return {
    id: c.id, name: c.name, shortName: c.shortName, colors: c.colors, isUser: c.isUser, personality: c.personality,
    purse: c.purse, squad: sq.length, maxSquad: l.squadRules.maxSquad, overseas: sq.filter((p) => isOverseas(p, domesticOf(c))).length,
    maxOverseas: l.squadRules.maxOverseas, needs,
    retained: sq.filter((p) => p.contract?.acquired === 'retention' && p.contract.startSeason === w.season).map((p) => ({ id: p.id, name: p.name, salary: p.contract!.salary })),
  };
}

function squadNeedsText(w: WorldState, a: AuctionState): { text: string; gaps: { label: string; have: number; target: number }[]; contested: string[]; certainty: 'low' | 'medium' } {
  const l = leagueById(a.leagueId);
  const u = w.clubs[w.userClubId];
  const sq = squadOf(w, u);
  const tgt = roleTargets(l);
  const gaps = (Object.keys(tgt) as (keyof typeof tgt)[]).map((k) => ({ label: CAT_LABEL[k], have: sq.filter((p) => categoryOf(p) === k).length, target: tgt[k] }));
  const demand = roleDemand(w, a);
  const contested = Object.entries(demand).filter(([, d]) => d.clubs >= 3 && d.elitePool < d.clubs).map(([k, d]) => `${d.clubs} franchises are short of ${CAT_LABEL[k].toLowerCase()}, with ${d.elitePool} elite option${d.elitePool === 1 ? '' : 's'} left`);
  const deathBowler = sq.some((p) => p.bowlType !== 'NONE' && p.attrs.bowl.death >= 75);
  const openers = sq.filter((p) => p.styleTags.includes('opener') && overall(p) >= 72).length;
  const lines: string[] = [];
  if (sq.length) lines.push(`Your squad has ${openers || 'no'} established opener${openers === 1 ? '' : 's'}${deathBowler ? ' and a specialist death bowler' : ' but no specialist death bowler'}.`);
  else lines.push('You start with an empty squad: every role is open.');
  const worst = [...gaps].sort((x, y) => y.target - y.have - (x.target - x.have))[0];
  if (worst && worst.target > worst.have) lines.push(`Biggest gap: ${worst.label.toLowerCase()} (${worst.have}/${worst.target}).`);
  if (contested.length) lines.push(`${contested[0]}.`);
  const decided = a.lots.filter((x) => x.status === 'sold' || x.status === 'unsold').length;
  return { text: lines.join(' '), gaps, contested, certainty: decided < 10 ? 'low' : 'medium' };
}

/** Everything the live auction room renders. AI valuations are never included. */
export function auctionRoomView(w: WorldState, full = true) {
  const a = userAuctionOf(w);
  const cascade = w.auctionOrder.map((id) => ({ id, leagueId: w.auctions[id].leagueId, leagueName: leagueById(w.auctions[id].leagueId).name, status: w.auctions[id].status, interactive: w.auctions[id].interactive }));
  if (!a) return { phase: w.phase, cascade, auction: null };
  const l = leagueById(a.leagueId);
  const live = a.live;
  const user = w.clubs[w.userClubId];
  const lot = a.status === 'live' ? a.lots[a.currentLotIndex] ?? null : null;
  const scale = priceScale(l);
  let lotView = null;
  if (lot && live && live.phase !== 'ACCELERATED_SELECTION' && live.phase !== 'PREPARATION') {
    const p = w.players[lot.playerId];
    const next = nextBid(l, lot);
    const reg = registerCheck(w, user, p, l);
    const aff = canAfford(user.purse, next, user.squad.length, l.squadRules, l.auctionRules.minBase);
    const lead = leader(lot);
    const val = valuePlayer(w, a, user, p, a.currentLotIndex);
    const reserve = reserveNeeded(user.squad.length, l.squadRules, l.auctionRules.minBase);
    const alternatives = a.lots.slice(a.currentLotIndex + 1).filter((x) => x.status === 'pending' && categoryOf(w.players[x.playerId]) === categoryOf(p)).slice(0, 3)
      .map((x) => ({ playerId: x.playerId, name: w.players[x.playerId].name, ovr: Math.round(overall(w.players[x.playerId])), basePrice: x.basePrice }));
    const cat = categoryOf(p);
    const have = squadOf(w, user).filter((x) => categoryOf(x) === cat).length;
    lotView = {
      id: lot.id, set: lot.set, round: lot.round, basePrice: lot.basePrice, status: lot.status, userOut: !!lot.userOut, flagged: !!lot.flaggedByUser,
      player: playerView(w, p, { detail: true }),
      bids: lot.bids.map((b) => ({ ...b, club: w.clubs[b.clubId].shortName, clubName: w.clubs[b.clubId].name, colors: w.clubs[b.clubId].colors })),
      leaderId: lead, current: lot.bids.length ? lot.bids[lot.bids.length - 1].amount : null,
      nextBid: next, increment: Math.round((next - (lot.bids.length ? lot.bids[lot.bids.length - 1].amount : next)) * 100) / 100,
      permitted: permittedBids(w, a),
      canBid: reg.ok && aff.ok && lead !== user.id && !lot.userOut && (live.phase === 'OPEN_FOR_BIDS' || live.phase === 'FINAL_CALL'),
      blockReason: lead === user.id ? 'You hold the highest bid.' : lot.userOut ? 'You passed on this player.' : !reg.ok ? reg.reason : !aff.ok ? aff.reason : null,
      activeBidders: live.bidders.filter((id) => !live.dropped.includes(id)),
      // Why rivals are in: observable facts only (squad needs, purse, overseas slots) — never their valuations.
      interest: live.bidders.filter((id) => !live.dropped.includes(id) && id !== w.userClubId).map((id) => {
        const c = w.clubs[id];
        const sq = squadOf(w, c);
        const have = sq.filter((x) => categoryOf(x) === cat).length;
        const target = roleTargets(l)[cat];
        const osLeft = l.squadRules.maxOverseas - sq.filter((x) => isOverseas(x, domesticOf(c))).length;
        const role = CAT_LABEL[cat].toLowerCase();
        const bits = [have < target ? `short of ${role} (${have}/${target})` : `already ${have} ${role}`, `${formatCr(c.purse)} left`];
        if (isOverseas(p, domesticOf(c))) bits.push(`${osLeft} overseas slot${osLeft === 1 ? '' : 's'} open`);
        return { clubId: id, short: c.shortName, reason: bits.join(' · ') };
      }),
      dropped: live.dropped,
      proxy: a.userProxy[lot.playerId] ?? null,
      strategy: {
        estimate: auctionEstimate(p, w.season, l),
        assistantMax: val.maxBid,
        assistantReason: val.reason,
        maxAffordable: Math.max(0, Math.round((user.purse - reserve) * 100) / 100),
        reserve,
        fit: `${CAT_LABEL[cat]}: you have ${have}, target ${roleTargets(l)[cat]}.${isOverseas(p, domesticOf(user)) ? ` Uses an overseas slot (${squadOf(w, user).filter((x) => isOverseas(x, domesticOf(user))).length}/${l.squadRules.maxOverseas}).` : ''}`,
        alternatives,
        age: ageOf(p, w.season),
      },
    };
  }
  const lastResult = live?.lastResult
    ? (() => {
        const r = live.lastResult!;
        const club = r.clubId ? w.clubs[r.clubId] : null;
        const sq = club ? squadOf(w, club) : [];
        const roles = { BAT: 0, WK: 0, AR: 0, BOWL: 0 } as Record<string, number>;
        for (const p of sq) roles[p.role]++;
        return { ...r, player: playerView(w, w.players[r.playerId]), clubName: club?.name ?? null, clubShort: club?.shortName ?? null, colors: club?.colors ?? null, isUser: !!club?.isUser, squadAfter: roles, squadSize: sq.length, purseAfter: club?.purse ?? null, diff: r.price !== null ? Math.round((r.price - r.estimate) * 100) / 100 : null };
      })()
    : null;
  const pool = a.lots.filter((x) => x.status === 'pending').length;
  const lobby = full && (!live || live.phase === 'PREPARATION')
    ? {
        date: w.day,
        poolSize: a.lots.length,
        unsoldPrevious: Object.values(w.players).filter((p) => !p.clubId && !p.retired && !p.isYouth && p.stats.career.matches > 0).length,
        rules: { ...l.squadRules, purse: l.auctionRules.purse, minBase: l.auctionRules.minBase, increments: l.auctionRules.increments.map((x) => ({ upTo: Number.isFinite(x.upTo) ? x.upTo : null, step: x.step })), timing: AUCTION_TIMING },
        overseasPool: a.lots.filter((x) => isOverseas(w.players[x.playerId], domesticOf(user))).length,
        countries: Object.entries(a.lots.reduce<Record<string, number>>((acc, x) => {
          const c = w.players[x.playerId].country;
          acc[c] = (acc[c] ?? 0) + 1;
          return acc;
        }, {})).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c, n]) => ({ country: COUNTRY_NAMES[c as keyof typeof COUNTRY_NAMES] ?? c, n })),
      }
    : null;
  return {
    phase: w.phase,
    cascade,
    auction: {
      id: a.id, leagueId: a.leagueId, leagueName: l.name, status: a.status, version: a.version,
      live: live ? { phase: live.phase, phaseMs: Math.max(0, Math.round(live.phaseMs)), paused: live.paused, outbid: live.outbid, watching: live.userWatching, clock: live.clock, clockSetting: live.clockScale === 0.7 ? 'brisk' : live.clockScale === 1.5 ? 'relaxed' : 'standard' } : null,
      lotNumber: a.currentLotIndex + 1, totalLots: a.lots.length, remaining: pool,
      lot: lotView,
      lastResult,
      commentary: (live?.commentary ?? []).slice(-14).reverse(),
      clubs: clubsInLeague(w, l.id).map((c) => clubCard(w, a, c.id)),
      needs: squadNeedsText(w, a),
      lobby,
      accelerated: live?.accelerated ? {
        selected: live.accelerated.selected,
        candidates: live.accelerated.candidates.map((pid) => playerView(w, w.players[pid])),
      } : null,
      queue: !full ? null : a.lots.slice(a.currentLotIndex + 1).filter((x) => x.status === 'pending').slice(0, 120).map((x) => ({
        lotId: x.id, set: x.set, basePrice: x.basePrice, round: x.round, flagged: !!x.flaggedByUser, proxy: a.userProxy[x.playerId] ?? null, player: playerView(w, w.players[x.playerId]),
      })),
      results: (live?.results ?? []).slice(-60).reverse().map((r) => ({ ...r, name: w.players[r.playerId].name, role: w.players[r.playerId].role, club: r.clubId ? w.clubs[r.clubId].shortName : null })),
    },
  };
}

/** Full results presentation once the user's auction is complete. */
export function auctionSummary(w: WorldState) {
  const a = userAuctionOf(w);
  if (!a) return null;
  const l = leagueById(a.leagueId);
  const scale = priceScale(l);
  const sold = a.lots.filter((x) => x.status === 'sold');
  const est = (pid: string) => auctionEstimate(w.players[pid], w.season, l);
  const clubs = clubsInLeague(w, l.id).map((c) => {
    const sq = squadOf(w, c);
    const signings = sold.filter((x) => x.soldTo === c.id).map((x) => ({ playerId: x.playerId, name: w.players[x.playerId].name, role: w.players[x.playerId].role, price: x.price!, estimate: est(x.playerId) }));
    const os = sq.filter((p) => isOverseas(p, domesticOf(c)));
    const nat: Record<string, number> = {};
    for (const p of os) nat[p.country] = (nat[p.country] ?? 0) + 1;
    const tgt = roleTargets(l);
    const balance = (Object.keys(tgt) as (keyof typeof tgt)[]).map((k) => ({ label: CAT_LABEL[k], have: sq.filter((p) => categoryOf(p) === k).length, target: tgt[k] }));
    const xi = sq.length >= 11 ? pickXI(sq, l.squadRules, domesticOf(c)) : sq;
    const strength = xi.length ? xi.reduce((s, p) => s + overall(p), 0) / xi.length : 0;
    const bestCat = (Object.keys(tgt) as (keyof typeof tgt)[]).map((k) => ({ k, avg: avg(sq.filter((p) => categoryOf(p) === k).map(overall)) })).sort((x, y) => y.avg - x.avg);
    return {
      id: c.id, name: c.name, shortName: c.shortName, colors: c.colors, isUser: c.isUser, purse: c.purse, squad: sq.length, vacancies: l.squadRules.maxSquad - sq.length,
      overseas: os.length, nationalities: nat, signings, spent: Math.round(signings.reduce((s, x) => s + x.price, 0) * 100) / 100, balance,
      strength: Math.round(strength * 10) / 10, strongest: CAT_LABEL[bestCat[0]?.k] ?? '—', weakest: CAT_LABEL[bestCat.filter((x) => x.avg > 0).slice(-1)[0]?.k] ?? '—',
    };
  }).sort((x, y) => y.strength - x.strength);
  const allSigned = sold.map((x) => ({ playerId: x.playerId, name: w.players[x.playerId].name, club: w.clubs[x.soldTo!].shortName, price: x.price!, estimate: est(x.playerId), bids: x.bids.length }));
  return {
    leagueName: l.name, status: a.status, clubs,
    mostExpensive: [...allSigned].sort((x, y) => y.price - x.price).slice(0, 8),
    bestValue: [...allSigned].filter((x) => overall(w.players[x.playerId]) >= 65).sort((x, y) => y.estimate - y.price - (x.estimate - x.price)).slice(0, 8),
    biggestContests: [...allSigned].sort((x, y) => y.bids - x.bids).slice(0, 6),
    unsold: a.lots.filter((x) => x.status === 'unsold' && !w.players[x.playerId].clubId).map((x) => ({ playerId: x.playerId, name: w.players[x.playerId].name, role: w.players[x.playerId].role, basePrice: x.basePrice })),
    audit: auditLeague(w, a.leagueId),
  };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export type { Player };
