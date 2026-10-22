# Roadmap and known limitations

This lists what is built, what is partial and what is planned. Anything marked planned has no hidden implementation behind the UI.

## Built

| Area | Status |
| --- | --- |
| Career | Any club in 11 leagues, or a custom expansion club; local saves with export, import, duplicate and automatic backups |
| Auction | Live room, AI bidding by squad value, proxy bids, flags, assistant bidding, Skip Auction, unsold round, cascade across leagues, rumours resolved by the auction |
| Squad | Registration rules with explained refusals, retentions (up to six), free agents and replacements, training, youth academy, finances |
| Selection | Pre-match XI and batting order; AI selection for the pitch; captain and vice-captain each season |
| Match | Ball-by-ball T20 engine; toss call; openers, bowler and incoming-batter choices; batting approach; DRS with ball tracking; continuous, ball-by-ball, over and instant simulation |
| Presentation | 3D match view (rigged cricketers in franchise kits, broadcast cameras, replays, DRS tracking), broadcast score bar, 2D fallback, Post-Match Centre with posters |
| Competitions | League tables, playoffs, Orange and Purple Cap races per league, the 50-club World Club Championship, league reputations and qualification places |
| Club World | Inbox, world news, player conversations with tracked promises, boardroom with a published job-security rule, fictional cricket feed, rumours, media requests |
| Data | 10,000-player database from Cricsheet with nationality evidence and labelled estimates |
| Quality | Strict TypeScript; unit and integration tests including engine calibration and Player of the Match; Playwright browser tests |

## Partial

- **Contracts.** One-season deals from the auction, renewed through retention. Multi-year deals, bonuses and wage negotiation are planned.
- **Transfers.** Free agents and in-season replacements only. AI-to-AI trades and loans are planned (`FEATURE_FLAGS.loans`).
- **Conversations.** Selection, role, workload, form, retention and broken promises are covered. Captaincy talks, conversations with staff, and relationships between teammates are not.
- **Board.** Dismissal happens only at a season review. Resigning is not supported.
- **Rumours.** Auction and unsettled-player rumours only, because there is no in-season transfer market.
- **3D view.** The players are a stylised low-poly pack with procedural animation, not motion capture. The crowd does not react.
- **Scenario Lab.** Replays your own recorded matches from any delivery. AI-vs-AI replays are planned.

## Known limitations

- **Saves are per browser.** Nothing syncs between devices; use export and import.
- **Weaker leagues score low.** Outside the IPL, the database's estimated ratings put batters below bowlers in most XIs, so those leagues score less than their real averages (see [BALANCE_REPORT.md](BALANCE_REPORT.md)). Re-estimating the database ratings would fix it for new careers.
- **Older matchday browser test.** `e2e/matchday.spec.ts` targets the previous match screen and needs rewriting for the current one.
- **Field placement is fixed.** The standard field per phase is used and cannot be edited.
- **Images depend on outside services.** Badges and photos come from TheSportsDB and Wikimedia at runtime; if they are unavailable, original crests and silhouettes are shown.

## Planned

- **ODI and Test engines** (`odiEngine`, `testEngine` flags). The engine has rule profiles, but only T20 is implemented.
- **National-team mode**, international call-ups and availability windows.
- **Impact Player rule** (`impactPlayer`) and **sealed-bid auctions** (`sealedBids`).
- **Weather interruptions** and DLS-style target revision.
- **Dataset calibration** of the engine against Cricsheet ball-by-ball distributions.
- **Cloud saves and sharing** (optional accounts), and verified leaderboards from stored seeds and decision logs.
- **Lighter match records** for AI-vs-AI fixtures.
