import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cr, dayLabel, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, DataTable, Empty, Modal, PageHeader, Segmented, Stat, Tabs } from '../components/ui';
import { ClubCrest } from '../components/media';
import { StandingsTable } from './Table';
import { FixtureRow } from './Fixtures';

/** Screens for the global universe: pyramid, clubs, cups, international cricket, preseason, stadiums and calendar. */

const REGIONS = ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania'];

function NotPyramid() {
  return (
    <Empty title="Part of the global universe">
      This career keeps the original national leagues. The divisional pyramid, continental cups, preseason friendlies and international cricket are available when you start a new career.
    </Empty>
  );
}

function Filters({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2">{children}</div>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string }[] }) {
  return (
    <label className="text-xs text-ink-muted">
      <span className="label mb-1 block">{label}</span>
      <select className="input w-auto py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Search({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="text-xs text-ink-muted">
      <span className="label mb-1 block">Search</span>
      <input className="input w-56 py-1.5" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ------------------------------------------------------------------ hub

export function UniversePage() {
  const { id, tick } = useCareer();
  const state = useApi<any>(`/careers/${id}/universe`, [tick]);
  const links = [
    { to: 'pyramid', label: 'Divisional pyramid', sub: 'Tables, promotion and relegation' },
    { to: 'clubs', label: 'Club directory', sub: 'Every club in the world' },
    { to: 'continental', label: 'Continental cups', sub: 'Champions Cups, Shields, global finals' },
    { to: 'international', label: 'International', sub: 'Nations, rankings and events' },
    { to: 'national-team', label: 'National team', sub: 'Appointments and squads' },
    { to: 'preseason', label: 'Preseason', sub: 'Arrange friendlies' },
    { to: 'players', label: 'Player directory', sub: 'Search the whole population' },
    { to: 'auction-prep', label: 'Auction preparation', sub: 'Registration and targets' },
    { to: 'stadiums', label: 'Stadiums', sub: 'The ground catalogue' },
    { to: 'calendar', label: 'Global calendar', sub: 'Windows, fixtures and call-ups' },
  ];
  return (
    <div className="space-y-5">
      <PageHeader kicker="Global cricket universe" title="World Explorer" subtitle="The pyramid, the cups, the international game and every club, ground and player in this career." />
      <Async state={state}>
        {(d) => (
          <div className="space-y-5">
            {d.worldModel !== 'pyramid' && <Card><NotPyramid /></Card>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Players" value={d.counts.total.toLocaleString()} sub={`${d.counts.real.toLocaleString()} real · ${d.counts.fictional.toLocaleString()} fictional`} />
              <Stat label="Contracted" value={d.counts.contracted.toLocaleString()} sub={`${d.counts.freeAgents.toLocaleString()} free agents`} />
              <Stat label="Clubs" value={d.counts.clubs} sub={`${d.counts.fictionalClubs} fictional`} />
              <Stat label={d.worldModel === 'pyramid' ? 'Divisions' : 'Leagues'} value={d.worldModel === 'pyramid' ? d.counts.divisions : d.counts.leagues} />
              <Stat label="Stadiums" value={d.counts.stadiums} sub={`${d.counts.fictionalStadiums} fictional`} />
              <Stat label="Competitions" value={d.counts.competitions + d.counts.internationalEvents} sub={`${d.counts.nations} nations`} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {links.map((l) => (
                <Link key={l.to} to={`/c/${id}/${l.to}`} className="card card-pad block transition hover:border-lime/50">
                  <div className="font-semibold text-ink">{l.label}</div>
                  <div className="mt-1 text-xs text-ink-muted">{l.sub}</div>
                </Link>
              ))}
            </div>
            <Card title={d.worldModel === 'pyramid' ? 'Divisions' : 'Leagues'} pad={false}>
              <DataTable rows={d.divisions} rowKey={(r: any) => r.id} columns={[
                { key: 'n', label: 'Competition', render: (r: any) => <span className="font-semibold">{r.name}</span> },
                { key: 't', label: 'Tier', render: (r: any) => r.tier ?? '—' },
                { key: 'c', label: 'Clubs', render: (r: any) => r.clubs },
                { key: 'p', label: 'Purse', render: (r: any) => cr(r.purse) },
                { key: 'r', label: 'Reputation', render: (r: any) => r.reputation.toFixed?.(1) ?? r.reputation },
                { key: 'l', label: 'Leader / champion', render: (r: any) => r.champion ?? r.leader?.name ?? '—' },
              ]} />
            </Card>
            {d.calendar.length > 0 && <CalendarStrip windows={d.calendar} season={d.season} day={d.day} />}
          </div>
        )}
      </Async>
    </div>
  );
}

const WINDOW_TONE: Record<string, string> = {
  auction: 'bg-warn/30', preseason: 'bg-info/30', league: 'bg-lime/40', continental: 'bg-lime/25', global: 'bg-lime/60', international: 'bg-danger/25', offseason: 'bg-obsidian-700',
};

function CalendarStrip({ windows, season, day }: { windows: any[]; season: number; day: number }) {
  const max = Math.max(200, ...windows.map((w) => w.to + 5));
  return (
    <Card title={`${season} calendar`}>
      <div className="relative h-auto space-y-1.5">
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-56 shrink-0 truncate text-ink-muted" title={w.label}>{w.label}</span>
            <div className="relative h-3 flex-1 rounded bg-obsidian-850">
              <div className={`absolute h-3 rounded ${WINDOW_TONE[w.kind] ?? 'bg-lime/30'}`} style={{ left: `${(w.from / max) * 100}%`, width: `${Math.max(1, ((w.to - w.from + 1) / max) * 100)}%` }} />
              <div className="absolute top-[-3px] h-[18px] w-0.5 bg-ink" style={{ left: `${(day / max) * 100}%` }} title="Today" />
            </div>
            <span className="w-28 shrink-0 text-right text-ink-faint">{dayLabel(season, w.from)} – {dayLabel(season, w.to)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ pyramid

export function PyramidPage() {
  const { id, tick } = useCareer();
  const state = useApi<any>(`/careers/${id}/pyramid`, [tick]);
  const [div, setDiv] = useState<string>('');
  return (
    <div className="space-y-5">
      <PageHeader kicker="Global pyramid" title="Divisions" subtitle="Five divisions mixing clubs from every cricket region. Promotion and relegation every season; clubs keep their squads, staff and history." />
      <Async state={state}>
        {(d) => !d.enabled ? <Card><NotPyramid /></Card> : (
          <div className="space-y-5">
            <Card title="Rules"><p className="text-sm text-ink-muted">{d.rules.text}</p><p className="mt-1 text-sm text-ink-muted">{d.rules.parachute}</p></Card>
            <Tabs tabs={d.divisions.map((x: any) => ({ id: x.id, label: x.shortName }))} value={div || d.divisions.find((x: any) => x.table.some((r: any) => r.isUser))?.id || d.divisions[0].id} onChange={setDiv} />
            {d.divisions.filter((x: any) => x.id === (div || d.divisions.find((y: any) => y.table.some((r: any) => r.isUser))?.id || d.divisions[0].id)).map((x: any) => (
              <Card key={x.id} title={`${x.name}`} actions={<span className="text-xs text-ink-muted">Purse {cr(x.purse)} · prize {cr(x.prize.champion)} · {x.stage}</span>} pad={false}>
                <ZonedTable rows={x.table} promote={x.zones.promote} relegate={x.zones.relegate} />
              </Card>
            ))}
            <Card title="Promotion and relegation history" pad={false}>
              {d.history.every((h: any) => !h.movements.length) ? <div className="p-4"><Empty title="No completed seasons yet" /></div> : (
                <ul className="divide-y divide-obsidian-800">
                  {d.history.filter((h: any) => h.movements.length).map((h: any) => (
                    <li key={h.season} className="space-y-2 px-4 py-3">
                      <div className="font-semibold">{h.season}</div>
                      <div className="text-xs text-ink-muted">Champions: {h.champions.map((c: any) => `${c.division} — ${c.club}`).join(' · ')}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {h.movements.map((m: any) => (
                          <span key={m.clubId} className="chip" title={m.reason}>
                            <span className={m.kind === 'promoted' ? 'text-lime' : 'text-danger'}>{m.kind === 'promoted' ? '▲' : '▼'}</span>
                            {m.short} {m.fromName} → {m.toName}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}

function ZonedTable({ rows, promote, relegate }: { rows: any[]; promote: number; relegate: number }) {
  const { id } = useCareer();
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>#</th><th>Club</th><th>Region</th><th className="text-right">P</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">Pts</th><th className="text-right">NRR</th><th>Zone</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const up = r.pos <= promote;
            const down = r.pos > rows.length - relegate;
            return (
              <tr key={r.clubId} className={r.isUser ? 'bg-lime/5' : ''}>
                <td className="num">{r.pos}</td>
                <td><Link className={`hover:underline ${r.isUser ? 'font-semibold text-lime' : ''}`} to={`/c/${id}/club/${r.clubId}`}>{r.club}</Link></td>
                <td className="text-xs text-ink-muted">{r.region}</td>
                <td className="num text-right">{r.played}</td>
                <td className="num text-right">{r.won}</td>
                <td className="num text-right">{r.lost}</td>
                <td className="num text-right font-semibold">{r.points}</td>
                <td className="num text-right text-ink-muted">{(r.nrr ?? 0) >= 0 ? '+' : ''}{(r.nrr ?? 0).toFixed(3)}</td>
                <td>{up ? <Badge tone="lime">Promotion</Badge> : down ? <Badge tone="danger">Relegation</Badge> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ clubs

export function ClubsDirectoryPage() {
  const { id, tick } = useCareer();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [division, setDivision] = useState('');
  const [sort, setSort] = useState('tier');
  const state = useApi<any>(`/careers/${id}/club-directory${qs({ search, region, division, sort })}`, [tick, search, region, division, sort]);
  return (
    <div className="space-y-5">
      <PageHeader kicker="World explorer" title="Club directory" subtitle="Real franchises and fictional clubs, with their division, ground and strength." />
      <Filters>
        <Search value={search} onChange={setSearch} placeholder="Club or city" />
        <Select label="Region" value={region} onChange={setRegion} options={[{ id: '', label: 'All regions' }, ...REGIONS.map((r) => ({ id: r, label: r }))]} />
        <Async state={state}>{(d) => <Select label="Division" value={division} onChange={setDivision} options={[{ id: '', label: 'All' }, ...d.divisions.map((x: any) => ({ id: x.id, label: x.name }))]} />}</Async>
        <Select label="Sort" value={sort} onChange={setSort} options={[{ id: 'tier', label: 'Division' }, { id: 'strength', label: 'Strength' }, { id: 'brand', label: 'Brand' }, { id: 'name', label: 'Name' }]} />
      </Filters>
      <Async state={state}>
        {(d) => (
          <Card title={`${d.total} clubs`} pad={false}>
            <DataTable rows={d.clubs} rowKey={(r: any) => r.id} columns={[
              { key: 'c', label: 'Club', render: (r: any) => <Link to={`/c/${id}/club/${r.id}`} className="flex items-center gap-2 hover:underline"><ClubCrest club={{ id: r.id, name: r.name, shortName: r.shortName, colors: r.colors }} size={22} /><span className={r.isUser ? 'font-semibold text-lime' : ''}>{r.name}</span>{r.fictional && <Badge tone="muted">Fictional</Badge>}</Link> },
              { key: 'd', label: 'Division', render: (r: any) => r.division, sort: (r: any) => r.tier ?? 9 },
              { key: 'r', label: 'Region', render: (r: any) => `${r.region} · ${r.countryName}` },
              { key: 's', label: 'Strength', render: (r: any) => r.strength, sort: (r: any) => r.strength },
              { key: 'b', label: 'Brand', render: (r: any) => r.brand, sort: (r: any) => r.brand },
              { key: 'e', label: 'Elo', render: (r: any) => r.elo, sort: (r: any) => r.elo },
              { key: 'v', label: 'Ground', render: (r: any) => <span className="text-xs">{r.venue}{r.capacity ? ` (${r.capacity.toLocaleString()})` : ''}</span> },
              { key: 't', label: 'Trophies', render: (r: any) => r.trophies, sort: (r: any) => r.trophies },
            ]} />
          </Card>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------ continental

export function ContinentalPage() {
  const { id, tick, overview } = useCareer();
  const state = useApi<any>(`/careers/${id}/continental`, [tick]);
  const [region, setRegion] = useState('Asia');
  const o = overview.data;
  return (
    <div className="space-y-5">
      <PageHeader kicker="Continental club cricket" title="Continental cups" subtitle="Each region's Champions Cup and Shield, and the Global Club Championship." />
      <Async state={state}>
        {(d) => !d.enabled ? <Card><NotPyramid /></Card> : (
          <div className="space-y-5">
            <Card title="Format and qualification"><p className="text-sm text-ink-muted">{d.rules}</p></Card>
            {d.global && (
              <Card title={d.global.name} actions={<Link className="text-xs text-lime hover:underline" to={`/c/${id}/global`}>Open</Link>}>
                <p className="text-sm">{d.global.champion ? <>Champions: <span className="font-semibold text-lime">{d.global.champion}</span></> : `Stage: ${d.global.stage}`}</p>
              </Card>
            )}
            <Tabs tabs={REGIONS.map((r) => ({ id: r, label: r }))} value={region} onChange={setRegion} />
            {d.cups.filter((c: any) => c.region === region).length === 0 && <Card><Empty title="No cups yet this season">Cups are drawn when the divisional season ends. Current qualification standings are below.</Empty></Card>}
            {d.cups.filter((c: any) => c.region === region).map((c: any) => (
              <Card key={c.id} title={c.name} actions={<span className="text-xs text-ink-muted">{c.champion ? `Won by ${c.champion}` : c.round}{c.finalVenue ? ` · final at ${c.finalVenue}` : ''}</span>}>
                {c.groups.length > 0 && (
                  <div className="mb-4 grid gap-4 lg:grid-cols-2">
                    {c.groups.map((g: any) => <div key={g.group} className="panel"><div className="px-3 pt-2 text-xs font-semibold text-ink-muted">Group {g.group}</div><StandingsTable rows={g.table} highlight={2} /></div>)}
                  </div>
                )}
                <ul className="-mx-4 md:-mx-5">{c.fixtures.map((f: any) => <FixtureRow key={f.id} f={f} season={d.season} userClubId={o?.club.id} />)}</ul>
              </Card>
            ))}
            <Card title={`${region}: qualification standings`} pad={false}>
              <DataTable rows={d.rankings[region]} rowKey={(r: any) => r.id} columns={[
                { key: 'n', label: 'Club', render: (r: any) => <span className={r.isUser ? 'font-semibold text-lime' : ''}>{r.name}</span> },
                { key: 'd', label: 'Division', render: (r: any) => r.division },
                { key: 's', label: 'Score', render: (r: any) => r.score },
                { key: 'p', label: 'Performance', render: (r: any) => r.performance },
                { key: 'r', label: 'Reputation', render: (r: any) => r.reputation },
                { key: 'c', label: 'Coefficient', render: (r: any) => r.coefficient },
              ]} />
            </Card>
            {d.history.length > 0 && (
              <Card title="Roll of honour" pad={false}>
                <DataTable rows={d.history} rowKey={(r: any) => r.id} columns={[
                  { key: 's', label: 'Season', render: (r: any) => r.season },
                  { key: 'c', label: 'Cup', render: (r: any) => `${r.region} ${r.cup === 'champions' ? 'Champions Cup' : 'Shield'}` },
                  { key: 'w', label: 'Winner', render: (r: any) => <span className="font-semibold">{r.champion}</span> },
                  { key: 'r', label: 'Runner-up', render: (r: any) => r.runnerUp },
                  { key: 'v', label: 'Final venue', render: (r: any) => r.venue },
                ]} />
              </Card>
            )}
          </div>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------ international

function IntlFixtureRow({ f, season }: { f: any; season: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-obsidian-800 px-4 py-2 text-sm ${f.involvesUser ? 'bg-lime/[0.04]' : ''}`}>
      <span className="w-24 shrink-0 text-xs text-ink-muted">{dayLabel(season, f.day)}{f.days > 1 ? ` (+${f.days - 1}d)` : ''}</span>
      <Badge tone="info">{f.format}</Badge>
      <span className="w-28 shrink-0 text-xs text-ink-faint">{f.stage}</span>
      <span className="min-w-[200px] flex-1"><span className={f.result?.winnerId === f.homeId ? 'font-semibold' : ''}>{f.home}</span> <span className="text-ink-faint">v</span> <span className={f.result?.winnerId === f.awayId ? 'font-semibold' : ''}>{f.away}</span></span>
      {f.result ? (
        <>
          <span className="num text-ink-muted">{f.result.innings.map((i: any) => `${i.runs}/${i.wickets}`).join(' · ')}</span>
          <span className="text-xs text-ink-muted">{f.result.margin}</span>
          <button className="text-xs text-lime hover:underline" onClick={() => setOpen(true)}>Scorecard</button>
          {open && <IntlScorecard fid={f.id} onClose={() => setOpen(false)} />}
        </>
      ) : <span className="text-xs text-ink-faint">{f.venue}{f.neutral ? ' (neutral)' : ''}</span>}
    </li>
  );
}

function IntlScorecard({ fid, onClose }: { fid: string; onClose: () => void }) {
  const { id } = useCareer();
  const state = useApi<any>(`/careers/${id}/international/fixtures/${fid}`, [fid]);
  return (
    <Modal open title="Scorecard" onClose={onClose} wide>
      <Async state={state}>
        {(d) => (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">{d.fixture.event} · {d.fixture.stage} · {d.fixture.venue} — {d.fixture.result?.margin}</p>
            {d.scorecard.map((inn: any, i: number) => (
              <div key={i} className="panel p-3">
                <div className="mb-2 font-semibold">{inn.nation} {inn.runs}/{inn.wickets} <span className="text-xs text-ink-muted">({Math.floor(inn.balls / 6)}.{inn.balls % 6} overs)</span></div>
                <table className="table text-xs"><tbody>{inn.batting.map((b: any) => <tr key={b.playerId}><td>{b.name}</td><td className="text-ink-muted">{b.out ?? 'not out'}</td><td className="num text-right">{b.runs} ({b.balls})</td></tr>)}</tbody></table>
                <table className="table mt-2 text-xs"><tbody>{inn.bowling.map((b: any) => <tr key={b.playerId}><td>{b.name}</td><td className="num text-right">{Math.floor(b.balls / 6)}.{b.balls % 6}-{b.runs}-{b.wickets}</td></tr>)}</tbody></table>
              </div>
            ))}
          </div>
        )}
      </Async>
    </Modal>
  );
}

export function InternationalHubPage() {
  const { id, tick, mutate } = useCareer();
  const state = useApi<any>(`/careers/${id}/international`, [tick]);
  const [fmt, setFmt] = useState<'Test' | 'ODI' | 'T20'>('Test');
  return (
    <div className="space-y-5">
      <PageHeader kicker="International cricket" title="International" subtitle="Bilateral tours, tri-series, the associate qualifier, regional cups and world events in Test, ODI and T20 cricket." />
      <Async state={state}>
        {(d) => !d.enabled ? <Card><NotPyramid /></Card> : (
          <div className="space-y-5">
            {d.offers.length > 0 && !d.userNationId && (
              <Card title="National-team offers">
                <ul className="space-y-2">
                  {d.offers.map((o: any) => (
                    <li key={o.nationId} className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{o.nation.name}</span>
                      <span className="text-xs text-ink-muted">{o.nation.full ? 'Full member' : 'Associate'} · T20 rating {o.nation.rating.T20}</span>
                      <button className="btn-primary py-1 text-xs" onClick={() => mutate('/international/accept', { nationId: o.nationId }, { success: `You are now ${o.nation.name} manager.` })}>Accept</button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-muted">A national role runs alongside your club job. You pick the squads; internationals are simulated with your selections.</p>
              </Card>
            )}
            {d.calledUpFromMyClub.length > 0 && <Card title="On international duty from your club"><p className="text-sm">{d.calledUpFromMyClub.map((p: any) => p.name).join(', ')}</p></Card>}
            <Card title="Formats"><ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">{Object.values(d.formats).map((t: any) => <li key={t}>{t}</li>)}</ul></Card>
            <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
              <Card title="Rankings" actions={<Segmented label="Format" value={fmt} onChange={setFmt} options={[{ id: 'Test', label: 'Test' }, { id: 'ODI', label: 'ODI' }, { id: 'T20', label: 'T20I' }]} />} pad={false}>
                <DataTable rows={d.rankings[fmt]} rowKey={(r: any) => r.id} columns={[
                  { key: 'p', label: '#', render: (r: any) => r.pos },
                  { key: 'n', label: 'Nation', render: (r: any) => <Link to={`/c/${id}/national-team?nation=${r.id}`} className={`hover:underline ${r.userManaged ? 'font-semibold text-lime' : ''}`}>{r.name}</Link> },
                  { key: 'r', label: 'Rating', render: (r: any) => r.points },
                  { key: 'w', label: 'W-L-D', render: (r: any) => `${r.record[fmt].won}-${r.record[fmt].lost}-${r.record[fmt].drawn}` },
                  { key: 'm', label: 'Manager', render: (r: any) => <span className="text-xs text-ink-muted">{r.manager}</span> },
                ]} />
              </Card>
              <div className="space-y-4">
                {d.events.length === 0 && <Card><Empty title="No international events scheduled yet">The preseason window opens when the auctions finish; the postseason window follows the Global Club Championship.</Empty></Card>}
                {d.events.map((e: any) => (
                  <Card key={e.id} title={e.name} actions={<span className="text-xs text-ink-muted">{e.format} · {e.host} · {e.status}{e.champion ? ` · ${e.kind === 'bilateral' ? 'won by' : 'champions'} ${e.champion}` : e.status === 'complete' ? ' · drawn / shared' : ''}</span>} pad={false}>
                    <p className="px-4 pt-3 text-xs text-ink-muted">{e.description}{e.series ? ` Series: ${e.series.map((s: any) => `${s.nation} ${s.wins}`).join(' – ')}.` : ''}</p>
                    {e.groups.length > 0 && (
                      <div className="grid gap-3 p-4 md:grid-cols-2">
                        {e.groups.map((g: any) => (
                          <div key={g.group} className="panel p-2 text-xs">
                            <div className="mb-1 font-semibold text-ink-muted">{g.group === 'main' ? 'Table' : `Group ${g.group}`}</div>
                            {g.table.map((r: any) => <div key={r.clubId} className="flex justify-between"><span>{r.pos}. {r.nation}</span><span className="num">{r.points} pts</span></div>)}
                          </div>
                        ))}
                      </div>
                    )}
                    <ul>{e.fixtures.map((f: any) => <IntlFixtureRow key={f.id} f={f} season={d.season} />)}</ul>
                  </Card>
                ))}
              </div>
            </div>
            {d.history.length > 0 && (
              <Card title="International honours" pad={false}>
                <DataTable rows={d.history} rowKey={(r: any) => r.eventId} columns={[
                  { key: 's', label: 'Season', render: (r: any) => r.season },
                  { key: 'e', label: 'Event', render: (r: any) => r.name },
                  { key: 'f', label: 'Format', render: (r: any) => r.format },
                  { key: 'c', label: 'Winner', render: (r: any) => <span className="font-semibold">{r.champion}</span> },
                  { key: 'r', label: 'Runner-up', render: (r: any) => r.runnerUp ?? '—' },
                ]} />
              </Card>
            )}
          </div>
        )}
      </Async>
    </div>
  );
}

export function NationalTeamPage() {
  const { id, tick, mutate } = useCareer();
  const hub = useApi<any>(`/careers/${id}/international`, [tick]);
  const params = new URLSearchParams(window.location.search);
  const [fmt, setFmt] = useState<'Test' | 'ODI' | 'T20'>('T20');
  const nationId = params.get('nation') ?? hub.data?.userNationId ?? hub.data?.rankings?.T20?.[0]?.id ?? null;
  const state = useApi<any>(nationId ? `/careers/${id}/international/nations/${nationId}?format=${fmt}` : null, [tick, nationId, fmt]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [captain, setCaptain] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader kicker="International cricket" title="National team" subtitle="Eligibility, squads and fixtures. When you manage a nation you pick its squad for each format." />
      <Async state={hub}>
        {(h) => !h.enabled ? <Card><NotPyramid /></Card> : (
          <Async state={state}>
            {(d) => {
              const mine = d.nation.userManaged;
              const squad = draft ?? d.squad.map((p: any) => p.id);
              const toggle = (pid: string) => setDraft(squad.includes(pid) ? squad.filter((x: string) => x !== pid) : squad.length < d.squadSize ? [...squad, pid] : squad);
              return (
                <div className="space-y-5">
                  <Card title={d.nation.name} actions={<div className="flex items-center gap-2"><Segmented label="Format" value={fmt} onChange={(v) => { setFmt(v); setDraft(null); }} options={[{ id: 'Test', label: 'Test' }, { id: 'ODI', label: 'ODI' }, { id: 'T20', label: 'T20I' }]} />{mine && <button className="btn-ghost py-1 text-xs" onClick={() => mutate('/international/resign', {}, { success: 'You stepped down.' })}>Resign</button>}</div>}>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Stat label="Manager" value={<span className="text-base">{d.nation.manager}</span>} sub={mine ? 'You' : 'AI manager'} />
                      <Stat label={`${fmt} rating`} value={d.nation.rating[fmt]} />
                      <Stat label="Record" value={`${d.nation.record[fmt].won}-${d.nation.record[fmt].lost}`} sub={`${d.nation.record[fmt].drawn} drawn`} />
                      <Stat label="Status" value={<span className="text-base">{d.nation.full ? 'Full member' : 'Associate'}</span>} />
                    </div>
                    <p className="mt-3 text-xs text-ink-muted">{d.eligibility}</p>
                  </Card>
                  <div className="grid gap-5 xl:grid-cols-2">
                    <Card title={`${fmt} squad (${squad.length}/${d.squadSize})`} actions={mine ? (
                      <button className="btn-primary py-1 text-xs" disabled={squad.length < 11} onClick={async () => { await mutate('/international/squad', { format: fmt, playerIds: squad, captainId: captain }, { success: 'Squad saved.' }); setDraft(null); }}>Save squad</button>
                    ) : <span className="text-xs text-ink-muted">Selected by the AI manager</span>} pad={false}>
                      <ul className="divide-y divide-obsidian-800">
                        {squad.map((pid: string) => {
                          const p = d.pool.find((x: any) => x.id === pid) ?? d.squad.find((x: any) => x.id === pid);
                          if (!p) return null;
                          return (
                            <li key={pid} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                              <span className="w-10 text-xs text-ink-faint">{p.category}</span>
                              <span className="flex-1">{p.name}{d.nation.captainId === pid && <Badge tone="lime">C</Badge>}</span>
                              <span className="text-xs text-ink-muted">{p.clubShort ?? 'Free'}</span>
                              <span className="num w-10 text-right">{p.formatRating}</span>
                              {mine && <button className="text-xs text-ink-muted hover:text-lime" onClick={() => setCaptain(pid)}>{captain === pid ? 'Captain ✓' : 'Captain'}</button>}
                              {mine && <button className="text-xs text-danger" onClick={() => toggle(pid)}>Drop</button>}
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                    <Card title="Eligible players (best 60 for this format)" pad={false}>
                      <ul className="max-h-[520px] divide-y divide-obsidian-800 overflow-y-auto">
                        {d.pool.map((p: any) => (
                          <li key={p.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                            <span className="w-10 text-xs text-ink-faint">{p.category}</span>
                            <span className="flex-1">{p.name} <span className="text-xs text-ink-faint">{p.age}</span>{p.fictional && <span className="ml-1 text-[10px] text-ink-faint">(fictional)</span>}</span>
                            <span className="text-xs text-ink-muted">{p.clubShort ?? 'Free'}</span>
                            <span className="num w-10 text-right">{p.formatRating}</span>
                            {mine && <button className="text-xs text-lime disabled:opacity-40" disabled={squad.includes(p.id) || squad.length >= d.squadSize} onClick={() => toggle(p.id)}>Add</button>}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                  <Card title="Fixtures this season" pad={false}>
                    {d.fixtures.length ? <ul>{d.fixtures.map((f: any) => <IntlFixtureRow key={f.id} f={f} season={h.season} />)}</ul> : <div className="p-4"><Empty title="No fixtures scheduled" /></div>}
                  </Card>
                </div>
              );
            }}
          </Async>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------ preseason

const PURPOSES = [
  { id: 'fitness', label: 'Match fitness' }, { id: 'selection', label: 'Trial fringe players' }, { id: 'tactics', label: 'Rehearse tactics' },
  { id: 'revenue', label: 'Gate money' }, { id: 'youth', label: 'Young players' },
];

export function PreseasonPage() {
  const { id, tick, mutate, overview } = useCareer();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const state = useApi<any>(`/careers/${id}/preseason${qs({ search, region })}`, [tick, search, region]);
  const [pick, setPick] = useState<any | null>(null);
  const o = overview.data;
  return (
    <div className="space-y-5">
      <PageHeader kicker="Preseason" title="Friendlies" subtitle="Arrange warm-up matches: opponent, ground, date, purpose and whether you play, watch or simulate." />
      <Async state={state}>
        {(d) => (
          <div className="space-y-5">
            <Card title="How friendlies work"><p className="text-sm text-ink-muted">{d.rules}</p>{d.onDutyToday > 0 && <p className="mt-1 text-sm text-warn">{d.onDutyToday} of your players are on international duty today.</p>}</Card>
            {!d.enabled && <Card><Empty title={d.phase === 'preseason' ? 'Friendlies are part of the global universe' : 'The preseason window is closed'}>{d.phase === 'preseason' ? 'Start a new career to arrange friendlies.' : 'Friendlies can be arranged once the auctions finish and before the season starts.'}</Empty></Card>}
            <Card title={`Your friendlies (${d.mine.length}/${d.max})`} pad={false}>
              {d.mine.length ? (
                <ul>
                  {d.mine.map((f: any) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-obsidian-800 px-4 py-2 text-sm">
                      <span className="w-20 text-xs text-ink-muted">{dayLabel(o?.season ?? 2027, f.day)}</span>
                      <span className="flex-1">{f.homeName} v {f.awayName} <span className="text-xs text-ink-faint">· {f.venue}{f.neutral ? ' (neutral)' : ''}</span></span>
                      <Badge tone="info">{PURPOSES.find((p) => p.id === f.purpose)?.label ?? f.purpose}</Badge>
                      <Badge tone="muted">{f.mode === 'play' ? 'Play' : f.mode === 'watch' ? 'Watch' : 'Simulate'}</Badge>
                      {f.result ? <span className="text-xs text-ink-muted">{f.result.margin}</span> : <button className="text-xs text-danger" onClick={() => mutate(`/preseason/friendly/${f.id}`, undefined, { method: 'DELETE', success: 'Friendly cancelled.' })}>Cancel</button>}
                    </li>
                  ))}
                </ul>
              ) : <div className="p-4"><Empty title="No friendlies arranged" /></div>}
            </Card>
            {d.enabled && (
              <Card title="Find an opponent" actions={<span className="text-xs text-ink-muted">{d.aiFriendlies} AI friendlies arranged around the world</span>}>
                <Filters>
                  <Search value={search} onChange={setSearch} placeholder="Club or city" />
                  <Select label="Region" value={region} onChange={setRegion} options={[{ id: '', label: 'All regions' }, ...REGIONS.map((r) => ({ id: r, label: r }))]} />
                </Filters>
                <ul className="mt-3 divide-y divide-obsidian-800">
                  {d.opponents.map((c: any) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <ClubCrest club={{ id: c.id, name: c.name, shortName: c.short, colors: c.colors }} size={24} />
                      <span className="flex-1 font-medium">{c.name} <span className="text-xs text-ink-muted">{c.division} · {c.region}</span></span>
                      <span className="text-xs text-ink-faint">{c.booked.length ? `busy: ${c.booked.map((x: number) => dayLabel(o?.season ?? 2027, x)).join(', ')}` : 'free'}</span>
                      <button className="btn-ghost py-1 text-xs" disabled={d.mine.length >= d.max} onClick={() => setPick(c)}>Arrange</button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {pick && <FriendlyModal opponent={pick} d={d} season={o?.season ?? 2027} onClose={() => setPick(null)} />}
          </div>
        )}
      </Async>
    </div>
  );
}

function FriendlyModal({ opponent, d, season, onClose }: { opponent: any; d: any; season: number; onClose: () => void }) {
  const { id, mutate } = useCareer();
  const [day, setDay] = useState(d.window.from);
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home');
  const [neutralVenueId, setNeutral] = useState(d.neutralVenues[0]?.id ?? '');
  const [purpose, setPurpose] = useState('fitness');
  const [mode, setMode] = useState<'play' | 'watch' | 'sim'>('sim');
  const body = useMemo(() => ({ opponentId: opponent.id, day, venue, neutralVenueId: venue === 'neutral' ? neutralVenueId : undefined, purpose, mode }), [opponent.id, day, venue, neutralVenueId, purpose, mode]);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const runPreview = async () => {
    setBusy(true);
    setPreview(await mutate(`/preseason/preview`, body, { quiet: true }));
    setBusy(false);
  };
  const days = Array.from({ length: d.window.to - d.window.from + 1 }, (_, i) => d.window.from + i);
  return (
    <Modal open title={`Friendly v ${opponent.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select label="Date" value={String(day)} onChange={(v) => { setDay(Number(v)); setPreview(null); }} options={days.map((x) => ({ id: String(x), label: `${dayLabel(season, x)} (day ${x})` }))} />
          <Select label="Ground" value={venue} onChange={(v) => { setVenue(v as typeof venue); setPreview(null); }} options={[{ id: 'home', label: `Home — ${d.myClub.venue}` }, { id: 'away', label: `Away — ${opponent.venue}` }, { id: 'neutral', label: 'Neutral ground' }]} />
          {venue === 'neutral' && <Select label="Neutral ground" value={neutralVenueId} onChange={(v) => { setNeutral(v); setPreview(null); }} options={d.neutralVenues.map((v: any) => ({ id: v.id, label: `${v.name}, ${v.city}` }))} />}
          <Select label="Purpose" value={purpose} onChange={(v) => { setPurpose(v); setPreview(null); }} options={PURPOSES} />
          <Select label="Take part" value={mode} onChange={(v) => { setMode(v as typeof mode); setPreview(null); }} options={[{ id: 'play', label: 'Play it (manage the match)' }, { id: 'watch', label: 'Watch it (assistant decides)' }, { id: 'sim', label: 'Simulate (instant result)' }]} />
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={runPreview} disabled={busy}>Preview effects</button>
          <button className="btn-primary" disabled={!preview?.ok} onClick={async () => { if (await mutate(`/preseason/friendly`, body, { success: 'Friendly arranged.' })) onClose(); }}>Confirm friendly</button>
        </div>
        {preview && (
          <div className="panel space-y-2 p-3 text-sm">
            <div className={preview.ok ? 'text-lime' : 'text-danger'}>{preview.opponent.why}{!preview.ok && preview.reason && preview.reason !== preview.opponent.why ? ` — ${preview.reason}` : ''}</div>
            {preview.venueName && <div className="text-xs text-ink-muted">Ground: {preview.venueName}</div>}
            <ul className="grid gap-1 md:grid-cols-2">{preview.effects.map((e: any) => <li key={e.label} className="text-xs"><span className="font-semibold">{e.label}:</span> <span className={e.tone === 'good' ? 'text-lime' : e.tone === 'bad' ? 'text-danger' : 'text-ink-muted'}>{e.value}</span></li>)}</ul>
            {preview.unavailable.length > 0 && <div className="text-xs text-warn">Unavailable: {preview.unavailable.map((u: any) => `${u.name} (${u.reason})`).join(', ')}</div>}
          </div>
        )}
        <p className="text-xs text-ink-faint">Opening the preview does not book anything. A friendly is booked only when you confirm.</p>
        <p className="hidden">{id}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ stadiums

export function StadiumsPage() {
  const { id, tick } = useCareer();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [kind, setKind] = useState('');
  const state = useApi<any>(`/careers/${id}/stadiums${qs({ search, region, kind })}`, [tick, search, region, kind]);
  const [open, setOpen] = useState<any | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader kicker="World explorer" title="Stadiums" subtitle="Every ground in the universe, with capacity, pitch, boundaries, climate and visual identity." />
      <Filters>
        <Search value={search} onChange={setSearch} placeholder="Ground or city" />
        <Select label="Region" value={region} onChange={setRegion} options={[{ id: '', label: 'All regions' }, ...REGIONS.map((r) => ({ id: r, label: r }))]} />
        <Select label="Kind" value={kind} onChange={setKind} options={[{ id: '', label: 'All' }, { id: 'real', label: 'Real grounds' }, { id: 'fictional', label: 'Fictional grounds' }]} />
      </Filters>
      <Async state={state}>
        {(d) => (
          <Card title={`${d.total} grounds (${d.real} real, ${d.fictional} fictional in the catalogue)`} pad={false}>
            <DataTable rows={d.stadiums} rowKey={(r: any) => r.id} onRowClick={setOpen} columns={[
              { key: 'n', label: 'Ground', render: (r: any) => <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: r.identity?.seatColors?.[0] ?? '#888' }} />{r.name}{r.fictional && <Badge tone="muted">Fictional</Badge>}</span> },
              { key: 'c', label: 'City', render: (r: any) => `${r.city}, ${r.countryName}` },
              { key: 'cap', label: 'Capacity', render: (r: any) => r.capacity?.toLocaleString() ?? '—', sort: (r: any) => r.capacity ?? 0 },
              { key: 'p', label: 'Pitch', render: (r: any) => r.pitch.kind },
              { key: 'b', label: 'Boundaries', render: (r: any) => `${r.boundary.straight} / ${r.boundary.square} m` },
              { key: 'cl', label: 'Climate', render: (r: any) => r.climate ?? '—' },
              { key: 'h', label: 'Home of', render: (r: any) => <span className="text-xs text-ink-muted">{r.homeOf.join(', ') || '—'}</span> },
            ]} />
          </Card>
        )}
      </Async>
      {open && (
        <Modal open title={open.name} onClose={() => setOpen(null)}>
          <div className="space-y-2 text-sm">
            <p>{open.city}, {open.countryName} · {open.region}</p>
            <p>Capacity {open.capacity?.toLocaleString() ?? 'unknown'} · altitude {open.altitude} m · dew {Math.round(open.dewChance * 100)}% · {open.climate}</p>
            <p>Pitch: {open.pitch.kind} (pace {open.pitch.pace}, spin {open.pitch.spin}, batting {open.pitch.batting}, wear {open.pitch.wear})</p>
            {open.identity && <p>Look: {open.identity.tiers}-tier {open.identity.shape} bowl, {open.identity.roof} roof, {open.identity.floodlights} floodlights, {open.identity.skyline} backdrop.</p>}
            <p className="text-xs text-ink-muted">{open.provenance}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ calendar

export function CalendarPage() {
  const { id, tick } = useCareer();
  const state = useApi<any>(`/careers/${id}/calendar`, [tick]);
  return (
    <div className="space-y-5">
      <PageHeader kicker="Global calendar" title="Calendar" subtitle="Season windows, your club's fixtures, international events and call-ups. Windows never overlap the competitive club calendar." />
      <Async state={state}>
        {(d) => (
          <div className="space-y-5">
            {d.windows.length > 0 ? <CalendarStrip windows={d.windows} season={d.season} day={d.day} /> : <Card><Empty title="No season windows in this career" /></Card>}
            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="Your club" pad={false}>
                <ul className="max-h-[520px] overflow-y-auto">{d.club.map((f: any) => <li key={f.id} className="flex gap-3 border-b border-obsidian-800 px-4 py-1.5 text-sm"><span className="w-20 text-xs text-ink-muted">{dayLabel(d.season, f.day)}</span><span className="flex-1">{f.label}</span><Badge tone={f.kind === 'friendly' ? 'muted' : f.kind === 'continental' || f.kind === 'wcc' ? 'info' : 'default'}>{f.kind}</Badge>{f.status === 'complete' && <span className="text-xs text-ink-faint">played</span>}</li>)}</ul>
              </Card>
              <Card title="Call-ups from your squad" pad={false}>
                {d.callUps.length ? <ul>{d.callUps.map((c: any, i: number) => <li key={i} className="border-b border-obsidian-800 px-4 py-1.5 text-sm">{c.player} — {c.nation}, {c.event} <span className="text-xs text-ink-muted">({dayLabel(d.season, c.from)} – {dayLabel(d.season, c.to)})</span></li>)}</ul> : <div className="p-4"><Empty title="Nobody called up this season" /></div>}
              </Card>
            </div>
            <Card title="International fixtures" pad={false}>
              <ul className="max-h-[520px] overflow-y-auto">{d.internationals.map((f: any, i: number) => <li key={i} className="flex gap-3 border-b border-obsidian-800 px-4 py-1.5 text-sm"><span className="w-24 text-xs text-ink-muted">{dayLabel(d.season, f.day)}{f.days > 1 ? ` +${f.days - 1}d` : ''}</span><span className="flex-1">{f.label}</span><span className="text-xs text-ink-faint">{f.event}</span></li>)}</ul>
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------ auction preparation

export function AuctionPrepPage() {
  const { id, tick } = useCareer();
  const state = useApi<any>(`/careers/${id}/auction-prep`, [tick]);
  const [role, setRole] = useState('');
  return (
    <div className="space-y-5">
      <PageHeader kicker="Recruitment" title="Auction preparation" subtitle="Who is registered, what your squad needs, and how the top targets fit your plan." />
      <Async state={state}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Player population" value={d.counts.total.toLocaleString()} sub={`${d.counts.real.toLocaleString()} real · ${d.counts.fictional.toLocaleString()} fictional`} />
              <Stat label="Contracted" value={d.counts.contracted.toLocaleString()} />
              <Stat label="Auction-eligible" value={d.counts.eligible.toLocaleString()} sub="uncontracted seniors" />
              <Stat label="Registered here" value={d.counts.registered.toLocaleString()} sub={`for the ${d.division}`} />
              <Stat label="In the catalogue" value={d.counts.catalogued?.toLocaleString() ?? '—'} sub="offered as lots" />
            </div>
            <Card title="Registration rule"><p className="text-sm text-ink-muted">{d.rule}</p></Card>
            <Card title={`Squad needs (${d.squad}/${d.maxSquad}, minimum ${d.minSquad}) · purse ${cr(d.purse)}`}>
              <div className="flex flex-wrap gap-2">{d.needs.map((n: any) => <span key={n.role} className="chip"><span className={n.have < n.target ? 'text-warn' : 'text-lime'}>{n.role}</span> {n.have}/{n.target} · {d.byRole[n.role] ?? 0} registered</span>)}</div>
            </Card>
            <Card title="Top targets" actions={<Select label="Role" value={role} onChange={setRole} options={[{ id: '', label: 'All roles' }, ...['WK', 'BAT', 'AR', 'PACE', 'SPIN'].map((r) => ({ id: r, label: r }))]} />} pad={false}>
              <DataTable rows={d.targets.filter((t: any) => !role || t.category === role)} rowKey={(r: any) => r.id} columns={[
                { key: 'n', label: 'Player', render: (r: any) => <span>{r.name} <span className="text-xs text-ink-faint">{r.countryName} · {r.age}{r.fictional ? ' · fictional' : ''}</span></span> },
                { key: 'c', label: 'Role', render: (r: any) => r.category },
                { key: 'o', label: 'Rating', render: (r: any) => `${r.range.lo}–${r.range.hi}`, sort: (r: any) => r.ovr },
                { key: 'e', label: 'Estimate', render: (r: any) => cr(r.estimate), sort: (r: any) => r.estimate },
                { key: 'm', label: 'Your plan max', render: (r: any) => (r.planMax ? cr(r.planMax) : '—'), sort: (r: any) => r.planMax ?? 0 },
                { key: 's', label: 'Signals', render: (r: any) => <span className="flex flex-wrap gap-1">{r.signals.map((s: string) => <Badge key={s} tone={s.includes('risk') || s.includes('more than') ? 'warn' : s.includes('fit') || s.includes('Undervalued') ? 'lime' : 'muted'}>{s}</Badge>)}</span> },
              ]} />
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}

// ------------------------------------------------------------------ player directory

export function PlayerDirectoryPage() {
  const { id, tick } = useCareer();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('ovr');
  const [page, setPage] = useState(0);
  const state = useApi<any>(`/careers/${id}/players${qs({ search, role, status, kind, sort, page })}`, [tick, search, role, status, kind, sort, page]);
  const pop = useApi<any>(`/careers/${id}/population`, [tick]);
  return (
    <div className="space-y-5">
      <PageHeader kicker="World explorer" title="Player directory" subtitle="Search the whole population: real players from the licensed database and clearly labelled fictional players." />
      <Async state={pop}>
        {(c) => (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total" value={c.total.toLocaleString()} sub={`${c.retired} retired`} />
            <Stat label="Real" value={c.real.toLocaleString()} />
            <Stat label="Fictional" value={c.fictional.toLocaleString()} />
            <Stat label="Contracted" value={c.contracted.toLocaleString()} />
            <Stat label="Auction-eligible" value={c.auctionEligible.toLocaleString()} sub={`${c.academy} in academies`} />
          </div>
        )}
      </Async>
      <Filters>
        <Search value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Player name" />
        <Select label="Role" value={role} onChange={(v) => { setRole(v); setPage(0); }} options={[{ id: '', label: 'All' }, { id: 'BAT', label: 'Batters' }, { id: 'WK', label: 'Keepers' }, { id: 'AR', label: 'All-rounders' }, { id: 'BOWL', label: 'Bowlers' }]} />
        <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ id: 'all', label: 'Everyone' }, { id: 'free', label: 'Free agents' }, { id: 'contracted', label: 'Contracted' }, { id: 'mine', label: 'My squad' }]} />
        <Select label="Kind" value={kind} onChange={(v) => { setKind(v); setPage(0); }} options={[{ id: '', label: 'Real and fictional' }, { id: 'real', label: 'Real' }, { id: 'fictional', label: 'Fictional' }]} />
        <Select label="Sort" value={sort} onChange={setSort} options={[{ id: 'ovr', label: 'Rating' }, { id: 'value', label: 'Value' }, { id: 'age', label: 'Age' }, { id: 'runs', label: 'Runs' }, { id: 'wickets', label: 'Wickets' }, { id: 'name', label: 'Name' }]} />
      </Filters>
      <Async state={state}>
        {(d) => (
          <Card title={`${d.total.toLocaleString()} matching · showing ${d.players.length} (page ${d.page + 1} of ${Math.max(1, Math.ceil(d.total / d.pageSize))})`} actions={
            <div className="flex gap-2"><button className="btn-ghost py-1 text-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-ghost py-1 text-xs" disabled={(page + 1) * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>
          } pad={false}>
            <DataTable rows={d.players} rowKey={(r: any) => r.id} columns={[
              { key: 'n', label: 'Player', render: (r: any) => <span>{r.name}{r.fictional ? <span className="ml-1 text-[10px] text-ink-faint">fictional</span> : null}{r.duty && <Badge tone="info" title={`${r.duty.event}`}>On duty</Badge>}</span> },
              { key: 'c', label: 'Nation', render: (r: any) => r.countryName },
              { key: 'a', label: 'Age', render: (r: any) => r.age },
              { key: 'r', label: 'Role', render: (r: any) => r.role },
              { key: 'o', label: 'Rating', render: (r: any) => `${r.range.lo}–${r.range.hi}` },
              { key: 'cl', label: 'Club', render: (r: any) => r.clubName ?? 'Free agent' },
              { key: 'v', label: 'Value', render: (r: any) => cr(r.marketValue) },
            ]} />
          </Card>
        )}
      </Async>
    </div>
  );
}
