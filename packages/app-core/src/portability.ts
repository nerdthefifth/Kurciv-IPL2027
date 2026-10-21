import { z } from 'zod';
import type { WorldState } from '@kurciv/domain';
import { isOverseas } from '@kurciv/domain';
import { LEAGUES } from '@kurciv/config';
import { GAME_VERSION, SAVE_SCHEMA_VERSION, type CareerMeta, type MatchRow } from './persistence';

/**
 * Career export/import. Packages are plain data (never code), validated in stages:
 * structure → compatibility → entity references → roster rules, before anything is written.
 */

export interface CareerPackage {
  format: 'kurciv-career';
  gameVersion: string;
  schemaVersion: number;
  exportedAt: string;
  meta: CareerMeta;
  world: WorldState;
  records: MatchRow[];
}

export const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

const packageShape = z.object({
  format: z.literal('kurciv-career'),
  gameVersion: z.string(),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  meta: z.object({ id: z.string(), name: z.string(), managerName: z.string(), clubId: z.string(), season: z.number().int() }).passthrough(),
  world: z.object({
    careerId: z.string(), seed: z.string(), season: z.number().int(), day: z.number(), phase: z.enum(['retention', 'auction', 'preseason', 'season', 'wcc', 'offseason']),
    userClubId: z.string(), clubs: z.record(z.object({ id: z.string(), leagueId: z.string(), squad: z.array(z.string()) }).passthrough()),
    players: z.record(z.object({ id: z.string(), name: z.string(), country: z.string(), clubId: z.string().nullable() }).passthrough()),
    leagues: z.record(z.any()), fixtures: z.record(z.any()), competitions: z.record(z.any()), auctions: z.record(z.any()),
  }).passthrough(),
  records: z.array(z.object({ fixtureId: z.string(), season: z.number().int(), state: z.object({ seed: z.string() }).passthrough() }).passthrough()),
});

export function buildPackage(meta: CareerMeta, world: WorldState, records: MatchRow[]): CareerPackage {
  return { format: 'kurciv-career', gameVersion: GAME_VERSION, schemaVersion: SAVE_SCHEMA_VERSION, exportedAt: new Date().toISOString(), meta, world, records };
}

/** Upgrades older save schemas in place. Never discards data. */
export function migrateWorld(world: WorldState, from: number): WorldState {
  const w = world as WorldState & Record<string, unknown>;
  if (from < 2) {
    w.stories ??= [];
    w.timeline ??= [];
    w.chronicles ??= [];
    w.storyKeys ??= {};
    w.appearances ??= {};
  }
  w.schemaVersion = SAVE_SCHEMA_VERSION;
  return w;
}

export interface ImportCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: { managerName: string; clubName: string; season: number; phase: string; players: number; matches: number; exportedAt: string; gameVersion: string } | null;
  pkg: CareerPackage | null;
}

export function validatePackage(raw: unknown): ImportCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = packageShape.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: ['This file is not a Kurciv career backup.', ...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)], warnings, summary: null, pkg: null };
  }
  const pkg = raw as CareerPackage;
  if (pkg.schemaVersion > SAVE_SCHEMA_VERSION) {
    errors.push(`The backup was made by a newer version of Kurciv (save schema ${pkg.schemaVersion}; this game supports up to ${SAVE_SCHEMA_VERSION}).`);
  } else if (pkg.schemaVersion < SAVE_SCHEMA_VERSION) {
    warnings.push(`Older save format (schema ${pkg.schemaVersion}) — it will be upgraded on import.`);
  }
  const w = pkg.world;
  if (!w.clubs[w.userClubId]) errors.push('The managed club is missing from the save.');
  // Entity references and registration rules
  const seen = new Map<string, string>();
  for (const club of Object.values(w.clubs)) {
    const league = LEAGUES.find((l) => l.id === club.leagueId);
    if (!league) {
      errors.push(`Club ${club.name} belongs to an unknown league (${club.leagueId}).`);
      continue;
    }
    if (club.squad.length > league.squadRules.maxSquad) errors.push(`${club.name} has ${club.squad.length} registered players (maximum ${league.squadRules.maxSquad}).`);
    let overseas = 0;
    const byCountry: Record<string, number> = {};
    for (const pid of club.squad) {
      const p = w.players[pid];
      if (!p) {
        errors.push(`${club.name} references a missing player (${pid}).`);
        continue;
      }
      if (seen.has(pid)) errors.push(`${p.name} is registered to both ${seen.get(pid)} and ${club.name}.`);
      seen.set(pid, club.name);
      if (p.clubId !== club.id) errors.push(`${p.name}'s club does not match ${club.name}'s squad list.`);
      if (isOverseas(p, league.domesticCountries)) {
        overseas++;
        byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
      }
    }
    if (overseas > league.squadRules.maxOverseas) errors.push(`${club.name} has ${overseas} overseas players (maximum ${league.squadRules.maxOverseas}).`);
    for (const [c, n] of Object.entries(byCountry)) if (n > league.squadRules.maxPerOverseasCountry) errors.push(`${club.name} has ${n} overseas players from ${c}.`);
    if (errors.length > 20) break;
  }
  for (const p of Object.values(w.players)) {
    if (p.clubId && !w.clubs[p.clubId]?.squad.includes(p.id)) {
      errors.push(`${p.name} claims a club that does not list them.`);
      if (errors.length > 20) break;
    }
  }
  const club = w.clubs[w.userClubId];
  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 20),
    warnings,
    summary: { managerName: pkg.meta.managerName, clubName: club?.name ?? '?', season: w.season, phase: w.phase, players: Object.keys(w.players).length, matches: pkg.records.length, exportedAt: pkg.exportedAt, gameVersion: pkg.gameVersion },
    pkg: errors.length === 0 ? pkg : null,
  };
}

/** Cheap structural fingerprint used to verify a save after writing it. */
export function fingerprint(w: WorldState): string {
  const squads = Object.values(w.clubs).map((c) => `${c.id}:${c.squad.length}:${c.purse}`).join(',');
  const fx = Object.values(w.fixtures).filter((f) => f.status === 'complete').length;
  return `${w.season}|${w.day}|${w.phase}|${Object.keys(w.players).length}|${fx}|${w.ledger.length}|${squads.length}:${hashString(squads)}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
