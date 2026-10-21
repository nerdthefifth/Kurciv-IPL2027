import type { WorldState } from '@kurciv/domain';
import type { MatchState } from '@kurciv/simulation';

/** MatchArchiveService: compact summaries of completed matches for lists and the season archive. */
export function archiveEntry(w: WorldState, s: MatchState, season: number) {
  const fx = w.fixtures[s.setup.fixtureId];
  const inn = s.innings.filter((i) => !i.superOver);
  const winner = s.result?.winner ? s.setup[s.result.winner] : null;
  return {
    fixtureId: s.setup.fixtureId, season, day: fx?.day ?? null, competition: s.setup.competition, stage: s.setup.stage, venue: s.setup.venue.name,
    home: { clubId: s.setup.home.clubId, name: s.setup.home.name, shortName: s.setup.home.shortName, colors: s.setup.home.colors },
    away: { clubId: s.setup.away.clubId, name: s.setup.away.name, shortName: s.setup.away.shortName, colors: s.setup.away.colors },
    scores: inn.map((i) => ({ clubId: s.setup[i.battingSide].clubId, runs: i.runs, wickets: i.wickets, balls: i.legalBalls })),
    result: winner ? `${winner.name} ${s.result!.margin}` : s.result?.margin ?? 'No result',
    winnerClubId: winner?.clubId ?? null,
    involvesUser: s.setup.home.clubId === w.userClubId || s.setup.away.clubId === w.userClubId,
  };
}
