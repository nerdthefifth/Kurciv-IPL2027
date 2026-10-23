import type { WorldState } from '@kurciv/domain';
import { DIVISIONS, PRESEASON, PYRAMID, leagueById } from '@kurciv/config';
import { autoFillUserSquad } from '../transfers';
import { addNews } from '../util';
import { arrangeAiFriendlies } from './preseason';
import { initNations, refreshOffers, schedulePreseasonInternationals } from './international';
import { snapshotMembership } from './pyramid';

/** First day of the postseason international window (anything scheduled after the preseason). */
export const POSTSEASON_FROM = PRESEASON.lastDay + 5;

/**
 * The auction cascade is complete: open the preseason. In the pyramid this also schedules the
 * AI clubs' friendlies, the preseason international window and national-team job offers.
 */
export function enterPreseason(w: WorldState) {
  w.phase = 'preseason';
  // A user squad left short by the auction is completed at minimum price, and the user is told.
  const user = w.clubs[w.userClubId];
  const min = leagueById(user.leagueId).squadRules.minSquad;
  if (user.squad.length < min) {
    const before = user.squad.length;
    const added = autoFillUserSquad(w);
    if (added) addNews(w, { kind: 'auction', importance: 2, headline: `${added} free agent${added === 1 ? '' : 's'} registered to complete the squad`, body: `${user.name} left the auction with ${before} players; the assistant signed the best available free agents at the minimum price to reach the ${min}-player minimum. Review them in Transfers.`, clubIds: [user.id], playerIds: user.squad.slice(-added), sourceRef: `autofill-${w.season}` });
  }
  if (w.worldModel !== 'pyramid' || !w.universe) return;
  initNations(w);
  schedulePreseasonInternationals(w);
  arrangeAiFriendlies(w);
  refreshOffers(w);
  snapshotMembership(w);
  const cal = w.universe.calendar.filter((c) => c.kind === 'international');
  w.universe.calendar = [
    { label: 'Retentions and auction', from: 20, to: 40, kind: 'auction' },
    { label: 'Preseason friendlies', from: PRESEASON.firstDay, to: PRESEASON.lastDay, kind: 'preseason' },
    { label: `${DIVISIONS.length}-division league season`, from: PYRAMID.seasonStartDay, to: PYRAMID.seasonStartDay + 64, kind: 'league' },
    { label: 'Continental cups', from: PYRAMID.seasonStartDay + 66, to: PYRAMID.seasonStartDay + 78, kind: 'continental' },
    { label: 'Global Club Championship', from: PYRAMID.seasonStartDay + 80, to: PYRAMID.seasonStartDay + 96, kind: 'global' },
    ...cal,
  ];
}
