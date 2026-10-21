import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, dayLabel, pct, useApi } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Async, Badge, Card, Empty, ErrorState, Loading } from '../components/ui';
import { ClubCrestById, PlayerPortrait } from '../components/media';
import { PlayerName } from '../components/player';
import { Icon } from '../components/icons';
import { Manhattan, WinProb, Worm } from '../components/charts';
import { PosterStudio } from '../poster/PosterStudio';
import { BallByBall, LabLauncher } from './Fixtures';

const SECTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'scorecards', label: 'Scorecards' },
  { id: 'performances', label: 'Performances' },
  { id: 'moments', label: 'Key moments' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'tactics', label: 'Tactical review' },
  { id: 'impact', label: 'Career impact' },
];

/** The Post-Match Centre: every number here comes from the stored, validated match record. */
export function PostMatchPage() {
  const { fid } = useParams();
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/fixtures/${fid}/report`, [fid]);
  if (state.error?.status === 404) return <FixturePreview fid={fid!} />;
  return <Async state={state} label="Building the match report…">{(r) => <Report r={r} />}</Async>;
}

/** Fixtures without a record yet (not played) keep the simple fixture view. */
function FixturePreview({ fid }: { fid: string }) {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/fixtures/${fid}`, [fid]);
  if (state.error) return <ErrorState error={state.error} retry={state.reload} />;
  if (!state.data) return <Loading />;
  const f = state.data.fixture;
  return (
    <Empty title={`${f.homeName} v ${f.awayName}`}>
      {f.competition} · {f.stage} · {f.venue}. {f.status === 'complete' ? 'This match predates detailed records.' : 'This match has not been played yet.'}
    </Empty>
  );
}

function Report({ r }: { r: any }) {
  const career = useCareer();
  const nav = useNavigate();
  const [studio, setStudio] = useState(false);
  const club = (id: string | null) => (id === r.teams.home.clubId ? r.teams.home : r.teams.away);
  const winner = r.result.winnerClubId ? club(r.result.winnerClubId) : null;
  const scoreOf = (clubId: string) => r.innings.find((i: any) => i.battingClubId === clubId);
  const meta = r.meta;
  return (
    <div className="post-match space-y-8">
      {!r.validation.ok && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm" role="alert">
          <b>This record did not pass validation.</b> The scorecard is shown as recorded; posters are disabled.
          <ul className="mt-1 list-disc pl-5">{r.validation.issues.map((i: string) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      {/* opening */}
      <section className="card grain relative overflow-hidden p-6 md:p-10" aria-labelledby="pm-headline">
        {winner && <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-[0.16] blur-3xl" style={{ background: winner.colors[0] }} aria-hidden />}
        <div className="kicker">{meta.competition} · {meta.matchNumber ? `Match ${meta.matchNumber}` : meta.stage}{meta.matchNumber && meta.stage !== 'League' ? ` · ${meta.stage}` : ''}</div>
        <h1 id="pm-headline" className="headline mt-2 text-4xl md:text-5xl">{r.headline.title}</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">{r.headline.sub}</p>

        <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          {(['home', 'away'] as const).map((side, i) => {
            const t = r.teams[side];
            const inn = scoreOf(t.clubId);
            const won = r.result.winnerClubId === t.clubId;
            return (
              <div key={side} className={`flex items-center gap-4 ${i === 1 ? 'sm:order-3 sm:flex-row-reverse sm:text-right' : ''}`}>
                <ClubCrestById clubId={t.clubId} size={76} fallback={{ id: t.clubId, name: t.name, shortName: t.shortName, colors: t.colors }} />
                <div className="min-w-0">
                  <div className={`truncate font-display text-xl font-semibold uppercase tracking-wide ${won ? 'text-ink' : 'text-ink-muted'}`}>{t.name}</div>
                  <div className={`num font-display text-5xl font-bold leading-none ${won ? 'text-lime' : ''}`}>{inn ? `${inn.runs}${inn.allOut ? '' : `/${inn.wickets}`}` : 'DNB'}</div>
                  {inn && <div className="text-sm text-ink-muted">{inn.overs} overs{inn.target ? ` · target ${inn.target}` : ''}</div>}
                </div>
              </div>
            );
          })}
          <div className="text-center font-serif text-2xl text-ink-faint sm:order-2" aria-hidden>v</div>
        </div>

        <p className="mt-8 font-display text-2xl font-bold uppercase tracking-wide text-lime">{r.result.text}{r.result.superOver && r.result.kind === 'super-over' ? ' (super over)' : ''}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {meta.venue.name}{meta.day !== null ? ` · ${dayLabel(meta.season, meta.day)}` : ''} · {meta.season}
          {meta.toss && ` · ${club(meta.toss.winnerClubId).shortName} won the toss${meta.toss.decision ? ` and chose to ${meta.toss.decision}` : ''}`}
        </p>

        {r.playerOfMatch && (
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-obsidian-700 bg-obsidian-850/80 p-4">
            <PlayerPortrait player={{ id: r.playerOfMatch.playerId, name: r.playerOfMatch.name, source: 'curated' }} size={64} />
            <div className="min-w-0">
              <div className="kicker">Player of the match</div>
              <div className="headline text-xl"><PlayerName p={{ id: r.playerOfMatch.playerId, name: r.playerOfMatch.name }} /></div>
              <div className="num text-sm text-ink-muted">{r.playerOfMatch.line} · {club(r.playerOfMatch.clubId).shortName}</div>
            </div>
          </div>
        )}

        <div className="no-print mt-8 flex flex-wrap gap-3">
          <a href="#summary" className="btn-primary px-5 py-3 text-base"><Icon name="book" /> Full match report</a>
          <button className="btn-ghost px-5 py-3" disabled={!r.validation.ok} onClick={() => setStudio(true)}><Icon name="download" /> Export match PNG</button>
          <button className="btn-quiet px-4 py-3" onClick={() => nav(`/c/${career.id}`)}>Return to career</button>
          <span className="flex-1" />
          <button className="btn-quiet" onClick={() => window.print()}>Print report</button>
        </div>
      </section>

      <nav className="no-print sticky top-[61px] z-10 -mx-1 overflow-x-auto rounded-xl border border-obsidian-700 bg-obsidian-950/90 px-1 py-1 backdrop-blur" aria-label="Report sections">
        <ul className="flex gap-1 whitespace-nowrap text-sm">
          {SECTIONS.filter((s) => s.id !== 'impact' || r.impact).map((s) => (
            <li key={s.id}><a href={`#${s.id}`} className="block rounded-lg px-3 py-1.5 text-ink-muted hover:bg-obsidian-800 hover:text-ink">{s.label}</a></li>
          ))}
        </ul>
      </nav>

      <Summary r={r} />
      <Scorecards r={r} />
      <Performances r={r} />
      <Moments r={r} />
      <Analytics r={r} />
      <Tactics r={r} />
      {r.impact && <Impact r={r} />}
      <Extras r={r} />

      <PosterStudio report={r} open={studio} onClose={() => setStudio(false)} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 space-y-4" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h-section">{title}</h2>
      {children}
    </section>
  );
}

function Summary({ r }: { r: any }) {
  const decisive = r.moments.find((m: any) => m.kind === 'decisive');
  const name = (id: string) => (id === r.teams.home.clubId ? r.teams.home.name : r.teams.away.name);
  return (
    <Section id="summary" title="Match summary">
      <Card>
        <div className="kicker mb-3">{r.meta.competition.toUpperCase()} · {r.meta.season}{r.meta.matchNumber ? ` · MATCH ${r.meta.matchNumber}` : ''} · {r.meta.stage.toUpperCase()}</div>
        <ul className="space-y-1">
          {[...r.innings, ...r.superOvers].map((i: any) => (
            <li key={i.index} className="flex flex-wrap items-baseline justify-between gap-2 font-display text-2xl font-semibold uppercase">
              <span>{name(i.battingClubId)}{i.superOver ? ' (super over)' : ''}</span>
              <span className="num">{i.runs}{i.allOut ? '' : `/${i.wickets}`} <span className="text-base text-ink-muted">({i.overs} ov)</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-lg text-lime">{r.result.text}.</p>
        <p className="mt-1 text-sm text-ink-muted">{r.meta.venue.name}, {r.meta.venue.city}{r.meta.evening ? ' · evening match' : ''}{r.meta.day !== null ? ` · ${dayLabel(r.meta.season, r.meta.day)}` : ''}</p>
        {decisive && <p className="mt-3 text-sm"><b>Decisive moment:</b> {decisive.title.replace('The decisive over: ', 'over ')} — {decisive.detail}</p>}
      </Card>
    </Section>
  );
}

function Scorecards({ r }: { r: any }) {
  const name = (id: string) => (id === r.teams.home.clubId ? r.teams.home.name : r.teams.away.name);
  return (
    <Section id="scorecards" title="Scorecards">
      {[...r.innings, ...r.superOvers].map((inn: any) => (
        <Card key={inn.index} title={`${name(inn.battingClubId)} — ${inn.runs}${inn.allOut ? ' all out' : `/${inn.wickets}`} (${inn.overs} ov)${inn.superOver ? ' · super over' : ''}`} pad={false}>
          <div className="overflow-x-auto">
            <table className="table">
              <caption className="sr-only">Batting, {name(inn.battingClubId)}</caption>
              <thead><tr><th>Batter</th><th className="hidden sm:table-cell">Dismissal</th><th className="text-right">R</th><th className="text-right">B</th><th className="text-right">4s</th><th className="text-right">6s</th><th className="text-right">SR</th></tr></thead>
              <tbody>
                {inn.batting.map((b: any) => (
                  <tr key={b.playerId}>
                    <td><PlayerName p={{ id: b.playerId, name: b.name }} />{b.milestone && <Badge tone="lime">{b.milestone}</Badge>}<div className="text-xs text-ink-muted sm:hidden">{b.dismissal}</div></td>
                    <td className="hidden text-ink-muted sm:table-cell">{b.dismissal}</td>
                    <td className="num text-right font-semibold">{b.runs}{b.notOut ? '*' : ''}</td><td className="num text-right">{b.balls}</td>
                    <td className="num text-right">{b.fours}</td><td className="num text-right">{b.sixes}</td><td className="num text-right">{b.strikeRate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 border-t border-obsidian-700 px-4 py-3 text-sm">
            <p><span className="text-ink-muted">Extras</span> <b className="num">{inn.extras.total}</b> <span className="text-ink-faint">(w {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes})</span></p>
            <p><span className="text-ink-muted">Total</span> <b className="num">{inn.runs}{inn.allOut ? ' all out' : `/${inn.wickets}`}</b> <span className="text-ink-faint">({inn.overs} overs, run rate {inn.runRate ?? '—'})</span></p>
            {inn.didNotBat.length > 0 && <p><span className="text-ink-muted">Did not bat</span> {inn.didNotBat.map((p: any) => p.name).join(', ')}</p>}
            {inn.fallOfWickets.length > 0 && <p><span className="text-ink-muted">Fall of wickets</span> <span className="num">{inn.fallOfWickets.map((f: any) => `${f.wicket}-${f.runs} (${f.name}, ${f.over})`).join(' · ')}</span></p>}
          </div>
          <div className="overflow-x-auto border-t border-obsidian-700">
            <table className="table">
              <caption className="sr-only">Bowling against {name(inn.battingClubId)}</caption>
              <thead><tr><th>Bowler</th><th className="text-right">O</th><th className="text-right">M</th><th className="text-right">R</th><th className="text-right">W</th><th className="text-right">Econ</th><th className="text-right">Dots</th><th className="text-right">Wd</th><th className="text-right">Nb</th></tr></thead>
              <tbody>
                {inn.bowling.map((b: any) => (
                  <tr key={b.playerId}>
                    <td><PlayerName p={{ id: b.playerId, name: b.name }} /></td>
                    <td className="num text-right">{b.overs}</td><td className="num text-right">{b.maidens}</td><td className="num text-right">{b.runs}</td>
                    <td className="num text-right font-semibold">{b.wickets}</td><td className="num text-right">{b.economy ?? '—'}</td><td className="num text-right">{b.dots}</td>
                    <td className="num text-right">{b.wides}</td><td className="num text-right">{b.noBalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </Section>
  );
}

function Performances({ r }: { r: any }) {
  const short = (id: string) => (id === r.teams.home.clubId ? r.teams.home.shortName : r.teams.away.shortName);
  const list = (title: string, items: any[]) => (
    <Card title={title}>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.playerId} className="flex items-start justify-between gap-3">
              <span className="min-w-0"><PlayerName p={{ id: p.playerId, name: p.name }} /> <span className="text-xs text-ink-faint">{short(p.clubId)}</span>
                <span className="block text-xs text-ink-muted">{p.detail}</span>
                {p.tags.length > 0 && <span className="mt-1 flex gap-1">{p.tags.map((t: string) => <Badge key={t} tone="muted">{t}</Badge>)}</span>}
              </span>
              <span className="num shrink-0 font-display text-xl font-semibold">{p.line}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-muted">Nothing exceptional recorded.</p>}
    </Card>
  );
  const pom = r.playerOfMatch;
  return (
    <Section id="performances" title="Player performances">
      {pom && (
        <Card>
          <div className="flex flex-wrap items-start gap-4">
            <PlayerPortrait player={{ id: pom.playerId, name: pom.name, source: 'curated' }} size={72} />
            <div className="min-w-0 flex-1">
              <div className="kicker">Player of the match</div>
              <div className="headline text-2xl"><PlayerName p={{ id: pom.playerId, name: pom.name }} /> <span className="num text-lg text-ink-muted">{pom.line}</span></div>
              <p className="mt-1 text-sm text-ink-muted">{pom.explanation}</p>
              <p className="mt-2 text-xs text-ink-faint">Contribution model: batting {pom.breakdown.batting}, bowling {pom.breakdown.bowling}, fielding {pom.breakdown.fielding}, match impact {pom.breakdown.impact} (from win-probability swings — an estimate).</p>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {list('Batting', r.performances.batting)}
        {list('Bowling', r.performances.bowling)}
        {list('Fielding', r.performances.fielding)}
      </div>
    </Section>
  );
}

function Moments({ r }: { r: any }) {
  const color = (id: string | null) => (id === r.teams.home.clubId ? r.teams.home.colors[0] : id === r.teams.away.clubId ? r.teams.away.colors[0] : 'rgb(var(--line-stronger))');
  return (
    <Section id="moments" title="Key moments">
      <Card>
        <ol className="relative space-y-4 border-l border-obsidian-700 pl-6">
          {r.moments.map((m: any, i: number) => (
            <li key={`${m.seq}-${i}`} className="relative">
              <span className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-obsidian-900 ${m.important ? 'ring-2 ring-lime/40' : ''}`} style={{ background: color(m.clubId) }} aria-hidden />
              <div className="text-[11px] uppercase tracking-wider text-ink-faint">{m.innings + 1 > r.innings.length ? 'Super over' : `Innings ${m.innings + 1}`} · {m.kind === 'decisive' ? `over ${m.over}` : m.over}</div>
              <div className={`font-medium ${m.important ? 'text-ink' : 'text-ink'}`}>{m.title}</div>
              <div className="text-sm text-ink-muted">{m.detail}</div>
            </li>
          ))}
        </ol>
      </Card>
    </Section>
  );
}

function Analytics({ r }: { r: any }) {
  const a = r.analytics;
  const short = (id: string) => (id === r.teams.home.clubId ? r.teams.home.shortName : r.teams.away.shortName);
  const colorOf = (id: string) => (id === r.innings[0]?.battingClubId ? 'rgb(var(--accent))' : 'rgb(var(--info))');
  return (
    <Section id="analytics" title="Match analytics">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scoring progression"><Worm innings={a.manhattan.map((m: any) => m.runs)} labels={a.manhattan.map((m: any) => short(m.clubId))} overs={r.innings[0]?.maxOvers ?? 20} /></Card>
        {a.winProbability.available ? (
          <Card title="Win probability"><WinProb points={a.winProbability.home} home={r.teams.home.shortName} away={r.teams.away.shortName} /><p className="mt-1 text-xs text-ink-faint">{a.winProbability.note}</p></Card>
        ) : null}
        {a.manhattan.map((m: any) => <Card key={m.clubId} title={`Runs per over — ${short(m.clubId)}`}><Manhattan runs={m.runs} wickets={m.wickets} label={short(m.clubId)} /></Card>)}
        <Card title="Partnerships">
          <div className="space-y-4">
            {a.partnerships.map((p: any) => {
              const max = Math.max(20, ...a.partnerships.flatMap((x: any) => x.items.map((i: any) => i.runs)));
              return (
                <div key={p.clubId}>
                  <div className="label mb-1">{short(p.clubId)}</div>
                  <ul className="space-y-1">
                    {p.items.map((i: any) => (
                      <li key={i.wicket} className="grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 text-xs">
                        <span className="text-ink-faint">{i.wicket}</span>
                        <span className="relative h-4 overflow-hidden rounded bg-obsidian-800" title={i.names}>
                          <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${(i.runs / max) * 100}%`, background: colorOf(p.clubId), opacity: 0.8 }} />
                          <span className="relative px-1.5 leading-4 text-ink">{i.names}</span>
                        </span>
                        <span className="num text-right">{i.runs} ({i.balls})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Bowling economy">
          <ul className="space-y-1.5">
            {a.economy.slice(0, 12).map((b: any) => (
              <li key={b.playerId} className="grid grid-cols-[1fr_8rem_4.5rem] items-center gap-2 text-xs">
                <span className="truncate">{b.name} <span className="text-ink-faint">{short(b.clubId)}</span></span>
                <span className="h-2 overflow-hidden rounded bg-obsidian-800"><span className="block h-full rounded" style={{ width: `${Math.min(100, (b.economy / 16) * 100)}%`, background: b.economy <= 7.5 ? 'rgb(var(--accent))' : b.economy >= 11 ? 'rgb(var(--danger))' : 'rgb(var(--warn))' }} /></span>
                <span className="num text-right">{b.economy.toFixed(2)} · {b.wickets}w</span>
              </li>
            ))}
          </ul>
        </Card>
        {a.wagon && a.wagon.map((wg: any) => <Card key={wg.clubId} title={`Scoring shots — ${short(wg.clubId)}`}><Wagon shots={wg.shots} color={colorOf(wg.clubId)} /></Card>)}
      </div>
      {a.unavailable.length > 0 && <p className="text-xs text-ink-faint">{a.unavailable.join(' ')}</p>}
    </Section>
  );
}

/** Wagon wheel from recorded shot end points (metres from the pitch centre; up = straight). */
function Wagon({ shots, color }: { shots: any[]; color: string }) {
  const S = 220;
  const k = (S / 2 - 8) / 85;
  const cx = S / 2;
  const cy = S / 2;
  const sy = cy + 8.8 * k;
  const fours = shots.filter((s) => s.boundary === 4).length;
  const sixes = shots.filter((s) => s.boundary === 6).length;
  return (
    <figure>
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto w-full max-w-[280px]" role="img" aria-label={`${shots.length} scoring shots: ${fours} fours, ${sixes} sixes`}>
        <ellipse cx={cx} cy={cy} rx={S / 2 - 6} ry={S / 2 - 6} fill="rgb(var(--forest))" fillOpacity="0.35" stroke="rgb(var(--line-strong))" />
        <ellipse cx={cx} cy={cy} rx={30 * k} ry={30 * k + 10 * k} fill="none" stroke="rgb(var(--line))" strokeDasharray="3 3" />
        <rect x={cx - 1.5 * k} y={cy - 10 * k} width={3 * k} height={20 * k} fill="rgb(var(--warn))" fillOpacity="0.35" />
        {shots.map((s, i) => (
          <line key={i} x1={cx} y1={sy} x2={cx + s.x * k} y2={cy - s.y * k} stroke={s.boundary ? color : 'rgb(var(--text-faint))'} strokeOpacity={s.boundary ? 0.95 : 0.45} strokeWidth={s.boundary === 6 ? 1.6 : 1} />
        ))}
      </svg>
      <figcaption className="text-center text-xs text-ink-muted">{shots.length} scoring shots · {fours} fours · {sixes} sixes · up is straight down the ground</figcaption>
    </figure>
  );
}

function Tactics({ r }: { r: any }) {
  const t = r.tactics;
  return (
    <Section id="tactics" title="Tactical review">
      <Card>
        <p className="text-xs text-ink-faint">{t.perspective}. Observations are recorded facts; estimates come from the engine’s models; suggestions are for you to judge.</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div><div className="label mb-2">Observed</div><ul className="space-y-1.5 text-sm">{t.observed.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
          <div><div className="label mb-2">Estimates</div>{t.estimates.length ? <ul className="space-y-1.5 text-sm text-ink-muted">{t.estimates.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-ink-muted">No model estimates for this match.</p>}</div>
          <div><div className="label mb-2 text-lime">Suggestions</div><ul className="space-y-1.5 text-sm">{t.suggestions.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </Card>
    </Section>
  );
}

function Impact({ r }: { r: any }) {
  const m = r.impact;
  const s = m.standings;
  const changed = m.players.filter((p: any) => p.played || p.injury);
  const delta = (a: number, b: number, digits = 0) => {
    const d = b - a;
    return <span className={d > 0 ? 'text-lime' : d < 0 ? 'text-danger' : 'text-ink-faint'}>{d > 0 ? '+' : ''}{d.toFixed(digits)}</span>;
  };
  return (
    <Section id="impact" title="Career impact">
      <p className="text-xs text-ink-faint">Captured when this result was applied to your career; later events do not change it.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="League table">
          {s ? (
            <dl className="grid grid-cols-3 gap-3 text-center text-sm">
              <div><dt className="label">Position</dt><dd className="num text-2xl">{s.after.position ?? '—'}<span className="text-sm text-ink-faint">/{s.after.teams}</span></dd><dd className="text-xs text-ink-muted">was {s.before.position ?? '—'}</dd></div>
              <div><dt className="label">Points</dt><dd className="num text-2xl">{s.after.points}</dd><dd className="text-xs">{delta(s.before.points, s.after.points)}</dd></div>
              <div><dt className="label">NRR</dt><dd className="num text-2xl">{s.after.nrr >= 0 ? '+' : ''}{s.after.nrr.toFixed(3)}</dd><dd className="text-xs">{delta(s.before.nrr, s.after.nrr, 3)}</dd></div>
            </dl>
          ) : <p className="text-sm text-ink-muted">Knockout fixture: no league-table change.</p>}
          {m.odds && <p className="mt-3 text-sm text-ink-muted">Afterwards the engine estimated a {pct(m.odds.playoffs)} playoff chance and {pct(m.odds.wcc)} for a World Club Championship place.</p>}
        </Card>
        <Card title="Records & milestones">
          {m.records.length || m.timeline.length || m.news.length ? (
            <ul className="space-y-2 text-sm">
              {m.records.map((x: string) => <li key={x}><Badge tone="lime">Record</Badge> {x}</li>)}
              {m.timeline.map((x: any) => <li key={x.title}><b>{x.title}</b> <span className="text-ink-muted">{x.detail}</span></li>)}
              {m.news.filter((n: any) => !/ beat | lose to | tie$/.test(n.headline)).map((x: any) => <li key={x.headline}>{x.headline}</li>)}
            </ul>
          ) : <p className="text-sm text-ink-muted">No new records or milestones.</p>}
        </Card>
        <Card title="Injuries">
          {m.players.some((p: any) => p.injury) ? (
            <ul className="space-y-1 text-sm">{m.players.filter((p: any) => p.injury).map((p: any) => <li key={p.id}><PlayerName p={p} />: {p.injury}, about {p.injuryDays} days</li>)}</ul>
          ) : <p className="text-sm text-ink-muted">No new injuries.</p>}
        </Card>
      </div>
      <Card title="Form, fatigue & morale" pad={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Player</th><th className="text-right">Form</th><th className="text-right">Fatigue</th><th className="text-right">Morale</th></tr></thead>
            <tbody>
              {changed.map((p: any) => (
                <tr key={p.id}>
                  <td><PlayerName p={p} />{!p.played && <span className="ml-1 text-xs text-ink-faint">(did not play)</span>}</td>
                  <td className="num text-right">{p.form[1]} {delta(p.form[0], p.form[1])}</td>
                  <td className="num text-right">{Math.round(p.fatigue[1])} {delta(p.fatigue[0], p.fatigue[1], 1)}</td>
                  <td className="num text-right">{Math.round(p.morale[1])} {delta(p.morale[0], p.morale[1], 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}

/** Ball-by-ball log and Scenario Lab, loaded only on request. */
function Extras({ r }: { r: any }) {
  const career = useCareer();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const full = useApi<any>(open ? `/careers/${career.id}/fixtures/${r.fixtureId}` : null, [open]);
  return (
    <section className="no-print space-y-3">
      <details className="card p-4" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer font-medium">Ball-by-ball commentary & Scenario Lab</summary>
        <div className="mt-4 space-y-3">
          {full.data?.match ? (
            <>
              {full.data.match.setup.userSide && (
                <LabLauncher deliveries={full.data.match.deliveries} onStart={async (seq) => {
                  try {
                    await api(`/careers/${career.id}/lab/start`, { body: { fixtureId: r.fixtureId, fromSeq: seq } });
                    nav(`/c/${career.id}/lab`);
                  } catch (e) {
                    toast.push('error', (e as Error).message);
                  }
                }} />
              )}
              <BallByBall m={full.data.match} />
            </>
          ) : <p className="text-sm text-ink-muted">Loading…</p>}
        </div>
      </details>
      <p className="text-[11px] text-ink-faint">Report v{r.version} · engine {r.engineVersion} · built on this device from the stored match record.</p>
    </section>
  );
}
