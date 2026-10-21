import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PHASE_LABEL, api, relativeTime, useApi } from '../lib/api';
import { useStorageMode, useToast } from '../lib/context';
import { downloadPackage, formatBytes, readPackageFile } from '../lib/files';
import { ClubCrest } from '../components/media';
import { Icon } from '../components/icons';
import { Async, Badge, Confirm, Empty, Modal, PageHeader } from '../components/ui';
import { ordinal } from './Home';

type Staged = { pkg: unknown; fileName: string; check: { ok: boolean; errors: string[]; warnings: string[]; summary: any } };

export function SavesPage() {
  const state = useApi<{ careers: any[] }>('/careers');
  const storage = useApi<{ mode: string; estimate: { usage: number; quota: number } | null }>('/storage');
  const storageMode = useStorageMode();
  const toast = useToast();
  const nav = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<any>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [backups, setBackups] = useState<any>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [importing, setImporting] = useState(false);

  const reload = () => (state.reload(), storage.reload());

  const exportCareer = async (c: any) => {
    setBusy(c.id);
    try {
      const pkg = await api(`/careers/${c.id}/export`);
      const name = await downloadPackage(pkg, `${c.name}-season-${c.season}`);
      toast.push('ok', `Exported ${name}. Keep it somewhere safe.`);
    } catch (e) {
      toast.push('error', (e as Error).message);
    }
    setBusy(null);
  };

  const duplicate = async (c: any) => {
    setBusy(c.id);
    try {
      const r = await api<{ name: string }>(`/careers/${c.id}/duplicate`, { body: {} });
      toast.push('ok', `Created “${r.name}”.`);
      reload();
    } catch (e) {
      toast.push('error', (e as Error).message);
    }
    setBusy(null);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const read = await readPackageFile(file);
    if (fileInput.current) fileInput.current.value = '';
    if (read.error !== undefined) {
      setStaged({ pkg: null, fileName: file.name, check: { ok: false, errors: [read.error], warnings: [], summary: null } });
      return;
    }
    try {
      const check = await api<Staged['check']>('/import/check', { body: { package: read.pkg } });
      setStaged({ pkg: read.pkg, fileName: file.name, check });
    } catch (e) {
      setStaged({ pkg: null, fileName: file.name, check: { ok: false, errors: [(e as Error).message], warnings: [], summary: null } });
    }
  };

  const confirmImport = async () => {
    if (!staged?.pkg) return;
    setImporting(true);
    try {
      const r = await api<{ id: string; name: string }>('/import', { body: { package: staged.pkg } });
      toast.push('ok', `Imported “${r.name}” as a new save. Your other careers were not changed.`, { label: 'Open', run: () => nav(`/c/${r.id}`) });
      setStaged(null);
      reload();
    } catch (e) {
      toast.push('error', (e as Error).message);
    }
    setImporting(false);
  };

  return (
    <div className="grain min-h-screen bg-obsidian-950">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <Link to="/" className="btn-quiet mb-4 -ml-2 inline-flex"><Icon name="chevronLeft" /> Title screen</Link>
        <PageHeader
          kicker="Save slots"
          title="Your careers"
          subtitle="Every career lives on this device, in this browser. Nothing is uploaded."
          actions={
            <>
              <button className="btn-ghost" onClick={() => fileInput.current?.click()}><Icon name="upload" /> Import backup</button>
              <Link to="/new" className="btn-primary"><Icon name="plus" /> New career</Link>
            </>
          }
        />
        <input ref={fileInput} type="file" accept=".kurciv,.json,application/json,application/gzip" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Choose a career backup file" />

        {storageMode.mode === 'memory' && (
          <p className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            <b>Local storage is unavailable</b> ({storageMode.reason}). Careers exist only until this tab closes — export anything you want to keep.
          </p>
        )}

        <Async state={state}>
          {(d) => {
            const list = [...d.careers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            if (!list.length) {
              return (
                <Empty title="No careers on this device yet" action={<Link to="/new" className="btn-primary">Create your first career</Link>}>
                  Start a new career, or import a <code>.kurciv</code> backup from another device.
                </Empty>
              );
            }
            return (
              <ul className="grid gap-3">
                {list.map((c) => (
                  <li key={c.id} className="card flex flex-wrap items-center gap-4 p-4">
                    <ClubCrest club={{ id: c.clubId, name: c.clubName, shortName: c.clubShort, colors: c.colors, leagueId: c.leagueId }} size={52} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{c.name}</h2>
                        <Badge tone="muted">{PHASE_LABEL[c.phase] ?? c.phase}</Badge>
                      </div>
                      <div className="text-sm text-ink-muted">
                        {c.clubName} · {c.managerName} · Season {c.season}
                        {c.position ? ` · ${c.position}${ordinal(c.position)} in ${c.leagueName}` : ` · ${c.leagueName}`}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-faint">
                        {c.nextFixture ? `Next: ${c.nextFixture} · ` : ''}Last played {relativeTime(c.updatedAt)} · v{c.gameVersion}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button className="btn-primary" onClick={() => nav(`/c/${c.id}`)}>Continue</button>
                      <IconButton icon="edit" label="Rename" onClick={() => setRename({ id: c.id, name: c.name })} />
                      <IconButton icon="copy" label="Duplicate" disabled={busy === c.id} onClick={() => duplicate(c)} />
                      <IconButton icon="download" label="Export backup" disabled={busy === c.id} onClick={() => exportCareer(c)} />
                      <IconButton icon="history" label="Restore points" onClick={() => setBackups(c)} />
                      <IconButton icon="trash" label="Delete" onClick={() => setDel(c)} />
                    </div>
                  </li>
                ))}
              </ul>
            );
          }}
        </Async>

        <section className="mt-8 grid gap-4 text-sm text-ink-muted md:grid-cols-2">
          <div className="panel p-4">
            <div className="label mb-1">Storage on this device</div>
            {storage.data?.estimate ? (
              <p>Using {formatBytes(storage.data.estimate.usage)} of about {formatBytes(storage.data.estimate.quota)} available to this site.</p>
            ) : <p>Your browser does not report storage usage.</p>}
          </div>
          <div className="panel p-4">
            <div className="label mb-1">Keeping your careers safe</div>
            <p>Clearing this site’s data, or using a different browser or device, means these saves won’t be there. Export a backup to move or protect a career.</p>
          </div>
        </section>
      </div>

      <Confirm open={!!del} danger title="Delete this career?" confirmLabel="Delete permanently"
        body={del && <>“{del.name}” ({del.clubName}, season {del.season}) and all of its match records will be removed from this device. This cannot be undone — export a backup first if you might want it back.</>}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          try {
            await api(`/careers/${del.id}`, { method: 'DELETE' });
            toast.push('ok', 'Career deleted.');
          } catch (e) {
            toast.push('error', (e as Error).message);
          }
          setDel(null);
          reload();
        }} />

      <Modal open={!!rename} title="Rename career" onClose={() => setRename(null)}>
        {rename && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/careers/${rename.id}`, { method: 'PATCH', body: { name: rename.name } });
              setRename(null);
              reload();
            } catch (err) {
              toast.push('error', (err as Error).message);
            }
          }}>
            <label className="block">
              <span className="label">Name</span>
              <input className="input mt-1 w-full" autoFocus maxLength={60} value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setRename(null)}>Cancel</button><button className="btn-primary" disabled={!rename.name.trim()}>Save</button></div>
          </form>
        )}
      </Modal>

      {backups && <BackupsModal career={backups} onClose={() => setBackups(null)} onRestored={reload} />}

      <Modal open={!!staged} title="Import a career" onClose={() => setStaged(null)}>
        {staged && (
          <div className="space-y-4 text-sm">
            <p className="text-ink-muted">File: <b className="text-ink">{staged.fileName}</b></p>
            {staged.check.summary && (
              <dl className="panel grid grid-cols-2 gap-y-1.5 p-4">
                <dt className="text-ink-muted">Manager</dt><dd>{staged.check.summary.managerName}</dd>
                <dt className="text-ink-muted">Club</dt><dd>{staged.check.summary.clubName}</dd>
                <dt className="text-ink-muted">Season</dt><dd>{staged.check.summary.season} · {PHASE_LABEL[staged.check.summary.phase] ?? staged.check.summary.phase}</dd>
                <dt className="text-ink-muted">Players / matches</dt><dd>{staged.check.summary.players} / {staged.check.summary.matches}</dd>
                <dt className="text-ink-muted">Exported</dt><dd>{new Date(staged.check.summary.exportedAt).toLocaleString()} (v{staged.check.summary.gameVersion})</dd>
              </dl>
            )}
            {staged.check.errors.length > 0 && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3">
                <b>This file can’t be imported.</b>
                <ul className="mt-1 list-disc pl-5">{staged.check.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {staged.check.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{staged.check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            {staged.check.ok && <p className="text-ink-muted">It will be added as a new save. None of your existing careers will be changed or overwritten.</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setStaged(null)}>Cancel</button>
              <button className="btn-primary" disabled={!staged.check.ok || importing} onClick={confirmImport}>{importing ? 'Importing…' : 'Import as new save'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function IconButton({ icon, label, onClick, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn-quiet px-2.5" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}

function BackupsModal({ career, onClose, onRestored }: { career: any; onClose: () => void; onRestored: () => void }) {
  const state = useApi<{ backups: any[] }>(`/careers/${career.id}/backups`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={`Restore points — ${career.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">Kurciv keeps the last three milestone snapshots (end of season, auction complete). Restoring creates a new save; this one is kept.</p>
      <Async state={state}>
        {(d) => d.backups.length ? (
          <ul className="space-y-2">
            {d.backups.map((b) => (
              <li key={b.id} className="panel flex items-center justify-between gap-3 p-3 text-sm">
                <span><b>{b.label}</b><span className="block text-xs text-ink-muted">Season {b.season} · {new Date(b.createdAt).toLocaleString()}</span></span>
                <button className="btn-ghost" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ name: string }>(`/careers/${career.id}/backups/${b.id}/restore`, { body: {} });
                    toast.push('ok', `Restored as “${r.name}”.`);
                    onRestored();
                    onClose();
                  } catch (e) {
                    toast.push('error', (e as Error).message);
                  }
                  setBusy(false);
                }}>Restore as new save</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-muted">No restore points yet. They are created at milestones.</p>}
      </Async>
    </Modal>
  );
}
