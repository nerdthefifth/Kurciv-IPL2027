import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useCareer, useToast } from '../../lib/context';
import { usePrefs } from '../../lib/prefs';
import { buzz, sfx } from '../../lib/sound';

export type Room = any;
export type SkipMode = 'assistant' | 'without-me' | 'until-flagged';

const RUNNING = new Set(['PLAYER_INTRODUCTION', 'OPEN_FOR_BIDS', 'FINAL_CALL', 'SOLD', 'UNSOLD']);

/**
 * Drives the live auction. Time only advances while this screen is open, visible and unpaused:
 * the client sends elapsed real time (scaled by the chosen speed) and the engine resolves AI
 * reactions, countdowns and sales deterministically. Leaving the room simply pauses the clock.
 */
export function useAuctionRoom() {
  const career = useCareer();
  const toast = useToast();
  const { prefs } = usePrefs();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/careers/${career.id}/auction`;
  const refresh = career.refresh;
  const prev = useRef<Room | null>(null);
  const speed = useRef(prefs.auctionSpeed);
  speed.current = prefs.auctionSpeed;
  const alive = useRef(true);

  /** Sounds and notifications from state transitions (never from guesses). */
  const react = useCallback((next: Room) => {
    const a = next?.auction;
    const p = prev.current?.auction;
    prev.current = next;
    if (!a?.live || !p?.live) return;
    if (a.live.outbid && !p.live.outbid) {
      sfx.outbid();
      buzz(40);
    }
    const lastSeen = p.commentary[0];
    const fresh = lastSeen ? a.commentary.slice(0, a.commentary.findIndex((c: any) => c.t === lastSeen.t && c.text === lastSeen.text)) : a.commentary.slice(0, 1);
    if (fresh.some((c: any) => c.kind === 'bid')) sfx.bid();
    if (a.lastResult && a.lastResult.lotId !== p.lastResult?.lotId) {
      if (a.lastResult.status === 'sold') {
        sfx.gavel();
        if (a.lastResult.isUser) toast.push('ok', `${a.lastResult.player.name} signed for ${a.lastResult.price?.toFixed(2)} Cr.`);
      } else sfx.unsold();
    }
  }, [toast]);

  const loadFull = useCallback(async () => {
    try {
      const r = await api<Room>(base);
      if (!alive.current) return;
      setFull(r);
      setRoom(r);
      react(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base, react]);

  useEffect(() => {
    alive.current = true;
    loadFull();
    return () => {
      alive.current = false;
    };
  }, [loadFull, career.tick]);

  // Refresh the queue/lobby (full view) whenever the lot changes.
  const lotKey = room?.auction ? `${room.auction.lotNumber}|${room.auction.live?.phase === 'ACCELERATED_SELECTION'}|${room.auction.status}` : '';
  const lastLotKey = useRef(lotKey);
  useEffect(() => {
    if (lotKey && lastLotKey.current && lotKey !== lastLotKey.current) {
      api<Room>(base).then((r) => alive.current && setFull(r)).catch(() => {});
    }
    lastLotKey.current = lotKey;
  }, [lotKey, base]);

  // The clock.
  const phase = room?.auction?.live?.phase;
  const paused = room?.auction?.live?.paused;
  const status = room?.auction?.status;
  useEffect(() => {
    if (status !== 'live' || !phase || !RUNNING.has(phase) || paused) return;
    let stop = false;
    let last = performance.now();
    let timer: number;
    const loop = async () => {
      if (stop) return;
      if (document.hidden) {
        last = performance.now();
        timer = window.setTimeout(loop, 400);
        return;
      }
      const now = performance.now();
      // Clamp real elapsed time: a slow engine slows the auction clock rather than skipping
      // the bidding window you were about to act in.
      const dt = Math.min(350, now - last) * speed.current;
      last = now;
      try {
        const r = await api<Room>(`${base}/tick`, { body: { dt } });
        if (stop || !alive.current) return;
        setRoom((old: Room) => mergeLite(old, r));
        react(r);
        if (r.auction?.status !== 'live' || !RUNNING.has(r.auction?.live?.phase)) {
          if (r.auction?.status !== 'live' || r.phase !== 'auction') refresh();
          return;
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
        return;
      }
      timer = window.setTimeout(loop, 180);
    };
    timer = window.setTimeout(loop, 120);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [status, phase, paused, base, react, refresh]);

  const command = useCallback(async (cmd: Record<string, unknown>, opts: { quietError?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await api<Room>(`${base}/command`, { body: { command: cmd } });
      setRoom((old: Room) => mergeLite(old, r));
      react(r);
      if (cmd.type === 'begin' || cmd.type === 'accelerated-start' || cmd.type === 'flag' || cmd.type === 'proxy' || cmd.type === 'accelerated-toggle') loadFull();
      if (r.auction?.status !== 'live') refresh();
      return true;
    } catch (e) {
      if (!opts.quietError) toast.push('error', (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [base, react, loadFull, toast, refresh]);

  /** Skip Auction: the same live engine at high speed (assistant bids, sit out, or stop at a shortlisted player). */
  const skip = useCallback(async (mode: SkipMode) => {
    setBusy(true);
    try {
      const r = await api<{ stoppedAt: string | null; lots: number }>(`${base}/skip`, { body: { mode } });
      if (r.stoppedAt) toast.push('info', `Stopped for your shortlisted player: ${r.stoppedAt}.`);
      await loadFull();
      refresh();
    } catch (e) {
      toast.push('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [base, loadFull, refresh, toast]);

  return { room, full, error, busy, command, skip, reload: loadFull };
}

/** Tick and command responses are "lite": keep the last full queue and lobby. */
function mergeLite(old: Room | null, next: Room): Room {
  if (!old?.auction || !next?.auction) return next;
  return { ...next, auction: { ...next.auction, queue: next.auction.queue ?? old.auction.queue, lobby: next.auction.lobby ?? old.auction.lobby } };
}
