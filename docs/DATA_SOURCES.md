# Data sources, permissions and limitations

## What is in the build

| Data | Source | Status |
| --- | --- | --- |
| **342 real player identities** (name, country, approximate birth year, role, batting hand, bowling style, capped flag) | Hand-curated in `packages/data-ingestion/src/curated.ts` from public knowledge | Facts about public sportspeople. Birth years are best-effort and marked `ageConfidence: curated`; the UI flags estimated ages. |
| Player **ratings** (bat and bowl skill, style tags) | Kurciv editorial estimates | **Not official data.** Labelled as estimates in every player profile. |
| Player **statistics** | Generated only by this game's simulation | Every career starts all players at zero. No real-world records are imported or shown as history. |
| Generated players | `generatePlayer` with fictional name pools | Labelled "Gen" in the UI and `source: generated` in data. Not real people; any resemblance is coincidental. |
| Clubs and competitions | Fictional names (`CLUB_SEEDS`), apart from the league name "Indian Premier League" used by the product title | Club names, colours and codes are original. Edit `config/leagues.ts` to change them. |
| Venues | Real ground names and approximate dimensions | Factual geography; dimensions are approximate. |
| Coaches | Fictional initials and surnames | Not presented as real staff. |
| Portraits | None shipped | Silhouette fallback (see below). |

Before any public or commercial release, review the publicity and image-rights position for real player names in your jurisdiction, and for the "IPL" mark. Both can be replaced through configuration without code changes.

## Validation pipeline

`npm run validate-data` (`packages/data-ingestion/src/cli.ts`) checks the curated seed for:

- duplicate identities (slug collisions)
- implausible ages and out-of-range skills
- bowlers and all-rounders with no bowling style
- bad batting hands or capped flags

The test suite runs the same validation.

## Adding licensed portraits

The image layer (`packages/data-ingestion/src/images.ts`) accepts portraits only from a manifest. Each entry must have:

```json
{
  "playerId": "p-virat-kohli",
  "url": "https://…",
  "sourceUrl": "https://commons.wikimedia.org/wiki/File:…",
  "attribution": "Photo by … / CC BY-SA 4.0",
  "licence": "CC BY-SA 4.0",
  "lastChecked": "2026-10-01"
}
```

- Accepted licences: CC0, CC BY x.y, CC BY-SA x.y, Public domain, or `Licensed: <provider and agreement reference>`.
- URLs must be https. Entries without attribution or a recognised licence are rejected and reported.
- Point `KURCIV_IMAGE_MANIFEST` at the file. Portraits are applied to new careers.
- The UI lazy-loads images, shows the attribution as a tooltip, and falls back to the silhouette if an image fails, so a provider outage never affects gameplay.

Never scrape arbitrary sites or hotlink images without permission, and never assume a visible photo may be redistributed.

## Recommended future sources

- **Cricsheet** (https://cricsheet.org): structured ball-by-ball data. Good for calibrating engine distributions (dot%, boundary%, phase scoring) and deriving pace and spin splits. Check its licence and attribution terms before importing. A Cricsheet adapter is on the roadmap. It would feed a separate `PlayerHistoricalStats` table, clearly distinguished from in-career statistics.
- **A licensed cricket data provider** for verified dates of birth, squads and portraits, behind the same adapter interface. Imports must record source, licence status, import time and confidence, and must not overwrite better-verified records.
- **Wikimedia Commons** for individually licensed portraits, using the manifest format above.

## Limitations

- Ratings are subjective estimates. Disagreement is expected and they can be edited in `curated.ts`.
- Real players' 2027 club affiliations are unknown, so every career starts with a full auction. Nobody is pre-assigned to a franchise.
- Birth years may be off by a year for some players.
- International call-ups are not modelled. Players are available to their clubs all season.

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
