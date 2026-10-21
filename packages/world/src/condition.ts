import type { Club, Injury, Player, PlayerAttributes, TrainingFocus, WorldState } from '@kurciv/domain';
import { ageOf, battingRating, bowlingRating, isPace, overall } from '@kurciv/domain';
import { WORLD } from '@kurciv/config';
import type { Rng } from '@kurciv/simulation';
import { addNews, clamp, nextId } from './util';

// ------------------------------------------------------------------ fatigue & recovery

export function applyMatchLoad(p: Player, load: { ballsFaced: number; ballsBowled: number; fielded: boolean }) {
  let f = WORLD.condition.matchBaseFatigue * 0.8;
  f += load.ballsFaced * 0.08;
  if (load.ballsBowled) f += isPace(p.bowlType) ? 6 + load.ballsBowled * 0.35 : 3 + load.ballsBowled * 0.18;
  p.fatigue = clamp(p.fatigue + f * (1.25 - p.attrs.phys.fitness / 200), 0, 100);
  p.workload += load.ballsBowled;
}

/** One rest day of recovery for every player at a club (medical facility and fitness matter). */
export function recoverDay(w: WorldState, club: Club) {
  const intensity = club.training.intensity;
  const train = intensity === 'light' ? 1.2 : intensity === 'intense' ? 0.75 : 1;
  for (const id of [...club.squad, ...club.academy]) {
    const p = w.players[id];
    if (!p) continue;
    const rec = WORLD.condition.recoveryPerDay * (0.6 + p.attrs.phys.fitness / 200) * (1 + club.facilities.medical * 0.05) * train;
    p.fatigue = clamp(p.fatigue - rec, 0, 100);
    p.workload *= WORLD.condition.workloadDecay;
    if (p.injury) {
      const speed = 1 + club.facilities.medical * 0.06;
      p.injury.daysRemaining = Math.max(0, p.injury.daysRemaining - speed);
      if (p.injury.daysRemaining <= 0) {
        p.injuryHistory.push({ season: w.season, type: p.injury.type, days: p.injury.expectedDaysMax });
        if (club.isUser) {
          addNews(w, { kind: 'injury', importance: 1, headline: `${p.name} is fit again`, body: `${p.name} has recovered from ${p.injury.type.toLowerCase()} and is available for selection.`, clubIds: [club.id], playerIds: [p.id], sourceRef: p.injury.id });
        }
        p.injury = null;
        p.fatigue = Math.max(p.fatigue, 25);
      }
    }
  }
}

// ------------------------------------------------------------------ injuries

const INJURIES: { type: string; kind: Injury['kind']; severity: Injury['severity']; min: number; max: number; weight: number; bowler?: boolean }[] = [
  { type: 'Hamstring strain', kind: 'soft-tissue', severity: 'minor', min: 5, max: 12, weight: 10 },
  { type: 'Side strain', kind: 'soft-tissue', severity: 'moderate', min: 14, max: 30, weight: 6, bowler: true },
  { type: 'Calf tightness', kind: 'soft-tissue', severity: 'minor', min: 3, max: 8, weight: 8 },
  { type: 'Groin strain', kind: 'soft-tissue', severity: 'moderate', min: 10, max: 21, weight: 5 },
  { type: 'Finger fracture', kind: 'impact', severity: 'moderate', min: 18, max: 35, weight: 4 },
  { type: 'Bruised hand', kind: 'impact', severity: 'minor', min: 2, max: 6, weight: 7 },
  { type: 'Ankle sprain', kind: 'impact', severity: 'minor', min: 5, max: 14, weight: 6 },
  { type: 'Lower-back stress', kind: 'workload', severity: 'major', min: 35, max: 80, weight: 2, bowler: true },
  { type: 'Shoulder impingement', kind: 'workload', severity: 'moderate', min: 12, max: 28, weight: 3, bowler: true },
  { type: 'Knee ligament damage', kind: 'impact', severity: 'major', min: 45, max: 110, weight: 1 },
];

export function injuryRisk(p: Player, club: Club, ballsBowled: number, season: number): number {
  const age = ageOf(p, season);
  let r = WORLD.condition.injuryBaseRisk;
  r *= 1 + p.fatigue * 0.02;
  r *= 1.45 - p.attrs.phys.durability / 100;
  if (age >= 32) r *= 1.25;
  if (isPace(p.bowlType) && ballsBowled >= 18) r *= 1.6;
  if (p.workload > 60) r *= 1.4;
  if (club.training.intensity === 'intense') r *= 1.2;
  const recent = p.injuryHistory.filter((h) => h.season >= season - 1).length;
  r *= 1 + recent * 0.25;
  return r;
}

export function rollInjury(w: WorldState, p: Player, club: Club, ballsBowled: number, rng: Rng): Injury | null {
  if (p.injury) return null;
  if (!rng.chance(injuryRisk(p, club, ballsBowled, w.season))) return null;
  const options = INJURIES.filter((i) => !i.bowler || ballsBowled > 0);
  const pick = rng.weighted(options, options.map((o) => o.weight));
  const expected = rng.range(pick.min, pick.max);
  const injury: Injury = {
    id: nextId(w, 'inj'), type: pick.type, kind: p.injuryHistory.some((h) => h.type === pick.type) ? 'recurring' : pick.kind, severity: pick.severity,
    sustainedDay: w.day, sustainedSeason: w.season, expectedDaysMin: pick.min, expectedDaysMax: pick.max, daysRemaining: Math.round(expected),
    reinjuryRisk: pick.severity === 'major' ? 0.25 : pick.severity === 'moderate' ? 0.15 : 0.08,
  };
  p.injury = injury;
  const star = overall(p) >= 80;
  if (club.isUser || star) {
    addNews(w, {
      kind: 'injury', importance: star ? 2 : 1,
      headline: `${p.name} ruled out with ${pick.type.toLowerCase()}`,
      body: `${club.name}'s medical staff expect ${p.name} to miss ${pick.min}–${pick.max} days (${pick.severity}).`,
      clubIds: [club.id], playerIds: [p.id], sourceRef: injury.id,
    });
  }
  return injury;
}

// ------------------------------------------------------------------ form & morale

export function updateForm(p: Player, perf: number) {
  // Shrink toward zero: form is a short-term signal, not ability.
  p.form = Math.round(clamp(p.form * 0.72 + perf * 1.1, -10, 10) * 10) / 10;
}

export function updateMorale(w: WorldState, p: Player, club: Club, delta: number) {
  p.morale = clamp(Math.round((p.morale + delta) * 10) / 10, 0, 100);
  if (p.morale < WORLD.morale.transferRequestThreshold && p.benchStreak >= 5 && !p.transferRequest) {
    p.transferRequest = true;
    addNews(w, {
      kind: 'morale', importance: club.isUser ? 2 : 1,
      headline: `${p.name} unhappy with lack of game time`,
      body: `${p.name} has been left out of ${p.benchStreak} straight matches and has asked ${club.name} about their future.`,
      clubIds: [club.id], playerIds: [p.id], sourceRef: `morale-${p.id}-${w.season}-${w.day}`,
    });
  }
}

// ------------------------------------------------------------------ development & ageing

function scaleGroup(group: object, delta: number, keys?: string[]) {
  const g = group as Record<string, number>;
  for (const k of keys ?? Object.keys(g)) {
    if (k === 'speed') continue;
    g[k] = clamp(Math.round((g[k] + delta) * 10) / 10, 1, 99);
  }
}

function focusWeights(focus: TrainingFocus): { bat: number; bowl: number; field: number; phys: number } {
  switch (focus) {
    case 'batting': return { bat: 1.4, bowl: 0.7, field: 0.9, phys: 0.9 };
    case 'pace':
    case 'spin': return { bat: 0.7, bowl: 1.4, field: 0.9, phys: 0.9 };
    case 'fielding': return { bat: 0.9, bowl: 0.9, field: 1.6, phys: 1 };
    case 'fitness': return { bat: 0.9, bowl: 0.9, field: 1, phys: 1.6 };
    default: return { bat: 1, bowl: 1, field: 1, phys: 1 };
  }
}

/**
 * Season-end development. Growth toward (but never guaranteed to reach) potential depends
 * on age, playing time, coaching, facilities, training focus, morale and injuries.
 * Decline after the early thirties hits physical attributes first.
 */
export function developPlayer(w: WorldState, p: Player, club: Club | null, matchesPlayed: number, rng: Rng): number {
  const dev = WORLD.development;
  const age = ageOf(p, w.season);
  const before = overall(p);
  const coach = club ? club.coaches.reduce((s, c) => s + c.rating, 0) / club.coaches.length : 50;
  const facility = club ? club.facilities.training : 1;
  const focus = focusWeights(club?.training.individual[p.id] ?? club?.training.focus ?? 'balanced');
  const intensity = club?.training.intensity === 'intense' ? 1.15 : club?.training.intensity === 'light' ? 0.85 : 1;
  const headroom = Math.max(0, p.potential - before);
  let growth = 0;
  if (age <= 21) growth = dev.youthGrowth;
  else if (age <= 25) growth = dev.youthGrowth * 0.6;
  else if (age <= 28) growth = 0.8;
  growth *= Math.min(1, headroom / 6);
  growth *= 0.55 + dev.playingTimeWeight * Math.min(1, matchesPlayed / 10) + dev.coachingWeight * ((coach - 50) / 50) + facility * 0.04;
  growth *= (0.85 + p.attrs.mental.workEthic / 400) * intensity * (p.morale > 70 ? 1.05 : p.morale < 35 ? 0.85 : 1);
  if (p.injuryHistory.some((h) => h.season === w.season && h.days > 40)) growth *= 0.6;
  growth += rng.normal(0, 0.8);

  let decline = 0;
  if (age >= dev.declineStart) decline = dev.declinePerYear * (1 + (age - dev.declineStart) * 0.18) * (1.15 - p.attrs.phys.fitness / 200);

  const a: PlayerAttributes = p.attrs;
  const bats = a.bat;
  const bowlsSeriously = p.bowlType !== 'NONE' && bowlingRating(a, p.bowlType) > 40;
  scaleGroup(bats, (growth - decline * 0.45) * focus.bat * (p.role === 'BOWL' ? 0.5 : 1));
  if (bowlsSeriously) scaleGroup(a.bowl, (growth - decline * 0.55) * focus.bowl, ['control', 'movement', 'variation', 'yorker', 'slower', 'powerplay', 'death']);
  scaleGroup(a.field, (growth * 0.5 - decline * 1.1) * focus.field, ['catching', 'ground', 'throwing', 'athleticism']);
  scaleGroup(a.phys, growth * 0.3 * focus.phys - decline * 1.3, ['fitness']);
  if (isPace(p.bowlType) && age >= 31) a.bowl.speed = Math.round((a.bowl.speed - decline * 0.5 - rng.range(0, 0.6)) * 10) / 10;
  if (age >= 25) a.mental.temperament = clamp(a.mental.temperament + 0.4, 1, 99);

  // Potential is re-estimated: it can rise for late bloomers and fall when growth stalls.
  if (age <= 26) p.potential = Math.round(clamp(p.potential + rng.normal(0, 1.4) + (matchesPlayed >= 8 ? 0.6 : -0.3), overall(p), 97));
  else p.potential = Math.max(Math.round(overall(p)), Math.round(p.potential - 0.5));
  p.ratingUncertainty = Math.max(2, p.ratingUncertainty * 0.85);
  const after = overall(p);
  p.development.push({ season: w.season, overall: after, bat: battingRating(a), bowl: bowlingRating(a, p.bowlType), potential: p.potential, note: matchesPlayed ? `${matchesPlayed} matches` : 'did not play' });
  return after - before;
}

export function retirementChance(p: Player, season: number): number {
  const age = ageOf(p, season);
  const ovr = overall(p);
  if (age < 33) return ovr < 40 && age > 28 ? 0.15 : 0;
  if (age >= 41) return 0.95;
  return clamp(0.05 + (age - 33) * 0.1 + (ovr < 60 ? 0.2 : 0) - (ovr > 80 ? 0.15 : 0), 0, 0.9);
}
