import { describe, expect, it } from 'vitest';
import { leagueById } from '@kurciv/config';
import type { WorldState } from '@kurciv/domain';
import { pickXI } from '@kurciv/ai';
import {
  advance, advanceCascade, auctionAct, autoFillUserSquad, clubWorldSync, createWorld, cw, makePromise, objectiveProgress, primeClubWorld,
  raiseConversation, replyToConversation, squadOf, startSeason,
} from '../index';

function runAuctions(w: WorldState) {
  let guard = 0;
  while (!advanceCascade(w) && guard++ < 10) {
    const live = Object.values(w.auctions).find((a) => a.interactive && a.status === 'live')!;
    auctionAct(w, live.id, { type: 'sim', until: 'end', assistant: true }, live.version);
  }
  w.phase = 'preseason';
  autoFillUserSquad(w);
}

const snapshot = (w: WorldState) => {
  const c = cw(w);
  return [c.events.length, c.inbox.length, c.posts.length, c.conversations.length, c.promises.length, c.rumours.length, w.news.length].join('|');
};

describe('club world', () => {
  it('reacts to a real season with idempotent, source-linked, consistent content', () => {
    const w = createWorld({ careerId: 'cw', seed: 'club-world', managerName: 'Tester', difficulty: 'professional', clubId: 'MUM' });
    clubWorldSync(w); // auction phase: journalists publish auction rumours
    const auctionRumours = cw(w).rumours.filter((r) => r.context === 'auction');
    expect(auctionRumours.length).toBeGreaterThan(0);
    runAuctions(w);
    clubWorldSync(w);
    // The auction itself settles every report: none stays open, and none is a fact without a transaction.
    for (const r of auctionRumours) {
      expect(r.status).not.toBe('open');
      const signed = w.ledger.find((t) => t.playerId === r.subject.playerId && t.kind === 'auction' && t.season === w.season);
      if (r.status === 'confirmed') expect(signed?.toClubId).toBe(r.subject.clubId);
    }

    expect(startSeason(w)).toEqual([]);
    const u = w.clubs[w.userClubId];
    const l = leagueById(u.leagueId);
    const squad = squadOf(w, u);
    const xi = pickXI(squad, l.squadRules, l.domesticCountries);
    u.lineup = xi.map((p) => p.id);
    const bench = squad.find((p) => !u.lineup!.includes(p.id) && !p.injury)!;
    const starter = xi[0];
    const broken = makePromise(w, { to: { kind: 'player', id: bench.id }, kind: 'start-next', name: bench.name, conversationId: null, sourceEvent: 'test' });
    const kept = makePromise(w, { to: { kind: 'player', id: starter.id }, kind: 'start-next', name: starter.name, conversationId: null, sourceEvent: 'test' });
    const trustBefore = cw(w).relations[bench.id]?.trust;

    // Play to the first user match, with the saved XI.
    w.settings.autoPlayUserMatches = true;
    let guard = 0;
    while (!Object.values(w.fixtures).some((f) => f.involvesUser && f.status === 'complete') && guard++ < 60) advance(w, 'day');
    clubWorldSync(w);
    expect(broken.status).toBe('broken');
    expect(['fulfilled', 'void'].includes(kept.status) || starter.injury).toBeTruthy();
    if (trustBefore !== undefined) expect(cw(w).relations[bench.id].trust).toBeLessThan(trustBefore);
    // A broken promise makes the player raise it.
    expect(cw(w).conversations.some((c) => c.playerId === bench.id && c.topic === 'broken-promise')).toBe(true);

    // A conversation reply changes tracked state.
    const talker = squad.find((p) => !cw(w).conversations.some((c) => c.playerId === p.id && c.status === 'open'))!;
    const conv = raiseConversation(w, talker, 'playing-time', 'test', { streak: 3 })!;
    expect(conv).toBeTruthy();
    const nPromises = cw(w).promises.length;
    expect(replyToConversation(w, conv.id, 'promise-start').ok).toBe(true);
    expect(cw(w).promises.length).toBe(nPromises + 1);
    expect(conv.status).toBe('resolved');
    expect(replyToConversation(w, conv.id, 'decline').ok).toBe(false);

    advance(w, 'season');
    clubWorldSync(w);
    const c = cw(w);

    // Every completed fixture this season produced exactly one MATCH_COMPLETED event.
    const done = Object.values(w.fixtures).filter((f) => f.season === w.season && f.status === 'complete');
    const matchEvents = c.events.filter((e) => e.type === 'MATCH_COMPLETED' && e.season === w.season);
    expect(new Set(matchEvents.map((e) => e.refs.fixtureId)).size).toBe(matchEvents.length);
    expect(matchEvents.length).toBe(done.length);

    // Everything cites a recorded event, and events cite real records.
    const ids = new Set(c.events.map((e) => e.id));
    for (const p of c.posts) expect(ids.has(p.eventId)).toBe(true);
    for (const m of c.inbox.filter((x) => x.eventId)) expect(ids.has(m.eventId!)).toBe(true);
    for (const n of w.news.filter((x) => x.eventId)) expect(ids.has(n.eventId!)).toBe(true);
    for (const e of c.events) {
      if (e.source.startsWith('fixture:')) expect(w.fixtures[e.source.slice(8)]).toBeTruthy();
      if (e.source.startsWith('ledger:')) expect(w.ledger.some((t) => t.id === e.source.slice(7))).toBe(true);
      if (e.type === 'PLAYER_MILESTONE_REACHED' && String(e.data.what).startsWith('a century')) {
        const fx = w.fixtures[e.refs.fixtureId!];
        expect(fx.result!.innings.flatMap((i) => i.batting).some((b) => b.playerId === e.refs.playerIds[0] && b.runs >= 100)).toBe(true);
      }
    }
    // One article per event at most; one post per account per event.
    const newsPerEvent = w.news.filter((n) => n.eventId).map((n) => `${n.eventId}|${n.kind}|${n.headline}`);
    expect(new Set(newsPerEvent).size).toBe(newsPerEvent.length);
    const postKeys = c.posts.filter((p) => !p.replyTo).map((p) => `${p.eventId}|${p.accountId}`);
    expect(new Set(postKeys).size).toBe(postKeys.length);
    // Real people never post: only fictional generated players have accounts.
    for (const a of c.accounts.filter((x) => x.kind === 'player')) expect(['generated', 'youth']).toContain(w.players[a.playerId!].source);

    // The board judged results: history, objective progress and a mid-season review.
    expect(c.boards[u.id].history.length).toBeGreaterThan(5);
    expect(objectiveProgress(w, u).length).toBe(u.board.objectives.length);
    expect(c.inbox.some((m) => m.subject.startsWith('Mid-season review'))).toBe(true);

    // Refreshing, reloading or repeating a transition creates nothing new.
    const before = snapshot(w);
    clubWorldSync(w);
    clubWorldSync(w);
    expect(snapshot(w)).toBe(before);
    const reloaded = JSON.parse(JSON.stringify(w)) as WorldState;
    clubWorldSync(reloaded);
    expect(snapshot(reloaded)).toBe(before);

    // Upgrading an old save primes the cursors: history is not replayed as new events.
    const old = JSON.parse(JSON.stringify(w)) as WorldState & { clubWorld?: unknown };
    delete (old as { clubWorld?: unknown }).clubWorld;
    primeClubWorld(old as WorldState);
    clubWorldSync(old as WorldState);
    expect(cw(old as WorldState).events.filter((e) => e.type === 'MATCH_COMPLETED').length).toBe(0);
  });
});
