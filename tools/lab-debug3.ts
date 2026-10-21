import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { VENUES, leagueById } from '@kurciv/config';
import { overall, bowlingRating, battingRating, type Player } from '@kurciv/domain';
import { buildTeamSetup, defaultTactics, pickXI, simulateMatch } from '@kurciv/ai';
import { T20_RULES, playerById } from '@kurciv/simulation';
const ipl = leagueById('IPL');
const pool = CURATED_PLAYERS.map((r) => expandCurated(r, 2027)).sort((a, b) => overall(b) - overall(a));
const A = pool.filter((p, i) => i % 2 === 0 && p.country === 'IND').slice(0, 20);
const B = pool.filter((p, i) => i % 2 === 1 && p.country === 'IND').slice(0, 20);
const mk = (sq: Player[], k: string) => buildTeamSetup({ id: k, name: k, shortName: k, colors: ['#fff', '#000'] }, pickXI(sq, ipl.squadRules, ['IND']), defaultTactics(), 0.6);
const all = new Map(pool.map((p) => [p.id, p]));
let shown = 0;
for (let m = 0; m < 80 && shown < 4; m++) {
  const s = simulateMatch({ fixtureId: 'd' + m, competition: 'X', stage: 'L', home: mk(A, 'A'), away: mk(B, 'B'), venue: VENUES[0], evening: false, importance: 0.3, rules: T20_RULES, userSide: null }, 'd' + m);
  const inn = s.innings[0];
  if (inn.runs > 250 || inn.runs < 90) {
    shown++;
    console.log(`\n== ${inn.runs}/${inn.wickets} in ${inn.legalBalls} balls (batting ${inn.battingSide})`);
    for (const b of Object.values(inn.bowlers)) { const p = all.get(b.playerId)!; console.log(`  ${p.name.padEnd(22)} bowlRtg ${bowlingRating(p.attrs, p.bowlType)} ${b.balls}b ${b.runs}r ${b.wickets}w`); }
    for (const b of Object.values(inn.batters)) { const p = all.get(b.playerId)!; console.log(`  ${p.name.padEnd(22)} batRtg ${battingRating(p.attrs)} ${b.runs}(${b.balls}) ${b.out?.kind ?? 'no'}`); }
  }
}
