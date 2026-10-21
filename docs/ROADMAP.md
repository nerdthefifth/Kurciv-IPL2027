# Roadmap and known limitations

This lists honestly what is built, what is partial, and what is planned. Anything marked planned has no hidden implementation behind the UI.

## Definition of done (first playable release)

| Requirement | Status |
| --- | --- |
| Create a career, select or create one club | ✅ Existing club in any of 11 leagues, or a validated custom expansion club |
| Complete a functioning auction | ✅ Live room, AI bidding, proxy bids, flags, unsold round, cascade |
| Assemble a valid squad | ✅ All registration rules enforced with explicit reasons |
| Play or simulate a full T20 season | ✅ Ball-by-ball live, key moments, instant; same engine for every match |
| Tactical decisions during matches | ✅ Bowlers, fields, plans, intent, order, DRS |
| Observe AI rival fixtures | ✅ Full scorecards, charts and ball-by-ball for every match in the world |
| Develop players; injuries and morale | ✅ |
| Retain up to six players; next season without losing history | ✅ Tested over two full seasons |
| League reputation evolves from international results | ✅ |
| Qualification produces a valid tournament of no more than 50 clubs | ✅ Tested allocator and format generator |
| Scorecards, standings, finances, statistics agree with simulation events | ✅ Scorecards, standings and player statistics are checked against the delivery log by automated tests. Finances are derived from a transaction ledger but have no dedicated reconciliation test yet. |

## Partial

- **Contracts.** One-season deals from the auction, renewed through retention. Multi-year deals, bonuses, clauses and wage negotiation are planned.
- **Transfers.** Free agents and in-season replacements (user and AI) work. AI-to-AI trades, loans and player-initiated renegotiation are planned (`FEATURE_FLAGS.loans`).
- **Morale events.** Playing time, results and performance affect morale, and unsettled players flag themselves. Explicit salary-fairness and captain-relationship events are planned.
- **Auction anticipation.** AI clubs value scarcity and later replacements, plan their purse and reveal reasoning. Explicit modelling of rival clubs' demand is planned.
- **Images.** A licensed-manifest provider with validation and fallbacks exists. No portrait set ships.
- **Engine realism.** `pitch.bounce` is defined but unused. The left-arm angle against each batting hand is not modelled separately. Scores spread wider than real T20 (see BALANCE_REPORT.md).
- **Scenario Lab.** Replays your own recorded matches from any delivery. Replaying AI-vs-AI matches is planned.
- **Balance.** Calibrated against broad T20 patterns, not yet against an imported ball-by-ball dataset.

## Planned

- **ODI and Test engines** (`odiEngine`, `testEngine` flags). The engine has rule profiles (`MatchRules`), but only T20 is implemented and tested.
- **National-team mode** as a separate save type. International call-ups and availability windows.
- **Impact Player rule** (`impactPlayer` flag) and **sealed-bid auctions** (`sealedBids` flag).
- **Weather interruptions** and DLS-style target revision.
- **Cricsheet adapter** for calibration and historical statistics, kept separate from in-career statistics. A licensed data-provider adapter.
- **PostgreSQL** persistence and an OIDC login (see DATABASE.md and DEPLOYMENT.md). A job queue for long simulations.
- **Verified leaderboards** from stored seeds and action logs. The building blocks (deterministic replay, `engineVersion`) exist.
- **Lighter match records** for AI-vs-AI fixtures (currently about 22 KB per match compressed).
- **Richer narrative.** Rivalry storylines and press conferences, still built only from real events.
