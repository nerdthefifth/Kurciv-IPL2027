import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, useApi, type Loadable } from './api';

// ------------------------------------------------------------------ toasts

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto pop rounded-lg border px-4 py-3 text-sm shadow-xl ${
              t.kind === 'error' ? 'border-danger/50 bg-[#2a1012] text-[#ffd0d0]' : t.kind === 'ok' ? 'border-lime/40 bg-[#18210a] text-lime-400' : 'border-obsidian-600 bg-obsidian-800 text-ink'
            }`}
          >
            <span className="sr-only">{t.kind === 'error' ? 'Error: ' : t.kind === 'ok' ? 'Success: ' : ''}</span>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ session

interface User {
  id: string;
  username: string;
}

const AuthCtx = createContext<{ user: User | null; ready: boolean; setUser: (u: User | null) => void }>({ user: null, ready: false, setUser: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api<{ user: User | null }>('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);
  return <AuthCtx.Provider value={{ user, ready, setUser }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

// ------------------------------------------------------------------ career

export interface Overview {
  version: number;
  season: number;
  day: number;
  phase: string;
  managerName: string;
  club: any;
  nextFixture: any;
  recent: any[];
  position: any;
  table: any[];
  fitness: any[];
  news: any[];
  urgent: string[];
  finance: { purse: number; cash: number; payroll: number };
  settings: { autoPlayUserMatches: boolean; reducedMotion: boolean };
  difficulty: string;
}

interface CareerCtxValue {
  id: string;
  overview: Loadable<Overview>;
  /** Bumps after every mutation so pages re-fetch. */
  tick: number;
  refresh: () => void;
  mutate: <T = any>(path: string, body?: unknown, opts?: { method?: string; success?: string }) => Promise<T | null>;
  reducedMotion: boolean;
}

const CareerCtx = createContext<CareerCtxValue | null>(null);

export function CareerProvider({ id, children }: { id: string; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const overview = useApi<Overview>(`/careers/${id}`, [tick]);
  const toast = useToast();
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback(
    async <T,>(path: string, body?: unknown, opts: { method?: string; success?: string } = {}): Promise<T | null> => {
      try {
        const r = await api<T>(`/careers/${id}${path}`, { method: opts.method ?? 'POST', body: body ?? {} });
        if (opts.success) toast.push('ok', opts.success);
        setTick((t) => t + 1);
        return r;
      } catch (e) {
        toast.push('error', (e as Error).message);
        setTick((t) => t + 1);
        return null;
      }
    },
    [id, toast],
  );
  const reducedMotion = !!overview.data?.settings?.reducedMotion;
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  }, [reducedMotion]);
  const value = useMemo(() => ({ id, overview, tick, refresh, mutate, reducedMotion }), [id, overview, tick, refresh, mutate, reducedMotion]);
  return <CareerCtx.Provider value={value}>{children}</CareerCtx.Provider>;
}

export function useCareer(): CareerCtxValue {
  const v = useContext(CareerCtx);
  if (!v) throw new Error('useCareer outside career');
  return v;
}
