# Simulation balance report

Engine version **`kurciv-t20-1.3.0`**. The target is T20 cricket at **about 7–8 runs an over**, with realistic wickets, dot balls and boundaries, and 15-run overs uncommon.

## Current results

Measured over 150 matches between two strong IPL-standard sides drawn from the curated player pool, rotated across every venue (a single small ground hides problems), with AI captains on both sides:

| Metric | Result |
| --- | --- |
| Average innings | **145** |
| Runs per over (overall) | **7.6** |
| Powerplay / middle / death overs | 8.7 / 6.3 / 8.7 per over |
| Overs of 15+ runs | 7.7% |
| Overs of 20+ runs | 1.5% |
| Overs of 4 or fewer | 26% |
| Wickets per innings | **7.0** |
| Fours / sixes per innings | 13.2 / 4.7 |

Clubs in weaker leagues score somewhat less than these strong sides.

## Guard rails

`packages/ai/src/__tests__/calibration.test.ts` plays 100 matches across all venues on every test run and fails if scoring leaves the band:

| Per innings | Allowed range |
| --- | --- |
| Average total | 132–162 |
| Fours | 10–16 |
| Sixes | 3–8 |
| Wickets | 5.8–8 |
| Dot balls | 29–45% of legal balls |

A second test checks that the **Player of the Match** always goes to the top contributor in the award model (batting, bowling, fielding and win-probability impact, with a bonus for the winning side) and that fewer than 20% of awards go to the losing side. About 9% do, usually for a century in a narrow defeat.

## What the calibration changed

| Problem | Cause | Fix |
| --- | --- | --- |
| Too many boundaries | Batters attacked almost every ball: about 72% attacking shots and 5% defensive | Shot choice now respects a well-executed ball (`respectWeight`): good balls are mostly defended or worked for one |
| Too many sixes | Lofted carry depended mostly on raw power, so strong hitters almost always cleared the rope | Carry depends more on timing (`carryBase`, `carryPerPower`, `carryQualityFloor`), so mistimed shots find the deep fielders |
| Too few wickets | Good balls rarely beat the bat; few edges | Raised the chance of being beaten and of edging (`missBias`, `edgeBias`), and the catch conversion base (`catchBase`) |
| Weaker leagues far below stronger ones | The engine amplified absolute rating differences, especially power | Physical scale (power and accuracy) is partly anchored to the standard of each match (`powerAnchor`, `controlAnchor`, `levelAnchoring`) |
| Wrong Player of the Match | The award was decided before the final ball's win probability was recorded, leaving an invalid value in the scores | The award is decided after the final ball, and missing values are ignored |

All constants are in `packages/config/src/simulation.ts`.

## Reproducing

```bash
npm test -- calibration      # the guard rails above
npm run lab -- 2000          # a wider report from N seeded matches
```

## Known limitations

- **Rating bias in weaker leagues.** Outside the IPL, playing XIs are built mostly from database players whose ratings are estimated from real records, and there the batters rate several points below the bowlers. Those leagues therefore score less than their real-world averages. Re-estimating the database ratings would fix it for new careers.
- **No dataset calibration.** The engine is tuned to broad T20 patterns, not fitted ball by ball to an imported dataset.
