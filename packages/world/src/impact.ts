import type { Fixture, MatchImpact, StandingSnapshot, WorldState } from '@kurciv/domain';
import { nrr, sortRows } from './competition';

/**
 * Captures what one of the user's matches changed, at the moment the result is applied. The
 * Post-Match Centre reads this snapshot instead of recalculating anything later, so a report
 * reopened weeks afterwards shows the consequences as they were, not as they are now.
 */
export interface ImpactDraft {
  standings: StandingSnapshot | null;
  players: Map<string, { form: number; fatigue: number; morale: number; injured: boolean }>;
  timelineLen: number;
  newsTopId: string | null;
}

function standingOf(w: WorldState, fx: Fixture, clubId: string): StandingSnapshot | null {
  const comp = w.competitions[fx.competitionId];
  const rows = comp?.standings[fx.group ?? 'main'];
  if (!rows || (fx.stage !== 'League' && !fx.group)) return null;
  const sorted = sortRows(rows);
  const i = sorted.findIndex((r) => r.clubId === clubId);
  if (i < 0) return null;
  const r = sorted[i];
  return { position: r.played ? i + 1 : null, teams: sorted.length, points: r.points, played: r.played, nrr: Math.round(nrr(r) * 1000) / 1000 };
}

export function beginImpact(w: WorldState, fx: Fixture): ImpactDraft | null {
  if (!fx.involvesUser) return null;
  const u = w.clubs[w.userClubId];
  const players = new Map<string, { form: number; fatigue: number; morale: number; injured: boolean }>();
  for (const pid of u.squad) {
    const p = w.players[pid];
    if (p) players.set(pid, { form: p.form, fatigue: p.fatigue, morale: p.morale, injured: !!p.injury });
  }
  return { standings: standingOf(w, fx, u.id), players, timelineLen: w.timeline.length, newsTopId: w.news[0]?.id ?? null };
}

export function completeImpact(w: WorldState, fx: Fixture, draft: ImpactDraft, xi: Set<string>) {
  const u = w.clubs[w.userClubId];
  const after = standingOf(w, fx, u.id);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const players: MatchImpact['players'] = [];
  for (const [pid, b] of draft.players) {
    const p = w.players[pid];
    if (!p) continue;
    const newInjury = p.injury && !b.injured ? p.injury : null;
    players.push({
      id: pid, name: p.name, played: xi.has(pid),
      form: [b.form, p.form], fatigue: [r1(b.fatigue), r1(p.fatigue)], morale: [r1(b.morale), r1(p.morale)],
      injury: newInjury ? newInjury.type : null, injuryDays: newInjury ? Math.ceil(newInjury.daysRemaining) : null,
    });
  }
  const news: MatchImpact['news'] = [];
  for (const n of w.news) {
    if (n.id === draft.newsTopId) break;
    if (n.sourceRef === fx.id) news.push({ headline: n.headline, body: n.body });
  }
  const records: string[] = [];
  const rec = w.records;
  const name = (id: string) => w.players[id]?.name ?? id;
  if (rec.highestTeamTotal?.fixtureId === fx.id) records.push(`Highest team total in Kurciv history: ${rec.highestTeamTotal.runs} (${w.clubs[rec.highestTeamTotal.clubId].name}).`);
  if (rec.lowestTeamTotal?.fixtureId === fx.id) records.push(`Lowest all-out total in Kurciv history: ${rec.lowestTeamTotal.runs} (${w.clubs[rec.lowestTeamTotal.clubId].name}).`);
  if (rec.highestScore?.fixtureId === fx.id) records.push(`Highest individual score in Kurciv history: ${rec.highestScore.runs} by ${name(rec.highestScore.playerId)}.`);
  if (rec.bestBowling?.fixtureId === fx.id) records.push(`Best bowling figures in Kurciv history: ${rec.bestBowling.wickets}/${rec.bestBowling.runs} by ${name(rec.bestBowling.playerId)}.`);
  w.matchImpacts[fx.id] = {
    fixtureId: fx.id, season: w.season, clubId: u.id,
    standings: draft.standings && after ? { before: draft.standings, after } : null,
    players,
    timeline: w.timeline.slice(draft.timelineLen).map((t) => ({ title: t.title, detail: t.detail })),
    news: news.reverse(),
    records,
    odds: null,
  };
}

/** Keeps the snapshot store bounded: the current and two previous seasons. */
export function pruneImpacts(w: WorldState) {
  for (const [id, m] of Object.entries(w.matchImpacts)) if (m.season < w.season - 2) delete w.matchImpacts[id];
}
