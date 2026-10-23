import type { Club, Player, WorldState } from '@kurciv/domain';
import { ageOf, basePriceFor, canAfford, overall } from '@kurciv/domain';
import { exportAllowed, leagueById } from '@kurciv/config';
import { eligibleForLeague, fillSquadToMinimum, registerCheck, signPlayer } from './auction';
import { addNews, nextId, round2, squadOf } from './util';

/** Asking price for an unattached player: at least the league minimum, more for proven players. */
export function askingPrice(w: WorldState, p: Player, club: Club): number {
  const l = leagueById(club.leagueId);
  const scale = l.auctionRules.purse / 120;
  return round2(Math.max(l.auctionRules.minBase, basePriceFor(p, w.season, 0.2) * scale * 0.6));
}

export function freeAgentsFor(w: WorldState, club: Club): Player[] {
  const l = leagueById(club.leagueId);
  return Object.values(w.players)
    .filter((p) => eligibleForLeague(p, l) && ageOf(p, w.season) >= 16 && exportAllowed(p.country, club))
    .sort((a, b) => overall(b) - overall(a));
}

/** Signing windows: pre-season freely; in season only as replacements while the squad has room. */
export function signFreeAgent(w: WorldState, playerId: string): string | null {
  const club = w.clubs[w.userClubId];
  const l = leagueById(club.leagueId);
  const p = w.players[playerId];
  if (!p) return 'Unknown player.';
  if (w.phase === 'auction' || w.phase === 'retention') return 'Free-agent signings open after the auction.';
  if (w.phase === 'offseason') return 'The transfer window is closed until the new season’s auction completes.';
  if (!eligibleForLeague(p, l)) return p.clubId ? `${p.name} is under contract elsewhere.` : `${p.name} is not eligible to register in the ${l.shortName}.`;
  const squad = squadOf(w, club);
  const reg = registerCheck(w, club, p, l);
  if (!reg.ok) return reg.reason!;
  const price = askingPrice(w, p, club);
  if (price > club.purse + 1e-9) return `Asking price ₹${price.toFixed(2)} Cr exceeds your remaining purse ₹${club.purse.toFixed(2)} Cr.`;
  const aff = canAfford(club.purse, price, squad.length, { ...l.squadRules, minSquad: Math.min(l.squadRules.minSquad, squad.length + 1) }, l.auctionRules.minBase);
  if (!aff.ok) return aff.reason!;
  signPlayer(w, club, p, price, w.phase === 'preseason' ? 'free-agent' : 'replacement', l);
  addNews(w, { kind: 'auction', importance: 1, headline: `${club.name} sign ${p.name}`, body: `${p.name} joins on a ₹${price.toFixed(2)} Cr deal.`, clubIds: [club.id], playerIds: [p.id], sourceRef: `fa-${p.id}-${w.season}` });
  return null;
}

/** Releasing a player frees a registration slot; the purse is not refunded. */
export function releasePlayer(w: WorldState, playerId: string): string | null {
  const club = w.clubs[w.userClubId];
  const p = w.players[playerId];
  if (!club.squad.includes(playerId)) return 'Player is not in your squad.';
  if (w.phase === 'auction') return 'Squads are frozen during the auction.';
  club.squad = club.squad.filter((x) => x !== playerId);
  club.lineup = club.lineup?.filter((x) => x !== playerId) ?? null;
  p.clubId = null;
  p.contract = null;
  w.freeAgents.push(p.id);
  w.ledger.push({ id: nextId(w, 'tx'), season: w.season, day: w.day, playerId, fromClubId: club.id, toClubId: null, kind: 'release', fee: 0, note: 'Released by the club' });
  return null;
}

/** Fill the user's squad to the league minimum with the best value free agents (one click). */
export function autoFillUserSquad(w: WorldState): number {
  const club = w.clubs[w.userClubId];
  return fillSquadToMinimum(w, club, leagueById(club.leagueId));
}

/** AI clubs sign injury cover when they no longer have eleven fit players. */
export function aiInjuryCover(w: WorldState) {
  for (const c of Object.values(w.clubs)) {
    if (c.isUser) continue;
    const l = leagueById(c.leagueId);
    const fit = squadOf(w, c).filter((p) => !p.injury).length;
    if (fit >= 13 || c.squad.length >= l.squadRules.maxSquad) continue;
    const squad = squadOf(w, c);
    const pick = freeAgentsFor(w, c).find((p) => registerCheck(w, c, p, l).ok && askingPrice(w, p, c) <= c.purse);
    if (pick) signPlayer(w, c, pick, askingPrice(w, pick, c), 'replacement', l);
  }
}
