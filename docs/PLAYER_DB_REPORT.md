# Player database report

Built 2026-10-21 from Cricsheet match data (2024, 2025, 2026; 7172 matches) and the Cricsheet people register — Open Data Commons Attribution License 1.0 — plus the Kurciv curated list and generated players.

| Measure | Count |
|---|---|
| Unique player records | 10000 |
| Real players | 7580 |
| Real players active in the window (appeared within 365 days of the latest match) | 5226 |
| — of which nationality verified from international appearances | 3869 |
| — of which nationality inferred from a home-country competition | 1106 |
| — of which nationality unknown | 251 |
| — men / women | 3642 / 1584 |
| Real players marked stale (last seen over a year before the latest match) | 2354 |
| Curated players matched to a Cricsheet identity | 341 |
| Generated players (fictional, marked as such) | 2420 |
| Validation issues | 0 |
| Real players sharing a name and country (kept separate by Cricsheet id) | 8 |

## What is fact and what is estimated

- **Facts (from Cricsheet):** identity and aliases, gender, teams, competitions, formats, first and last appearance in the window, and the real-world record for the window.
- **Nationality:** verified only from international appearances; otherwise inferred from a home-country competition (labelled), otherwise unknown.
- **Estimated (game data, never presented as fact):** ratings, calibrated by linear fit against 195 batting and 224 bowling curated editorial ratings; bowling style (pace v spin from the share of new-ball and death overs); batting hand; age. Cricsheet does not record styles, handedness or dates of birth.
- **Generated players** are fictional and flagged as generated.

Validation: no issues.

Re-run with `npm run ingest` (add `--download` to refresh the source files). Player ids are stable (Cricsheet id), so updating the database never touches a saved career.
