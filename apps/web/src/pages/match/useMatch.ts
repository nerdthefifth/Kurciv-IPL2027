import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useCareer, useToast } from '../../lib/context';
import { sfx } from '../../lib/sound';

export type Speed = 'slow' | 'normal' | 'fast' | 'turbo';
export const SPEED_MS: Record<Speed, number> = { slow: 2200, normal: 1100, fast: 450, turbo: 60 };
export type StepMode = 'toss' | 'ball' | 'over' | 'next-over' | 'innings' | 'end';

/**
 * A visual presenter (the 3D view). When registered, resolved deliveries are shown before the
 * score and decisions update, so the board never runs ahead of the picture. It only reads the
 * engine's result; it can never change it.
 */
export interface Presenter {
  present: (fresh: any[], ctx: { state: any; needs: any }) => Promise<void>;
}

/**
 * Drives a live match. Every request goes through one serial queue, so a delivery and a
 * tactical change can never overlap: changes made during continuous play land between balls.
 * The engine (in the worker) remains the single source of truth; this hook only mirrors it.
 */
export function useMatch(slot: 'match' | 'lab', initial: any, presenter?: { current: Presenter | null }) {
  const career = useCareer();
  const toast = useToast();
  const base = `/careers/${career.id}/${slot}`;
  const [state, setState] = useState<any>(() => strip(initial.state));
  const [deliveries, setDeliveries] = useState<any[]>(initial.state.deliveries);
  const [needs, setNeeds] = useState<any>(initial.state.pending);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(() => (localStorage.getItem('kurciv.matchSpeed') as Speed) || 'normal');
  const [drs, setDrs] = useState<any>(null);
  const [flash, setFlash] = useState<'wicket' | 'four' | 'six' | null>(null);
  const version = useRef<number>(initial.version);
  const lastSeq = useRef<number>(initial.state.deliveries.at(-1)?.seq ?? 0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const playingRef = useRef(false);
  /** Continuous play stopped for a bowler or batter choice: resume once it is answered. */
  const resumeAfterChoice = useRef(false);
  const inningsCount = useRef<number>(initial.state.innings.length);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const apply = useCallback((r: any) => {
    version.current = r.version;
    const fresh: any[] = r.state.deliveries ?? [];
    setState(strip(r.state));
    setNeeds(r.needs ?? r.state.pending ?? null);
    if (fresh.length) {
      lastSeq.current = fresh[fresh.length - 1].seq;
      setDeliveries((d) => [...d, ...fresh.filter((x) => !d.some((y) => y.seq === x.seq))]);
      const last = fresh[fresh.length - 1];
      setFlash(last.wicket ? 'wicket' : last.boundary === 6 ? 'six' : last.boundary === 4 ? 'four' : null);
      if (last.wicket) sfx.wicket();
      else if (last.boundary) sfx.boundary();
      const reviewed = fresh.filter((x) => x.review).at(-1);
      if (reviewed) setDrs(reviewed);
    }
    return fresh;
  }, []);

  const resync = useCallback(async () => {
    const r = await api<any>(base);
    if (!r.live) return;
    version.current = r.live.version;
    lastSeq.current = r.live.state.deliveries.at(-1)?.seq ?? 0;
    setDeliveries(r.live.state.deliveries);
    setState(strip(r.live.state));
    setNeeds(r.live.state.pending);
  }, [base]);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const stepRaw = useCallback(async (mode: StepMode) => {
    setBusy(true);
    try {
      const r = await api<any>(`${base}/step`, { body: { mode, version: version.current, since: lastSeq.current } });
      // Instant simulation (innings / match) skips the picture; ball-by-ball and overs are shown.
      if (presenter?.current && (mode === 'ball' || mode === 'over' || mode === 'next-over')) {
        await presenter.current.present(r.state.deliveries ?? [], { state: r.state, needs: r.needs ?? r.state.pending ?? null }).catch(() => undefined);
      }
      const prev = inningsCount.current;
      inningsCount.current = r.state.innings.length;
      return { fresh: apply(r), needs: r.needs ?? r.state.pending ?? null, complete: r.state.status === 'complete', inningsOver: prev > 0 && r.state.innings.length > prev };
    } catch (e) {
      toast.push('error', (e as Error).message);
      await resync();
      return null;
    } finally {
      setBusy(false);
    }
  }, [base, apply, toast, resync]);

  const step = useCallback((mode: StepMode) => {
    pause();
    return enqueue(() => stepRaw(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueue, stepRaw]);

  const act = useCallback((action: any, success?: string) => enqueue(async () => {
    setBusy(true);
    try {
      const r = await api<any>(`${base}/action`, { body: { action, version: version.current, since: lastSeq.current } });
      if (presenter?.current && r.state.deliveries?.length) {
        await presenter.current.present(r.state.deliveries, { state: r.state, needs: r.needs ?? r.state.pending ?? null }).catch(() => undefined);
      }
      apply(r);
      const pending = r.state.pending;
      if (resumeAfterChoice.current && (action.type === 'bowler' || action.type === 'batter') && !pending) {
        resumeAfterChoice.current = false;
        setTimeout(() => playRef.current?.(), 400);
      }
      for (const w of r.warnings ?? []) toast.push(w.startsWith('ILLEGAL') ? 'error' : 'info', w);
      if (success) toast.push('ok', success);
      return true;
    } catch (e) {
      toast.push('error', (e as Error).message);
      await resync();
      return false;
    } finally {
      setBusy(false);
    }
  }), [base, apply, toast, resync, enqueue]);

  /** Continuous play: one delivery at a time until paused, a decision is needed or a review is shown. */
  const play = useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    const loop = async () => {
      while (playingRef.current) {
        const r = await enqueue(() => stepRaw('ball'));
        // Stop for decisions, reviews, the end of an innings and the end of the match.
        if (r && r.needs && (r.needs.kind === 'bowler' || r.needs.kind === 'batter')) resumeAfterChoice.current = true;
        if (!r || r.needs || r.complete || r.inningsOver || r.fresh.some((x: any) => x.review)) break;
        // With a presenter the animation itself sets the pace; otherwise wait between balls.
        await new Promise((res) => setTimeout(res, presenter?.current ? 250 : SPEED_MS[speedRef.current]));
      }
      playingRef.current = false;
      setPlaying(false);
    };
    void loop();
  }, [enqueue, stepRaw]);

  const playRef = useRef<() => void>();
  playRef.current = play;

  function pause() {
    resumeAfterChoice.current = false;
    playingRef.current = false;
    setPlaying(false);
  }

  useEffect(() => {
    try {
      localStorage.setItem('kurciv.matchSpeed', speed);
    } catch {
      // not persisted
    }
  }, [speed]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => () => {
    playingRef.current = false;
  }, []);

  return { state, deliveries, needs, busy, playing, speed, setSpeed, play, pause, step, act, drs, closeDrs: () => setDrs(null), flash, resync };
}

function strip(st: any) {
  const { deliveries: _d, ...rest } = st;
  return rest;
}
