/**
 * Tunable constants for the ball-by-ball engine. Every probability curve in the engine
 * reads from here so the simulation lab (`npm run lab`) can calibrate without code edits.
 * Values were calibrated against broad modern men's T20 scoring patterns: ~165–180 per
 * first innings, ~6.5 wickets, ~36% dot balls, ~1 boundary every 6 balls.
 */
export const SIM = {
  engineVersion: 'kurciv-t20-1.3.0',

  // --- geometry (metres)
  strikerY: -8.8,
  circleRadius: 27.43,
  stumpsY: 10.06,
  keeperBackY: -21,
  keeperUpY: -10.8,

  // --- fielder physics
  reactionBase: 0.36,
  reactionPerAthleticism: 0.0016,
  runSpeedBase: 5.2,
  runSpeedPerAthleticism: 0.024,
  groundReachBase: 1.5,
  groundReachPerSkill: 0.01,
  aerialReaction: 0.55,
  catchRunFactor: 0.85,
  catchReachBase: 0.9,
  catchReachPerSkill: 0.011,
  groundDecel: 2.55,
  throwSpeedBase: 25,
  throwSpeedPerSkill: 0.13,
  pickupTime: 0.45,
  stumpBreakTime: 0.35,

  // --- running between wickets
  firstRunBase: 3.17,
  firstRunPerRotation: 0.004,
  nextRunBase: 3.3,
  nextRunPerRotation: 0.004,
  runSafetyBase: -0.05,
  runSafetyIntent: 0.3,
  rotationHeadStart: 0.4,
  extraRunCaution: 0.55,
  movingPickupPerMetre: 0.08,

  // --- delivery execution
  executionBase: 0.42,
  executionPerControl: 0.0045,
  badBallShare: 0.36,
  wideBase: 0.016,
  widePerControlDeficit: 0.0005,
  noBallBase: 0.003,
  noBallPerControlDeficit: 0.00008,

  // --- contact model
  missBias: -2.6,
  missRisk: 2.3,
  missSkill: 0.48,
  missSuit: 0.75,
  missDelivery: 1.05,
  missMovement: 0.65,
  edgeBias: -2.9,
  edgeRisk: 1.3,
  edgeSkill: 0.4,
  edgeMovement: 0.8,
  qualityMean: 0.6,
  qualitySkill: 0.065,
  qualitySuit: 0.13,
  qualityDelivery: 0.13,
  qualityRisk: 0.16,
  qualitySd: 0.2,
  intentSharpness: 12,
  /** Reference standard of a match (top-order power, attack control) and how far the physical scale is anchored to it (0 = absolute ratings, 1 = fully relative). */
  powerAnchor: 75,
  controlAnchor: 72,
  levelAnchoring: 0.75,
  /** How strongly batters respect a well-executed ball (shot selection). */
  respectWeight: 14,
  lengthSuitWeight: 1.6,
  lineSuitWeight: 1.0,

  // --- ball flight
  carryBase: 40,
  carryPerPower: 0.5,
  carryQualityFloor: 0.29,
  carryQualityGain: 0.79,
  groundSpeedBase: 16,
  groundSpeedPerPower: 0.22,
  groundQualityFloor: 0.45,
  groundQualityGain: 0.72,

  // --- wickets
  hitStumpsOnStumpsLine: 0.33,
  hitStumpsOnOffLine: 0.12,
  stumpingChance: 0.3,
  umpireMissRate: 0.12,
  umpireFalseOutRate: 0.025,
  /** Chance a beaten ball outside off, taken by the keeper, is wrongly given caught behind. */
  umpireFalseCaughtBehindRate: 0.006,
  catchBase: 0.6,
  catchPerSkill: 0.0045,
  catchSlackBonus: 0.12,
  boundaryCatchPenalty: 0.2,

  // --- condition modifiers
  dewControlPenaltySpin: 12,
  dewControlPenaltyPace: 6,
  fatiguePerOverPace: 7,
  fatiguePerOverSpin: 3.5,
  formWeight: 0.8,
  newBatterPenalty: 8,
  newBatterBalls: 7,
  setBatterBonus: 3,
};

export type SimParams = typeof SIM;
