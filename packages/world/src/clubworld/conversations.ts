import type { Conversation, ConversationOption, ConversationTopic, Player, WorldEvent, WorldState } from '@kurciv/domain';
import { overall } from '@kurciv/domain';
import { Rng } from '@kurciv/simulation';
import { categoryOf } from '../auction';
import { nextId } from '../util';
import { cw, emit, isPast, later, sendMessage, subscribe, today } from './core';
import { makePromise } from './promises';
import { STANDING_LABEL, adjustRelation, brokenPromises, relationOf, standingOf } from './relations';

/**
 * Player conversations. A player raises a concern because of something recorded (being
 * dropped, a bench streak, batting position, workload, form, a broken promise). The
 * response options fit the topic, and each one changes trust, confidence and morale
 * according to that player's personality and the manager's track record.
 */

const OPEN_DAYS = 3;

function openFor(w: WorldState, pid: string, topic?: ConversationTopic) {
  return cw(w).conversations.find((c) => c.playerId === pid && c.status === 'open' && (!topic || c.topic === topic));
}

/** No more than one open conversation per player, and a few days' quiet after each talk. */
function canRaise(w: WorldState, p: Player, cooldown = 6): boolean {
  if (p.clubId !== w.userClubId || openFor(w, p.id)) return false;
  const r = relationOf(w, p);
  return !r.lastTalk || r.lastTalk.season < w.season || w.day - r.lastTalk.day >= cooldown;
}

const O = (id: string, label: string, tone: ConversationOption['tone'], hint: string, promise?: ConversationOption['promise']): ConversationOption => ({ id, label, tone, hint, ...(promise ? { promise } : {}) });

function optionsFor(topic: ConversationTopic, p: Player): ConversationOption[] {
  const n = p.shortName;
  switch (topic) {
    case 'dropped':
    case 'playing-time':
      return [
        O('reassure', `“You are still central to my plans, ${n}.”`, 'reassure', 'Works if they believe you.'),
        O('explain', '“It is about balance and the conditions, not you.”', 'explain', 'Professionals accept a clear reason.'),
        O('promise-start', `“You will start the next match.”`, 'promise', 'A tracked promise: they must be in the next XI.', 'start-next'),
        O('compromise', '“You will play two of the next three.”', 'compromise', 'A tracked promise with some flexibility.', 'start-two-of-three'),
        O('challenge', '“Force your way back in through training.”', 'challenge', 'Motivates the driven; stings the sensitive.'),
        O('decline', '“My decision stands.”', 'decline', 'Honest, but morale will suffer.'),
      ];
    case 'batting-position':
      return [
        O('promise-open', '“You will open in the next match.”', 'promise', 'A tracked promise: open in the next XI.', 'open-batting'),
        O('compromise', '“Top three in two of the next three.”', 'compromise', 'A tracked promise to bat in the top three.', 'top-order'),
        O('explain', '“The team needs you where you are.”', 'explain', 'They may accept the reasoning.'),
        O('decline', '“The order is not changing.”', 'decline', 'Morale will suffer.'),
      ];
    case 'workload':
      return [
        O('promise-rest', '“You will sit out the next match.”', 'promise', 'A tracked promise: leave them out of the next XI.', 'rest-next'),
        O('reassure', '“The medical team will monitor you closely.”', 'reassure', 'Trust-dependent.'),
        O('challenge', '“We need you out there right now.”', 'challenge', 'Raises injury risk if they keep playing tired.'),
      ];
    case 'form':
      return [
        O('praise', `“Your quality has not gone anywhere, ${n}.”`, 'praise', 'Lifts confidence.'),
        O('reassure', '“You will keep your place while you work through it.”', 'reassure', 'Trust-dependent.'),
        O('challenge', '“I need more from you, starting now.”', 'challenge', 'Some respond, some sink.'),
        O('promise-rest', '“Take the next match off and reset.”', 'compromise', 'A tracked promise: rested for the next match.', 'rest-next'),
      ];
    case 'contract':
      return [
        O('promise-retain', '“You will be retained at the next retention window.”', 'promise', 'A tracked promise checked against your retentions.', 'retain'),
        O('reassure', '“We will sit down properly when retentions open.”', 'reassure', 'Keeps options open; trust-dependent.'),
        O('decline', '“I cannot commit to that now.”', 'decline', 'Ambitious players take it badly.'),
      ];
    case 'broken-promise':
      return [
        O('explain', '“I owe you an explanation — it was a squad decision.”', 'explain', 'Limits the damage if trust remains.'),
        O('promise-start', '“You will start the next match. You have my word.”', 'promise', 'Another tracked promise — breaking it again is costly.', 'start-next'),
        O('challenge', '“Promises are earned by performances.”', 'challenge', 'Risky with an already hurt player.'),
      ];
    case 'team-morale':
      return [
        O('reassure', '“The group is better than these results.”', 'reassure', 'Steadies the dressing room if they trust you.'),
        O('challenge', '“Standards have slipped. That changes now.”', 'challenge', 'Sharpens professionals, unsettles others.'),
        O('explain', '“Here is the plan to turn it around.”', 'explain', 'A measured response.'),
      ];
    case 'praise':
      return [
        O('praise', '“Brilliant. You earned that.”', 'praise', 'Boosts confidence and morale.'),
        O('challenge', '“Good — now do it again.”', 'challenge', 'Keeps them hungry.'),
      ];
    case 'development':
      return [
        O('promise-start', '“You will get your chance in the next match.”', 'promise', 'A tracked promise: in the next XI.', 'start-next'),
        O('reassure', '“Your time is coming. Keep working.”', 'reassure', 'Trust-dependent.'),
        O('explain', '“Development first; the XI will follow.”', 'explain', 'Patient players accept it.'),
      ];
  }
}

function opener(topic: ConversationTopic, p: Player, ctx: Record<string, string | number>): string {
  switch (topic) {
    case 'dropped': return `Boss, can I have a minute? I was left out against ${ctx.opponent}. I thought I had done enough to keep my place — what do I need to do?`;
    case 'playing-time': return `I have not played for ${ctx.streak} matches. I came here to play cricket, not to carry drinks. Where do I stand?`;
    case 'batting-position': return `I have batted at ${ctx.position} for the last few games. I open the batting — that is where I do my best work. Can we talk about it?`;
    case 'workload': return `My body is telling me something (fatigue ${ctx.fatigue}). I want to be honest with you before something goes.`;
    case 'form': return `I know my form has dropped off. I am working at it, but I would like to know you still back me.`;
    case 'contract': return `I have had a good season (${ctx.summary}). Before retentions come round, I would like to know if I am part of your plans.`;
    case 'broken-promise': return `You told me: “${ctx.promise}” That did not happen. I need to know whether I can take you at your word.`;
    case 'team-morale': return `Three defeats in a row. As captain I can feel the dressing room going quiet. The group needs to hear something from you.`;
    case 'praise': return `Thanks for the faith, boss — ${ctx.performance}. That one felt good.`;
    case 'development': return `I have been putting the work in. I feel ready for a game whenever you need me.`;
  }
}

/** Opens a conversation (and a matching inbox notice) from a recorded event. */
export function raiseConversation(w: WorldState, p: Player, topic: ConversationTopic, source: WorldEvent | string, ctx: Record<string, string | number> = {}): Conversation | null {
  if (!canRaise(w, p, topic === 'broken-promise' ? 0 : 6)) return null;
  const ev = emit(w, {
    type: 'PLAYER_CONCERN_RAISED', key: `concern-${p.id}-${topic}-${w.season}-${w.day}`, source: typeof source === 'string' ? source : `event:${source.id}`,
    refs: { playerIds: [p.id], clubIds: [w.userClubId] }, data: { topic, ...ctx },
  });
  if (!ev) return null;
  const c: Conversation = {
    id: nextId(w, 'cv'), playerId: p.id, topic, eventId: ev.id, season: w.season, day: w.day, status: 'open', deadline: later(w, OPEN_DAYS),
    lines: [{ from: 'player', text: opener(topic, p, ctx), season: w.season, day: w.day }], options: optionsFor(topic, p),
  };
  cw(w).conversations.unshift(c);
  if (cw(w).conversations.length > 250) cw(w).conversations.length = 250;
  const urgent = topic === 'broken-promise' || topic === 'workload';
  sendMessage(w, {
    eventId: ev.id, from: { name: p.name, role: STANDING_LABEL[standingOf(w, p)] }, category: 'player', priority: urgent ? 'high' : 'normal',
    subject: SUBJECT[topic](p), body: c.lines[0].text, conversationId: c.id,
    refs: { playerIds: [p.id], clubIds: [w.userClubId] }, links: [{ label: 'Reply', page: `conversations?c=${c.id}` }, { label: 'Player profile', page: `player:${p.id}` }],
    response: { kind: 'conversation', required: true, deadline: c.deadline, payload: { conversationId: c.id }, options: c.options.map((o) => ({ id: o.id, label: o.label, hint: o.hint })) },
  });
  return c;
}

const SUBJECT: Record<ConversationTopic, (p: Player) => string> = {
  dropped: (p) => `${p.shortName} wants to know why they were dropped`,
  'playing-time': (p) => `${p.shortName} asks about playing time`,
  'batting-position': (p) => `${p.shortName} wants to open the batting`,
  workload: (p) => `${p.shortName} raises a fitness concern`,
  form: (p) => `${p.shortName} asks for your backing`,
  contract: (p) => `${p.shortName} asks about their future`,
  'broken-promise': (p) => `${p.shortName}: “You gave me your word”`,
  'team-morale': (p) => `Captain ${p.shortName} on dressing-room morale`,
  praise: (p) => `${p.shortName} thanks you for the faith`,
  development: (p) => `${p.shortName} feels ready for a chance`,
};

// ------------------------------------------------------------------ responding

export interface ReplyResult {
  ok: boolean;
  error?: string;
  outcome?: string;
}

/** How believable the manager is to this player right now (0..1). */
function credibility(w: WorldState, p: Player, topic: ConversationTopic): number {
  const r = relationOf(w, p);
  const recentSame = r.history.filter((h) => h.topic === topic && h.season === w.season && w.day - h.day < 21 && (h.response === 'reassure' || h.response === 'explain')).length;
  return Math.max(0.05, r.trust / 100 - brokenPromises(w, p.id) * 0.15 - brokenPromises(w) * 0.03 - recentSame * 0.2);
}

export function replyToConversation(w: WorldState, id: string, optionId: string): ReplyResult {
  const c = cw(w).conversations.find((x) => x.id === id);
  if (!c) return { ok: false, error: 'Conversation not found.' };
  if (c.status !== 'open') return { ok: false, error: 'This conversation is already over.' };
  const o = c.options.find((x) => x.id === optionId);
  const p = w.players[c.playerId];
  if (!o || !p) return { ok: false, error: 'Unknown response.' };
  const r = relationOf(w, p);
  const rng = Rng.from(`${w.seed}|reply|${c.id}|${o.id}`);
  const cred = credibility(w, p, c.topic);
  const tough = p.personality === 'temperamental' || r.confidence < 35;
  let reply = '';
  let outcome = '';
  switch (o.tone) {
    case 'reassure':
      if (rng.chance(Math.min(0.95, cred * 0.9 + r.professionalism * 0.002))) {
        adjustRelation(w, p, { trust: 3, morale: 6, confidence: 2 });
        reply = 'Okay. Thanks for being straight with me.'; outcome = 'Reassured: morale and trust up.';
      } else {
        adjustRelation(w, p, { trust: -4, morale: -2 });
        reply = 'With respect, I have heard that before.'; outcome = 'Not convinced: trust down.';
      }
      break;
    case 'explain':
      if (rng.chance(0.35 + r.professionalism / 200 + (p.personality === 'easygoing' ? 0.15 : 0) - (p.personality === 'ambitious' ? 0.15 : 0))) {
        adjustRelation(w, p, { trust: 2, morale: 3 });
        reply = 'I understand. I do not like it, but I understand.'; outcome = 'Accepted the explanation.';
      } else {
        adjustRelation(w, p, { trust: -2, morale: -3 });
        reply = 'That does not really answer my question.'; outcome = 'Unconvinced by the explanation.';
      }
      break;
    case 'promise':
    case 'compromise': {
      const pr = makePromise(w, { to: { kind: 'player', id: p.id }, kind: o.promise!, name: p.name, conversationId: c.id, sourceEvent: c.eventId });
      adjustRelation(w, p, { morale: o.tone === 'promise' ? 8 : 5, trust: cred > 0.4 ? 2 : -1 });
      reply = cred > 0.4 ? 'That is all I wanted to hear. I will hold you to it.' : 'We will see. I will be watching.';
      outcome = `Promise made: ${pr.text}`;
      break;
    }
    case 'challenge':
      if (!tough && rng.chance(0.3 + r.professionalism / 160)) {
        adjustRelation(w, p, { confidence: 4, morale: -1, trust: 1 });
        p.form = Math.min(10, p.form + 1);
        reply = 'Fair enough. You will see a reaction.'; outcome = 'Fired up: confidence up.';
      } else {
        adjustRelation(w, p, { morale: -8, trust: -6, confidence: -3 });
        reply = 'I did not expect that from you.'; outcome = 'Stung: morale and trust down.';
      }
      if (c.topic === 'workload') p.fatigue = Math.min(100, p.fatigue + 4);
      break;
    case 'praise':
      adjustRelation(w, p, { confidence: 6, morale: 4, trust: 1 });
      reply = 'Means a lot, boss.'; outcome = 'Confidence and morale up.';
      break;
    case 'decline': {
      const hit = p.personality === 'ambitious' || p.personality === 'temperamental' ? 9 : 5;
      adjustRelation(w, p, { morale: -hit, trust: p.personality === 'professional' ? 1 : -2 });
      if (p.morale < 30 && r.ambition >= 60 && p.benchStreak >= 3 && !p.transferRequest) p.transferRequest = true;
      reply = p.transferRequest ? 'Then maybe it is time I looked elsewhere.' : 'Right. I will get on with it, then.';
      outcome = p.transferRequest ? 'Declined: the player wants to leave.' : 'Declined: morale down.';
      break;
    }
  }
  c.status = 'resolved';
  c.chosen = o.id;
  c.outcome = outcome;
  c.lines.push({ from: 'manager', text: o.label, season: w.season, day: w.day }, { from: 'player', text: reply, season: w.season, day: w.day }, { from: 'note', text: outcome, season: w.season, day: w.day });
  r.history.push({ season: w.season, day: w.day, topic: c.topic, response: o.tone, outcome });
  if (r.history.length > 40) r.history.splice(0, r.history.length - 40);
  r.lastTalk = today(w);
  closeInboxFor(w, c.id, o.id, outcome);
  return { ok: true, outcome };
}

function closeInboxFor(w: WorldState, conversationId: string, optionId: string, outcome: string) {
  for (const m of cw(w).inbox.filter((x) => x.conversationId === conversationId && x.response && !x.response.chosen)) {
    m.response!.chosen = optionId;
    m.response!.outcome = outcome;
    m.read = true;
  }
}

// ------------------------------------------------------------------ triggers

function onEvent(w: WorldState, e: WorldEvent) {
  const pid = e.refs.playerIds[0];
  const p = pid ? w.players[pid] : null;
  switch (e.type) {
    case 'PLAYER_DROPPED': {
      if (!p || p.injury) return;
      const standing = standingOf(w, p);
      const r = relationOf(w, p);
      const rng = Rng.from(`${w.seed}|drop|${e.id}`);
      if ((standing === 'key' || standing === 'regular' || p.reputation >= 70) && rng.chance(0.35 + r.ambition / 200)) {
        raiseConversation(w, p, 'dropped', e, { opponent: String(e.data.opponentName ?? 'the opposition') });
      }
      break;
    }
    case 'PROMISE_FULFILLED': {
      if (!p) return;
      adjustRelation(w, p, { trust: 10, morale: 6 });
      relationOf(w, p).history.push({ season: w.season, day: w.day, topic: 'promise', response: 'kept', outcome: String(e.data.text) });
      break;
    }
    case 'PROMISE_BROKEN': {
      if (!p) return;
      adjustRelation(w, p, { trust: -18, morale: -10 });
      relationOf(w, p).history.push({ season: w.season, day: w.day, topic: 'promise', response: 'broken', outcome: String(e.data.text) });
      raiseConversation(w, p, 'broken-promise', e, { promise: String(e.data.text) });
      break;
    }
    case 'PROMISE_VOIDED': {
      if (p && String(e.data.note).startsWith('Explained')) adjustRelation(w, p, { trust: -2 });
      break;
    }
    case 'MATCH_COMPLETED': {
      if (!e.data.userMatch) return;
      const pom = e.data.playerOfMatch as string | null;
      const star = pom ? w.players[pom] : null;
      if (star && star.clubId === w.userClubId && e.data.winnerId === w.userClubId && Rng.from(`${w.seed}|praise|${e.id}`).chance(0.35)) {
        raiseConversation(w, star, 'praise', e, { performance: String(e.data.pomLine ?? 'player of the match') });
      }
      break;
    }
    case 'LOSING_STREAK': {
      const capId = e.data.captainId as string | undefined;
      const cap = capId ? w.players[capId] : null;
      if (cap) raiseConversation(w, cap, 'team-morale', e);
      break;
    }
    default:
      break;
  }
}

/** Daily: expire unanswered conversations and let players raise slower-burning concerns. */
export function conversationsDaily(w: WorldState) {
  for (const c of cw(w).conversations.filter((x) => x.status === 'open' && isPast(w, x.deadline))) {
    const p = w.players[c.playerId];
    c.status = 'expired';
    c.outcome = 'You never replied.';
    c.lines.push({ from: 'note', text: 'You never replied. The player took it as an answer.', season: w.season, day: w.day });
    if (p) {
      adjustRelation(w, p, { trust: -5, morale: -4 });
      relationOf(w, p).history.push({ season: w.season, day: w.day, topic: c.topic, response: 'ignored', outcome: 'No reply' });
    }
    closeInboxFor(w, c.id, 'ignored', 'No reply — trust and morale down.');
  }
  if (w.phase !== 'season' && w.phase !== 'wcc') return;
  // Keep it human: at most one new player approach a day, and never more than three waiting.
  if (cw(w).conversations.filter((x) => x.status === 'open').length >= 3) return;
  const u = w.clubs[w.userClubId];
  const sheets = Object.values(cw(w).teamSheets).slice(-3);
  const fresh = (key: string) => cw(w).keys[key] === undefined;
  const mark = (key: string) => (cw(w).keys[key] = w.season);
  const window = Math.floor(w.day / 21);
  const candidates: { p: Player; topic: ConversationTopic; key: string; ctx: Record<string, string | number>; weight: number }[] = [];
  for (const id of u.squad) {
    const p = w.players[id];
    if (!p || p.injury || openFor(w, p.id)) continue;
    const standing = standingOf(w, p);
    const r = relationOf(w, p);
    // A player who expects to play asks after three missed matches, then again only if it goes on.
    if (p.benchStreak >= 3 && (standing === 'key' || standing === 'regular' || (standing === 'rotation' && r.ambition >= 75))) {
      candidates.push({ p, topic: 'playing-time', key: `talk-pt-${p.id}-${w.season}-${Math.floor((p.benchStreak - 3) / 4)}`, ctx: { streak: p.benchStreak }, weight: r.ambition + (standing === 'key' ? 30 : 0) });
    }
    if (p.fatigue >= 78 && r.professionalism >= 50) candidates.push({ p, topic: 'workload', key: `talk-wl-${p.id}-${w.season}-${window}`, ctx: { fatigue: Math.round(p.fatigue) }, weight: 90 });
    if (p.form <= -4 && r.confidence < 45 && overall(p) >= 65) candidates.push({ p, topic: 'form', key: `talk-form-${p.id}-${w.season}-${window}`, ctx: {}, weight: 50 });
    if (p.styleTags.includes('opener') && sheets.length === 3 && sheets.every((x) => x.xi.indexOf(p.id) >= 3)) {
      candidates.push({ p, topic: 'batting-position', key: `talk-order-${p.id}-${w.season}-${window}`, ctx: { position: `number ${sheets[2].xi.indexOf(p.id) + 1}` }, weight: 40 + r.ambition / 2 });
    }
    if (standing === 'prospect' && p.benchStreak >= 6 && r.ambition >= 50 && categoryOf(p) !== 'WK') candidates.push({ p, topic: 'development', key: `talk-dev-${p.id}-${w.season}`, ctx: {}, weight: 20 });
  }
  const next = candidates.filter((c) => fresh(c.key)).sort((a, b) => b.weight - a.weight || a.p.id.localeCompare(b.p.id))[0];
  if (next && raiseConversation(w, next.p, next.topic, next.key, next.ctx)) mark(next.key);
}

/** Late season: strong performers ask about retention (once a season each). */
export function contractTalks(w: WorldState, compId: string) {
  const u = w.clubs[w.userClubId];
  for (const id of u.squad) {
    const p = w.players[id];
    const s = p?.stats.seasons[`${w.season}:${compId}`];
    if (!p || !s || s.matches < 5) continue;
    const r = relationOf(w, p);
    const strong = s.runs >= 300 || s.wickets >= 14;
    const key = `contract-talk-${w.season}-${p.id}`;
    if (!strong || r.ambition < 55 || cw(w).keys[key] !== undefined) continue;
    cw(w).keys[key] = w.season;
    raiseConversation(w, p, 'contract', key, { summary: s.wickets >= 14 ? `${s.wickets} wickets` : `${s.runs} runs` });
  }
}

subscribe(onEvent);
