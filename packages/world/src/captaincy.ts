import type { Club, Player, WorldState } from '@kurciv/domain';
import { overall } from '@kurciv/domain';
import { domesticOf, leagueById } from '@kurciv/config';
import { pickXI } from '@kurciv/ai';
import { cw, sendMessage, staff } from './clubworld/core';
import { clamp, squadOf } from './util';

/**
 * Captaincy. Every club names a captain and vice-captain each season. AI clubs choose by
 * leadership, standing and likelihood of playing; the user is asked at the start of each
 * season (the assistant's suggestion stands until they choose). The captain leads whenever
 * they play, otherwise the vice-captain does, and their leadership sharpens the side's
 * on-field decisions slightly.
 */

const leaderScore = (p: Player, inXI: boolean) => p.attrs.mental.leadership * 0.7 + p.reputation * 0.2 + overall(p) * 0.1 + (inXI ? 8 : 0) - (p.injury ? 30 : 0);

/** The two best leadership candidates in the squad, preferring regular starters. */
export function suggestLeaders(w: WorldState, club: Club): { captainId: string | null; viceCaptainId: string | null } {
  const squad = squadOf(w, club);
  if (!squad.length) return { captainId: null, viceCaptainId: null };
  const l = leagueById(club.leagueId);
  const xi = new Set(squad.length >= 11 ? pickXI(squad, l.squadRules, domesticOf(club)).map((p) => p.id) : squad.map((p) => p.id));
  const ranked = [...squad].sort((a, b) => leaderScore(b, xi.has(b.id)) - leaderScore(a, xi.has(a.id)) || a.id.localeCompare(b.id));
  return { captainId: ranked[0]?.id ?? null, viceCaptainId: ranked[1]?.id ?? null };
}

/** Makes sure every club has leaders for the current season (idempotent). */
export function ensureCaptaincy(w: WorldState) {
  for (const club of Object.values(w.clubs)) {
    const c = club.captaincy;
    const stale = !c || c.season < w.season || !club.squad.includes(c.captainId ?? '') || !club.squad.includes(c.viceCaptainId ?? '');
    if (!stale) continue;
    const s = suggestLeaders(w, club);
    // Keep a sitting captain who is still at the club; fill gaps from the suggestion.
    const keepC = c?.captainId && club.squad.includes(c.captainId) ? c.captainId : null;
    const keepV = c?.viceCaptainId && club.squad.includes(c.viceCaptainId) && c.viceCaptainId !== keepC ? c.viceCaptainId : null;
    const captainId = keepC ?? s.captainId;
    const viceCaptainId = keepV ?? (s.captainId !== captainId ? s.captainId : s.viceCaptainId);
    club.captaincy = { season: w.season, captainId, viceCaptainId: viceCaptainId !== captainId ? viceCaptainId : s.viceCaptainId, confirmed: !club.isUser };
    if (club.isUser) {
      const key = `captaincy-${w.season}-${club.id}`;
      if (cw(w).keys[key] === undefined) {
        cw(w).keys[key] = w.season;
        const cap = captainId ? w.players[captainId] : null;
        const vc = club.captaincy.viceCaptainId ? w.players[club.captaincy.viceCaptainId] : null;
        sendMessage(w, {
          eventId: null, from: staff(w, 'board'), category: 'board', priority: 'high',
          subject: `Name your ${w.season} captain`,
          body: `Before the ${w.season} season the club needs a captain and vice-captain. Your assistant suggests ${cap?.name ?? '—'} as captain and ${vc?.name ?? '—'} as vice-captain. Confirm or change them on the Squad page.`,
          refs: { playerIds: [captainId, club.captaincy.viceCaptainId].filter(Boolean) as string[], clubIds: [club.id] }, links: [{ label: 'Choose leaders', page: 'squad' }],
        });
      }
    }
  }
}

export function setCaptaincy(w: WorldState, captainId: string, viceCaptainId: string): string | null {
  const club = w.clubs[w.userClubId];
  if (captainId === viceCaptainId) return 'The captain and vice-captain must be different players.';
  if (!club.squad.includes(captainId) || !club.squad.includes(viceCaptainId)) return 'Both leaders must be in your registered squad.';
  const before = club.captaincy;
  // Being given the armband lifts a player; losing it stings.
  const nudge = (id: string | null | undefined, d: number) => {
    const p = id ? w.players[id] : null;
    if (p) p.morale = clamp(p.morale + d, 0, 100);
  };
  if (before?.captainId !== captainId) {
    nudge(captainId, 6);
    if (before?.captainId && before.captainId !== viceCaptainId && before.confirmed) nudge(before.captainId, -6);
  }
  if (before?.viceCaptainId !== viceCaptainId && viceCaptainId !== before?.captainId) nudge(viceCaptainId, 3);
  club.captaincy = { season: w.season, captainId, viceCaptainId, confirmed: true };
  return null;
}

/** Who leads a given XI: the captain if playing, else the vice-captain, else nobody named. */
export function matchCaptain(club: Club, xiIds: string[]): string | null {
  const c = club.captaincy;
  if (c?.captainId && xiIds.includes(c.captainId)) return c.captainId;
  if (c?.viceCaptainId && xiIds.includes(c.viceCaptainId)) return c.viceCaptainId;
  return null;
}

/** Captain's leadership as a tactical-quality adjustment (about ±0.08). */
export function leadershipEdge(w: WorldState, club: Club): number {
  const id = club.captaincy?.captainId;
  const p = id ? w.players[id] : null;
  return p ? (p.attrs.mental.leadership - 60) / 400 : 0;
}

// ------------------------------------------------------------------ Orange and Purple Caps

export interface CapRow {
  playerId: string;
  name: string;
  clubId: string | null;
  clubShort: string;
  matches: number;
  runs: number;
  balls: number;
  average: number | null;
  strikeRate: number | null;
  highScore: number;
  wickets: number;
  economy: number | null;
  best: string | null;
}

/** Live Orange Cap (runs) and Purple Cap (wickets) races for one competition this season. */
export function capRaces(w: WorldState, competitionId: string, limit = 10): { orange: CapRow[]; purple: CapRow[] } {
  const key = `${w.season}:${competitionId}`;
  const rows: CapRow[] = [];
  for (const p of Object.values(w.players)) {
    const s = p.stats.seasons[key];
    if (!s || !s.matches) continue;
    const club = p.clubId ? w.clubs[p.clubId] : null;
    const outs = s.innings - s.notOuts;
    rows.push({
      playerId: p.id, name: p.name, clubId: p.clubId, clubShort: club?.shortName ?? '—', matches: s.matches,
      runs: s.runs, balls: s.balls, average: outs ? Math.round((s.runs / outs) * 10) / 10 : null, strikeRate: s.balls ? Math.round((s.runs / s.balls) * 1000) / 10 : null, highScore: s.highScore,
      wickets: s.wickets, economy: s.ballsBowled ? Math.round((s.runsConceded / s.ballsBowled) * 60) / 10 : null,
      best: s.bestWkts ? `${s.bestWkts}/${s.bestRuns}` : null,
    });
  }
  const orange = rows.filter((r) => r.runs > 0).sort((a, b) => b.runs - a.runs || (b.strikeRate ?? 0) - (a.strikeRate ?? 0) || a.playerId.localeCompare(b.playerId)).slice(0, limit);
  const purple = rows.filter((r) => r.wickets > 0).sort((a, b) => b.wickets - a.wickets || (a.economy ?? 99) - (b.economy ?? 99) || a.playerId.localeCompare(b.playerId)).slice(0, limit);
  return { orange, purple };
}

/** Current cap holders for every competition this season (for badges). */
export function capHolders(w: WorldState): Record<string, { orange: string | null; purple: string | null }> {
  const out: Record<string, { orange: string | null; purple: string | null }> = {};
  for (const comp of Object.values(w.competitions)) {
    if (comp.season !== w.season) continue;
    const r = capRaces(w, comp.id, 1);
    out[comp.id] = { orange: r.orange[0]?.playerId ?? null, purple: r.purple[0]?.playerId ?? null };
  }
  return out;
}
