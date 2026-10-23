# The global cricket universe

New careers are played in a global universe: a five-division club pyramid that mixes every cricket region, continental club cups, a Global Club Championship, preseason friendlies, and international cricket in Test, ODI and T20 formats. Careers saved before this update keep the original national leagues (see [Saves](#saves)).

## The pyramid

| Division | Clubs | Purse | Playoffs |
| --- | --- | --- | --- |
| Kurciv Global Premier Division | 18 | ₹120 Cr | Top four (Qualifier 1, Eliminator, Qualifier 2, Final) |
| Global Championship | 18 | ₹64 Cr | Semi-finals and final |
| Global League One | 18 | ₹40 Cr | Semi-finals and final |
| Global League Two | 18 | ₹26 Cr | Semi-finals and final |
| Global League Three | 18 | ₹18 Cr | Semi-finals and final |

- **90 clubs:** the 73 real franchises plus 17 fictional clubs from Ireland, Scotland, the Netherlands, Germany, Zimbabwe, Kenya, Namibia, Uganda, Afghanistan, Nepal, Hong Kong, Oman, Malaysia, Singapore, Canada, the United States and Papua New Guinea.
- **Seeding:** clubs are placed by a score of 62% home-league reputation and 38% brand, with ties broken by club code. The new-career screen shows where each club starts. A custom club starts in League Three.
- **Season:** a single round-robin (17 matches), then the playoffs.
- **Promotion and relegation:** three up and three down between each pair of divisions. Promotion follows the finishing order (champion, runner-up, then the table); relegation is the bottom three of the table. Table ties are broken by points, net run rate, wins and then club code, so the outcome is deterministic.
- **What moves with a club:** squad, staff, facilities, finances and history. Relegated clubs receive a parachute payment of 30% of the purse difference. Promoted clubs receive a bonus of 8% of the new purse. Board confidence and brand move with the result.
- **Overseas players** are judged against the club's own country. Clubs from a country with a national league keep that league's domestic group: English clubs treat Irish and Scottish players as domestic, South African clubs Namibians, UAE clubs Omanis and US clubs Canadians. Each squad has 16–22 players, with up to 6 overseas and at most 4 in the XI. Indian players may only join Indian clubs.

## Continental cups and the Global Club Championship

When the divisional season ends, every region (Asia, Europe, Africa, the Americas and Oceania) holds a **Champions Cup** for its top eight clubs and a **Shield** for the next eight. A region with only four eligible clubs plays semi-finals and a final; with fewer than four, that cup is not held.

- **Qualification score:** 70% performance (division tier and finishing position this season) and 30% reputation (brand plus the club's three-season continental coefficient).
- **Format:** two groups of four, semi-finals, then a final at a neutral ground in the region.
- **Prize money and coefficient points** are paid for every stage.
- The **Global Club Championship** takes 16 clubs: every Champions Cup winner and runner-up, then the best Premier Division finishers. It is four groups of four, quarter-finals, semi-finals and a final. Hosting rotates between regions, and the tournament is played at that region's largest grounds.

## Preseason friendlies

Between the auction and the season (days 42–76) you can arrange up to four friendlies.

- **Find an opponent** with the searchable directory, filtered by region or division.
- **Choose** a date, a ground (home, away or neutral) and a purpose: match fitness, trial fringe players, rehearse tactics, gate money or young players.
- **Choose how you take part:** play it yourself, watch while the assistant decides, or simulate it instantly.
- **Preview the effects before you confirm:** fatigue, match sharpness, cohesion, gate money, reputation and board effect, plus anyone unavailable through injury or international duty.
- **Opponents can decline.** A club two divisions higher only accepts if it hosts the match.
- **AI clubs arrange their own** one or two friendlies, mostly within their region.
- **Limited consequences.** Friendlies never affect tables or career statistics. They count for 25% of a competitive match in reputation and 20% in board confidence.

## International cricket

There are 24 nations: 12 full members, who play Tests, and 12 associates. Each has an AI manager and ratings in every format.

- **Eligibility:** players of that nationality, aged 17 or over, who are not retired and not in an academy.
- **Selection:** the selectors pick a squad of 15 (16 for Tests) for each format, using format-specific ratings. Test ratings weight defence and control; ODI ratings sit between Test and T20.
- **Your national job:** the game may offer you a national job (your club's own nation when the club is prominent, plus an associate). Accept it to pick the squads and captain yourself. International matches are simulated with your selections.
- **Call-ups:** squad players are unavailable to their clubs for the whole event, plus a day either side. Eliminated nations' players are released early. International windows never overlap competitive club fixtures. They do overlap the preseason, so call-ups can cost you players for friendlies.

### Calendar

| Window | Events |
| --- | --- |
| Preseason (days 44–76) | Bilateral tours between full members (two Tests, or three ODIs and two T20Is), the associate T20 World Cup Qualifier and an associate ODI tri-series |
| After the Global Club Championship | The year's world event, in rotation: T20 World Cup (16 teams) → ODI World Cup (10) → World Test Championship Final plus the Asia Cup → Champions Trophy (8) |

Group stages lead into knockouts. Finals are played at neutral grounds, every event is recorded in the honours list, and rankings are snapshotted every season.

### Formats

| Format | Rules |
| --- | --- |
| T20 | 20 overs a side, 4 per bowler, powerplay of 6 overs, super overs in knockouts |
| ODI | 50 overs a side, 10 per bowler, powerplay of 10 overs, death overs 41–50 |
| Test | Two innings each within five days of 90 overs (three 30-over sessions a day). No bowling quotas. Attacking Test fields (slips and gully, or bat-pad catchers for spin). Declarations, the follow-on (200-run lead) and draws when time runs out. Pitches wear through the match. |

The engine is the same ball-by-ball engine in every format. Batting intent, shot selection and the risk of being beaten or edging are scaled by format. See [BALANCE_REPORT.md](BALANCE_REPORT.md).

## Player population

A pyramid world has about 13,500 players:

- **Real players:** about 3,460, from the licensed Cricsheet database. These are active men with a known nationality, plus the curated list. Each keeps its Cricsheet id as provenance, and ids are checked to be unique.
- **Fictional players:** 10,000 generated players. First, every club country gets enough domestic depth for full squads and a national pool. The rest are spread by how many clubs and national teams each country supports. Generation is deterministic from the world seed, with stable ids `f-<country>-<n>`, and every generated player is labelled as fictional.

The game shows these counts separately:

- **Total:** every player in the world.
- **Contracted:** players registered with a club.
- **Auction-eligible:** every uncontracted senior player.
- **Registered:** players eligible for at least one club in your auction.
- **Catalogued:** players offered as lots.
- **On screen:** one page of 50 in the Player Directory.

## Recruitment and the auction

- **Registration:** every eligible player is registered for an auction if at least one club in it could sign him.
- **The catalogue** guarantees domestic depth for each home country in the division: about 1.6 players per open domestic place, by market value. It adds about two overseas players per open overseas slot. Everyone else registered can be called into the accelerated round, where AI clubs with open places nominate players.
- **AI clubs value each player** by:
  - the marginal improvement to their best XI over the replacement level still in the pool;
  - role need, scarcity of comparable players, their personality and strategy, and budget pressure.
- **AI bidding is disciplined.** Each AI club stops at a hard maximum bid, set by:
  - the reserve needed to complete a legal squad;
  - a cap on the share of the purse any one player may take;
  - pacing across the remaining places.
  
  An AI club also withdraws from a role it already has well covered.
- **Auction Preparation** shows:
  - every count above;
  - your squad needs;
  - the top targets, each with your plan's maximum bid and signals such as *High tactical fit*, *Strong long-term value*, *Budget risk* and *Undervalued for your plan*.
- **Squad completion:** if the auction leaves your squad below the minimum, the assistant signs the best free agents at the minimum price when the preseason opens, and tells you.

## Stadiums

The catalogue has 81 grounds: 64 real grounds and 17 fictional ones. Each ground has:

- capacity, climate, boundary sizes, altitude, pitch profile and dew chance;
- a visual identity used by the 3D renderer: tiers, roof style, floodlight style, stand and seat colours, outfield tone, shape and skyline backdrop.

Real grounds use public facts (approximate capacities). Their 3D model is built from original procedural Kurciv modules, not a replica. Fictional grounds are entirely original. Every ground records its provenance.

## 3D presentation

The shader renderer adds:

- PBR materials with filmic tone mapping;
- a GLSL outfield (mowing stripes, noise, wear around the square and a rough band by the rope);
- a GLSL pitch whose cracks and footmarks grow as the match goes on;
- a sky dome for day or floodlit evening, tinted by climate;
- shadows, bloom on floodlights, a colour grade and vignette;
- a seamed ball (red for Tests) with a trail;
- each venue's own stands, roof, lights and skyline.

| Preset | Pixel ratio | Shadows | Post-processing | Crowd |
| --- | --- | --- | --- | --- |
| Low | 1× | off | none | sparse |
| Medium | 1.5× | off | colour grade | medium |
| High | 2× | 1024 px | bloom and grade | dense |
| Ultra | 2.5× | 2048 px, soft | bloom and grade | densest, skyline and trail detail |

The renderer still only replays what the engine decided. The 2D board remains available and is used automatically without WebGL.

## Saves

Save schema 5 adds the universe state: pyramid history, continental records and coefficients, friendlies, nations, international events, fixtures and call-ups, and the calendar. Careers from schema 4 and older are migrated to schema 5 with `worldModel: 'leagues'`. They keep their national leagues unchanged, and a notice in the news explains that the universe is available in new careers. Export and import carry the full universe state.

## Developer tools

```bash
npm run universe-smoke -- MUM 1   # builds a pyramid world and plays a whole season (auctions, cups, internationals, promotion)
npm run format-lab -- Test 20     # plays seeded Tests (or ODI / T20) and prints the distributions
```
