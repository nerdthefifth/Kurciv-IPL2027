import type { Club, Competition, Fixture, FriendlyPurpose, WorldState } from '@kurciv/domain';
import { PRESEASON, WORLD, leagueById, regionOf, stadiumById } from '@kurciv/config';
import { addNews, clamp, squadOf, worldRng } from '../util';
import { playersOnDuty } from './international';

/**
 * Preseason friendlies. The user arranges up to four (opponent, ground, date, purpose and how to
 * take part); AI clubs arrange their own. Friendlies never touch tables, count for a quarter of a
 * competitive match in reputation and a fifth in board confidence, and cost a little fitness in
 * exchange for match sharpness, cohesion and gate money.
 */

export const friendlyCompId = (season: number) => `FR-${season}`;

export function friendlyComp(w: WorldState): Competition {
  const id = friendlyCompId(w.season);
  return (w.competitions[id] ??= {
    id, kind: 'friendly', leagueId: null, season: w.season, name: `Preseason friendlies ${w.season}`, clubIds: [], standings: {}, stage: 'league', championId: null, runnerUpId: null,
  });
}

export interface FriendlyInput {
  opponentId: string;
  day: number;
  venue: 'home' | 'away' | 'neutral';
  neutralVenueId?: string;
  purpose: FriendlyPurpose;
  mode: 'play' | 'watch' | 'sim';
}

export interface FriendlyPreview {
  ok: boolean;
  reason: string | null;
  opponent: { id: string; name: string; division: string; acceptance: 'accepts' | 'declines'; why: string };
  venueId: string;
  venueName: string;
  effects: { label: string; value: string; tone: 'good' | 'bad' | 'neutral' }[];
  unavailable: { playerId: string; name: string; reason: string }[];
}

const PURPOSE_LABEL: Record<FriendlyPurpose, string> = {
  fitness: 'Match fitness', selection: 'Trial fringe players', tactics: 'Rehearse tactics', revenue: 'Gate money', youth: 'Blood academy graduates',
};

function clubMatchDays(w: WorldState, clubId: string): number[] {
  return Object.values(w.fixtures).filter((f) => f.season === w.season && (f.homeId === clubId || f.awayId === clubId)).map((f) => f.day);
}

function clash(w: WorldState, clubId: string, day: number): boolean {
  return clubMatchDays(w, clubId).some((d) => Math.abs(d - day) < PRESEASON.minGap);
}

/** Will the opponent accept? Clubs well above the user's level only accept when the gate is theirs. */
function acceptance(w: WorldState, user: Club, opp: Club, input: Pick<FriendlyInput, 'venue' | 'purpose'>): { ok: boolean; why: string } {
  const gap = (leagueById(user.leagueId).tier ?? 3) - (leagueById(opp.leagueId).tier ?? 3);
  const theirFriendlies = Object.values(w.fixtures).filter((f) => f.competitionId === friendlyCompId(w.season) && (f.homeId === opp.id || f.awayId === opp.id)).length;
  if (theirFriendlies >= PRESEASON.maxFriendlies) return { ok: false, why: `${opp.shortName} already have a full preseason programme.` };
  if (gap >= 2 && input.venue !== 'away') return { ok: false, why: `${opp.shortName} play two or more divisions higher and will only host.` };
  if (gap >= 3) return { ok: false, why: `${opp.shortName} see no benefit in facing a side three divisions below.` };
  return { ok: true, why: gap > 0 ? `${opp.shortName} accept a run-out against lower-division opposition.` : gap < 0 ? `${opp.shortName} welcome a test against a stronger side.` : `${opp.shortName} accept a like-for-like fixture.` };
}

function venueFor(w: WorldState, user: Club, opp: Club, input: Pick<FriendlyInput, 'venue' | 'neutralVenueId'>): string {
  if (input.venue === 'home') return user.venueId;
  if (input.venue === 'away') return opp.venueId;
  return input.neutralVenueId ?? user.venueId;
}

/** What the friendly would do, shown before the user confirms. */
export function previewFriendly(w: WorldState, input: FriendlyInput): FriendlyPreview {
  const user = w.clubs[w.userClubId];
  const opp = w.clubs[input.opponentId];
  const fail = (reason: string): FriendlyPreview => ({
    ok: false, reason, opponent: { id: input.opponentId, name: opp?.name ?? '?', division: opp ? leagueById(opp.leagueId).shortName : '', acceptance: 'declines', why: reason },
    venueId: '', venueName: '', effects: [], unavailable: [],
  });
  if (w.phase !== 'preseason') return fail('Friendlies can only be arranged in the preseason.');
  if (!opp || opp.id === user.id) return fail('Choose another club.');
  if (!Number.isInteger(input.day) || input.day < Math.max(w.day + 1, PRESEASON.firstDay) || input.day > PRESEASON.lastDay) return fail(`Pick a day between ${Math.max(w.day + 1, PRESEASON.firstDay)} and ${PRESEASON.lastDay}.`);
  const mine = Object.values(w.fixtures).filter((f) => f.competitionId === friendlyCompId(w.season) && (f.homeId === user.id || f.awayId === user.id)).length;
  if (mine >= PRESEASON.maxFriendlies) return fail(`You already have ${PRESEASON.maxFriendlies} friendlies arranged.`);
  if (clash(w, user.id, input.day)) return fail(`You need ${PRESEASON.minGap} days between matches.`);
  if (clash(w, opp.id, input.day)) return fail(`${opp.name} already play within ${PRESEASON.minGap} days of that date.`);
  let venueId: string;
  try {
    venueId = venueFor(w, user, opp, input);
    stadiumById(venueId);
  } catch {
    return fail('Unknown ground.');
  }
  const acc = acceptance(w, user, opp, input);
  const v = stadiumById(venueId);
  const squad = squadOf(w, user);
  const duty = playersOnDuty(w, input.day);
  const unavailable = squad.filter((p) => duty.has(p.id) || (p.injury && p.injury.daysRemaining > input.day - w.day)).map((p) => ({
    playerId: p.id, name: p.name, reason: duty.has(p.id) ? 'International duty' : `Injured (${p.injury!.type})`,
  }));
  const home = input.venue === 'home';
  const gate = home ? Math.round(WORLD.finance.ticketPerHomeMatch * (0.3 + user.fanBase / 100) * 0.45 * (leagueById(user.leagueId).auctionRules.purse / 120 * 2 + 0.3) * (input.purpose === 'revenue' ? 1.3 : 1) * 100) / 100 : 0;
  const tierGap = (leagueById(user.leagueId).tier ?? 3) - (leagueById(opp.leagueId).tier ?? 3);
  const effects: FriendlyPreview['effects'] = [
    { label: 'Fatigue', value: input.purpose === 'fitness' ? '+6 per player who plays (recovers in about a day)' : '+8 per player who plays', tone: 'bad' },
    { label: 'Match sharpness', value: input.purpose === 'fitness' ? 'Form +0.6 for the XI' : 'Form +0.3 for the XI', tone: 'good' },
    { label: 'Cohesion', value: input.purpose === 'tactics' ? 'Morale +2 for the XI' : 'Morale +1 for the XI', tone: 'good' },
    { label: 'Gate money', value: home ? `about ₹${gate.toFixed(2)} Cr` : 'none (away or neutral)', tone: home ? 'good' : 'neutral' },
    { label: 'Reputation', value: `counts ${Math.round(PRESEASON.reputationWeight * 100)}% of a competitive match${tierGap > 0 ? ' (a win over a higher-division side helps)' : ''}`, tone: 'neutral' },
    { label: 'Board confidence', value: `±${Math.round(PRESEASON.boardWeight * 5)} at most`, tone: 'neutral' },
  ];
  if (input.purpose === 'selection') effects.push({ label: 'Selection', value: 'The assistant picks fringe players over regulars', tone: 'neutral' });
  if (input.purpose === 'youth') effects.push({ label: 'Youth', value: 'Under-23 players are picked first; academy debuts count for the board', tone: 'good' });
  return {
    ok: acc.ok, reason: acc.ok ? null : acc.why,
    opponent: { id: opp.id, name: opp.name, division: leagueById(opp.leagueId).shortName, acceptance: acc.ok ? 'accepts' : 'declines', why: acc.why },
    venueId, venueName: `${v.name}, ${v.city}`, effects, unavailable,
  };
}

function scheduleFriendly(w: WorldState, homeId: string, awayId: string, day: number, venueId: string, purpose: FriendlyPurpose, mode: 'play' | 'watch' | 'sim', arrangedBy: string): Fixture {
  const comp = friendlyComp(w);
  const n = Object.values(w.fixtures).filter((f) => f.competitionId === comp.id).length + 1;
  const neutral = venueId !== w.clubs[homeId].venueId && venueId !== w.clubs[awayId].venueId;
  const involvesUser = homeId === w.userClubId || awayId === w.userClubId;
  const fx: Fixture = {
    id: `${comp.id}-M${n}`, competitionId: comp.id, season: w.season, day, stage: 'Friendly', homeId, awayId, venueId, status: 'scheduled', result: null,
    involvesUser, neutral, purpose, mode: involvesUser ? mode : 'sim',
  };
  w.fixtures[fx.id] = fx;
  for (const id of [homeId, awayId]) if (!comp.clubIds.includes(id)) comp.clubIds.push(id);
  w.universe?.friendlies.push({ fixtureId: fx.id, arrangedBy, opponentId: arrangedBy === homeId ? awayId : homeId, day, venueId, purpose, mode: fx.mode! });
  return fx;
}

export function arrangeFriendly(w: WorldState, input: FriendlyInput): { fixture: Fixture | null; error: string | null } {
  const pv = previewFriendly(w, input);
  if (!pv.ok) return { fixture: null, error: pv.reason };
  const user = w.clubs[w.userClubId];
  const home = input.venue === 'away' ? input.opponentId : user.id;
  const away = home === user.id ? input.opponentId : user.id;
  const fx = scheduleFriendly(w, home, away, input.day, pv.venueId, input.purpose, input.mode, user.id);
  addNews(w, {
    kind: 'board', importance: 1, headline: `Friendly arranged: ${w.clubs[home].shortName} v ${w.clubs[away].shortName}`,
    body: `Day ${input.day} at ${pv.venueName}. Purpose: ${PURPOSE_LABEL[input.purpose]}.`, clubIds: [user.id, input.opponentId], playerIds: [], sourceRef: fx.id,
  });
  return { fixture: fx, error: null };
}

export function cancelFriendly(w: WorldState, fixtureId: string): string | null {
  const fx = w.fixtures[fixtureId];
  if (!fx || fx.competitionId !== friendlyCompId(w.season)) return 'Unknown friendly.';
  if (!fx.involvesUser) return 'That is not your friendly.';
  if (fx.status !== 'scheduled') return 'That friendly has already been played.';
  delete w.fixtures[fixtureId];
  if (w.universe) w.universe.friendlies = w.universe.friendlies.filter((f) => f.fixtureId !== fixtureId);
  return null;
}

/** AI clubs arrange one or two friendlies each, mostly within their region, on free dates. */
export function arrangeAiFriendlies(w: WorldState) {
  if (Object.values(w.fixtures).some((f) => f.competitionId === friendlyCompId(w.season) && !f.involvesUser)) return;
  const rng = worldRng(w, 'friendlies');
  const clubs = Object.values(w.clubs).filter((c) => !c.isUser).sort((a, b) => a.id.localeCompare(b.id));
  const purposes: FriendlyPurpose[] = ['fitness', 'selection', 'tactics', 'revenue', 'youth'];
  const count = (id: string) => Object.values(w.fixtures).filter((f) => f.competitionId === friendlyCompId(w.season) && (f.homeId === id || f.awayId === id)).length;
  for (const c of clubs) {
    const want = rng.int(PRESEASON.aiFriendlies[0], PRESEASON.aiFriendlies[1]);
    let guard = 0;
    while (count(c.id) < want && guard++ < 12) {
      const tier = leagueById(c.leagueId).tier ?? 3;
      const options = clubs.filter((o) => o.id !== c.id && !o.isUser && Math.abs((leagueById(o.leagueId).tier ?? 3) - tier) <= 1 && count(o.id) < 2 && regionOf(o.country) === regionOf(c.country));
      const opp = options.length ? rng.pick(options) : null;
      if (!opp) break;
      const day = rng.int(PRESEASON.firstDay + 4, PRESEASON.lastDay);
      if (clash(w, c.id, day) || clash(w, opp.id, day)) continue;
      const home = rng.chance(0.5) ? c : opp;
      scheduleFriendly(w, home.id, home === c ? opp.id : c.id, day, home.venueId, rng.pick(purposes), 'sim', c.id);
    }
  }
}

/** After a friendly: small, bounded effects (reputation and board confidence at reduced weight). */
export function applyFriendlyEffects(w: WorldState, fx: Fixture, winnerId: string | null) {
  for (const id of [fx.homeId, fx.awayId]) {
    const c = w.clubs[id];
    const won = winnerId === id;
    const lost = winnerId !== null && !won;
    const oppTier = leagueById(w.clubs[id === fx.homeId ? fx.awayId : fx.homeId].leagueId).tier ?? 3;
    const tierGap = (leagueById(c.leagueId).tier ?? 3) - oppTier;
    const repDelta = (won ? 0.6 + Math.max(0, tierGap) * 0.4 : lost ? -0.4 : 0) * PRESEASON.reputationWeight * 4;
    c.brand = clamp(Math.round((c.brand + repDelta) * 10) / 10, 0, 100);
    c.board.confidence = clamp(Math.round(c.board.confidence + (won ? 5 : lost ? -5 : 0) * PRESEASON.boardWeight), 0, 100);
  }
}
