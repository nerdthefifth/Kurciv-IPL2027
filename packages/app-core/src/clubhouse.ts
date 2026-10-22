import type { Fixture, WorldState } from '@kurciv/domain';
import { ageOf, overall } from '@kurciv/domain';
import { leagueById, venueById } from '@kurciv/config';
import { Rng } from '@kurciv/simulation';
import { nextUserFixture, nrr, sortRows, squadOf, squadProblems } from '@kurciv/world';
import { userAuctionOf } from './auction-view';
import { inboxCounts } from './clubworld-views';
import { clubView, fixtureView } from './views';

function formOf(w: WorldState, clubId: string, n = 5): ('W' | 'L' | 'T')[] {
  return Object.values(w.fixtures)
    .filter((f) => f.status === 'complete' && f.result && (f.homeId === clubId || f.awayId === clubId) && f.season === w.season)
    .sort((a, b) => b.day - a.day)
    .slice(0, n)
    .map((f) => (f.result!.winnerId === clubId ? 'W' : f.result!.winnerId ? 'L' : 'T'));
}

/** A short preview written from standings, form, head-to-head and player form — never invented. */
export function fixturePreview(w: WorldState, fx: Fixture): { stakes: string; lines: string[] } {
  const u = w.clubs[w.userClubId];
  const oppId = fx.homeId === u.id ? fx.awayId : fx.homeId;
  const opp = w.clubs[oppId];
  const lines: string[] = [];
  const comp = w.competitions[fx.competitionId];
  let stakes = fx.stage;
  if (comp?.kind === 'league' && fx.stage === 'League') {
    const rows = sortRows(comp.standings.main);
    const me = rows.findIndex((r) => r.clubId === u.id);
    const them = rows.findIndex((r) => r.clubId === oppId);
    if (me >= 0 && them >= 0 && rows[me].played + rows[them].played > 0) {
      lines.push(`${u.shortName} sit ${me + 1}${ord(me + 1)} on ${rows[me].points} points; ${opp.shortName} are ${them + 1}${ord(them + 1)} on ${rows[them].points}.`);
      const cut = leagueById(u.leagueId).playoffs === 'final2' ? 2 : 4;
      if (Math.abs(me - them) <= 2 && Math.min(me, them) < cut + 2) stakes = 'A direct rival in the playoff race';
    }
  } else if (fx.stage === 'Final') stakes = 'Winner takes the title';
  else if (fx.stage !== 'League') stakes = `${fx.stage} — lose and you are out`;
  const mf = formOf(w, u.id);
  const of = formOf(w, oppId);
  if (mf.length) lines.push(`Your recent form: ${mf.join(' ')}. ${opp.shortName}: ${of.join(' ') || 'no games yet'}.`);
  const key = [u.id, oppId].sort().join('|');
  const rv = w.rivalries[key];
  if (rv && rv.meetings >= 2) lines.push(`Head-to-head: ${rv.record[u.id] ?? 0}–${rv.record[oppId] ?? 0} in ${rv.meetings} meetings${rv.knockoutMeetings ? `, ${rv.knockoutMeetings} in knockouts` : ''}.`);
  const hot = squadOf(w, opp).filter((p) => !p.injury).sort((a, b) => b.form - a.form)[0];
  if (hot && hot.form >= 3) lines.push(`Watch ${hot.name}: in form (+${hot.form}) for ${opp.shortName}.`);
  const mine = squadOf(w, u).filter((p) => !p.injury).sort((a, b) => b.form - a.form)[0];
  if (mine && mine.form >= 3) lines.push(`${mine.name} arrives in form for you (+${mine.form}).`);
  const venue = venueById(fx.venueId || w.clubs[fx.homeId].venueId);
  lines.push(`${venue.name}: a ${venue.pitch.kind} surface${venue.dewChance >= 0.4 ? ', dew likely in the evening' : ''}.`);
  return { stakes, lines };
}

/**
 * Chance of finishing inside the playoff places, estimated by playing out the remaining league
 * fixtures 400 times with Elo win probabilities. Clearly an estimate; deterministic per day.
 */
export function qualificationOdds(w: WorldState): { playoffs: number; wcc: number } | null {
  const u = w.clubs[w.userClubId];
  const l = leagueById(u.leagueId);
  const comp = w.competitions[`${l.id}-${w.season}`];
  if (!comp || comp.stage !== 'league') return null;
  const remaining = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id && f.stage === 'League' && f.status !== 'complete');
  const base = comp.standings.main.map((r) => ({ id: r.clubId, pts: r.points, nrr: nrr(r) }));
  const cut = l.playoffs === 'final2' ? 2 : l.playoffs === 'none' ? 1 : 4;
  const slots = Math.max(1, w.leagues[l.id].wccSlots);
  const rng = Rng.from(`${w.seed}|odds|${w.season}|${w.day}`);
  let inPlayoffs = 0;
  let inWcc = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const pts = new Map(base.map((b) => [b.id, b.pts]));
    for (const f of remaining) {
      const pa = 1 / (1 + Math.pow(10, (w.clubs[f.awayId].elo - w.clubs[f.homeId].elo) / 400));
      const win = rng.chance(pa) ? f.homeId : f.awayId;
      pts.set(win, (pts.get(win) ?? 0) + 2);
    }
    const order = [...pts.entries()].sort((a, b) => b[1] - a[1] || (base.find((x) => x.id === b[0])!.nrr - base.find((x) => x.id === a[0])!.nrr) || rng.next() - 0.5);
    const pos = order.findIndex(([id]) => id === u.id);
    if (pos < cut) inPlayoffs++;
    if (pos < slots) inWcc++;
  }
  return { playoffs: inPlayoffs / N, wcc: inWcc / N };
}

export function clubhouse(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const l = leagueById(u.leagueId);
  const squad = squadOf(w, u);
  const next = nextUserFixture(w);
  const comp = w.competitions[`${l.id}-${w.season}`];
  const rows = comp ? sortRows(comp.standings.main) : [];
  const me = rows.findIndex((r) => r.clubId === u.id);
  const decisions: { label: string; detail: string; page: string; urgency: 'high' | 'normal' }[] = [];
  const a = userAuctionOf(w);
  if (w.phase === 'retention') decisions.push({ label: 'Finalise your retentions', detail: `Keep up to ${l.squadRules.maxRetentions} players before the auction cascade.`, page: 'auction', urgency: 'high' });
  if (w.phase === 'auction' && a?.status === 'live') decisions.push({ label: a.live?.phase === 'PREPARATION' ? 'Prepare for the auction' : 'Return to the auction room', detail: `${a.lots.filter((x) => x.status === 'pending').length} lots remaining.`, page: 'auction', urgency: 'high' });
  const problems = squadProblems(w, u);
  if (w.phase === 'preseason' && problems.length) decisions.push({ label: 'Complete your squad', detail: problems[0], page: 'transfers', urgency: 'high' });
  if (w.phase === 'preseason' && !problems.length) decisions.push({ label: 'Start the season', detail: 'Your squad is registered. Set your XI and tactics, then begin.', page: '', urgency: 'normal' });
  if (next && next.day === w.day) decisions.push({ label: 'Match day', detail: `${fixtureView(w, next).homeName} v ${fixtureView(w, next).awayName} — pick your XI and play.`, page: 'match', urgency: 'high' });
  if (!u.lineup && squad.length >= 11 && (w.phase === 'season' || w.phase === 'preseason')) decisions.push({ label: 'Select your XI', detail: 'The assistant is picking the side. Set your own XI and batting order.', page: 'squad', urgency: 'normal' });
  const injured = squad.filter((p) => p.injury);
  if (u.lineup?.some((id) => w.players[id]?.injury)) decisions.push({ label: 'An injured player is in your XI', detail: 'Update the lineup before the next match.', page: 'squad', urgency: 'high' });
  const cwc = inboxCounts(w);
  if (cwc.actions) decisions.push({ label: `${cwc.actions} decision${cwc.actions === 1 ? '' : 's'} in your inbox`, detail: cwc.talks ? `${cwc.talks} player${cwc.talks === 1 ? ' is' : 's are'} waiting for a reply.` : 'Requests from the board, staff and media.', page: 'inbox', urgency: cwc.urgent ? 'high' : 'normal' });
  if (w.phase === 'offseason') decisions.push({ label: 'Read the season chronicle', detail: 'Then begin the off-season.', page: 'history', urgency: 'normal' });
  const odds = qualificationOdds(w);
  return {
    clubWorld: inboxCounts(w),
    season: w.season, day: w.day, phase: w.phase, managerName: w.managerName, difficulty: w.difficulty, settings: w.settings,
    club: clubView(w, u),
    nextChapter: next ? { fixture: fixtureView(w, next), ...fixturePreview(w, next), today: next.day === w.day } : null,
    dressingRoom: {
      injured: injured.map((p) => ({ id: p.id, name: p.name, injury: p.injury!.type, days: Math.ceil(p.injury!.daysRemaining) })),
      tired: squad.filter((p) => !p.injury && p.fatigue >= 65).map((p) => ({ id: p.id, name: p.name, fatigue: Math.round(p.fatigue) })),
      unhappy: squad.filter((p) => p.morale < 40 || p.transferRequest).map((p) => ({ id: p.id, name: p.name, morale: Math.round(p.morale) })),
      inForm: squad.filter((p) => p.form >= 3).sort((x, y) => y.form - x.form).slice(0, 3).map((p) => ({ id: p.id, name: p.name, form: p.form })),
      avgMorale: squad.length ? Math.round(squad.reduce((s, p) => s + p.morale, 0) / squad.length) : null,
      youngest: squad.filter((p) => ageOf(p, w.season) <= 21).length,
      squadSize: squad.length,
    },
    glance: {
      position: me >= 0 ? me + 1 : null, teams: rows.length, points: rows[me]?.points ?? null, played: rows[me]?.played ?? null,
      nrr: rows[me] ? nrr(rows[me]) : null, form: formOf(w, u.id), odds,
      objectives: u.board.objectives, confidence: Math.round(u.board.confidence),
      table: rows.slice(0, 10).map((r, i) => ({ pos: i + 1, clubId: r.clubId, short: w.clubs[r.clubId].shortName, name: w.clubs[r.clubId].name, colors: w.clubs[r.clubId].colors, points: r.points, played: r.played, isUser: r.clubId === u.id })),
    },
    stories: w.stories.filter((s) => s.status === 'active').slice(0, 6),
    timeline: [...w.timeline].reverse().slice(0, 12),
    world: w.news.filter((n) => !n.clubIds.includes(u.id) && n.importance >= 2).slice(0, 6),
    decisions,
    finance: { purse: u.purse, cash: u.cash },
    squadStrength: squad.length ? Math.round(squad.map(overall).sort((x, y) => y - x).slice(0, 11).reduce((a2, b) => a2 + b, 0) / Math.min(11, squad.length)) : null,
  };
}

function ord(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
