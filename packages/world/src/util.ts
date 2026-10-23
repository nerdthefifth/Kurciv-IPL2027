import type { Club, LeagueConfig, NewsItem, Player, WorldState } from '@kurciv/domain';
import { DIVISIONS, LEAGUES, leagueById } from '@kurciv/config';
import { Rng } from '@kurciv/simulation';

export function nextId(w: WorldState, prefix: string): string {
  w.counter += 1;
  return `${prefix}-${w.counter.toString(36)}`;
}

/** Deterministic random stream for a named world event (same seed + label → same draws). */
export function worldRng(w: WorldState, label: string): Rng {
  return Rng.from(`${w.seed}|${w.season}|${label}`);
}

export function leagueOf(w: WorldState, club: Club): LeagueConfig {
  return leagueById(club.leagueId);
}

/** The competitions clubs belong to: pyramid divisions (new careers) or national leagues (older saves). */
export function activeLeagues(w: WorldState): LeagueConfig[] {
  return w.worldModel === 'pyramid' ? DIVISIONS : LEAGUES;
}

export const isPyramid = (w: WorldState) => w.worldModel === 'pyramid';

export function squadOf(w: WorldState, club: Club): Player[] {
  return club.squad.map((id) => w.players[id]).filter(Boolean);
}

export function userClub(w: WorldState): Club {
  return w.clubs[w.userClubId];
}

export function clubsInLeague(w: WorldState, leagueId: string): Club[] {
  return Object.values(w.clubs).filter((c) => c.leagueId === leagueId).sort((a, b) => a.id.localeCompare(b.id));
}

export function addNews(w: WorldState, item: Omit<NewsItem, 'id' | 'season' | 'day'>): NewsItem {
  const n: NewsItem = { id: nextId(w, 'n'), season: w.season, day: w.day, ...item };
  w.news.unshift(n);
  if (w.news.length > 400) w.news.length = 400;
  return n;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function formatCr(v: number): string {
  return `₹${v.toFixed(2)} Cr`;
}
