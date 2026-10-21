/**
 * Subtle synthesized cues (no audio files): a gavel, a paddle tick, an outbid nudge, a wicket
 * thud and a boundary chime. Muted unless the user's preference allows sound.
 */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  bid: () => tone(880, 0.07, 'triangle', 0.05),
  userBid: () => {
    tone(660, 0.08, 'triangle', 0.07);
    tone(990, 0.1, 'triangle', 0.06, 0.06);
  },
  outbid: () => {
    tone(520, 0.12, 'sine', 0.07);
    tone(390, 0.16, 'sine', 0.06, 0.1);
  },
  gavel: () => {
    tone(140, 0.18, 'square', 0.09, 0, 70);
    tone(2200, 0.03, 'square', 0.03);
  },
  unsold: () => tone(240, 0.25, 'sine', 0.05, 0, 180),
  wicket: () => tone(110, 0.35, 'sine', 0.12, 0, 60),
  boundary: () => {
    tone(1040, 0.12, 'triangle', 0.05);
    tone(1560, 0.18, 'triangle', 0.04, 0.08);
  },
};

/** Optional haptic tap where supported. */
export function buzz(ms = 20) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // unsupported
  }
}
