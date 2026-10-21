import { useMemo, useState } from 'react';
import { ROLE_LABEL, cr } from '../../lib/api';
import { ClubCrestById, PlayerPortrait } from '../../components/media';
import { PlayerName, usePlayerModal } from '../../components/player';
import { Icon } from '../../components/icons';
import { Badge, Modal } from '../../components/ui';

export const PHASE_TOTAL: Record<string, number> = { PLAYER_INTRODUCTION: 1900, OPEN_FOR_BIDS: 5500, FINAL_CALL: 2500, SOLD: 3200, UNSOLD: 1500 };
export const PHASE_TEXT: Record<string, string> = {
  PREPARATION: 'Preparation', PLAYER_INTRODUCTION: 'Introducing', OPEN_FOR_BIDS: 'Open for bids', FINAL_CALL: 'Final call', SOLD: 'Sold', UNSOLD: 'Unsold',
  ACCELERATED_SELECTION: 'Accelerated round', COMPLETED: 'Complete',
};

export function Countdown({ phase, ms, paused }: { phase: string; ms: number; paused: boolean }) {
  const total = PHASE_TOTAL[phase] ?? 1;
  const frac = Math.max(0, Math.min(1, ms / total));
  const tone = phase === 'FINAL_CALL' ? 'bg-warn' : phase === 'SOLD' ? 'bg-lime' : phase === 'UNSOLD' ? 'bg-ink-faint' : 'bg-lime';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold uppercase tracking-[0.16em] ${phase === 'FINAL_CALL' ? 'text-warn' : 'text-ink-muted'}`} aria-live="polite">{paused ? 'Paused' : PHASE_TEXT[phase]}</span>
        {(phase === 'OPEN_FOR_BIDS' || phase === 'FINAL_CALL') && <span className="num text-ink-muted">{(ms / 1000).toFixed(1)}s</span>}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-obsidian-700" role="progressbar" aria-label="Time left in this phase" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <div className={`h-full rounded-full ${tone} transition-[width] duration-200 ease-linear`} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

/** Every franchise at the table: purse, slots, and whether they are in, out or leading on this lot. */
export function ClubGallery({ clubs, lot }: { clubs: any[]; lot: any | null }) {
  return (
    <ul className="space-y-1.5">
      {clubs.map((c) => {
        const leading = lot?.leaderId === c.id;
        const out = lot?.dropped?.includes(c.id);
        const active = lot?.activeBidders?.includes(c.id);
        return (
          <li key={c.id} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors ${leading ? 'border-lime bg-lime/10' : c.isUser ? 'border-obsidian-600 bg-obsidian-850' : 'border-transparent'} ${out && !leading ? 'opacity-50' : ''}`}>
            <ClubCrestById clubId={c.id} size={28} fallback={c} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{c.shortName}</span>
                {leading && <Badge tone="lime">Leading</Badge>}
                {!leading && active && <Badge tone="info">In</Badge>}
                {out && !leading && <Badge tone="muted">Out</Badge>}
              </div>
              <div className="num text-[11px] text-ink-muted">{cr(c.purse)} · {c.squad}/{c.maxSquad} · OS {c.overseas}/{c.maxOverseas}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Commentary({ lines }: { lines: any[] }) {
  return (
    <ol className="space-y-2 text-sm" aria-live="polite" aria-relevant="additions">
      {lines.map((l, i) => (
        <li key={`${l.t}-${i}`} className={`flex gap-2 ${i === 0 ? 'rise' : ''} ${l.kind === 'sold' ? 'font-semibold text-lime' : l.kind === 'unsold' ? 'text-ink-muted' : l.kind === 'call' ? 'text-warn' : l.kind === 'user' ? 'text-ink' : 'text-ink-muted'}`}>
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
          <span>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function BidHistory({ bids }: { bids: any[] }) {
  if (!bids.length) return <p className="text-sm text-ink-muted">No bids yet.</p>;
  return (
    <ol className="space-y-1 text-sm">
      {[...bids].reverse().slice(0, 12).map((b, i) => (
        <li key={b.at} className={`flex items-center justify-between gap-2 ${i === 0 ? 'font-semibold' : 'text-ink-muted'}`}>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: b.colors[0] }} aria-hidden />{b.club}{b.proxy && <span className="text-[10px] uppercase text-ink-faint">proxy</span>}</span>
          <span className="num">{cr(b.amount)}</span>
        </li>
      ))}
    </ol>
  );
}

export function StrategyPanel({ lot }: { lot: any }) {
  const s = lot.strategy;
  const players = usePlayerModal();
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="label">Market estimate</dt><dd className="num text-lg">{cr(s.estimate)}</dd></div>
        <div><dt className="label">Assistant’s limit</dt><dd className="num text-lg">{s.assistantMax > 0 ? cr(s.assistantMax) : 'Pass'}</dd></div>
        <div><dt className="label">Most you can bid</dt><dd className="num text-lg">{cr(s.maxAffordable)}</dd></div>
        <div><dt className="label">Reserve kept</dt><dd className="num text-lg">{cr(s.reserve)}</dd></div>
      </dl>
      <p className="text-ink-muted">{s.assistantReason}</p>
      <p className="text-ink-muted">{s.fit}</p>
      {s.alternatives.length > 0 && (
        <div>
          <div className="label mb-1">Similar players still to come</div>
          <ul className="space-y-1">
            {s.alternatives.map((x: any) => (
              <li key={x.playerId} className="flex items-center justify-between gap-2">
                <button className="truncate text-left hover:text-lime hover:underline" onClick={() => players.open(x.playerId)}>{x.name}</button>
                <span className="flex items-center gap-2">
                  <span className="num text-xs text-ink-muted">{x.ovr} · base {cr(x.basePrice)}</span>
                  <button className="text-xs text-ink-faint hover:text-lime" onClick={() => players.compare(lot.player.id, x.playerId)}>compare</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ProxyEditor({ player, current, onSave, onClose }: { player: { id: string; name: string }; current: number | null; onSave: (v: number | null) => void; onClose: () => void }) {
  const [v, setV] = useState(current ? String(current) : '');
  const n = Number(v);
  return (
    <Modal open title={`Proxy bid — ${player.name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), n > 0 && onSave(Math.round(n * 100) / 100))}>
        <p className="text-sm text-ink-muted">When {player.name} comes up, your proxy bids the next increment whenever you are outbid, up to this maximum. It never bids against itself, and stops if a squad rule or your reserve would be broken.</p>
        <label className="block">
          <span className="label">Maximum (₹ Cr)</span>
          <input className="input mt-1 w-full num" inputMode="decimal" autoFocus value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 6.5" />
        </label>
        <div className="flex justify-between gap-2">
          {current !== null ? <button type="button" className="btn-danger" onClick={() => onSave(null)}>Remove proxy</button> : <span />}
          <span className="flex gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!(n > 0)}>Set proxy</button></span>
        </div>
      </form>
    </Modal>
  );
}

/** The catalogue of upcoming lots, filterable, with flag and proxy controls. */
export function Queue({ queue, command, compact = false }: { queue: any[]; command: (c: any) => Promise<boolean>; compact?: boolean }) {
  const [role, setRole] = useState<string>('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [overseas, setOverseas] = useState<'' | 'os' | 'dom'>('');
  const [q, setQ] = useState('');
  const [proxyFor, setProxyFor] = useState<any>(null);
  const rows = useMemo(() => queue.filter((x) =>
    (!role || x.player.role === role) && (!onlyFlagged || x.flagged || x.proxy !== null) && (!overseas || (overseas === 'os') === x.player.overseas)
    && (!q || x.player.name.toLowerCase().includes(q.toLowerCase()))), [queue, role, onlyFlagged, overseas, q]);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-obsidian-700 p-3">
        <input className="input w-40 py-1.5 text-sm" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search upcoming players" />
        <select className="input w-auto py-1.5 text-sm" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
        </select>
        <select className="input w-auto py-1.5 text-sm" value={overseas} onChange={(e) => setOverseas(e.target.value as any)} aria-label="Filter by registration">
          <option value="">Domestic & overseas</option><option value="dom">Domestic only</option><option value="os">Overseas only</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted"><input type="checkbox" className="accent-lime" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Shortlist only</label>
        <span className="ml-auto text-xs text-ink-faint">{rows.length} of {queue.length}</span>
      </div>
      <div className={`overflow-y-auto ${compact ? 'max-h-80' : 'max-h-[560px]'}`}>
        <table className="table">
          <thead className="sticky top-0 bg-obsidian-900"><tr><th>Player</th><th className="hidden sm:table-cell">Set</th><th className="text-right">Ovr</th><th className="text-right">Base</th><th className="text-right">Watch</th></tr></thead>
          <tbody>
            {rows.slice(0, 150).map((x) => (
              <tr key={x.lotId}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <PlayerPortrait player={x.player} size={30} />
                    <span className="min-w-0">
                      <PlayerName p={x.player} className="block truncate" />
                      <span className="block text-[11px] text-ink-muted">{x.player.role} · {x.player.countryName}{x.player.overseas ? ' · OS' : ''}{x.round === 2 ? ' · round 2' : ''}</span>
                    </span>
                  </span>
                </td>
                <td className="hidden text-xs text-ink-muted sm:table-cell">{x.set}</td>
                <td className="num text-right">{x.player.ovr}</td>
                <td className="num text-right">{cr(x.basePrice)}</td>
                <td className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <button className={`rounded-md p-1.5 ${x.flagged ? 'text-lime' : 'text-ink-faint hover:text-ink'}`} title={x.flagged ? 'Remove from shortlist' : 'Add to shortlist'} aria-label={x.flagged ? `Unflag ${x.player.name}` : `Flag ${x.player.name}`} aria-pressed={x.flagged}
                      onClick={() => command({ type: 'flag', playerId: x.player.id, flagged: !x.flagged })}><Icon name="flag" size={16} /></button>
                    <button className={`rounded-md px-1.5 py-1 text-xs ${x.proxy !== null ? 'bg-lime/15 text-lime' : 'text-ink-faint hover:text-ink'}`} onClick={() => setProxyFor(x)} aria-label={`Proxy bid for ${x.player.name}`}>
                      {x.proxy !== null ? cr(x.proxy) : 'Proxy'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-ink-muted">No upcoming players match these filters.</p>}
      </div>
      {proxyFor && (
        <ProxyEditor player={proxyFor.player} current={proxyFor.proxy}
          onClose={() => setProxyFor(null)}
          onSave={async (v) => { if (await command({ type: 'proxy', playerId: proxyFor.player.id, max: v })) setProxyFor(null); }} />
      )}
    </div>
  );
}
