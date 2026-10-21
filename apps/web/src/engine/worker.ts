/// <reference lib="webworker" />
import { AppError, Backend, IndexedDBAdapter, MemoryAdapter, type PersistenceAdapter } from '@kurciv/app-core';

/**
 * The game engine runs here, off the main thread, so long simulations never freeze the UI.
 * Careers are stored in IndexedDB in this browser profile. If IndexedDB is unavailable
 * (some private-browsing modes), the game still runs from memory and says so clearly.
 */

declare const self: DedicatedWorkerGlobalScope;

type Req = { id: number; method: string; path: string; body?: unknown };

let backend: Backend | null = null;
let storageMode: 'indexeddb' | 'memory' = 'indexeddb';
const ready = (async () => {
  let store: PersistenceAdapter;
  try {
    const idb = new IndexedDBAdapter();
    await idb.open();
    store = idb;
  } catch (e) {
    storageMode = 'memory';
    store = new MemoryAdapter();
    self.postMessage({ type: 'storage', mode: 'memory', reason: (e as Error)?.message ?? 'IndexedDB unavailable' });
  }
  backend = new Backend(store, (s) => self.postMessage({ type: 'save', status: s }));
  self.postMessage({ type: 'storage', mode: storageMode });
})();

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, method, path, body } = ev.data;
  try {
    await ready;
    if (path === '/storage') {
      self.postMessage({ id, ok: true, data: { mode: storageMode, estimate: await IndexedDBAdapter.estimate() } });
      return;
    }
    const data = await backend!.handle(method, path, body);
    self.postMessage({ id, ok: true, data });
  } catch (e) {
    const err = e instanceof AppError ? e : null;
    self.postMessage({ id, ok: false, status: err?.status ?? 500, code: err?.code, error: err?.message ?? `Unexpected error: ${(e as Error)?.message ?? e}` });
  }
};
