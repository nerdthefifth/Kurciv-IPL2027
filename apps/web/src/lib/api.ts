import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ engine worker RPC

type Pending = { resolve: (v: any) => void; reject: (e: ApiError) => void };
export type SaveStatus = { state: 'saving' | 'saved' | 'error'; careerId: string; message?: string; at: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const saveListeners = new Set<(s: SaveStatus) => void>();
const storageListeners = new Set<(s: { mode: 'indexeddb' | 'memory'; reason?: string }) => void>();
export let storageState: { mode: 'indexeddb' | 'memory'; reason?: string } = { mode: 'indexeddb' };

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module', name: 'kurciv-engine' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'save') {
      for (const l of saveListeners) l(m.status);
      return;
    }
    if (m.type === 'storage') {
      storageState = { mode: m.mode, reason: m.reason };
      for (const l of storageListeners) l(storageState);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.data);
    else p.reject(new ApiError(m.status, m.error, m.code));
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new ApiError(0, `The game engine stopped unexpectedly (${e.message}). Reload the page — your last save is safe.`));
    pending.clear();
  };
  return worker;
}

/** Send a command or query to the local game engine. Nothing leaves this device. */
export function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, method, path, body: opts.body });
  });
}

export function onSaveStatus(fn: (s: SaveStatus) => void): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function onStorageMode(fn: (s: typeof storageState) => void): () => void {
  storageListeners.add(fn);
  return () => storageListeners.delete(fn);
}

// ------------------------------------------------------------------ data hook

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/** Fetches `path` (null = skip) and re-fetches when it or `deps` change. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seqRef = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seqRef.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seqRef.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seqRef.current) setError(e as ApiError);
    } finally {
      if (my === seqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

// ------------------------------------------------------------------ formatting

export const cr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `₹${v.toFixed(2)} Cr`);
export const crShort = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `₹${v >= 10 ? v.toFixed(1) : v.toFixed(2)}`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;

export const ROLE_LABEL: Record<string, string> = { BAT: 'Batter', WK: 'Wicketkeeper', AR: 'All-rounder', BOWL: 'Bowler' };
export const BOWL_LABEL: Record<string, string> = {
  RF: 'Right-arm fast', RFM: 'Right-arm fast-medium', RM: 'Right-arm medium', LF: 'Left-arm fast', LFM: 'Left-arm fast-medium', LM: 'Left-arm medium',
  OB: 'Off-break', LB: 'Leg-break', SLA: 'Slow left-arm orthodox', SLC: 'Left-arm wrist spin', NONE: 'Does not bowl',
};
export const PHASE_LABEL: Record<string, string> = {
  retention: 'Retention window', auction: 'Auction', preseason: 'Pre-season', season: 'Season', wcc: 'World Club Championship', offseason: 'Season review',
};

export function dayLabel(season: number, day: number): string {
  const d = new Date(Date.UTC(season, 0, 1 + day));
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
