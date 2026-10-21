import type { AuctionPersonality, CountryCode, LeagueConfig, SquadRules, AuctionRules } from '@kurciv/domain';

/**
 * League registry. The world is built from this table rather than being hardcoded around the
 * IPL. Competitions and franchises use their real names (factual identifiers); trademarks such
 * as logos are not shipped. Every name here can be edited without touching game logic.
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
      { upTo: r(10), step: r(0.25) },
      { upTo: Number.POSITIVE_INFINITY, step: r(0.5) },
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
    id: 'SXT', name: 'Big Bash League', shortName: 'BBL', country: 'AUS', region: 'Oceania', fictional: false,
    initialReputation: 79, commercialValue: 80, audience: 78, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, maxRetentions: 6, retentionCosts: [3.5, 3, 2.5, 2.5, 2, 2], uncappedRetentionCost: 0.8 }),
    auctionRules: auction(28, 0.08), domesticCountries: ['AUS'], seasonStartDay: 80,
    prizeMoney: { champion: 5, runnerUp: 3, playoff: 1.5 },
  },
  {
    id: 'ALB', name: 'Vitality Blast', shortName: 'Blast', country: 'ENG', region: 'Europe', fictional: false,
    initialReputation: 76, commercialValue: 78, audience: 74, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, retentionCosts: [3.5, 3, 2.5, 2.5, 2, 2], uncappedRetentionCost: 0.8 }),
    auctionRules: auction(26, 0.08), domesticCountries: ['ENG', 'IRE', 'SCO'], seasonStartDay: 80,
    prizeMoney: { champion: 4.5, runnerUp: 2.5, playoff: 1.2 },
  },
  {
    id: 'PRT', name: 'SA20', shortName: 'SA20', country: 'SA', region: 'Africa', fictional: false,
    initialReputation: 74, commercialValue: 70, audience: 66, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.6 }),
    auctionRules: auction(24, 0.07), domesticCountries: ['SA', 'NAM'], seasonStartDay: 80,
    prizeMoney: { champion: 4, runnerUp: 2, playoff: 1 },
  },
  {
    id: 'IND2', name: 'Pakistan Super League', shortName: 'PSL', country: 'PAK', region: 'Asia', fictional: false,
    initialReputation: 70, commercialValue: 62, audience: 80, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [2.5, 2, 1.8, 1.8, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(18, 0.05), domesticCountries: ['PAK'], seasonStartDay: 80,
    prizeMoney: { champion: 3, runnerUp: 1.6, playoff: 0.8 },
  },
  {
    id: 'DES', name: 'International League T20', shortName: 'ILT20', country: 'UAE', region: 'Asia', fictional: false,
    initialReputation: 69, commercialValue: 68, audience: 52, format: 'T20', rounds: 2, playoffs: 'ipl4',
    squadRules: franchiseRules({ maxSquad: 19, minSquad: 15, maxOverseas: 9, maxPerOverseasCountry: 3, maxOverseasInXI: 7, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(24, 0.06), domesticCountries: ['UAE', 'OMA'], seasonStartDay: 80,
    prizeMoney: { champion: 3.5, runnerUp: 1.8, playoff: 0.9 },
  },
  {
    id: 'CAR', name: 'Caribbean Premier League', shortName: 'CPL', country: 'WI', region: 'Americas', fictional: false,
    initialReputation: 66, commercialValue: 55, audience: 64, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [2, 1.6, 1.4, 1.4, 1.2, 1.2], uncappedRetentionCost: 0.4 }),
    auctionRules: auction(13, 0.04), domesticCountries: ['WI'], seasonStartDay: 80,
    prizeMoney: { champion: 2.2, runnerUp: 1.2, playoff: 0.6 },
  },
  {
    id: 'LIB', name: 'Major League Cricket', shortName: 'MLC', country: 'USA', region: 'Americas', fictional: false,
    initialReputation: 64, commercialValue: 66, audience: 45, format: 'T20', rounds: 2, playoffs: 'semis',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 8, maxPerOverseasCountry: 3, maxOverseasInXI: 6, retentionCosts: [3, 2.5, 2, 2, 1.5, 1.5], uncappedRetentionCost: 0.5 }),
    auctionRules: auction(22, 0.06), domesticCountries: ['USA', 'CAN'], seasonStartDay: 80,
    prizeMoney: { champion: 3, runnerUp: 1.6, playoff: 0.8 },
  },
  {
    id: 'AOT', name: 'Super Smash', shortName: 'Smash', country: 'NZ', region: 'Oceania', fictional: false,
    initialReputation: 58, commercialValue: 48, audience: 50, format: 'T20', rounds: 2, playoffs: 'final2',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 4, maxOverseasInXI: 3, retentionCosts: [1.6, 1.4, 1.2, 1.2, 1, 1], uncappedRetentionCost: 0.3 }),
    auctionRules: auction(10, 0.03), domesticCountries: ['NZ'], seasonStartDay: 80,
    prizeMoney: { champion: 1.5, runnerUp: 0.8, playoff: 0.4 },
  },
  {
    id: 'LNK', name: 'Lanka Premier League', shortName: 'LPL', country: 'SL', region: 'Asia', fictional: false,
    initialReputation: 58, commercialValue: 45, audience: 60, format: 'T20', rounds: 2, playoffs: 'final2',
    squadRules: franchiseRules({ maxSquad: 18, minSquad: 15, maxOverseas: 5, maxOverseasInXI: 4, retentionCosts: [1.4, 1.2, 1, 1, 0.8, 0.8], uncappedRetentionCost: 0.3 }),
    auctionRules: auction(9, 0.03), domesticCountries: ['SL'], seasonStartDay: 80,
    prizeMoney: { champion: 1.2, runnerUp: 0.7, playoff: 0.3 },
  },
  {
    id: 'BAY', name: 'Bangladesh Premier League', shortName: 'BPL', country: 'BAN', region: 'Asia', fictional: false,
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

/**
 * Club seeds per league — real franchises and their colours (names as of recent seasons; edit
 * freely). Official logos are trademarked artwork and are not shipped: the UI draws an original
 * crest in each club's colours. Internal ids are stable keys and never shown to players.
 */
export const CLUB_SEEDS: Record<string, ClubSeed[]> = {
  IPL: [
    c('MUM', 'Mumbai Indians', 'MI', 'Mumbai', 'wankhede', ['#004BA0', '#D1AB3E'], 'star-commercial', 94),
    c('CHE', 'Chennai Super Kings', 'CSK', 'Chennai', 'chepauk', ['#F9CD05', '#0A4595'], 'spin-tactician', 96),
    c('BEN', 'Royal Challengers Bengaluru', 'RCB', 'Bengaluru', 'chinnaswamy', ['#EC1C24', '#2B2A29'], 'aggressive-contender', 92),
    c('KOL', 'Kolkata Knight Riders', 'KKR', 'Kolkata', 'eden', ['#3A225D', '#B3A123'], 'value-hunter', 88),
    c('DEL', 'Delhi Capitals', 'DC', 'Delhi', 'kotla', ['#17479E', '#EF1B23'], 'rebuilding', 78),
    c('HYD', 'Sunrisers Hyderabad', 'SRH', 'Hyderabad', 'uppal', ['#FF822A', '#1B1B1B'], 'pace-first', 82),
    c('RAJ', 'Rajasthan Royals', 'RR', 'Jaipur', 'sms', ['#EA1A85', '#254AA5'], 'youth-builder', 80),
    c('PUN', 'Punjab Kings', 'PBKS', 'Mullanpur', 'mullanpur', ['#DD1F2D', '#A7A9AC'], 'aggressive-contender', 76),
    c('GUJ', 'Gujarat Titans', 'GT', 'Ahmedabad', 'motera', ['#1B2133', '#B09B60'], 'conservative', 80),
    c('LKO', 'Lucknow Super Giants', 'LSG', 'Lucknow', 'ekana', ['#0057E2', '#F28B00'], 'value-hunter', 77),
  ],
  SXT: [
    c('SYS', 'Sydney Sixers', 'SIX', 'Sydney', 'scg', ['#E1137D', '#1B1B1B'], 'star-commercial', 72),
    c('SYT', 'Sydney Thunder', 'THU', 'Sydney', 'showground', ['#97D700', '#1B1B1B'], 'youth-builder', 62),
    c('MEM', 'Melbourne Stars', 'STA', 'Melbourne', 'mcg', ['#00A651', '#0B1F17'], 'aggressive-contender', 70),
    c('MEC', 'Melbourne Renegades', 'REN', 'Melbourne', 'docklands', ['#E4002B', '#1B1B1B'], 'value-hunter', 60),
    c('PEF', 'Perth Scorchers', 'SCO', 'Perth', 'perth', ['#F47920', '#1B1B1B'], 'pace-first', 70),
    c('ADK', 'Adelaide Strikers', 'STR', 'Adelaide', 'adelaide', ['#00A3E0', '#0C2340'], 'value-hunter', 63),
    c('BRS', 'Brisbane Heat', 'HEA', 'Brisbane', 'gabba', ['#00B5E2', '#7FB539'], 'conservative', 64),
    c('HOG', 'Hobart Hurricanes', 'HUR', 'Hobart', 'bellerive', ['#592C82', '#C7B26A'], 'rebuilding', 58),
  ],
  ALB: [
    c('LDR', 'Middlesex', 'MID', 'London', 'lords', ['#E5007D', '#0C2340'], 'star-commercial', 62),
    c('LDF', 'Surrey', 'SUR', 'London', 'oval', ['#4B2E1E', '#C8A464'], 'value-hunter', 68),
    c('MAN', 'Lancashire Lightning', 'LAN', 'Manchester', 'oldtrafford', ['#C8102E', '#1B1B1B'], 'aggressive-contender', 63),
    c('BIR', 'Birmingham Bears', 'BIR', 'Birmingham', 'edgbaston', ['#1D428A', '#E4002B'], 'pace-first', 60),
    c('LEE', 'Yorkshire Vikings', 'YOR', 'Leeds', 'headingley', ['#002F6C', '#FFCD00'], 'youth-builder', 60),
    c('NOT', 'Notts Outlaws', 'NOT', 'Nottingham', 'trentbridge', ['#006A4E', '#D4A017'], 'conservative', 59),
    c('SOU', 'Hampshire Hawks', 'HAM', 'Southampton', 'rosebowl', ['#00205B', '#FFC72C'], 'spin-tactician', 56),
    c('CDF', 'Glamorgan', 'GLA', 'Cardiff', 'sophia', ['#00205B', '#FFD100'], 'rebuilding', 52),
  ],
  PRT: [
    c('JHB', 'Joburg Super Kings', 'JSK', 'Johannesburg', 'wanderers', ['#FDB913', '#0A4595'], 'star-commercial', 64),
    c('CPT', 'MI Cape Town', 'MICT', 'Cape Town', 'newlands', ['#004BA0', '#D1AB3E'], 'aggressive-contender', 66),
    c('DUR', "Durban's Super Giants", 'DSG', 'Durban', 'kingsmead', ['#00A9E0', '#F28B00'], 'pace-first', 58),
    c('PRE', 'Pretoria Capitals', 'PC', 'Centurion', 'centurion', ['#17479E', '#EF1B23'], 'value-hunter', 56),
    c('GQE', 'Sunrisers Eastern Cape', 'SEC', 'Gqeberha', 'stgeorges', ['#FF822A', '#1B1B1B'], 'youth-builder', 60),
    c('PAA', 'Paarl Royals', 'PR', 'Paarl', 'boland', ['#EA1A85', '#254AA5'], 'spin-tactician', 55),
  ],
  IND2: [
    c('LHF', 'Lahore Qalandars', 'LQ', 'Lahore', 'gaddafi', ['#00A651', '#E4002B'], 'star-commercial', 64),
    c('KHC', 'Karachi Kings', 'KK', 'Karachi', 'nationalkhi', ['#0A2E6E', '#E4002B'], 'aggressive-contender', 60),
    c('ISE', 'Islamabad United', 'IU', 'Islamabad', 'pindi', ['#E4002B', '#1B1B1B'], 'value-hunter', 62),
    c('PSH', 'Peshawar Zalmi', 'PZ', 'Peshawar', 'arbab', ['#FFD100', '#1B1B1B'], 'pace-first', 60),
    c('QTC', 'Quetta Gladiators', 'QG', 'Quetta', 'bugti', ['#5B2C83', '#FFD700'], 'youth-builder', 52),
    c('MLM', 'Multan Sultans', 'MS', 'Multan', 'multan', ['#006C35', '#E9B124'], 'spin-tactician', 55),
  ],
  DES: [
    c('DXF', 'Dubai Capitals', 'DCAP', 'Dubai', 'dubai', ['#17479E', '#EF1B23'], 'star-commercial', 60),
    c('AUH', 'Abu Dhabi Knight Riders', 'ADKR', 'Abu Dhabi', 'zayed', ['#3A225D', '#B3A123'], 'aggressive-contender', 58),
    c('SHJ', 'Sharjah Warriorz', 'SW', 'Sharjah', 'sharjah', ['#E31B23', '#FFCC00'], 'spin-tactician', 50),
    c('AJM', 'Gulf Giants', 'GG', 'Dubai', 'dubai', ['#F58220', '#1B2133'], 'value-hunter', 52),
    c('RAK', 'MI Emirates', 'MIE', 'Abu Dhabi', 'zayed', ['#004BA0', '#D1AB3E'], 'pace-first', 56),
    c('FUJ', 'Desert Vipers', 'DV', 'Sharjah', 'sharjah', ['#C8102E', '#1B1B1B'], 'rebuilding', 50),
  ],
  CAR: [
    c('TRI', 'Trinbago Knight Riders', 'TKR', 'Port of Spain', 'qpo', ['#E31B23', '#1B1B1B'], 'star-commercial', 60),
    c('JAM', 'Jamaica Tallawahs', 'JT', 'Kingston', 'sabina', ['#009B3A', '#FED100'], 'aggressive-contender', 52),
    c('BAR', 'Barbados Royals', 'BR', 'Bridgetown', 'kensington', ['#EA1A85', '#254AA5'], 'pace-first', 54),
    c('GUY', 'Guyana Amazon Warriors', 'GAW', 'Providence', 'providence', ['#009E49', '#F58220'], 'spin-tactician', 54),
    c('STL', 'Saint Lucia Kings', 'SLK', 'Gros Islet', 'sammy', ['#DD1F2D', '#A7A9AC'], 'youth-builder', 46),
    c('ANT', 'Antigua & Barbuda Falcons', 'ABF', "St John's", 'vivian', ['#1E3A8A', '#E4B323'], 'value-hunter', 44),
  ],
  LIB: [
    c('NYE', 'MI New York', 'MINY', 'New York', 'nassau', ['#004BA0', '#D1AB3E'], 'star-commercial', 60),
    c('DAL', 'Texas Super Kings', 'TSK', 'Grand Prairie', 'grandprairie', ['#F9CD05', '#0A4595'], 'aggressive-contender', 58),
    c('LAL', 'Los Angeles Knight Riders', 'LAKR', 'Los Angeles', 'grandprairie', ['#3A225D', '#B3A123'], 'star-commercial', 54),
    c('BAB', 'San Francisco Unicorns', 'SFU', 'San Francisco', 'oakland', ['#E35205', '#1B2A4A'], 'value-hunter', 54),
    c('SEA', 'Seattle Orcas', 'SO', 'Seattle', 'oakland', ['#00626A', '#C1C6C8'], 'pace-first', 50),
    c('WAF', 'Washington Freedom', 'WF', 'Washington', 'churchst', ['#002D72', '#E31837'], 'conservative', 54),
  ],
  AOT: [
    c('AKL', 'Auckland Aces', 'AA', 'Auckland', 'edenpark', ['#003E7E', '#7FC3E8'], 'star-commercial', 50),
    c('WEL', 'Wellington Firebirds', 'WF', 'Wellington', 'skystadium', ['#C8102E', '#1B1B1B'], 'value-hunter', 48),
    c('CHC', 'Canterbury Kings', 'CK', 'Christchurch', 'hagley', ['#B4161B', '#1B1B1B'], 'pace-first', 47),
    c('HAM', 'Northern Brave', 'NB', 'Hamilton', 'seddon', ['#1C2E5C', '#E4B323'], 'youth-builder', 44),
    c('DUN', 'Otago Volts', 'OV', 'Dunedin', 'university', ['#F2A900', '#1F2A44'], 'conservative', 42),
    c('NAP', 'Central Stags', 'CS', 'Napier', 'mclean', ['#007A33', '#E4B323'], 'spin-tactician', 40),
  ],
  LNK: [
    c('COL', 'Colombo Strikers', 'CS', 'Colombo', 'premadasa', ['#1C2E5C', '#E4B323'], 'star-commercial', 50),
    c('KAN', 'Kandy Falcons', 'KF', 'Kandy', 'pallekele', ['#5B2C83', '#F2A900'], 'spin-tactician', 47),
    c('GAL', 'Galle Marvels', 'GM', 'Galle', 'galle', ['#0277BD', '#E4002B'], 'pace-first', 44),
    c('JAF', 'Jaffna Kings', 'JK', 'Jaffna', 'premadasa', ['#E4002B', '#F2A900'], 'youth-builder', 48),
    c('DAM', 'Dambulla Sixers', 'DS', 'Dambulla', 'dambulla', ['#BF360C', '#1B1B1B'], 'value-hunter', 42),
  ],
  BAY: [
    c('DHK', 'Dhaka Capitals', 'DC', 'Dhaka', 'mirpur', ['#006A4E', '#F42A41'], 'star-commercial', 52),
    c('CTG', 'Chattogram Kings', 'CK', 'Chattogram', 'zahur', ['#0057B8', '#F2A900'], 'pace-first', 46),
    c('SYL', 'Sylhet Strikers', 'SS', 'Sylhet', 'sylhet', ['#2E7D32', '#FFD54F'], 'spin-tactician', 44),
    c('KHU', 'Khulna Tigers', 'KT', 'Khulna', 'mirpur', ['#F58220', '#1B1B1B'], 'value-hunter', 44),
    c('RJS', 'Durbar Rajshahi', 'DR', 'Rajshahi', 'zahur', ['#6A1B9A', '#FFC107'], 'youth-builder', 40),
    c('RGP', 'Rangpur Riders', 'RR', 'Rangpur', 'sylhet', ['#C62828', '#1B1B1B'], 'conservative', 44),
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

/**
 * Export restrictions: players from these countries may only be registered in the listed
 * leagues (e.g. Indian players do not play in overseas franchise leagues). Configurable.
 */
export const EXPORT_RESTRICTIONS: Partial<Record<CountryCode, string[]>> = { IND: ['IPL'] };
