# Persistence

Careers are stored in the player's own browser with **IndexedDB** (through Dexie), in a database named `kurciv-ipl-2027`. Nothing is sent to a server. The storage code is `packages/app-core/src/idb-adapter.ts`, behind a `PersistenceAdapter` interface (`persistence.ts`), so another store could be added without touching game code. The tests use an in-memory adapter.

## Tables

| Table | Key | Contents |
| --- | --- | --- |
| `careers` | `id` | Metadata for the save list: club, manager, season, phase, version, schema and game version, last updated |
| `worlds` | `careerId` | The whole career world (`WorldState`): clubs, players, competitions, fixtures, ledger, news, Club World and more |
| `matches` | `[careerId+fixtureId]` | Every completed match in the world, with seed, engine version and the full delivery log, indexed by season |
| `live` | `[careerId+slot]` | The match in progress (`main`) and any Scenario Lab replay (`lab`), each with its own version counter |
| `backups` | `[careerId+id]` | Automatic restore points taken at milestones such as the end of the auction and season transitions (the newest three per career are kept) |

### Why one world object per career

Almost every action touches many entities at once. A bid changes the lot, the purse, the squad and the auction log; a match changes standings, player statistics, fatigue, finances and Club World events. Saving the world as one versioned object means every change is a single atomic write. The `matches` table is kept separate because delivery logs are large and are only read when someone opens a scorecard.

## Writes are all-or-nothing

Each change commits the career metadata, the world and any new match records in **one IndexedDB transaction**. The transaction checks the stored version first: if another tab saved in the meantime, the write is refused instead of overwriting newer progress. If anything fails mid-change, the in-memory copy is thrown away and reloaded from storage, so a half-applied change is never saved.

## Schema versions and migrations

Every save records `schemaVersion` (currently **5**) and the game version. When an older save is loaded, `migrateWorld` (`packages/app-core/src/portability.ts`) upgrades it in place without discarding data:

| From | Upgrade |
| --- | --- |
| < 2 | Adds the story, timeline, chronicle and appearance records |
| < 3 | Adds match-impact snapshots |
| < 4 | Adds the Club World and primes its cursors so past events are not replayed as new |
| < 5 | Marks the career `worldModel: 'leagues'` so it keeps its national leagues, and adds a news notice that the global universe is available in new careers. New careers are created with `worldModel: 'pyramid'` and a `universe` object (pyramid history, continental records and coefficients, friendlies, nations, international events, fixtures and call-ups, calendar) |

Some additions need no migration: missing captaincy is filled in on the next game day, and new engine tuning simply applies to matches played from then on (each stored match keeps the engine version that produced it).

## Backups and moving saves

- **Export backup** (Save & Settings) downloads a single `kurciv-career` file containing the world, its metadata and match records.
- **Import** (Saves screen) validates the file, upgrades it if it is from an older version, and refuses files from a newer game version.
- **Duplicate** creates an independent copy of a career for experiments.

Clearing the browser's site data deletes careers, so players should export backups they care about.

## Size

A new pyramid world (about 13,500 players across five divisions, plus nations and international fixtures) is roughly 20–30 MB in memory before compression. A classic-leagues world (about 6,000 players) is roughly 10 MB. Delivery logs for every match in the world add to the `matches` table each season.
