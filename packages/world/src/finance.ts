import type { Club, FinancialTransaction, WorldState } from '@kurciv/domain';
import { WORLD, leagueById } from '@kurciv/config';
import { nextId, round2 } from './util';

/**
 * Club operating finances. The auction purse (a league spending cap) and the club's cash
 * reserves are separate: auction fees come out of the purse AND are paid as salary from cash.
 */
export function recordTransaction(w: WorldState, clubId: string, category: FinancialTransaction['category'], amount: number, memo: string) {
  const list = (w.finances[clubId] ??= []);
  list.push({ id: nextId(w, 'ft'), season: w.season, day: w.day, category, amount: round2(amount), memo });
  if (category !== 'auction' && category !== 'retention') {
    w.clubs[clubId].cash = round2(w.clubs[clubId].cash + amount);
  }
}

export function payrollOf(w: WorldState, club: Club): number {
  return round2(club.squad.reduce((s, id) => s + (w.players[id]?.contract?.salary ?? 0), 0));
}

/** Pre-season income and committed costs. */
export function seasonStartFinances(w: WorldState) {
  for (const club of Object.values(w.clubs)) {
    const l = leagueById(club.leagueId);
    const rep = w.leagues[l.id].reputation;
    const scale = l.auctionRules.purse / 120;
    // Central rights and sponsorship scale with the league's economy (its purse) and reputation,
    // so a well-run club can afford a full-purse squad; brand and success add on top.
    const purse = l.auctionRules.purse;
    const sponsorship = purse * WORLD.finance.sponsorshipShare * (0.5 + club.brand / 100) * (0.6 + rep / 250);
    recordTransaction(w, club.id, 'sponsorship', sponsorship, `${w.season} sponsorship portfolio`);
    const broadcast = purse * WORLD.finance.broadcastShare * (0.7 + rep / 330);
    recordTransaction(w, club.id, 'broadcast', broadcast, `${l.shortName} central rights share`);
    recordTransaction(w, club.id, 'salary', -payrollOf(w, club), `${w.season} player salaries`);
    const staff = club.coaches.reduce((s, c) => s + c.salary, 0);
    recordTransaction(w, club.id, 'staff', -staff, 'Coaching staff');
    const fac = club.facilities;
    const upkeep = (fac.training + fac.youth + fac.medical + fac.scouting) * WORLD.finance.facilityUpkeep * (scale * 0.8 + 0.1);
    recordTransaction(w, club.id, 'facility', -upkeep, 'Facility upkeep');
  }
}

export function matchdayIncome(w: WorldState, homeClubId: string, importance: number) {
  const club = w.clubs[homeClubId];
  const l = leagueById(club.leagueId);
  const scale = l.auctionRules.purse / 120;
  const tickets = WORLD.finance.ticketPerHomeMatch * (0.3 + club.fanBase / 100) * (0.4 + l.audience / 120) * (1 + importance) * (scale * 2 + 0.3);
  recordTransaction(w, homeClubId, 'tickets', tickets, 'Home matchday');
  recordTransaction(w, homeClubId, 'merchandise', tickets * 0.25, 'Matchday merchandise');
}

export function upgradeFacility(w: WorldState, clubId: string, facility: keyof Club['facilities']): string | null {
  const club = w.clubs[clubId];
  const level = club.facilities[facility];
  if (level >= 5) return 'Already at maximum level.';
  const cost = WORLD.finance.facilityUpgradeCost[level] * (leagueById(club.leagueId).auctionRules.purse / 120 + 0.25);
  if (club.board.confidence < 30) return 'The board has frozen capital spending until results improve.';
  if (club.cash < cost) return `Upgrade costs ₹${cost.toFixed(2)} Cr; cash reserves are ₹${club.cash.toFixed(2)} Cr.`;
  recordTransaction(w, clubId, 'facility', -cost, `${facility} facility upgraded to level ${level + 1}`);
  club.facilities[facility] = level + 1;
  return null;
}

export function facilityUpgradeCost(w: WorldState, clubId: string, facility: keyof Club['facilities']): number | null {
  const club = w.clubs[clubId];
  const level = club.facilities[facility];
  if (level >= 5) return null;
  return round2(WORLD.finance.facilityUpgradeCost[level] * (leagueById(club.leagueId).auctionRules.purse / 120 + 0.25));
}

export function financeSummary(w: WorldState, clubId: string, season = w.season) {
  const tx = (w.finances[clubId] ?? []).filter((t) => t.season === season);
  const by: Record<string, number> = {};
  for (const t of tx) by[t.category] = round2((by[t.category] ?? 0) + t.amount);
  const income = round2(tx.filter((t) => t.amount > 0 && t.category !== 'auction').reduce((s, t) => s + t.amount, 0));
  const expense = round2(tx.filter((t) => t.amount < 0 && t.category !== 'auction' && t.category !== 'retention').reduce((s, t) => s + t.amount, 0));
  return { byCategory: by, income, expense, net: round2(income + expense), cash: w.clubs[clubId].cash, purse: w.clubs[clubId].purse, transactions: tx };
}
