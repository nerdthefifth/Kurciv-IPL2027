import { cr } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { ClubCrestById } from '../../components/media';
import { Icon } from '../../components/icons';
import { Badge, Segmented } from '../../components/ui';
import { Queue } from './parts';
import type { Room } from './useRoom';

export function Lobby({ room, full, busy, command, sim }: { room: Room; full: Room | null; busy: boolean; command: (c: any) => Promise<boolean>; sim: (u: 'flagged' | 'set' | 'end', assistant: boolean) => void }) {
  const a = room.auction;
  const lobby = full?.auction?.lobby ?? a.lobby;
  const { prefs, set } = usePrefs();
  const me = a.clubs.find((c: any) => c.isUser);
  return (
    <div className="space-y-6">
      <section className="card grain relative overflow-hidden p-6 md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-lime/10 blur-3xl" aria-hidden />
        <div className="kicker">The Auction House · {a.leagueName}</div>
        <h1 className="headline mt-2 text-4xl md:text-5xl">The room is set.</h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          {lobby ? <>{lobby.poolSize} players will go under the hammer{lobby.overseasPool ? `, ${lobby.overseasPool} of them overseas` : ''}. </> : null}
          {a.clubs.length} franchises, one auctioneer. Rival clubs think, hesitate and chase — and the clock only runs while you are in the room.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className="btn-primary px-6 py-3 text-base" disabled={busy} onClick={() => command({ type: 'begin' })}><Icon name="gavel" /> Begin the auction</button>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            Pace <Segmented label="Auction speed" value={prefs.auctionSpeed} onChange={(v) => set({ auctionSpeed: v })} options={[{ id: 1, label: '1×' }, { id: 2, label: '2×' }, { id: 4, label: '4×' }]} />
          </div>
          <button className="btn-quiet" disabled={busy} onClick={() => sim('end', true)} title="Your assistant bids for you using the strategy panel's limits">Let my assistant run it</button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section>
            <h2 className="h-section mb-3">Franchise tables</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {a.clubs.map((c: any) => (
                <div key={c.id} className={`card p-4 ${c.isUser ? 'border-lime/60' : ''}`}>
                  <div className="flex items-center gap-3">
                    <ClubCrestById clubId={c.id} size={40} fallback={c} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{c.name}</div>
                      <div className="text-xs text-ink-muted">{c.isUser ? 'Your franchise' : `${c.personality.replace('-', ' ')} owners`}</div>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-ink-faint">Purse</dt><dd className="num text-sm">{cr(c.purse)}</dd></div>
                    <div><dt className="text-ink-faint">Squad</dt><dd className="num text-sm">{c.squad}/{c.maxSquad}</dd></div>
                    <div><dt className="text-ink-faint">Overseas</dt><dd className="num text-sm">{c.overseas}/{c.maxOverseas}</dd></div>
                  </dl>
                  {c.retained.length > 0 && <p className="mt-2 truncate text-xs text-ink-muted" title={c.retained.map((r: any) => r.name).join(', ')}>Retained: {c.retained.map((r: any) => r.name).join(', ')}</p>}
                  {c.needs.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{c.needs.map((n: string) => <Badge key={n} tone="muted">needs {n.toLowerCase()}</Badge>)}</div>}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="h-section mb-1">Your shortlist</h2>
            <p className="mb-3 text-sm text-ink-muted">Flag players to watch and set proxy maximums now. A proxy bids for you automatically, one increment at a time, up to your limit.</p>
            {full?.auction?.queue ? <Queue queue={full.auction.queue} command={command} /> : <p className="text-sm text-ink-muted">Loading the catalogue…</p>}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="h-section">Your position</h2>
            {me && (
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="label">Purse</dt><dd className="num text-2xl text-lime">{cr(me.purse)}</dd></div>
                <div><dt className="label">Squad</dt><dd className="num text-2xl">{me.squad}<span className="text-sm text-ink-faint">/{me.maxSquad}</span></dd></div>
              </dl>
            )}
            <p className="mt-3 text-sm text-ink-muted">{a.needs.text}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {a.needs.gaps.map((g: any) => (
                <li key={g.label} className="flex items-center justify-between gap-2">
                  <span>{g.label}</span>
                  <span className={`num ${g.have >= g.target ? 'text-lime' : 'text-ink-muted'}`}>{g.have}/{g.target}</span>
                </li>
              ))}
            </ul>
          </section>
          {lobby && (
            <section className="card p-5 text-sm">
              <h2 className="h-section">Rules of the room</h2>
              <ul className="mt-3 space-y-1.5 text-ink-muted">
                <li>Squads {lobby.rules.minSquad}–{lobby.rules.maxSquad}; at most {lobby.rules.maxOverseas} overseas, {lobby.rules.maxPerOverseasCountry} from any one country.</li>
                <li>Purse {cr(lobby.rules.purse)}; minimum base price {cr(lobby.rules.minBase)}. You must keep enough to fill your minimum squad.</li>
                <li>Every new bid reopens the clock. Silence means a final call, then the gavel.</li>
              </ul>
              <div className="label mb-1 mt-4">Bid increments</div>
              <table className="table">
                <tbody>
                  {lobby.rules.increments.map((x: any, i: number) => (
                    <tr key={i}><td className="text-ink-muted">{x.upTo === null ? 'Above' : `Up to ${cr(x.upTo)}`}</td><td className="num text-right">+{cr(x.step)}</td></tr>
                  ))}
                </tbody>
              </table>
              {lobby.countries.length > 0 && (
                <>
                  <div className="label mb-1 mt-4">Pool by nationality</div>
                  <div className="flex flex-wrap gap-1.5">{lobby.countries.map((c: any) => <Badge key={c.country} tone="muted">{c.country} {c.n}</Badge>)}</div>
                </>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
