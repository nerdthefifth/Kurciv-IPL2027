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
