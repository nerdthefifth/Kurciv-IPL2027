import type { MatchState, Side } from './types';

/**
 * Player-of-the-Match contribution model. Each player's score combines what they did with bat,
 * ball and in the field, plus their share of the win-probability swing on the deliveries they
 * were involved in (which captures match situation: a 30 in a collapse is worth more than a 30
 * in a stroll). Weights are configurable; the defaults are tuned so that neither runs nor
 * wickets alone decide the award.
 */
export interface AwardWeights {
  /** Points per run scored. */
  run: number;
  /** Strike-rate bonus: points per run, per 100 strike-rate points above `parStrikeRate`. */
  strikeRate: number;
  parStrikeRate: number;
  /** Per wicket taken (excluding run-outs). */
  wicket: number;
  /** Extra per top-order (positions 1–4) wicket. */
  topOrderWicket: number;
  /** Points per run per over saved against `parEconomy`, scaled by overs bowled. */
  economy: number;
  parEconomy: number;
  dot: number;
  catch: number;
  stumping: number;
  runOut: number;
  droppedCatch: number;
  /** Points per 1.00 of win probability added for the player's side. */
  winImpact: number;
  /** Bonus for being on the winning side. */
  winningSide: number;
}

export const DEFAULT_AWARD_WEIGHTS: AwardWeights = {
  run: 1,
  strikeRate: 0.25,
  parStrikeRate: 130,
  wicket: 20,
  topOrderWicket: 4,
  economy: 3,
  parEconomy: 8.5,
  dot: 0.4,
  catch: 6,
  stumping: 8,
  runOut: 9,
  droppedCatch: -5,
  winImpact: 55,
  winningSide: 30,
};

export interface Contribution {
  playerId: string;
  side: Side;
  batting: number;
  bowling: number;
  fielding: number;
  impact: number;
  /** Win probability added for the player's side, summed over involved deliveries (−1..1). */
  winAdded: number;
  total: number;
}

export function contributions(s: MatchState, weights: AwardWeights = DEFAULT_AWARD_WEIGHTS): Contribution[] {
  const map = new Map<string, Contribution>();
  const sideOf = (id: string): Side => (s.setup.home.xi.some((p) => p.id === id) ? 'home' : 'away');
  const get = (id: string) => {
    let c = map.get(id);
    if (!c) map.set(id, (c = { playerId: id, side: sideOf(id), batting: 0, bowling: 0, fielding: 0, impact: 0, winAdded: 0, total: 0 }));
    return c;
  };
  for (const p of [...s.setup.home.xi, ...s.setup.away.xi]) get(p.id);

  for (const inn of s.innings) {
    if (inn.superOver) continue;
    for (const b of Object.values(inn.batters)) {
      const c = get(b.playerId);
      const sr = b.balls ? (b.runs / b.balls) * 100 : 0;
      c.batting += b.runs * weights.run + (b.balls >= 6 ? ((sr - weights.parStrikeRate) / 100) * b.runs * weights.strikeRate : 0);
    }
    const position = new Map(inn.order.map((id, i) => [id, i]));
    for (const bw of Object.values(inn.bowlers)) {
      const c = get(bw.playerId);
      const overs = bw.balls / 6;
      const econ = bw.balls ? bw.runs / overs : weights.parEconomy;
      c.bowling += bw.dots * weights.dot + (bw.balls >= 6 ? (weights.parEconomy - econ) * overs * weights.economy * 0.25 : 0);
    }
    for (const d of s.deliveries) {
      if (d.innings !== inn.index || !d.wicket) continue;
      if (d.wicket.kind !== 'run out' && d.wicket.bowlerId) {
        get(d.wicket.bowlerId).bowling += weights.wicket + ((position.get(d.wicket.playerOutId) ?? 10) < 4 ? weights.topOrderWicket : 0);
      }
      if (d.wicket.fielderId) {
        const k = d.wicket.kind;
        get(d.wicket.fielderId).fielding += k === 'stumped' ? weights.stumping : k === 'run out' ? weights.runOut : k === 'caught' || k === 'caught behind' ? weights.catch : 0;
      }
    }
  }
  for (const d of s.deliveries) {
    if (s.innings[d.innings]?.superOver) continue;
    if (d.chance && !d.chance.taken) get(d.chance.fielderId).fielding += weights.droppedCatch;
  }

  // Win-probability added: batter and bowler share each delivery's swing.
  let prev = 0.5;
  for (const d of s.deliveries) {
    const inn = s.innings[d.innings];
    // A delivery without a recorded probability (should not happen) contributes nothing.
    const wp = Number.isFinite(d.winProbHome) ? d.winProbHome : prev;
    const delta = wp - prev;
    prev = wp;
    if (!inn || inn.superOver) continue;
    const forBatting = inn.battingSide === 'home' ? delta : -delta;
    get(d.strikerId).winAdded += forBatting;
    if (d.wicket?.kind === 'run out' && d.wicket.fielderId) get(d.wicket.fielderId).winAdded -= forBatting;
    else get(d.bowlerId).winAdded -= forBatting;
  }

  const winner = s.result?.winner ?? null;
  for (const c of map.values()) {
    c.impact = c.winAdded * weights.winImpact;
    c.total = c.batting + c.bowling + c.fielding + c.impact + (winner && c.side === winner ? weights.winningSide : 0);
    for (const k of ['batting', 'bowling', 'fielding', 'impact', 'winAdded', 'total'] as const) c[k] = Math.round(c[k] * 100) / 100;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.playerId.localeCompare(b.playerId));
}

/** The award goes to the highest contribution; ties broken by player id for determinism. */
export function choosePlayerOfMatch(s: MatchState, weights: AwardWeights = DEFAULT_AWARD_WEIGHTS): string | null {
  return contributions(s, weights)[0]?.playerId ?? null;
}
