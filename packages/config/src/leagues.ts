import type { AuctionPersonality, CountryCode, LeagueConfig, SquadRules, AuctionRules } from '@kurciv/domain';

/**
 * League registry. The world is built from this table rather than being hardcoded around
 * the IPL. Club and competition names other than "IPL" are fictional so the game does not
 * depend on trademarks; every name here can be edited without touching game logic.
 */

const franchiseRules = (over: Partial<SquadRules> = {}): SquadRules => ({
  maxSquad: 25,
  minSquad: 18,
  maxOverseas: 5,
  maxPerOverseasCountry: 2,
  maxOverseasInXI: 4,
  maxRetentions: 6,
  retentionCosts: [18, 14, 11, 18, 14, 11],
  uncappedRetentionCost: 4,
  ...over,
});

const auction = (purse: number, minBase: number, over: Partial<AuctionRules> = {}): AuctionRules => {
  const s = purse / 120;
  const r = (v: number) => Math.max(0.01, Math.round(v * s * 100) / 100);
  return {
    purse,
    minBase,
    increments: [
      { upTo: r(1), step: r(0.05) },
      { upTo: r(2), step: r(0.1) },
      { upTo: r(5), step: r(0.2) },
      { upTo: Number.POSITIVE_INFINITY, step: r(0.25) },
    ],
    unsoldRound: true,
    bidSeconds: 10,
    ...over,
  };
};

export const LEAGUES: LeagueConfig[] = [
  {
    id: 'IPL', name: 'Indian Premier League', shortName: 'IPL', country: 'IND', region: 'Asia', fictional: false,
    initialReputation: 95, commercialValue: 98, audience: 99, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules(), auctionRules: auction(120, 0.3), domesticCountries: ['IND'], seasonStartDay: 80,
    prizeMoney: { champion: 20, runnerUp: 12.5, playoff: 7 },
  },
  {
    id: 'SXT', name: 'Southern Cross T20', shortName: 'SXT', country: 'AUS', region: 'Oceania', fictional: true,
    initialReputation: 79, commercialValue: 80, audience: 78, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, maxRetentions: 6, retentionCosts: [3.5, 3, 2.5, 2.5, 2, 2], uncappedRetentionCost: 0.8 }),
    auctionRules: auction(28, 0.08), domesticCountries: ['AUS'], seasonStartDay: 80,
    prizeMoney: { champion: 5, runnerUp: 3, playoff: 1.5 },
  },
  {
    id: 'ALB', name: 'Albion T20 Cup', shortName: 'ATC', country: 'ENG', region: 'Europe', fictional: true,
    initialReputation: 76, commercialValue: 78, audience: 74, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, retentionCosts: [3.5, 3, 2.5, 2.5, 2, 2], uncappedRetentionCost: 0.8 }),
    auctionRules: auction(26, 0.08), domesticCountries: ['ENG', 'IRE', 'SCO'], seasonStartDay: 80,
    prizeMoney: { champion: 4.5, runnerUp: 2.5, playoff: 1.2 },
  },
  {
    id: 'PRT', name: 'Protea T20 League', shortName: 'PTL', country: 'SA', region: 'Africa', fictional: true,
    initialReputation: 74, commercialValue: 70, audience: 66, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.6 }),
    auctionRules: auction(24, 0.07), domesticCountries: ['SA', 'NAM'], seasonStartDay: 80,
    prizeMoney: { champion: 4, runnerUp: 2, playoff: 1 },
  },
  {
    id: 'IND2', name: 'Indus T20 League', shortName: 'ITL', country: 'PAK', region: 'Asia', fictional: true,
    initialReputation: 70, commercialValue: 62, audience: 80, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [2.5, 2, 1.8, 1.8, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(18, 0.05), domesticCountries: ['PAK'], seasonStartDay: 80,
    prizeMoney: { champion: 3, runnerUp: 1.6, playoff: 0.8 },
  },
  {
    id: 'DES', name: 'Desert T20 League', shortName: 'DTL', country: 'UAE', region: 'Asia', fictional: true,
    initialReputation: 69, commercialValue: 68, audience: 52, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 9, maxPerOverseasCountry: 3, maxOverseasInXI: 7, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(24, 0.06), domesticCountries: ['UAE', 'OMA'], seasonStartDay: 80,
    prizeMoney: { champion: 3.5, runnerUp: 1.8, playoff: 0.9 },
  },
  {
    id: 'CAR', name: 'Caribbean T20 Carnival', shortName: 'CTC', country: 'WI', region: 'Americas', fictional: true,
    initialReputation: 66, commercialValue: 55, audience: 64, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [2, 1.6, 1.4, 1.4, 1.2, 1.2], uncappedRetentionCost: 0.4 }),
    auctionRules: auction(13, 0.04), domesticCountries: ['WI'], seasonStartDay: 80,
    prizeMoney: { champion: 2.2, runnerUp: 1.2, playoff: 0.6 },
  },
  {
    id: 'LIB', name: 'Liberty T20', shortName: 'LT20', country: 'USA', region: 'Americas', fictional: true,
    initialReputation: 64, commercialValue: 66, audience: 45, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 8, maxPerOverseasCountry: 3, maxOverseasInXI: 6, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(22, 0.06), domesticCountries: ['USA', 'CAN'], seasonStartDay: 80,
    prizeMoney: { champion: 3, runnerUp: 1.6, playoff: 0.8 },
  },
  {
    id: 'AOT', name: 'Aotearoa T20', shortName: 'AOT', country: 'NZ', region: 'Oceania', fictional: true,
    initialReputation: 58, commercialValue: 48, audience: 50, format: 'T20', rounds: 2, playoffs: 'final2',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, retentionCosts: [1.6, 1.4, 1.2, 1.2, 1, 1], uncappedRetentionCost: 0.3 }),
    auctionRules: auction(10, 0.03), domesticCountries: ['NZ'], seasonStartDay: 80,
    prizeMoney: { champion: 1.5, runnerUp: 0.8, playoff: 0.4 },
  },
  {
    id: 'LNK', name: 'Lanka T20', shortName: 'LT', country: 'SL', region: 'Asia', fictional: true,
    initialReputation: 58, commercialValue: 45, audience: 60, format: 'T20', rounds: 2, playoffs: 'final2',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [1.4, 1.2, 1, 1, 0.8, 0.8], uncappedRetentionCost: 0.3 }),
    auctionRules: auction(9, 0.03), domesticCountries: ['SL'], seasonStartDay: 80,
    prizeMoney: { champion: 1.2, runnerUp: 0.7, playoff: 0.3 },
  },
  {
    id: 'BAY', name: 'Bengal Bay T20', shortName: 'BBT', country: 'BAN', region: 'Asia', fictional: true,
    initialReputation: 55, commercialValue: 44, audience: 70, format: 'T20', rounds: 2, playoffs: 'final2',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [1.4, 1.2, 1, 1, 0.8, 0.8], uncappedRetentionCost: 0.3 }),
    auctionRules: auction(9, 0.03), domesticCountries: ['BAN'], seasonStartDay: 80,
    prizeMoney: { champion: 1.2, runnerUp: 0.7, playoff: 0.3 },
  },
];

export interface ClubSeed {
  id: string;
  name: string;
  shortName: string;
  city: string;
  venueId: string;
  colors: [string, string];
  personality: AuctionPersonality;
  brand: number;
}

const c = (
  id: string, name: string, shortName: string, city: string, venueId: string, colors: [string, string], personality: AuctionPersonality, brand: number,
): ClubSeed => ({ id, name, shortName, city, venueId, colors, personality, brand });

/** Club seeds per league. All club names are fictional. */
export const CLUB_SEEDS: Record<string, ClubSeed[]> = {
  IPL: [
    c('MUM', 'Mumbai Monarchs', 'MUM', 'Mumbai', 'wankhede', ['#1e5aff', '#d9b84a'], 'star-commercial', 92),
    c('CHE', 'Chennai Cyclones', 'CHE', 'Chennai', 'chepauk', ['#f5c518', '#1b3a8a'], 'spin-tactician', 94),
    c('BEN', 'Bengaluru Blazers', 'BLR', 'Bengaluru', 'chinnaswamy', ['#d61f26', '#111111'], 'aggressive-contender', 88),
    c('KOL', 'Kolkata Tigers', 'KOL', 'Kolkata', 'eden', ['#4b2a86', '#e2b33c'], 'value-hunter', 85),
    c('DEL', 'Delhi Dynamos', 'DEL', 'Delhi', 'kotla', ['#1747a6', '#e84a3c'], 'rebuilding', 74),
    c('HYD', 'Hyderabad Hurricanes', 'HYD', 'Hyderabad', 'uppal', ['#f26522', '#111111'], 'pace-first', 78),
    c('RAJ', 'Rajasthan Rangers', 'RAJ', 'Jaipur', 'sms', ['#e83e8c', '#163a8c'], 'youth-builder', 76),
    c('PUN', 'Punjab Panthers', 'PUN', 'Mullanpur', 'mullanpur', ['#c8102e', '#c0c0c0'], 'aggressive-contender', 72),
    c('GUJ', 'Gujarat Gladiators', 'GUJ', 'Ahmedabad', 'motera', ['#0d1f3c', '#c9a227'], 'conservative', 75),
    c('LKO', 'Lucknow Lions', 'LKO', 'Lucknow', 'ekana', ['#00a3e0', '#f58220'], 'value-hunter', 73),
  ],
  SXT: [
    c('SYS', 'Sydney Sharks', 'SYS', 'Sydney', 'scg', ['#0072ce', '#ffffff'], 'star-commercial', 72),
    c('SYT', 'Sydney Thunderbolts', 'SYT', 'Sydney', 'showground', ['#76bc21', '#222222'], 'youth-builder', 60),
    c('MEM', 'Melbourne Mavericks', 'MEM', 'Melbourne', 'mcg', ['#00a650', '#111111'], 'aggressive-contender', 70),
    c('MEC', 'Melbourne Comets', 'MEC', 'Melbourne', 'docklands', ['#e4002b', '#ffffff'], 'value-hunter', 58),
    c('PEF', 'Perth Flames', 'PEF', 'Perth', 'perth', ['#f47920', '#111111'], 'pace-first', 66),
    c('ADK', 'Adelaide Kestrels', 'ADK', 'Adelaide', 'adelaide', ['#00aeef', '#d7192d'], 'value-hunter', 62),
    c('BRS', 'Brisbane Storm', 'BRS', 'Brisbane', 'gabba', ['#00b5e2', '#003da5'], 'conservative', 63),
    c('HOG', 'Hobart Gales', 'HOG', 'Hobart', 'bellerive', ['#4d2c87', '#bfa07a'], 'rebuilding', 55),
  ],
  ALB: [
    c('LDR', 'London Royals', 'LDR', 'London', 'lords', ['#002b5c', '#d4af37'], 'star-commercial', 70),
    c('LDF', 'London Foxes', 'LDF', 'London', 'oval', ['#5b2c83', '#f2c500'], 'value-hunter', 62),
    c('MAN', 'Manchester Hurricanes', 'MAN', 'Manchester', 'oldtrafford', ['#d50032', '#111111'], 'aggressive-contender', 64),
    c('BIR', 'Birmingham Bulls', 'BIR', 'Birmingham', 'edgbaston', ['#e10600', '#ffcc00'], 'pace-first', 60),
    c('LEE', 'Leeds Lancers', 'LEE', 'Leeds', 'headingley', ['#00a9e0', '#fdb913'], 'youth-builder', 57),
    c('NOT', 'Nottingham Knights', 'NOT', 'Nottingham', 'trentbridge', ['#00843d', '#ffd200'], 'conservative', 58),
    c('SOU', 'Southampton Saints', 'SOU', 'Southampton', 'rosebowl', ['#00205b', '#e03a3e'], 'spin-tactician', 55),
    c('CDF', 'Cardiff Dragons', 'CDF', 'Cardiff', 'sophia', ['#d4213d', '#0a7b3e'], 'rebuilding', 52),
  ],
  PRT: [
    c('JHB', 'Johannesburg Gold', 'JHB', 'Johannesburg', 'wanderers', ['#f9b233', '#222222'], 'star-commercial', 62),
    c('CPT', 'Cape Town Clippers', 'CPT', 'Cape Town', 'newlands', ['#00539f', '#ffffff'], 'aggressive-contender', 64),
    c('DUR', 'Durban Waves', 'DUR', 'Durban', 'kingsmead', ['#00a7b5', '#003a70'], 'pace-first', 56),
    c('PRE', 'Pretoria Rhinos', 'PRE', 'Centurion', 'centurion', ['#552583', '#fdb927'], 'value-hunter', 55),
    c('GQE', 'Gqeberha Gulls', 'GQE', 'Gqeberha', 'stgeorges', ['#f15a29', '#262262'], 'youth-builder', 50),
    c('PAA', 'Paarl Vintners', 'PAA', 'Paarl', 'boland', ['#7a1f3d', '#e6c200'], 'spin-tactician', 52),
  ],
  IND2: [
    c('LHF', 'Lahore Falcons', 'LHF', 'Lahore', 'gaddafi', ['#00a651', '#ed1c24'], 'star-commercial', 62),
    c('KHC', 'Karachi Corsairs', 'KHC', 'Karachi', 'nationalkhi', ['#0a2e6e', '#00b5ef'], 'aggressive-contender', 60),
    c('ISE', 'Islamabad Eagles', 'ISE', 'Islamabad', 'pindi', ['#e4002b', '#111111'], 'value-hunter', 58),
    c('PSH', 'Peshawar Hawks', 'PSH', 'Peshawar', 'arbab', ['#ffd100', '#004b23'], 'pace-first', 55),
    c('QTC', 'Quetta Comets', 'QTC', 'Quetta', 'bugti', ['#4b0082', '#ffd700'], 'youth-builder', 48),
    c('MLM', 'Multan Mavericks', 'MLM', 'Multan', 'multan', ['#006c35', '#f4b400'], 'spin-tactician', 50),
  ],
  DES: [
    c('DXF', 'Dubai Falcons', 'DXF', 'Dubai', 'dubai', ['#c8102e', '#111111'], 'star-commercial', 60),
    c('AUH', 'Abu Dhabi Oryx', 'AUH', 'Abu Dhabi', 'zayed', ['#7a263a', '#d4af37'], 'aggressive-contender', 58),
    c('SHJ', 'Sharjah Scorpions', 'SHJ', 'Sharjah', 'sharjah', ['#ffcc00', '#000000'], 'spin-tactician', 52),
    c('AJM', 'Ajman Arrows', 'AJM', 'Ajman', 'dubai', ['#008080', '#ffffff'], 'value-hunter', 45),
    c('RAK', 'Ras Al Khaimah Raiders', 'RAK', 'Ras Al Khaimah', 'zayed', ['#1c1c84', '#e0e0e0'], 'pace-first', 44),
    c('FUJ', 'Fujairah Phoenix', 'FUJ', 'Fujairah', 'sharjah', ['#ff6f00', '#212121'], 'rebuilding', 42),
  ],
  CAR: [
    c('TRI', 'Trinidad Steelpans', 'TRI', 'Port of Spain', 'qpo', ['#e31b23', '#111111'], 'star-commercial', 58),
    c('JAM', 'Jamaica Lightning', 'JAM', 'Kingston', 'sabina', ['#009b3a', '#fed100'], 'aggressive-contender', 55),
    c('BAR', 'Barbados Pelicans', 'BAR', 'Bridgetown', 'kensington', ['#00267f', '#ffc726'], 'pace-first', 52),
    c('GUY', 'Guyana Macaws', 'GUY', 'Providence', 'providence', ['#009e49', '#fcd116'], 'spin-tactician', 50),
    c('STL', 'St Lucia Hummingbirds', 'STL', 'Gros Islet', 'sammy', ['#66ccff', '#000000'], 'youth-builder', 45),
    c('ANT', 'Antigua Breakers', 'ANT', "St John's", 'vivian', ['#ce1126', '#fcd116'], 'value-hunter', 44),
  ],
  LIB: [
    c('NYE', 'New York Empire', 'NYE', 'New York', 'nassau', ['#003087', '#c8102e'], 'star-commercial', 60),
    c('DAL', 'Dallas Drovers', 'DAL', 'Grand Prairie', 'grandprairie', ['#f2a900', '#002244'], 'aggressive-contender', 56),
    c('LAL', 'Los Angeles Lightning', 'LAL', 'Los Angeles', 'grandprairie', ['#552583', '#fdb927'], 'star-commercial', 55),
    c('BAB', 'Bay Area Breakers', 'BAB', 'San Francisco', 'oakland', ['#006bb6', '#fdb927'], 'value-hunter', 52),
    c('SEA', 'Seattle Sockeyes', 'SEA', 'Seattle', 'oakland', ['#005c5c', '#a2aaad'], 'pace-first', 48),
    c('WAF', 'Washington Founders', 'WAF', 'Washington', 'churchst', ['#002d72', '#e31837'], 'conservative', 50),
  ],
  AOT: [
    c('AKL', 'Auckland Kauri', 'AKL', 'Auckland', 'edenpark', ['#003e7e', '#ffffff'], 'star-commercial', 50),
    c('WEL', 'Wellington Windjammers', 'WEL', 'Wellington', 'skystadium', ['#ffcd00', '#000000'], 'value-hunter', 47),
    c('CHC', 'Christchurch Kea', 'CHC', 'Christchurch', 'hagley', ['#c8102e', '#000000'], 'pace-first', 46),
    c('HAM', 'Hamilton Hawks', 'HAM', 'Hamilton', 'seddon', ['#5a2d82', '#ffffff'], 'youth-builder', 42),
    c('DUN', 'Dunedin Albatross', 'DUN', 'Dunedin', 'university', ['#003a70', '#f2a900'], 'conservative', 40),
    c('NAP', 'Napier Tuis', 'NAP', 'Napier', 'mclean', ['#007a33', '#ffffff'], 'spin-tactician', 38),
  ],
  LNK: [
    c('COL', 'Colombo Cobras', 'COL', 'Colombo', 'premadasa', ['#00205b', '#ffb81c'], 'star-commercial', 50),
    c('KAN', 'Kandy Leopards', 'KAN', 'Kandy', 'pallekele', ['#7b1fa2', '#ffd600'], 'spin-tactician', 47),
    c('GAL', 'Galle Mariners', 'GAL', 'Galle', 'galle', ['#0277bd', '#ffffff'], 'pace-first', 44),
    c('JAF', 'Jaffna Herons', 'JAF', 'Jaffna', 'premadasa', ['#2e7d32', '#ffeb3b'], 'youth-builder', 43),
    c('DAM', 'Dambulla Elephants', 'DAM', 'Dambulla', 'dambulla', ['#bf360c', '#212121'], 'value-hunter', 42),
  ],
  BAY: [
    c('DHK', 'Dhaka Royals', 'DHK', 'Dhaka', 'mirpur', ['#006a4e', '#f42a41'], 'star-commercial', 52),
    c('CTG', 'Chattogram Seahawks', 'CTG', 'Chattogram', 'zahur', ['#0057b8', '#ffffff'], 'pace-first', 46),
    c('SYL', 'Sylhet Tea Stars', 'SYL', 'Sylhet', 'sylhet', ['#2e7d32', '#ffd54f'], 'spin-tactician', 44),
    c('KHU', 'Khulna Tide', 'KHU', 'Khulna', 'mirpur', ['#00838f', '#ffffff'], 'value-hunter', 42),
    c('RJS', 'Rajshahi Silk', 'RJS', 'Rajshahi', 'zahur', ['#6a1b9a', '#ffc107'], 'youth-builder', 40),
    c('RGP', 'Rangpur Rovers', 'RGP', 'Rangpur', 'sylhet', ['#c62828', '#212121'], 'conservative', 40),
  ],
};

export function leagueById(id: string): LeagueConfig {
  const l = LEAGUES.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown league ${id}`);
  return l;
}

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  IND: 'India', AUS: 'Australia', ENG: 'England', PAK: 'Pakistan', SA: 'South Africa', NZ: 'New Zealand', SL: 'Sri Lanka',
  BAN: 'Bangladesh', WI: 'West Indies', AFG: 'Afghanistan', IRE: 'Ireland', ZIM: 'Zimbabwe', NED: 'Netherlands', SCO: 'Scotland',
  USA: 'USA', NEP: 'Nepal', UAE: 'UAE', NAM: 'Namibia', OMA: 'Oman', CAN: 'Canada',
};
