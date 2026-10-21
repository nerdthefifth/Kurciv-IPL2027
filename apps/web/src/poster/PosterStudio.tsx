import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../lib/context';
import { Modal, Segmented } from '../components/ui';
import { Toggle } from '../pages/Home';
import { Icon } from '../components/icons';
import {
  DEFAULT_OPTIONS, FORMATS, TEMPLATES, downloadBlob, ensureFonts, exportPng, loadPosterAssets, posterData, posterFilename, renderPoster,
  type PosterAssets, type PosterFormat, type PosterOptions, type PosterTemplate,
} from './poster';

const KEY = 'kurciv.poster.v1';

function savedOptions(): PosterOptions {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

/** Match Poster Studio: choose a layout, preview it exactly, export a real PNG. */
export function PosterStudio({ report, open, onClose }: { report: any; open: boolean; onClose: () => void }) {
  const [opts, setOpts] = useState<PosterOptions>(savedOptions);
  const [assets, setAssets] = useState<PosterAssets | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const toast = useToast();
  const data = useMemo(() => posterData(report), [report]);
  const set = (p: Partial<PosterOptions>) => setOpts((o) => {
    const n = { ...o, ...p };
    try {
      localStorage.setItem(KEY, JSON.stringify(n));
    } catch {
      // preferences simply don't persist
    }
    return n;
  });

  // Fonts and images are loaded before anything is drawn; only reload when the asset toggles change.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAssets(null);
    (async () => {
      await ensureFonts();
      const a = await loadPosterAssets(data, opts);
      if (alive) setAssets(a);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, opts.crests, opts.portraits]);

  // Preview: the exact export canvas, drawn at a reduced backing scale for speed.
  useEffect(() => {
    if (!open || !assets || !canvas.current) return;
    const f = FORMATS[opts.format];
    const scale = Math.min(1, 900 / Math.max(f.w, f.h)) * Math.min(2, window.devicePixelRatio || 1);
    renderPoster(canvas.current, data, assets, opts, Math.min(1, scale));
  }, [open, assets, data, opts]);

  const doExport = async (scale = 1) => {
    if (!assets) return;
    setError(null);
    setBusy(scale === 1 ? 'Rendering full resolution…' : 'Rendering at reduced size…');
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the progress message paint
      const blob = await exportPng(data, assets, opts, scale);
      setBusy('Saving…');
      const name = posterFilename(report, opts.format).replace(/\.png$/, scale === 1 ? '.png' : '-small.png');
      downloadBlob(blob, name);
      toast.push('ok', `Saved ${name} (${Math.round(FORMATS[opts.format].w * scale)} × ${Math.round(FORMATS[opts.format].h * scale)}).`);
    } catch (e) {
      setError(`The browser could not export this image (${(e as Error).message}). Try a smaller export, or print the full report instead.`);
    } finally {
      setBusy(null);
    }
  };

  const f = FORMATS[opts.format];
  const blocked = !report.validation.ok;
  return (
    <Modal open={open} title="Match Poster Studio" onClose={onClose} wide>
      {blocked ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg border border-danger/40 bg-danger/10 p-3">This match record did not pass validation, so no poster can be produced from it.</p>
          <ul className="list-disc pl-5 text-ink-muted">{report.validation.issues.map((i: string) => <li key={i}>{i}</li>)}</ul>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label="Poster options">
            <div>
              <div className="label mb-2">Template</div>
              <Segmented label="Template" value={opts.template} onChange={(template: PosterTemplate) => set({ template })} options={(Object.keys(TEMPLATES) as PosterTemplate[]).map((id) => ({ id, label: TEMPLATES[id] }))} />
            </div>
            <label className="block">
              <span className="label">Format</span>
              <select className="input mt-1 w-full" value={opts.format} onChange={(e) => set({ format: e.target.value as PosterFormat })}>
                {(Object.keys(FORMATS) as PosterFormat[]).map((id) => <option key={id} value={id}>{FORMATS[id].label}</option>)}
              </select>
            </label>
            <div>
              <div className="label mb-2">Highlights</div>
              <Segmented label="Highlights" value={opts.highlights} onChange={(highlights) => set({ highlights })} options={[{ id: 'compact', label: 'Compact' }, { id: 'extended', label: 'Extended' }]} />
            </div>
            <div>
              <div className="label mb-2">Colour</div>
              <Segmented label="Colour theme" value={opts.theme} onChange={(theme) => set({ theme })} options={[{ id: 'neutral', label: 'Kurciv' }, { id: 'team', label: 'Winning team' }]} />
            </div>
            <div className="space-y-3">
              <Toggle label="Player portrait" value={opts.portraits} onChange={(portraits) => set({ portraits })} />
              <Toggle label="Team crests" value={opts.crests} onChange={(crests) => set({ crests })} />
              <Toggle label="Venue" value={opts.showVenue} onChange={(showVenue) => set({ showVenue })} />
              <Toggle label="Date" value={opts.showDate} onChange={(showDate) => set({ showDate })} />
            </div>
            <div className="space-y-2 border-t border-obsidian-700 pt-4">
              <button type="button" className="btn-primary w-full" disabled={!assets || !!busy} onClick={() => doExport(1)}>
                <Icon name="download" size={16} /> {busy ?? `Export PNG · ${f.w} × ${f.h}`}
              </button>
              {error && (
                <>
                  <p className="text-xs text-danger" role="alert">{error}</p>
                  <button type="button" className="btn-ghost w-full" disabled={!!busy} onClick={() => doExport(0.5)}>Export at half size</button>
                  <button type="button" className="btn-quiet w-full" onClick={() => window.print()}>Print the full report</button>
                </>
              )}
              <p className="text-[11px] text-ink-faint">Rendered on this device from the stored match record. Nothing is uploaded.</p>
            </div>
          </form>
          <div className="min-w-0">
            <div className="grid place-items-center rounded-xl border border-obsidian-700 bg-obsidian-950 p-3">
              {!assets && <p className="py-24 text-sm text-ink-muted" role="status">Loading fonts and images…</p>}
              <canvas ref={canvas} className={`${assets ? '' : 'hidden'} h-auto max-h-[68vh] w-auto max-w-full rounded-md shadow-lift`} style={{ aspectRatio: `${f.w} / ${f.h}` }}
                role="img" aria-label={`Poster preview: ${data.headline}. ${data.teams.map((t) => `${t.name} ${t.score ?? ''}`).join(', ')}. ${data.result}.${data.pom ? ` Player of the match ${data.pom.name}, ${data.pom.line}.` : ''}`} />
            </div>
            {assets?.notes.length ? <ul className="mt-2 space-y-1 text-xs text-ink-muted">{assets.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
