import { useEffect, useState } from 'react';
import { BOWL_LABEL, ROLE_LABEL, cr } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { ClubCrestById, PlayerPortrait } from '../../components/media';
import { ConditionBadges, PlayerName, usePlayerModal } from '../../components/player';
import { Icon } from '../../components/icons';
import { Badge, Confirm, Kbd, Meter, Segmented, Tabs } from '../../components/ui';
import { BidHistory, ClubGallery, Commentary, Countdown, PHASE_TEXT, ProxyEditor, Queue, SkipDialog, StrategyPanel } from './parts';
import type { Room, SkipMode } from './useRoom';

type Props = { room: Room; full: Room | null; busy: boolean; command: (c: any, o?: { quietError?: boolean }) => Promise<boolean>; skip: (mode: SkipMode) => void };

export function LiveRoom({ room, full, busy, command, skip }: Props) {
  const a = room.auction;
  const live = a.live;
  const lot = a.lot;
  const { prefs, set } = usePrefs();
  const [confirmBid, setConfirmBid] = useState<number | null>(null);
  const [skipLot, setSkipLot] = useState(false);
  const [finish, setFinish] = useState(false);
  const [proxy, setProxy] = useState(false);
  const [tab, setTab] = useState<'commentary' | 'bids' | 'results'>('commentary');
  const [side, setSide] = useState<'queue' | 'strategy'>('strategy');
  const me = a.clubs.find((c: any) => c.isUser);
  const showResult = (live.phase === 'SOLD' || live.phase === 'UNSOLD') && a.lastResult;

  const bid = (amount?: number) => {
    if (!lot?.canBid) return;
    const value = amount ?? lot.nextBid;
    if (prefs.largeBidConfirm !== null && value >= prefs.largeBidConfirm) return setConfirmBid(value);
    send(amount);
  };
  // The main button is a paddle raise: the next increment, tolerating one rival bid landing first.
  const send = (amount?: number) =>
    command(amount !== undefined && amount !== lot?.nextBid ? { type: 'bid', amount } : { type: 'bid', upTo: lot?.permitted[1] ?? lot?.nextBid });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') bid();
      else if ((e.key === 'p' || e.key === 'P') && lot && !lot.userOut && lot.leaderId !== me?.id) command({ type: 'pass' });
      else if (e.key === ' ') {
        e.preventDefault();
        command({ type: 'pause', paused: !live.paused });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-4">
      {/* top strip */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <div className="kicker">The Auction House · {a.leagueName}</div>
          <div className="mt-0.5 text-sm text-ink-muted">
            Lot <b className="num text-ink">{a.lotNumber}</b> of {a.totalLots} · {a.remaining} to go{lot ? ` · ${lot.set}` : ''}{lot?.round === 2 ? ' · accelerated round' : ''}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="How long each bidding window stays open">
          Bid clock
          <select className="input w-auto py-1 text-xs" value={live.clockSetting ?? 'standard'} onChange={(e) => command({ type: 'clock', setting: e.target.value })}>
            <option value="brisk">Brisk</option><option value="standard">Standard</option><option value="relaxed">Relaxed</option>
          </select>
        </label>
        <Segmented label="Animation speed" value={prefs.auctionSpeed} onChange={(v) => set({ auctionSpeed: v })} options={[{ id: 1, label: '1×' }, { id: 2, label: '2×' }, { id: 4, label: '4×' }]} />
        <button className="btn-ghost" onClick={() => command({ type: 'pause', paused: !live.paused })} aria-pressed={live.paused}>
          <Icon name={live.paused ? 'play' : 'pause'} size={16} /> {live.paused ? 'Resume' : 'Pause'} <span className="hidden sm:inline"><Kbd>Space</Kbd></span>
        </button>
        <button className="btn-quiet" disabled={busy || !lot} onClick={() => setSkipLot(true)} title="Let the other franchises settle this lot without you"><Icon name="fast" size={16} /> Skip lot</button>
        <button className="btn-ghost" disabled={busy} onClick={() => setFinish(true)}>Skip auction</button>
      </div>

      {live.outbid && lot && !lot.userOut && (
        <div className="pop flex flex-wrap items-center gap-3 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3" role="alert">
          <Icon name="alert" className="text-warn" />
          <span className="flex-1 text-sm"><b>You’ve been outbid.</b> {lot.bids.length ? `${lot.bids[lot.bids.length - 1].clubName} lead at ${cr(lot.current)}.` : ''}</span>
          {lot.canBid && <button className="btn-primary" disabled={busy} onClick={() => bid()}>Bid {cr(lot.nextBid)}</button>}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_340px]">
        {/* franchise gallery */}
        <aside className="card order-3 p-3 xl:order-1" aria-label="Franchises">
          <div className="label mb-2 px-1">Franchises</div>
          <ClubGallery clubs={a.clubs} lot={lot} />
        </aside>

        {/* centre stage */}
        <section className="order-1 space-y-4 xl:order-2" aria-label="Current lot">
          <div className="card grain relative overflow-hidden p-5 md:p-6">
            {lot ? (
              <>
                <div className="flex flex-wrap items-start gap-5">
                  <PlayerPortrait player={lot.player} size={112} className="shadow-lift" />
                  <div className="min-w-[11rem] flex-1">
                    <div className="kicker">{ROLE_LABEL[lot.player.role]} · {lot.player.countryName}{lot.player.overseas ? ' · Overseas' : ''}</div>
                    <h1 className="headline mt-1 text-3xl md:text-4xl"><PlayerName p={lot.player} /></h1>
                    <div className="mt-1 text-sm text-ink-muted">{lot.player.age} · {lot.player.batHand === 'L' ? 'Left' : 'Right'}-hand bat · {BOWL_LABEL[lot.player.bowlType]}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {lot.player.capped ? <Badge tone="lime">Capped</Badge> : <Badge tone="info">Uncapped</Badge>}
                      <ConditionBadges p={lot.player} />
                      {lot.flagged && <Badge tone="warn">On your shortlist</Badge>}
                      {lot.player.tags.slice(0, 3).map((t: string) => <Badge key={t} tone="muted">{t}</Badge>)}
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-4 gap-x-5 gap-y-2 text-center sm:w-auto sm:grid-cols-2">
                    <div><div className="label">Ovr</div><div className="num text-3xl font-semibold text-lime">{lot.player.ovr}</div></div>
                    <div><div className="label">Pot</div><div className="num text-xl">{lot.player.potential.hi}</div></div>
                    <div><div className="label">Bat</div><div className="num text-lg">{lot.player.batting}</div></div>
                    <div><div className="label">Bowl</div><div className="num text-lg">{lot.player.bowlType === 'NONE' ? '—' : lot.player.bowling}</div></div>
                  </div>
                </div>
                {lot.player.scouting && (
                  <p className="mt-4 text-sm text-ink-muted">
                    {lot.player.scouting.strengths.slice(0, 2).map((s: string) => `+ ${s}`).join('  ')}{lot.player.scouting.concerns.length ? `   – ${lot.player.scouting.concerns[0]}` : ''}
                  </p>
                )}
              </>
            ) : <p className="py-10 text-center text-ink-muted">Waiting for the next lot…</p>}

            {showResult && <ResultCard r={a.lastResult} />}
          </div>

          {lot && (
            <div className="card p-5 md:p-6" aria-label="Bidding">
              <Countdown phase={live.phase} ms={live.phaseMs} paused={live.paused} />
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="label">{lot.current !== null ? 'Current bid' : 'Base price'}</div>
                  <div className={`num text-4xl font-semibold leading-none sm:text-5xl ${lot.leaderId === me?.id ? 'text-lime' : ''}`} key={lot.current ?? 'base'}><span className="pop inline-block">{cr(lot.current ?? lot.basePrice)}</span></div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
                    {lot.leaderId ? (
                      <>
                        <ClubCrestById clubId={lot.leaderId} size={22} fallback={lot.leaderId === me?.id ? me : undefined} />
                        <span>{lot.leaderId === me?.id ? <b className="text-lime">You lead</b> : <>{lot.bids[lot.bids.length - 1].clubName} lead</>}</span>
                      </>
                    ) : <span>No bids yet</span>}
                    <span className="text-ink-faint">· {lot.activeBidders.length} franchise{lot.activeBidders.length === 1 ? '' : 's'} interested</span>
                  </div>
                </div>
                <div className="text-right text-xs text-ink-muted">
                  <div>Estimate <span className="num text-ink">{cr(lot.strategy.estimate)}</span></div>
                  <div>Your purse <span className="num text-ink">{cr(me?.purse)}</span></div>
                  {lot.canBid && me && <div>After this bid <span className="num text-ink">{cr(Math.round((me.purse - lot.nextBid) * 100) / 100)}</span> if you win</div>}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button className="btn-primary px-6 py-3 text-base" disabled={!lot.canBid || busy} onClick={() => bid()} aria-keyshortcuts="b">
                  <Icon name="gavel" /> Bid {cr(lot.nextBid)} <span className="hidden sm:inline"><Kbd>B</Kbd></span>
                </button>
                {lot.permitted.slice(1).map((v: number) => (
                  <button key={v} className="btn-ghost" disabled={!lot.canBid || busy || v > lot.strategy.maxAffordable} onClick={() => bid(v)}>Jump to {cr(v)}</button>
                ))}
                <span className="flex-1" />
                <button className="btn-quiet" disabled={busy || lot.userOut || lot.leaderId === me?.id} onClick={() => command({ type: 'pass' })} aria-keyshortcuts="p">Pass <span className="hidden sm:inline"><Kbd>P</Kbd></span></button>
                <button className={`btn-quiet ${live.watching ? 'text-lime' : ''}`} disabled={busy || live.watching} onClick={() => command({ type: 'watch' })}><Icon name="eye" size={16} /> {live.watching ? 'Watching' : 'Watch'}</button>
                <button className={`btn-quiet ${lot.proxy !== null ? 'text-lime' : ''}`} onClick={() => setProxy(true)}>{lot.proxy !== null ? `Proxy ${cr(lot.proxy)}` : 'Set proxy'}</button>
              </div>
              {lot.blockReason && <p className="mt-3 text-sm text-ink-muted">{lot.blockReason}</p>}
              {lot.interest?.length > 0 && (
                <ul className="mt-3 space-y-0.5 border-t border-obsidian-700 pt-2 text-xs text-ink-muted" aria-label="Why rivals are bidding">
                  {lot.interest.map((i: any) => <li key={i.clubId}><b className="text-ink">{i.short}</b>: {i.reason}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="card p-4">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'commentary', label: 'Auctioneer' }, { id: 'bids', label: `Bid history${lot ? ` (${lot.bids.length})` : ''}` }, { id: 'results', label: 'Results' }]} />
            <div className="mt-3 max-h-72 overflow-y-auto">
              {tab === 'commentary' && <Commentary lines={a.commentary} />}
              {tab === 'bids' && (lot ? <BidHistory bids={lot.bids} /> : <p className="text-sm text-ink-muted">No lot in progress.</p>)}
              {tab === 'results' && <Results results={a.results} />}
            </div>
          </div>
        </section>

        {/* strategy & queue */}
        <aside className="order-2 space-y-4 xl:order-3">
          <div className="card p-4">
            <Tabs value={side} onChange={setSide} tabs={[{ id: 'strategy', label: 'Strategy' }, { id: 'queue', label: 'Upcoming' }]} />
            <div className="mt-3">
              {side === 'strategy' && (lot ? <StrategyPanel lot={lot} /> : <p className="text-sm text-ink-muted">Strategy appears when a player is introduced.</p>)}
              {side === 'queue' && (full?.auction?.queue ? <Queue queue={full.auction.queue} command={command} compact /> : <p className="text-sm text-ink-muted">Loading…</p>)}
            </div>
          </div>
          <div className="card p-4">
            <div className="label mb-2">Your squad needs</div>
            <ul className="space-y-2 text-sm">
              {a.needs.gaps.map((g: any) => (
                <li key={g.label}><Meter label={g.label} display={`${g.have}/${g.target}`} value={Math.min(100, (g.have / Math.max(1, g.target)) * 100)} /></li>
              ))}
            </ul>
            {a.needs.contested.length > 0 && <p className="mt-3 text-xs text-warn">{a.needs.contested[0]}.</p>}
          </div>
        </aside>
      </div>

      <Confirm open={confirmBid !== null} title="Confirm a large bid" confirmLabel={`Bid ${cr(confirmBid)}`}
        body={<>You are about to bid <b>{cr(confirmBid)}</b> for {lot?.player.name}. If you win, your purse drops to <b>{me ? cr(Math.round((me.purse - (confirmBid ?? 0)) * 100) / 100) : '—'}</b>. You can change this threshold in Settings.</>}
        onClose={() => setConfirmBid(null)}
        onConfirm={() => { const v = confirmBid; setConfirmBid(null); if (v) send(v === lot?.nextBid ? undefined : v); }} />
      <Confirm open={skipLot} title="Skip this lot?" confirmLabel="Skip lot" body="You sit this one out and the other franchises settle it immediately. The result is recorded like any other sale."
        onClose={() => setSkipLot(false)} onConfirm={() => { setSkipLot(false); command({ type: "skip-lot" }); }} />
      <SkipDialog open={finish} onClose={() => setFinish(false)} shortlisted={(full?.auction?.queue ?? []).filter((x: any) => x.flagged).length}
        onSkip={(mode) => { setFinish(false); skip(mode); }} />
      {proxy && lot && (
        <ProxyEditor player={lot.player} current={lot.proxy} onClose={() => setProxy(false)}
          onSave={async (v) => { if (await command({ type: 'proxy', playerId: lot.player.id, max: v })) setProxy(false); }} />
      )}
    </div>
  );
}

function ResultCard({ r }: { r: any }) {
  const sold = r.status === 'sold';
  return (
    <div className="pop absolute inset-0 z-10 grid place-items-center bg-obsidian-950/85 p-6 backdrop-blur-sm" role="status" aria-live="assertive">
      <div className="w-full max-w-md text-center">
        <div className={`font-display text-6xl font-bold uppercase tracking-[0.2em] ${sold ? 'text-lime' : 'text-ink-muted'}`}>{sold ? 'Sold' : 'Unsold'}</div>
        <div className="mt-3 flex items-center justify-center gap-3">
          <PlayerPortrait player={r.player} size={56} />
          {sold && r.clubId && <ClubCrestById clubId={r.clubId} size={56} fallback={r.isUser ? { id: r.clubId, name: r.clubName, shortName: r.clubShort, colors: r.colors } : undefined} />}
        </div>
        <div className="headline mt-3 text-2xl">{r.player.name}</div>
        {sold ? (
          <>
            <div className="mt-1 text-ink-muted">to <b className={r.isUser ? 'text-lime' : 'text-ink'}>{r.clubName}</b> for <b className="num text-ink">{cr(r.price)}</b></div>
            <div className={`mt-1 text-sm ${r.diff > 0 ? 'text-warn' : 'text-lime'}`}>{r.diff === 0 ? 'Exactly the estimate' : `${cr(Math.abs(r.diff))} ${r.diff > 0 ? 'above' : 'below'} the estimate of ${cr(r.estimate)}`}</div>
            <div className="mt-1 text-xs text-ink-faint">{r.bids} bids from {r.bidders} franchise{r.bidders === 1 ? '' : 's'} · squad now {r.squadSize}</div>
          </>
        ) : <div className="mt-2 text-sm text-ink-muted">{r.reason ?? 'No franchise met the base price.'}</div>}
      </div>
    </div>
  );
}

function Results({ results }: { results: any[] }) {
  if (!results.length) return <p className="text-sm text-ink-muted">No lots resolved yet.</p>;
  return (
    <table className="table">
      <tbody>
        {results.map((r) => (
          <tr key={r.lotId}>
            <td><span className="font-medium">{r.name}</span> <span className="text-xs text-ink-faint">{r.role}</span></td>
            <td className="text-ink-muted">{r.status === 'sold' ? r.club : 'Unsold'}</td>
            <td className="num text-right">{r.price !== null ? cr(r.price) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AcceleratedSelection({ room, busy, command }: { room: Room; busy: boolean; command: (c: any) => Promise<boolean> }) {
  const acc = room.auction.accelerated;
  const players = usePlayerModal();
  if (!acc) return null;
  return (
    <div className="space-y-5">
      <div>
        <div className="kicker">The Auction House · {room.auction.leagueName}</div>
        <h1 className="headline mt-1 text-3xl md:text-4xl">The accelerated round</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">These players went unsold. Franchises have nominated the ones they want back under the hammer — add or remove names, then start the round. Lots move quickly from here.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-muted"><b className="text-ink">{acc.selected.length}</b> of {acc.candidates.length} nominated</span>
        <button className="btn-primary" disabled={busy} onClick={() => command({ type: 'accelerated-start' })}>{acc.selected.length ? 'Start the accelerated round' : 'Close the auction'} <Icon name="chevronRight" size={16} /></button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {acc.candidates.map((p: any) => {
          const on = acc.selected.includes(p.id);
          return (
            <div key={p.id} className={`card flex items-center gap-3 p-3 ${on ? 'border-lime/60' : ''}`}>
              <PlayerPortrait player={p} size={40} />
              <div className="min-w-0 flex-1">
                <button className="block truncate text-left font-medium hover:text-lime" onClick={() => players.open(p.id)}>{p.name}</button>
                <div className="text-xs text-ink-muted">{p.role} · {p.age} · {p.countryName} · ovr {p.ovr}</div>
              </div>
              <button className={on ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'} aria-pressed={on} disabled={busy} onClick={() => command({ type: 'accelerated-toggle', playerId: p.id })}>{on ? 'Nominated' : 'Nominate'}</button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-faint">{PHASE_TEXT.ACCELERATED_SELECTION}: unsold players return at their base price.</p>
    </div>
  );
}
