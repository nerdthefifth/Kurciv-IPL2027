import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './index';

let server: Server;
let base = '';

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any };
  }
}

beforeAll(async () => {
  const { app } = createApp(':memory:');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

describe('API', () => {
  it('plays an auction, a season day and a live match end-to-end', async () => {
    const a = new Client();
    expect((await a.call('POST', '/auth/register', { username: 'alice', password: 'correct horse' })).status).toBe(200);
    expect((await a.call('GET', '/careers')).body.careers).toEqual([]);
    const created = await a.call('POST', '/careers', { managerName: 'Alice', difficulty: 'professional', clubId: 'CHE', seed: 'api-test' });
    expect(created.status).toBe(200);
    const cid = created.body.id;

    // Another user cannot see or touch it, whatever id they send.
    const mallory = new Client();
    await mallory.call('POST', '/auth/register', { username: 'mallory', password: 'password123' });
    expect((await mallory.call('GET', `/careers/${cid}`)).status).toBe(404);
    expect((await mallory.call('POST', `/careers/${cid}/continue`, { mode: 'next' })).status).toBe(404);
    expect((await new Client().call('GET', `/careers/${cid}`)).status).toBe(401);

    // Live auction: bid on the first lot we can, verify server validation, then let the assistant finish.
    let auc = (await a.call('GET', `/careers/${cid}/auction`)).body;
    expect(auc.auction.status).toBe('live');
    const stale = await a.call('POST', `/careers/${cid}/auction/act`, { version: auc.auction.version - 1, action: { type: 'pass' } });
    expect(stale.status).toBe(409);
    if (auc.auction.bidState?.canBid) {
      const bid = await a.call('POST', `/careers/${cid}/auction/act`, { version: auc.auction.version, action: { type: 'bid' } }, { 'Idempotency-Key': 'bid-1' });
      expect(bid.status).toBe(200);
      const again = await a.call('POST', `/careers/${cid}/auction/act`, { version: auc.auction.version, action: { type: 'bid' } }, { 'Idempotency-Key': 'bid-1' });
      expect(again.body).toEqual(bid.body); // replayed, not double-applied
      auc = (await a.call('GET', `/careers/${cid}/auction`)).body;
    }
    const sim = await a.call('POST', `/careers/${cid}/auction/act`, { version: auc.auction.version, action: { type: 'sim', until: 'end', assistant: true } });
    expect(sim.status).toBe(200);
    expect(sim.body.phase).toBe('preseason');

    const squad = (await a.call('GET', `/careers/${cid}/squad`)).body;
    if (squad.problems.length) await a.call('POST', `/careers/${cid}/transfers/autofill`, {});
    const start = await a.call('POST', `/careers/${cid}/continue`, { mode: 'next' });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body.phase).toBe('season');

    const toMatch = await a.call('POST', `/careers/${cid}/continue`, { mode: 'next' });
    expect(toMatch.body.stoppedFor).toBe('user-match');
    const fixtureId = toMatch.body.fixtureId;
    expect((await a.call('POST', `/careers/${cid}/continue`, { mode: 'next' })).body.stoppedFor).toBe('user-match');

    // Live match, ball by ball with decisions.
    expect((await a.call('POST', `/careers/${cid}/match/start`, { fixtureId })).status).toBe(200);
    expect((await a.call('POST', `/careers/${cid}/continue`, { mode: 'next' })).status).toBe(409);
    let live = (await a.call('GET', `/careers/${cid}/match`)).body.live;
    let version = live.version;
    let guard = 0;
    let decisions = 0;
    while (live.state.status !== 'complete' && guard++ < 400) {
      const r = await a.call('POST', `/careers/${cid}/match/step`, { mode: 'over', version });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      version = r.body.version;
      live = { state: r.body.state };
      const n = r.body.needs;
      if (n) {
        decisions++;
        const action = n.kind === 'toss' ? { type: 'toss', decision: 'bowl' } : n.kind === 'bowler' ? { type: 'bowler', playerId: n.suggestion } : { type: 'review', review: false };
        const act = await a.call('POST', `/careers/${cid}/match/action`, { action, version });
        expect(act.status, JSON.stringify(act.body)).toBe(200);
        version = act.body.version;
      }
      if (guard === 3) {
        // An illegal bowler change is rejected with a reason.
        const bad = await a.call('POST', `/careers/${cid}/match/action`, { action: { type: 'bowler', playerId: 'nobody' }, version });
        expect(bad.status).toBe(400);
      }
    }
    expect(decisions).toBeGreaterThan(0);
    const fin = await a.call('POST', `/careers/${cid}/match/finish`, {});
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    const detail = await a.call('GET', `/careers/${cid}/fixtures/${fixtureId}`);
    expect(detail.body.fixture.status).toBe('complete');
    expect(detail.body.match.deliveries.length).toBeGreaterThan(200);
    // The recorded scorecard agrees with the fixture summary.
    const inns = detail.body.match.innings.filter((i: any) => !i.superOver);
    expect(inns.map((i: any) => i.runs)).toEqual(detail.body.result.innings.map((i: any) => i.runs));

    // Scenario lab never touches the canonical career.
    const before = (await a.call('GET', `/careers/${cid}`)).body.version;
    expect((await a.call('POST', `/careers/${cid}/lab/start`, { fixtureId, fromSeq: 60 })).status).toBe(200);
    const lab = (await a.call('GET', `/careers/${cid}/lab`)).body.live;
    expect(lab.experimental).toBe(true);
    expect((await a.call('GET', `/careers/${cid}`)).body.version).toBe(before);

    const intel = await a.call('GET', `/careers/${cid}/intel/MUM`);
    expect(intel.status).toBe(200);
    expect(intel.body.recommendations.length).toBeGreaterThan(0);
  }, 300_000);

  it('validates input', async () => {
    const c = new Client();
    expect((await c.call('POST', '/auth/register', { username: 'x', password: 'short' })).status).toBe(400);
    await c.call('POST', '/auth/register', { username: 'bob', password: 'longenough' });
    const bad = await c.call('POST', '/careers', { managerName: 'B', difficulty: 'impossible', clubId: 'MUM' });
    expect(bad.status).toBe(400);
    const both = await c.call('POST', '/careers', { managerName: 'Bob', difficulty: 'rookie' });
    expect(both.status).toBe(400);
  });
});
