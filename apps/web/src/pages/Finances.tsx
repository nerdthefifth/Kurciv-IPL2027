import { useState } from 'react';
import { cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Confirm, PageHeader, Stat } from '../components/ui';

const FAC_TEXT: Record<string, string> = {
  training: 'Faster player development',
  youth: 'Better and more reliable academy prospects',
  medical: 'Faster recovery and rehabilitation',
  scouting: 'Narrower rating ranges on other clubs’ players',
};

export function FinancesPage() {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/finances`, [career.tick]);
  const [up, setUp] = useState<any>(null);
  return (
    <Async state={state}>
      {(d) => (
        <div className="space-y-5">
          <PageHeader title="Finances" subtitle="The auction purse is a league spending cap; cash reserves are the club’s operating money. They are tracked separately." />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Cash reserves" value={cr(d.cash)} />
            <Stat label="Auction purse" value={cr(d.purse)} />
            <Stat label="Season income" value={cr(d.income)} />
            <Stat label="Season net" value={<span className={d.net >= 0 ? 'text-lime' : 'text-danger'}>{cr(d.net)}</span>} />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="By category">
              <ul className="space-y-1 text-sm">
                {Object.entries(d.byCategory).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => (
                  <li key={k} className="flex justify-between"><span className="capitalize text-ink-muted">{k}</span><span className={`num ${v >= 0 ? 'text-lime' : ''}`}>{cr(v)}</span></li>
                ))}
              </ul>
            </Card>
            <Card title="Facilities" className="xl:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                {d.facilities.map((f: any) => (
                  <div key={f.id} className="rounded-lg border border-obsidian-700 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold capitalize">{f.id}</span>
                      <span className="num text-lime" aria-label={`Level ${f.level} of 5`}>{'■'.repeat(f.level)}<span className="text-obsidian-600">{'■'.repeat(5 - f.level)}</span></span>
                    </div>
                    <p className="text-xs text-ink-muted">{FAC_TEXT[f.id]}</p>
                    <button className="btn-ghost mt-2 w-full text-xs" disabled={f.upgradeCost === null} onClick={() => setUp(f)}>{f.upgradeCost === null ? 'Maximum level' : `Upgrade — ${cr(f.upgradeCost)}`}</button>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Board" className="xl:col-span-1">
              <div className="num text-4xl">{Math.round(d.board.confidence)}<span className="text-base text-ink-muted">/100</span></div>
              <p className="text-sm text-ink-muted">Board confidence{d.board.warnings ? ` · ${d.board.warnings} warning(s)` : ''}. Below 30 the board freezes facility spending; repeated failure ends your tenure (see the Boardroom for the exact rule), and another club offers you a new job.</p>
              <ul className="mt-3 space-y-1 text-sm">{d.board.objectives.map((o: any) => <li key={o.id}><Badge tone={o.status === 'met' ? 'lime' : o.status === 'failed' ? 'danger' : 'muted'}>{o.status}</Badge> {o.description}</li>)}</ul>
            </Card>
            <Card title="Coaching staff" className="xl:col-span-2">
              <table className="table">
                <thead><tr><th>Role</th><th>Name</th><th className="text-right">Rating</th><th className="text-right">Salary</th></tr></thead>
                <tbody>{d.coaches.map((c: any) => <tr key={c.role}><td className="capitalize">{c.role}</td><td>{c.name}</td><td className="num text-right">{c.rating}</td><td className="num text-right">{cr(c.salary)}</td></tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs text-ink-faint">Staff are fictional. The head coach improves your assistant’s in-match decisions; all coaches drive player development.</p>
            </Card>
          </div>
          <Card title="Transactions this season" pad={false}>
            <div className="max-h-96 overflow-y-auto">
              <table className="table">
                <thead><tr><th>Day</th><th>Category</th><th>Memo</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{[...d.transactions].reverse().map((t: any) => <tr key={t.id}><td className="num">{t.day}</td><td className="capitalize">{t.category}</td><td className="text-ink-muted">{t.memo}</td><td className={`num text-right ${t.amount >= 0 ? 'text-lime' : ''}`}>{cr(t.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
          {up && <Confirm open title={`Upgrade ${up.id} facility?`} body={`Costs ${cr(up.upgradeCost)} from cash reserves (currently ${cr(d.cash)}). Level ${up.level} → ${up.level + 1}.`} confirmLabel="Upgrade" onClose={() => setUp(null)} onConfirm={() => career.mutate(`/facilities/${up.id}/upgrade`, {}, { success: 'Facility upgraded.' })} />}
        </div>
      )}
    </Async>
  );
}
