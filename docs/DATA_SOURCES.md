# Data sources, permissions and limitations

## What is in the build

| Data | Source | Status |
| --- | --- | --- |
| **342 curated player identities** (name, country, birth year, role, batting hand, bowling style) | Hand-curated in `packages/data-ingestion/src/curated.ts` from public knowledge | Facts about public sportspeople. Birth years are best effort and estimated ages are flagged in the UI. |
| **Player database** of 10,000 records | Built from [Cricsheet](https://cricsheet.org) (ODC-BY 1.0); see below | Real identities and real 2024–26 records. Ratings, styles and ages are estimates and labelled as such. Generated players are marked fictional. |
| Player **ratings** | Editorial estimates (curated players) or estimates derived from real records (database players) | **Not official data.** Labelled as estimates in player profiles. |
| In-career **statistics** | Produced only by this game's simulation | Every career starts its statistics at zero. Real-world records are shown separately and never mixed in. |
| Clubs and competitions | Real franchise and league names, colours and venues | Names belong to their owners. This is an unofficial fan project, not affiliated with or endorsed by any league, club or player. Edit `packages/config/src/leagues.ts` to change them. |
| Venues | Real ground names with approximate dimensions and capacities | Factual geography. The 3D stadiums are original procedural modules, not replicas. |
| Fictional clubs and grounds | 17 invented clubs and grounds in `packages/config/src/universe.ts` | Original. Each fictional ground records its provenance. |
| Fictional players | 10,000 generated players in every new pyramid career | Generated deterministically from the world seed; labelled fictional everywhere. |
| National teams | 24 nations with fictional AI managers | Nation names are factual; managers are invented. |
| Coaches | Fictional | Not presented as real staff. |
| Cricket Feed accounts and posts | Generated from in-game events | Fictional. Real players never "post"; only fictional generated players have accounts. |
| Team badges and player cutouts | [TheSportsDB](https://www.thesportsdb.com) public API, fetched at runtime and cached in the browser | Team badges are trademarks, shown for personal, non-commercial play and credited. Nothing is bundled. |
| Player and stadium photos | Wikipedia lead images, accepted only when hosted on Wikimedia Commons, fetched at runtime | Author and licence are recorded and shown with each image. |
| 3D player models | "Cricketers Pack (Low Poly)" by P3D Labs, CC BY 4.0 | Bundled; see below. |

If an image service is unavailable, the game falls back to original crests and silhouettes, so gameplay never depends on it.

Before any public or commercial release, review the publicity and image-rights position for real player names and the trademark position for league and club names and badges in your jurisdiction. All of them can be replaced through configuration.

## Validation

`npm run validate-data` (`packages/data-ingestion/src/cli.ts`) checks the curated seed for duplicate identities, implausible ages and out-of-range skills, bowlers and all-rounders without a bowling style, and invalid batting hands or capped flags. The test suite runs the same validation. The player database has its own validation report in [PLAYER_DB_REPORT.md](PLAYER_DB_REPORT.md).

## Limitations

- Ratings are estimates. Disagreement is expected; curated ratings can be edited in `curated.ts`.
- Real players' 2027 club affiliations are unknown, so every career starts with a full auction. Nobody is pre-assigned to a franchise.
- Some birth years may be off by a year.
- International cricket is modelled in new careers: call-ups make players unavailable to their clubs for the event. Eligibility uses each player's single sporting nationality.
- Outside the IPL, database players' estimated ratings leave batters rated below bowlers, which lowers scoring in those leagues (see [BALANCE_REPORT.md](BALANCE_REPORT.md)).

## Player database (Cricsheet)

The player database (`packages/data-ingestion/data/player-db.json`, game form `player-db.game.json`) is built by
`npm run ingest` (`tools/ingest-cricsheet.ts`; add `--download` to refresh the source files).

- **Source:** [Cricsheet](https://cricsheet.org) match data and people register, made available under the
  [Open Data Commons Attribution License 1.0](https://opendatacommons.org/licenses/by/1-0/). This product uses Cricsheet data; every record keeps its Cricsheet id as provenance.
- **Facts taken from the data:** identity and name variants, gender, teams and competitions, formats, first/last appearance (2024–2026 window) and the real-world record for that window.
- **Nationality:** verified from international appearances in any year Cricsheet publishes; otherwise inferred from strictly domestic competitions of a single country (or IPL-only careers, since Indian players may not play overseas leagues); otherwise unknown. Cricsheet publishes no Afghanistan matches, so Afghan players are verified only through the curated list.
- **Estimated (game data, labelled in the UI):** ratings (calibrated against the curated editorial ratings), bowling style, batting hand and age — Cricsheet does not record these.
- **Generated players** complete the database to 10,000 records and are marked as fictional.
- The current validation report is in `docs/PLAYER_DB_REPORT.md`.


## 3D player models

The 3D match view uses **"Cricketers Pack (Low Poly)" by P3D Labs**, published on Sketchfab
(https://sketchfab.com/3d-models/cricketers-pack-low-poly-a16e3f072a714e2ab382d036c42ab3a6)
under the Creative Commons Attribution 4.0 licence. The file is bundled as
`apps/web/public/models/cricketers.glb`.

Changes made: the static meshes are rigged at load time (a generated skeleton with weights
assigned by body region), and the kit textures are repainted per franchise in the team's
colours with its short name. The original country kits are not used. Credit is shown in the
match view.
