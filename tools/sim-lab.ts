/**
 * Simulation laboratory: runs thousands of seeded matches and prints the distributions the
 * engine is calibrated against. `npm run lab -- 2000` (default 1000 matches).
 */
import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { VENUES, leagueById } from '@kurciv/config';
import { overall, bowlingRating, type Player } from '@kurciv/domain';
(globalThis as any).__br = (p: Player) => bowlingRating(p.attrs, p.bowlType);
import { buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { T20_RULES, Rng, lbwTrueOut, type MatchState } from '@kurciv/simulation';
const ump = { lbwAppeals: 0, lbwCorrect: 0, lbwMissed: 0, lbwFalseOut: 0, cbAppeals: 0, cbMissedEdge: 0, cbFalseOut: 0, reviews: 0, overturned: 0, umpiresCall: 0 };

const N = Number(process.argv[2] ?? 1000);
const season = 2027;
const ipl = leagueById('IPL');
const pool = CURATED_PLAYERS.map((r) => expandCurated(r, season)).sort((a, b) => overall(b) - overall(a));

// Snake-draft 10 balanced squads (≤5 overseas each)
const squads: Player[][] = Array.from({ length: 10 }, () => []);
let dir = 1, i = 0;
for (const p of pool) {
  const tries = 10;
  for (let t = 0; t < tries; t++) {
    const sq = squads[i];
    const os = sq.filter((x) => x.country !== 'IND').length;
    const ok = sq.length < 20 && (p.country === 'IND' || os < 5);
    i += dir; if (i === 10 || i === -1) { dir *= -1; i += dir; }
    if (ok) { sq.push(p); break; }
  }
}
const strength = (sq: Player[]) => {
  const xi = pickXI(sq, ipl.squadRules, ['IND']);
  return xi.reduce((a, p) => a + overall(p), 0) / 11;
};

const rng = Rng.from('lab');
const agg = {
  inn1: [] as number[], inn2: [] as number[], wk1: [] as number[], balls: 0, dots: 0, ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0,
  wides: 0, nb: 0, byes: 0, lb: 0, pp: [] as number[], death: [] as number[], chaseWins: 0, decided: 0, strongerWins: 0, strongerGames: 0,
  kinds: {} as Record<string, number>, gapWins: {} as Record<string, [number, number]>, press: { calm: [0, 0, 0], high: [0, 0, 0] }, superOvers: 0, illegal: 0, runsSaved: 0, catches: 0, drops: 0,
};
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const a = rng.int(0, 9);
  let b = rng.int(0, 8); if (b >= a) b++;
  const venue = rng.pick(VENUES.filter((v) => v.country === 'IND'));
  const mk = (k: number) => buildTeamSetup({ id: `T${k}`, name: `Team ${k}`, shortName: `T${k}`, colors: ['#fff', '#000'] }, pickXI(squads[k], ipl.squadRules, ['IND']), defaultTactics(), 0.6);
  const s: MatchState = simulateMatch({ fixtureId: `lab-${m}`, competition: 'LAB', stage: 'League', home: mk(a), away: mk(b), venue, evening: true, importance: 0.3, rules: T20_RULES, userSide: null }, `lab-${m}`);
  const [i1, i2] = s.innings;
  agg.inn1.push(i1.runs); agg.wk1.push(i1.wickets); agg.inn2.push(i2.runs);
  if (s.innings.some((x) => x.superOver)) agg.superOvers++;
  for (const inn of [i1, i2]) {
    agg.pp.push(inn.overRuns.slice(0, 6).reduce((x, y) => x + y, 0));
    if (inn.overRuns.length >= 20) agg.death.push(inn.overRuns.slice(15, 20).reduce((x, y) => x + y, 0));
  }
  for (const d of s.deliveries) {
    if (d.innings > 1) continue;
    if (d.legal) agg.balls++;
    if (d.extras?.kind === 'wide') agg.wides += d.extras.runs;
    if (d.extras?.kind === 'no-ball') agg.nb++;
    if (d.extras?.kind === 'bye') agg.byes += d.extras.runs;
    if (d.extras?.kind === 'leg-bye') agg.lb += d.extras.runs;
    if (d.illegalField) agg.illegal++;
    if (d.legal && !d.extras) {
      const b = d.pressure.batter >= 0.35 ? agg.press.high : d.pressure.batter < 0.05 ? agg.press.calm : null;
      if (b) { b[0]++; b[1] += d.batRuns; if (d.wicket) b[2]++; }
    }
    agg.runsSaved += d.runsSaved;
    if (d.chance?.kind === 'catch') d.chance.taken ? agg.catches++ : agg.drops++;
    if (d.extras?.kind === 'wide') continue;
    if (d.boundary === 6) agg.sixes++;
    else if (d.boundary === 4 && d.batRuns === 4) agg.fours++;
    else if (d.batRuns === 0 && d.legal && !d.extras) agg.dots++;
    else if (d.batRuns === 1) agg.ones++;
    else if (d.batRuns === 2) agg.twos++;
    else if (d.batRuns === 3) agg.threes++;
    if (d.wicket) agg.kinds[d.wicket.kind] = (agg.kinds[d.wicket.kind] ?? 0) + 1;
    if (d.tracking) {
      const t = lbwTrueOut(d.tracking);
      const given = d.review?.overturned ? !d.wicket : !!d.wicket;
      ump.lbwAppeals++;
      if (t === given) ump.lbwCorrect++; else if (t) ump.lbwMissed++; else ump.lbwFalseOut++;
    }
    if (d.edge) {
      ump.cbAppeals++;
      const given = d.review?.overturned ? !d.wicket : !!d.wicket;
      if (d.edge.contact && !given) ump.cbMissedEdge++;
      if (!d.edge.contact && given) ump.cbFalseOut++;
    }
    if (d.review) { ump.reviews++; if (d.review.overturned) ump.overturned++; if (d.review.umpiresCall) ump.umpiresCall++; }
  }
  if (s.result?.winner) {
    agg.decided++;
    if (s.result.winner === i2.battingSide) agg.chaseWins++;
    const sa = strength(squads[a]), sb = strength(squads[b]);
    const gap = Math.abs(sa - sb);
    const bucket = gap < 1 ? '<1' : gap < 3 ? '1-3' : '>3';
    const g = (agg.gapWins[bucket] ??= [0, 0]);
    g[1]++;
    if (s.result.winner === (sa > sb ? 'home' : 'away')) g[0]++;
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)));
const pct = (n: number) => `${((n / agg.balls) * 100).toFixed(1)}%`;
const totalW = Object.values(agg.kinds).reduce((a, b) => a + b, 0);
console.log(`\nKurciv simulation lab — ${N} T20 matches in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(`1st innings: mean ${mean(agg.inn1).toFixed(1)}  sd ${sd(agg.inn1).toFixed(1)}  wickets ${mean(agg.wk1).toFixed(2)}`);
const sorted = [...agg.inn1].sort((a, b) => a - b); console.log("percentiles 5/25/50/75/95:", [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => sorted[Math.floor(q * sorted.length)]).join(" "));
console.log(`2nd innings: mean ${mean(agg.inn2).toFixed(1)}`);
console.log(`Powerplay (0-6): ${mean(agg.pp).toFixed(1)}   Death (16-20): ${mean(agg.death).toFixed(1)}`);
console.log(`Ball outcomes: dots ${pct(agg.dots)}  1s ${pct(agg.ones)}  2s ${pct(agg.twos)}  3s ${pct(agg.threes)}  4s ${pct(agg.fours)}  6s ${pct(agg.sixes)}`);
console.log(`Extras per innings: wides ${(agg.wides / (2 * N)).toFixed(2)}  no-balls ${(agg.nb / (2 * N)).toFixed(2)}  byes ${(agg.byes / (2 * N)).toFixed(2)}  leg-byes ${(agg.lb / (2 * N)).toFixed(2)}`);
console.log(`Dismissals: ${Object.entries(agg.kinds).map(([k, v]) => `${k} ${((v / totalW) * 100).toFixed(0)}%`).join('  ')}`);
console.log(`Umpiring per match: LBW appeals ${(ump.lbwAppeals / N).toFixed(2)} (on-field correct ${((ump.lbwCorrect / Math.max(1, ump.lbwAppeals)) * 100).toFixed(0)}%, missed outs ${ump.lbwMissed}, false outs ${ump.lbwFalseOut})  caught-behind appeals ${(ump.cbAppeals / N).toFixed(2)} (missed edges ${ump.cbMissedEdge}, false outs ${ump.cbFalseOut})`);
console.log(`Reviews per match ${(ump.reviews / N).toFixed(2)}: overturned ${ump.overturned}, umpire's call ${ump.umpiresCall}`);
console.log(`Catches taken ${agg.catches}, dropped ${agg.drops} (${((agg.catches / (agg.catches + agg.drops)) * 100).toFixed(0)}% conversion)`);
console.log(`Chasing side won ${((agg.chaseWins / agg.decided) * 100).toFixed(1)}%   super overs ${agg.superOvers}`);
console.log(`Stronger XI win % by XI-rating gap: ${Object.entries(agg.gapWins).map(([k, [w, n]]) => `${k}: ${((w / n) * 100).toFixed(0)}% (${n})`).join('  ')}`);
const pr = (b: number[]) => `${b[0]} balls, ${(b[1] / b[0]).toFixed(2)} runs/ball, wicket every ${(b[0] / Math.max(1, b[2])).toFixed(1)} balls`;
console.log(`Batter under pressure (index ≥0.35): ${pr(agg.press.high)}`);
console.log(`Batter calm (index <0.05):          ${pr(agg.press.calm)}`);
console.log(`Illegal-field deliveries: ${agg.illegal}   runs saved by fielders / innings: ${(agg.runsSaved / (2 * N)).toFixed(1)}`);
if (process.env.LAB_SQUADS) {
  squads.forEach((sq, k) => {
    const xi = pickXI(sq, ipl.squadRules, ['IND']);
    const bowl = xi.filter((p) => p.bowlType !== 'NONE').map((p) => Math.round(bowlingRatingOf(p))).sort((a, b) => b - a);
    console.log(`T${k} str ${strength(sq).toFixed(1)} bowlers ${bowl.join(',')}`);
  });
}
function bowlingRatingOf(p: Player) { return (globalThis as any).__br(p); }
