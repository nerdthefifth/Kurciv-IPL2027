import type { Player, PlayerRelation, WorldState } from '@kurciv/domain';
import { ageOf, overall } from '@kurciv/domain';
import { hash01 } from '@kurciv/simulation';
import { clamp } from '../util';
import { cw } from './core';

/**
 * Communication profile of a player, derived once from the existing personality and mental
 * attributes (so nothing duplicates player data) and then carried forward: trust, confidence
 * and the history of what the manager said and did.
 */

const BASE: Record<Player['personality'], { ambition: number; loyalty: number; prof: number; trust: number }> = {
  ambitious: { ambition: 80, loyalty: 38, prof: 0, trust: 50 },
  temperamental: { ambition: 66, loyalty: 42, prof: -15, trust: 45 },
  professional: { ambition: 56, loyalty: 55, prof: 15, trust: 58 },
  loyal: { ambition: 42, loyalty: 82, prof: 5, trust: 64 },
  easygoing: { ambition: 36, loyalty: 62, prof: -2, trust: 60 },
};

export function relationOf(w: WorldState, p: Player): PlayerRelation {
  const rels = cw(w).relations;
  let r = rels[p.id];
  if (!r) {
    const b = BASE[p.personality];
    const j = (k: string) => (hash01(`${w.seed}|rel|${p.id}|${k}`) - 0.5) * 16;
    r = rels[p.id] = {
      playerId: p.id,
      trust: Math.round(clamp(b.trust + j('t'), 20, 90)),
      ambition: Math.round(clamp(b.ambition + (p.reputation - 50) * 0.2 + j('a'), 5, 98)),
      professionalism: Math.round(clamp(p.attrs.mental.workEthic * 0.6 + p.attrs.mental.temperament * 0.3 + b.prof + j('p'), 5, 98)),
      loyalty: Math.round(clamp(b.loyalty + j('l'), 5, 98)),
      confidence: Math.round(clamp(50 + p.form * 3 + (p.reputation - 50) * 0.3 + j('c'), 5, 95)),
      history: [],
      lastTalk: null,
    };
  }
  return r;
}

export function adjustRelation(w: WorldState, p: Player, d: { trust?: number; confidence?: number; morale?: number }) {
  const r = relationOf(w, p);
  if (d.trust) r.trust = Math.round(clamp(r.trust + d.trust, 0, 100));
  if (d.confidence) r.confidence = Math.round(clamp(r.confidence + d.confidence, 0, 100));
  if (d.morale) p.morale = clamp(Math.round((p.morale + d.morale) * 10) / 10, 0, 100);
}

export type SquadStanding = 'key' | 'regular' | 'rotation' | 'squad' | 'prospect';

/** What a player expects from their place in the squad, from their rank in it. */
export function standingOf(w: WorldState, p: Player): SquadStanding {
  const club = p.clubId ? w.clubs[p.clubId] : null;
  if (!club) return 'squad';
  const rank = club.squad.map((id) => w.players[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a)).findIndex((x) => x.id === p.id);
  if (rank < 0) return 'squad';
  if (rank < 5) return 'key';
  if (rank < 11) return 'regular';
  if (ageOf(p, w.season) <= 21) return 'prospect';
  return rank < 15 ? 'rotation' : 'squad';
}

export const STANDING_LABEL: Record<SquadStanding, string> = {
  key: 'Key player', regular: 'Regular starter', rotation: 'Rotation option', squad: 'Squad player', prospect: 'Prospect',
};

/** Broken promises to anyone in the last two seasons: the manager's credibility record. */
export function brokenPromises(w: WorldState, playerId?: string): number {
  return cw(w).promises.filter((x) => x.status === 'broken' && x.made.season >= w.season - 1 && (!playerId || x.to.id === playerId)).length;
}
