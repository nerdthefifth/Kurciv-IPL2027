# Configuration

All game rules are data in `packages/config`. Changing them needs no code changes. Rebuild (or reload the dev server) after editing; existing careers keep the world they were created with, except where a rule is read live (squad rules, auction increments, engine constants).

## Leagues — `packages/config/src/leagues.ts`

Each entry in `LEAGUES` is a `LeagueConfig`:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `shortName`, `country`, `region` | Identity. `fictional: true` marks invented competition names. |
| `initialReputation` | 0–100 seed for a new career. The IPL starts highest (95). |
| `commercialValue`, `audience` | Drive sponsorship, gate income and structural reputation. |
| `rounds`, `playoffs` | `1` or `2` round-robin; playoffs `ipl4` (Q1, Eliminator, Q2, Final), `semis`, `final2` or `none`. |
| `squadRules` | `maxSquad`, `minSquad`, `maxOverseas`, `maxPerOverseasCountry`, `maxOverseasInXI`, `maxRetentions`, `retentionCosts[]` (capped-player slabs), `uncappedRetentionCost`. |
| `auctionRules` | `purse`, `minBase`, `increments[]` (price thresholds and step), `unsoldRound`, `bidSeconds`. The `auction()` helper scales IPL-style increments to the purse. |
| `domesticCountries` | Countries that register as domestic (e.g. England league: ENG, IRE, SCO). |
| `seasonStartDay` | Day of year the league season starts. |
| `prizeMoney` | Champion, runner-up and playoff prize (₹ crore, in the game's single currency). |

Defaults follow the specification: 25-player squads, 5 overseas, at most 2 per overseas country, 6 retentions. The Desert and Liberty leagues have thin domestic talent pools, so they deliberately allow more overseas players.

`CLUB_SEEDS` lists each league's clubs: name, city, home venue, colours, auction personality and brand. `EXPORT_RESTRICTIONS` limits where a country's players may register. By default Indian players only register in the IPL.

## Venues — `packages/config/src/venues.ts`

Boundary sizes in metres (straight from the striker, square from the pitch centre), altitude, dew chance, and a pitch profile: `pace`, `spin`, `bounce`, `batting` (each −1 to 1) and `wear` (deterioration per innings). Surface presets are `flat`, `green`, `dry`, `slow` and `balanced`.

## Match engine — `packages/config/src/simulation.ts` (`SIM`)

About 80 constants, grouped:

| Group | Examples |
| --- | --- |
| Geometry | `strikerY`, `circleRadius`, keeper positions |
| Fielder physics | reaction time, run speed, ground and catch reach, ball deceleration, throw speed, pick-up time |
| Running | first and subsequent run times by rotation skill, risk margins, caution on extra runs, head start on rotation shots |
| Delivery execution | execution chance by control, loose-ball share, wide and no-ball rates |
| Contact model | logistic coefficients for misses and edges; contact-quality mean and spread and their sensitivities |
| Ball flight | carry and ground-speed formulas |
| Wickets | chance of hitting the stumps by line, stumping chance, umpire error rates, catch probability |
| Conditions | dew penalties, fatigue per over, form weight, new-batter penalty |
| Shot selection | `intentSharpness`, `respectWeight` (how strongly batters respect a well-executed ball) |
| Match standard | `powerAnchor`, `controlAnchor`, `levelAnchoring`: how far power and accuracy are judged against the standard of the match rather than absolute ratings |
| Version | `engineVersion`, recorded on every match; bump it when outcomes change |

Change these, then run `npm test -- calibration` (the guard rails) and `npm run lab -- 2000` (a wider report) to see the effect. See [BALANCE_REPORT.md](BALANCE_REPORT.md).

## World — `packages/config/src/world.ts` (`WORLD`)

- **`reputation`**: `learningRate` (default 4) applied to the stage-weighted mean residual (actual − Elo-expected), scaled by √matches; `stageWeights` (prelim 0.6, group 1, knockout 1.6, final 2.2); `reversion` (0.04 per season) toward structural strength (founding reputation, commercial value and current squad quality); `maxDelta` (4 per season); clamped 0–100.
- **`wcc`**: `maxTeams` (50), `regionalReserve` (0 = disabled), `minSlotsPerLeague`, `maxSlotsPerLeague` (9), `maxShareOfClubs` (0.8), allocation `weights` (reputation 0.7, history 0.2, depth 0.1) and `reputationExponent` (2.2). Allocation uses largest remainders with deterministic tie-breaks, and redistributes places a league cannot fill. The tournament format is generated from the qualifier count (`planFormat`): a preliminary knockout down to 32, 16, 8 or 4 teams; groups of 4; then a knockout bracket.
- **`development`**: youth growth, playing-time and coaching weights, decline start and rate, retirement age.
- **`condition`**: fatigue recovery per day, injury base risk, workload decay.
- **`morale`**: deltas for wins, losses, bench and performance; the threshold for a transfer request.
- **`youth`**: prospects per club per season, elite chance, academy size.
- **`finance`**: ticket income, sponsorship and broadcast as shares of the league purse, facility upkeep and upgrade costs.

## Feature flags — `FEATURE_FLAGS`

`impactPlayer`, `sealedBids`, `odiEngine`, `testEngine`, `nationalTeamMode` and `loans` are all `false`. They mark planned systems (see [ROADMAP.md](ROADMAP.md)). Turning one on does not enable unfinished code.

## Difficulty

The `rookie`, `professional`, `elite` and `legend` settings map to the AI captains' `tacticalQuality` (0.35 / 0.55 / 0.72 / 0.88, adjusted by each club's head coach). Quality changes decision noise, matchup awareness, adaptation speed, gap-plugging and batting-order changes. It never changes player abilities or match probabilities.
