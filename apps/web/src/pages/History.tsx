import { useEffect, useState } from 'react';
import { dayLabel } from '../lib/api';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Link } from 'react-router-dom';
import { Async, Badge, Card, Empty, PageHeader, Tabs } from '../components/ui';

export function HistoryPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/history`, [career.tick]);
  const news = useApi<any>(`/careers/${career.id}/news`, [career.tick]);
  const [tab, setTab] = useState<'chronicle' | 'timeline' | 'archive' | 'seasons' | 'records' | 'hof' | 'news'>('seasons');
  const hasChronicle = !!state.data?.chronicles?.length;
  useEffect(() => { if (hasChronicle) setTab('chronicle'); }, [hasChronicle]);
  const o = career.overview.data;
  return (
    <div className="space-y-5">
      <PageHeader kicker="Legacy" title="History" subtitle="Every headline, record and trophy here comes from a real event in this career." />
      {o?.phase === 'offseason' && <div className="rounded-xl border border-lime/40 bg-lime/5 p-4 text-sm">The season is over. Review the awards and champions, then press <b>Begin off-season</b> in the top bar to develop players, update reputations and open retentions.</div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'chronicle', label: 'Season chronicle' }, { id: 'timeline', label: 'Career timeline' }, { id: 'archive', label: 'Match archive' }, { id: 'seasons', label: 'Seasons & awards' }, { id: 'records', label: 'Records & rivalries' }, { id: 'hof', label: 'Hall of Fame' }, { id: 'news', label: 'News archive' }]} />
      <Async state={state}>
        {(d) => (
          <>
            {tab === 'seasons' && (
              <div className="space-y-5">
                {d.awards.length > 0 && (
                  <Card title="Awards">
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead><tr><th>Season</th><th>Competition</th><th>Award</th><th>Player</th><th>Detail</th></tr></thead>
                        <tbody>{[...d.awards].reverse().slice(0, 150).map((a: any, i: number) => <tr key={i}><td className="num">{a.season}</td><td>{a.competition}</td><td><Badge tone={a.award === 'Orange Cap' ? 'warn' : a.award === 'Purple Cap' ? 'info' : 'lime'}>{a.award}</Badge></td><td>{a.playerName}</td><td className="text-ink-muted">{a.value}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </Card>
                )}
                {d.seasons.length ? [...d.seasons].reverse().map((s: any) => (
                  <Card key={s.season} title={`${s.season}`}>
                    <p className="text-sm">Your club: <b>{s.userClub.result}</b> ({s.userClub.won}/{s.userClub.played} wins)</p>
                    <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{s.champions.map((c: any) => <li key={c.competitionId}><span className="text-ink-muted">{c.name}:</span> {c.clubName} <span className="text-ink-faint">(beat {c.runnerUpName})</span></li>)}</ul>
                  </Card>
                )) : <Empty title="Your first season is still being written" />}
                {d.trophies.length > 0 && <Card title="Your trophy cabinet"><ul className="flex flex-wrap gap-2">{d.trophies.map((t: any, i: number) => <li key={i}><Badge tone="lime">🏆 {t.name} {t.season}</Badge></li>)}</ul></Card>}
                {d.formerClubs.length > 0 && <Card title="Previous clubs"><ul className="text-sm">{d.formerClubs.map((f: any, i: number) => <li key={i}>{f.name}: {f.from}–{f.to}</li>)}</ul></Card>}
              </div>
            )}
            {tab === 'records' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="All-time records">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-ink-muted">Highest total</dt><dd>{d.records.highestTeamTotal ? `${d.records.highestTeamTotal.runs} — ${d.records.highestTeamTotal.club} (${d.records.highestTeamTotal.season})` : '—'}</dd>
                    <dt className="text-ink-muted">Lowest all-out total</dt><dd>{d.records.lowestTeamTotal ? `${d.records.lowestTeamTotal.runs} — ${d.records.lowestTeamTotal.club} (${d.records.lowestTeamTotal.season})` : '—'}</dd>
                    <dt className="text-ink-muted">Highest score</dt><dd>{d.records.highestScore ? `${d.records.highestScore.runs} (${d.records.highestScore.balls}) — ${d.records.highestScore.player}` : '—'}</dd>
                    <dt className="text-ink-muted">Best bowling</dt><dd>{d.records.bestBowling ? `${d.records.bestBowling.wickets}/${d.records.bestBowling.runs} — ${d.records.bestBowling.player}` : '—'}</dd>
                    <dt className="text-ink-muted">Most career runs</dt><dd>{d.records.mostCareerRuns ? `${d.records.mostCareerRuns.runs} — ${d.records.mostCareerRuns.player}` : 'after season 1'}</dd>
                    <dt className="text-ink-muted">Most career wickets</dt><dd>{d.records.mostCareerWickets ? `${d.records.mostCareerWickets.wickets} — ${d.records.mostCareerWickets.player}` : 'after season 1'}</dd>
                  </dl>
                </Card>
                <Card title="Your rivalries">
                  {d.rivalries.length ? (
                    <ul className="space-y-2 text-sm">
                      {d.rivalries.map((r: any) => (
                        <li key={r.key} className="flex flex-wrap justify-between gap-2 border-b border-obsidian-800 pb-2">
                          <span>{r.names.join(' v ')}</span>
                          <span className="text-xs text-ink-muted">{r.meetings} meetings · {r.knockoutMeetings} knockouts · {r.finals} finals · intensity {r.intensity}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-ink-muted">Rivalries form from repeated meetings, knockouts, finals and shared cities.</p>}
                </Card>
                <Card title="Champions roll" className="lg:col-span-2">
                  <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">{[...d.champions].reverse().map((c: any, i: number) => <li key={i}><span className="text-ink-muted">{c.season} {c.leagueId}:</span> {c.clubName}</li>)}</ul>
                </Card>
              </div>
            )}
            {tab === 'hof' && (
              <Card title="Hall of Fame">
                {d.hallOfFame.length ? <ul className="space-y-2">{[...d.hallOfFame].reverse().map((h: any) => <li key={h.id} className="text-sm"><Badge tone="lime">{h.kind}</Badge> <b>{h.title}</b> <span className="text-ink-muted">— {h.detail} ({h.season})</span></li>)}</ul> : <Empty title="No legends yet">Dynasties, records and retired greats are inducted as they happen.</Empty>}
              </Card>
            )}
            {tab === 'chronicle' && (d.chronicles.length ? (
              <div className="space-y-6">
                {[...d.chronicles].reverse().map((c: any) => (
                  <article key={c.season} className="card grain p-6 md:p-8">
                    <div className="kicker">Season chronicle · {c.season}</div>
                    <h2 className="headline mt-2 text-3xl">{c.headline}</h2>
                    <p className="mt-3 max-w-3xl text-ink-muted">{c.summary}</p>
                    <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                      {c.sections.map((sec: any) => (
                        <section key={sec.title}>
                          <h3 className="label mb-2">{sec.title}</h3>
                          <ul className="space-y-1.5 text-sm">{sec.items.map((it: string, i: number) => <li key={i} className="flex gap-2"><span className="text-ink-faint">—</span>{it}</li>)}</ul>
                        </section>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : <Empty title="The first chronicle is written at season's end">Every chapter is assembled from what actually happened: results, signings, debuts, injuries and records.</Empty>)}
            {tab === 'archive' && <MatchArchive seasons={[...new Set([career.overview.data?.season, ...d.seasons.map((x: any) => x.season)].filter(Boolean))] as number[]} />}
            {tab === 'timeline' && (
              <Card title="Career timeline">
                {d.timeline.length ? (
                  <ol className="relative space-y-4 border-l border-obsidian-700 pl-5">
                    {d.timeline.map((t: any) => (
                      <li key={t.id} className="relative">
                        <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-lime" aria-hidden />
                        <div className="text-[11px] text-ink-faint">{dayLabel(t.season, t.day)} · {t.kind}</div>
                        <div className="font-medium">{t.title}</div>
                        {t.detail && <div className="text-sm text-ink-muted">{t.detail}</div>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-ink-muted">Your story starts here.</p>}
              </Card>
            )}
            {tab === 'news' && (
              <Async state={news}>
                {(n) => (
                  <Card title="News archive" pad={false}>
                    <ul className="max-h-[70vh] divide-y divide-obsidian-800 overflow-y-auto">
                      {n.news.map((x: any) => (
                        <li key={x.id} className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2"><Badge tone={x.importance === 3 ? 'lime' : 'muted'}>{x.kind}</Badge><span className="text-xs text-ink-faint">{x.season} · day {x.day}</span></div>
                          <div className="mt-1 font-semibold">{x.headline}</div>
                          <div className="text-ink-muted">{x.body}</div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </Async>
            )}
          </>
        )}
      </Async>
    </div>
  );
}

/** Every match your club played, by season, linking to its Post-Match Centre report. */
function MatchArchive({ seasons }: { seasons: number[] }) {
  const career = useCareer();
  const sorted = [...seasons].sort((a, b) => b - a);
  const [picked, setSeason] = useState<number | null>(null);
  const season = picked ?? sorted[0] ?? null;
  const state = useApi<any>(season ? `/careers/${career.id}/archive?season=${season}` : null, [season, career.tick]);
  return (
    <Card title={<span className="flex items-center gap-3">Match archive <select aria-label="Season" className="input w-auto py-1 text-sm" value={season ?? ''} onChange={(e) => setSeason(Number(e.target.value))}>{sorted.map((x) => <option key={x} value={x}>{x}</option>)}</select></span>} pad={false}>
      <Async state={state}>
        {(a) => a.matches.length ? (
          <ul className="divide-y divide-obsidian-800">
            {a.matches.map((m: any) => (
              <li key={m.fixtureId}>
                <Link to={`/c/${career.id}/fixtures/${m.fixtureId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-obsidian-850">
                  <span className="w-20 shrink-0 text-xs text-ink-muted">{m.day !== null ? dayLabel(m.season, m.day) : m.season}</span>
                  <span className="min-w-[200px] flex-1"><b className={m.winnerClubId === m.home.clubId ? 'text-ink' : 'text-ink-muted'}>{m.home.shortName}</b> v <b className={m.winnerClubId === m.away.clubId ? 'text-ink' : 'text-ink-muted'}>{m.away.shortName}</b> <span className="text-xs text-ink-faint">{m.stage}</span></span>
                  <span className="num text-ink-muted">{m.scores.map((x: any) => `${x.runs}/${x.wickets}`).join(' · ')}</span>
                  <span className="text-xs">{m.result}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-ink-muted">No recorded matches for this season.</p>}
      </Async>
    </Card>
  );
}
