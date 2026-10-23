import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, relativeTime, useApi } from '../lib/api';
import { useCareer, useSaveStatus, useStorageMode, useToast } from '../lib/context';
import { usePrefs } from '../lib/prefs';
import { downloadPackage, formatBytes } from '../lib/files';
import { clearImageCache, imageCredits, type ImageEntry } from '../lib/images';
import { Toggle } from './Home';
import { Card, Confirm, Modal, PageHeader, Segmented } from '../components/ui';

export function SettingsPage() {
  const career = useCareer();
  const toast = useToast();
  const nav = useNavigate();
  const { prefs, set } = usePrefs();
  const save = useSaveStatus(career.id);
  const storageMode = useStorageMode();
  const storage = useApi<{ estimate: { usage: number; quota: number } | null }>('/storage');
  const backups = useApi<{ backups: any[] }>(`/careers/${career.id}/backups`, [career.tick]);
  const o = career.overview.data;
  const [del, setDel] = useState(false);
  const [credits, setCredits] = useState<ImageEntry[] | null>(null);
  const [exporting, setExporting] = useState(false);
  if (!o) return null;
  const setCareer = (patch: Partial<typeof o.settings>) => career.mutate('/settings', { ...o.settings, ...patch }, { success: 'Saved.' });

  const exportNow = async () => {
    setExporting(true);
    try {
      const pkg = await api(`/careers/${career.id}/export`);
      const name = await downloadPackage(pkg, `${o.club.name}-season-${o.season}`);
      toast.push('ok', `Exported ${name}.`);
    } catch (e) {
      toast.push('error', (e as Error).message);
    }
    setExporting(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader kicker="Save & Settings" title="Your game, your device" subtitle="No account, no cloud. Careers live in this browser; preferences apply to every career on this device." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="This career">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="label">Save status</dt><dd>{storageMode.mode === 'memory' ? <span className="text-warn">Not persisted (storage blocked)</span> : save?.state === 'error' ? <span className="text-danger">{save.message}</span> : save ? `Saved locally ${relativeTime(save.at)}` : 'Saved locally'}</dd></div>
            <div><dt className="label">Storage used</dt><dd>{storage.data?.estimate ? `${formatBytes(storage.data.estimate.usage)} of ${formatBytes(storage.data.estimate.quota)}` : '—'}</dd></div>
            <div><dt className="label">Difficulty</dt><dd className="capitalize">{o.difficulty}</dd></div>
            <div><dt className="label">Manager</dt><dd>{o.managerName}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={exporting} onClick={exportNow}>{exporting ? 'Exporting…' : 'Export backup'}</button>
            <button className="btn-ghost" onClick={() => nav('/saves')}>All save slots</button>
            <button className="btn-danger" onClick={() => setDel(true)}>Delete career</button>
          </div>
          <div className="label mb-1 mt-5">Restore points</div>
          {backups.data?.backups.length ? (
            <ul className="space-y-1 text-sm text-ink-muted">{backups.data.backups.map((b) => <li key={b.id}>{b.label} · {new Date(b.createdAt).toLocaleString()}</li>)}</ul>
          ) : <p className="text-sm text-ink-muted">Created automatically at milestones (end of season, auction complete). Restore them from the save slots screen.</p>}
        </Card>

        <Card title="Gameplay">
          <div className="space-y-5">
            <Toggle label="Auto-play my matches" hint="Continue simulates your fixtures with the assistant instead of stopping on match day." value={o.settings.autoPlayUserMatches} onChange={(v) => setCareer({ autoPlayUserMatches: v })} />
            <div>
              <div className="label mb-2">Default auction pace</div>
              <Segmented label="Auction speed" value={prefs.auctionSpeed} onChange={(v) => set({ auctionSpeed: v })} options={[{ id: 1, label: '1× (real time)' }, { id: 2, label: '2×' }, { id: 4, label: '4×' }]} />
            </div>
            <div>
              <div className="label mb-2">Confirm large bids</div>
              <Segmented label="Large bid confirmation" value={prefs.largeBidConfirm ?? 0} onChange={(v) => set({ largeBidConfirm: v === 0 ? null : v })}
                options={[{ id: 0, label: 'Never' }, { id: 5, label: '≥ ₹5 Cr' }, { id: 10, label: '≥ ₹10 Cr' }, { id: 15, label: '≥ ₹15 Cr' }]} />
            </div>
          </div>
        </Card>

        <Card title="Look & sound">
          <div className="space-y-5">
            <div>
              <div className="label mb-2">Theme</div>
              <Segmented label="Theme" value={prefs.theme} onChange={(theme) => set({ theme })} options={[{ id: 'light', label: 'Cream & Burgundy' }, { id: 'dark', label: 'Smoked Wine' }, { id: 'system', label: 'System' }]} />
            </div>
            <Toggle label="Sound effects" hint="Gavel, bids, wickets and boundaries." value={prefs.sound} onChange={(sound) => set({ sound })} />
            <Toggle label="Animations" hint="Off reduces motion everywhere. Your system's reduced-motion setting is always respected." value={prefs.animations}
              onChange={(animations) => { set({ animations }); setCareer({ reducedMotion: !animations }); }} />
          </div>
        </Card>

        <Card title="Logos & photos">
          <div className="space-y-4 text-sm">
            <Toggle label="Show real logos and player photos" hint="Fetched on demand and cached on this device. Off uses original crests and silhouettes." value={prefs.images} onChange={(images) => set({ images })} />
            <p className="text-ink-muted">Club badges come from TheSportsDB; player photographs from Wikimedia Commons (licence-checked, credited) with TheSportsDB cut-outs as a fallback. Logos are trademarks of their owners, shown for identification in a non-commercial fan game.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={async () => setCredits(await imageCredits())}>Image credits</button>
              <button className="btn-quiet" onClick={async () => { await clearImageCache(); toast.push('ok', 'Image cache cleared. Images will be fetched again as needed.'); }}>Clear image cache</button>
            </div>
          </div>
        </Card>

        <Card title="Data & honesty" className="lg:col-span-2">
          <ul className="space-y-2 text-sm text-ink-muted">
            <li>Real player identities (name, country, batting hand, bowling style, role) are public facts. <b className="text-ink">Ratings and ages are Kurciv estimates</b>, not official data.</li>
            <li>No real statistics are imported: every number in a player's record was produced in this career by the ball-by-ball simulation.</li>
            <li>Players marked <b className="text-ink">Gen</b> are generated and are not real people. Coaches are fictional.</li>
            <li>Simulation only — no wagering, and results are not predictions of real cricket.</li>
            <li>Keyboard: <b className="text-ink">B</b> bid, <b className="text-ink">P</b> pass, <b className="text-ink">Space</b> pause in the auction room; Space / O / K step a live match.</li>
          </ul>
        </Card>
      </div>

      <Modal open={!!credits} title="Image credits" onClose={() => setCredits(null)} wide>
        {credits && (credits.length ? (
          <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto text-sm">
            {credits.map((c) => (
              <li key={c.key} className="flex flex-wrap justify-between gap-2 border-b border-obsidian-800 pb-1.5">
                <span>{c.attribution ?? c.key}</span>
                <span className="text-xs text-ink-muted">{c.source}{c.licence ? ` · ${c.licence}` : ''}{c.sourceUrl && <> · <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">source</a></>}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-muted">No images cached yet.</p>)}
      </Modal>

      <Confirm open={del} danger title="Delete this career?" confirmLabel="Delete permanently"
        body="Every season, match record and history entry for this save will be removed from this device. Export a backup first if you might want it back."
        onClose={() => setDel(false)}
        onConfirm={async () => {
          try {
            await api(`/careers/${career.id}`, { method: 'DELETE' });
            nav('/saves');
          } catch (e) {
            toast.push('error', (e as Error).message);
          }
        }} />
      <StorageRefresh reload={storage.reload} />
    </div>
  );
}

/** Keeps the storage estimate current after saves. */
function StorageRefresh({ reload }: { reload: () => void }) {
  const career = useCareer();
  useEffect(() => {
    void reload();
  }, [career.tick, reload]);
  return null;
}
