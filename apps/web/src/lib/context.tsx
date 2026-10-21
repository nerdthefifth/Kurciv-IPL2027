import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSaveStatus, onStorageMode, storageState, useApi, type Loadable, type SaveStatus } from './api';
import { usePrefs } from './prefs';

// ------------------------------------------------------------------ toasts

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string, action?: Toast['action']) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[100] flex w-[min(92vw,400px)] flex-col gap-2 lg:bottom-5" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rise flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lift ${
            t.kind === 'error' ? 'border-danger/40 bg-obsidian-900 text-ink' : t.kind === 'ok' ? 'border-lime/30 bg-obsidian-900 text-ink' : 'border-obsidian-600 bg-obsidian-900 text-ink'
          }`}>
            <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.kind === 'error' ? 'bg-danger' : t.kind === 'ok' ? 'bg-lime' : 'bg-info'}`} />
            <span className="flex-1">
              <span className="sr-only">{t.kind === 'error' ? 'Error: ' : ''}</span>
              {t.text}
            </span>
            {t.action && <button className="font-semibold text-lime hover:underline" onClick={t.action.run}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ save status

/** Reflects real IndexedDB transactions: "Saved locally" is only shown after a commit succeeds. */
export function useSaveStatus(careerId?: string): SaveStatus | null {
  const [s, setS] = useState<SaveStatus | null>(null);
  useEffect(() => onSaveStatus((x) => (!careerId || x.careerId === careerId) && setS(x)), [careerId]);
  return s;
}

export function useStorageMode() {
  const [s, setS] = useState(storageState);
  useEffect(() => onStorageMode(setS), []);
  return s;
}

// ------------------------------------------------------------------ career

export type Clubhouse = any;

interface CareerCtxValue {
  id: string;
  overview: Loadable<Clubhouse>;
  tick: number;
  refresh: () => void;
  mutate: <T = any>(path: string, body?: unknown, opts?: { method?: string; success?: string; quiet?: boolean }) => Promise<T | null>;
}

const CareerCtx = createContext<CareerCtxValue | null>(null);

export function CareerProvider({ id, children }: { id: string; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const overview = useApi<Clubhouse>(`/careers/${id}`, [tick]);
  const toast = useToast();
  const { set } = usePrefs();
  useEffect(() => set({ lastCareerId: id }), [id, set]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback(
    async <T,>(path: string, body?: unknown, opts: { method?: string; success?: string; quiet?: boolean } = {}): Promise<T | null> => {
      try {
        const r = await api<T>(`/careers/${id}${path}`, { method: opts.method ?? 'POST', body: body ?? {} });
        if (opts.success) toast.push('ok', opts.success);
        if (!opts.quiet) setTick((t) => t + 1);
        return r;
      } catch (e) {
        toast.push('error', (e as Error).message);
        setTick((t) => t + 1);
        return null;
      }
    },
    [id, toast],
  );
  const value = useMemo(() => ({ id, overview, tick, refresh, mutate }), [id, overview, tick, refresh, mutate]);
  return <CareerCtx.Provider value={value}>{children}</CareerCtx.Provider>;
}

export function useCareer(): CareerCtxValue {
  const v = useContext(CareerCtx);
  if (!v) throw new Error('useCareer outside career');
  return v;
}

export { api };
