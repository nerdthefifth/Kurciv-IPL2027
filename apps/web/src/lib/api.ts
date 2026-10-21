import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function idemKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (method !== 'GET' && opts.idempotent !== false) headers['Idempotency-Key'] = idemKey();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the Kurciv server. Is it running?');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`, json.code);
  return json as T;
}

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/** Fetches `path` (null = skip) and re-fetches when it changes. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e as ApiError);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const cr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `₹${v.toFixed(2)} Cr`);
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

/** Day-of-year → readable date in the career's season. */
export function dayLabel(season: number, day: number): string {
  const d = new Date(Date.UTC(season, 0, 1 + day));
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
