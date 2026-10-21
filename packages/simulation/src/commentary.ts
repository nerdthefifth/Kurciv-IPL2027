import type { DeliveryEvent, MatchState } from './types';
import { hash01 } from './rng';
import { ZONES, nearestPositionName, mirror } from './geometry';

/**
 * Commentary is generated strictly from the recorded event, so the text can never
 * describe something the engine did not do (no "six" for a single).
 */

function pick<T>(seq: number, salt: string, items: T[]): T {
  return items[Math.floor(hash01(`${seq}|${salt}`) * items.length)];
}

const LENGTH_WORDS: Record<string, string> = {
  yorker: 'yorker', full: 'full', good: 'good length', back: 'back of a length', short: 'short',
};

function name(s: MatchState, id: string): string {
  const p = s.setup.home.xi.find((x) => x.id === id) ?? s.setup.away.xi.find((x) => x.id === id);
  return p?.shortName ?? id;
}

function fielderSpot(s: MatchState, ev: DeliveryEvent): string {
  if (!ev.end) return '';
  const striker = s.setup.home.xi.find((x) => x.id === ev.strikerId) ?? s.setup.away.xi.find((x) => x.id === ev.strikerId);
  const p = striker?.batHand === 'L' ? mirror(ev.end) : ev.end;
  return nearestPositionName(p).toLowerCase();
}

export function commentaryFor(s: MatchState, ev: DeliveryEvent): string {
  const bowler = name(s, ev.bowlerId);
  const batter = name(s, ev.strikerId);
  const prefix = `${bowler} to ${batter}`;
  const len = LENGTH_WORDS[ev.length];
  const variation = ev.variation ? `${ev.variation}, ` : '';
  const shot = ev.shot ? ev.shot : '';
  const shotLabel = shotLabelOf(shot);
  const zone = ev.zone !== null ? ZONES[ev.zone].toLowerCase() : '';
  const fh = ev.freeHit ? ' (free hit)' : '';
  const note = ev.umpireNote ? ` ${ev.umpireNote}.` : '';

  if (ev.extras?.kind === 'wide') {
    const lineTxt = ev.line === 'leg' ? 'drifting down the leg side' : 'too wide outside off';
    return `${prefix}, wide${ev.extras.runs > 1 ? `s — ${ev.extras.runs} runs, past the keeper to the rope` : `, ${lineTxt}`}.`;
  }

  const nb = ev.extras?.kind === 'no-ball' ? ' No-ball — free hit to follow.' : '';

  if (ev.wicket) {
    const w = ev.wicket;
    const fielder = w.fielderId ? name(s, w.fielderId) : '';
    let txt: string;
    switch (w.kind) {
      case 'bowled':
        txt = ev.contact === 'edge'
          ? `BOWLED! Inside edge and the stumps are rattled — ${batter} drags it on`
          : pick(ev.seq, 'b', [`BOWLED! ${variation}${len} and it hits the timber`, `BOWLED HIM! ${batter} misses and the stumps are a mess`, `Clean bowled — a ${len} delivery beats the bat and the off bail goes flying`]);
        break;
      case 'lbw':
        txt = `LBW! ${variation}${len}, ${batter} is struck in front`;
        break;
      case 'caught':
        txt = `OUT! ${batter} ${shotLabel} and ${fielder} takes it at ${fielderSpot(s, ev)}${ev.chance?.difficulty === 'hard' ? ' — a superb catch' : ''}`;
        break;
      case 'caught behind':
        txt = `OUT! Edged and taken behind by ${fielder}${ev.contact === 'edge' ? ` — ${len} delivery found the edge` : ''}`;
        break;
      case 'stumped':
        txt = `STUMPED! ${batter} charges, misses, and ${fielder} whips the bails off`;
        break;
      case 'run out':
        txt = `RUN OUT! ${name(s, w.playerOutId)} is short of the crease — sharp work from ${fielder}`;
        break;
    }
    return `${prefix}, ${txt}.${ev.review ? ` (${ev.review.overturned ? 'Overturned on review' : 'Upheld on review'})` : ''}${nb}`;
  }

  if (ev.boundary === 6) {
    return `${prefix}${fh}, SIX! ${capital(shotLabel)} ${pick(ev.seq, 's6', ['and it sails over', 'high and handsome over', 'launched over', 'deposited into the stands at'])} ${zone}.${nb}${note}`;
  }
  if (ev.boundary === 4 && ev.batRuns === 4) {
    return `${prefix}${fh}, FOUR! ${capital(shotLabel)} ${pick(ev.seq, 's4', ['and it races away through', 'pierces the gap at', 'beats the field to'])} ${zone}.${nb}${note}`;
  }
  const dropped = ev.chance && ev.chance.kind === 'catch' && !ev.chance.taken ? ` DROPPED! ${name(s, ev.chance.fielderId)} puts down a ${ev.chance.difficulty} chance at ${fielderSpot(s, ev)}.` : '';
  if (ev.extras?.kind === 'bye' || ev.extras?.kind === 'leg-bye') {
    const r = ev.extras.runs;
    return `${prefix}, ${r} ${ev.extras.kind}${r > 1 ? 's' : ''}${r === 4 ? ' — through to the boundary' : ''}.${note}`;
  }
  if (ev.contact === 'leave') return `${prefix}, ${len} outside off, left alone.${nb}`;
  if (ev.contact === 'miss') {
    return `${prefix}${fh}, ${pick(ev.seq, 'm', ['beaten!', 'past the outside edge', 'misses', 'no shot connected'])} — ${variation}${len}.${nb}${note}`;
  }
  const fieldTxt = ev.fielderId ? ` to ${fielderSpot(s, ev)}` : '';
  if (ev.batRuns === 0) {
    if (ev.shot === 'defend') return `${prefix}, ${len}, solidly defended.${nb}`;
    return `${prefix}${fh}, ${shotLabel}${fieldTxt}, no run.${dropped}${nb}${note}`;
  }
  const runsTxt = ev.batRuns === 1 ? 'one run' : `${ev.batRuns} runs`;
  const edgeTxt = ev.contact === 'edge' ? ' off the edge' : ev.contact === 'mistimed' ? ' off a leading edge' : '';
  return `${prefix}${fh}, ${shotLabel}${edgeTxt}${fieldTxt}, ${runsTxt}.${dropped}${nb}${note}`;
}

function capital(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const LABELS: Record<string, string> = {
  defend: 'defends', push: 'works it', drive: 'drives', cut: 'cuts', 'late-cut': 'runs it down', pull: 'pulls', hook: 'hooks',
  flick: 'flicks', glance: 'glances', sweep: 'sweeps', reverse: 'reverse-sweeps', loft: 'lofts it straight', slog: 'slogs',
  'inside-out': 'goes inside-out', 'slog-sweep': 'slog-sweeps', scoop: 'scoops', ramp: 'ramps it', 'upper-cut': 'upper-cuts', 'dig-out': 'digs it out',
};

function shotLabelOf(id: string): string {
  return LABELS[id] ?? 'plays';
}
