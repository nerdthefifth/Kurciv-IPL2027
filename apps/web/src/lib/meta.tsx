import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { configureImageLookup, registerClubs, setImagesEnabled } from './images';
import { setSoundEnabled } from './sound';
import { usePrefs } from './prefs';

/** Static game metadata (leagues, clubs, venues, fields) loaded once from the local engine. */
export type Meta = any;

const MetaCtx = createContext<Meta | null>(null);

export function MetaProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { prefs } = usePrefs();
  useEffect(() => setSoundEnabled(prefs.sound), [prefs.sound]);
  useEffect(() => setImagesEnabled(prefs.images), [prefs.images]);
  useEffect(() => {
    api<Meta>('/meta')
      .then((m) => {
        configureImageLookup(m.imageLookup);
        registerClubs(m.leagues.flatMap((l: any) => l.clubs.map((c: any) => ({ id: c.id, name: c.name, leagueId: l.id }))));
        setMeta(m);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="headline text-2xl">The game engine could not start</h1>
          <p className="text-sm text-ink-muted">{error}</p>
          <button className="btn-primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
  if (!meta) return <>{fallback}</>;
  return <MetaCtx.Provider value={meta}>{children}</MetaCtx.Provider>;
}

export function useMeta(): Meta {
  const m = useContext(MetaCtx);
  if (!m) throw new Error('useMeta outside MetaProvider');
  return m;
}

/** Finds a club (with its league id) from the static metadata, for crests in lists. */
export function useClubRef(clubId: string | null | undefined) {
  const meta = useMeta();
  if (!clubId) return null;
  for (const l of meta.leagues) {
    const c = l.clubs.find((x: any) => x.id === clubId);
    if (c) return { ...c, leagueId: l.id };
  }
  return null;
}
