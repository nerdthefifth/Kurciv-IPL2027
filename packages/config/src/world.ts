/** Server-side world configuration: reputation, qualification, development, condition and finance. */
export const WORLD = {
  startSeason: 2027,
  schemaVersion: 4,

  reputation: {
    /** Learning rate applied to the (actual − expected) performance residual. */
    learningRate: 4,
    /** Weight of each WCC stage when computing a league's residual. */
    stageWeights: { prelim: 0.6, group: 1, knockout: 1.6, final: 2.2 } as Record<string, number>,
    /** Mean-reversion toward each league's structural strength (commercial + depth), per season. */
    reversion: 0.04,
    /** Maximum change in a single season. */
    maxDelta: 4,
    /** Club quality component: how much the average squad strength drift moves reputation. */
    squadQualityWeight: 0.25,
    min: 0,
    max: 100,
  },

  wcc: {
    maxTeams: 50,
    /** Slots reserved for a regional pathway (leagues with no automatic slot), 0 to disable. */
    regionalReserve: 0,
    minSlotsPerLeague: 1,
    maxSlotsPerLeague: 9,
    /** A league can never send more than this share of its clubs. */
    maxShareOfClubs: 0.8,
    /** Weights blending into the allocation score. */
    weights: { reputation: 0.7, history: 0.2, depth: 0.1 },
    /** Exponent sharpening reputation differences in the allocation. */
    reputationExponent: 2.2,
    startDayAfterLeagues: 6,
    prize: { champion: 15, runnerUp: 8, semi: 4, quarter: 2, group: 0.6 },
  },

  development: {
    peakAgeBat: 29,
    peakAgePace: 27,
    peakAgeSpin: 30,
    youthGrowth: 3.2, // max rating points/season toward potential at 18–21
    declineStart: 32,
    declinePerYear: 1.6,
    playingTimeWeight: 0.45,
    coachingWeight: 0.35,
    retirementAge: 37,
  },

  condition: {
    recoveryPerDay: 9, // fatigue points recovered per rest day (scaled by fitness & medical)
    matchBaseFatigue: 10,
    injuryBaseRisk: 0.0055, // per match per player
    injuryFatigueFactor: 0.0002,
    workloadDecay: 0.88, // per day
  },

  morale: {
    winDelta: 2.5,
    lossDelta: -2.2,
    benchedDelta: -1.4,
    playedDelta: 0.8,
    performanceDelta: 3,
    transferRequestThreshold: 25,
  },

  youth: {
    prospectsPerSeason: [1, 3] as [number, number],
    eliteChance: 0.04,
    academyMax: 8,
  },

  finance: {
    ticketPerHomeMatch: 1.6, // crore at brand 100
    sponsorshipShare: 0.35, // of league purse, before brand/reputation multipliers
    broadcastShare: 0.75, // of league purse, before reputation multiplier
    facilityUpkeep: 0.8, // per level per season
    facilityUpgradeCost: [0, 6, 10, 16, 24],
    coachSalaryScale: 0.04,
  },
};

export const FEATURE_FLAGS = {
  impactPlayer: false,
  sealedBids: false,
  odiEngine: false,
  testEngine: false,
  nationalTeamMode: false,
  loans: false,
};
