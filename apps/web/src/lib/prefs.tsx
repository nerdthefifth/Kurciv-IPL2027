import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Lightweight per-device preferences (localStorage). Career data never lives here. */
export interface Prefs {
  theme: 'dark' | 'light' | 'system';
  sound: boolean;
  animations: boolean;
  /** Ask before bids at or above this many crore (null = never ask). */
  largeBidConfirm: number | null;
  images: boolean;
  auctionSpeed: 1 | 2 | 4;
  sidebarCollapsed: boolean;
  lastCareerId: string | null;
  seenLocalDataNotice: boolean;
}

const DEFAULTS: Prefs = {
  theme: 'dark', sound: true, animations: true, largeBidConfirm: 15, images: true, auctionSpeed: 1, sidebarCollapsed: false, lastCareerId: null, seenLocalDataNotice: false,
};
const KEY = 'kurciv.prefs.v1';

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const Ctx = createContext<{ prefs: Prefs; set: (patch: Partial<Prefs>) => void }>({ prefs: DEFAULTS, set: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(read);
  const set = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage blocked: preferences simply don't persist
      }
      return next;
    });
  }, []);
  useEffect(() => {
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.classList.toggle('reduced-motion', !prefs.animations);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme, prefs.animations]);
  return <Ctx.Provider value={{ prefs, set }}>{children}</Ctx.Provider>;
}

export const usePrefs = () => useContext(Ctx);
