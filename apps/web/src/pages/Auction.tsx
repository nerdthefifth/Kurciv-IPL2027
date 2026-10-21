import { useEffect, useMemo, useRef, useState } from 'react';
import { BOWL_LABEL, ROLE_LABEL, api, cr, useApi } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Async, Badge, Card, Confirm, Empty, Meter, Modal, PageHeader, Stat } from '../components/ui';
import { Avatar, ConditionBadges, OvrChip, PlayerName } from '../components/player';

export function AuctionPage() {
  const career = useCareer();
  const o = career.overview.data;
  if (o?.phase === 'retention') return <RetentionWindow />;
  return <AuctionRoom />;
}

// ------------------------------------------------------------------ retention

function RetentionWindow() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/retentions`, [career.tick]);
  const [sel, setSel] = useState<string[] | null>(null);
  return (
    <Async state={state}>
      {(d) => {
        const chosen = sel ?? d.chosen;
        const toggle = (id: string) => setSel(chosen.includes(id) ? chosen.filter((x: string) => x !== id) : [...chosen, id]);
        // Preview costs client-side using the same slab rule as the server (highest value takes the first slab).
        const picked = d.squad.filter((p: any) => chosen.includes(p.id)).sort((a: any, b: any) => b.marketValue - a.marketValue);
        let capped = 0;
        const cost: Record<string, number> = {};
        for (const p of picked) cost[p.id] = p.capped ? d.slabs[Math.min(capped++, d.slabs.length - 1)] : d.uncappedCost;
        const total = Object.values(cost).reduce((a, b) => a + b, 0);
        const changed = JSON.stringify([...chosen].sort()) !== JSON.stringify([...d.chosen].sort());
        return (
          <div className="space-y-5">
            <PageHeader title="Retention window" subtitle={`Keep up to ${d.maxRetentions} players before the auction. Everyone else returns to the pool.`} actions={
              <button className="btn-primary" disabled={!changed || chosen.length > d.maxRetentions} onClick={() => career.mutate('/retentions', { playerIds: chosen }, { success: 'Retentions saved. Commit them from the top bar when ready.' }).then(() => setSel(null))}>
                Save retentions
              </button>
            } />
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Slots used" value={`${chosen.length}/${d.maxRetentions}`} />
              <Stat label="Retention spend" value={cr(total)} />
              <Stat label="Auction purse left" value={cr(d.purse - total)} sub={`of ${cr(d.purse)}`} />
              <Stat label="Capped slabs" value={d.slabs.join(' / ')} sub={`Uncapped ${cr(d.uncappedCost)}`} />
            </div>
            <Card title="Your squad" pad={false}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Retain</th><th>Player</th><th>Role</th><th>Age</th><th>Ovr</th><th>Season</th><th className="text-right">Fair value</th><th className="text-right">Retention cost</th><th className="text-right">Opportunity</th></tr></thead>
                  <tbody>
                    {[...d.squad].sort((a: any, b: any) => b.marketValue - a.marketValue).map((p: any) => {
                      const on = chosen.includes(p.id);
                      const c = cost[p.id];
                      const opp = on ? p.valueToClub - c : null;
                      return (
                        <tr key={p.id} className={on ? 'bg-lime/5' : ''}>
                          <td><input type="checkbox" className="accent-[#c6ff1a]" aria-label={`Retain ${p.name}`} checked={on} disabled={!on && chosen.length >= d.maxRetentions} onChange={() => toggle(p.id)} /></td>
                          <td><PlayerName p={p} /> {p.capped ? <Badge tone="muted">capped</Badge> : <Badge tone="info">uncapped</Badge>} <ConditionBadges p={p} /></td>
                          <td>{p.role}</td>
                          <td className="num">{p.age}</td>
                          <td><OvrChip p={p} /></td>
                          <td className="num text-ink-muted">{p.season.runs}r / {p.season.wickets}w</td>
                          <td className="num text-right">{cr(p.valueToClub)}</td>
                          <td className="num text-right">{on ? cr(c) : '—'}</td>
                          <td className={`num text-right ${opp === null ? '' : opp >= 0 ? 'text-lime' : 'text-danger'}`}>{opp === null ? '—' : `${opp >= 0 ? '+' : ''}${opp.toFixed(2)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="p-4 text-xs text-ink-muted">“Opportunity” compares fair auction value with the retention price: negative means you would probably pay less by buying the player back at auction, if you win the bidding war. Retentions count against the overseas limits like any other registration.</p>
            </Card>
          </div>
        );
      }}
    </Async>
  );
}

// ------------------------------------------------------------------ auction room

function AuctionRoom() {
  const career = useCareer();
  const toast = useToast();
  const state = useApi<any>(`/careers/${career.id}/auction`, [career.tick]);
  const [busy, setBusy] = useState(false);
  const act = async (action: any, version: number) => {
    setBusy(true);
    try {
      await api(`/careers/${career.id}/auction/act`, { body: { action, version } });
    } catch (e) {
      toast.push('error', (e as Error).message);
    } finally {
      setBusy(false);
      career.refresh();
    }
  };
  return (
    <Async state={state}>
      {(d) => {
        if (!d.auction) return <><PageHeader title="Auctions" /><Empty title="No auction this window">The next auction cascade opens after the season’s retentions.</Empty></>;
        if (d.auction.status !== 'live') return <AuctionSummary d={d} />;
        return <LiveRoom d={d} act={act} busy={busy} />;
      }}
    </Async>
  );
}

function Cascade({ cascade }: { cascade: any[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Global auction cascade">
      {cascade.map((c, i) => (
        <li key={c.id} className="flex items-center gap-1">
          <Badge tone={c.status === 'complete' ? 'muted' : c.status === 'live' ? 'lime' : 'default'}>{c.leagueId}{c.interactive ? ' (you)' : ''}</Badge>
          {i < cascade.length - 1 && <span className="text-ink-faint" aria-hidden>›</span>}
        </li>
      ))}
    </ol>
  );
}

function LiveRoom({ d, act, busy }: { d: any; act: (a: any, v: number) => void; busy: boolean }) {
  const a = d.auction;
  const lot = a.lot;
  const p = lot?.player;
  const v = a.version;
  const userClub = d.clubs.find((c: any) => c.isUser);
  const leader = lot?.bids.length ? lot.bids[lot.bids.length - 1] : null;
  const leaderClub = leader ? d.clubs.find((c: any) => c.id === leader.clubId) : null;
  const [proxyOpen, setProxyOpen] = useState(false);
  const [simAsk, setSimAsk] = useState<null | { until: string; assistant: boolean; label: string }>(null);
  const [autoPass, setAutoPass] = useState(true);
  const [seconds, setSeconds] = useState(d.rules.bidSeconds);
  const lotKey = `${lot?.id}-${lot?.bids.length}`;
  useEffect(() => setSeconds(d.rules.bidSeconds), [lotKey, d.rules.bidSeconds]);
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    if (!lot || busy || proxyOpen || simAsk) return;
    if (seconds <= 0) {
      if (autoPass) actRef.current({ type: 'pass' }, v);
      return;
    }
    const t = setTimeout(() => setSeconds((s: number) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, lot, busy, autoPass, v, proxyOpen, simAsk]);

  // Keyboard: B = bid, P = pass
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || busy) return;
      if (e.key === 'b' && a.bidState?.canBid) act({ type: 'bid' }, v);
      if (e.key === 'p') act({ type: 'pass' }, v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a.bidState?.canBid, act, busy, v]);

  const eligible = d.clubs.filter((c: any) => c.purse >= (a.bidState?.next ?? 0) && c.squad < d.rules.maxSquad);

  return (
    <div className="space-y-4">
      <PageHeader title={`${a.leagueName} auction`} subtitle={<Cascade cascade={d.cascade} />} actions={
        <>
          <button className="btn-ghost" disabled={busy} onClick={() => setSimAsk({ until: 'flagged', assistant: false, label: 'Skip to your next flagged player' })}>Skip to flagged</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setSimAsk({ until: 'set', assistant: true, label: `Let the assistant handle the rest of “${lot?.set}”` })}>Assistant: rest of set</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setSimAsk({ until: 'end', assistant: true, label: 'Let the assistant complete the auction for you' })}>Assistant: finish auction</button>
        </>
      } />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {lot && p && (
            <Card>
              <div className="flex flex-wrap items-start gap-4">
                <Avatar name={p.name} image={p.image} size={96} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="lime">{lot.set}</Badge>
                    {lot.round === 2 && <Badge tone="warn">Accelerated round</Badge>}
                    <span className="text-xs text-ink-muted">Lot {a.currentLotIndex + 1} of {a.totalLots}</span>
                  </div>
                  <h2 className="mt-1 font-display text-4xl font-bold uppercase leading-none"><PlayerName p={p} /></h2>
                  <p className="mt-1 text-sm text-ink-muted">{p.countryName} · {p.age} · {ROLE_LABEL[p.role]} · {p.batHand}HB · {BOWL_LABEL[p.bowlType]}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{p.capped && <Badge tone="muted">Capped</Badge>}<ConditionBadges p={p} />{p.tags.map((t: string) => <Badge key={t} tone="muted">{t}</Badge>)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div><div className="label">Overall</div><OvrChip p={p} /></div>
                  <div><div className="label">Potential</div><div className="num">{p.potential.lo}–{p.potential.hi}</div></div>
                  <div><div className="label">Base</div><div className="num">{cr(lot.basePrice)}</div></div>
                  <div><div className="label">Est. value</div><div className="num">{cr(p.marketValue)}</div></div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Meter label="Batting" value={p.batting} />
                <Meter label="Bowling" value={p.bowlType === 'NONE' ? 0 : p.bowling} />
                <Meter label="Fielding" value={p.fielding} />
                <Meter label="Reputation" value={p.reputation} />
              </div>
              {p.career.matches > 0 && <p className="mt-2 text-xs text-ink-muted">Kurciv career: {p.career.matches} matches, {p.career.runs} runs (SR {p.career.strikeRate ?? '—'}), {p.career.wickets} wickets (econ {p.career.economy ?? '—'})</p>}
              <p className="mt-2 text-xs text-ink-faint">{p.dataNote}</p>
            </Card>
          )}
          {lot && (
            <Card>
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div aria-live="polite">
                  <div className="label">{leader ? 'Current bid' : 'Opening at base price'}</div>
                  <div className="num text-5xl font-bold text-lime">{cr(leader ? leader.amount : lot.basePrice)}</div>
                  <div className="text-sm">{leaderClub ? <>Held by <b style={{ color: leaderClub.isUser ? '#c6ff1a' : undefined }}>{leaderClub.name}</b></> : 'No bids yet'}</div>
                </div>
                <div className="flex flex-col items-stretch gap-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                    <span>Hammer in</span>
                    <span className={`num text-2xl ${seconds <= 3 ? 'text-danger' : 'text-ink'}`} aria-live="off">{Math.max(0, seconds)}s</span>
                  </div>
                  <button className="btn-primary text-base" disabled={busy || !a.bidState?.canBid} onClick={() => act({ type: 'bid' }, v)}>
                    Bid {cr(a.bidState?.next)} <span className="text-[10px] opacity-70">[B]</span>
                  </button>
                  <div className="flex gap-2">
                    <button className="btn-ghost flex-1" disabled={busy} onClick={() => act({ type: 'pass' }, v)}>Pass [P]</button>
                    <button className="btn-ghost flex-1" disabled={busy} onClick={() => setProxyOpen(true)}>Proxy max</button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" className="accent-[#c6ff1a]" checked={autoPass} onChange={(e) => setAutoPass(e.target.checked)} /> Pass automatically when the timer ends</label>
                </div>
              </div>
              {a.bidState?.reason && <p className="mt-3 text-sm text-warn" role="status">{a.bidState.reason}</p>}
              {a.bidState?.advice && <p className="mt-2 text-xs text-ink-muted">🛈 {a.bidState.advice}</p>}
              <div className="mt-4">
                <div className="label mb-1">Bid history</div>
                {lot.bids.length ? (
                  <ol className="flex max-h-28 flex-col-reverse gap-1 overflow-y-auto text-sm">
                    {lot.bids.map((b: any, i: number) => {
                      const c = d.clubs.find((x: any) => x.id === b.clubId);
                      return <li key={i} className="flex justify-between"><span>{c?.shortName}{b.proxy ? ' (proxy)' : ''}</span><span className="num">{cr(b.amount)}</span></li>;
                    })}
                  </ol>
                ) : <p className="text-sm text-ink-muted">Waiting for an opening bid.</p>}
              </div>
            </Card>
          )}
          <Queue d={d} act={act} busy={busy} />
        </div>
        <div className="space-y-4">
          <Card title="Clubs" actions={<span className="text-xs text-ink-muted">{eligible.length} can afford the next bid</span>} pad={false}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Club</th><th className="text-right">Purse</th><th className="text-right">Squad</th><th className="text-right">OS</th><th>BAT/WK/AR/BWL</th></tr></thead>
                <tbody>
                  {d.clubs.map((c: any) => (
                    <tr key={c.id} className={c.isUser ? 'bg-lime/5' : ''}>
                      <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: c.colors[0] }} aria-hidden />{c.shortName}{eligible.includes(c) ? '' : <span className="ml-1 text-[10px] text-ink-faint">(out)</span>}</td>
                      <td className="num text-right">{cr(c.purse)}</td>
                      <td className="num text-right">{c.squad}/{d.rules.maxSquad}</td>
                      <td className="num text-right">{c.overseas}/{d.rules.maxOverseas}</td>
                      <td className="num text-xs text-ink-muted">{c.roles.BAT}/{c.roles.WK}/{c.roles.AR}/{c.roles.BOWL}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {userClub && (
            <Card title="Your squad needs">
              <NeedsPanel club={userClub} rules={d.rules} />
            </Card>
          )}
          <Card title="Recent lots" pad={false}>
            <ul className="max-h-72 overflow-y-auto">
              {a.recent.map((r: any) => (
                <li key={r.lotId} className="flex items-center justify-between gap-2 border-b border-obsidian-800 px-4 py-2 text-sm">
                  <span className="truncate">{r.name} <span className="text-xs text-ink-faint">{r.role}</span></span>
                  {r.status === 'sold' ? <span className="num text-xs">{r.soldTo} · {cr(r.price)}</span> : <Badge tone="muted">unsold</Badge>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Auction intelligence">
            {a.notes.length ? (
              <ul className="max-h-72 space-y-2 overflow-y-auto text-xs">
                {a.notes.map((n: any, i: number) => <li key={i}><b className="text-ink">{n.club}</b> on {n.player}: <span className="text-ink-muted">{n.reason}</span></li>)}
              </ul>
            ) : <p className="text-xs text-ink-muted">Rival clubs’ reasoning on big decisions is revealed after each lot closes.</p>}
          </Card>
        </div>
      </div>
      {proxyOpen && lot && <ProxyDialog player={p} next={a.bidState?.next ?? lot.basePrice} purse={userClub?.purse ?? 0} onClose={() => setProxyOpen(false)} onSave={(max) => { setProxyOpen(false); act({ type: 'proxy', playerId: lot.playerId, max }, v); }} />}
      {simAsk && (
        <Confirm open title={simAsk.label} confirmLabel="Run" onClose={() => setSimAsk(null)} onConfirm={() => act({ type: 'sim', until: simAsk.until, assistant: simAsk.assistant }, v)}
          body={simAsk.assistant ? 'Your assistant bids to the club’s needs, budget plan and your proxy limits. You will not be asked about each lot.' : 'You pass on every lot until a player you flagged comes up. Proxy bids you set still apply.'} />
      )}
    </div>
  );
}

function NeedsPanel({ club, rules }: { club: any; rules: any }) {
  const target = { BAT: 6, WK: 2, AR: 5, BOWL: 8 } as Record<string, number>;
  return (
    <div className="space-y-2 text-sm">
      {Object.entries(target).map(([r, t]) => (
        <div key={r} className="flex items-center gap-2">
          <span className="w-24 text-ink-muted">{ROLE_LABEL[r]}</span>
          <div className="flex-1"><Meter value={Math.min(club.roles[r], t)} max={t} compact={false} /></div>
          <span className="num w-10 text-right">{club.roles[r]}/{t}</span>
        </div>
      ))}
      <p className="text-xs text-ink-muted">Squad {club.squad}/{rules.maxSquad} (minimum {rules.minSquad}) · overseas {club.overseas}/{rules.maxOverseas} · purse {cr(club.purse)}. Targets are guidance; only the registration rules are enforced.</p>
    </div>
  );
}

function ProxyDialog({ player, next, purse, onClose, onSave }: { player: any; next: number; purse: number; onClose: () => void; onSave: (max: number | null) => void }) {
  const [max, setMax] = useState(String(Math.min(purse, Math.max(next, player.marketValue)).toFixed(2)));
  const n = Number(max);
  return (
    <Modal open title={`Proxy bid — ${player.name}`} onClose={onClose}>
      <p className="text-sm text-ink-muted">The auctioneer will bid for you, one increment at a time, up to your maximum. Nobody else can see it.</p>
      <label className="label mt-4 block" htmlFor="proxy">Maximum (₹ Cr)</label>
      <input id="proxy" type="number" step="0.05" min={next} max={purse} className="input mt-1" value={max} onChange={(e) => setMax(e.target.value)} />
      {(n < next || n > purse) && <p className="mt-1 text-xs text-danger">Must be between {cr(next)} and your purse {cr(purse)}.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!(n >= next && n <= purse)} onClick={() => onSave(n)}>Set proxy</button>
      </div>
    </Modal>
  );
}

function Queue({ d, act, busy }: { d: any; act: (a: any, v: number) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [proxyFor, setProxyFor] = useState<any>(null);
  const list = useMemo(() => d.auction.queue.filter((x: any) => !q || x.player.name.toLowerCase().includes(q.toLowerCase()) || x.set.toLowerCase().includes(q.toLowerCase())), [d.auction.queue, q]);
  const user = d.clubs.find((c: any) => c.isUser);
  return (
    <Card title="Upcoming lots" actions={<input className="input w-48" placeholder="Search name or set" aria-label="Search the auction queue" value={q} onChange={(e) => setQ(e.target.value)} />} pad={false}>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="table">
          <thead><tr><th>Flag</th><th>Player</th><th>Set</th><th>Ovr</th><th className="text-right">Base</th><th className="text-right">Proxy</th></tr></thead>
          <tbody>
            {list.map((x: any) => (
              <tr key={x.lotId}>
                <td><button className={`text-lg ${x.flagged ? 'text-lime' : 'text-ink-faint'}`} aria-pressed={x.flagged} aria-label={`${x.flagged ? 'Unflag' : 'Flag'} ${x.player.name}`} disabled={busy} onClick={() => act({ type: 'flag', playerId: x.player.id, flagged: !x.flagged }, d.auction.version)}>{x.flagged ? '★' : '☆'}</button></td>
                <td><PlayerName p={x.player} /> <span className="text-xs text-ink-faint">{x.player.role} · {x.player.age}{x.player.overseas ? ' · OS' : ''}</span></td>
                <td className="text-xs text-ink-muted">{x.set}{x.round === 2 ? ' (R2)' : ''}</td>
                <td><OvrChip p={x.player} /></td>
                <td className="num text-right">{cr(x.basePrice)}</td>
                <td className="text-right">
                  <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setProxyFor(x)}>{x.proxy ? cr(x.proxy) : 'Set'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="p-4 text-sm text-ink-muted">No upcoming lots match.</p>}
      </div>
      {proxyFor && (
        <ProxyDialog player={proxyFor.player} next={proxyFor.basePrice} purse={user?.purse ?? 0} onClose={() => setProxyFor(null)} onSave={(max) => { setProxyFor(null); act({ type: 'proxy', playerId: proxyFor.player.id, max }, d.auction.version); }} />
      )}
    </Card>
  );
}

function AuctionSummary({ d }: { d: any }) {
  const a = d.auction;
  const user = d.clubs.find((c: any) => c.isUser);
  return (
    <div className="space-y-5">
      <PageHeader title={`${a.leagueName} auction — complete`} subtitle={<Cascade cascade={d.cascade} />} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Players sold" value={a.recent.filter((r: any) => r.status === 'sold').length + '+'} />
        {user && <Stat label="Your squad" value={`${user.squad}/${d.rules.maxSquad}`} sub={`${user.overseas} overseas`} />}
        {user && <Stat label="Purse remaining" value={cr(user.purse)} />}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Final lots" pad={false}>
          <ul className="max-h-96 overflow-y-auto">
            {a.recent.map((r: any) => (
              <li key={r.lotId} className="flex justify-between border-b border-obsidian-800 px-4 py-2 text-sm"><span>{r.name}</span><span className="num text-xs">{r.status === 'sold' ? `${r.soldTo} · ${cr(r.price)}` : 'unsold'}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="How the AI spent">
          <ul className="max-h-96 space-y-2 overflow-y-auto text-xs">{a.notes.map((n: any, i: number) => <li key={i}><b>{n.club}</b> on {n.player}: <span className="text-ink-muted">{n.reason}</span></li>)}</ul>
        </Card>
      </div>
      <p className="text-sm text-ink-muted">{d.phase === 'preseason' ? 'Finalise your squad (Squad, Transfers) and press “Start season” in the top bar.' : ''}</p>
    </div>
  );
}
