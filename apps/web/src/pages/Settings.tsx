import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Card, Confirm, PageHeader } from '../components/ui';

export function SettingsPage() {
  const career = useCareer();
  const toast = useToast();
  const nav = useNavigate();
  const o = career.overview.data;
  const [del, setDel] = useState(false);
  if (!o) return null;
  const set = (patch: Partial<typeof o.settings>) => career.mutate('/settings', { ...o.settings, ...patch }, { success: 'Settings saved.' });
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Gameplay">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-[#c6ff1a]" checked={o.settings.autoPlayUserMatches} onChange={(e) => set({ autoPlayUserMatches: e.target.checked })} />
            <span><b>Auto-play my matches</b><span className="block text-ink-muted">Continue will simulate your fixtures with the assistant instead of stopping at each match day.</span></span>
          </label>
          <p className="mt-4 text-sm text-ink-muted">Difficulty: <b className="text-ink capitalize">{o.difficulty}</b>. It changes how well rival captains read the game, never player abilities.</p>
        </Card>
        <Card title="Accessibility">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-[#c6ff1a]" checked={o.settings.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} />
            <span><b>Reduce motion</b><span className="block text-ink-muted">Turns off wicket and boundary animations. Your system’s reduced-motion preference is always respected.</span></span>
          </label>
          <p className="mt-3 text-xs text-ink-faint">Keyboard: Space / O / K step a live match; B / P bid and pass in the auction; arrow keys move a focused fielder.</p>
        </Card>
        <Card title="Data, sources & licensing" className="lg:col-span-2">
          <ul className="space-y-2 text-sm text-ink-muted">
            <li>▸ <b className="text-ink">Real player identities</b> (names, countries, batting hand, bowling style, role) are curated public facts. <b className="text-ink">Ratings and ages are Kurciv editorial estimates</b>, not official data.</li>
            <li>▸ <b className="text-ink">No real statistics are imported.</b> Every number in a player’s record was produced in this career by the simulation.</li>
            <li>▸ Players marked <b className="text-ink">Gen</b> are generated and not real people. Coaches are fictional. Club names other than the IPL itself are fictional.</li>
            <li>▸ Portraits: no image provider is configured, so the game uses silhouettes. See docs/DATA_SOURCES.md for adding licensed images.</li>
            <li>▸ Simulation only — no wagering, and results are not predictions of real cricket.</li>
          </ul>
        </Card>
        <Card title="Save slot" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => nav('/')}>Switch career</button>
            <button className="btn-danger" onClick={() => setDel(true)}>Delete this career</button>
          </div>
        </Card>
      </div>
      <Confirm open={del} danger title="Delete this career?" body="This permanently removes every season, match record and history entry for this save." confirmLabel="Delete forever" onClose={() => setDel(false)} onConfirm={async () => {
        try {
          await api(`/careers/${career.id}`, { method: 'DELETE' });
          nav('/');
        } catch (e) {
          toast.push('error', (e as Error).message);
        }
      }} />
    </div>
  );
}
