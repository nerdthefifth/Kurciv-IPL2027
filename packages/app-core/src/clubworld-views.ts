import type { InboxMessage, NewsItem, SocialPost, WorldState } from '@kurciv/domain';
import { overall } from '@kurciv/domain';
import { leagueById } from '@kurciv/config';
import {
  STANDING_LABEL, STYLE_LABEL, band, boardOf, cw, dismissalThreshold, eventById, feedAccount, isVisible, objectiveProgress, relationOf, standingOf, visiblePosts,
} from '@kurciv/world';

/** Read-only views for the Club World screens. Nothing here creates or changes content. */

const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

function actionable(m: InboxMessage) {
  return !!m.response && !m.response.chosen;
}

export function inboxCounts(w: WorldState) {
  const msgs = cw(w).inbox.filter((m) => isVisible(w, m) && !m.archived);
  return {
    unread: msgs.filter((m) => !m.read).length,
    urgent: msgs.filter((m) => !m.read && (m.priority === 'urgent' || m.priority === 'high')).length,
    actions: msgs.filter(actionable).length,
    talks: cw(w).conversations.filter((c) => c.status === 'open' && isVisible(w, c)).length,
  };
}

const names = (w: WorldState, ids: string[]) => ids.map((id) => ({ id, name: w.players[id]?.name ?? w.clubs[id]?.name ?? id }));

export function inboxView(w: WorldState, q: { box?: string; category?: string; search?: string }) {
  const s = q.search?.toLowerCase().trim();
  const all = cw(w).inbox.filter((m) => isVisible(w, m));
  const list = all
    .filter((m) => (q.box === 'archived' ? m.archived : !m.archived))
    .filter((m) => (q.box === 'actions' ? actionable(m) : q.box === 'pinned' ? m.pinned : q.box === 'unread' ? !m.read : true))
    .filter((m) => !q.category || q.category === 'all' || m.category === q.category)
    .filter((m) => !s || `${m.subject} ${m.body} ${m.from.name}`.toLowerCase().includes(s))
    // Pinned first, then decisions with the nearest deadline, then priority, then newest.
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(actionable(b)) - Number(actionable(a))
      || (a.response?.deadline?.day ?? 9e9) - (b.response?.deadline?.day ?? 9e9)
      || PRIORITY[a.priority] - PRIORITY[b.priority] || b.season - a.season || b.day - a.day || b.id.localeCompare(a.id))
    .slice(0, 200);
  const byCategory: Record<string, number> = {};
  for (const m of all.filter((x) => !x.archived && !x.read)) byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  return {
    today: { season: w.season, day: w.day },
    counts: { ...inboxCounts(w), byCategory },
    messages: list.map((m) => ({ ...m, event: eventById(w, m.eventId) ? { id: m.eventId, type: eventById(w, m.eventId)!.type, source: eventById(w, m.eventId)!.source } : null, people: names(w, m.refs.playerIds) })),
  };
}

const NEWS_FILTERS: Record<string, (w: WorldState, n: NewsItem) => boolean> = {
  all: () => true,
  club: (w, n) => n.clubIds.includes(w.userClubId),
  followed: (w, n) => n.playerIds.some((p) => cw(w).follows.players.includes(p)) || n.clubIds.some((c) => cw(w).follows.clubs.includes(c)),
  league: (w, n) => n.clubIds.some((c) => w.clubs[c]?.leagueId === w.clubs[w.userClubId].leagueId),
  international: (_w, n) => n.kind === 'qualification' || /World Club/.test(n.headline + n.body),
  auctions: (_w, n) => n.kind === 'auction',
  injuries: (_w, n) => n.kind === 'injury',
  major: (_w, n) => n.importance >= 2,
};

export function newsView(w: WorldState, q: { filter?: string; page?: number }) {
  const f = NEWS_FILTERS[q.filter ?? 'all'] ?? NEWS_FILTERS.all;
  const items = w.news.filter((n) => f(w, n));
  const page = q.page ?? 0;
  return {
    total: items.length,
    items: items.slice(page * 40, page * 40 + 40).map((n) => {
      const e = eventById(w, n.eventId);
      return {
        ...n, level: n.level ?? (n.importance === 3 ? 'feature' : n.importance === 2 ? 'article' : 'brief'),
        players: names(w, n.playerIds), clubs: n.clubIds.map((id) => ({ id, name: w.clubs[id]?.name ?? id, shortName: w.clubs[id]?.shortName ?? id })),
        event: e ? { id: e.id, type: e.type, source: e.source } : null,
        followUp: n.followUpOf ? w.news.find((x) => x.id === n.followUpOf)?.headline ?? null : null,
        fixtureId: w.fixtures[n.sourceRef] ? n.sourceRef : e?.refs.fixtureId ?? null,
      };
    }),
    follows: cw(w).follows,
  };
}

export function conversationsView(w: WorldState) {
  const c = cw(w);
  const u = w.clubs[w.userClubId];
  const squad = u.squad.map((id) => w.players[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a));
  return {
    conversations: c.conversations.filter((x) => isVisible(w, x)).slice(0, 80).map((x) => ({ ...x, player: { id: x.playerId, name: w.players[x.playerId]?.name ?? 'Former player', shortName: w.players[x.playerId]?.shortName ?? '' } })),
    promises: c.promises.slice(0, 80).map((p) => ({ ...p, toName: p.to.kind === 'board' ? `${w.clubs[p.to.id]?.name ?? 'Board'} board` : w.players[p.to.id]?.name ?? 'Former player' })),
    squad: squad.map((p) => {
      const r = relationOf(w, p);
      return {
        id: p.id, name: p.name, personality: p.personality, morale: Math.round(p.morale), standing: STANDING_LABEL[standingOf(w, p)],
        trust: r.trust, ambition: r.ambition, professionalism: r.professionalism, loyalty: r.loyalty, confidence: r.confidence,
        benchStreak: p.benchStreak, lastTalk: r.lastTalk, recent: r.history.slice(-3).reverse(),
        open: c.conversations.some((x) => x.playerId === p.id && x.status === 'open'),
        promises: c.promises.filter((x) => x.to.id === p.id && x.status === 'active').length,
      };
    }),
  };
}

export function boardView(w: WorldState) {
  const u = w.clubs[w.userClubId];
  const b = boardOf(w, u);
  const bd = band(u.board.confidence);
  return {
    club: { id: u.id, name: u.name, league: leagueById(u.leagueId).shortName },
    profile: { ...b, styleLabel: STYLE_LABEL[b.style] },
    confidence: Math.round(u.board.confidence), band: bd, warnings: u.board.warnings, threshold: dismissalThreshold(b),
    objectives: objectiveProgress(w, u),
    history: b.history.slice(-40),
    reviews: b.reviews.slice(-6).reverse(),
    promises: cw(w).promises.filter((p) => p.to.kind === 'board').slice(0, 10),
    media: { pressure: cw(w).media.pressure, history: cw(w).media.history.slice(-12).reverse() },
    rules: [
      'Confidence moves after every match by how the result compares with what was expected (from team ratings).',
      'Weekly: finances, dressing-room morale and media pressure, weighted by the board’s personality.',
      'Season review: objectives met or missed. Below 25 adds a warning; above 50 clears them.',
      `Dismissal: only at a season review, with two warnings on record and confidence below ${dismissalThreshold(b)} (this board’s patience ${b.patience}/100).`,
    ],
  };
}

const FEED_FILTERS: Record<string, (w: WorldState, p: SocialPost) => boolean> = {
  all: () => true,
  club: (w, p) => p.refs.clubIds.includes(w.userClubId),
  following: (w, p) => cw(w).feed.following.includes(p.accountId) || p.refs.playerIds.some((x) => cw(w).follows.players.includes(x)),
  matchday: (_w, p) => p.tags.includes('matchday') || p.tags.includes('result') || p.tags.includes('stats'),
  recruitment: (_w, p) => p.tags.includes('recruitment') || p.tags.includes('auction') || p.tags.includes('rumour'),
  world: (w, p) => !p.refs.clubIds.some((c) => w.clubs[c]?.leagueId === w.clubs[w.userClubId].leagueId),
  saved: (w, p) => cw(w).feed.saved.includes(p.id),
};

export function feedView(w: WorldState, q: { filter?: string; page?: number }) {
  const f = FEED_FILTERS[q.filter ?? 'all'] ?? FEED_FILTERS.all;
  const c = cw(w);
  const posts = visiblePosts(w).filter((p) => f(w, p)).sort((a, b) => b.season - a.season || b.day - a.day || b.id.localeCompare(a.id));
  const page = q.page ?? 0;
  return {
    total: posts.length,
    posts: posts.slice(page * 40, page * 40 + 40).map((p) => {
      const a = feedAccount(w, p.accountId)!;
      const r = p.rumourId ? c.rumours.find((x) => x.id === p.rumourId) : null;
      const reply = p.replyTo ? c.posts.find((x) => x.id === p.replyTo) : null;
      return {
        ...p, account: a, saved: c.feed.saved.includes(p.id), following: c.feed.following.includes(a.id),
        players: names(w, p.refs.playerIds), clubs: p.refs.clubIds.map((id) => ({ id, shortName: w.clubs[id]?.shortName ?? id })),
        rumour: r ? { status: r.status, reliability: r.reliability, outcome: r.outcome ?? null } : null,
        replyTo: reply ? { text: reply.text, handle: feedAccount(w, reply.accountId)?.handle } : null,
      };
    }),
    accounts: c.accounts.filter((a) => a.kind !== 'supporters' || a.clubId === w.userClubId).sort((a, b) => b.followers - a.followers).slice(0, 40)
      .map((a) => ({ ...a, following: c.feed.following.includes(a.id) })),
    muted: c.feed.muted,
    topics: ['matchday', 'result', 'stats', 'selection', 'injury', 'recruitment', 'auction', 'rumour', 'pressure', 'board', 'milestone', 'press'],
    rumours: c.rumours.slice(0, 20).map((r) => ({ ...r, source: feedAccount(w, r.sourceAccountId)?.name ?? '', player: w.players[r.subject.playerId]?.name ?? '', club: w.clubs[r.subject.clubId]?.name ?? '' })),
  };
}
