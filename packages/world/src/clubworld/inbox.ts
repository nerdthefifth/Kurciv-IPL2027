import type { InboxMessage, WorldEvent, WorldState } from '@kurciv/domain';
import { cw, isPast, sendMessage, staff, subscribe } from './core';
import { respondToBoard } from './board';
import { replyToConversation } from './conversations';
import { respondToDiscipline, respondToMedia } from './media';
import { releasePromise } from './promises';

/**
 * Staff and administrative mail, and the single dispatcher for answering any inbox
 * message. Every message cites the event it came from; answering one changes game state
 * through the owning system, never by just marking text as read.
 */

function onEvent(w: WorldState, e: WorldEvent) {
  const u = w.clubs[w.userClubId];
  const pid = e.refs.playerIds[0];
  const p = pid ? w.players[pid] : null;
  const mine = e.refs.clubIds.includes(u.id) || p?.clubId === u.id;
  switch (e.type) {
    case 'PLAYER_INJURED':
      if (!p || p.clubId !== u.id) return;
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'medical'), category: 'medical', priority: e.data.severity === 'minor' ? 'normal' : 'high',
        subject: `${p.name}: ${String(e.data.injuryType).toLowerCase()}`,
        body: `${p.name} picked up ${String(e.data.injuryType).toLowerCase()} (${e.data.severity}). Expected recovery: ${e.data.min}–${e.data.max} days.${u.lineup?.includes(p.id) ? ' They are in your saved XI — the assistant will replace them unless you change it.' : ''}`,
        refs: { playerIds: [p.id], clubIds: [u.id] }, links: [{ label: 'Medical centre', page: 'medical' }, { label: 'Player profile', page: `player:${p.id}` }],
      });
      break;
    case 'PLAYER_RECOVERED':
      if (!p || p.clubId !== u.id) return;
      sendMessage(w, { eventId: e.id, from: staff(w, 'medical'), category: 'medical', priority: 'low', subject: `${p.name} is fit again`, body: `${p.name} has completed rehabilitation and is available for selection.`, refs: { playerIds: [p.id], clubIds: [u.id] }, links: [{ label: 'Squad', page: 'squad' }] });
      break;
    case 'PLAYER_ACQUIRED':
      // Auction signings are summarised once when the auction closes.
      if (!p || e.data.toClubId !== u.id || e.data.how === 'auction') return;
      sendMessage(w, { eventId: e.id, from: staff(w, 'scout'), category: 'contracts', priority: 'normal', subject: `${p.name} registered`, body: `${p.name} has joined the squad${Number(e.data.fee) ? ` for ₹${Number(e.data.fee).toFixed(2)} Cr` : ''} (${e.data.how}).`, refs: { playerIds: [p.id], clubIds: [u.id] }, links: [{ label: 'Player profile', page: `player:${p.id}` }] });
      break;
    case 'AUCTION_COMPLETED': {
      if (e.data.leagueId !== u.leagueId) return;
      const mine = w.ledger.filter((t) => t.season === w.season && t.toClubId === u.id && t.kind === 'auction');
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'scout'), category: 'auction', priority: 'normal',
        subject: `Auction complete: ${mine.length} signing${mine.length === 1 ? '' : 's'}`,
        body: mine.length ? mine.sort((a, b) => b.fee - a.fee).map((t) => `• ${w.players[t.playerId]?.name} — ₹${t.fee.toFixed(2)} Cr`).join('\n') : 'You did not sign anyone at the auction.',
        refs: { playerIds: mine.map((t) => t.playerId), clubIds: [u.id] }, links: [{ label: 'Squad', page: 'squad' }, { label: 'Auction summary', page: 'auction' }],
      });
      break;
    }
    case 'CONTRACT_SIGNED':
      if (!p || !mine) return;
      sendMessage(w, { eventId: e.id, from: staff(w, 'scout'), category: 'contracts', priority: 'low', subject: `${p.name} retained`, body: `${p.name} is retained for ₹${Number(e.data.fee).toFixed(2)} Cr.`, refs: { playerIds: [p.id], clubIds: [u.id] }, links: [{ label: 'Player profile', page: `player:${p.id}` }] });
      break;
    case 'MATCH_UPCOMING': {
      const d = e.data as Record<string, any>;
      sendMessage(w, {
        eventId: e.id, from: staff(w, 'head'), category: 'match', priority: 'normal',
        subject: `Preview: ${d.homeName} v ${d.awayName}`,
        body: [
          `${d.stage} at ${d.venue}. ${d.opponentName}'s last five: ${d.opponentForm || 'no matches yet'}.`,
          d.injured ? `Unavailable: ${d.injured}.` : 'No injuries in the squad.',
          d.promises ? `Promises to keep in mind: ${d.promises}` : '',
          'Pick your XI in the Match Centre.',
        ].filter(Boolean).join('\n'),
        refs: { clubIds: e.refs.clubIds, fixtureId: e.refs.fixtureId }, links: [{ label: 'Match Centre', page: 'match' }, { label: 'Opponent dossier', page: `club/${d.opponentId}` }],
      });
      break;
    }
    case 'SEASON_STARTED':
      sendMessage(w, { eventId: e.id, from: { name: `${e.data.leagueName} operations`, role: 'Competition administration' }, category: 'competition', priority: 'normal', subject: `${w.season} fixtures released`, body: `The ${w.season} ${e.data.leagueName} fixture list is out: ${e.data.matches} league matches for ${u.name}.`, refs: { clubIds: [u.id] }, links: [{ label: 'Fixtures', page: 'fixtures' }] });
      break;
    case 'CLUB_QUALIFIED':
      if (!mine) return;
      sendMessage(w, { eventId: e.id, from: { name: 'World Club Championship', role: 'Competition administration' }, category: 'competition', priority: 'high', subject: 'Qualified for the World Club Championship', body: `${u.name} will take part in the ${w.season} World Club Championship.`, refs: { clubIds: [u.id] }, links: [{ label: 'World cricket', page: 'world' }] });
      break;
    case 'MANAGER_DISMISSED':
      sendMessage(w, { eventId: e.id, from: { name: w.clubs[e.refs.clubIds[0]]?.name ?? 'Former club', role: 'Board of directors' }, category: 'board', priority: 'urgent', subject: 'Your contract has been terminated', body: String(e.data.reason ?? 'The board has ended your contract.'), refs: { clubIds: e.refs.clubIds }, links: [{ label: 'Boardroom', page: 'board' }] });
      break;
    default:
      break;
  }
}

/** Apply the chosen response to an inbox message through the owning system. */
export function respondToMessage(w: WorldState, id: string, optionId: string, ops: { story: (storyId: string, index: number) => string | null }): { ok: boolean; error?: string; outcome?: string } {
  const m = cw(w).inbox.find((x) => x.id === id);
  if (!m || !m.response) return { ok: false, error: 'This message has no decision.' };
  if (m.response.chosen) return { ok: false, error: 'You have already responded.' };
  const opt = m.response.options.find((o) => o.id === optionId);
  if (!opt) return { ok: false, error: 'Unknown option.' };
  const pl = m.response.payload ?? {};
  let outcome = '';
  switch (m.response.kind) {
    case 'conversation': {
      const r = replyToConversation(w, pl.conversationId, optionId);
      if (!r.ok) return r;
      return { ok: true, outcome: r.outcome };
    }
    case 'board-warning': outcome = respondToBoard(w, optionId); break;
    case 'media-request': outcome = respondToMedia(w, pl, optionId); break;
    case 'discipline': outcome = respondToDiscipline(w, pl, optionId); break;
    case 'promise-at-risk':
      if (optionId === 'explain') releasePromise(w, pl.promiseId, 'Explained: the player was unavailable.');
      outcome = optionId === 'explain' ? 'Promise released after an explanation.' : 'The promise stays open.';
      break;
    case 'story': {
      const err = ops.story(pl.storyId, Number(optionId));
      if (err) return { ok: false, error: err };
      outcome = opt.label;
      break;
    }
    default:
      return { ok: false, error: 'Unknown decision.' };
  }
  m.response.chosen = optionId;
  m.response.outcome = outcome;
  m.read = true;
  return { ok: true, outcome };
}

/** Daily: decisions that passed their deadline take the default (silent) outcome. */
export function inboxDaily(w: WorldState) {
  for (const m of cw(w).inbox) {
    const r = m.response;
    if (!r || r.chosen || !r.deadline || !isPast(w, r.deadline) || r.kind === 'conversation') continue;
    const fallback = r.options.find((o) => o.id === 'none' || o.id === 'accept' || o.id === 'ignore' || o.id === 'keep');
    if (r.kind === 'media-request') r.outcome = respondToMedia(w, r.payload ?? {}, 'none');
    else if (r.kind === 'discipline') r.outcome = respondToDiscipline(w, r.payload ?? {}, 'ignore');
    else r.outcome = 'No response before the deadline.';
    r.chosen = fallback?.id ?? 'expired';
  }
}

export function mirrorStory(w: WorldState, story: { id: string; kicker: string; title: string; body: string; severity: string; playerIds: string[]; clubIds: string[]; trigger: string; actions: { label: string; kind: string; payload?: Record<string, string> }[] }) {
  const injury = story.kicker.includes('BLOW');
  const category: InboxMessage['category'] = injury ? 'medical' : story.kicker.includes('GENERATION') || story.kicker.includes('CAP') ? 'coaching' : story.kicker.includes('AUCTION') ? 'auction' : story.kicker.includes('UNSETTLED') ? 'player' : story.kicker.includes('PRESSURE') || story.kicker.includes('FALLING') ? 'board' : 'news';
  const actionable = story.actions.filter((a) => a.kind !== 'dismiss' && a.kind !== 'open-player' && a.kind !== 'open-page' && a.kind !== 'compare');
  sendMessage(w, {
    eventId: null, storyId: story.id, from: injury ? staff(w, 'medical') : category === 'coaching' ? staff(w, 'scout') : staff(w, 'analyst'), category,
    priority: story.severity === 'major' ? 'high' : story.severity === 'notable' ? 'normal' : 'low',
    subject: story.title, body: story.body, refs: { playerIds: story.playerIds, clubIds: story.clubIds },
    links: story.actions.filter((a) => a.kind === 'open-player' || a.kind === 'open-page').map((a) => ({ label: a.label, page: a.kind === 'open-player' ? `player:${a.payload!.playerId}` : a.payload!.page })),
    ...(actionable.length ? { response: { kind: 'story', required: false, deadline: null, payload: { storyId: story.id }, options: story.actions.map((a, i) => ({ id: String(i), label: a.label })).filter((_, i) => story.actions[i].kind !== 'open-player' && story.actions[i].kind !== 'open-page' && story.actions[i].kind !== 'compare') } } : {}),
  });
}

subscribe(onEvent);
