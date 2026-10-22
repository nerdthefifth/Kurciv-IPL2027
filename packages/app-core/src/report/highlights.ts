import { SPIN_TYPES } from '@kurciv/domain';
import type { DeliveryEvent, MatchState, Side } from '@kurciv/simulation';
import type { MatchReport, Moment } from './match-report';

/** Ball label in cricket notation: over 12, third legal ball → "12.3". */
export const ballLabel = (d: DeliveryEvent) => `${d.over}.${d.legal ? d.ball : d.ball + 1}`;

type Partial = Omit<MatchReport, 'validation' | 'headline' | 'moments'> & { headline: MatchReport['headline']; moments: Moment[] };

/**
 * MatchHighlightService, headline: deterministic rules over the recorded match, checked in
 * priority order. A headline is only used when the data justifies it.
 */
export function buildHeadline(s: MatchState, rep: Partial): MatchReport['headline'] {
  const r = rep.result;
  const [first, second] = rep.innings;
  const winner = r.winnerClubId ? (rep.teams.home.clubId === r.winnerClubId ? rep.teams.home : rep.teams.away) : null;
  const pom = rep.playerOfMatch;
  const pomBat = pom ? rep.innings.flatMap((i) => i.batting).find((b) => b.playerId === pom.playerId) : null;
  const pomBowl = pom ? rep.innings.flatMap((i) => i.bowling).find((b) => b.playerId === pom.playerId) : null;
  const captainIds = new Set([s.setup.home.captainId, s.setup.away.captainId]);

  if (r.superOver) return { title: 'Decided in the super over', sub: `${winner?.name ?? 'Nobody'} hold their nerve after the scores finished level.`, tone: 'close' };
  if (r.kind === 'tie') return { title: 'Honours even', sub: `Both sides finished on ${first.runs}.`, tone: 'tie' };

  const lastOver = second && second.legalBalls > (second.maxOvers - 1) * 6;
  const closeChase = r.kind === 'wickets' && (r.ballsRemaining ?? 99) <= 6;
  const closeDefence = r.kind === 'runs' && (r.value ?? 99) <= 8 && lastOver;
  if (closeChase || closeDefence) {
    return { title: 'A last-over thriller', sub: closeChase ? `${winner!.name} got there with ${r.ballsRemaining} ball${r.ballsRemaining === 1 ? '' : 's'} to spare.` : `${winner!.name} defended ${first.runs} by ${r.value} run${r.value === 1 ? '' : 's'} in the final over.`, tone: 'close' };
  }
  const hundred = rep.innings.flatMap((i) => i.batting).find((b) => b.runs >= 100);
  if (hundred) return { title: `${hundred.name.split(' ').slice(-1)[0]}’s hundred`, sub: `${hundred.runs}${hundred.notOut ? '*' : ''} off ${hundred.balls} balls. ${r.text}.`, tone: 'standard' };
  if (pom && captainIds.has(pom.playerId) && ((pomBat?.runs ?? 0) >= 50 || (pomBowl?.wickets ?? 0) >= 3)) {
    return { title: 'The captain’s masterclass', sub: `${pom.name} leads from the front: ${pom.line}.`, tone: 'standard' };
  }
  const five = rep.innings.flatMap((i) => i.bowling).find((b) => b.wickets >= 5);
  if (five) return { title: `A ${five.wickets}-wicket haul`, sub: `${five.name} takes ${five.wickets}/${five.runs}. ${r.text}.`, tone: 'dominant' };

  // Spin or pace dominance among the winners' wickets.
  if (winner) {
    const bowlInn = rep.innings.find((i) => i.bowlingClubId === winner.clubId);
    if (bowlInn) {
      const types = new Map([...s.setup.home.xi, ...s.setup.away.xi].map((p) => [p.id, p.bowlType]));
      let spin = 0;
      let pace = 0;
      for (const d of s.deliveries) {
        if (d.innings !== bowlInn.index || !d.wicket || d.wicket.kind === 'run out' || !d.wicket.bowlerId) continue;
        const t = types.get(d.wicket.bowlerId);
        if (t && SPIN_TYPES.includes(t)) spin++;
        else pace++;
      }
      if (spin >= 5 && spin > pace) return { title: 'Spin turns the game', sub: `${winner.name}’s spinners take ${spin} wickets. ${r.text}.`, tone: 'standard' };
      if (pace >= 7 && pace > spin * 3) return { title: 'Pace rules the day', sub: `${winner.name}’s quicks take ${pace} wickets. ${r.text}.`, tone: 'standard' };
    }
  }
  // Collapse: the losing side lost five wickets for 30 or fewer.
  const loserInn = rep.innings.find((i) => i.battingClubId === r.loserClubId);
  if (loserInn) {
    const f = loserInn.fallOfWickets;
    for (let i = 0; i + 4 < f.length; i++) {
      if (f[i + 4].runs - (i ? f[i - 1].runs : 0) <= 30 && i + 4 >= 4) {
        return { title: 'The collapse', sub: `Five wickets fell for ${f[i + 4].runs - (i ? f[i - 1].runs : 0)} runs. ${r.text}.`, tone: 'dominant' };
      }
    }
  }
  if (r.kind === 'wickets' && (r.value ?? 0) >= 8) return { title: 'A dominant chase', sub: `${winner!.name} cruise home with ${r.value} wickets in hand.`, tone: 'dominant' };
  if (r.kind === 'runs' && (r.value ?? 0) >= 50) return { title: 'A one-sided contest', sub: `${winner!.name} win by ${r.value} runs.`, tone: 'dominant' };
  if (Math.max(first.runs, second?.runs ?? 0) >= 220) return { title: `Run fest at ${rep.meta.venue.name.split(',')[0]}`, sub: `${first.runs + (second?.runs ?? 0)} runs in the match. ${r.text}.`, tone: 'standard' };
  if (r.kind === 'runs' && first.runs <= 140) return { title: 'A low-scoring scrap', sub: `${winner!.name} defend ${first.runs}.`, tone: 'close' };
  if (r.kind === 'runs' && (r.value ?? 99) <= 12) return { title: 'Held their nerve', sub: `${winner!.name} defend ${first.runs} by ${r.value} runs.`, tone: 'close' };
  return { title: `${winner!.shortName} ${r.kind === 'runs' ? 'defend' : 'chase down'} ${first.runs}${r.kind === 'wickets' ? ` with ${r.value} wickets to spare` : ''}`, sub: `${r.text}.`, tone: 'standard' };
}

/** MatchHighlightService, moments: a chronological timeline built only from recorded events. */
export function keyMoments(s: MatchState, rep: Partial, names: Map<string, { name: string; shortName: string; side: Side }>): Moment[] {
  const out: Moment[] = [];
  const nm = (id: string) => names.get(id)?.name ?? id;
  const short = (id: string) => names.get(id)?.shortName ?? nm(id);
  const clubOf = (side: Side) => s.setup[side].clubId;
  const push = (d: DeliveryEvent | null, m: Omit<Moment, 'seq' | 'over' | 'innings'> & { seq?: number; over?: string; innings?: number }) =>
    out.push({ seq: m.seq ?? d!.seq, over: m.over ?? ballLabel(d!), innings: m.innings ?? d!.innings, kind: m.kind, title: m.title, detail: m.detail, clubId: m.clubId, important: m.important });

  for (const inn of s.innings) {
    const evs = s.deliveries.filter((d) => d.innings === inn.index);
    const label = inn.superOver ? 'Super over' : `Innings ${inn.index + 1}`;
    const bat = clubOf(inn.battingSide);
    const bowl = clubOf(inn.bowlingSide);
    const batterRuns = new Map<string, number>();
    const bowlerWkts = new Map<string, number>();
    const finalRuns = new Map(Object.values(inn.batters).map((b) => [b.playerId, b.runs]));
    let pship = 0;
    let pshipFlag = 0;
    let overWkts: Record<string, number> = {};
    let curOver = -1;
    for (const d of evs) {
      if (d.over !== curOver) {
        curOver = d.over;
        overWkts = {};
      }
      const before = batterRuns.get(d.strikerId) ?? 0;
      const after = before + d.batRuns;
      batterRuns.set(d.strikerId, after);
      pship += d.totalRuns;
      for (const m of [50, 100]) {
        if (before < m && after >= m) {
          const balls = s.deliveries.filter((x) => x.innings === inn.index && x.seq <= d.seq && x.strikerId === d.strikerId && x.extras?.kind !== 'wide').length;
          push(d, { kind: 'milestone', title: `${m === 100 ? 'Hundred' : 'Fifty'} for ${nm(d.strikerId)}`, detail: `Reached ${m} off ${balls} balls${d.boundary ? ` with a ${d.boundary}` : ''}.`, clubId: bat, important: m === 100 });
        }
      }
      for (const m of [50, 100]) {
        if (pshipFlag < m && pship >= m) {
          pshipFlag = m;
          push(d, { kind: 'partnership', title: `${m}-run stand`, detail: `${short(d.strikerId)} and ${short(d.nonStrikerId)} bring up a ${m} partnership.`, clubId: bat, important: m >= 100 });
        }
      }
      if (d.chance && !d.chance.taken && d.chance.kind === 'catch') {
        const went = finalRuns.get(d.strikerId) ?? after;
        push(d, { kind: 'drop', title: `${nm(d.chance.fielderId)} drops ${short(d.strikerId)}`, detail: `A ${d.chance.difficulty} chance on ${after}. ${short(d.strikerId)} went on to make ${went}.`, clubId: bowl, important: went - after >= 20 });
      }
      if (d.wicket) {
        const w = d.wicket;
        if (w.bowlerId && w.kind !== 'run out') {
          bowlerWkts.set(w.bowlerId, (bowlerWkts.get(w.bowlerId) ?? 0) + 1);
          overWkts[w.bowlerId] = (overWkts[w.bowlerId] ?? 0) + 1;
        }
        const n = bowlerWkts.get(w.bowlerId ?? '') ?? 0;
        if (!inn.superOver && d.over < 3) {
          push(d, { kind: 'early-wicket', title: `Early breakthrough`, detail: `${nm(w.playerOutId)} ${w.text || w.kind} for ${finalRuns.get(w.playerOutId) ?? 0}. ${d.scoreAfter.runs}/${d.scoreAfter.wickets}.`, clubId: bowl, important: false });
        } else if (w.kind === 'run out') {
          push(d, { kind: 'run-out', title: `Run out: ${nm(w.playerOutId)}`, detail: `${w.fielderId ? `${nm(w.fielderId)} with the direct involvement` : 'Run out'}. ${d.scoreAfter.runs}/${d.scoreAfter.wickets}.`, clubId: bowl, important: false });
        } else if (d.chance?.taken && d.chance.difficulty === 'hard' && w.fielderId) {
          push(d, { kind: 'catch', title: `A brilliant catch by ${nm(w.fielderId)}`, detail: `${nm(w.playerOutId)} departs for ${finalRuns.get(w.playerOutId) ?? 0}.`, clubId: bowl, important: true });
        } else if ((finalRuns.get(w.playerOutId) ?? 0) >= 40) {
          push(d, { kind: 'big-wicket', title: `${nm(w.playerOutId)} falls for ${finalRuns.get(w.playerOutId)}`, detail: `${w.text || w.kind}. ${d.scoreAfter.runs}/${d.scoreAfter.wickets}.`, clubId: bowl, important: true });
        }
        if (w.bowlerId && overWkts[w.bowlerId] === 2) push(d, { kind: 'double', title: `Two in the over for ${nm(w.bowlerId)}`, detail: `Over ${d.over + 1} swings the innings: ${d.scoreAfter.runs}/${d.scoreAfter.wickets}.`, clubId: bowl, important: true });
        if (w.bowlerId && (n === 3 || n === 5) && w.kind !== 'run out') push(d, { kind: 'spell', title: `${nm(w.bowlerId)} has ${n}`, detail: `${n === 5 ? 'A five-wicket haul.' : 'A third wicket in the spell.'}`, clubId: bowl, important: n === 5 });
        pship = 0;
        pshipFlag = 0;
      }
    }
    if (!inn.superOver) {
      const pp = s.setup.rules.powerplayOvers;
      const ppEvs = evs.filter((d) => d.over < pp);
      const lastPP = ppEvs[ppEvs.length - 1];
      if (lastPP && evs.some((d) => d.over >= pp)) {
        const runs = lastPP.scoreAfter.runs;
        push(lastPP, { kind: 'phase', title: `Powerplay: ${runs}/${lastPP.scoreAfter.wickets}`, detail: `${s.setup[inn.battingSide].shortName} after ${pp} overs (${(runs / pp).toFixed(1)} an over).`, clubId: bat, important: false });
      }
      const deathStart = s.setup.rules.overs - 5;
      const death = evs.filter((d) => d.over >= deathStart);
      if (death.length >= 12) {
        const last = death[death.length - 1];
        push(last, { kind: 'phase', title: `Death overs: ${death.reduce((a, d) => a + d.totalRuns, 0)} runs, ${death.filter((d) => d.wicket).length} wickets`, detail: `${label}, overs ${deathStart + 1}–${last.over + 1}.`, clubId: bat, important: false });
      }
    }
  }

  // Tactical changes by the user (observations only).
  if (s.setup.userSide) {
    for (const a of s.actions.filter((x) => x.side === s.setup.userSide && x.action.type === 'plan')) {
      const d = s.deliveries.find((x) => x.seq > a.seq);
      if (!d) continue;
      const nextOvers = s.deliveries.filter((x) => x.innings === d.innings && x.over >= d.over && x.over < d.over + 2);
      const runs = nextOvers.reduce((t, x) => t + x.totalRuns, 0);
      const wk = nextOvers.filter((x) => x.wicket).length;
      push(d, {
        kind: 'tactic', title: 'New bowling plan',
        detail: `The next two overs went for ${runs} with ${wk} wicket${wk === 1 ? '' : 's'}.`, clubId: s.setup[s.setup.userSide].clubId, important: false,
      });
    }
  }

  // The decisive over: biggest win-probability swing within one over.
  const swings = new Map<string, { swing: number; last: DeliveryEvent }>();
  let prev = 0.5;
  for (const d of s.deliveries) {
    const k = `${d.innings}:${d.over}`;
    const e = swings.get(k) ?? { swing: 0, last: d };
    e.swing += d.winProbHome - prev;
    e.last = d;
    prev = d.winProbHome;
    swings.set(k, e);
  }
  const decisive = [...swings.values()].sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))[0];
  if (decisive && Math.abs(decisive.swing) >= 0.15) {
    const d = decisive.last;
    const inn = s.innings[d.innings];
    const evs = s.deliveries.filter((x) => x.innings === d.innings && x.over === d.over);
    const runs = evs.reduce((t, x) => t + x.totalRuns, 0);
    const wk = evs.filter((x) => x.wicket).length;
    const favoured: Side = decisive.swing > 0 ? 'home' : 'away';
    push(d, {
      kind: 'decisive', title: `The decisive over: ${d.over + 1}`, over: `${d.over + 1}`,
      detail: `${runs} run${runs === 1 ? '' : 's'} and ${wk} wicket${wk === 1 ? '' : 's'} off ${short(d.bowlerId)}. The win-probability model moved about ${Math.round(Math.abs(decisive.swing) * 100)} points towards ${s.setup[favoured].shortName} (estimate).`,
      clubId: clubOf(favoured), important: true, innings: inn.index,
    });
  }

  // The final delivery.
  const last = s.deliveries[s.deliveries.length - 1];
  if (last) {
    const winnerSide = s.result?.winner ?? null;
    push(last, {
      kind: 'final', title: winnerSide ? 'The winning moment' : 'The final ball',
      detail: `${last.commentary}${winnerSide ? ` ${rep.result.text}.` : ' The scores finish level.'}`,
      clubId: winnerSide ? clubOf(winnerSide) : null, important: true,
    });
  }

  // Keep the timeline readable: all important moments plus up to 18 others, in order.
  const sorted = out.sort((a, b) => a.seq - b.seq || (a.kind === 'final' ? 1 : 0) - (b.kind === 'final' ? 1 : 0) || a.kind.localeCompare(b.kind));
  const dedup = sorted.filter((m, i) => !(i && sorted[i - 1].seq === m.seq && sorted[i - 1].title === m.title));
  const minor = dedup.filter((m) => !m.important);
  const keepMinor = new Set(minor.slice(0, 18));
  return dedup.filter((m) => m.important || keepMinor.has(m));
}
