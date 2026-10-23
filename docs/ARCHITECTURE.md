# Architecture

Kurciv runs entirely in the browser. The React interface talks to a backend that runs inside a **Web Worker**. That backend owns the game rules, the simulation and the save files, so the interface stays responsive while matches and seasons simulate.

```
 Main thread                                   Web Worker (apps/web/src/engine/worker.ts)
┌──────────────────────────────┐   messages   ┌──────────────────────────────────────────────┐
│ apps/web  (React, Tailwind)  │ ───────────▶ │ packages/app-core  Backend: route table,      │
│  pages, components           │  api(path)   │   validation, locks, views, match reports     │
│  3D view (three.js, lazy)    │ ◀─────────── │      │                                        │
└──────────────────────────────┘    JSON      │      ▼                                        │
                                              │ packages/world ─▶ packages/ai ─▶ packages/simulation
                                              │ (career rules)     (decisions)    (ball-by-ball engine)
                                              │      │                                        │
                                              │      ▼  packages/domain + packages/config     │
                                              │ IndexedDB (Dexie) — careers, worlds, matches  │
                                              └──────────────────────────────────────────────┘
```

| Package | Responsibility |
| --- | --- |
| `domain` | Entity types, derived ratings (`overall`, `battingRating`…), registration rules (`validateXI`, `canRegister`), countries, Club World types |
| `config` | League and division registry, club seeds (real and fictional), the stadium catalogue, regions, nations, engine constants (`SIM`), world configuration, feature flags |
| `simulation` | Seeded RNG (sfc32), field geometry, shot catalogue, the ball-by-ball engine for T20, ODI and Test rules, DRS evidence, Player of the Match model, win probability, commentary |
| `ai` | Captain AI (bowling changes, plans, batting intent, order, reviews), XI selection (pitch-aware), match runner and exact replay |
| `world` | Career creation, auction cascade and bidding AI, competitions, calendar, fatigue, injuries, morale, development, finance, board, World Club Championship, retentions, captaincy, cap races, the Club World, and `universe/` (pyramid, continental cups, preseason friendlies, international cricket, phase lifecycle) |
| `data-ingestion` | Curated players, the 10,000-player database built from Cricsheet, generated players, validation |
| `app-core` | The storage-agnostic `Backend` (a route table such as `GET /careers/:cid/squad`), views, match reports, save portability, and the IndexedDB adapter |
| `apps/web` | UI only. It sends decisions and renders state; it never decides an outcome |

`simulation` and `world` are pure TypeScript with no I/O. The same code runs in unit tests, the simulation lab and the browser worker.

## The worker backend

The interface calls `api('/careers/<id>/…', { body })`, which posts a message to the worker. The backend validates the request with zod and then either:

- **reads** a view of the current world, which never changes anything; or
- **mutates** through `Backend.mutate`, which:
  1. runs under a per-career lock, so changes never interleave;
  2. applies the change to the in-memory world, discarding that copy if anything throws;
  3. runs the Club World observer (`clubWorldSync`) to turn what just happened into events;
  4. commits the world, metadata and any new match records in **one IndexedDB transaction**, guarded by a version number.

Live matches have their own slot (`main`, or `lab` for Scenario Lab replays) with a separate version counter. Every step carries the version it was based on, so a stale or duplicate request is rejected instead of being applied twice.

## Determinism

- A match is a pure function of its setup, seed, logged decisions and the controller timeline (who was in charge of each side when).
- The RNG state is part of `MatchState`, so a saved live match resumes on exactly the same random stream.
- AI decisions use visible state and seeded hashes, never `Math.random()`.
- World events draw from `worldRng(w, label)`, derived from the career seed, the season and a label. The same seed and the same decisions give the same world.
- Every stored match keeps its seed and `engineVersion` (currently `kurciv-t20-1.3.0`).
- Pyramid seeding, promotion and relegation, generated players (`f-<country>-<n>`), friendlies chosen by AI clubs and international schedules all derive from the career seed and the configuration.

## The match engine (`packages/simulation/src/engine.ts`)

Each delivery is resolved in this order:

1. **Situation.** Phase, the standard field for that phase (mirrored for left-handers; the keeper stands up to spinners), and batting intent from your approach setting or the captain AI.
2. **Bowler.** Control after spell fatigue, dew, form, pressure and day form. The bowler picks length, line and variation from the bowling plan, and execution decides whether the ball lands as planned, slightly off, or as a loose ball.
3. **Extras.** Wides, no-balls and free hits.
4. **Shot selection.** Weighted by how well each shot suits the length and line, the batter's intent and style, gaps in the field, and how good the delivery is: well-executed balls are mostly defended or worked for singles.
5. **Contact.** A miss (bowled, LBW with umpire error and DRS, stumping, byes), an edge (caught behind or in the slips), or a timing-quality draw driven by the batter-versus-bowler skill gap.
6. **Ball flight.** Ground shots slow along their path until a fielder (with reaction time, speed and reach) cuts them off or they reach the rope. Lofted shots have carry and hang time against each fielder's catching range. Physical scale (power and accuracy) is judged partly against the standard of the match, so every league plays like T20 at its own level.
7. **Running.** The time to get the ball back against the batters' running speed and appetite for risk. Tight runs can bring run-outs.
8. **Bookkeeping.** Scorecard, partnerships, fall of wickets, over summaries, win probability, commentary, and the Player of the Match once the final ball is recorded.

About 80 tunable constants live in `packages/config/src/simulation.ts` (`SIM`). `packages/ai/src/__tests__/calibration.test.ts` fails if scoring drifts out of the target band (see [BALANCE_REPORT.md](BALANCE_REPORT.md)).

## The global universe (`packages/world/src/universe/`)

A career has a `worldModel`: `'pyramid'` for new careers, or `'leagues'` for older saves. Every place that used to loop over the national leagues now calls `activeLeagues(w)`, and every overseas or registration check now asks `domesticOf(club)`. The same auction, competition, playoff, award and board code therefore runs unchanged on divisions.

- `pyramid.ts`: seeding, the membership snapshot, deterministic promotion and relegation, parachute payments and bonuses.
- `continental.ts`: qualification scores, regional cups (groups, semi-finals, neutral finals), coefficients, and Global Club Championship qualifiers. The championship reuses the World Club Championship engine with an explicit entrant list and regional hosting.
- `preseason.ts`: friendly validation, preview, booking and cancellation; AI friendlies; reduced-weight effects.
- `international.ts`: nations, format ratings, squad selection, call-ups and duty, scheduling for both windows, simulated international matches, tournament progression, rankings, appointments and squads.
- `lifecycle.ts`: `enterPreseason`, which tops up a short user squad, schedules AI friendlies and the preseason internationals, refreshes job offers and records divisional membership.

**Season cycle (pyramid).** Retention → auction cascade (divisions in tier order) → preseason (friendlies and internationals) → divisional season → continental cups → Global Club Championship → international window → off-season. The off-season covers promotion and relegation, awards, development, coefficients and rankings.

**Calendar guarantees.** League fixtures are round-based, so a club plays at most once a day. Cups and the Global Club Championship start only after every division is complete. International windows sit in the preseason and after the club season, and a nation is never booked twice on one day (Tests occupy five days). Club selection skips players on duty.

## Club World (`packages/world/src/clubworld/`)

One event log drives the inbox, news, conversations, promises, boardroom and social feed, so they can never contradict each other.

- **Observer (`sync.ts`).** Reads simulation records (completed fixtures, the transfer ledger, injuries, competitions) and emits one event per new record. Cursors and event keys make this idempotent: refreshing or reloading emits nothing new.
- **Subscribers.** `media.ts` writes news, posts and rumours. `inbox.ts` sends staff mail. `conversations.ts` raises player concerns. `promises.ts` judges promises against team sheets and the ledger. `board.ts` moves confidence and writes reviews.
- **Delivery.** Items carry an in-game date and appear when the calendar reaches it. Daily work (deadlines, reminders, reviews) runs once per game day.

## 3D presentation (`apps/web/src/pages/match/three/`)

The 3D view is lazy-loaded and never decides anything.

- **Playback.** When a ball is played, the worker resolves it first. The view then animates the recorded event (line, length, speed, shot, contact, angle, where the ball finished, who fielded it, the dismissal), and only after that does the score update.
- **Fielders.** `fieldForDelivery` (in the engine) reports exactly where each fielder stood.
- **Players.** The P3D Labs cricketer mesh is rigged at load time with a generated skeleton, and its bones follow a procedural animation rig. Kits are repainted per franchise.
- **Renderer.** PBR materials with filmic tone mapping. `stadium.ts` injects GLSL into standard materials (`onBeforeCompile`):
  - the outfield gets mowing stripes, fbm noise, wear around the square and a rough band by the rope;
  - the pitch gets cracks and footmarks driven by a `uWear` uniform that rises through the match.

  It also adds a gradient sky dome with a sun for day matches, floodlights for evening matches, and the venue's tiers, roof, light style, colours and skyline from its catalogue identity. `stage.ts` adds a seamed ball texture (red for Tests), a ball trail, and an optional post-processing chain (bloom, colour grade and vignette, loaded on demand). The presets (`PRESETS`: Low, Medium, High, Ultra) set pixel ratio, shadows, post-processing, crowd density, grass detail and trail length.
- **Performance.** The render loop stops when nothing moves, and the resolution drops if frames slow down.
- **Fallback.** Without WebGL, the 2D board is used.

## Season cycle

Retention → auction cascade → pre-season → season (captains named, cap races run) → World Club Championship → off-season (awards, development, retirements, youth intake, reputation, qualification places, board review) → next season.

## Persistence

See [DATABASE.md](DATABASE.md).
