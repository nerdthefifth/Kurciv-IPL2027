import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Backend } from './backend';
import { IndexedDBAdapter } from './idb-adapter';
import { fingerprint } from './portability';

describe('IndexedDB persistence', () => {
  it('saves, reloads after a "refresh", keeps careers independent and deletes cleanly', async () => {
    const name = `test-${Math.random()}`;
    const store = new IndexedDBAdapter(name);
    await store.open();
    const b = new Backend(store);
    const one = (await b.handle('POST', '/careers', { managerName: 'One', difficulty: 'rookie', clubId: 'CHE', seed: 'idb-1' })) as { id: string };
    const two = (await b.handle('POST', '/careers', { managerName: 'Two', difficulty: 'rookie', clubId: 'MUM', seed: 'idb-2' })) as { id: string };
    await b.handle('POST', `/careers/${one.id}/auction/sim`, { until: 'end', assistant: true });
    const printOne = fingerprint((await store.loadWorld(one.id))!);

    // New adapter + backend on the same database = page refresh
    const store2 = new IndexedDBAdapter(name);
    await store2.open();
    const b2 = new Backend(store2);
    const list = ((await b2.handle('GET', '/careers')) as any).careers;
    expect(list.map((c: any) => c.id).sort()).toEqual([one.id, two.id].sort());
    expect(fingerprint((await store2.loadWorld(one.id))!)).toBe(printOne);
    const home = (await b2.handle('GET', `/careers/${one.id}`)) as any;
    expect(home.phase).toBe('preseason');
    const twoHome = (await b2.handle('GET', `/careers/${two.id}`)) as any;
    expect(twoHome.phase).toBe('auction');

    await b2.handle('DELETE', `/careers/${two.id}`);
    expect(await store2.getMeta(two.id)).toBeNull();
    expect(await store2.loadWorld(two.id)).toBeNull();
    expect(await store2.getMeta(one.id)).not.toBeNull();
  }, 180_000);

  it('rejects a stale write (another tab saved first)', async () => {
    const store = new IndexedDBAdapter(`test-${Math.random()}`);
    await store.open();
    const b = new Backend(store);
    const { id } = (await b.handle('POST', '/careers', { managerName: 'Xavi', difficulty: 'rookie', clubId: 'CHE', seed: 'stale' })) as { id: string };
    const meta = (await store.getMeta(id))!;
    const world = (await store.loadWorld(id))!;
    await store.commit({ ...meta, version: meta.version + 1 }, world, [], meta.version);
    await expect(store.commit({ ...meta, version: meta.version + 1 }, world, [], meta.version)).rejects.toThrow(/changed elsewhere/);
  });
});
