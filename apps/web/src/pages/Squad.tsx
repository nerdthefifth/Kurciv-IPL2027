import { useEffect, useMemo, useState } from 'react';
import { cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, DataTable, Meter, PageHeader, type Column } from '../components/ui';
import { ConditionBadges, OvrChip, PlayerName, RoleBadge } from '../components/player';

export function SquadPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/squad`, [career.tick]);
  return (
    <Async state={state}>
      {(d) => <SquadView d={d} />}
    </Async>
  );
}

function SquadView({ d }: { d: any }) {
  const career = useCareer();
  const rules = d.club.rules;
  const [xi, setXi] = useState<string[]>(d.lineup ?? d.suggestedXI);
  useEffect(() => setXi(d.lineup ?? d.suggestedXI), [d.lineup, d.suggestedXI]);
  const byId = useMemo(() => Object.fromEntries(d.players.map((p: any) => [p.id, p])), [d.players]);
  const sel = xi.map((x) => byId[x]).filter(Boolean);
  const overseas = sel.filter((p: any) => p.overseas).length;
  const bowlers = sel.filter((p: any) => p.bowling >= 38 && p.bowlType !== 'NONE').length;
  const keeper = sel.some((p: any) => p.role === 'WK');
  const injured = sel.filter((p: any) => p.injury);
  const issues = [
    sel.length !== 11 && `Select exactly 11 (currently ${sel.length}).`,
    overseas > rules.maxOverseasInXI && `Too many overseas players (${overseas}/${rules.maxOverseasInXI}).`,
    bowlers < 5 && `Only ${bowlers} bowling options — need 5 to cover 20 overs.`,
    !keeper && 'No specialist wicketkeeper selected.',
    ...injured.map((p: any) => `${p.name} is injured.`),
  ].filter(Boolean) as string[];

  const toggle = (pid: string) => setXi((cur) => (cur.includes(pid) ? cur.filter((x) => x !== pid) : cur.length >= 11 ? cur : [...cur, pid]));
  const move = (i: number, dir: -1 | 1) => setXi((cur) => {
    const n = [...cur];
    const j = i + dir;
    if (j < 0 || j >= n.length) return n;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const cols: Column<any>[] = [
    { key: 'xi', label: 'XI', render: (p) => <input type="checkbox" aria-label={`Select ${p.name} for the XI`} className="accent-[#c6ff1a]" checked={xi.includes(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} /> },
    { key: 'name', label: 'Player', render: (p) => <span className="flex items-center gap-2"><PlayerName p={p} /> <ConditionBadges p={p} /></span>, sort: (p) => p.name },
    { key: 'role', label: 'Role', render: (p) => <RoleBadge role={p.role} />, sort: (p) => p.role },
    { key: 'age', label: 'Age', render: (p) => <span className="num">{p.age}</span>, sort: (p) => p.age },
    { key: 'ovr', label: 'Ovr', render: (p) => <OvrChip p={p} />, sort: (p) => p.ovr },
    { key: 'bat', label: 'Bat', render: (p) => <span className="num">{p.batting}</span>, sort: (p) => p.batting },
    { key: 'bowl', label: 'Bowl', render: (p) => <span className="num">{p.bowlType === 'NONE' ? '—' : p.bowling}</span>, sort: (p) => p.bowling },
    { key: 'form', label: 'Form', render: (p) => <span className={`num ${p.form > 2 ? 'text-lime' : p.form < -2 ? 'text-danger' : ''}`}>{p.form > 0 ? '+' : ''}{p.form}</span>, sort: (p) => p.form },
    { key: 'fat', label: 'Fatigue', render: (p) => <Meter value={p.fatigue} invert compact />, sort: (p) => p.fatigue },
    { key: 'mor', label: 'Morale', render: (p) => <Meter value={p.morale} compact />, sort: (p) => p.morale },
    { key: 'sal', label: 'Salary', render: (p) => <span className="num text-ink-muted">{cr(p.contract?.salary)}</span>, sort: (p) => p.contract?.salary ?? 0 },
    { key: 'season', label: 'Runs / Wkts', render: (p) => <span className="num text-ink-muted">{p.season.runs} / {p.season.wickets}</span>, sort: (p) => p.season.runs + p.season.wickets * 20 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Squad"
        subtitle={`${d.club.squadSize}/${rules.maxSquad} registered · ${d.club.overseas}/${rules.maxOverseas} overseas (max ${rules.maxPerOverseasCountry} per country) · min ${rules.minSquad}`}
      />
      {d.problems.length > 0 && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm" role="alert">
          {d.problems.map((p: string) => <p key={p}>⚠ {p}</p>)}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card title="Registered players" pad={false}>
          <DataTable rows={d.players} columns={cols} rowKey={(p) => p.id} initialSort={{ key: 'ovr', dir: -1 }} />
        </Card>
        <Card title="Playing XI & batting order">
          <ol className="space-y-1">
            {sel.map((p: any, i: number) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-obsidian-700 bg-obsidian-850 px-2 py-1.5 text-sm">
                <span className="num w-5 text-ink-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-[11px] text-ink-faint">{p.role}{p.overseas ? ' · OS' : ''}</span></span>
                <button className="btn-ghost px-1.5 py-0.5 text-xs" aria-label={`Move ${p.name} up`} onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button className="btn-ghost px-1.5 py-0.5 text-xs" aria-label={`Move ${p.name} down`} onClick={() => move(i, 1)} disabled={i === sel.length - 1}>▼</button>
                <button className="btn-ghost px-1.5 py-0.5 text-xs" aria-label={`Remove ${p.name}`} onClick={() => toggle(p.id)}>✕</button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone={overseas > rules.maxOverseasInXI ? 'danger' : 'muted'}>Overseas {overseas}/{rules.maxOverseasInXI}</Badge>
            <Badge tone={bowlers < 5 ? 'danger' : 'muted'}>Bowling options {bowlers}</Badge>
            <Badge tone={keeper ? 'muted' : 'warn'}>{keeper ? 'Keeper ✓' : 'No keeper'}</Badge>
          </div>
          {issues.length > 0 && <ul className="mt-3 space-y-1 text-xs text-warn">{issues.map((x) => <li key={x}>△ {x}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={issues.some((x) => !x.startsWith('No specialist'))} onClick={() => career.mutate('/lineup', { playerIds: xi }, { success: 'Lineup saved — used for your next match.' })}>
              Save lineup
            </button>
            <button className="btn-ghost" onClick={() => setXi(d.suggestedXI)}>Assistant’s XI</button>
            {d.lineup && <button className="btn-ghost" onClick={() => career.mutate('/lineup', { playerIds: null }, { success: 'The assistant will pick each XI.' })}>Let assistant pick</button>}
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            {d.lineup ? 'Your saved XI is used for every match until you change it.' : 'No saved lineup: the assistant picks the best fit XI each match (fatigue, form and matchups considered).'}
          </p>
        </Card>
      </div>
    </div>
  );
}
