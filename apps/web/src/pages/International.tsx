import { useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Card, Empty, PageHeader } from '../components/ui';
import { StandingsTable } from './Table';
import { FixtureRow } from './Fixtures';

export function InternationalPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/wcc`, [career.tick]);
  const world = useApi<any>(`/careers/${career.id}/world`, [career.tick]);
  const o = career.overview.data;
  return (
    <div className="space-y-5">
      <PageHeader title={world.data?.worldModel === 'pyramid' ? 'Global Club Championship' : 'World Club Championship'} subtitle={world.data?.worldModel === 'pyramid' ? 'Sixteen clubs: continental winners and runners-up plus the best Premier Division finishers. Results move division reputations and club coefficients.' : 'Up to 50 domestic clubs, qualified through their leagues. Results here move league reputations.'} />
      <Async state={state}>
        {(d) =>
          d.competition ? (
            <div className="space-y-5">
              <Card title={d.competition.name} actions={<span className="text-xs text-ink-muted">Host: {d.competition.meta.host} · stage: {d.competition.meta.round}</span>}>
                <p className="text-sm text-ink-muted">{d.competition.meta.plan.description}</p>
                {d.competition.championId && <p className="mt-2 font-display text-2xl uppercase text-lime">Champions: {d.fixtures.find((f: any) => f.homeId === d.competition.championId)?.homeName ?? d.fixtures.find((f: any) => f.awayId === d.competition.championId)?.awayName}</p>}
              </Card>
              {d.groups.length > 0 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {d.groups.map((g: any) => (
                    <Card key={g.group} title={`Group ${g.group}`} pad={false}>
                      <StandingsTable rows={g.table} highlight={2} />
                    </Card>
                  ))}
                </div>
              )}
              <Card title="Fixtures" pad={false}>
                <ul>{d.fixtures.map((f: any) => <FixtureRow key={f.id} f={f} season={o?.season ?? 2027} userClubId={o?.club.id} />)}</ul>
              </Card>
            </div>
          ) : (
            <Async state={world}>
              {(w) => (
                <Card title={`Road to the ${w.season} championship`}>
                  {w.plan ? <p className="text-sm text-ink-muted">{w.plan.description}</p> : <Empty title="Qualification places not set yet" />}
                  <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    {w.qualification.filter((q: any) => q.slots > 0).map((q: any) => <li key={q.leagueId} className="rounded-lg border border-obsidian-700 px-3 py-2"><b>{q.leagueId}</b>: top {q.slots} qualify</li>)}
                  </ul>
                  <p className="mt-3 text-xs text-ink-faint">The championship starts once every domestic league has crowned its champion.</p>
                </Card>
              )}
            </Async>
          )
        }
      </Async>
      <Card title="National-team cricket">
        <p className="text-sm text-ink-muted">National-team competitions are a planned separate game mode and never share a save with your club career. International call-ups are not yet modelled; players are available to their clubs all season.</p>
      </Card>
    </div>
  );
}
