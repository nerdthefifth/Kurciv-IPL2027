import { useEffect, useRef, useState } from 'react';
import type { Presenter, Speed } from '../useMatch';
import { MODEL_CREDIT, Stage, webglAvailable, type CameraMode, type StageStatus } from './stage';
import type { Quality } from './stadium';

/*
 * The 3D viewport. It owns one Stage (three.js, imperative — no per-frame React updates),
 * registers itself as the match's presenter, and keeps the scene in step with the match state.
 * Loaded lazily so the 2D match screen never downloads three.js.
 */

export interface View3DSettings {
  quality: Quality;
  camera: CameraMode;
  auto: boolean;
}

const TIMESCALE: Record<Speed, number> = { slow: 0.8, normal: 1.15, fast: 2, turbo: 4.5 };

export default function Match3D({ state, last, speed, presenter, settings, onSettings, onUnsupported, busy }: {
  state: any; last: any; speed: Speed; presenter: { current: Presenter | null }; settings: View3DSettings;
  onSettings: (s: View3DSettings) => void; onUnsupported: (why: string) => void; busy: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [status, setStatus] = useState<StageStatus>(null);
  const presenting = useRef(false);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) {
      onUnsupported('WebGL is not available in this browser.');
      return;
    }
    let s: Stage;
    try {
      s = new Stage(host.current, latest.current, settings.quality);
    } catch (e) {
      onUnsupported(`3D could not start (${(e as Error).message}).`);
      return;
    }
    stage.current = s;
    s.onStatus = setStatus;
    s.autoCamera = settings.auto;
    s.setCamera(settings.camera);
    s.timescale = TIMESCALE[speed];
    const lost = (e: Event) => {
      e.preventDefault();
      onUnsupported('The graphics device was reset.');
    };
    s.renderer.domElement.addEventListener('webglcontextlost', lost);
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(host.current);
    presenter.current = {
      present: async (fresh, ctx) => {
        presenting.current = true;
        try {
          s.state = ctx.state;
          for (const d of fresh) await s.present(d);
          if (ctx.needs?.kind === 'review' && ctx.state.pendingEvent) await s.presentAppeal(ctx.state.pendingEvent, ctx.state.pendingMeta?.kind ?? 'lbw');
        } finally {
          presenting.current = false;
        }
      },
    };
    return () => {
      presenter.current = null;
      ro.disconnect();
      s.renderer.domElement.removeEventListener('webglcontextlost', lost);
      s.dispose();
      stage.current = null;
    };
    // Rebuilt only when the graphics quality changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.quality]);

  useEffect(() => {
    const s = stage.current;
    if (s && !presenting.current) {
      s.syncLineup(state);
      s.lastEvent ??= last;
    }
  }, [state]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.autoCamera = settings.auto;
    s.setCamera(settings.camera);
  }, [settings.auto, settings.camera]);

  useEffect(() => {
    if (stage.current) stage.current.timescale = TIMESCALE[speed];
  }, [speed]);

  const sel = 'rounded bg-black/55 px-2 py-1 text-xs text-white backdrop-blur hover:bg-black/70';
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#140d10]">
      <div ref={host} className="absolute inset-0" aria-label="3D match view" role="img" />
      <a className="absolute left-2 top-11 text-[10px] text-white/45 hover:text-white/80" href="https://sketchfab.com/3d-models/cricketers-pack-low-poly-a16e3f072a714e2ab382d036c42ab3a6" target="_blank" rel="noreferrer">Players: {MODEL_CREDIT}</a>
      {status && (
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-3 py-1 text-sm font-semibold uppercase tracking-widest text-white">
          {status === 'replay' ? 'Replay' : status === 'review' ? 'DRS · ball tracking' : 'Appeal!'}
        </div>
      )}
      <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
        <select className={sel} aria-label="Camera" value={settings.camera} onChange={(e) => onSettings({ ...settings, camera: e.target.value as CameraMode })}>
          <option value="broadcast">Broadcast</option>
          <option value="follow">Follow ball</option>
          <option value="bowler">Bowler view</option>
          <option value="wicket">Wicket view</option>
          <option value="wide">Wide stadium</option>
        </select>
        <button className={sel} aria-pressed={settings.auto} onClick={() => onSettings({ ...settings, auto: !settings.auto })}>Auto camera: {settings.auto ? 'on' : 'off'}</button>
        <button className={sel} disabled={busy || !!status} onClick={() => stage.current?.replay()}>Replay last ball</button>
        <select className={sel} aria-label="Graphics quality" value={settings.quality} onChange={(e) => onSettings({ ...settings, quality: e.target.value as Quality })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="ultra">Ultra</option>
        </select>
      </div>
    </div>
  );
}
