/**
 * Format laboratory: plays seeded ODIs and Tests between strong curated sides and prints the
 * distributions the formats are tuned against. `npx tsx tools/format-lab.ts ODI 60` or `Test 20`.
 */
import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { VENUES, leagueById } from '@kurciv/config';
import { overall, type Player } from '@kurciv/domain';
import { buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { Rng, rulesFor, type MatchState } from '@kurciv/simulation';

const format = (process.argv[2] ?? 'ODI') as 'ODI' | 'Test' | 'T20';
const N = Number(process.argv[3] ?? 40);
const season = 2027;
const rules = leagueById('IPL').squadRules;
const pool = CURATED_PLAYERS.map((r) => expandCurated(r, season)).sort((a, b) => overall(b) - overall(a));
const byCountry = (c: string) => pool.filter((p) => p.country === c);
const nations = ['IND', 'AUS', 'ENG', 'PAK', 'SA', 'NZ'].map((c) => pickXI(byCountry(c), { ...rules, maxOverseas: 0 }, [c as Player['country']]));

const rng = Rng.from(`lab-${format}`);
const inns: number[][] = [[], [], [], []];
const wk: number[][] = [[], [], [], []];
const rpo: number[] = [];
const results = { home: 0, away: 0, draw: 0, tie: 0 };
let innLost = 0;
let decl = 0;
let fo = 0;
const runsBy: Record<string, number> = {};
let legal = 0;
const shots: Record<string, number> = {};
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const a = rng.int(0, nations.length - 1);
  let b = rng.int(0, nations.length - 2);
  if (b >= a) b++;
  const venue = rng.pick(VENUES);
  const mk = (k: number) => buildTeamSetup({ id: `N${k}`, name: `Nation ${k}`, shortName: `N${k}`, colors: ['#fff', '#000'] }, nations[k], defaultTactics(), 0.65);
  const s: MatchState = simulateMatch({ fixtureId: `fl-${m}`, competition: 'LAB', stage: 'Test', home: mk(a), away: mk(b), venue, evening: false, importance: 0.5, rules: rulesFor(format), userSide: null }, `fl-${format}-${m}`);
  s.innings.filter((i) => !i.superOver).forEach((i, k) => {
    inns[k].push(i.runs);
    wk[k].push(i.wickets);
    if (i.legalBalls) rpo.push((i.runs / i.legalBalls) * 6);
    if (i.declared) decl++;
    if (i.followOn) fo++;
  });
  for (const d of s.deliveries) {
    if (d.legal) legal++;
    const k = d.boundary ? `b${d.boundary}` : `r${d.batRuns}`;
    runsBy[k] = (runsBy[k] ?? 0) + 1;
    if (d.shot) shots[d.shot] = (shots[d.shot] ?? 0) + 1;
  }
  if (s.result?.drawn) results.draw++;
  else if (!s.result?.winner) results.tie++;
  else results[s.result.winner]++;
  if (s.result?.margin.includes('innings')) innLost++;
}
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
console.log(`${format}: ${N} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
inns.forEach((x, k) => x.length && console.log(`  innings ${k + 1}: avg ${avg(x)} (${x.length}), wickets ${avg(wk[k])}`));
console.log(`  run rate ${avg(rpo)} per over`);
console.log(`  results`, results, `innings wins ${innLost}, declarations ${decl}, follow-ons ${fo}`);
console.log('  per 100 legal balls', Object.fromEntries(Object.entries(runsBy).map(([k, v]) => [k, Math.round((v / legal) * 1000) / 10])));
console.log('  shots %', Object.fromEntries(Object.entries(shots).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / legal) * 1000) / 10])));
