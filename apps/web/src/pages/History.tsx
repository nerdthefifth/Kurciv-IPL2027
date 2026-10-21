import { useState } from 'react';
import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Empty, PageHeader, Tabs } from '../components/ui';

export function HistoryPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/history`, [career.tick]);
  const news = useApi<any>(`/careers/${career.id}/news`, [career.tick]);
  const [tab, setTab] = useState<'seasons' | 'records' | 'hof' | 'chronicle'>('seasons');
  const o = career.overview.data;
  return (
    <div className="space-y-5">
      <PageHeader title="History" subtitle="Every headline, record and trophy here comes from a real event in this career." />
      {o?.phase === 'offseason' && <div className="rounded-xl border border-lime/40 bg-lime/5 p-4 text-sm">The season is over. Review the awards and champions, then press <b>Begin off-season</b> in the top bar to develop players, update reputations and open retentions.</div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'seasons', label: 'Seasons & awards' }, { id: 'records', label: 'Records & rivalries' }, { id: 'hof', label: 'Hall of Fame' }, { id: 'chronicle', label: 'Chronicle' }]} />
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
            {tab === 'chronicle' && (
              <Async state={news}>
                {(n) => (
                  <Card title="World-state chronicle" pad={false}>
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
