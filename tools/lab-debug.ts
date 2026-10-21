import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { VENUES, leagueById } from '@kurciv/config';
import { overall, type Player } from '@kurciv/domain';
import { buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { T20_RULES } from '@kurciv/simulation';
const ipl = leagueById('IPL');
const pool = CURATED_PLAYERS.map((r) => expandCurated(r, 2027)).sort((a, b) => overall(b) - overall(a));
const A = pool.filter((p, i) => i % 2 === 0 && p.country === 'IND').slice(0, 20);
const B = pool.filter((p, i) => i % 2 === 1 && p.country === 'IND').slice(0, 20);
const mk = (sq: Player[], k: string) => buildTeamSetup({ id: k, name: k, shortName: k, colors: ['#fff', '#000'] }, pickXI(sq, ipl.squadRules, ['IND']), defaultTactics(), 0.6);
const c: Record<string, number> = {}; const shots: Record<string, [number, number, number]> = {};
const add = (k: string) => (c[k] = (c[k] ?? 0) + 1);
let balls = 0;
for (let m = 0; m < 100; m++) {
  const s = simulateMatch({ fixtureId: 'd' + m, competition: 'X', stage: 'L', home: mk(A, 'A'), away: mk(B, 'B'), venue: VENUES[0], evening: false, importance: 0.3, rules: T20_RULES, userSide: null }, 'd' + m);
  for (const d of s.deliveries) {
    if (!d.legal) continue; balls++;
    add('contact:' + d.contact); add('quality:' + d.quality); add('len:' + d.length);
    const sh = (shots[d.shot ?? 'none'] ??= [0, 0, 0]); sh[0]++; sh[1] += d.batRuns; if (d.wicket) sh[2]++;
    if (d.wicket) add('w:' + d.wicket.kind + ':' + d.contact);
  }
  if (m === 0) { for (const inn of s.innings) console.log(Object.values(inn.batters).map((b) => `${b.playerId}:${b.runs}(${b.balls})`).join(' ')); }
}
for (const [k, v] of Object.entries(c).sort()) console.log(k.padEnd(28), ((v / balls) * 100).toFixed(2) + '%');
for (const [k, v] of Object.entries(shots).sort((a, b) => b[1][0] - a[1][0])) console.log(k.padEnd(12), 'share', ((v[0] / balls) * 100).toFixed(1), 'rpb', (v[1] / v[0]).toFixed(2), 'wkt%', ((v[2] / v[0]) * 100).toFixed(1));
