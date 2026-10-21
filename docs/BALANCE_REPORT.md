# Simulation balance report

Reproduce with `npm run lab -- 2000`. The lab snake-drafts 10 squads from the curated player pool (at most 5 overseas each), picks XIs with the selection AI, and plays seeded T20 matches at Indian venues with AI captains on both sides. Every match uses the same engine as career play.

## Results (2,000 matches, engine `kurciv-t20-1.0.0`)

| Metric | Kurciv | Reference: modern men's franchise T20 (approximate) |
| --- | --- | --- |
| 1st-innings total (mean) | **183.5** | IPL 2024–25 era ≈ 185–195; global T20 ≈ 160–170 |
| 1st-innings total (5th / 50th / 95th percentile) | 98 / 182 / 270 | — |
| Wickets per 1st innings | **7.0** | ≈ 6.5–7 |
| Powerplay (overs 1–6) | **63** | ≈ 55–65 |
| Death (overs 16–20) | **62** | ≈ 55–65 |
| Dot balls | **32.0%** | ≈ 33–37% |
| Singles | **39.2%** | ≈ 35–40% |
| Twos / threes | 8.6% / 0.5% | ≈ 6–8% / <1% |
| Fours | **12.2%** | ≈ 11–13% |
| Sixes | **7.5%** | ≈ 6–8% |
| Wides per innings | 3.9 | ≈ 4–6 |
| No-balls per innings | 0.5 | ≈ 0.5–1 |
| Dismissals: caught (incl. keeper) / bowled / LBW / run out / stumped | 69% / 15% / 9% / 5% / 2% | ≈ 65–70% / 15–20% / 8–12% / 5–7% / 2–3% |
| Catch conversion | 79% | ≈ 80–85% |
| Chasing side wins | 58.3% | ≈ 50–55% (dew-heavy evening venues favour chasing) |
| Super overs | 29 in 2,000 (1.5%) | ≈ 1% of matches tied |

Calibration targets were set from broad, publicly reported patterns of recent IPL seasons and modern franchise T20, not from an imported dataset. A Cricsheet-based calibration pass is on the roadmap.

## Strength, pressure and tactics

| Check | Result |
| --- | --- |
| Stronger XI wins: rating gap < 1 / 1–3 / > 3 | 57% / 75% / 80% |
| Batter under pressure (index ≥ 0.35) | 1.51 runs per ball, a wicket every **9.1** balls |
| Batter calm (index < 0.05) | 1.48 runs per ball, a wicket every **19.0** balls |
| Tired, out-of-form XI (form −6, fatigue 60) | Win rate drops by more than 5 points against baseline (automated test) |
| Field placement | Five boundary riders give **fewer fours and more singles** than a seven-in-the-ring field (automated test) |
| Illegal fields from AI captains | 0 deliveries |
| Runs saved by fielders | ≈ 90 per innings, counterfactual against an empty field along each ball's path |

Pressure includes the required rate, dot-ball streaks, collapses, milestone nerves, defending tight finishes and boundaries conceded. It is scaled by temperament and match importance. Under pressure batters score slightly faster (they must attack) but get out about twice as often.

## Known deviations and follow-ups

- **Score spread is wide.** The first-innings standard deviation is 51, against roughly 30–35 in real T20. Part of this is the lab itself: its snake-drafted squads differ by up to 9 XI-rating points. Some is genuine boom-or-bust from aggressive intent combined with powerful hitters. Next step: calibrate against Cricsheet innings distributions and dampen extreme high-power innings.
- **Rating gaps are slightly decisive.** A 1–3 point XI gap converts to about 75% wins. Real T20 is closer to 60–65%. The skill-gap sensitivity (`delta` divisor, `missSkill`, `qualitySkill`) can be lowered further. That was held back to keep good players visibly better.
- **Chasing advantage (58%) is a few points high.** The lab uses evening matches at dew-prone Indian venues. Dew strength may need a small reduction.
- **Performance.** About 21 ms per match on a laptop, so a full world season (about 520 matches) simulates in roughly 10–20 s.

## How the world behaves (`npm run world-report`)

One full season with seed `report`:

- **IPL auction.** 235 players sold, 222 lots unsold. The 12 most expensive buys went for ₹19.75–31.75 Cr (Klaasen ₹31.75 Cr, Rashid Khan ₹28.75 Cr, Pooran ₹27.75 Cr, Bumrah ₹25.75 Cr). An aggressive contender spent its purse down to ₹0.05 Cr; conservative and value-hunting clubs kept ₹6–11 Cr.
- **AI reasoning sample.** "BLR on Sarfaraz Khan: short of batters (3/6); +1.3 to best-XI rating; similar options still to come".
- **World Club Championship.** 50 qualifiers; preliminary knockout → 8 groups → round of 16 → final. This run's champion was Perth Flames (Southern Cross T20, Australia).
- **Reputation after one season.** IPL 95 → 97.2 (+2.2, 8 places next season); Southern Cross 79 → 81.4 (+2.4); Aotearoa 58 → 55.1 (−2.9). Moves are capped at ±4 per season.
