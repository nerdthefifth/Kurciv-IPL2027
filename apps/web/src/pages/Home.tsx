import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PHASE_LABEL, relativeTime, useApi } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { useStorageMode } from '../lib/context';
import { ClubCrest } from '../components/media';
import { Icon } from '../components/icons';
import { Modal, Segmented } from '../components/ui';

/** Original title art: floodlit stadium arcs and a pitch strip, drawn in code. */
function StadiumArt() {
  return (
    <svg viewBox="0 0 800 520" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="glow" cx="50%" cy="95%" r="70%">
          <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity="0.18" />
          <stop offset="0.55" stopColor="rgb(var(--forest))" stopOpacity="0.16" />
          <stop offset="1" stopColor="rgb(var(--bg))" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--text))" stopOpacity="0.09" />
          <stop offset="1" stopColor="rgb(var(--text))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="520" fill="url(#glow)" />
      {[120, 680].map((x) => (
        <g key={x}>
          <path d={`M${x} 40 L${x - 160} 520 L${x + 160} 520 Z`} fill="url(#beam)" />
          <rect x={x - 22} y="26" width="44" height="14" rx="3" fill="rgb(var(--text))" opacity="0.18" />
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse key={i} cx="400" cy="560" rx={210 + i * 95} ry={130 + i * 52} fill="none" stroke="rgb(var(--text))" strokeOpacity={0.05 + (4 - i) * 0.012} strokeWidth="1.2" />
      ))}
      <rect x="388" y="420" width="24" height="100" rx="2" fill="rgb(var(--warn))" opacity="0.16" />
    </svg>
  );
}

export function HomePage() {
  const nav = useNavigate();
  const { prefs, set } = usePrefs();
  const storage = useStorageMode();
  const careers = useApi<{ careers: any[] }>('/careers');
  const [settings, setSettings] = useState(false);
  const list = [...(careers.data?.careers ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const last = list.find((c) => c.id === prefs.lastCareerId) ?? list[0];
  return (
    <div className="grain relative min-h-screen overflow-hidden bg-obsidian-950">
      <StadiumArt />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 md:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <div className="leading-none">
              <div className="font-display text-xl font-bold tracking-wider">KURCIV</div>
              <div className="text-[10px] font-semibold tracking-[0.3em] text-lime">IPL 2027</div>
            </div>
          </div>
          <button className="btn-quiet" onClick={() => setSettings(true)}><Icon name="settings" /> Settings</button>
        </header>

        <main className="flex flex-1 flex-col justify-center py-12">
          <div className="kicker rise">A cricket management story</div>
          <h1 className="headline rise mt-3 max-w-3xl text-5xl leading-[1.04] md:text-7xl">Every season writes a legacy.</h1>
          <p className="rise mt-5 max-w-xl text-base text-ink-muted md:text-lg">
            Build a franchise through retentions and a live auction, shape it ball by ball, and carry it from your league to the World Club Championship.
          </p>

          <div className="rise mt-9 flex flex-wrap gap-3">
            {last ? (
              <button className="btn-primary px-6 py-3 text-base" onClick={() => nav(`/c/${last.id}`)}>
                <Icon name="play" /> Continue {last.clubShort} · {last.season}
              </button>
            ) : (
              <Link to="/new" className="btn-primary px-6 py-3 text-base"><Icon name="play" /> Enter your cricket world</Link>
            )}
            <Link to="/new" className="btn-ghost px-5 py-3"><Icon name="plus" /> Create career</Link>
            <Link to="/saves" className="btn-ghost px-5 py-3"><Icon name="save" /> Load career</Link>
            <Link to="/saves" className="btn-quiet px-4 py-3">Manage saves</Link>
          </div>

          {last && (
            <button onClick={() => nav(`/c/${last.id}`)} className="panel rise mt-10 flex max-w-xl items-center gap-4 p-4 text-left transition-colors hover:border-obsidian-500">
              <ClubCrest club={{ id: last.clubId, name: last.clubName, shortName: last.clubShort, colors: last.colors, leagueId: last.leagueId }} size={52} />
              <div className="min-w-0 flex-1">
                <div className="kicker">Last played {relativeTime(last.updatedAt)}</div>
                <div className="mt-0.5 truncate font-semibold">{last.clubName}</div>
                <div className="text-sm text-ink-muted">
                  {last.managerName} · Season {last.season} · {PHASE_LABEL[last.phase] ?? last.phase}
                  {last.position ? ` · ${last.position}${ordinal(last.position)} in ${last.leagueName}` : ''}
                </div>
                {last.nextFixture && <div className="mt-1 text-xs text-ink-faint">Next: {last.nextFixture}</div>}
              </div>
              <Icon name="chevronRight" className="text-ink-faint" />
            </button>
          )}
        </main>

        <footer className="space-y-3 text-xs text-ink-faint">
          {storage.mode === 'memory' ? (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-ink">
              <b>Storage unavailable.</b> This browser is blocking local storage (often private browsing), so careers will be lost when you close the tab. Export a backup to keep your progress.
            </p>
          ) : !prefs.seenLocalDataNotice ? (
            <p className="flex flex-wrap items-center gap-3 rounded-lg border border-obsidian-700 bg-obsidian-900/80 px-3 py-2 text-ink-muted">
              <Icon name="info" />
              <span className="flex-1">No account needed. Careers are saved on this device in this browser. Clearing site data removes them — export a backup from Manage saves to keep a copy.</span>
              <button className="btn-quiet px-2 py-1 text-xs" onClick={() => set({ seenLocalDataNotice: true })}>Got it</button>
            </p>
          ) : null}
          <p>Kurciv is an independent fan game. League, club and player names are used descriptively; logos and photographs come from TheSportsDB and Wikimedia Commons with credit and remain the property of their owners. Generated players are fictional.</p>
        </footer>
      </div>
      <QuickSettings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

export function QuickSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set } = usePrefs();
  return (
    <Modal open={open} title="Settings" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <div className="label mb-2">Theme</div>
          <Segmented label="Theme" value={prefs.theme} onChange={(theme) => set({ theme })} options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }]} />
        </div>
        <Toggle label="Sound effects" hint="Gavel, bids and match moments." value={prefs.sound} onChange={(sound) => set({ sound })} />
        <Toggle label="Animations" hint="Turn off for reduced motion." value={prefs.animations} onChange={(animations) => set({ animations })} />
        <Toggle label="Real logos and photos" hint="Fetched from TheSportsDB and Wikimedia Commons and cached on this device." value={prefs.images} onChange={(images) => set({ images })} />
      </div>
    </Modal>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${value ? 'border-lime bg-lime' : 'border-obsidian-600 bg-obsidian-700'}`}>
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all ${value ? 'left-[22px] bg-obsidian-950' : 'left-0.5 bg-ink-muted'}`} />
        <span className="sr-only">{label}</span>
      </button>
    </label>
  );
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
