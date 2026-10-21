import { useMemo, useState } from 'react';
import { cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, DataTable, PageHeader, Tabs } from '../components/ui';
import { ConditionBadges, OvrChip, PlayerName, RoleBadge } from '../components/player';

export function TransfersPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/transfers`, [career.tick]);
  const [tab, setTab] = useState<'free' | 'ledger'>('free');
  const [role, setRole] = useState('');
  return (
    <Async state={state}>
      {(d) => {
        const fa = d.freeAgents.filter((p: any) => !role || p.role === role);
        return (
          <div className="space-y-5">
            <PageHeader
              title="Transfers"
              subtitle={<>Window: <Badge tone={d.window === 'open' ? 'lime' : d.window === 'replacements' ? 'info' : 'muted'}>{d.window === 'open' ? 'open (pre-season)' : d.window === 'replacements' ? 'replacement signings only' : 'closed'}</Badge> · squad {d.squadSize}/{d.rules.maxSquad} · purse {cr(d.purse)}</>}
              actions={d.window === 'open' && d.squadSize < d.rules.minSquad ? <button className="btn-primary" onClick={() => career.mutate('/transfers/autofill', {}, { success: 'Squad filled to the minimum.' })}>Fill to minimum ({d.rules.minSquad})</button> : undefined}
            />
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'free', label: 'Free agents' }, { id: 'ledger', label: 'Transfer ledger' }]} />
            {tab === 'free' && (
              <Card pad={false} title={<select aria-label="Role filter" className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option><option value="BAT">Batters</option><option value="WK">Wicketkeepers</option><option value="AR">All-rounders</option><option value="BOWL">Bowlers</option></select>}>
                <DataTable<any>
                  rows={fa}
                  rowKey={(p) => p.id}
                  initialSort={{ key: 'ovr', dir: -1 }}
                  columns={[
                    { key: 'n', label: 'Player', render: (p) => <span className="flex items-center gap-2"><PlayerName p={p} /><ConditionBadges p={p} /></span>, sort: (p) => p.name },
                    { key: 'r', label: 'Role', render: (p) => <RoleBadge role={p.role} />, sort: (p) => p.role },
                    { key: 'c', label: 'Country', render: (p) => p.country, sort: (p) => p.country },
                    { key: 'a', label: 'Age', render: (p) => p.age, sort: (p) => p.age },
                    { key: 'ovr', label: 'Ovr', render: (p) => <OvrChip p={p} />, sort: (p) => p.ovr },
                    { key: 'ask', label: 'Asking', render: (p) => <span className="num">{cr(p.asking)}</span>, sort: (p) => p.asking ?? 0 },
                    { key: 'go', label: '', render: (p) => <button className="btn-ghost px-2 py-1 text-xs" disabled={d.window === 'closed'} onClick={(e) => { e.stopPropagation(); career.mutate('/transfers/sign', { playerId: p.id }, { success: `${p.name} signed.` }); }}>Sign</button> },
                  ]}
                />
                <p className="p-4 text-xs text-ink-faint">Only players eligible to register in your league are listed. Every signing is checked against squad size, overseas and per-country limits, purse and reserve.</p>
              </Card>
            )}
            {tab === 'ledger' && <Ledger rows={d.ledger} />}
          </div>
        );
      }}
    </Async>
  );
}

function Ledger({ rows }: { rows: any[] }) {
  const [kind, setKind] = useState('');
  const list = useMemo(() => rows.filter((r) => !kind || r.kind === kind), [rows, kind]);
  return (
    <Card pad={false} title={<select aria-label="Transaction type" className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All transactions</option>{['auction', 'retention', 'release', 'replacement', 'free-agent', 'youth-promotion', 'retirement'].map((k) => <option key={k}>{k}</option>)}</select>}>
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="table">
          <thead><tr><th>Season</th><th>Player</th><th>Type</th><th>From</th><th>To</th><th className="text-right">Fee</th></tr></thead>
          <tbody>{list.map((r) => <tr key={r.id}><td className="num">{r.season}</td><td>{r.player}</td><td><Badge tone="muted">{r.kind}</Badge></td><td>{r.from}</td><td>{r.to}</td><td className="num text-right">{r.fee ? cr(r.fee) : '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="p-4 text-xs text-ink-faint">Immutable ledger: every auction sale, retention, release, signing and retirement in the world is recorded here.</p>
    </Card>
  );
}
