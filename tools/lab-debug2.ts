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
const buckets: Record<string, number[]> = {};
let n = 0; const cat: Record<string, number> = {};
for (let m = 0; m < 60; m++) {
  const s = simulateMatch({ fixtureId: 'd' + m, competition: 'X', stage: 'L', home: mk(A, 'A'), away: mk(B, 'B'), venue: VENUES[0], evening: false, importance: 0.3, rules: T20_RULES, userSide: null }, 'd' + m);
  for (const d of s.deliveries) {
    if (!d.legal) continue; n++;
    if (d.aerial) cat['A>' + d.shot] = (cat['A>' + d.shot] ?? 0) + 1;
    const k = d.contact === 'miss' || d.contact === 'leave' ? 'miss/leave' : d.shot === 'defend' ? 'defend' : d.aerial ? 'aerial' : 'ground';
    cat[k + ':' + (d.wicket ? 'W' : d.batRuns)] = (cat[k + ':' + (d.wicket ? 'W' : d.batRuns)] ?? 0) + 1;
    if (k === 'ground' && d.end) {
      const dist = Math.hypot(d.end.x, d.end.y + 8.8);
      const b = `${Math.min(70, Math.floor(dist / 10) * 10)}m`;
      (buckets[b] ??= [0, 0, 0, 0, 0, 0, 0]);
      buckets[b][Math.min(6, d.batRuns)]++;
    }
  }
}
for (const [k, v] of Object.entries(cat).sort()) console.log(k.padEnd(18), ((v / n) * 100).toFixed(2) + '%');
for (const [k, v] of Object.entries(buckets).sort()) console.log(k, v.join(' '));
