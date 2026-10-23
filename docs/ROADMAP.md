# Roadmap and known limitations

This lists what is built, what is partial and what is planned. Anything marked planned has no hidden implementation behind the UI.

## Built

| Area | Status |
| --- | --- |
| Career | Any of 90 clubs in the global pyramid (or the classic 11 leagues), or a custom club. Local saves with export, import, duplicate and automatic backups |
| Global pyramid | Five divisions of 18 clubs, deterministic seeding, promotion and relegation (3 up, 3 down), parachute payments and promotion bonuses, pyramid history |
| Continental cups | Champions Cup and Shield in five regions; qualification by performance and reputation; club coefficients; neutral finals; the 16-club Global Club Championship; roll of honour |
| Preseason | Friendlies arranged by opponent, ground, date, purpose and mode (play, watch or simulate), with a preview of the effects. AI clubs arrange their own. Reduced reputation and board weight |
| International | 24 nations with AI managers, eligibility by nationality, selection by format, user appointment and squad selection, call-ups, bilateral tours, tri-series, associate qualifier, Asia Cup, rotating world events, rankings and honours |
| Formats | T20, ODI and Test engines. Tests have sessions, declarations, the follow-on and draws |
| Population | About 13,500 players: around 3,460 real and 10,000 fictional (deterministic and labelled), with separate total, contracted, eligible, registered and on-screen counts |
| Auction | Live room, full-pool registration with a domestic-depth catalogue, an accelerated round from the registered pool, AI valuation by marginal XI value with role caps and budget discipline, Auction Preparation with signals, Skip Auction, unsold round and cascade |
| Squad | Registration rules relative to each club's country with explained refusals, retentions (up to six), free agents and replacements, training, youth academy and finances |
| Selection | Pre-match XI and batting order; AI selection for the pitch and around call-ups; captain and vice-captain each season |
| Match | Ball-by-ball engine; toss call; openers, bowler and incoming-batter choices; batting approach; DRS with ball tracking; continuous, ball-by-ball, over and instant simulation |
| Presentation | Shader renderer (PBR, GLSL outfield and pitch, sky, shadows, bloom, colour grade, seamed ball and trail, venue identity), Low/Medium/High/Ultra presets, broadcast score bar, 2D fallback, Post-Match Centre with posters |
| Theme | Cream and burgundy light theme, and the dark Smoked Wine theme |
| World explorer | Club, player and stadium directories, the pyramid, continental and international views, the national team, preseason, auction preparation and the global calendar |
| Club World | Inbox, world news, player conversations with tracked promises, boardroom with a published job-security rule, fictional cricket feed, rumours and media requests |
| Quality | Strict TypeScript; unit and integration tests including engine calibration, the universe (population, pyramid determinism, scheduling clashes, friendlies, Test cricket) and Player of the Match; Playwright browser tests |

## Partial

- **International matches are simulated, not played live.** The engine plays every international ball by ball and you pick the squads and captain, but there is no interactive match screen for them yet.
- **Watching a friendly** gives every in-match decision to the assistant, except the toss call.
- **Weather** affects the look of a venue (climate, sky and dew) but does not interrupt play. DLS is not modelled.
- **Contracts.** One-season deals from the auction, renewed through retention. Multi-year deals, bonuses and wage negotiation are planned.
- **Transfers.** Free agents and in-season replacements only. AI-to-AI trades and loans are planned.
- **Eligibility** uses each player's single sporting nationality. Residency and dual nationality are not modelled.
- **3D view.** The players are a stylised low-poly pack with procedural animation, not motion capture, and the crowd does not react. Stadium models are procedural and are not replicas of the real grounds.

## Known limitations

- **Saves are per browser.** Nothing syncs between devices; use export and import. A pyramid save is larger (around 30 MB) because of the larger population.
- **Creating a career below the top division takes a little longer**, because the higher divisions' auctions run first.
- **Weaker sides score lower.** Outside the top tier, database players' estimated ratings put batters below bowlers in many XIs (see [BALANCE_REPORT.md](BALANCE_REPORT.md)).
- **Few Test draws.** Simulated Tests produce realistic totals and run rates, but rarely end in draws, because weather is not modelled.
- **Older matchday browser test.** `e2e/matchday.spec.ts` targets the previous match screen and needs rewriting.
- **Images depend on outside services.** Badges and photos come from TheSportsDB and Wikimedia at runtime; if they are unavailable, original crests and silhouettes are shown.

## Planned

- Live interactive play for international matches.
- **Impact Player rule** (`impactPlayer`) and **sealed-bid auctions** (`sealedBids`).
- Weather interruptions and DLS-style target revision.
- **Dataset calibration** of the engine against Cricsheet ball-by-ball distributions.
- **Cloud saves and sharing** (optional accounts), and verified leaderboards from stored seeds and decision logs.
- **Lighter match records** for AI-vs-AI fixtures.
