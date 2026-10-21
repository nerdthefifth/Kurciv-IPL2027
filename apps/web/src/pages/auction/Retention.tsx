import { useState } from 'react';
import { ROLE_LABEL, cr, useApi } from '../../lib/api';
import { useCareer } from '../../lib/context';
import { ConditionBadges, OvrChip, PlayerName } from '../../components/player';
import { PlayerPortrait } from '../../components/media';
import { Icon } from '../../components/icons';
import { Async, Badge, Confirm, Meter, PageHeader } from '../../components/ui';

/** The retention ceremony: choose the core, see the cost to the purse, then release everyone else. */
export function RetentionCeremony() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/retentions`, [career.tick]);
  const [sel, setSel] = useState<string[] | null>(null);
  const [commit, setCommit] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Async state={state}>
      {(d) => {
        const chosen: string[] = sel ?? d.chosen;
        const toggle = (id: string) => setSel(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
        // Same slab rule as the engine: the most valuable capped retention takes the first slab.
        const picked = d.squad.filter((p: any) => chosen.includes(p.id)).sort((a: any, b: any) => b.marketValue - a.marketValue);
        let capped = 0;
        const cost: Record<string, number> = {};
        for (const p of picked) cost[p.id] = p.capped ? d.slabs[Math.min(capped++, d.slabs.length - 1)] : d.uncappedCost;
        const total = Object.values(cost).reduce((a, b) => a + b, 0);
        const remaining = d.purse - total;
        const changed = JSON.stringify([...chosen].sort()) !== JSON.stringify([...d.chosen].sort());
        const roles = { BAT: 0, WK: 0, AR: 0, BOWL: 0 } as Record<string, number>;
        for (const p of picked) roles[p.role]++;
        const overseas = picked.filter((p: any) => p.overseas).length;
        const rules = career.overview.data?.club.rules;
        const releasing = d.squad.filter((p: any) => !chosen.includes(p.id)).sort((a: any, b: any) => b.ovr - a.ovr);
        const sorted = [...d.squad].sort((a: any, b: any) => b.marketValue - a.marketValue);

        const save = async () => {
          if (!changed) return true;
          const r = await career.mutate('/retentions', { playerIds: chosen }, { quiet: true });
          if (r) setSel(null);
          return !!r;
        };

        return (
          <div className="space-y-6">
            <PageHeader kicker="Retention ceremony" title="Who do you keep?"
              subtitle={`Retain up to ${d.maxRetentions} players. Each retention is charged against your ${cr(d.purse)} auction purse; everyone else returns to the auction pool.`}
              actions={
                <>
                  <button className="btn-ghost" disabled={!changed || busy} onClick={save}>Save choices</button>
                  <button className="btn-primary" disabled={chosen.length > d.maxRetentions || remaining < 0 || busy} onClick={() => setCommit(true)}>Commit & open the auction <Icon name="chevronRight" size={16} /></button>
                </>
              } />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {sorted.map((p: any) => {
                  const on = chosen.includes(p.id);
                  const c = cost[p.id];
                  const opp = on ? p.valueToClub - c : null;
                  const full = !on && chosen.length >= d.maxRetentions;
                  return (
                    <article key={p.id} className={`card relative flex flex-col gap-3 p-4 transition-colors ${on ? 'border-lime ring-1 ring-lime/40' : ''}`}>
                      <div className="flex items-start gap-3">
                        <PlayerPortrait player={p} size={56} />
                        <div className="min-w-0 flex-1">
                          <PlayerName p={p} className="block truncate" />
                          <div className="text-xs text-ink-muted">{ROLE_LABEL[p.role]} · {p.age} · {p.countryName}</div>
                          <div className="mt-1 flex flex-wrap gap-1">{p.capped ? <Badge tone="muted">Capped</Badge> : <Badge tone="info">Uncapped</Badge>}<ConditionBadges p={p} /></div>
                        </div>
                        <OvrChip p={p} />
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-ink-faint">Fair value</dt><dd className="num text-sm">{cr(p.valueToClub)}</dd></div>
                        <div><dt className="text-ink-faint">Retain for</dt><dd className="num text-sm">{on ? cr(c) : p.capped ? 'slab' : cr(d.uncappedCost)}</dd></div>
                        <div><dt className="text-ink-faint">Value</dt><dd className={`num text-sm ${opp === null ? 'text-ink-faint' : opp >= 0 ? 'text-lime' : 'text-danger'}`}>{opp === null ? '—' : `${opp >= 0 ? '+' : ''}${opp.toFixed(2)}`}</dd></div>
                      </dl>
                      <button className={on ? 'btn-primary' : 'btn-ghost'} aria-pressed={on} disabled={full} onClick={() => toggle(p.id)}>
                        {on ? <><Icon name="check" size={16} /> Retained</> : full ? 'Retention slots full' : 'Retain'}
                      </button>
                    </article>
                  );
                })}
              </div>

              <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                <section className="card p-5">
                  <h2 className="h-section">Impact</h2>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="label">Slots used</dt><dd className="num text-2xl">{chosen.length}<span className="text-sm text-ink-faint">/{d.maxRetentions}</span></dd></div>
                    <div><dt className="label">Retention spend</dt><dd className="num text-2xl">{cr(total)}</dd></div>
                    <div className="col-span-2"><dt className="label">Purse entering the auction</dt><dd className={`num text-3xl font-semibold ${remaining < 0 ? 'text-danger' : 'text-lime'}`}>{cr(remaining)}</dd></div>
                  </dl>
                  <div className="mt-3"><Meter label="Purse kept for the auction" display={`${Math.max(0, Math.round((remaining / d.purse) * 100))}%`} value={Math.max(0, (remaining / d.purse) * 100)} /></div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    {Object.entries(roles).map(([r, n]) => <div key={r} className="rounded-lg bg-obsidian-850 py-2"><div className="num text-lg">{n}</div><div className="text-ink-faint">{r}</div></div>)}
                  </div>
                  {rules && <p className="mt-3 text-xs text-ink-muted">Overseas retained: <b className="text-ink">{overseas}</b> of {rules.maxOverseas} allowed in the squad.</p>}
                  <p className="mt-3 text-xs text-ink-faint">Capped retentions cost {d.slabs.map((s: number) => cr(s)).join(' → ')} in order of value; uncapped players cost {cr(d.uncappedCost)}. “Value” compares fair auction value with the retention price — negative means you might buy the player back for less, if you win the bidding.</p>
                </section>
              </aside>
            </div>

            <Confirm open={commit} title="Commit retentions?" confirmLabel="Commit and release"
              body={
                <div className="space-y-2">
                  <p>You keep <b>{chosen.length}</b> player{chosen.length === 1 ? '' : 's'} for <b>{cr(total)}</b> and enter the auction with <b>{cr(remaining)}</b>.</p>
                  {releasing.length > 0 && <p>Released to the pool: {releasing.slice(0, 6).map((p: any) => p.name).join(', ')}{releasing.length > 6 ? ` and ${releasing.length - 6} more` : ''}. Other franchises can buy them.</p>}
                  <p className="text-ink-muted">This cannot be undone. Higher-tier auctions run first, then your auction room opens.</p>
                </div>
              }
              onClose={() => setCommit(false)}
              onConfirm={async () => {
                setCommit(false);
                setBusy(true);
                if (await save()) await career.mutate('/continue', { mode: 'next' }, { success: 'Retentions committed. The auction cascade has begun.' });
                setBusy(false);
              }} />
          </div>
        );
      }}
    </Async>
  );
}
