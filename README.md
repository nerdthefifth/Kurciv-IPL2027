# Kurciv IPL 2027

A browser-based cricket management simulator. You run one club in one domestic league. Every other club, league, auction and match in a persistent world is run by AI, through the same ball-by-ball T20 engine you play with.

- **Ball-by-ball T20 engine.** Every delivery resolves line, length, shot choice, contact quality and ball flight. Each fielder has reaction time, running speed and reach, catches have hang time, and runs depend on how long the throw takes against how fast the batters run. Pressure, dew, pitch wear and DRS are included. The engine is seeded and replayable: the same seed and the same decisions give the same match.
- **Live field editor.** Fielders' positions physically change outcomes. Moving a fielder changes which balls get stopped or caught. Illegal fields are flagged and called no-ball; your fielders are never moved for you.
- **Global auction cascade.** Leagues auction in descending reputation, starting with the IPL. AI clubs value players by the marginal improvement to their squad, role scarcity, their purse plan and a strategic personality, and explain big decisions after each lot closes.
- **Living world.** 11 leagues and 73 clubs, with fatigue, injuries, morale, form, development, ageing, retirements, youth academies, finances, a board, retentions (maximum 6), news generated from real events, records and a Hall of Fame.
- **World Club Championship.** Up to 50 clubs qualify. Results move league reputations, which decide future qualification places and auction order.

> Simulation only. There is no wagering, and simulated results are not predictions of real cricket. Real players appear by name only. Ratings and ages are editorial estimates, and no real statistics are imported. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Quick start (local, no external services)

Requires **Node.js 22.13+** (the built-in `node:sqlite` module is used — no database server needed).

```bash
npm install
npm run dev          # API on :8787, web app on http://localhost:5173
```

Open http://localhost:5173, create an account (stored locally), pick a club and start the 2027 auction.

Production-style single process:

```bash
npm run build        # builds apps/web/dist
npm start            # serves API + web app on http://localhost:8787
```

Data lives in `data/kurciv.db` by default (`KURCIV_DB` overrides it). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment variables.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` proxy |
| `npm test` | Unit, integration, deterministic-replay and API tests (Vitest) |
| `npm run typecheck` | Strict TypeScript across every package and the web app |
| `npm run lab -- 2000` | Simulation lab: plays N seeded matches and prints the calibration report |
| `npm run world-report -- <seed>` | Plays a whole world season and prints auction, tables, WCC and reputation movement |
| `npm run validate-data` | Validates the curated player seed (duplicates, ranges, role and style consistency) |

## Repository layout

```
apps/
  server/            Express API, sessions, SQLite persistence, live-match host
  web/               React + Vite + Tailwind client
packages/
  domain/            Entity types, derived ratings, squad and registration rules
  config/            League registry, venues, simulation constants, world/reputation/WCC config, feature flags
  simulation/        Seeded RNG, field geometry, shot model, ball-by-ball engine, commentary, win probability, pressure
  ai/                Tactical captain AI, XI selection, match runner and replay
  world/             Career creation, auction cascade, competitions, calendar, condition, finance, WCC, seasons
  data-ingestion/    Curated real-player seed, generated players, validation, licensed-image manifest
tools/               Simulation lab, world report
docs/                Architecture, database, configuration, data sources, deployment, balance report, roadmap
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md): module boundaries, authority model, determinism, world ticks
- [Database](docs/DATABASE.md): current schema, aggregate model, PostgreSQL target schema
- [Configuration](docs/CONFIGURATION.md): leagues, squad rules, auctions, reputation, qualification, engine constants
- [Data sources & licensing](docs/DATA_SOURCES.md): what is real, what is generated, and how to add licensed data
- [Deployment & environment](docs/DEPLOYMENT.md)
- [Simulation balance report](docs/BALANCE_REPORT.md)
- [Gameplay guide](docs/GAMEPLAY.md)
- [Roadmap & known limitations](docs/ROADMAP.md)
