import { Link } from 'react-router-dom';
import { PHASE_LABEL, cr, dayLabel, pct } from '../lib/api';
import { useCareer } from '../lib/context';
import { ContinueButton, DecisionLink } from '../components/Shell';
import { StoryCard } from '../components/story';
import { ClubCrest, ClubCrestById } from '../components/media';
import { PlayerName } from '../components/player';
import { Icon } from '../components/icons';
import { Badge, ErrorState, Meter, Skeleton } from '../components/ui';

const PHASE_STORY: Record<string, { kicker: string; title: string; body: string }> = {
  retention: { kicker: 'A new season', title: 'Who do you keep?', body: 'Choose the core you will build around. Everyone else goes back into the pool, and the auction cascade begins as soon as you commit.' },
  auction: { kicker: 'The Auction House', title: 'The room is filling up', body: 'Franchise tables are set, purses are loaded and the auctioneer is ready. Every rupee you spend shapes the season ahead.' },
  preseason: { kicker: 'Pre-season', title: 'The squad is assembled', body: 'Settle your XI, tune your tactics and fields, then start the season when you are ready.' },
  offseason: { kicker: 'Season over', title: 'Time to take stock', body: 'Read the season chronicle, then move into the off-season: development, retirements and a new academy intake.' },
};

const TIMELINE_ICON: Record<string, IconLike> = {
  season: 'calendar', signing: 'gavel', debut: 'star', record: 'trophy', milestone: 'sparkle', injury: 'medical', return: 'check', achievement: 'trophy',
  rivalry: 'flag', qualification: 'world', title: 'trophy', retirement: 'history', auction: 'gavel', board: 'shield',
};
type IconLike = Parameters<typeof Icon>[0]['name'];

export function OverviewPage() {
  const { overview, id: cid } = useCareer();
  if (overview.error && !overview.data) return <ErrorState error={overview.error} retry={overview.reload} />;
  const o = overview.data;
  if (!o) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    );
  }
  const g = o.glance;
  const dr = o.dressingRoom;
  return (
    <div className="space-y-6">
      <NextChapter o={o} />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {o.decisions.length > 0 && (
            <section aria-labelledby="decisions">
              <h2 id="decisions" className="h-section mb-3">Next decisions</h2>
              <div className="grid gap-2 md:grid-cols-2">{o.decisions.map((d: any) => <DecisionLink key={d.label} d={d} />)}</div>
            </section>
          )}

          <section aria-labelledby="stories">
            <h2 id="stories" className="h-section mb-3">Club story</h2>
            {o.stories.length ? (
              <div className="grid gap-3 md:grid-cols-2">{o.stories.map((s: any) => <StoryCard key={s.id} story={s} />)}</div>
            ) : (
              <p className="panel p-4 text-sm text-ink-muted">Quiet days at the club. Stories appear when something actually happens — a debut, a slump, an injury, a rivalry renewed.</p>
            )}
          </section>

          <section aria-labelledby="timeline" className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 id="timeline" className="h-section mb-3">Career timeline</h2>
              {o.timeline.length ? (
                <ol className="relative space-y-3 border-l border-obsidian-700 pl-5">
                  {o.timeline.map((t: any) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[29px] top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border border-obsidian-600 bg-obsidian-900 text-ink-muted">
                        <Icon name={TIMELINE_ICON[t.kind] ?? 'sparkle'} size={11} />
                      </span>
                      <div className="text-[11px] text-ink-faint">{dayLabel(t.season, t.day)}</div>
                      <div className="text-sm font-medium">{t.title}</div>
                      {t.detail && <div className="text-xs text-ink-muted">{t.detail}</div>}
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-ink-muted">Your story starts here.</p>}
              <Link to={`/c/${cid}/history`} className="btn-quiet mt-3 -ml-2 text-xs">Full history <Icon name="chevronRight" size={14} /></Link>
            </div>
            <div>
              <h2 className="h-section mb-3">Around the world</h2>
              {o.world.length ? (
                <ul className="space-y-2.5">
                  {o.world.map((n: any) => (
                    <li key={n.id} className="text-sm">
                      <div className="text-[11px] text-ink-faint">{dayLabel(n.season, n.day)}</div>
                      <div className="font-medium">{n.headline}</div>
                      {n.body && <div className="text-xs text-ink-muted">{n.body}</div>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-muted">No major news from other leagues yet.</p>}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-5" aria-labelledby="glance">
            <div className="flex items-baseline justify-between">
              <h2 id="glance" className="h-section">Season at a glance</h2>
              <span className="text-xs text-ink-faint">{o.club.leagueShort}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div><div className="label">Position</div><div className="num text-2xl font-semibold">{g.position ?? '—'}<span className="text-sm text-ink-faint">{g.teams ? `/${g.teams}` : ''}</span></div></div>
              <div><div className="label">Points</div><div className="num text-2xl font-semibold">{g.points ?? '—'}</div></div>
              <div><div className="label">NRR</div><div className="num text-2xl font-semibold">{g.nrr === null ? '—' : `${g.nrr >= 0 ? '+' : ''}${g.nrr.toFixed(2)}`}</div></div>
            </div>
            {g.form.length > 0 && (
              <div className="mt-4 flex items-center gap-1.5">
                <span className="label mr-1">Form</span>
                {g.form.map((r: string, i: number) => (
                  <span key={i} className={`grid h-6 w-6 place-items-center rounded-md text-xs font-bold ${r === 'W' ? 'bg-lime text-obsidian-950' : r === 'L' ? 'bg-danger/80 text-obsidian-950' : 'bg-obsidian-700'}`} title={r === 'W' ? 'Won' : r === 'L' ? 'Lost' : 'Tied / no result'}>{r}</span>
                ))}
              </div>
            )}
            {g.odds && (
              <div className="mt-4 space-y-2">
                <Meter label="Playoff chance" display={pct(g.odds.playoffs)} value={g.odds.playoffs * 100} />
                <Meter label="World Club Championship place" display={pct(g.odds.wcc)} value={g.odds.wcc * 100} />
                <p className="text-[11px] text-ink-faint">Estimated from 400 simulations of the remaining fixtures.</p>
              </div>
            )}
            {g.table.length > 0 && (
              <table className="table mt-4">
                <thead><tr><th>#</th><th>Club</th><th className="text-right">P</th><th className="text-right">Pts</th></tr></thead>
                <tbody>
                  {g.table.map((r: any) => (
                    <tr key={r.clubId} className={r.isUser ? 'bg-lime/5 font-semibold' : ''}>
                      <td className="num">{r.pos}</td>
                      <td><span className="flex items-center gap-2"><ClubCrestById clubId={r.clubId} size={18} fallback={{ id: r.clubId, name: r.name, shortName: r.short, colors: r.colors }} />{r.short}</span></td>
                      <td className="num text-right">{r.played}</td>
                      <td className="num text-right">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card p-5" aria-labelledby="board">
            <h2 id="board" className="h-section">The board</h2>
            <div className="mt-3"><Meter label="Confidence" value={o.glance.confidence} /></div>
            <ul className="mt-3 space-y-2 text-sm">
              {g.objectives.map((ob: any) => (
                <li key={ob.id} className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ob.status === 'met' ? 'bg-lime' : ob.status === 'failed' ? 'bg-danger' : 'bg-ink-faint'}`} aria-hidden />
                  <span className="flex-1">{ob.description}</span>
                  <Badge tone={ob.status === 'met' ? 'lime' : ob.status === 'failed' ? 'danger' : ob.importance === 'high' ? 'warn' : 'muted'}>{ob.status === 'pending' ? ob.importance : ob.status}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5" aria-labelledby="dressing">
            <div className="flex items-baseline justify-between">
              <h2 id="dressing" className="h-section">Dressing room</h2>
              <span className="text-xs text-ink-faint">{dr.squadSize} players · strength {o.squadStrength ?? '—'}</span>
            </div>
            {dr.avgMorale !== null && <div className="mt-3"><Meter label="Squad morale" value={dr.avgMorale} /></div>}
            <DressingList title="In form" tone="text-lime" items={dr.inForm.map((p: any) => ({ p, note: `+${p.form}` }))} />
            <DressingList title="Injured" tone="text-danger" items={dr.injured.map((p: any) => ({ p, note: `${p.injury}, ~${p.days}d` }))} />
            <DressingList title="Tired" tone="text-warn" items={dr.tired.map((p: any) => ({ p, note: `fatigue ${p.fatigue}` }))} />
            <DressingList title="Unsettled" tone="text-warn" items={dr.unhappy.map((p: any) => ({ p, note: `morale ${p.morale}` }))} />
            {!dr.inForm.length && !dr.injured.length && !dr.tired.length && !dr.unhappy.length && <p className="mt-3 text-sm text-ink-muted">All quiet: fit, rested and settled.</p>}
            {dr.youngest > 0 && <p className="mt-3 text-xs text-ink-faint">{dr.youngest} player{dr.youngest > 1 ? 's' : ''} aged 21 or under.</p>}
          </section>

          <section className="card grid grid-cols-2 gap-3 p-5 text-sm">
            <div><div className="label">Auction purse</div><div className="num text-lg">{cr(o.finance.purse)}</div></div>
            <div><div className="label">Club cash</div><div className="num text-lg">{cr(o.finance.cash)}</div></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DressingList({ title, tone, items }: { title: string; tone: string; items: { p: any; note: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <div className={`label ${tone}`}>{title}</div>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map(({ p, note }) => <li key={p.id} className="flex justify-between gap-2"><PlayerName p={p} /><span className="text-xs text-ink-muted">{note}</span></li>)}
      </ul>
    </div>
  );
}

function NextChapter({ o }: { o: any }) {
  const { id: cid } = useCareer();
  const nc = o.nextChapter;
  const accent = o.club.colors[0];
  if (!nc || o.phase === 'auction' || o.phase === 'retention' || o.phase === 'offseason' || o.phase === 'preseason') {
    const s = PHASE_STORY[o.phase] ?? { kicker: PHASE_LABEL[o.phase], title: 'The next chapter', body: 'Continue to move the story forward.' };
    return (
      <section className="card grain relative overflow-hidden p-6 md:p-8">
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${o.club.colors[0]}, ${o.club.colors[1]})` }} aria-hidden />
        <div className="flex flex-wrap items-center gap-6">
          <ClubCrestById clubId={o.club.id} fallback={o.club} size={84} />
          <div className="min-w-0 flex-1">
            <div className="kicker">{s.kicker} · {o.season}</div>
            <h1 className="headline mt-1 text-3xl md:text-4xl">{s.title}</h1>
            <p className="mt-2 max-w-2xl text-ink-muted">{s.body}</p>
          </div>
          <ContinueButton big />
        </div>
      </section>
    );
  }
  const f = nc.fixture;
  return (
    <section className="card grain relative overflow-hidden p-6 md:p-8" aria-labelledby="next-chapter">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl" style={{ background: accent }} aria-hidden />
      <div className="kicker">{nc.today ? 'Match day' : 'Next chapter'} · {f.competition} · {dayLabel(o.season, f.day)}</div>
      <div className="mt-4 flex flex-wrap items-center gap-6 md:gap-10">
        <div className="flex items-center gap-4">
          <ClubCrestById clubId={f.homeId} size={68} fallback={f.homeId === o.club.id ? o.club : undefined} />
          <span className="headline text-2xl text-ink-faint">v</span>
          <ClubCrestById clubId={f.awayId} size={68} fallback={f.awayId === o.club.id ? o.club : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 id="next-chapter" className="headline text-3xl md:text-4xl">{f.homeName} <span className="text-ink-faint">v</span> {f.awayName}</h1>
          <p className="mt-1 text-sm text-lime">{nc.stakes}</p>
        </div>
      </div>
      <ul className="mt-5 grid gap-x-8 gap-y-1.5 text-sm text-ink-muted md:grid-cols-2">
        {nc.lines.map((l: string) => <li key={l} className="flex gap-2"><span className="text-ink-faint">—</span>{l}</li>)}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <ContinueButton big />
        <Link to={`/c/${cid}/squad`} className="btn-ghost">Pick XI</Link>
        <Link to={`/c/${cid}/tactics`} className="btn-ghost">Tactics</Link>
        {f.homeId && f.awayId && <Link to={`/c/${cid}/club/${f.homeId === o.club.id ? f.awayId : f.homeId}`} className="btn-quiet">Opponent dossier</Link>}
      </div>
    </section>
  );
}
