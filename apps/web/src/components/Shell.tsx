import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PHASE_LABEL, cr, dayLabel, relativeTime } from '../lib/api';
import { useCareer, useSaveStatus, useStorageMode } from '../lib/context';
import { usePrefs } from '../lib/prefs';
import { Icon, type IconName } from './icons';
import { ClubCrest } from './media';
import { StoryCard } from './story';
import { Confirm } from './ui';

type NavItem = { to: string; label: string; icon: IconName; badge?: 'inbox' | 'talks' };
const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Club', items: [
    { to: '', label: 'Overview', icon: 'home' },
    { to: 'squad', label: 'Squad', icon: 'squad' },
    { to: 'tactics', label: 'Tactics', icon: 'tactics' },
  ] },
  { section: 'Club World', items: [
    { to: 'inbox', label: 'Inbox', icon: 'inbox', badge: 'inbox' },
    { to: 'conversations', label: 'Conversations', icon: 'chat', badge: 'talks' },
    { to: 'board', label: 'Boardroom', icon: 'shield' },
    { to: 'news', label: 'World News', icon: 'news' },
    { to: 'feed', label: 'Cricket Feed', icon: 'feed' },
  ] },
  { section: 'Matchday', items: [
    { to: 'match', label: 'Match Centre', icon: 'match' },
    { to: 'fixtures', label: 'Fixtures', icon: 'calendar' },
    { to: 'table', label: 'League', icon: 'league' },
    { to: 'preseason', label: 'Preseason', icon: 'flag' },
  ] },
  { section: 'World', items: [
    { to: 'universe', label: 'World Explorer', icon: 'world' },
    { to: 'pyramid', label: 'Pyramid', icon: 'league' },
    { to: 'continental', label: 'Continental Cups', icon: 'trophy' },
    { to: 'global', label: 'Global Championship', icon: 'star' },
    { to: 'international', label: 'International', icon: 'flag' },
    { to: 'national-team', label: 'National Team', icon: 'shield' },
    { to: 'clubs', label: 'Club Directory', icon: 'squad' },
    { to: 'players', label: 'Player Directory', icon: 'scout' },
    { to: 'stadiums', label: 'Stadiums', icon: 'home' },
    { to: 'calendar', label: 'Global Calendar', icon: 'calendar' },
  ] },
  { section: 'Market', items: [
    { to: 'auction', label: 'Auction House', icon: 'gavel' },
    { to: 'auction-prep', label: 'Auction Prep', icon: 'book' },
    { to: 'transfers', label: 'Transfers', icon: 'transfer' },
    { to: 'scouting', label: 'Scouting', icon: 'scout' },
  ] },
  { section: 'Development', items: [
    { to: 'youth', label: 'Youth Academy', icon: 'youth' },
    { to: 'training', label: 'Training', icon: 'training' },
    { to: 'medical', label: 'Medical Centre', icon: 'medical' },
    { to: 'finances', label: 'Finances', icon: 'finance' },
  ] },
  { section: 'Legacy', items: [
    { to: 'world', label: 'League Reputation', icon: 'world' },
    { to: 'database', label: 'Player Database', icon: 'squad' },
    { to: 'history', label: 'History', icon: 'history' },
    { to: 'settings', label: 'Save & Settings', icon: 'settings' },
  ] },
];

const MOBILE: NavItem[] = [
  { to: '', label: 'Home', icon: 'home' },
  { to: 'squad', label: 'Squad', icon: 'squad' },
  { to: 'match', label: 'Match', icon: 'match' },
  { to: 'auction', label: 'Auction', icon: 'gavel' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { id, overview } = useCareer();
  const { prefs, set } = usePrefs();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  const o = overview.data;
  const club = o?.club;
  const collapsed = prefs.sidebarCollapsed;
  const cwc = o?.clubWorld;
  const badgeOf = (n: NavItem) => (n.badge === 'inbox' ? cwc?.unread ?? 0 : n.badge === 'talks' ? cwc?.talks ?? 0 : 0);

  const navList = (mini: boolean) => (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Sections">
      {NAV.map((g) => (
        <div key={g.section} className="mb-3">
          {!mini && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{g.section}</div>}
          <ul className="space-y-0.5">
            {g.items.map((n) => (
              <li key={n.to}>
                <NavLink end={n.to === ''} to={`/c/${id}/${n.to}`} title={mini ? n.label : undefined}
                  className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mini ? 'justify-center px-2' : ''} ${
                    isActive ? 'bg-lime/10 text-lime' : 'text-ink-muted hover:bg-obsidian-800 hover:text-ink'}`}>
                  <span className="relative">
                    <Icon name={n.icon} />
                    {mini && badgeOf(n) > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-lime" aria-hidden />}
                  </span>
                  {!mini && <span className="flex-1">{n.label}</span>}
                  {!mini && badgeOf(n) > 0 && (
                    <span className={`num rounded-full px-1.5 text-[10px] font-bold ${n.badge === 'inbox' && cwc?.urgent ? 'bg-danger text-white' : 'bg-lime text-obsidian-950'}`} aria-label={`${badgeOf(n)} new`}>{badgeOf(n)}</span>
                  )}
                  {mini && <span className="sr-only">{n.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (mini: boolean) => (
    <div className={`flex items-center gap-2.5 border-b border-obsidian-700 py-4 ${mini ? 'justify-center px-2' : 'px-4'}`}>
      <Link to="/" className="flex items-center gap-2" aria-label="Title screen and save slots">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        {!mini && (
          <div className="leading-none">
            <div className="font-display text-lg font-bold tracking-wider">KURCIV</div>
            <div className="text-[9px] font-semibold tracking-[0.3em] text-lime">IPL 2027</div>
          </div>
        )}
      </Link>
    </div>
  );

  const clubBlock = (mini: boolean) => club && (
    <div className={`flex items-center gap-3 border-b border-obsidian-700 py-3 ${mini ? 'justify-center px-2' : 'px-4'}`}>
      <ClubCrest club={club} size={mini ? 30 : 36} />
      {!mini && (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{club.name}</div>
          <div className="truncate text-xs text-ink-muted">{club.leagueShort} · {o.managerName}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-obsidian-950">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-lime focus:px-3 focus:py-2 focus:text-obsidian-950">Skip to content</a>

      {/* desktop sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-obsidian-700 bg-obsidian-950 transition-[width] lg:flex ${collapsed ? 'w-[68px]' : 'w-60'}`} aria-label="Main navigation">
        {brand(collapsed)}
        {clubBlock(collapsed)}
        {navList(collapsed)}
        <button className="flex items-center justify-center gap-2 border-t border-obsidian-700 py-3 text-xs text-ink-muted hover:text-ink" onClick={() => set({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />{!collapsed && 'Collapse'}
        </button>
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="rise fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-obsidian-700 bg-obsidian-950 lg:hidden" aria-label="Main navigation">
            <div className="flex items-center justify-between pr-2">{brand(false)}<button className="btn-quiet px-2" onClick={() => setDrawer(false)} aria-label="Close navigation"><Icon name="x" /></button></div>
            {clubBlock(false)}
            {navList(false)}
          </aside>
        </>
      )}

      <div className={`pb-20 transition-[padding] lg:pb-0 ${collapsed ? 'lg:pl-[68px]' : 'lg:pl-60'}`}>
        <header className="sticky top-0 z-30 border-b border-obsidian-700 bg-obsidian-950/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
            <button className="btn-quiet px-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            {o ? (
              <div className="flex min-w-0 flex-1 items-center gap-x-5 gap-y-1 text-sm">
                <div className="min-w-0 leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-semibold">{o.season}</span>
                    <span className="chip hidden sm:inline-flex">{PHASE_LABEL[o.phase]}</span>
                  </div>
                  <div className="truncate text-xs text-ink-muted">{dayLabel(o.season, o.day)}</div>
                </div>
                {o.nextChapter && (
                  <div className="hidden min-w-0 leading-tight md:block">
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">{o.nextChapter.today ? 'Today' : 'Next fixture'}</div>
                    <div className="truncate">{o.nextChapter.fixture.home} v {o.nextChapter.fixture.away} <span className="text-ink-faint">· {dayLabel(o.season, o.nextChapter.fixture.day)}</span></div>
                  </div>
                )}
                <div className="hidden leading-tight xl:block">
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint">Purse</div>
                  <div className="num">{cr(o.finance.purse)}</div>
                </div>
              </div>
            ) : <div className="flex-1" />}
            <SaveIndicator careerId={id} />
            <Notifications />
            <ContinueButton />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">{children}</main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-obsidian-700 bg-obsidian-950/95 backdrop-blur lg:hidden" aria-label="Quick navigation">
        {MOBILE.map((n) => (
          <NavLink key={n.to} end={n.to === ''} to={`/c/${id}/${n.to}`}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-lime' : 'text-ink-muted'}`}>
            <Icon name={n.icon} size={20} />{n.label}
          </NavLink>
        ))}
        <button className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-muted" onClick={() => setDrawer(true)}><Icon name="menu" size={20} />More</button>
      </nav>
    </div>
  );
}

/** Reflects real IndexedDB commits. "Saved locally" appears only after a write succeeds. */
function SaveIndicator({ careerId }: { careerId: string }) {
  const s = useSaveStatus(careerId);
  const storage = useStorageMode();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  if (storage.mode === 'memory') {
    return <span className="chip border-warn/50 text-warn" title={`Saves are not persisted: ${storage.reason ?? 'browser storage unavailable'}. Export a backup to keep progress.`}><Icon name="alert" size={14} /> <span className="hidden sm:inline">Not saved</span></span>;
  }
  if (!s) return <span className="chip hidden text-ink-faint sm:inline-flex" title="All changes are saved on this device"><Icon name="check" size={14} /> Saved locally</span>;
  if (s.state === 'saving') return <span className="chip text-ink-muted" role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-ink-muted" /> <span className="hidden sm:inline">Saving…</span></span>;
  if (s.state === 'error') return <span className="chip border-danger/50 text-danger" role="alert" title={s.message}><Icon name="alert" size={14} /> Save error</span>;
  return <span className="chip text-ink-muted" role="status" title={`Saved ${new Date(s.at).toLocaleTimeString()}`}><Icon name="check" size={14} className="text-lime" /> <span className="hidden sm:inline">Saved locally · {relativeTime(s.at)}</span></span>;
}

function Notifications() {
  const { overview } = useCareer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc));
  }, [open]);
  const o = overview.data;
  const stories = o?.stories ?? [];
  const urgent = (o?.decisions ?? []).filter((d: any) => d.urgency === 'high');
  const count = stories.length + urgent.length;
  return (
    <div className="relative" ref={ref}>
      <button className="btn-quiet relative px-2.5" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={`Notifications${count ? ` (${count})` : ''}`}>
        <Icon name="bell" />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-lime px-1 text-[10px] font-bold text-obsidian-950">{count}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="card rise fixed inset-x-3 top-16 z-50 max-h-[75vh] overflow-y-auto p-3 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px]">
          {urgent.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <div className="label px-1">Needs your attention</div>
              {urgent.map((d: any) => (
                <DecisionLink key={d.label} d={d} onGo={() => setOpen(false)} />
              ))}
            </div>
          )}
          <div className="label mb-1.5 px-1">Club stories</div>
          {stories.length ? <div className="space-y-2">{stories.map((s: any) => <StoryCard key={s.id} story={s} compact onAction={() => setOpen(false)} />)}</div>
            : <p className="px-1 py-3 text-sm text-ink-muted">Nothing new. Stories appear as your season unfolds.</p>}
        </div>
      )}
    </div>
  );
}

export function DecisionLink({ d, onGo }: { d: { label: string; detail: string; page: string; urgency: string }; onGo?: () => void }) {
  const { id } = useCareer();
  return (
    <Link to={`/c/${id}/${d.page}`} onClick={onGo} className="flex items-start gap-3 rounded-lg border border-obsidian-700 bg-obsidian-850 px-3 py-2.5 transition-colors hover:border-obsidian-500">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${d.urgency === 'high' ? 'bg-lime' : 'bg-ink-faint'}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{d.label}</span>
        <span className="block text-xs text-ink-muted">{d.detail}</span>
      </span>
      <Icon name="chevronRight" size={16} className="mt-1 text-ink-faint" />
    </Link>
  );
}

/** One context-aware button that always moves the career forward to the next meaningful moment. */
export function ContinueButton({ big = false }: { big?: boolean }) {
  const { overview, mutate, id } = useCareer();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState<null | { mode: 'day' | 'next' | 'season'; title: string; body: string }>(null);
  const o = overview.data;
  if (!o) return null;
  const today = o.nextChapter?.today;
  const request = (mode: 'day' | 'next' | 'season') => {
    setMenu(false);
    if (o.phase === 'auction' || (today && mode === 'next')) return run(mode);
    if (o.phase === 'retention') return setAsk({ mode, title: 'Commit retentions?', body: 'Your retained players are locked in and everyone else is released into the auction pool. The auction cascade then begins.' });
    if (mode === 'season') return setAsk({ mode, title: 'Simulate the rest of the season?', body: 'Your assistant will play every remaining match using your saved XI and tactics. You can still review every scorecard afterwards.' });
    if (o.phase === 'offseason') return setAsk({ mode, title: 'Begin the off-season?', body: 'Players develop or decline, some retire, academies take in new prospects, league reputations update and next season’s qualification places are set.' });
    run(mode);
  };
  const run = async (mode: 'day' | 'next' | 'season') => {
    setMenu(false);
    if (o.phase === 'auction') return nav(`/c/${id}/auction`);
    if (today && mode === 'next') return nav(`/c/${id}/match`);
    setBusy(true);
    const r = await mutate<any>('/continue', { mode });
    setBusy(false);
    if (!r) return;
    if (r.stoppedFor === 'user-match') nav(`/c/${id}/match`);
    else if (r.phase === 'auction' || r.phase === 'retention') nav(`/c/${id}/auction`);
    else if (r.phase === 'offseason') nav(`/c/${id}/history`);
  };
  const label = o.phase === 'auction' ? 'Auction room' : o.phase === 'preseason' ? (o.pendingFriendlies ? 'Next friendly' : 'Start season') : o.phase === 'offseason' ? 'Begin off-season'
    : o.phase === 'retention' ? 'Commit retentions' : today ? 'Play match' : 'Continue';
  const inSeason = (o.phase === 'season' || o.phase === 'wcc' || o.phase === 'international') && !today;
  return (
    <div className="relative flex shrink-0">
      <button className={`btn-primary ${big ? 'px-6 py-3 text-base' : ''} ${inSeason ? 'rounded-r-none' : ''}`} disabled={busy} onClick={() => request('next')}>
        {busy ? 'Simulating…' : label} <Icon name="chevronRight" size={16} />
      </button>
      {inSeason && (
        <>
          <button className={`btn-primary rounded-l-none border-l border-obsidian-950/30 px-2 ${big ? 'py-3' : ''}`} aria-haspopup="menu" aria-expanded={menu} aria-label="More continue options" onClick={() => setMenu((m) => !m)} disabled={busy}>
            <Icon name="chevronDown" size={16} />
          </button>
          {menu && (
            <div role="menu" className="card absolute right-0 top-12 z-40 w-64 p-1">
              <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('next')}>Continue to my next match</button>
              <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('day')}>Advance one day</button>
              <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-obsidian-800" onClick={() => request('season')}>Simulate to end of season</button>
            </div>
          )}
        </>
      )}
      {ask && <Confirm open title={ask.title} body={ask.body} confirmLabel="Continue" onConfirm={() => (setAsk(null), run(ask.mode))} onClose={() => setAsk(null)} />}
    </div>
  );
}
