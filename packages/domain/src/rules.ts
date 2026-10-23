import type { CountryCode, Player, SquadRules } from './types';
import { canBowl } from './ratings';

export interface RuleCheck {
  ok: boolean;
  reason?: string;
  code?: 'SQUAD_FULL' | 'OVERSEAS_LIMIT' | 'COUNTRY_LIMIT' | 'PURSE' | 'ALREADY_CONTRACTED' | 'INJURED' | 'RETIRED' | 'RESERVE' | 'EXPORT';
}

export interface SquadComposition {
  size: number;
  overseas: number;
  byCountry: Record<string, number>;
  roles: Record<'BAT' | 'WK' | 'AR' | 'BOWL', number>;
  keepers: number;
  bowlers: number;
  pace: number;
  spin: number;
}

export function composition(players: Player[], domestic: CountryCode[]): SquadComposition {
  const c: SquadComposition = {
    size: players.length, overseas: 0, byCountry: {}, roles: { BAT: 0, WK: 0, AR: 0, BOWL: 0 }, keepers: 0, bowlers: 0, pace: 0, spin: 0,
  };
  for (const p of players) {
    if (!domestic.includes(p.country)) {
      c.overseas++;
      c.byCountry[p.country] = (c.byCountry[p.country] ?? 0) + 1;
    }
    c.roles[p.role]++;
    if (p.role === 'WK' || p.attrs.field.keeping >= 60) c.keepers++;
    if (canBowl(p)) {
      c.bowlers++;
      if (['OB', 'LB', 'SLA', 'SLC'].includes(p.bowlType)) c.spin++;
      else c.pace++;
    }
  }
  return c;
}

/**
 * Can `player` be added to a squad currently made of `squad`? Never silently bends a rule —
 * the returned reason is shown to the user verbatim.
 */
export function canRegister(squad: Player[], player: Player, rules: SquadRules, domestic: CountryCode[]): RuleCheck {
  if (player.retired) return { ok: false, code: 'RETIRED', reason: `${player.name} has retired.` };
  if (squad.length >= rules.maxSquad) {
    return { ok: false, code: 'SQUAD_FULL', reason: `Squad is full (${rules.maxSquad} registered players maximum).` };
  }
  if (!domestic.includes(player.country)) {
    const comp = composition(squad, domestic);
    if (comp.overseas >= rules.maxOverseas) {
      return { ok: false, code: 'OVERSEAS_LIMIT', reason: `Overseas limit reached (${rules.maxOverseas} maximum in the registered squad).` };
    }
    if ((comp.byCountry[player.country] ?? 0) >= rules.maxPerOverseasCountry) {
      return {
        ok: false,
        code: 'COUNTRY_LIMIT',
        reason: `Already ${rules.maxPerOverseasCountry} overseas players from ${player.country} (maximum ${rules.maxPerOverseasCountry} per overseas country).`,
      };
    }
  }
  return { ok: true };
}

/** Minimum spend a club must keep in reserve to fill its remaining minimum squad slots. */
export function reserveNeeded(squadSize: number, rules: SquadRules, minBase: number): number {
  const need = Math.max(0, rules.minSquad - squadSize - 1);
  return Math.round(need * minBase * 100) / 100;
}

export function canAfford(purse: number, price: number, squadSize: number, rules: SquadRules, minBase: number): RuleCheck {
  if (price > purse + 1e-9) return { ok: false, code: 'PURSE', reason: `Bid of ₹${price.toFixed(2)} Cr exceeds remaining purse ₹${purse.toFixed(2)} Cr.` };
  const reserve = reserveNeeded(squadSize, rules, minBase);
  if (purse - price < reserve - 1e-9) {
    return {
      ok: false,
      code: 'RESERVE',
      reason: `Bid would leave ₹${(purse - price).toFixed(2)} Cr, but ₹${reserve.toFixed(2)} Cr must be kept to reach the ${rules.minSquad}-player minimum squad.`,
    };
  }
  return { ok: true };
}

export interface XIValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateXI(xi: Player[], squadIds: string[], rules: SquadRules, domestic: CountryCode[]): XIValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (xi.length !== 11) errors.push(`Playing XI must have exactly 11 players (has ${xi.length}).`);
  const ids = new Set(xi.map((p) => p.id));
  if (ids.size !== xi.length) errors.push('A player appears twice in the XI.');
  for (const p of xi) {
    if (!squadIds.includes(p.id)) errors.push(`${p.name} is not in the registered squad.`);
    if (p.injury) errors.push(`${p.name} is injured (${p.injury.type}).`);
  }
  const overseas = xi.filter((p) => !domestic.includes(p.country)).length;
  if (overseas > rules.maxOverseasInXI) errors.push(`Too many overseas players in the XI (${overseas}/${rules.maxOverseasInXI}).`);
  const bowlers = xi.filter(canBowl).length;
  if (bowlers < 5) errors.push(`Need at least 5 bowling options to cover 20 overs (has ${bowlers}).`);
  if (!xi.some((p) => p.role === 'WK' || p.attrs.field.keeping >= 60)) warnings.push('No specialist wicketkeeper selected — keeping quality will suffer.');
  if (xi.some((p) => p.fatigue > 75)) warnings.push('Some selected players are heavily fatigued (higher injury risk, lower execution).');
  return { ok: errors.length === 0, errors, warnings };
}
