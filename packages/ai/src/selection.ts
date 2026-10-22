import type { CountryCode, FieldTemplate, PitchProfile, Player, SquadRules, TeamTactics } from '@kurciv/domain';
import { battingRating, bowlingRating, canBowl, isSpin } from '@kurciv/domain';
import { BUILT_IN_FIELDS, type MatchPlayer, type TeamSetup } from '@kurciv/simulation';

export function defaultTactics(): TeamTactics {
  return {
    battingIntent: 0.5,
    phaseIntent: { powerplay: 0.45, middle: 0.38, death: 0.66 },
    bowlingPlan: { lengths: { good: 4, full: 3, back: 2, short: 1 }, lines: { off: 5, stumps: 4, wide: 1 }, variation: 0.2, pace: 'normal' },
    fieldTemplateByPhase: { powerplay: 'pp-attack', middle: 'mid-pace', death: 'death-yorker' },
    mirrorForLeftHanders: true,
    reviewPolicy: 'balanced',
  };
}

const fitnessPenalty = (p: Player) => Math.max(0, p.fatigue - 45) * 0.25;

/** How much the surface favours spin (including wear later in the match). */
const spinHelp = (pitch?: PitchProfile) => (pitch ? pitch.spin + pitch.wear * 0.5 : 0);

/** Bowling value adjusted for what the surface offers each type. */
const conditionBonus = (p: Player, pitch?: PitchProfile) =>
  !pitch || p.bowlType === 'NONE' ? 0 : isSpin(p.bowlType) ? spinHelp(pitch) * 12 : pitch.pace * 12;

/**
 * Selects a valid XI: at most `maxOverseasInXI` overseas, a wicketkeeper and five bowling
 * options. Fatigue and form are considered; injured players are never picked. With a pitch,
 * bowlers suited to the surface are preferred and a turning pitch gets a second spinner.
 */
export function pickXI(squad: Player[], rules: SquadRules, domestic: CountryCode[], pitch?: PitchProfile): Player[] {
  const avail = squad.filter((p) => !p.injury && !p.retired);
  const xi: Player[] = [];
  const overseas = (p: Player) => !domestic.includes(p.country);
  const canAdd = (p: Player) => !xi.includes(p) && (!overseas(p) || xi.filter(overseas).length < rules.maxOverseasInXI);
  const val = (p: Player, w: { bat: number; bowl: number }) =>
    battingRating(p.attrs) * w.bat + bowlingRating(p.attrs, p.bowlType) * w.bowl + p.form * 0.8 - fitnessPenalty(p);

  // 1. Wicketkeeper
  const keepers = avail.filter((p) => p.role === 'WK' || p.attrs.field.keeping >= 60).sort((a, b) => val(b, { bat: 1, bowl: 0 }) + b.attrs.field.keeping * 0.3 - (val(a, { bat: 1, bowl: 0 }) + a.attrs.field.keeping * 0.3));
  const wk = keepers.find(canAdd);
  if (wk) xi.push(wk);

  // 2. Five bowling options, at least one spinner when one exists.
  const bowlVal = (p: Player) => val(p, { bat: 0.3, bowl: 1 }) + conditionBonus(p, pitch);
  const bowlers = avail.filter(canBowl).sort((a, b) => bowlVal(b) - bowlVal(a));
  const spinners = bowlers.filter((p) => isSpin(p.bowlType) && bowlingRating(p.attrs, p.bowlType) >= 60);
  for (const sp of spinners.slice(0, spinHelp(pitch) > 0.3 ? 2 : 1)) if (canAdd(sp)) xi.push(sp);
  for (const b of bowlers) {
    if (xi.filter(canBowl).length >= 5) break;
    if (canAdd(b)) xi.push(b);
  }

  // 3. Best remaining cricketers, valuing a sixth bowling option a little.
  const rest = avail.filter((p) => !xi.includes(p)).sort((a, b) => {
    const va = Math.max(val(a, { bat: 1, bowl: 0.25 }), val(a, { bat: 0.3, bowl: 0.9 })) + (canBowl(a) && xi.filter(canBowl).length < 6 ? 4 : 0);
    const vb = Math.max(val(b, { bat: 1, bowl: 0.25 }), val(b, { bat: 0.3, bowl: 0.9 })) + (canBowl(b) && xi.filter(canBowl).length < 6 ? 4 : 0);
    return vb - va || a.id.localeCompare(b.id);
  });
  for (const p of rest) {
    if (xi.length >= 11) break;
    if (canAdd(p)) xi.push(p);
  }
  return battingOrder(xi);
}

/** Openers, then technicians, finishers, then bowlers by batting ability. */
export function battingOrder(xi: Player[]): Player[] {
  const bat = (p: Player) => battingRating(p.attrs);
  const tail = xi.filter((p) => p.role === 'BOWL').sort((a, b) => bat(b) - bat(a));
  const top = xi.filter((p) => p.role !== 'BOWL');
  const openScore = (p: Player) => p.attrs.bat.powerplay + (p.styleTags.includes('opener') ? 12 : 0) - (p.styleTags.includes('finisher') ? 10 : 0);
  const openers = [...top].sort((a, b) => openScore(b) - openScore(a)).slice(0, 2);
  const middle = top.filter((p) => !openers.includes(p));
  const finishers = middle.filter((p) => p.styleTags.includes('finisher') || p.role === 'AR').sort((a, b) => b.attrs.bat.death - a.attrs.bat.death);
  const core = middle.filter((p) => !finishers.includes(p)).sort((a, b) => b.attrs.bat.middle - a.attrs.bat.middle);
  return [...openers, ...core, ...finishers, ...tail];
}

/** Short, plain reasons behind a selection: balance for the surface, who is rested or injured. */
export function explainXI(xi: Player[], squad: Player[], pitch?: PitchProfile): string[] {
  const notes: string[] = [];
  const spin = xi.filter((p) => canBowl(p) && isSpin(p.bowlType)).length;
  const pace = xi.filter((p) => canBowl(p) && !isSpin(p.bowlType)).length;
  const surface = pitch ? (spinHelp(pitch) > 0.3 ? 'a turning pitch' : pitch.pace > 0.3 ? 'a seaming pitch' : `a ${pitch.kind} pitch`) : 'the conditions';
  notes.push(`${pace} seam and ${spin} spin option${spin === 1 ? '' : 's'} for ${surface}.`);
  const rested = squad.filter((p) => !xi.includes(p) && !p.injury && p.fatigue > 70 && overallish(p) >= Math.min(...xi.map(overallish)));
  if (rested.length) notes.push(`Rested for fatigue: ${rested.slice(0, 3).map((p) => p.shortName).join(', ')}.`);
  const injured = squad.filter((p) => p.injury);
  if (injured.length) notes.push(`Unavailable through injury: ${injured.slice(0, 3).map((p) => p.shortName).join(', ')}${injured.length > 3 ? ` and ${injured.length - 3} more` : ''}.`);
  return notes;
}

const overallish = (p: Player) => Math.max(battingRating(p.attrs), bowlingRating(p.attrs, p.bowlType));

export function toMatchPlayer(p: Player): MatchPlayer {
  return {
    id: p.id, name: p.name, shortName: p.shortName, country: p.country, batHand: p.batHand, bowlType: p.bowlType, role: p.role,
    attrs: p.attrs, form: p.form, fatigue: p.fatigue, morale: p.morale, tags: p.styleTags, source: p.source,
  };
}

export function buildTeamSetup(
  club: { id: string; name: string; shortName: string; colors: [string, string]; fieldTemplates?: FieldTemplate[] },
  xi: Player[],
  tactics: TeamTactics,
  tacticalQuality: number,
  tendencies?: TeamSetup['tendencies'],
  captainId?: string | null,
): TeamSetup {
  const keeper = [...xi].sort((a, b) => b.attrs.field.keeping - a.attrs.field.keeping)[0];
  // The club's named captain (or vice-captain) leads when playing; otherwise the best leader in the XI.
  const named = captainId ? xi.find((p) => p.id === captainId) : undefined;
  const captain = named ?? [...xi].sort((a, b) => b.attrs.mental.leadership - a.attrs.mental.leadership || a.id.localeCompare(b.id))[0];
  const custom = club.fieldTemplates ?? [];
  const fields = [...BUILT_IN_FIELDS, ...custom.filter((c) => !BUILT_IN_FIELDS.some((b) => b.id === c.id))];
  return {
    clubId: club.id, name: club.name, shortName: club.shortName, colors: club.colors, xi: xi.map(toMatchPlayer),
    captainId: captain.id, keeperId: keeper.id, tactics, fields, tacticalQuality, tendencies,
  };
}
