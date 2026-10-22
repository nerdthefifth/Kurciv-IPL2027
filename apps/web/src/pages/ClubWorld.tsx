import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { dayLabel, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { usePlayerModal } from '../components/player';
import { Async, Badge, Card, Empty, Meter, PageHeader, Tabs } from '../components/ui';
import { Icon } from '../components/icons';

/*
 * The Club World screens: Inbox, Conversations, Boardroom, World News and the Cricket Feed.
 * Everything shown is generated from events in this career; the pages only read it and send
 * the manager's decisions back to the engine.
 */

/** Opens an in-game link: `player:<id>` opens the player card in place; anything else is a page. */
function useOpenLink() {
  const career = useCareer();
  const nav = useNavigate();
  const players = usePlayerModal();
  return (page: string) => {
    if (page.startsWith('player:')) players.open(page.slice(7));
    else nav(`/c/${career.id}/${page}`);
  };
}

const when = (season: number, day: number) => dayLabel(season, day);

function Pill({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-lime bg-lime/10 text-lime' : 'border-obsidian-700 text-ink-muted hover:text-ink'}`}>
      {children}{count ? <span className="num ml-1 text-ink-faint">{count}</span> : null}
    </button>
  );
}

// ================================================================== inbox

const CATEGORIES: [string, string][] = [
  ['all', 'All'], ['board', 'Board'], ['player', 'Players'], ['coaching', 'Coaching'], ['medical', 'Medical'], ['contracts', 'Contracts'],
  ['auction', 'Auction'], ['match', 'Match prep'], ['media', 'Media'], ['discipline', 'Discipline'], ['competition', 'Competitions'], ['news', 'Briefings'],
];
const PRIORITY_TONE = { urgent: 'danger', high: 'warn', normal: 'muted', low: 'muted' } as const;

export function InboxPage() {
  const career = useCareer();
  const open = useOpenLink();
  const [box, setBox] = useState<'inbox' | 'unread' | 'actions' | 'pinned' | 'archived'>('inbox');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const params = new URLSearchParams({ box, category, ...(q ? { q } : {}) });
  const state = useApi<any>(`/careers/${career.id}/inbox?${params}`, [career.tick, params.toString()]);
  const msgs: any[] = state.data?.messages ?? [];
  const current = msgs.find((m) => m.id === sel) ?? null;

  const select = (m: any) => {
    setSel(m.id);
    if (!m.read) void career.mutate(`/inbox/${m.id}`, { op: 'read' }, { quiet: true });
  };
  const op = (id: string, o: string) => career.mutate(`/inbox/${id}`, { op: o }, { quiet: true });

  return (
    <div className="space-y-4">
      <PageHeader kicker="Club World" title="Inbox" subtitle="Decisions, reports and requests from around the club."
        actions={<button className="btn-ghost" onClick={() => career.mutate('/inbox-read-all', {}, { quiet: true })}>Mark all read</button>} />
      <Async state={state}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <section className="card flex min-h-0 flex-col overflow-hidden lg:h-[calc(100dvh-220px)]">
              <div className="space-y-2 border-b border-obsidian-700 p-3">
                <div className="flex flex-wrap gap-1">
                  {([['inbox', 'Inbox', d.counts.unread], ['actions', 'Decisions', d.counts.actions], ['unread', 'Unread', 0], ['pinned', 'Pinned', 0], ['archived', 'Archived', 0]] as const).map(([id, label, n]) => (
                    <Pill key={id} on={box === id} onClick={() => setBox(id)} count={n}>{label}</Pill>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="input flex-1 py-1.5 text-sm" placeholder="Search messages" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search messages" />
                  <select className="input w-36 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                    {CATEGORIES.map(([id, l]) => <option key={id} value={id}>{l}{d.counts.byCategory[id] ? ` (${d.counts.byCategory[id]})` : ''}</option>)}
                  </select>
                </div>
              </div>
              <ul className="min-h-0 flex-1 divide-y divide-obsidian-800 overflow-y-auto">
                {!msgs.length && <li className="p-6 text-center text-sm text-ink-muted">Nothing here.</li>}
                {msgs.map((m) => {
                  const pending = m.response && !m.response.chosen;
                  return (
                    <li key={m.id}>
                      <button onClick={() => select(m)} className={`w-full px-3 py-2.5 text-left transition ${sel === m.id ? 'bg-lime/[0.06]' : 'hover:bg-obsidian-850'}`}>
                        <div className="flex items-center gap-2">
                          {!m.read && <span className="h-2 w-2 shrink-0 rounded-full bg-lime" aria-label="Unread" />}
                          <span className={`min-w-0 flex-1 truncate text-sm ${m.read ? 'text-ink-muted' : 'font-semibold text-ink'}`}>{m.subject}</span>
                          {m.pinned && <Icon name="star" size={13} className="text-warn" />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                          <span className="truncate">{m.from.name}</span>
                          <span>·</span>
                          <span className="shrink-0">{when(m.season, m.day)}</span>
                          <span className="flex-1" />
                          {pending && <Badge tone={m.response.required ? 'warn' : 'info'}>{m.response.deadline ? `Reply by ${when(m.response.deadline.season, m.response.deadline.day)}` : 'Decision'}</Badge>}
                          {m.priority !== 'normal' && m.priority !== 'low' && !pending && <Badge tone={PRIORITY_TONE[m.priority as 'urgent']}>{m.priority}</Badge>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="card min-h-[320px] p-5 lg:h-[calc(100dvh-220px)] lg:overflow-y-auto">
              {current ? <MessageDetail m={current} open={open} op={op} /> : <Empty title="Select a message">Decisions with a deadline are listed first.</Empty>}
            </section>
          </div>
        )}
      </Async>
    </div>
  );
}

function MessageDetail({ m, open, op }: { m: any; open: (p: string) => void; op: (id: string, o: string) => Promise<unknown> }) {
  const career = useCareer();
  const [busy, setBusy] = useState(false);
  const respond = async (optionId: string) => {
    setBusy(true);
    await career.mutate(`/inbox/${m.id}/respond`, { optionId }, { success: 'Response sent.' });
    setBusy(false);
  };
  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Badge tone={PRIORITY_TONE[m.priority as 'urgent']}>{m.priority}</Badge>
          <span className="uppercase tracking-wider">{CATEGORIES.find(([id]) => id === m.category)?.[1]}</span>
          <span>· {when(m.season, m.day)}</span>
          {m.event && <span className="text-ink-faint" title={`Source: ${m.event.source}`}>· from {m.event.type.toLowerCase().replace(/_/g, ' ')}</span>}
        </div>
        <h2 className="font-display text-2xl font-bold">{m.subject}</h2>
        <p className="text-sm text-ink-muted">{m.from.name} · {m.from.role}</p>
      </header>
      <p className="whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
      {m.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {m.links.map((l: any) => <button key={l.label + l.page} className="btn-ghost py-1.5 text-xs" onClick={() => open(l.page)}>{l.label} →</button>)}
        </div>
      )}
      {m.response && (
        <div className="rounded-xl border border-obsidian-700 bg-obsidian-850 p-3">
          {m.response.chosen ? (
            <p className="text-sm"><Icon name="check" size={14} className="mr-1 inline text-lime" />{m.response.options.find((o: any) => o.id === m.response.chosen)?.label ?? 'No response'} — <span className="text-ink-muted">{m.response.outcome}</span></p>
          ) : (
            <>
              <div className="label mb-2">Your response{m.response.deadline ? ` · by ${when(m.response.deadline.season, m.response.deadline.day)}` : ''}</div>
              <div className="space-y-1.5">
                {m.response.options.map((o: any) => (
                  <button key={o.id} disabled={busy} onClick={() => respond(o.id)} className="block w-full rounded-lg border border-obsidian-700 px-3 py-2 text-left text-sm transition hover:border-lime disabled:opacity-50">
                    <span className="font-medium">{o.label}</span>
                    {o.hint && <span className="block text-xs text-ink-muted">{o.hint}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <footer className="flex flex-wrap gap-2 border-t border-obsidian-800 pt-3">
        <button className="btn-quiet text-xs" onClick={() => op(m.id, m.pinned ? 'unpin' : 'pin')}>{m.pinned ? 'Unpin' : 'Pin'}</button>
        <button className="btn-quiet text-xs" onClick={() => op(m.id, m.archived ? 'unarchive' : 'archive')}>{m.archived ? 'Move to inbox' : 'Archive'}</button>
        <button className="btn-quiet text-xs" onClick={() => op(m.id, 'unread')}>Mark unread</button>
      </footer>
    </article>
  );
}

// ================================================================== conversations

const TOPIC_LABEL: Record<string, string> = {
  'playing-time': 'Playing time', dropped: 'Selection', 'batting-position': 'Batting position', workload: 'Workload', form: 'Form & confidence',
  contract: 'Future & retention', 'broken-promise': 'Broken promise', 'team-morale': 'Team morale', praise: 'Thanks', development: 'Development',
};

export function ConversationsPage() {
  const career = useCareer();
  const players = usePlayerModal();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'talks' | 'promises' | 'squad'>('talks');
  const state = useApi<any>(`/careers/${career.id}/conversations`, [career.tick]);
  const sel = params.get('c');
  return (
    <div className="space-y-4">
      <PageHeader kicker="Club World" title="Conversations" subtitle="What your players ask of you, what you promised, and how much they trust you." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'talks', label: 'Conversations' }, { id: 'promises', label: 'Promises' }, { id: 'squad', label: 'Relationships' }]} />
      <Async state={state}>
        {(d) => {
          if (tab === 'promises') return <PromiseList promises={d.promises} />;
          if (tab === 'squad') return <Relationships squad={d.squad} onOpen={players.open} />;
          const current = d.conversations.find((c: any) => c.id === sel) ?? d.conversations.find((c: any) => c.status === 'open') ?? d.conversations[0];
          if (!d.conversations.length) return <Empty title="No conversations yet">Players come to you when something matters to them — selection, role, workload, form or their future.</Empty>;
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <ul className="card divide-y divide-obsidian-800 overflow-hidden lg:max-h-[calc(100dvh-260px)] lg:overflow-y-auto">
                {d.conversations.map((c: any) => (
                  <li key={c.id}>
                    <button onClick={() => setParams({ c: c.id })} className={`w-full px-3 py-2.5 text-left ${current?.id === c.id ? 'bg-lime/[0.06]' : 'hover:bg-obsidian-850'}`}>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm font-semibold">{c.player.name}</span>
                        <Badge tone={c.status === 'open' ? 'warn' : c.status === 'expired' ? 'danger' : 'muted'}>{c.status === 'open' ? 'Awaiting reply' : c.status}</Badge>
                      </div>
                      <div className="text-[11px] text-ink-faint">{TOPIC_LABEL[c.topic]} · {when(c.season, c.day)}</div>
                    </button>
                  </li>
                ))}
              </ul>
              {current && <Thread c={current} onPlayer={() => players.open(current.playerId)} />}
            </div>
          );
        }}
      </Async>
    </div>
  );
}

function Thread({ c, onPlayer }: { c: any; onPlayer: () => void }) {
  const career = useCareer();
  const [busy, setBusy] = useState(false);
  const reply = async (optionId: string) => {
    setBusy(true);
    await career.mutate(`/conversations/${c.id}/reply`, { optionId });
    setBusy(false);
  };
  return (
    <section className="card space-y-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <button className="font-display text-xl font-bold hover:text-lime" onClick={onPlayer}>{c.player.name}</button>
          <div className="text-xs text-ink-muted">{TOPIC_LABEL[c.topic]} · reply by {when(c.deadline.season, c.deadline.day)}</div>
        </div>
      </header>
      <ol className="space-y-2">
        {c.lines.map((l: any, i: number) => (
          <li key={i} className={l.from === 'note' ? 'text-center text-xs text-ink-faint' : `flex ${l.from === 'manager' ? 'justify-end' : ''}`}>
            {l.from === 'note' ? l.text : (
              <span className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.from === 'manager' ? 'rounded-br-sm bg-lime/15 text-ink' : 'rounded-bl-sm bg-obsidian-800'}`}>{l.text}</span>
            )}
          </li>
        ))}
      </ol>
      {c.status === 'open' && (
        <div className="space-y-1.5 border-t border-obsidian-800 pt-3">
          <div className="label">Your reply</div>
          {c.options.map((o: any) => (
            <button key={o.id} disabled={busy} onClick={() => reply(o.id)} className="block w-full rounded-lg border border-obsidian-700 px-3 py-2 text-left text-sm transition hover:border-lime disabled:opacity-50">
              <span className="font-medium">{o.label}</span>
              <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-faint">{o.tone}</span>
              <span className="block text-xs text-ink-muted">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PromiseList({ promises }: { promises: any[] }) {
  if (!promises.length) return <Empty title="No promises">Promises you make in conversations, or to the board, are tracked here and judged on what actually happens.</Empty>;
  const tone = { active: 'info', fulfilled: 'lime', broken: 'danger', void: 'muted' } as const;
  return (
    <section className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>To</th><th>Commitment</th><th>Made</th><th>Progress</th><th>Status</th></tr></thead>
        <tbody>
          {promises.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.toName}</td>
              <td className="text-sm">“{p.text}”</td>
              <td className="text-xs text-ink-muted">{when(p.made.season, p.made.day)}</td>
              <td className="num text-xs">{p.matches ? `${p.progress.satisfied}/${p.target} of ${p.progress.seen}/${p.matches} matches` : p.deadline ? `by the ${p.deadline.season} retentions` : '—'}</td>
              <td><Badge tone={tone[p.status as 'active']}>{p.status}</Badge>{p.resolved && <div className="mt-0.5 text-[11px] text-ink-faint">{p.resolved.note}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Relationships({ squad, onOpen }: { squad: any[]; onOpen: (id: string) => void }) {
  return (
    <section className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>Player</th><th>Role</th><th>Personality</th><th className="text-right">Trust</th><th className="text-right">Morale</th><th className="text-right">Ambition</th><th className="text-right">Prof.</th><th>Recently</th></tr></thead>
        <tbody>
          {squad.map((p) => (
            <tr key={p.id}>
              <td><button className="font-medium hover:text-lime" onClick={() => onOpen(p.id)}>{p.name}</button>{p.open && <Badge tone="warn">wants a word</Badge>}{p.promises > 0 && <Badge tone="info">{p.promises} promise{p.promises > 1 ? 's' : ''}</Badge>}</td>
              <td className="text-xs text-ink-muted">{p.standing}{p.benchStreak >= 2 ? ` · benched ${p.benchStreak}` : ''}</td>
              <td className="text-xs capitalize">{p.personality}</td>
              <td className={`num text-right ${p.trust < 35 ? 'text-danger' : p.trust > 70 ? 'text-lime' : ''}`}>{p.trust}</td>
              <td className={`num text-right ${p.morale < 40 ? 'text-danger' : ''}`}>{p.morale}</td>
              <td className="num text-right">{p.ambition}</td>
              <td className="num text-right">{p.professionalism}</td>
              <td className="text-[11px] text-ink-muted">{p.recent[0] ? `${p.recent[0].response}: ${p.recent[0].outcome}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ================================================================== boardroom

const OUTLOOK_TONE = { met: 'lime', 'on-track': 'lime', pending: 'muted', behind: 'warn', failed: 'danger' } as const;

export function BoardPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/board`, [career.tick]);
  return (
    <div className="space-y-4">
      <PageHeader kicker="Club World" title="Boardroom" subtitle="Your employer: what it expects, how it judges you, and where you stand." />
      <Async state={state}>
        {(d) => (
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Job security">
              <div className="flex items-end gap-3">
                <span className="num font-display text-5xl font-bold">{d.confidence}</span>
                <span className="pb-2 text-sm text-ink-muted">/100 confidence</span>
              </div>
              <div className="mt-1"><Badge tone={d.band.id === 'secure' || d.band.id === 'stable' ? 'lime' : d.band.id === 'review' ? 'warn' : 'danger'}>{d.band.label}</Badge> <span className="text-xs text-ink-muted">{d.warnings} warning{d.warnings === 1 ? '' : 's'} on record</span></div>
              <ul className="mt-3 space-y-1 text-xs text-ink-muted">{d.rules.map((r: string) => <li key={r}>• {r}</li>)}</ul>
            </Card>
            <Card title={d.profile.styleLabel}>
              <div className="space-y-2">
                {([['Patience', d.profile.patience], ['Sporting ambition', d.profile.sportingAmbition], ['Financial focus', d.profile.financialFocus], ['Commercial expectations', d.profile.commercialExpectation], ['Youth focus', d.profile.youthFocus], ['Risk tolerance', d.profile.riskTolerance]] as const).map(([l, v]) => <Meter key={l} label={l} value={v} tone="lime" display={String(v)} />)}
              </div>
              <p className="mt-2 text-xs text-ink-muted">Recruitment preference: {d.profile.recruitment}. Appointed {when(d.profile.appointed.season, d.profile.appointed.day)}.</p>
            </Card>
            <Card title="Media pressure">
              <Meter label="Pressure" value={d.media.pressure} invert display={String(d.media.pressure)} />
              <ul className="mt-3 space-y-1 text-xs">
                {d.media.history.slice(0, 6).map((h: any, i: number) => <li key={i} className="flex justify-between gap-2"><span className="text-ink-muted">{h.reason}</span><span className="num">{h.pressure}</span></li>)}
              </ul>
            </Card>
            <Card title={`${d.club.league} objectives`} className="xl:col-span-2">
              {!d.objectives.length ? <p className="text-sm text-ink-muted">Objectives are set when the season starts.</p> : (
                <ul className="space-y-2">
                  {d.objectives.map((o: any) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-obsidian-700 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm">{o.description}<span className="block text-xs text-ink-muted">{o.current}</span></span>
                      <Badge tone={o.importance === 'high' ? 'warn' : 'muted'}>{o.importance}</Badge>
                      <Badge tone={OUTLOOK_TONE[o.outlook as 'met']}>{o.outlook.replace('-', ' ')}</Badge>
                      {o.negotiable && <button className="btn-ghost py-1 text-xs" onClick={() => career.mutate('/board/negotiate', { objectiveId: o.id })} title="Once per objective; costs some confidence">Ask for a lower target</button>}
                    </li>
                  ))}
                </ul>
              )}
              {d.promises.length > 0 && (
                <div className="mt-3 text-sm">
                  <div className="label mb-1">Commitments to the board</div>
                  {d.promises.map((p: any) => <div key={p.id} className="flex justify-between gap-2"><span>“{p.text}” ({p.progress.satisfied}/{p.target}, {p.progress.seen}/{p.matches} played)</span><Badge tone={p.status === 'fulfilled' ? 'lime' : p.status === 'broken' ? 'danger' : 'info'}>{p.status}</Badge></div>)}
                </div>
              )}
            </Card>
            <Card title="Confidence log">
              <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
                {[...d.history].reverse().map((h: any, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className={`num w-10 shrink-0 text-right ${h.delta > 0 ? 'text-lime' : h.delta < 0 ? 'text-danger' : 'text-ink-faint'}`}>{h.delta > 0 ? '+' : ''}{h.delta || '·'}</span>
                    <span className="flex-1 text-ink-muted">{h.reason}</span>
                    <span className="num text-ink-faint">{h.confidence}</span>
                  </li>
                ))}
              </ul>
            </Card>
            {d.reviews.length > 0 && (
              <Card title="Reviews" className="xl:col-span-3">
                <div className="grid gap-3 md:grid-cols-2">
                  {d.reviews.map((r: any, i: number) => (
                    <div key={i} className="rounded-lg border border-obsidian-700 p-3 text-sm">
                      <div className="flex justify-between"><b>{r.kind === 'season' ? `${r.season} season review` : `${r.season} mid-season review`}</b><Badge tone="muted">{r.verdict} · {r.score}</Badge></div>
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">{r.lines.map((l: string) => <li key={l}>• {l}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </Async>
    </div>
  );
}

// ================================================================== world news

const NEWS_FILTERS: [string, string][] = [['all', 'All'], ['club', 'My club'], ['league', 'My league'], ['followed', 'Following'], ['major', 'Major stories'], ['auctions', 'Auctions'], ['injuries', 'Injuries'], ['international', 'World Club Championship']];

export function NewsPage() {
  const career = useCareer();
  const open = useOpenLink();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setPage(0), [filter]);
  const state = useApi<any>(`/careers/${career.id}/world-news?filter=${filter}&page=${page}`, [career.tick, filter, page]);
  const follow = (kind: 'player' | 'club', id: string, on: boolean) => career.mutate('/follow', { kind, id, on }, { quiet: true });
  return (
    <div className="space-y-4">
      <PageHeader kicker="Club World" title="World News" subtitle="Every story is written from something that happened in your world." />
      <div className="flex flex-wrap gap-1.5">{NEWS_FILTERS.map(([id, l]) => <Pill key={id} on={filter === id} onClick={() => setFilter(id)}>{l}</Pill>)}</div>
      <Async state={state}>
        {(d) => (
          <>
            {!d.items.length && <Empty title="No stories">Nothing matches this filter yet.</Empty>}
            <ul className="space-y-2">
              {d.items.map((n: any) => {
                const big = n.level === 'feature';
                const isOpen = expanded === n.id || big;
                return (
                  <li key={n.id} className={`card ${big ? 'border-lime/30 p-5' : 'p-3'}`}>
                    <button className="w-full text-left" onClick={() => setExpanded(expanded === n.id ? null : n.id)} aria-expanded={isOpen}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-ink-faint">
                        <span>{n.kind}</span><span>·</span><span>{when(n.season, n.day)}</span>
                        {n.level !== 'brief' && <Badge tone={big ? 'lime' : 'muted'}>{n.level}</Badge>}
                        {n.followUp && <span className="normal-case tracking-normal text-info">Follow-up to “{n.followUp}”</span>}
                      </div>
                      <h3 className={`mt-0.5 font-semibold ${big ? 'font-display text-2xl' : n.level === 'article' ? 'text-base' : 'text-sm'}`}>{n.headline}</h3>
                    </button>
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm text-ink-muted">{n.body}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {n.players.map((p: any) => (
                            <span key={p.id} className="inline-flex items-center rounded-full border border-obsidian-700 text-xs">
                              <button className="px-2 py-0.5 hover:text-lime" onClick={() => open(`player:${p.id}`)}>{p.name}</button>
                              <button className="border-l border-obsidian-700 px-1.5 py-0.5 text-ink-faint hover:text-lime" onClick={() => follow('player', p.id, !d.follows.players.includes(p.id))}>{d.follows.players.includes(p.id) ? '✓' : '+'}</button>
                            </span>
                          ))}
                          {n.clubs.map((c: any) => (
                            <span key={c.id} className="inline-flex items-center rounded-full border border-obsidian-700 text-xs">
                              <Link className="px-2 py-0.5 hover:text-lime" to={`/c/${career.id}/club/${c.id}`}>{c.shortName}</Link>
                              <button className="border-l border-obsidian-700 px-1.5 py-0.5 text-ink-faint hover:text-lime" onClick={() => follow('club', c.id, !d.follows.clubs.includes(c.id))}>{d.follows.clubs.includes(c.id) ? '✓' : '+'}</button>
                            </span>
                          ))}
                          {n.fixtureId && <Link className="text-xs text-lime" to={`/c/${career.id}/fixtures/${n.fixtureId}`}>Match report →</Link>}
                          {n.event && <span className="text-[10px] text-ink-faint" title={n.event.source}>Source: {n.event.type.toLowerCase().replace(/_/g, ' ')}</span>}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pager page={page} total={d.total} setPage={setPage} />
          </>
        )}
      </Async>
    </div>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (n: number) => void }) {
  if (total <= 40) return null;
  return (
    <div className="flex items-center justify-between text-sm text-ink-muted">
      <span>Page {page + 1} of {Math.ceil(total / 40)}</span>
      <span className="flex gap-2">
        <button className="btn-quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
        <button className="btn-quiet" disabled={(page + 1) * 40 >= total} onClick={() => setPage(page + 1)}>Older</button>
      </span>
    </div>
  );
}

// ================================================================== the cricket feed

const FEED_FILTERS: [string, string][] = [['all', 'For you'], ['club', 'My club'], ['following', 'Following'], ['matchday', 'Matchday'], ['recruitment', 'Recruitment & rumours'], ['world', 'World cricket'], ['saved', 'Saved']];
const KIND_BADGE = { official: ['Official', 'lime'], opinion: ['Opinion', 'muted'], analysis: ['Analysis', 'info'], report: ['Report', 'default'], rumour: ['Unconfirmed', 'warn'] } as const;

function Avatar({ a }: { a: any }) {
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-obsidian-950" style={{ background: a.avatar.color }} aria-hidden>{a.avatar.initials}</span>;
}

export function FeedPage() {
  const career = useCareer();
  const open = useOpenLink();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter]);
  const state = useApi<any>(`/careers/${career.id}/feed?filter=${filter}&page=${page}`, [career.tick, filter, page]);
  const quiet = { quiet: true };
  return (
    <div className="space-y-4">
      <PageHeader kicker="Club World" title="The Cricket Feed" subtitle="Fans, reporters, analysts and clubs react to your world." />
      <p className="rounded-lg border border-obsidian-700 bg-obsidian-850 px-3 py-2 text-xs text-ink-muted">All accounts and posts here are fictional and generated from events in this career. Club and league accounts are in-game stand-ins, and real players never post.</p>
      <div className="flex flex-wrap gap-1.5">{FEED_FILTERS.map(([id, l]) => <Pill key={id} on={filter === id} onClick={() => setFilter(id)}>{l}</Pill>)}</div>
      <Async state={state}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-2">
              {!d.posts.length && <Empty title="Quiet on the feed">Nothing here yet — it fills up as your world plays out.</Empty>}
              {d.posts.map((p: any) => {
                const [kl, kt] = KIND_BADGE[p.kind as 'official'];
                return (
                  <article key={p.id} className="card flex gap-3 p-3">
                    <Avatar a={p.account} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs">
                        <b className="text-sm">{p.account.name}</b>
                        <span className="text-ink-faint">@{p.account.handle} · {when(p.season, p.day)}</span>
                        <Badge tone={kt}>{kl}</Badge>
                        {p.rumour && <Badge tone={p.rumour.status === 'confirmed' ? 'lime' : p.rumour.status === 'denied' ? 'danger' : 'muted'}>{p.rumour.status === 'open' ? `source reliability ${Math.round(p.rumour.reliability * 100)}%` : p.rumour.status}</Badge>}
                      </div>
                      {p.replyTo && <p className="mt-1 border-l-2 border-obsidian-600 pl-2 text-xs text-ink-faint">Replying to @{p.replyTo.handle}: {p.replyTo.text}</p>}
                      <p className="mt-1 text-sm">{p.text}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                        {p.players.map((x: any) => <button key={x.id} className="text-lime hover:underline" onClick={() => open(`player:${x.id}`)}>{x.name}</button>)}
                        {p.refs.fixtureId && <Link className="text-lime hover:underline" to={`/c/${career.id}/fixtures/${p.refs.fixtureId}`}>Match report</Link>}
                        <span className="flex-1" />
                        <span>♥ {p.likes.toLocaleString()}</span>
                        <span>💬 {p.replies}</span>
                        <button className="hover:text-ink" onClick={() => career.mutate('/feed/save', { postId: p.id, on: !p.saved }, quiet)}>{p.saved ? 'Saved' : 'Save'}</button>
                        <button className="hover:text-ink" onClick={() => career.mutate('/follow', { kind: 'account', id: p.account.id, on: !p.following }, quiet)}>{p.following ? 'Following' : 'Follow'}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
              <Pager page={page} total={d.total} setPage={setPage} />
            </div>
            <aside className="space-y-4">
              <Card title="Rumour tracker">
                {!d.rumours.length ? <p className="text-xs text-ink-muted">No rumours yet.</p> : (
                  <ul className="space-y-2 text-xs">
                    {d.rumours.slice(0, 8).map((r: any) => (
                      <li key={r.id}>
                        <div>{r.claim}</div>
                        <div className="text-ink-faint">{r.source} · reliability {Math.round(r.reliability * 100)}% · <span className={r.status === 'confirmed' ? 'text-lime' : r.status === 'denied' ? 'text-danger' : ''}>{r.status}</span>{r.outcome ? ` — ${r.outcome}` : ''}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Muted topics">
                <div className="flex flex-wrap gap-1.5">
                  {d.topics.map((t: string) => {
                    const muted = d.muted.includes(t);
                    return <button key={t} onClick={() => career.mutate('/feed/mute', { topic: t, on: !muted }, quiet)} className={`rounded-full border px-2 py-0.5 text-[11px] ${muted ? 'border-danger/50 text-danger line-through' : 'border-obsidian-700 text-ink-muted hover:text-ink'}`}>#{t}</button>;
                  })}
                </div>
              </Card>
              <Card title="Accounts">
                <ul className="space-y-2">
                  {d.accounts.slice(0, 14).map((a: any) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Avatar a={a} />
                      <span className="min-w-0 flex-1"><b className="block truncate text-xs">{a.name}</b><span className="block truncate text-[11px] text-ink-faint">{a.bio}</span></span>
                      <button className="btn-quiet px-2 py-0.5 text-[11px]" onClick={() => career.mutate('/follow', { kind: 'account', id: a.id, on: !a.following }, quiet)}>{a.following ? 'Following' : 'Follow'}</button>
                    </li>
                  ))}
                </ul>
              </Card>
            </aside>
          </div>
        )}
      </Async>
    </div>
  );
}

