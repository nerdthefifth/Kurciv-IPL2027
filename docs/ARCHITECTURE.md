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
| `config` | League registry, club seeds, venues, engine constants (`SIM`), world configuration, feature flags |
| `simulation` | Seeded RNG (sfc32), field geometry, shot catalogue, the ball-by-ball engine, DRS evidence, Player of the Match model, win probability, commentary |
| `ai` | Captain AI (bowling changes, plans, batting intent, order, reviews), XI selection (pitch-aware), match runner and exact replay |
| `world` | Career creation, auction cascade and bidding AI, competitions, calendar, fatigue, injuries, morale, development, finance, board, World Club Championship, retentions, captaincy, cap races, and the Club World |
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
- **Performance.** The render loop stops when nothing moves, and the resolution drops if frames slow down.
- **Fallback.** Without WebGL, the 2D board is used.

## Season cycle

Retention → auction cascade → pre-season → season (captains named, cap races run) → World Club Championship → off-season (awards, development, retirements, youth intake, reputation, qualification places, board review) → next season.

## Persistence

See [DATABASE.md](DATABASE.md).
