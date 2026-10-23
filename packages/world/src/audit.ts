import type { WorldState } from '@kurciv/domain';
import { isOverseas } from '@kurciv/domain';
import { domesticOf, leagueById } from '@kurciv/config';
import { clubsInLeague, round2, squadOf } from './util';

export interface ClubAudit {
  clubId: string;
  name: string;
  purseStart: number;
  retentions: number;
  auction: number;
  otherSignings: number;
  purseNow: number;
  purseExpected: number;
  squad: number;
  overseas: number;
  issues: string[];
}

/**
 * Financial and squad audit for one league, from the transaction ledger and the league's own
 * rules (nothing IPL-specific). Every purse must reconcile exactly with the season's
 * transactions; every squad must respect size, overseas and per-country limits; no player may
 * be registered twice.
 */
export function auditLeague(w: WorldState, leagueId: string, opts: { requireMinimum?: boolean } = {}): { clubs: ClubAudit[]; issues: string[]; ok: boolean } {
  const l = leagueById(leagueId);
  const r = l.squadRules;
  const seen = new Map<string, string>();
  const issues: string[] = [];
  const clubs = clubsInLeague(w, leagueId).map((c) => {
    const tx = w.ledger.filter((t) => t.season === w.season && t.toClubId === c.id);
    const retentions = round2(tx.filter((t) => t.kind === 'retention').reduce((s, t) => s + t.fee, 0));
    const auction = round2(tx.filter((t) => t.kind === 'auction').reduce((s, t) => s + t.fee, 0));
    const otherSignings = round2(tx.filter((t) => t.kind === 'free-agent' || t.kind === 'replacement').reduce((s, t) => s + t.fee, 0));
    const purseStart = l.auctionRules.purse;
    const purseExpected = round2(purseStart - retentions - auction - otherSignings);
    const squad = squadOf(w, c);
    const os = squad.filter((p) => isOverseas(p, domesticOf(c)));
    const byCountry: Record<string, number> = {};
    for (const p of os) byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
    const ci: string[] = [];
    if (c.purse < -0.001) ci.push(`Purse is negative (${c.purse.toFixed(2)} Cr).`);
    if (Math.abs(c.purse - purseExpected) > 0.011) ci.push(`Purse ${c.purse.toFixed(2)} Cr does not reconcile with transactions (${purseExpected.toFixed(2)} Cr expected).`);
    if (squad.length > r.maxSquad) ci.push(`Squad of ${squad.length} exceeds the maximum of ${r.maxSquad}.`);
    if (opts.requireMinimum && squad.length < r.minSquad) ci.push(`Squad of ${squad.length} is below the minimum of ${r.minSquad}.`);
    if (os.length > r.maxOverseas) ci.push(`${os.length} overseas players (maximum ${r.maxOverseas}).`);
    for (const [country, n] of Object.entries(byCountry)) if (n > r.maxPerOverseasCountry) ci.push(`${n} overseas players from ${country} (maximum ${r.maxPerOverseasCountry}).`);
    for (const p of squad) {
      if (p.retired) ci.push(`${p.name} is retired but registered.`);
      if (p.clubId !== c.id) ci.push(`${p.name} is listed in the squad but registered elsewhere.`);
      const other = seen.get(p.id);
      if (other) issues.push(`${p.name} is registered to both ${w.clubs[other].shortName} and ${c.shortName}.`);
      seen.set(p.id, c.id);
    }
    return { clubId: c.id, name: c.name, purseStart, retentions, auction, otherSignings, purseNow: c.purse, purseExpected, squad: squad.length, overseas: os.length, issues: ci };
  });
  for (const c of clubs) issues.push(...c.issues.map((i) => `${c.name}: ${i}`));
  return { clubs, issues, ok: issues.length === 0 };
}
