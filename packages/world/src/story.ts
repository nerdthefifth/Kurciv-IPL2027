import type { Club, Fixture, Player, SeasonChronicle, Story, StoryAction, TimelineEntry, WorldState } from '@kurciv/domain';
import { ageOf, overall, validateXI } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import { pickXI } from '@kurciv/ai';
import type { MatchState } from '@kurciv/simulation';
import { categoryOf, roleTargets } from './auction';
import { finishingOrder, sortRows } from './competition';
import { nextId, squadOf } from './util';

/**
 * Narrative layer. Every story and timeline entry is produced by a concrete game event and
 * names it in `trigger` / `refs`. Stories never invent facts: an injury story needs an
 * injury object, a milestone needs the statistics, a rivalry needs recorded meetings.
 * The simulation is never adjusted to make a better story.
 */

// ------------------------------------------------------------------ timeline

export function addTimeline(w: WorldState, kind: TimelineEntry['kind'], title: string, detail: string, refs: string[] = []): TimelineEntry {
  const e: TimelineEntry = { id: nextId(w, 'tl'), season: w.season, day: w.day, kind, title, detail, refs };
  w.timeline.push(e);
  if (w.timeline.length > 3000) w.timeline.splice(0, w.timeline.length - 3000);
  return e;
}

// ------------------------------------------------------------------ stories

function addStory(w: WorldState, key: string, s: Omit<Story, 'id' | 'season' | 'day' | 'status'>): Story | null {
  if (w.storyKeys[key] !== undefined) return null;
  w.storyKeys[key] = w.season;
  const story: Story = { ...s, id: nextId(w, 'st'), season: w.season, day: w.day, status: 'active' };
  w.stories.unshift(story);
  // Keep the desk tidy: at most 8 open stories; old ones quietly resolve.
  const active = w.stories.filter((x) => x.status === 'active');
  for (const old of active.slice(8)) old.status = 'resolved';
  if (w.stories.length > 150) w.stories.length = 150;
  return story;
}

const he = (p: Player) => p.shortName; // stories name players rather than assume pronouns

function userClub(w: WorldState): Club {
  return w.clubs[w.userClubId];
}

function lastXI(w: WorldState): string[] {
  const fx = Object.values(w.fixtures)
    .filter((f) => f.involvesUser && f.status === 'complete' && f.result)
    .sort((a, b) => b.day - a.day)[0];
  if (!fx?.result) return userClub(w).lineup ?? [];
  const inn = fx.result.innings.find((i) => i.battingClubId === w.userClubId);
  const bowled = fx.result.innings.find((i) => i.battingClubId !== w.userClubId);
  const ids = new Set([...(inn?.batting.map((b) => b.playerId) ?? []), ...(bowled?.bowling.map((b) => b.playerId) ?? [])]);
  return [...ids];
}

/** The weakest current starter in the same role — the realistic person a newcomer would replace. */
function starterToReplace(w: WorldState, p: Player): Player | null {
  const xi = (userClub(w).lineup ?? lastXI(w)).map((id) => w.players[id]).filter(Boolean);
  const same = xi.filter((x) => categoryOf(x) === categoryOf(p) && x.id !== p.id).sort((a, b) => overall(a) - overall(b));
  return same[0] ?? null;
}

function userResults(w: WorldState): ('W' | 'L' | 'T')[] {
  return Object.values(w.fixtures)
    .filter((f) => f.involvesUser && f.status === 'complete' && f.result && f.season === w.season)
    .sort((a, b) => a.day - b.day)
    .map((f) => (f.result!.winnerId === w.userClubId ? 'W' : f.result!.winnerId ? 'L' : 'T'));
}

/** Called after every completed match involving the user's club. */
export function storiesAfterUserMatch(w: WorldState, fx: Fixture, s: MatchState) {
  const u = userClub(w);
  const side = fx.homeId === u.id ? 'home' : 'away';
  const oppId = side === 'home' ? fx.awayId : fx.homeId;
  const opp = w.clubs[oppId];
  const won = fx.result?.winnerId === u.id;
  const seen = (w.appearances[u.id] ??= []);

  for (const mp of s.setup[side].xi) {
    const p = w.players[mp.id];
    if (!p) continue;
    if (!seen.includes(p.id)) {
      seen.push(p.id);
      if (p.stats.career.matches === 1 && ageOf(p, w.season) <= 23) {
        addTimeline(w, 'debut', `${p.name} makes a debut`, `Age ${ageOf(p, w.season)}, against ${opp.name} (${fx.stage}).`, [p.id, fx.id]);
        addStory(w, `debut-${p.id}`, {
          kicker: 'A FIRST CAP',
          title: `${p.name} walks out for the first time`,
          body: `At ${ageOf(p, w.season)}, ${p.name} made a senior debut against ${opp.name}. The early weeks will shape whether ${he(p)} becomes a regular or heads back to development.`,
          severity: 'notable', playerIds: [p.id], clubIds: [u.id], trigger: fx.id,
          actions: [{ label: 'View development', kind: 'open-player', payload: { playerId: p.id } }, { label: 'Noted', kind: 'dismiss' }],
        });
      }
    }
    // Milestones crossed in this match (career figures after the match vs. this match's share).
    const bat = fx.result?.innings.flatMap((i) => i.batting).find((b) => b.playerId === p.id);
    const bowl = fx.result?.innings.flatMap((i) => i.bowling).find((b) => b.playerId === p.id);
    const runsAfter = p.stats.career.runs;
    const runsBefore = runsAfter - (bat?.runs ?? 0);
    const wkAfter = p.stats.career.wickets;
    const wkBefore = wkAfter - (bowl?.wickets ?? 0);
    const runMark = Math.floor(runsAfter / 500) * 500;
    if (runMark >= 500 && runsBefore < runMark) {
      addTimeline(w, 'milestone', `${p.name} passes ${runMark} Kurciv runs`, `Reached against ${opp.name}.`, [p.id, fx.id]);
      addStory(w, `runs-${p.id}-${runMark}`, {
        kicker: 'MILESTONE', title: `${runMark} runs for ${p.name}`, body: `${p.name} brought up ${runMark} career runs against ${opp.name}, averaging ${(runsAfter / Math.max(1, p.stats.career.innings - p.stats.career.notOuts)).toFixed(1)}.`,
        severity: 'notable', playerIds: [p.id], clubIds: [u.id], trigger: fx.id, actions: [{ label: 'Career statistics', kind: 'open-player', payload: { playerId: p.id } }, { label: 'Celebrate', kind: 'dismiss' }],
      });
    }
    const wkMark = Math.floor(wkAfter / 25) * 25;
    if (wkMark >= 25 && wkBefore < wkMark) {
      addTimeline(w, 'milestone', `${p.name} reaches ${wkMark} wickets`, `Against ${opp.name}.`, [p.id, fx.id]);
    }
    if (bat && bat.runs >= 100) addTimeline(w, 'milestone', `Century: ${p.name}`, `${bat.runs} off ${bat.balls} v ${opp.name}.`, [p.id, fx.id]);
    if (bowl && bowl.wickets >= 5) addTimeline(w, 'milestone', `Five-for: ${p.name}`, `${bowl.wickets}/${bowl.runs} v ${opp.name}.`, [p.id, fx.id]);

    // Form arcs
    if (overall(p) >= 74 && p.form <= -4) {
      addStory(w, `slump-${w.season}-${p.id}`, {
        kicker: 'A STAR IN THE SHADOWS',
        title: `${p.name} is searching for form`,
        body: `${p.name}'s recent returns have dried up (form ${p.form}). The underlying ability is unchanged — but the dressing room is watching how you handle it.`,
        severity: 'notable', playerIds: [p.id], clubIds: [u.id], trigger: fx.id,
        actions: [
          { label: 'Review recent form', kind: 'open-player', payload: { playerId: p.id } },
          { label: 'Rest for the next match', kind: 'rest-player', payload: { playerId: p.id } },
          { label: 'Keep faith', kind: 'dismiss' },
        ],
      });
    }
    if (p.form >= 3 && w.storyKeys[`slump-${w.season}-${p.id}`] !== undefined) {
      addStory(w, `groove-${w.season}-${p.id}`, {
        kicker: 'BACK IN THE GROOVE', title: `${p.name} rediscovers the touch`, body: `After a lean spell, ${p.name} is producing again (form +${p.form}).`,
        severity: 'minor', playerIds: [p.id], clubIds: [u.id], trigger: fx.id, actions: [{ label: 'View player', kind: 'open-player', payload: { playerId: p.id } }, { label: 'Noted', kind: 'dismiss' }],
      });
    }
  }

  // Results arcs
  const res = userResults(w);
  const tail = res.slice(-3);
  if (tail.length === 3 && tail.every((r) => r === 'L')) {
    const captain = s.setup[side].xi.find((x) => x.id === s.setup[side].captainId);
    addStory(w, `pressure-${w.season}-${res.length}`, {
      kicker: 'PRESSURE MOUNTS',
      title: `Three defeats in a row for ${u.name}`,
      body: `The loss to ${opp.name} makes it three straight.${captain ? ` Captain ${captain.name} faces questions,` : ''} and the board's confidence (${u.board.confidence}) will not hold forever.`,
      severity: 'major', playerIds: captain ? [captain.id] : [], clubIds: [u.id, opp.id], trigger: fx.id,
      actions: [{ label: 'Rethink tactics', kind: 'open-page', payload: { page: 'tactics' } }, { label: 'Review the squad', kind: 'open-page', payload: { page: 'squad' } }, { label: 'Stay the course', kind: 'dismiss' }],
    });
  }
  const upset = w.news.find((n) => n.kind === 'upset' && n.sourceRef === fx.id);
  if (upset && won) {
    addTimeline(w, 'achievement', `Giant-killing against ${opp.name}`, upset.body, [fx.id]);
    addStory(w, `upset-${fx.id}`, {
      kicker: 'GIANT KILLERS', title: upset.headline, body: `${upset.body} Results like this move a club's reputation — and its own belief.`,
      severity: 'major', playerIds: [], clubIds: [u.id, opp.id], trigger: fx.id, actions: [{ label: 'Match report', kind: 'open-page', payload: { page: `fixtures/${fx.id}` } }, { label: 'Savour it', kind: 'dismiss' }],
    });
  }
  const key = [u.id, opp.id].sort().join('|');
  const rv = w.rivalries[key];
  if (rv && fx.stage !== 'League' && !fx.group && rv.knockoutMeetings >= 2) {
    addTimeline(w, 'rivalry', `${u.name} v ${opp.name}, knockout #${rv.knockoutMeetings}`, `${fx.stage}: ${fx.result?.margin ?? ''}`, [fx.id]);
  }
  if (fx.stage === 'Final') {
    addTimeline(w, won ? 'title' : 'achievement', won ? `${u.name} win the final` : `${u.name} beaten in the final`, `${w.competitions[fx.competitionId]?.name}: ${fx.result?.margin ?? ''}`, [fx.id]);
  }
}

/** Daily checks for the user's club (cheap; idempotent through story keys). */
export function storiesDaily(w: WorldState) {
  if (w.phase !== 'season' && w.phase !== 'wcc' && w.phase !== 'preseason') return;
  const u = userClub(w);
  const l = leagueById(u.leagueId);
  const squad = squadOf(w, u);

  // Injuries and returns
  for (const p of squad) {
    const mark = `injured:${p.id}`;
    if (p.injury) {
      if (w.storyKeys[mark] === undefined) {
        w.storyKeys[mark] = w.season;
        addTimeline(w, 'injury', `${p.name} injured`, `${p.injury.type} — ${p.injury.expectedDaysMin}–${p.injury.expectedDaysMax} days.`, [p.id, p.injury.id]);
        if (p.injury.severity !== 'minor' && overall(p) >= 70) {
          const cover = squad.filter((x) => x.id !== p.id && !x.injury && categoryOf(x) === categoryOf(p)).sort((a, b) => overall(b) - overall(a))[0];
          addStory(w, `inj-${p.injury.id}`, {
            kicker: 'A BLOW TO THE SQUAD', title: `${p.name} ruled out`, body: `${p.injury.type}: the medical team expects ${p.injury.expectedDaysMin}–${p.injury.expectedDaysMax} days out.${cover ? ` ${cover.name} is the natural cover.` : ' There is no like-for-like cover in the squad.'}`,
            severity: 'major', playerIds: [p.id, ...(cover ? [cover.id] : [])], clubIds: [u.id], trigger: p.injury.id,
            actions: [
              { label: 'Medical centre', kind: 'open-page', payload: { page: 'medical' } },
              ...(cover ? [{ label: `Bring in ${cover.shortName}`, kind: 'swap-into-xi' as const, payload: { in: cover.id, out: p.id } }] : [{ label: 'Find a replacement', kind: 'open-page' as const, payload: { page: 'transfers' } }]),
              { label: 'Noted', kind: 'dismiss' },
            ],
          });
        }
      }
    } else if (w.storyKeys[mark] !== undefined) {
      delete w.storyKeys[mark];
      addTimeline(w, 'return', `${p.name} is fit again`, 'Available for selection.', [p.id]);
    }
  }

  // Unsettled players
  for (const p of squad.filter((x) => x.transferRequest)) {
    addStory(w, `unsettled-${w.season}-${p.id}`, {
      kicker: 'UNSETTLED', title: `${p.name} wants more cricket`, body: `${p.name} has been left out of ${p.benchStreak} straight matches and morale has fallen to ${Math.round(p.morale)}. A conversation — or a decision — is needed.`,
      severity: 'notable', playerIds: [p.id], clubIds: [u.id], trigger: `morale-${p.id}`,
      actions: [{ label: 'Pick for the next match', kind: 'swap-into-xi', payload: { in: p.id } }, { label: 'Release the player', kind: 'release-player', payload: { playerId: p.id } }, { label: 'Talk later', kind: 'dismiss' }],
    });
  }

  if (w.day % 5 !== 0 && w.phase !== 'preseason') return;

  // The next generation: a young squad player or academy prospect pushing for a place
  const xi = new Set(u.lineup ?? lastXI(w));
  const young = [...squad.filter((p) => !xi.has(p.id)), ...u.academy.map((id) => w.players[id])]
    .filter((p) => p && ageOf(p, w.season) <= 21 && (p.potential >= 76 || p.form >= 3))
    .sort((a, b) => b.potential - a.potential)[0];
  if (young) {
    const starter = starterToReplace(w, young);
    const academy = u.academy.includes(young.id);
    const actions: StoryAction[] = [{ label: 'Review development', kind: 'open-player', payload: { playerId: young.id } }];
    if (starter) actions.push({ label: `Compare with ${starter.shortName}`, kind: 'compare', payload: { a: young.id, b: starter.id } });
    if (academy) actions.push({ label: 'Promote to the senior squad', kind: 'promote-youth', payload: { playerId: young.id } });
    else if (starter) actions.push({ label: 'Promote to the XI', kind: 'swap-into-xi', payload: { in: young.id, out: starter.id } });
    actions.push({ label: 'Keep in development', kind: 'dismiss' });
    addStory(w, `nextgen-${w.season}-${young.id}`, {
      kicker: 'THE NEXT GENERATION',
      title: `${young.name} is knocking on the door`,
      body: `At ${ageOf(young, w.season)}, ${young.name} has ${academy ? 'impressed in the academy' : 'forced a place in the selection conversation'}.${starter ? ` A place in the XI would mean leaving ${starter.name} — ${ageOf(starter, w.season)} and ${Math.round(overall(starter))} rated — on the bench.` : ''}`,
      severity: 'notable', playerIds: [young.id, ...(starter ? [starter.id] : [])], clubIds: [u.id], trigger: `development-${young.id}`, actions,
    });
  }

  // Qualification race
  const comp = w.competitions[`${l.id}-${w.season}`];
  if (comp?.stage === 'league') {
    const rows = sortRows(comp.standings.main);
    const me = rows.findIndex((r) => r.clubId === u.id);
    const playedShare = rows[me] ? rows[me].played / ((rows.length - 1) * l.rounds) : 0;
    const cut = l.playoffs === 'final2' ? 2 : 4;
    if (me >= cut && playedShare >= 0.5 && rows[cut - 1].points - rows[me].points >= 4) {
      addStory(w, `race-${w.season}-${Math.floor(w.day / 14)}`, {
        kicker: 'FALLING BEHIND',
        title: `${u.name} slip out of contention`,
        body: `${me + 1}th with ${rows[me].points} points, ${rows[cut - 1].points - rows[me].points} behind ${w.clubs[rows[cut - 1].clubId].name} in the last playoff place. ${w.leagues[l.id].wccSlots} World Club Championship places are also on the line.`,
        severity: 'major', playerIds: [], clubIds: [u.id], trigger: `standings-${comp.id}`,
        actions: [{ label: 'League table', kind: 'open-page', payload: { page: 'table' } }, { label: 'Adjust tactics', kind: 'open-page', payload: { page: 'tactics' } }, { label: 'Noted', kind: 'dismiss' }],
      });
    }
  }

  // Old friends: a former player waits in the opposition dressing room
  const next = Object.values(w.fixtures).filter((f) => f.involvesUser && f.status === 'scheduled' && f.homeId && f.awayId && f.day - w.day <= 2 && f.day >= w.day).sort((a, b) => a.day - b.day)[0];
  if (next) {
    const oppId = next.homeId === u.id ? next.awayId : next.homeId;
    const formerIds = new Set(w.ledger.filter((t) => t.fromClubId === u.id && t.kind === 'release').map((t) => t.playerId));
    const returning = w.clubs[oppId].squad.map((id) => w.players[id]).find((p) => formerIds.has(p.id) && overall(p) >= 65);
    if (returning) {
      addStory(w, `oldfriend-${next.id}-${returning.id}`, {
        kicker: 'OLD FRIENDS', title: `${returning.name} returns to face ${u.name}`, body: `Released by ${u.name}, ${returning.name} now lines up for ${w.clubs[oppId].name}. The scouts know every habit — and so does ${he(returning)}.`,
        severity: 'minor', playerIds: [returning.id], clubIds: [u.id, oppId], trigger: next.id, actions: [{ label: 'Opponent dossier', kind: 'open-page', payload: { page: `club/${oppId}` } }, { label: 'Noted', kind: 'dismiss' }],
      });
    }
  }

  // On the brink of a milestone
  for (const p of squad) {
    const runs = p.stats.career.runs;
    const nextMark = (Math.floor(runs / 500) + 1) * 500;
    if (runs >= 400 && nextMark - runs <= 40) {
      addStory(w, `brink-${p.id}-${nextMark}`, {
        kicker: 'ON THE BRINK', title: `${p.name} is ${nextMark - runs} short of ${nextMark}`, body: `${p.name} has ${runs} Kurciv runs. The next innings could bring up ${nextMark}.`,
        severity: 'minor', playerIds: [p.id], clubIds: [u.id], trigger: `stats-${p.id}`, actions: [{ label: 'View player', kind: 'open-player', payload: { playerId: p.id } }, { label: 'Noted', kind: 'dismiss' }],
      });
    }
  }
}

/** Auction eve: squad needs and observed rival demand, stated with appropriate uncertainty. */
export function storyAuctionEve(w: WorldState, demand: Record<string, { clubs: number; elitePool: number }>) {
  const u = userClub(w);
  const l = leagueById(u.leagueId);
  const tgt = roleTargets(l);
  const squad = squadOf(w, u);
  const names: Record<string, string> = { WK: 'wicketkeepers', BAT: 'batters', AR: 'all-rounders', PACE: 'fast bowlers', SPIN: 'spinners' };
  const short = (Object.keys(tgt) as (keyof typeof tgt)[]).filter((c) => squad.filter((p) => categoryOf(p) === c).length < Math.min(2, tgt[c]));
  const contested = (Object.keys(demand) as string[]).filter((c) => demand[c].clubs >= 3 && demand[c].elitePool <= demand[c].clubs).sort((a, b) => demand[b].clubs - demand[a].clubs)[0];
  const body = [
    squad.length ? `You head in with ${squad.length} registered players and ${u.purse.toFixed(2)} Cr to spend.` : `You start from an empty squad with ${u.purse.toFixed(2)} Cr to spend.`,
    short.length ? `Biggest gaps: ${short.map((c) => names[c]).join(', ')}.` : 'Every role has at least basic cover.',
    contested ? `${demand[contested].clubs} franchises look short of ${names[contested]}, with only ${demand[contested].elitePool} elite options in the pool — expect a fight.` : 'Rival needs look evenly spread; no single role stands out as contested yet.',
  ].join(' ');
  addStory(w, `auction-eve-${w.season}`, {
    kicker: 'AUCTION EVE', title: `The ${l.name} auction awaits`, body, severity: 'major', playerIds: [], clubIds: [u.id], trigger: `auction-${w.season}`,
    actions: [{ label: 'Enter the Auction House', kind: 'open-page', payload: { page: 'auction' } }],
  });
}

// ------------------------------------------------------------------ acting on a story

export interface StoryActionResult {
  ok: boolean;
  error?: string;
}

function lineupWith(w: WorldState, inId: string, outId?: string): string | null {
  const u = userClub(w);
  const l = leagueById(u.leagueId);
  const squad = squadOf(w, u);
  let xi = u.lineup ? [...u.lineup] : pickXI(squad, l.squadRules, l.domesticCountries).map((p) => p.id);
  if (xi.includes(inId)) return null;
  const pIn = w.players[inId];
  let out = outId && xi.includes(outId) ? outId : undefined;
  if (!out) {
    const same = xi.map((id) => w.players[id]).filter((p) => categoryOf(p) === categoryOf(pIn)).sort((a, b) => overall(a) - overall(b));
    out = same[0]?.id ?? xi.map((id) => w.players[id]).sort((a, b) => overall(a) - overall(b))[0].id;
  }
  xi = xi.map((id) => (id === out ? inId : id));
  const v = validateXI(xi.map((id) => w.players[id]), u.squad, l.squadRules, l.domesticCountries);
  if (!v.ok) return v.errors.join(' ');
  u.lineup = xi;
  return null;
}

export function applyStoryAction(
  w: WorldState,
  storyId: string,
  actionIndex: number,
  ops: { promoteYouth: (w: WorldState, c: Club, id: string) => string | null; releasePlayer: (w: WorldState, id: string) => string | null },
): StoryActionResult {
  const story = w.stories.find((s) => s.id === storyId);
  if (!story) return { ok: false, error: 'Story not found.' };
  const a = story.actions[actionIndex];
  if (!a) return { ok: false, error: 'Unknown action.' };
  let err: string | null = null;
  const u = userClub(w);
  switch (a.kind) {
    case 'promote-youth':
      err = ops.promoteYouth(w, u, a.payload!.playerId);
      break;
    case 'swap-into-xi':
      if (!u.squad.includes(a.payload!.in)) err = 'That player is not in the registered squad.';
      else if (w.players[a.payload!.in].injury) err = `${w.players[a.payload!.in].name} is injured.`;
      else err = lineupWith(w, a.payload!.in, a.payload!.out);
      break;
    case 'rest-player': {
      const pid = a.payload!.playerId;
      const l = leagueById(u.leagueId);
      const squad = squadOf(w, u);
      const xi = u.lineup ? [...u.lineup] : pickXI(squad, l.squadRules, l.domesticCountries).map((p) => p.id);
      const p = w.players[pid];
      const bench = squad.filter((x) => !xi.includes(x.id) && !x.injury && categoryOf(x) === categoryOf(p)).sort((x, y) => overall(y) - overall(x))[0]
        ?? squad.filter((x) => !xi.includes(x.id) && !x.injury).sort((x, y) => overall(y) - overall(x))[0];
      if (!bench) err = 'Nobody available on the bench.';
      else err = lineupWith(w, bench.id, pid);
      break;
    }
    case 'release-player':
      err = ops.releasePlayer(w, a.payload!.playerId);
      break;
    default:
      break;
  }
  if (err) return { ok: false, error: err };
  story.status = 'resolved';
  story.resolution = a.label;
  return { ok: true };
}

// ------------------------------------------------------------------ season chronicle

export function buildChronicle(w: WorldState): SeasonChronicle {
  const u = userClub(w);
  const l = leagueById(u.leagueId);
  const compId = `${l.id}-${w.season}`;
  const comp = w.competitions[compId];
  const rows = comp ? sortRows(comp.standings.main) : [];
  const row = rows.find((r) => r.clubId === u.id);
  const pos = rows.findIndex((r) => r.clubId === u.id) + 1;
  const order = comp ? finishingOrder(w, compId) : [];
  const finish = order.indexOf(u.id) + 1;
  const wcc = w.competitions[`WCC-${w.season}`];
  const key = (p: Player) => p.stats.seasons[`${w.season}:${compId}`];
  const squad = squadOf(w, u);
  const played = squad.filter((p) => key(p));
  const topBat = [...played].sort((a, b) => key(b).runs - key(a).runs)[0];
  const topBowl = [...played].sort((a, b) => key(b).wickets - key(a).wickets)[0];
  const signings = w.ledger.filter((t) => t.season === w.season && t.toClubId === u.id && t.kind === 'auction');
  const value = (pid: string, fee: number) => {
    const s = key(w.players[pid]);
    return s ? (s.runs + s.wickets * 22) / Math.max(0.2, fee) : 0;
  };
  const bestSigning = [...signings].sort((a, b) => value(b.playerId, b.fee) - value(a.playerId, a.fee))[0];
  const biggest = [...signings].sort((a, b) => b.fee - a.fee)[0];
  const prospect = played.filter((p) => ageOf(p, w.season) <= 23).sort((a, b) => key(b).runs + key(b).wickets * 22 - (key(a).runs + key(a).wickets * 22))[0];
  const res = userResults(w);
  let streak = 0;
  let worst = 0;
  for (const r of res) {
    streak = r === 'L' ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const injuries = squad.filter((p) => p.injuryHistory.some((h) => h.season === w.season) || (p.injury && p.injury.sustainedSeason === w.season));
  const userFx = Object.values(w.fixtures).filter((f) => f.involvesUser && f.result && f.season === w.season);
  const closest = userFx.filter((f) => f.result!.winnerId === u.id).sort((a, b) => marginSize(a.result!.margin) - marginSize(b.result!.margin))[0];
  const trophies = u.trophies.filter((t) => t.season === w.season);
  const champion = comp?.championId === u.id;
  const headline = champion ? `${u.name}: ${w.season} champions` : finish && finish <= 4 ? `${u.name} reach the business end` : pos && pos > rows.length / 2 ? `A season to learn from` : `${u.name} hold their ground`;
  const sections: SeasonChronicle['sections'] = [
    { title: 'The season', items: [
      row ? `Finished ${pos}${ordinal(pos)} in the ${l.shortName} table: ${row.won} wins, ${row.lost} defeats, ${row.points} points.` : 'No league games played.',
      ...(trophies.map((t) => `Won the ${t.name}.`)),
      wcc ? (wcc.clubIds.includes(u.id) ? `Played in the World Club Championship${wcc.championId === u.id ? ' — and won it' : ''}.` : 'Did not qualify for the World Club Championship.') : '',
    ].filter(Boolean) },
    { title: 'Your decisions', items: [
      signings.length ? `Signed ${signings.length} players at auction for ${signings.reduce((s, t) => s + t.fee, 0).toFixed(2)} Cr.` : 'No auction signings.',
      biggest ? `Biggest commitment: ${w.players[biggest.playerId].name} (${biggest.fee.toFixed(2)} Cr).` : '',
      u.lineup ? 'Picked your own XI.' : 'Let the assistant pick the XI.',
    ].filter(Boolean) },
    { title: 'Best performers', items: [
      topBat && key(topBat).runs ? `${topBat.name}: ${key(topBat).runs} runs at a strike rate of ${key(topBat).balls ? ((key(topBat).runs / key(topBat).balls) * 100).toFixed(0) : '—'}.` : '',
      topBowl && key(topBowl).wickets ? `${topBowl.name}: ${key(topBowl).wickets} wickets.` : '',
      bestSigning && value(bestSigning.playerId, bestSigning.fee) > 0 ? `Best value signing: ${w.players[bestSigning.playerId].name}.` : '',
      prospect ? `Emerging: ${prospect.name} (${ageOf(prospect, w.season)}).` : '',
    ].filter(Boolean) },
    { title: 'Setbacks', items: [
      worst >= 3 ? `A ${worst}-match losing run.` : 'No extended losing run.',
      injuries.length ? `${injuries.length} player${injuries.length === 1 ? '' : 's'} injured during the season.` : 'An injury-free season.',
    ] },
    { title: 'Memorable', items: [
      closest ? `Closest win: v ${w.clubs[closest.homeId === u.id ? closest.awayId : closest.homeId].name} — ${closest.result!.margin}.` : '',
      ...w.timeline.filter((t) => t.season === w.season && (t.kind === 'achievement' || t.kind === 'record' || t.kind === 'title')).slice(0, 4).map((t) => t.title),
    ].filter(Boolean) },
  ];
  const summary = sections[0].items[0];
  return { season: w.season, clubId: u.id, headline, summary, sections };
}

function marginSize(m: string): number {
  const n = Number(m.match(/(\d+)/)?.[1] ?? 99);
  return m.includes('wicket') ? n * 4 : n;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
