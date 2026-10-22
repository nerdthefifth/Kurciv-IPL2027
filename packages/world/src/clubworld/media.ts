import type { Club, Player, Rumour, SocialAccount, SocialPost, WorldEvent, WorldState } from '@kurciv/domain';
import { ageOf, marketValue, overall } from '@kurciv/domain';
import { LEAGUES, leagueById } from '@kurciv/config';
import { hash01, Rng } from '@kurciv/simulation';
import { valuePlayer } from '../auction';
import { addNews, clamp, nextId, squadOf } from '../util';
import { cw, emit, eventRng, isVisible, sendMessage, staff, subscribe, today } from './core';
import { adjustRelation } from './relations';

/**
 * Media, news and the Cricket Feed. Coverage, posts and rumours are written from one
 * recorded event, quote its facts (names, scores, fees, days out) and cite its id. Accounts
 * are fictional and persistent; posts never put words in a real person's mouth — only
 * fictional generated players ever post themselves.
 */

// ------------------------------------------------------------------ accounts

const JOURNALISTS: [string, string, string, number][] = [
  ['Meera Iyer', 'meera_boundaryline', 'The Boundary Line', 82],
  ['Tom Gallagher', 'tgallagher_lrw', 'Long Room Wire', 74],
  ['Sana Qureshi', 'sanaq_powerplay', 'Powerplay Post', 68],
  ['Rohan Desai', 'rohan_insideedge', 'Inside Edge Daily', 61],
  ['Kabir Sethi', 'kabir_kcdesk', 'Kurciv Cricket Desk', 77],
  ['Ayesha Rahman', 'ayesha_thirdump', 'Third Umpire Weekly', 55],
];
const ANALYSTS: [string, string, string][] = [
  ['StrikeRate Lab', 'strikeratelab', 'Numbers behind every innings. In-game analytics account.'],
  ['Deep Point Data', 'deeppointdata', 'Bowling maps, matchups and auction value. In-game analytics account.'],
];
const PUNDITS: [string, string, string][] = [
  ['Vic Raghavan', 'vicraghavan_pundit', 'Former seamer, now on the KCN commentary team. In-game pundit.'],
  ['Danny Okafor', 'dokafor_cricket', 'Former opener. Says what he thinks. In-game pundit.'],
];

const COLORS = ['#c6ff1a', '#38bdf8', '#f97316', '#d946ef', '#facc15', '#22c55e', '#f43f5e', '#a78bfa'];
const initials = (s: string) => s.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const acct = (id: string, a: Omit<SocialAccount, 'id' | 'avatar'>): SocialAccount => ({ id, ...a, avatar: { color: COLORS[Math.floor(hash01(id) * COLORS.length)], initials: initials(a.name) } });

/** Seeds the persistent cast once per career (and adds accounts for clubs created later). */
export function ensureAccounts(w: WorldState) {
  const c = cw(w);
  const have = new Set(c.accounts.map((a) => a.id));
  const add = (a: SocialAccount) => {
    if (!have.has(a.id)) {
      c.accounts.push(a);
      have.add(a.id);
    }
  };
  add(acct('kcn', { handle: 'KCN_Sports', name: 'KCN Sports', kind: 'broadcaster', clubId: null, leagueId: null, bio: 'Kurciv Cricket Network — results, news and highlights. In-game broadcaster.', reputation: 85, followers: 2_400_000, mood: 0 }));
  for (const [name, handle, outlet, rep] of JOURNALISTS) add(acct(`j-${handle}`, { handle, name, kind: 'journalist', clubId: null, leagueId: null, bio: `Cricket correspondent, ${outlet}. In-game journalist.`, reputation: rep, followers: 40_000 + rep * 3000, mood: 0 }));
  for (const [name, handle, bio] of ANALYSTS) add(acct(`a-${handle}`, { handle, name, kind: 'analyst', clubId: null, leagueId: null, bio, reputation: 70, followers: 120_000, mood: 0 }));
  for (const [name, handle, bio] of PUNDITS) add(acct(`p-${handle}`, { handle, name, kind: 'former-player', clubId: null, leagueId: null, bio, reputation: 75, followers: 600_000, mood: hash01(handle) - 0.5 }));
  for (const l of LEAGUES) add(acct(`lg-${l.id}`, { handle: `${l.shortName}_kurciv`, name: `${l.shortName} (in-game)`, kind: 'league', clubId: null, leagueId: l.id, bio: `In-game account for the ${l.name} in this career.`, reputation: 80, followers: 900_000, mood: 0 }));
  for (const club of Object.values(w.clubs)) {
    add(acct(`club-${club.id}`, { handle: `${club.shortName}_kurciv`, name: `${club.name} (in-game)`, kind: 'club', clubId: club.id, leagueId: club.leagueId, bio: `In-game club account for ${club.name} in this career.`, reputation: 60 + club.brand * 0.3, followers: Math.round(50_000 + club.fanBase * 25_000), mood: 0.3 }));
    add(acct(`fans-${club.id}`, { handle: `${club.shortName}Army`, name: `${club.shortName} Army`, kind: 'supporters', clubId: club.id, leagueId: club.leagueId, bio: `Supporters' account for ${club.name}. Fictional.`, reputation: 40, followers: Math.round(5_000 + club.fanBase * 900), mood: hash01(`${club.id}m`) - 0.3 }));
    if (club.leagueId === w.clubs[w.userClubId].leagueId) {
      add(acct(`fan-${club.id}`, { handle: `${club.city.replace(/\s/g, '')}CricketTalk`, name: `${club.city} Cricket Talk`, kind: 'fan', clubId: club.id, leagueId: club.leagueId, bio: `Fan of ${club.name}. Opinions my own (and fictional).`, reputation: 25, followers: 3_000 + Math.round(hash01(club.id) * 9000), mood: hash01(`${club.id}f`) - 0.6 }));
    }
  }
}

const account = (w: WorldState, id: string) => cw(w).accounts.find((a) => a.id === id);

function playerAccount(w: WorldState, p: Player): SocialAccount | null {
  // Only fictional players have accounts: real people's words are never invented.
  if (p.source !== 'generated' && p.source !== 'youth') return null;
  const id = `pl-${p.id}`;
  let a = account(w, id);
  if (!a) {
    a = acct(id, { handle: p.name.replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 18), name: p.name, kind: 'player', clubId: p.clubId, leagueId: p.clubId ? w.clubs[p.clubId].leagueId : null, playerId: p.id, bio: `${p.role} · fictional in-game player.`, reputation: p.reputation, followers: 2_000 + p.reputation * 900, mood: 0.4 });
    cw(w).accounts.push(a);
  }
  return a;
}

// ------------------------------------------------------------------ posting

const DAILY_CAP = 45;

function post(w: WorldState, e: WorldEvent, accountId: string, text: string, kind: SocialPost['kind'], opts: { delay?: number; tags?: string[]; rumourId?: string; replyTo?: string; refs?: Partial<SocialPost['refs']> } = {}): SocialPost | null {
  const c = cw(w);
  const a = account(w, accountId);
  if (!a) return null;
  if (c.posts.some((p) => p.eventId === e.id && p.accountId === accountId && !opts.replyTo)) return null;
  const day = w.day + (opts.delay ?? 0);
  if (c.posts.filter((p) => p.season === w.season && p.day === day).length >= DAILY_CAP && e.importance < 3) return null;
  const rng = eventRng(w, e, accountId);
  const reach = a.followers / 100_000;
  const p: SocialPost = {
    id: nextId(w, 'ps'), accountId, eventId: e.id, season: w.season, day, text, kind,
    refs: { playerIds: opts.refs?.playerIds ?? e.refs.playerIds, clubIds: opts.refs?.clubIds ?? e.refs.clubIds, ...(e.refs.fixtureId ? { fixtureId: e.refs.fixtureId } : {}), ...(opts.refs?.articleId ? { articleId: opts.refs.articleId } : {}) },
    tags: opts.tags ?? [], likes: Math.round((40 + rng.range(0, 1) * 400) * (1 + reach) * e.importance), replies: Math.round(rng.range(0, 30) * e.importance * (1 + reach / 4)),
    ...(opts.rumourId ? { rumourId: opts.rumourId } : {}), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  };
  c.posts.unshift(p);
  if (c.posts.length > 1500) c.posts.length = 1500;
  return p;
}

const pick = <T,>(rng: Rng, xs: T[]) => xs[Math.floor(rng.next() * xs.length)];
const journalistFor = (w: WorldState, e: WorldEvent, salt = '') => {
  const js = cw(w).accounts.filter((a) => a.kind === 'journalist');
  return js[Math.floor(hash01(`${e.id}${salt}`) * js.length)];
};
const userLeague = (w: WorldState) => w.clubs[w.userClubId].leagueId;
const inUserLeague = (w: WorldState, clubIds: string[]) => clubIds.some((id) => w.clubs[id]?.leagueId === userLeague(w));

/** Fans' mood: their club's recent results shift how they react. */
function fanMood(w: WorldState, club: Club): number {
  const res = Object.values(w.fixtures).filter((f) => f.season === w.season && f.status === 'complete' && f.result && (f.homeId === club.id || f.awayId === club.id)).sort((a, b) => b.day - a.day).slice(0, 5);
  const wins = res.filter((f) => f.result!.winnerId === club.id).length;
  return res.length ? (wins / res.length - 0.5) * 2 : 0;
}

// ------------------------------------------------------------------ news coverage

/** Adds an article for an event unless one already covers it. */
function cover(w: WorldState, e: WorldEvent, a: { kind: Parameters<typeof addNews>[1]['kind']; headline: string; body: string; importance?: 1 | 2 | 3; followUpOf?: string }) {
  if (w.news.some((n) => n.eventId === e.id)) return null;
  const imp = a.importance ?? e.importance;
  const n = addNews(w, { kind: a.kind, importance: imp, headline: a.headline, body: a.body, clubIds: e.refs.clubIds, playerIds: e.refs.playerIds, sourceRef: e.source, eventId: e.id, level: imp === 3 ? 'feature' : imp === 2 ? 'article' : 'brief', ...(a.followUpOf ? { followUpOf: a.followUpOf } : {}) });
  return n;
}

/** Links existing simulation news (already written from the same record) to the event. */
function linkExisting(w: WorldState, e: WorldEvent, sourceRef: string) {
  for (const n of w.news) if (n.sourceRef === sourceRef && !n.eventId && (!e.refs.playerIds.length || n.playerIds.some((p) => e.refs.playerIds.includes(p)) || !n.playerIds.length)) {
    n.eventId = e.id;
    n.level ??= n.importance === 3 ? 'feature' : n.importance === 2 ? 'article' : 'brief';
  }
}

// ------------------------------------------------------------------ media pressure

export function pressure(w: WorldState, delta: number, reason: string) {
  const m = cw(w).media;
  m.pressure = clamp(Math.round(m.pressure + delta), 0, 100);
  m.history.push({ ...today(w), pressure: m.pressure, reason });
  if (m.history.length > 120) m.history.splice(0, m.history.length - 120);
}

// ------------------------------------------------------------------ reactions

function onEvent(w: WorldState, e: WorldEvent) {
  const u = w.clubs[w.userClubId];
  const rng = eventRng(w, e, 'media');
  const P = (id?: string) => (id ? w.players[id] : undefined);
  switch (e.type) {
    case 'MATCH_COMPLETED': {
      linkExisting(w, e, e.refs.fixtureId!);
      const d = e.data as Record<string, any>;
      const user = !!d.userMatch;
      if (!user && !inUserLeague(w, e.refs.clubIds) && e.importance < 3) return;
      const winner = d.winnerId ? w.clubs[d.winnerId] : null;
      const loser = winner ? w.clubs[e.refs.clubIds.find((x) => x !== winner.id)!] : null;
      const pom = P(d.playerOfMatch);
      if (user || e.importance >= 2) post(w, e, `club-${winner?.id ?? e.refs.clubIds[0]}`, winner ? `FULL TIME: ${winner.name} ${d.margin}. ${d.scoreline}.${pom ? ` Player of the match: ${pom.name}.` : ''}` : `It's a tie! ${d.scoreline}.`, 'official', { tags: ['result'] });
      if (winner && (user || rng.chance(0.5))) {
        const happy = pick(rng, [`What a win — ${winner.shortName} ${d.margin}. This team!`, `${winner.shortName} ${d.margin} — get in!`, `Never in doubt (it was very much in doubt). ${winner.shortName} win.`]);
        post(w, e, `fans-${winner.id}`, `${happy}${pom && pom.clubId === winner.id ? ` ${pom.shortName} was outstanding.` : ''}`, 'opinion', { delay: 0, tags: ['matchday'] });
      }
      if (loser && (user || rng.chance(0.4))) {
        const mood = fanMood(w, loser);
        post(w, e, `fans-${loser.id}`, mood < -0.3 ? pick(rng, [`Another defeat. Something has to change at ${loser.shortName}.`, `That's ${-Math.round(mood * 2.5)} losses in the last five. Not good enough.`]) : pick(rng, [`Gutted, but we move on. ${loser.shortName} bounce back next game.`, `Close, but not close enough. Plenty to work on.`]), 'opinion', { tags: ['matchday'] });
      }
      if (user && d.topScore && rng.chance(0.8)) {
        const ts = d.topScore as { playerId: string; runs: number; balls: number };
        const tp = P(ts.playerId);
        if (tp) post(w, e, pick(rng, ['a-strikeratelab', 'a-deeppointdata']), `${tp.name}: ${ts.runs} off ${ts.balls} (SR ${Math.round((ts.runs / Math.max(1, ts.balls)) * 100)}).${d.bestBowling ? ` Best with the ball: ${P((d.bestBowling as any).playerId)?.shortName} ${(d.bestBowling as any).wickets}/${(d.bestBowling as any).runs}.` : ''}`, 'analysis', { delay: 1, tags: ['stats'], refs: { playerIds: [tp.id] } });
      }
      if (user) {
        const won = d.winnerId === u.id;
        pressure(w, won ? -3 : d.winnerId ? 3 : 0, won ? 'Win' : 'Defeat');
        if (pom && pom.clubId === u.id) { const pa = playerAccount(w, pom); if (pa) post(w, e, pa.id, `Special night. Thanks for the support! 🙏`, 'opinion', { delay: 0 }); }
      }
      break;
    }
    case 'PLAYER_DROPPED': {
      const p = P(e.refs.playerIds[0]);
      if (!p) return;
      const star = p.reputation >= 70 || overall(p) >= 78;
      const repl = P(e.data.replacementId as string);
      if (!star) return;
      cover(w, e, { kind: 'morale', importance: 2, headline: `${p.name} left out by ${u.name}`, body: `${u.name} named their XI against ${e.data.opponentName} without ${p.name}${repl ? `, handing the place to ${repl.name}${ageOf(repl, w.season) <= 23 ? ` (${ageOf(repl, w.season)})` : ''}` : ''}. ${p.name} had played the previous match.` });
      const j = journalistFor(w, e);
      post(w, e, j.id, `${u.shortName} leave out ${p.name} v ${e.data.opponentName}. A bold call — will be fascinating to hear ${w.managerName}'s reasoning.`, 'report', { tags: ['selection'] });
      if (repl && ageOf(repl, w.season) <= 23) post(w, e, 'p-vicraghavan_pundit', `Good to see ${repl.name} get a chance. Young players only improve by playing. ${p.shortName} will be back.`, 'opinion', { delay: 0, tags: ['selection'] });
      if (inUserLeague(w, [u.id])) {
        post(w, e, `fans-${u.id}`, pick(rng, [`Dropping ${p.shortName}?? Explain that one.`, `Leaving out ${p.shortName} is brave. Hope it works.`]), 'opinion', { tags: ['selection'] });
        if (account(w, `fan-${u.id}`)) post(w, e, `fan-${u.id}`, pick(rng, [`Hard to argue with picking on form. ${p.shortName} hasn't been firing.`, `${p.shortName} out is a mistake. Simple as that.`]), 'opinion', { delay: 1, tags: ['selection'] });
      }
      pressure(w, 4, `Dropped ${p.name}`);
      mediaRequest(w, e, 'selection', p);
      break;
    }
    case 'PLAYER_INJURED': {
      linkExisting(w, e, String(e.data.injuryId));
      const p = P(e.refs.playerIds[0]);
      if (!p || !p.clubId) return;
      if (e.importance >= 2 || p.clubId === u.id) post(w, e, `club-${p.clubId}`, `Injury update: ${p.name} has ${String(e.data.injuryType).toLowerCase()}. Expected recovery ${e.data.min}–${e.data.max} days.`, 'official', { tags: ['injury'] });
      if (p.clubId === u.id && p.reputation >= 60) post(w, e, `fans-${u.id}`, `Losing ${p.shortName} for ${e.data.min}–${e.data.max} days hurts. Who steps up?`, 'opinion', { delay: 0, tags: ['injury'] });
      break;
    }
    case 'PLAYER_RECOVERED': {
      const p = P(e.refs.playerIds[0]);
      if (!p || !p.clubId) return;
      const original = w.news.find((n) => n.sourceRef === e.data.injuryId && n.kind === 'injury' && /ruled out/.test(n.headline));
      linkExisting(w, e, String(e.data.injuryId));
      const already = w.news.find((n) => n.sourceRef === e.data.injuryId && /fit again/.test(n.headline));
      if (already && original) already.followUpOf ??= original.id;
      if (p.clubId === u.id || e.importance >= 2) post(w, e, `club-${p.clubId}`, `${p.name} is back in full training and available for selection.`, 'official', { tags: ['injury'] });
      break;
    }
    case 'PLAYER_MILESTONE_REACHED': {
      const p = P(e.refs.playerIds[0]);
      if (!p) return;
      const what = String(e.data.what);
      cover(w, e, { kind: 'milestone', headline: `${p.name}: ${what}`, body: `${p.name}${p.clubId ? ` (${w.clubs[p.clubId].name})` : ''} — ${what}${e.data.against ? ` against ${e.data.against}` : ''}.` });
      if (p.clubId) post(w, e, `club-${p.clubId}`, `🎉 ${what} for ${p.name}!`, 'official', { tags: ['milestone'] });
      if (e.importance >= 2) post(w, e, pick(rng, ['a-strikeratelab', 'a-deeppointdata']), `${p.name} — ${what}. ${p.stats.career.matches} Kurciv matches, ${p.stats.career.runs} runs, ${p.stats.career.wickets} wickets.`, 'analysis', { delay: 1, tags: ['stats'] });
      const pa = playerAccount(w, p);
      if (pa) post(w, e, pa.id, `${what}. Grateful to everyone at the club.`, 'opinion');
      break;
    }
    case 'PLAYER_ACQUIRED': {
      const p = P(e.refs.playerIds[0]);
      const to = w.clubs[e.data.toClubId as string];
      if (!p || !to) return;
      const fee = Number(e.data.fee ?? 0);
      const mine = to.id === u.id;
      if (mine || fee > 0) post(w, e, `club-${to.id}`, `Welcome, ${p.name}! ${e.data.how === 'auction' ? `Signed at auction for ₹${fee.toFixed(2)} Cr.` : 'Joins the squad.'}`, 'official', { tags: ['recruitment'] });
      if (e.data.how === 'auction' && fee >= 2 && (mine || inUserLeague(w, [to.id]))) {
        const value = marketValue(p, w.season);
        const ratio = fee / Math.max(0.2, value);
        const verdict = ratio > 1.6 ? `That's ${ratio.toFixed(1)}× our value model. Overpay.` : ratio < 0.7 ? `Our model had ${p.shortName} at ₹${value.toFixed(1)} Cr. Steal.` : 'Fair price by our numbers.';
        post(w, e, 'a-deeppointdata', `${to.shortName} pay ₹${fee.toFixed(2)} Cr for ${p.name}. ${verdict}`, 'analysis', { tags: ['auction'] });
        if (mine && ratio > 1.8) pressure(w, 3, `Paid ${fee.toFixed(2)} Cr for ${p.name}`);
      }
      resolveAuctionRumours(w, e);
      break;
    }
    case 'PLAYER_RELEASED': {
      const p = P(e.refs.playerIds[0]);
      if (!p || e.data.fromClubId !== u.id) return;
      post(w, e, `club-${u.id}`, `${p.name} has been released. Thank you for everything, ${p.shortName}.`, 'official', { tags: ['recruitment'] });
      break;
    }
    case 'LOSING_STREAK': {
      cover(w, e, { kind: 'morale', importance: 2, headline: `${u.name} lose ${e.data.count} in a row`, body: `The defeat to ${e.data.opponentName} is ${u.name}'s ${e.data.count}th in succession. ${w.managerName} is under growing scrutiny.` });
      post(w, e, journalistFor(w, e).id, `${e.data.count} straight defeats for ${u.shortName}. The questions for ${w.managerName} are getting harder.`, 'report', { tags: ['pressure'] });
      post(w, e, `fans-${u.id}`, pick(rng, ['This run has to end. Now.', `${e.data.count} losses on the bounce. Unacceptable.`, 'I still believe. Just about.']), 'opinion', { delay: 0, tags: ['pressure'] });
      pressure(w, 8, `${e.data.count}-match losing streak`);
      mediaRequest(w, e, 'streak');
      break;
    }
    case 'BOARD_CONFIDENCE_CHANGED': {
      if (!e.data.falling || (e.data.to !== 'risk' && e.data.to !== 'critical')) return;
      const j = journalistFor(w, e, 'board');
      cover(w, e, { kind: 'board', importance: 2, headline: `Pressure grows on ${w.managerName} at ${u.name}`, body: `${u.name}'s board is said to be concerned about the direction of the club. Board confidence in the manager has fallen to “${e.data.label}”.` });
      post(w, e, j.id, `Understand the ${u.shortName} board is growing concerned about results. ${w.managerName}'s position is being discussed.`, 'report', { delay: 1, tags: ['board'] });
      break;
    }
    case 'MANAGER_DISMISSED':
    case 'MANAGER_APPOINTED': {
      const club = w.clubs[e.refs.clubIds[0]];
      if (!club) return;
      post(w, e, `club-${club.id}`, e.type === 'MANAGER_DISMISSED' ? `${club.name} and ${w.managerName} have parted ways. We thank ${w.managerName} for their work.` : `${club.name} are pleased to announce the appointment of ${w.managerName} as manager.`, 'official', { tags: ['board'] });
      break;
    }
    case 'CLUB_QUALIFIED': {
      const club = w.clubs[e.refs.clubIds[0]];
      if (!club) return;
      post(w, e, `club-${club.id}`, `We're going to the World Club Championship! 🏆`, 'official', { tags: ['qualification'] });
      if (club.id === u.id) post(w, e, `fans-${club.id}`, 'World Club Championship, here we come!', 'opinion', { delay: 0 });
      break;
    }
    case 'PROMISE_BROKEN': {
      const p = P(e.refs.playerIds[0]);
      if (!p || p.reputation < 70 || p.personality !== 'temperamental') return;
      publishRumour(w, e, { playerId: p.id, clubId: u.id }, `${p.name} is unhappy at ${u.name} after being let down over their role.`, 'unsettled', 0.85);
      break;
    }
    case 'MEDIA_STATEMENT': {
      cover(w, e, { kind: 'board', importance: 1, headline: String(e.data.headline), body: `${w.managerName}: “${e.data.quote}”` });
      post(w, e, journalistFor(w, e).id, `${w.managerName} on ${e.data.subject}: “${e.data.quote}”`, 'report', { tags: ['press'] });
      break;
    }
    case 'RUMOUR_RESOLVED': {
      const r = cw(w).rumours.find((x) => x.id === e.data.rumourId);
      if (!r) return;
      const first = cw(w).posts.find((p) => p.rumourId === r.id);
      post(w, e, r.sourceAccountId, r.status === 'confirmed' ? `As reported: ${r.outcome}` : `Update on my earlier report — ${r.outcome}`, 'report', { replyTo: first?.id, rumourId: r.id, tags: ['rumour'] });
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ media requests

function mediaRequest(w: WorldState, e: WorldEvent, kind: 'selection' | 'streak', p?: Player) {
  const j = journalistFor(w, e, 'req');
  const options = kind === 'selection'
    ? [
      { id: 'form', label: '“It was about form and balance.”', hint: 'Lowers pressure; the dropped player may take it personally.' },
      { id: 'back', label: `“${p!.shortName} remains a big part of what we do.”`, hint: 'Lifts the dropped player; mixed signals keep the story alive.' },
      { id: 'none', label: 'No comment', hint: 'The story runs without you.' },
    ]
    : [
      { id: 'own', label: '“That is on me. I take responsibility.”', hint: 'Lowers pressure; the board notices.' },
      { id: 'defend', label: '“I back this group of players completely.”', hint: 'Dressing-room morale up; pressure stays.' },
      { id: 'criticise', label: '“The players have to look at themselves.”', hint: 'Deflects pressure; morale and trust fall.' },
      { id: 'none', label: 'No comment', hint: 'Pressure rises.' },
    ];
  sendMessage(w, {
    eventId: e.id, from: { name: j.name, role: j.bio.split('. ')[0] }, category: 'media', priority: 'normal', delay: 0,
    subject: kind === 'selection' ? `Media request: why was ${p!.shortName} left out?` : `Media request: ${e.data.count} defeats in a row`,
    body: kind === 'selection' ? `${j.name} wants your comment on leaving ${p!.name} out against ${e.data.opponentName}.` : `${j.name} asks how you plan to end a run of ${e.data.count} straight defeats.`,
    refs: { playerIds: p ? [p.id] : [], clubIds: [w.userClubId] }, links: [],
    response: { kind: 'media-request', required: false, deadline: { season: w.season, day: w.day + 2 }, payload: { topic: kind, playerId: p?.id ?? '', journalist: j.id, eventId: e.id }, options },
  });
}

export function respondToMedia(w: WorldState, payload: Record<string, string>, optionId: string): string {
  const u = w.clubs[w.userClubId];
  const p = payload.playerId ? w.players[payload.playerId] : null;
  const squad = squadOf(w, u);
  let quote = '';
  let headline = '';
  let outcome = '';
  if (payload.topic === 'selection') {
    if (optionId === 'form') { pressure(w, -4, 'Explained the selection'); if (p) adjustRelation(w, p, { trust: -3 }); quote = 'Selection is about form and balance. Nobody has a guaranteed place.'; headline = `${w.managerName}: “Nobody has a guaranteed place”`; outcome = 'Pressure eased; the dropped player was stung.'; }
    else if (optionId === 'back') { pressure(w, 1, 'Mixed signals on selection'); if (p) adjustRelation(w, p, { trust: 4, morale: 3 }); quote = `${p?.shortName ?? 'They'} remain a big part of what we do.`; headline = `${w.managerName} backs ${p?.name ?? 'dropped player'}`; outcome = 'The dropped player appreciated it.'; }
    else { pressure(w, 3, 'No comment on selection'); outcome = 'The story ran without your view.'; }
  } else {
    if (optionId === 'own') { pressure(w, -6, 'Took responsibility'); quote = 'That is on me. I take responsibility for these results.'; headline = `${w.managerName} takes responsibility`; outcome = 'Pressure eased.'; }
    else if (optionId === 'defend') { for (const s of squad) adjustRelation(w, s, { morale: 2 }); quote = 'I back this group of players completely.'; headline = `${w.managerName} backs the squad`; outcome = 'Dressing-room morale up.'; }
    else if (optionId === 'criticise') { pressure(w, -2, 'Criticised the players'); for (const s of squad) adjustRelation(w, s, { morale: -3, trust: -2 }); quote = 'The players have to take a hard look at themselves.'; headline = `${w.managerName} turns on the players`; outcome = 'Pressure deflected; the squad noticed.'; }
    else { pressure(w, 4, 'No comment on the losing run'); outcome = 'Silence fuelled the story.'; }
  }
  if (quote) emit(w, { type: 'MEDIA_STATEMENT', key: `statement-${payload.eventId}`, source: `event:${payload.eventId}`, refs: { clubIds: [u.id], playerIds: p ? [p.id] : [] }, data: { quote, headline, subject: payload.topic === 'selection' ? 'selection' : 'the losing run' } });
  return outcome;
}

// ------------------------------------------------------------------ rumours

function publishRumour(w: WorldState, e: WorldEvent, subject: Rumour['subject'], claim: string, context: Rumour['context'], reliability: number, sourceId?: string) {
  const c = cw(w);
  if (c.rumours.some((r) => r.status === 'open' && r.subject.playerId === subject.playerId && r.context === context)) return;
  const src = sourceId ? account(w, sourceId)! : journalistFor(w, e, 'rumour');
  const r: Rumour = { id: nextId(w, 'ru'), sourceAccountId: src.id, subject, claim, reliability, season: w.season, day: w.day, status: 'open', context, eventId: e.id };
  c.rumours.unshift(r);
  if (c.rumours.length > 200) c.rumours.length = 200;
  const ev = emit(w, { type: 'RUMOUR_PUBLISHED', key: `rumour-${r.id}`, source: `rumour:${r.id}`, refs: { playerIds: [subject.playerId], clubIds: [subject.clubId] }, data: { rumourId: r.id, claim } });
  if (ev) post(w, ev, src.id, `${context === 'auction' ? 'Hearing' : 'Sources say'}: ${claim} (unconfirmed)`, 'rumour', { rumourId: r.id, tags: ['rumour', context] });
}

function resolveRumour(w: WorldState, r: Rumour, status: Rumour['status'], outcome: string) {
  if (r.status !== 'open') return;
  r.status = status;
  r.outcome = outcome;
  r.resolved = today(w);
  const src = account(w, r.sourceAccountId);
  if (src && src.kind === 'journalist') src.reputation = clamp(src.reputation + (status === 'confirmed' ? 2 : status === 'denied' ? -3 : 0), 20, 95);
  emit(w, { type: 'RUMOUR_RESOLVED', key: `rumour-resolved-${r.id}`, source: `rumour:${r.id}`, refs: { playerIds: [r.subject.playerId], clubIds: [r.subject.clubId] }, data: { rumourId: r.id, status, outcome } });
}

/**
 * Before the user's auction: journalists report which clubs will chase which players. A
 * reliable source names the club whose own valuation of the player is currently highest
 * (what its recruitment staff would really be planning); a weaker source is more likely to
 * be guessing. The auction itself resolves every report.
 */
export function auctionRumours(w: WorldState) {
  const key = `auction-rumours-${w.season}`;
  const c = cw(w);
  if (c.keys[key] !== undefined) return;
  const a = Object.values(w.auctions).find((x) => x.leagueId === userLeague(w) && x.season === w.season);
  if (!a) return;
  c.keys[key] = w.season;
  const ev = emit(w, { type: 'RUMOUR_PUBLISHED', key: `${key}-batch`, source: `auction:${a.id}`, refs: { clubIds: [] }, data: { batch: true } });
  if (!ev) return;
  const l = leagueById(a.leagueId);
  const clubs = Object.values(w.clubs).filter((x) => x.leagueId === l.id && !x.isUser);
  const lots = a.lots.map((x, i) => ({ lot: x, i, p: w.players[x.playerId] })).filter((x) => x.lot.status === 'pending' && x.p).sort((x, y) => overall(y.p) - overall(x.p)).slice(0, 4);
  const rng = Rng.from(`${w.seed}|auction-rumours|${w.season}`);
  for (const { p, i } of lots) {
    const bid = new Map(clubs.map((cl) => [cl.id, valuePlayer(w, a, cl, p, i).maxBid]));
    const ranked = [...clubs].filter((cl) => (bid.get(cl.id) ?? 0) > 0).sort((x, y) => bid.get(y.id)! - bid.get(x.id)! || x.id.localeCompare(y.id));
    if (!ranked.length) continue;
    const j = journalistFor(w, ev, p.id);
    const reliability = j.reputation / 100;
    const club = rng.chance(reliability) ? ranked[0] : pick(rng, ranked.slice(1).length ? ranked.slice(1) : ranked);
    if (!club) continue;
    publishRumour(w, ev, { playerId: p.id, clubId: club.id }, `${club.name} will push hard for ${p.name} at the auction.`, 'auction', reliability, j.id);
  }
}

function resolveAuctionRumours(w: WorldState, e: WorldEvent) {
  const pid = e.refs.playerIds[0];
  for (const r of cw(w).rumours.filter((x) => x.status === 'open' && x.context === 'auction' && x.subject.playerId === pid)) {
    const to = w.clubs[e.data.toClubId as string];
    if (to?.id === r.subject.clubId) resolveRumour(w, r, 'confirmed', `${w.players[pid].name} signs for ${to.name} for ₹${Number(e.data.fee).toFixed(2)} Cr.`);
    else resolveRumour(w, r, 'denied', `${w.players[pid].name} went to ${to?.name ?? 'another club'} instead.`);
  }
}

/** Daily: settle rumours whose outcome is now known, and let pressure drift back to normal. */
export function mediaDaily(w: WorldState) {
  const c = cw(w);
  for (const r of c.rumours.filter((x) => x.status === 'open')) {
    const p = w.players[r.subject.playerId];
    if (r.context === 'auction') {
      const a = Object.values(w.auctions).find((x) => x.leagueId === w.clubs[r.subject.clubId]?.leagueId && x.season === r.season);
      if (a?.status === 'complete' && !p?.clubId) resolveRumour(w, r, 'abandoned', `${p?.name ?? 'The player'} went unsold.`);
    } else if (r.context === 'unsettled') {
      if (!p || p.clubId !== r.subject.clubId) resolveRumour(w, r, 'confirmed', `${p?.name ?? 'The player'} has left ${w.clubs[r.subject.clubId].name}.`);
      else if (p.transferRequest) resolveRumour(w, r, 'confirmed', `${p.name} has asked about their future at ${w.clubs[r.subject.clubId].name}.`);
      else if (p.morale >= 65) resolveRumour(w, r, 'denied', `${p.name} appears settled again (morale recovered).`);
      else if (r.season < w.season) resolveRumour(w, r, 'abandoned', 'The story faded without resolution.');
    }
  }
  const m = c.media;
  if (m.pressure > 20) m.pressure -= 1;
  else if (m.pressure < 20) m.pressure += 1;
}

/** Feed visibility for the user: delivered posts, minus muted topics. */
export function visiblePosts(w: WorldState) {
  const c = cw(w);
  return c.posts.filter((p) => isVisible(w, p) && !p.tags.some((t) => c.feed.muted.includes(t)));
}

export function feedAccount(w: WorldState, id: string) {
  return account(w, id);
}

/** Inbox note from staff when a disciplinary incident is recorded. */
export function disciplinaryCheck(w: WorldState) {
  if (w.phase !== 'season' && w.phase !== 'wcc') return;
  const u = w.clubs[w.userClubId];
  for (const id of u.squad) {
    const p = w.players[id];
    if (!p || p.personality !== 'temperamental' || p.morale >= 35) continue;
    if (!Rng.from(`${w.seed}|disc|${w.season}|${w.day}|${p.id}`).chance(0.04)) continue;
    const key = `disc-${p.id}-${w.season}-${Math.floor(w.day / 20)}`;
    const incident = pick(Rng.from(key), ['arrived late to training', 'had a heated exchange with a coach at practice', 'skipped a recovery session']);
    const e = emit(w, { type: 'DISCIPLINARY_INCIDENT', key, source: `player:${p.id}`, refs: { playerIds: [p.id], clubIds: [u.id] }, data: { incident } });
    if (!e) continue;
    sendMessage(w, {
      eventId: e.id, from: staff(w, 'head'), category: 'discipline', priority: 'high',
      subject: `${p.shortName} ${incident}`, body: `${p.name} ${incident}. Morale has been low (${Math.round(p.morale)}). How do you want to handle it?`,
      refs: { playerIds: [p.id], clubIds: [u.id] }, links: [{ label: 'Player profile', page: `player:${p.id}` }],
      response: {
        kind: 'discipline', required: true, deadline: { season: w.season, day: w.day + 3 }, payload: { playerId: p.id },
        options: [{ id: 'fine', label: 'Fine the player', hint: 'Sets a standard; the player will resent it.' }, { id: 'warn', label: 'Have a private word', hint: 'A measured response.' }, { id: 'ignore', label: 'Let it go', hint: 'Professionals in the squad may notice.' }],
      },
    });
  }
}

export function respondToDiscipline(w: WorldState, payload: Record<string, string>, optionId: string): string {
  const p = w.players[payload.playerId];
  if (!p) return 'The player has left.';
  const u = w.clubs[w.userClubId];
  if (optionId === 'fine') { adjustRelation(w, p, { trust: -5, morale: -3 }); for (const s of squadOf(w, u)) if (s.personality === 'professional') adjustRelation(w, s, { trust: 1 }); return 'Fined. The squad saw standards enforced.'; }
  if (optionId === 'warn') { adjustRelation(w, p, { trust: 2 }); return 'A private word. The player appreciated the discretion.'; }
  for (const s of squadOf(w, u)) if (s.personality === 'professional') adjustRelation(w, s, { trust: -1 });
  return 'Let go. Some senior players noticed.';
}

subscribe(onEvent);
