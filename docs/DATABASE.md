# Database

## What ships today (SQLite via `node:sqlite`)

Migrations live in `apps/server/src/db.ts` and are applied in order on startup. The `schema_migrations` table records which have run.

| Table | Purpose | Key |
| --- | --- | --- |
| `users` | Local accounts (scrypt password hash) | `id`, unique `username` |
| `sessions` | Opaque httpOnly session tokens with expiry | `token` |
| `careers` | One row per save slot: owner, versioned world aggregate (gzip JSON), season, phase | `id`, index on `user_id` |
| `match_records` | Every completed match (AI and user), with seed, engine version and the full delivery log (gzip) | `(career_id, fixture_id)` |
| `live_matches` | In-progress matches (`main`) and Scenario Lab replays (`lab`), with their own version counter | `(career_id, slot)` |
| `audit_log` | Every mutation: who, what, when | autoincrement |
| `idempotency` | Stored responses for retried mutations | `(user_id, key)` |

Foreign keys cascade from `users` → `careers` → records. All writes that belong together (world, match records, audit) commit in a single `BEGIN IMMEDIATE` transaction.

### Why a versioned aggregate for the world?

One career is a single-writer universe of about 1,300 players and 73 clubs, and every mutation (a bid, a match day) touches many of them at once. Keeping that state as one versioned aggregate makes every operation atomic, gives optimistic concurrency for free, keeps the game playable with zero infrastructure, and loads in milliseconds. Per-ball data, which grows without bound, is kept out of the aggregate in `match_records`.

Each season the aggregate prunes fixtures and competitions older than two seasons (results stay in `history`, the awards list and `match_records`), so its size stays roughly flat over decades.

## Target relational schema (PostgreSQL)

For multi-user hosting, analytics across careers, or leaderboards, the aggregate maps onto the normalised model below. Every entity already exists as a typed structure in `packages/domain/src/types.ts`, so migration is a mapping exercise, not a redesign.

| Spec entity | Source in `WorldState` / tables | Notes |
| --- | --- | --- |
| User, Account, SaveSlot, Career, ManagerProfile | `users`, `careers` (+ `managerName`, `difficulty`, `formerClubs`) | |
| Country, League, LeagueSeason, Club, Venue | `config` registry + `w.leagues`, `w.competitions`, `w.clubs` | League config is static; LeagueSeason = Competition |
| Player, PlayerAlias, PlayerAttributes | `w.players[id]`, `attrs` | Aliases: planned with the data-provider importer |
| PlayerStatistics, PlayerSeasonStatistics | `player.stats.career`, `player.stats.seasons["season:competition"]` | Derivable from `match_records` |
| PlayerImage, DataSource, DataImportJob | `player.image`, image manifest | |
| Contract, ContractClause | `player.contract` | Clauses: planned |
| Transfer, TransferLedger | `w.ledger` (immutable, append-only) | |
| Auction, AuctionLot, AuctionBid, AuctionResult | `w.auctions` (lots carry bids and result) | |
| SquadRegistration, PlayerAvailability | `club.squad`, `player.injury`, `player.fatigue` | |
| Fixture, Match, MatchInnings, MatchOver, Delivery, MatchEvent | `w.fixtures` + `match_records` (innings, overs, deliveries) | |
| MatchTactics, FieldTemplate, FieldPosition | `club.defaultTactics`, `club.fieldTemplates` | |
| Tournament, TournamentEdition, QualificationSlot, TournamentEntry | `w.competitions['WCC-season']`, `league.wccSlots`, `meta.qualifiers` | |
| Standings, RankingSnapshot, ReputationHistory | `competition.standings`, `league.reputationHistory` | |
| TrainingPlan, Injury, MedicalAssessment, FatigueSnapshot | `club.training`, `player.injury`, `injuryHistory` | |
| MoraleEvent, PlayerDevelopmentHistory, YouthProspect | news items, `player.development`, `club.academy` | |
| Coach, Scout, Facility | `club.coaches`, `club.facilities` | |
| Sponsorship, FinancialTransaction, ClubBudget | `w.finances[clubId]` | |
| NewsEvent, Trophy, SeasonAward, HallOfFameRecord | `w.news`, `club.trophies`, `w.awards`, `w.hallOfFame` | |
| WorldTick, SimulationJob, AuditLog | `audit_log`; ticks are the `continue` mutations | |

Recommended PostgreSQL practice for the move: one schema per concern; `careers.version` for optimistic locking; JSONB only for match event payloads and configuration snapshots; unique constraints on `(career_id, player_id)` registrations per season, so a player can never be registered twice; and `SERIALIZABLE` transactions for auction acceptance.
