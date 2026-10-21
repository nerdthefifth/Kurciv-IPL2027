import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PHASE_LABEL, cr, dayLabel } from '../lib/api';
import { useCareer } from '../lib/context';
import { Confirm } from './ui';

const NAV: { to: string; label: string; icon: string }[] = [
  { to: '', label: 'Overview', icon: '◉' },
  { to: 'squad', label: 'Squad', icon: '☰' },
  { to: 'tactics', label: 'Tactics', icon: '⌖' },
  { to: 'match', label: 'Match Centre', icon: '◎' },
  { to: 'fixtures', label: 'Fixtures', icon: '▦' },
  { to: 'table', label: 'League Table', icon: '≡' },
  { to: 'auction', label: 'Auctions', icon: '₹' },
  { to: 'transfers', label: 'Transfers', icon: '⇄' },
  { to: 'youth', label: 'Youth Academy', icon: '✦' },
  { to: 'training', label: 'Training', icon: '⚑' },
  { to: 'medical', label: 'Medical Centre', icon: '✚' },
  { to: 'finances', label: 'Finances', icon: '¤' },
  { to: 'scouting', label: 'Scouting', icon: '⌕' },
  { to: 'world', label: 'World Map', icon: '◍' },
  { to: 'international', label: 'International', icon: '★' },
  { to: 'history', label: 'History', icon: '⌛' },
  { to: 'settings', label: 'Settings', icon: '⚙' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { id, overview } = useCareer();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const o = overview.data;
  const club = o?.club;
  return (
    <div className="carbon min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-lime focus:px-3 focus:py-2 focus:text-obsidian-950">
        Skip to content
      </a>
      {/* sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-obsidian-700 bg-obsidian-950/95 backdrop-blur transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-3 border-b border-obsidian-700 px-4 py-4">
          <NavLink to="/" className="flex items-center gap-2" aria-label="All careers">
            <img src="/favicon.svg" alt="" width={30} height={30} />
            <div className="leading-none">
              <div className="font-display text-xl font-bold tracking-wider">KURCIV</div>
              <div className="text-[10px] font-semibold tracking-[0.3em] text-lime">IPL 2027</div>
            </div>
          </NavLink>
        </div>
        {club && (
          <div className="flex items-center gap-3 border-b border-obsidian-700 px-4 py-3">
            <span className="h-8 w-8 shrink-0 rounded-md" style={{ background: `linear-gradient(135deg, ${club.colors[0]}, ${club.colors[1]})` }} aria-hidden />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{club.name}</div>
              <div className="text-xs text-ink-muted">{club.leagueShort} · {o.managerName}</div>
            </div>
          </div>
        )}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  end={n.to === ''}
                  to={`/c/${id}/${n.to}`}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-lime/10 text-lime' : 'text-ink-muted hover:bg-obsidian-800 hover:text-ink'}`
                  }
                >
                  <span aria-hidden className="w-4 text-center">{n.icon}</span>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-obsidian-700 bg-obsidian-950/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button className="btn-ghost px-2.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              ☰
            </button>
            {o && (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-display text-lg font-semibold">{o.season}</span>
                <span className="text-ink-muted">{dayLabel(o.season, o.day)}</span>
                <span className="rounded-md border border-lime/30 bg-lime/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-lime">{PHASE_LABEL[o.phase]}</span>
                <span className="hidden text-ink-muted sm:inline">Purse <b className="num text-ink">{cr(o.finance.purse)}</b></span>
                <span className="hidden text-ink-muted md:inline">Cash <b className="num text-ink">{cr(o.finance.cash)}</b></span>
                {o.position && <span className="hidden text-ink-muted md:inline">Position <b className="num text-ink">{o.position.pos}</b></span>}
              </div>
            )}
            <ContinueButton />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1500px] px-4 py-5 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function ContinueButton() {
  const { overview, mutate, id } = useCareer();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState<null | { mode: 'day' | 'next' | 'season'; title: string; body: string }>(null);
  const o = overview.data;
  if (!o) return null;
  const request = (mode: 'day' | 'next' | 'season') => {
    setMenu(false);
    if (o.phase === 'retention') return setAsk({ mode, title: 'Commit retentions?', body: 'Your retained players are locked in and everyone else is released into the auction pool. The auction cascade then begins.' });
    if (mode === 'season') return setAsk({ mode, title: 'Simulate the rest of the season?', body: 'Your assistant will play every remaining match using your saved XI and tactics. You can still review every scorecard afterwards.' });
    if (o.phase === 'offseason') return setAsk({ mode, title: 'Begin the off-season?', body: 'Players develop or decline, some retire, academies take in new prospects, league reputations update and next season’s qualification places are set.' });
    run(mode);
  };
  const run = async (mode: 'day' | 'next' | 'season') => {
    setMenu(false);
    if (o.phase === 'auction') return nav(`/c/${id}/auction`);
    setBusy(true);
    const r = await mutate<any>('/continue', { mode });
    setBusy(false);
    if (!r) return;
    if (r.stoppedFor === 'user-match') nav(`/c/${id}/match`);
    if (r.phase === 'auction') nav(`/c/${id}/auction`);
    if (r.phase === 'offseason') nav(`/c/${id}/history`);
    if (r.phase === 'retention') nav(`/c/${id}/auction`);
  };
  const label =
    o.phase === 'auction' ? 'Auction room' : o.phase === 'preseason' ? 'Start season' : o.phase === 'offseason' ? 'Begin off-season' : o.phase === 'retention' ? 'Commit retentions' : 'Continue';
  const inSeason = o.phase === 'season' || o.phase === 'wcc';
  return (
    <div className="relative flex shrink-0">
      <button className={`btn-primary ${inSeason ? 'rounded-r-none' : ''}`} disabled={busy} onClick={() => request('next')}>
        {busy ? 'Simulating…' : label} <span aria-hidden>▸</span>
      </button>
      {inSeason && (
        <>
          <button className="btn-primary rounded-l-none border-l border-obsidian-950/30 px-2" aria-haspopup="menu" aria-expanded={menu} aria-label="More continue options" onClick={() => setMenu((m) => !m)} disabled={busy}>
            ▾
          </button>
          {menu && (
            <div role="menu" className="card absolute right-0 top-11 z-30 w-60 p-1">
              <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('next')}>Continue to my next match</button>
              <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('day')}>Advance one day</button>
              <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('season')}>
                Simulate to end of season
              </button>
            </div>
          )}
        </>
      )}
      {ask && <Confirm open title={ask.title} body={ask.body} confirmLabel="Continue" onConfirm={() => run(ask.mode)} onClose={() => setAsk(null)} />}
    </div>
  );
}
