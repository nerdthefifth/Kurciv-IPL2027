import { CURATED_PLAYERS, expandCurated } from '@kurciv/data-ingestion';
import { VENUES, leagueById } from '@kurciv/config';
import { overall, type Player } from '@kurciv/domain';
import { T20_RULES, type MatchSetup } from '@kurciv/simulation';
import { buildTeamSetup, defaultTactics, pickXI } from '../selection';

const ipl = leagueById('IPL');
export const POOL = CURATED_PLAYERS.map((r) => expandCurated(r, 2027)).sort((a, b) => overall(b) - overall(a));

export function squads(): [Player[], Player[]] {
  const A: Player[] = [];
  const B: Player[] = [];
  POOL.forEach((p, i) => {
    const t = i % 2 === 0 ? A : B;
    const os = t.filter((x) => x.country !== 'IND').length;
    if (t.length < 20 && (p.country === 'IND' || os < 5)) t.push(p);
  });
  return [A, B];
}

export function setup(id = 'test', userSide: 'home' | 'away' | null = null): MatchSetup {
  const [A, B] = squads();
  const mk = (sq: Player[], k: string) =>
    buildTeamSetup({ id: k, name: `Team ${k}`, shortName: k, colors: ['#fff', '#000'] }, pickXI(sq, ipl.squadRules, ['IND']), defaultTactics(), 0.6);
  return { fixtureId: id, competition: 'TEST', stage: 'League', home: mk(A, 'A'), away: mk(B, 'B'), venue: VENUES[0], evening: true, importance: 0.3, rules: T20_RULES, userSide };
}
