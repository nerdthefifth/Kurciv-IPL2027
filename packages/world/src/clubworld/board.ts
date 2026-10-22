import type { BoardObjective, BoardProfile, Club, WorldEvent, WorldState } from '@kurciv/domain';
import { ageOf } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import { hash01, Rng } from '@kurciv/simulation';
import { sortRows } from '../competition';
import { clamp, squadOf } from '../util';
import { cw, emit, sendMessage, staff, subscribe, today } from './core';
import { makePromise } from './promises';

/**
 * The board as an employer. Its personality comes from the club (auction personality,
 * brand, fan base, finances), so a wealthy contender and a rebuilding club judge the
 * manager by different standards. Confidence moves gradually from results against
 * expectation, objective progress, finances and the dressing room; dismissal follows a
 * published rule at the season review, never a single result.
 */

export function boardOf(w: WorldState, club: Club): BoardProfile {
  const boards = cw(w).boards;
  let b = boards[club.id];
  if (!b) {
    const j = (k: string) => (hash01(`${w.seed}|board|${club.id}|${k}`) - 0.5) * 14;
    const style: BoardProfile['style'] =
      club.personality === 'star-commercial' ? 'commercial'
        : club.personality === 'aggressive-contender' ? 'trophy-chasers'
          : club.personality === 'youth-builder' || club.personality === 'rebuilding' ? 'developmental'
            : club.brand >= 72 ? 'trophy-chasers' : 'sustainable';
    const base = { 'trophy-chasers': [35, 65, 40, 85, 60, 35], commercial: [45, 60, 50, 65, 85, 40], sustainable: [62, 35, 80, 55, 45, 50], developmental: [72, 45, 60, 45, 40, 85] }[style];
    b = boards[club.id] = {
      clubId: club.id, style,
      patience: Math.round(clamp(base[0] + j('p'), 10, 95)),
      riskTolerance: Math.round(clamp(base[1] + j('r'), 10, 95)),
      financialFocus: Math.round(clamp(base[2] + j('f'), 10, 95)),
      sportingAmbition: Math.round(clamp(base[3] + (club.brand - 60) * 0.2 + j('s'), 10, 98)),
      commercialExpectation: Math.round(clamp(base[4] + (club.fanBase - 60) * 0.2 + j('c'), 10, 98)),
      youthFocus: Math.round(clamp(base[5] + j('y'), 10, 95)),
      recruitment: style === 'commercial' ? 'stars' : style === 'sustainable' ? 'value' : style === 'developmental' ? 'youth' : 'balanced',
      appointed: today(w), history: [], negotiated: {}, reviews: [],
    };
  }
  return b;
}

export const STYLE_LABEL: Record<BoardProfile['style'], string> = {
  'trophy-chasers': 'Trophy-driven owners', commercial: 'Commercially minded owners', sustainable: 'Financially cautious owners', developmental: 'Development-focused owners',
};

export function band(confidence: number): { id: string; label: string } {
  if (confidence >= 70) return { id: 'secure', label: 'Secure' };
  if (confidence >= 50) return { id: 'stable', label: 'Stable' };
  if (confidence >= 35) return { id: 'review', label: 'Under review' };
  if (confidence >= 20) return { id: 'risk', label: 'At risk' };
  return { id: 'critical', label: 'Critical' };
}

/** Confidence below which a second consecutive warning at the season review ends the job. */
export function dismissalThreshold(b: BoardProfile): number {
  return Math.round(10 + (60 - b.patience) / 5);
}

export function changeConfidence(w: WorldState, club: Club, delta: number, reason: string) {
  if (!delta) return;
  const b = boardOf(w, club);
  const before = club.board.confidence;
  club.board.confidence = clamp(Math.round((before + delta) * 10) / 10, 0, 100);
  b.history.push({ ...today(w), confidence: Math.round(club.board.confidence), delta: Math.round(delta * 10) / 10, reason });
  if (b.history.length > 120) b.history.splice(0, b.history.length - 120);
  const from = band(before);
  const to = band(club.board.confidence);
  if (from.id !== to.id && club.isUser) {
    emit(w, {
      type: 'BOARD_CONFIDENCE_CHANGED', key: `board-band-${club.id}-${w.season}-${w.day}-${to.id}`, source: `board:${club.id}`, importance: to.id === 'risk' || to.id === 'critical' ? 2 : 1,
      refs: { clubIds: [club.id] }, data: { from: from.id, to: to.id, label: to.label, confidence: Math.round(club.board.confidence), reason, falling: club.board.confidence < before },
    });
  }
}

export interface ObjectiveProgress {
  id: string;
  description: string;
  importance: BoardObjective['importance'];
  status: BoardObjective['status'];
  current: string;
  outlook: 'met' | 'failed' | 'on-track' | 'behind' | 'pending';
  negotiable: boolean;
}

/** Live progress of each objective, from the actual table, fixtures, squad and accounts. */
export function objectiveProgress(w: WorldState, club: Club): ObjectiveProgress[] {
  const l = leagueById(club.leagueId);
  const comp = w.competitions[`${l.id}-${w.season}`];
  const rows = comp ? sortRows(comp.standings.main) : [];
  const pos = rows.findIndex((r) => r.clubId === club.id) + 1;
  const played = rows.find((r) => r.clubId === club.id)?.played ?? 0;
  const b = boardOf(w, club);
  return club.board.objectives.map((o) => {
    let current = '';
    let outlook: ObjectiveProgress['outlook'] = o.status === 'met' ? 'met' : o.status === 'failed' ? 'failed' : 'pending';
    if (o.status === 'pending') {
      if (o.kind === 'league-position' || o.kind === 'playoffs' || o.kind === 'title') {
        const target = o.kind === 'playoffs' ? (l.playoffs === 'final2' ? 2 : 4) : o.kind === 'title' ? 1 : o.target;
        current = pos ? `Currently ${pos}${['th', 'st', 'nd', 'rd'][pos % 10 > 3 || [11, 12, 13].includes(pos % 100) ? 0 : pos % 10]} after ${played} matches` : 'Season not started';
        if (!played) current = 'Season not started';
        outlook = !played ? 'pending' : pos <= target ? 'on-track' : 'behind';
      } else if (o.kind === 'youth-debuts') {
        const n = squadOf(w, club).filter((p) => ageOf(p, w.season) <= 23 && (p.stats.seasons[`${w.season}:${comp?.id}`]?.matches ?? 0) > 0).length;
        current = `${n} player${n === 1 ? '' : 's'} aged 23 or under used`;
        outlook = n > 0 ? 'on-track' : played ? 'behind' : 'pending';
      } else if (o.kind === 'finance') {
        current = `Cash ${club.cash.toFixed(1)} Cr`;
        outlook = club.cash >= 0 ? 'on-track' : 'behind';
      } else if (o.kind === 'wcc-qualify') {
        current = pos ? `Table position ${pos}` : 'Season not started';
        outlook = pos && pos <= w.leagues[l.id].wccSlots ? 'on-track' : played ? 'behind' : 'pending';
      }
    }
    const negotiable = club.isUser && o.status === 'pending' && o.kind === 'league-position' && b.negotiated[o.id] === undefined
      && club.board.confidence >= 35 && played <= Math.max(3, (rows.length - 1) * l.rounds * 0.5) && o.target < rows.length;
    return { id: o.id, description: o.description, importance: o.importance, status: o.status, current, outlook, negotiable };
  });
}

/** Ask the board for a more realistic league target (once per objective, at a confidence cost). */
export function negotiateObjective(w: WorldState, objectiveId: string): string | null {
  const club = w.clubs[w.userClubId];
  const o = club.board.objectives.find((x) => x.id === objectiveId);
  const prog = objectiveProgress(w, club).find((x) => x.id === objectiveId);
  if (!o || !prog) return 'Objective not found.';
  if (!prog.negotiable) return 'The board will not reopen this objective now.';
  const b = boardOf(w, club);
  const rng = Rng.from(`${w.seed}|negotiate|${o.id}`);
  b.negotiated[o.id] = w.season;
  const accepted = rng.chance(0.35 + b.patience / 200 + club.board.confidence / 400);
  if (accepted) {
    const before = o.target;
    o.target = o.target + 1;
    o.description = o.description.replace(`top ${before}`, `top ${o.target}`);
    changeConfidence(w, club, -4, 'Asked for a lower league target');
    emit(w, { type: 'BOARD_OBJECTIVE_UPDATED', key: `objective-${o.id}-${w.season}`, source: `objective:${o.id}`, refs: { clubIds: [club.id] }, data: { objectiveId: o.id, from: before, to: o.target, accepted: true } });
  } else {
    changeConfidence(w, club, -2, 'Objective renegotiation refused');
  }
  sendMessage(w, {
    eventId: null, from: staff(w, 'board'), category: 'board', priority: 'normal',
    subject: accepted ? 'Objective revised' : 'Objective unchanged',
    body: accepted ? `The board has agreed to revise the target: ${o.description} It has not gone unnoticed that you asked.` : `The board considered your request and will not change the objective: ${o.description}`,
    refs: { clubIds: [club.id] }, links: [{ label: 'Boardroom', page: 'board' }],
  });
  return null;
}

/** After each of the user's matches: a small, expectation-weighted move. */
function onMatch(w: WorldState, e: WorldEvent) {
  if (e.type !== 'MATCH_COMPLETED' || !e.data.userMatch) return;
  const u = w.clubs[w.userClubId];
  const b = boardOf(w, u);
  const expected = Number(e.data.userWinExpectation ?? 0.5);
  const actual = e.data.winnerId === u.id ? 1 : e.data.winnerId ? 0 : 0.5;
  const weight = (e.data.stage === 'League' ? 4 : 7) * (0.7 + b.sportingAmbition / 200);
  const delta = (actual - expected) * weight;
  const opp = String(e.data.opponentName ?? 'opponents');
  changeConfidence(w, u, delta, `${actual === 1 ? 'Win' : actual === 0 ? 'Defeat' : 'Tie'} v ${opp} (${Math.round(expected * 100)}% expected)`);
}

/** Weekly review: finances, dressing room and media pressure, filtered through the board's personality. */
export function boardWeekly(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const b = boardOf(w, u);
  const squad = squadOf(w, u);
  const morale = squad.length ? squad.reduce((s, p) => s + p.morale, 0) / squad.length : 60;
  let delta = 0;
  const why: string[] = [];
  if (u.cash < 0) {
    delta -= 1 + b.financialFocus / 50;
    why.push('club finances in the red');
  }
  if (morale < 40) {
    delta -= 1;
    why.push('an unhappy dressing room');
  } else if (morale > 70) {
    delta += 0.5;
    why.push('a happy dressing room');
  }
  const pressure = cw(w).media.pressure;
  if (pressure > 65) {
    delta -= (b.commercialExpectation / 100) * 1.5;
    why.push('negative media coverage');
  }
  if (delta) changeConfidence(w, u, delta * (1.2 - b.patience / 200), `Weekly review: ${why.join(', ')}`);
}

export function boardMidSeason(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const key = `board-mid-${w.season}`;
  if (cw(w).keys[key] !== undefined) return;
  cw(w).keys[key] = w.season;
  const prog = objectiveProgress(w, u);
  const behind = prog.filter((x) => x.outlook === 'behind').length;
  const b = boardOf(w, u);
  const score = Math.round(u.board.confidence);
  b.reviews.push({ ...today(w), kind: 'mid-season', score, verdict: band(score).label, lines: prog.map((x) => `${x.description} — ${x.current || x.outlook}`) });
  sendMessage(w, {
    eventId: null, from: staff(w, 'board'), category: 'board', priority: behind ? 'high' : 'normal',
    subject: `Mid-season review: ${band(score).label.toLowerCase()}`,
    body: [`Halfway through the season, the board has reviewed your work. Confidence: ${score}/100 (${band(score).label}).`, ...prog.map((x) => `• ${x.description} ${x.current ? `(${x.current})` : ''} — ${x.outlook === 'on-track' ? 'on track' : x.outlook}.`), behind ? 'We expect to see improvement in the second half.' : 'Keep it going.'].join('\n'),
    refs: { clubIds: [u.id] }, links: [{ label: 'Boardroom', page: 'board' }],
  });
}

/** After the existing season-end objective evaluation: the formal review message. */
export function boardSeasonReview(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const b = boardOf(w, u);
  const key = `board-season-${w.season}`;
  if (cw(w).keys[key] !== undefined) return;
  cw(w).keys[key] = w.season;
  const met = u.board.objectives.filter((o) => o.status === 'met');
  const failed = u.board.objectives.filter((o) => o.status === 'failed');
  const score = Math.round(u.board.confidence);
  const lines = [...met.map((o) => `Met: ${o.description}`), ...failed.map((o) => `Missed: ${o.description}`)];
  b.reviews.push({ ...today(w), kind: 'season', score, verdict: band(score).label, lines });
  b.history.push({ ...today(w), confidence: score, delta: 0, reason: `Season review: ${met.length} of ${u.board.objectives.length} objectives met` });
  const threshold = dismissalThreshold(b);
  const warning = u.board.warnings >= 1 && score < 35;
  sendMessage(w, {
    eventId: null, from: staff(w, 'board'), category: 'board', priority: warning ? 'urgent' : 'high',
    subject: `${w.season} season review: ${band(score).label.toLowerCase()}`,
    body: [
      `The board has completed its review of the ${w.season} season. Confidence: ${score}/100.`,
      ...lines.map((x) => `• ${x}`),
      warning
        ? `This is warning ${u.board.warnings}. If confidence is below ${threshold} at a season review with two warnings on record, the board will end your contract.`
        : 'Your position is not under threat.',
    ].join('\n'),
    refs: { clubIds: [u.id] }, links: [{ label: 'Boardroom', page: 'board' }],
  });
}

function onEvent(w: WorldState, e: WorldEvent) {
  const u = w.clubs[w.userClubId];
  switch (e.type) {
    case 'BOARD_CONFIDENCE_CHANGED': {
      if (!e.data.falling) return;
      const to = e.data.to as string;
      if (to !== 'review' && to !== 'risk' && to !== 'critical') return;
      // One letter per slide: no repeat while an earlier one is recent or unanswered.
      const recent = cw(w).inbox.find((m) => m.response?.kind === 'board-warning' && m.season === w.season && (w.day - m.day < 14 || !m.response.chosen));
      if (recent && to !== 'critical') return;
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'board'), category: 'board', priority: to === 'review' ? 'high' : 'urgent', delay: 1,
        subject: to === 'review' ? 'The board would like a word' : 'The board is losing patience',
        body: `Board confidence has fallen to ${e.data.confidence}/100 (${e.data.label}). Latest factor: ${e.data.reason}. The board wants to know how you intend to respond.`,
        refs: { clubIds: [u.id] }, links: [{ label: 'Boardroom', page: 'board' }],
        response: {
          kind: 'board-warning', required: true, deadline: { season: w.season, day: w.day + 4 },
          options: [
            { id: 'commit', label: 'Commit to three wins in the next five matches', hint: 'A tracked promise to the board: kept +8, broken −10.' },
            { id: 'patience', label: 'Ask for patience while the squad develops', hint: 'Works with a patient board; costs credibility otherwise.' },
            { id: 'accept', label: 'Accept the criticism', hint: 'No change.' },
          ],
        },
      });
      break;
    }
    case 'PROMISE_FULFILLED':
    case 'PROMISE_BROKEN': {
      if (e.data.kind !== 'board-results') return;
      changeConfidence(w, u, e.type === 'PROMISE_FULFILLED' ? 8 : -10, e.type === 'PROMISE_FULFILLED' ? 'Kept your commitment to the board' : 'Broke your commitment to the board');
      break;
    }
    case 'AUCTION_COMPLETED': {
      if (e.data.leagueId !== u.leagueId) return;
      const b = boardOf(w, u);
      const spent = Number(e.data.userSpent ?? 0);
      const biggest = Number(e.data.userBiggestFee ?? 0);
      const budget = Number(e.data.userBudget ?? 0) || 1;
      let delta = 0;
      let note = '';
      if (b.recruitment === 'stars' && biggest >= budget * 0.15) { delta = 3; note = 'The board approves of a marquee signing.'; }
      else if (b.recruitment === 'value' && biggest >= budget * 0.2) { delta = -3; note = `The board is uneasy that one player took ${Math.round((biggest / budget) * 100)}% of the budget.`; }
      else if (b.recruitment === 'youth' && Number(e.data.userYoungSignings ?? 0) >= 3) { delta = 2; note = 'The board welcomes the investment in young players.'; }
      else if (spent < budget * 0.6) { delta = b.financialFocus >= 60 ? 1 : -1; note = `You left ${(budget - spent).toFixed(1)} Cr unspent.`; }
      if (delta) changeConfidence(w, u, delta, 'Auction recruitment');
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'board'), category: 'auction', priority: 'normal', delay: 1,
        subject: 'The board on your auction',
        body: `You spent ${spent.toFixed(2)} Cr of ${budget.toFixed(2)} Cr${biggest ? `, with a top fee of ${biggest.toFixed(2)} Cr` : ''}. ${note || 'The board has no particular concerns.'}`,
        refs: { clubIds: [u.id] }, links: [{ label: 'Auction summary', page: 'auction' }],
      });
      break;
    }
    case 'SEASON_STARTED': {
      const b = boardOf(w, u);
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'board'), category: 'board', priority: 'high',
        subject: `${w.season} objectives`,
        body: [`${STYLE_LABEL[b.style]}: the board's expectations for ${w.season}.`, ...u.board.objectives.map((o) => `• ${o.description} (${o.importance} priority)`), `Patience ${b.patience}/100. Current confidence ${Math.round(u.board.confidence)}/100.`].join('\n'),
        refs: { clubIds: [u.id] }, links: [{ label: 'Boardroom', page: 'board' }],
      });
      break;
    }
    case 'MANAGER_APPOINTED': {
      const club = w.clubs[e.refs.clubIds[0]];
      if (!club?.isUser) return;
      const b = boardOf(w, club);
      b.appointed = today(w);
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'board'), category: 'board', priority: 'high',
        subject: `Welcome to ${club.name}`,
        body: `${STYLE_LABEL[b.style]} welcome ${w.managerName}. We value ${b.recruitment === 'stars' ? 'star power and visibility' : b.recruitment === 'value' ? 'value for money and a balanced budget' : b.recruitment === 'youth' ? 'developing young players' : 'a balanced, competitive squad'}. You will be judged over time, not on a single result.`,
        refs: { clubIds: [club.id] }, links: [{ label: 'Boardroom', page: 'board' }],
      });
      break;
    }
    default:
      break;
  }
}

export function respondToBoard(w: WorldState, optionId: string): string {
  const u = w.clubs[w.userClubId];
  const b = boardOf(w, u);
  if (optionId === 'commit') {
    makePromise(w, { to: { kind: 'board', id: u.id }, kind: 'board-results', name: u.name, conversationId: null, sourceEvent: `board-${u.id}` });
    changeConfidence(w, u, 2, 'Committed to an improvement target');
    return 'Promise made to the board: win three of the next five.';
  }
  if (optionId === 'patience') {
    const rng = Rng.from(`${w.seed}|patience|${w.season}|${w.day}`);
    const ok = rng.chance(b.patience / 100 - cw(w).promises.filter((p) => p.to.kind === 'board' && p.status === 'broken').length * 0.2);
    changeConfidence(w, u, ok ? 4 : -3, ok ? 'The board granted you time' : 'The board refused to wait');
    return ok ? 'The board agreed to give you time.' : 'The board was not persuaded.';
  }
  return 'Acknowledged.';
}

subscribe(onMatch);
subscribe(onEvent);
