# Architecture

## Layers

```
apps/web  ──HTTP/JSON──▶  apps/server  ──▶  packages/world ──▶ packages/ai ──▶ packages/simulation
 (React client)            (authority)         (career rules)     (decisions)      (ball-by-ball engine)
                                │                    │                  │                 │
                                ▼                    └──────────────────┴──▶ packages/domain + packages/config
                         SQLite (node:sqlite)
```

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `domain` | Entity types, derived ratings (`overall`, `battingRating`…), registration rules (`canRegister`, `canAfford`, `validateXI`) | — |
| `config` | League registry, club seeds, venues, engine constants (`SIM`), world config (`WORLD`), feature flags | domain |
| `simulation` | Seeded RNG, field geometry and legality, shot catalogue, ball-by-ball engine, pressure model, commentary, win probability | domain, config |
| `ai` | Tactical captain (bowling changes, fields, plans, intent, batting order, DRS), XI selection, match runner and exact replay | simulation |
| `world` | Career creation, auction cascade and bidding AI, competitions and standings, calendar, fatigue, injuries, morale, development, finance, board, WCC qualification and reputation, retentions | ai, simulation, data-ingestion |
| `data-ingestion` | Curated player seed, attribute expansion, generated players, validation, licensed-image manifest | domain, simulation |
| `apps/server` | Accounts and sessions, ownership checks, validation, transactions, persistence, live-match host, intelligence reports | everything above |
| `apps/web` | UI only. It imports pure geometry from `simulation` for client-side field previews, but never decides outcomes | simulation, config, domain |

The simulation and world packages are pure TypeScript with no I/O. The same code runs in tests, the simulation lab, the server and (geometry only) the browser.

## Authority model

The server is authoritative. The client sends decisions: a bid, a field placement, a bowler choice, a retention list. It never sends outcomes. Every mutation:

1. Is validated with zod.
2. Is checked for ownership: `CareerStore.load` returns 404 unless the session user owns the career, whatever ID is requested.
3. Runs inside a per-career async lock, so mutations never interleave.
4. Is committed in one `BEGIN IMMEDIATE` transaction, together with any match records it produced, guarded by an optimistic `version` check.
5. Can carry an `Idempotency-Key`. A retried request returns the stored response instead of re-applying.

If a mutation throws, the in-memory copy of the career is discarded and reloaded from the database, so a half-applied change can never be persisted or observed.

Auctions add a second guard: every action carries the auction `version` it was based on, and a stale action gets a 409. The AI's maximum bids live on the lot server-side and are stripped from every response (`publicAuction`). Its reasoning is revealed only after a lot closes.

## Determinism and replay

- A match is a pure function of `(MatchSetup, seed, logged user actions, controller timeline)`.
- The RNG (sfc32) state is part of `MatchState`, so a saved live match resumes on exactly the same random stream.
- AI decisions use the visible state and seeded hashes, never `Math.random()`.
- `replayMatch` (packages/ai) re-applies logged actions at their delivery sequence numbers. The test suite checks that a manually played match replays bit-for-bit.
- World events use `worldRng(w, label)`, a stream derived from the career seed, the season and the event label. The same seed and the same decisions produce the same world.
- Every stored match record keeps its seed and `engineVersion`. That is what verified leaderboards would need later.

## The match engine

Each delivery follows the specification's resolution order:

1. **Situation.** Phase, field legality (an illegal field means a no-ball), and the batting intent: the user's slider or the AI captain.
2. **Bowler.** Control is adjusted for spell fatigue, dew, form, pressure and day form. The bowler picks a length, line and variation from the bowling plan. Execution is checked: perfect, slight miss, or a loose ball.
3. **Extras.** Wides and no-balls, with free hits.
4. **Shot selection.** Weighted by how well the shot suits the length and line, the batting intent, the batter's style tags, and gaps in the field the batter can see.
5. **Contact.** Miss (bowled, LBW with umpire error and DRS, stumping, byes, leg-byes), edge (which slips, keeper and gully can catch), or a contact-quality draw. The skill gap, pitch, movement and pressure all feed in.
6. **Ball flight.** Ground balls decelerate along a path. Each fielder's reaction, speed and reach decide whether they can intercept, with misfields possible. Aerial balls have carry and hang time against each fielder's running catch radius, including boundary catches.
7. **Running.** Ball-back time (gather plus throw distance over throwing speed) against the batters' run times and their risk appetite. Tight runs carry a chance of a run-out.
8. **Bookkeeping.** Scorecard, partnerships, fall of wickets, over summaries with zone-by-zone analysis and runs saved, win probability, and commentary generated from the event itself.

About 80 tunable constants live in `packages/config/src/simulation.ts` (`SIM`) and are calibrated with `npm run lab`. See [BALANCE_REPORT.md](BALANCE_REPORT.md).

## World ticks

The calendar is day-based (day of year). `advance(w, mode)`:

1. Resolves knockout participants (`winner:` and `loser:` references).
2. Simulates every AI fixture due today through the engine. It stops if the user has a fixture today, unless the assistant is set to auto-play.
3. Recovers every player: fatigue, workload decay, injury rehab scaled by the medical facility.
4. Creates playoffs when a league stage finishes, completes leagues, creates the WCC when all leagues are done, and advances WCC rounds.

All of this is idempotent. A fixture that is already complete throws instead of being applied twice, and the career row's version check prevents double commits.

The season cycle is retention → auction cascade → pre-season → season → WCC → off-season (awards, development, retirements, youth intake, reputation update, qualification allocation, board review) → next season.

## Persistence shape

The career is a versioned aggregate (`WorldState`), stored gzip-compressed in SQLite, with separate append-only tables for match records, live matches, audit entries and idempotency keys. [DATABASE.md](DATABASE.md) explains this choice and the normalised PostgreSQL target.
