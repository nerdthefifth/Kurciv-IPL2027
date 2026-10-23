import type { AuctionPersonality, Climate, CountryCode, LeagueConfig, MatchFormat, Region, StadiumIdentity, Venue } from '@kurciv/domain';
import { COUNTRIES } from '@kurciv/domain';
import { CLUB_SEEDS, EXPORT_RESTRICTIONS, LEAGUES, auctionRulesFor, franchiseRules, type ClubSeed } from './leagues';
import { VENUES, pitchProfile } from './venues';

/**
 * The global cricket universe: a five-division pyramid mixing clubs from every cricket region,
 * the fictional clubs and grounds that complete it, the stadium catalogue, continental regions
 * and the international game. Every number here is configuration; game logic reads it.
 */

// ------------------------------------------------------------------ pyramid

export const PYRAMID = {
  divisions: 5,
  clubsPerDivision: 18,
  /** Clubs promoted from (and relegated into) each lower division. */
  promote: 3,
  relegate: 3,
  names: ['Kurciv Global Premier Division', 'Global Championship', 'Global League One', 'Global League Two', 'Global League Three'],
  shortNames: ['Premier', 'Championship', 'League One', 'League Two', 'League Three'],
  purses: [120, 64, 40, 26, 18],
  minBase: [0.3, 0.16, 0.1, 0.07, 0.05],
  reputation: [92, 79, 67, 57, 48],
  commercial: [96, 78, 62, 50, 40],
  audience: [97, 80, 64, 52, 42],
  prizeMoney: [
    { champion: 20, runnerUp: 12, playoff: 6 },
    { champion: 8, runnerUp: 5, playoff: 2.5 },
    { champion: 4.5, runnerUp: 2.8, playoff: 1.4 },
    { champion: 2.8, runnerUp: 1.6, playoff: 0.8 },
    { champion: 1.8, runnerUp: 1, playoff: 0.5 },
  ],
  /** Share of the purse gap a relegated club receives as a one-season parachute payment. */
  parachuteShare: 0.3,
  /** One-off promotion bonus as a share of the new division's purse. */
  promotionBonusShare: 0.08,
  seasonStartDay: 80,
};

const divisionRules = (purse: number) => {
  const s = purse / 120;
  const r = (v: number) => Math.round(v * s * 100) / 100;
  return franchiseRules({
    maxSquad: 22, minSquad: 16, maxOverseas: 6, maxPerOverseasCountry: 3, maxOverseasInXI: 4, maxRetentions: 6,
    retentionCosts: [18, 14, 11, 18, 14, 11].map(r), uncappedRetentionCost: r(4),
  });
};

export const DIVISIONS: LeagueConfig[] = PYRAMID.names.map((name, i) => ({
  id: `GD${i + 1}`, name, shortName: PYRAMID.shortNames[i], country: 'UAE' as CountryCode, region: 'Asia' as const, fictional: true,
  initialReputation: PYRAMID.reputation[i], commercialValue: PYRAMID.commercial[i], audience: PYRAMID.audience[i], format: 'T20' as const,
  rounds: 1 as const, playoffs: i === 0 ? ('ipl4' as const) : ('semis' as const), squadRules: divisionRules(PYRAMID.purses[i]),
  auctionRules: auctionRulesFor(PYRAMID.purses[i], PYRAMID.minBase[i]), domesticCountries: [], seasonStartDay: PYRAMID.seasonStartDay,
  prizeMoney: PYRAMID.prizeMoney[i], kind: 'division' as const, tier: i + 1,
}));

export function leagueById(id: string): LeagueConfig {
  const l = LEAGUES.find((x) => x.id === id) ?? DIVISIONS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown league ${id}`);
  return l;
}

export const isDivision = (leagueId: string) => leagueById(leagueId).kind === 'division';

/** Countries a club treats as domestic: its national league's group, or its own nation in the pyramid. */
const HOME_GROUP: Partial<Record<CountryCode, CountryCode[]>> = Object.fromEntries(LEAGUES.map((l) => [l.country, l.domesticCountries]));

export function domesticOf(club: { leagueId: string; country: CountryCode }): CountryCode[] {
  const l = leagueById(club.leagueId);
  if (l.kind !== 'division') return l.domesticCountries;
  return HOME_GROUP[club.country] ?? [club.country];
}

/**
 * Export restrictions: in national leagues a restricted player may only join the listed leagues;
 * in the pyramid the same rule means he may only join clubs from his own country.
 */
export function exportAllowed(playerCountry: CountryCode, club: { leagueId: string; country: CountryCode }): boolean {
  const restricted = EXPORT_RESTRICTIONS[playerCountry];
  if (!restricted) return true;
  return isDivision(club.leagueId) ? club.country === playerCountry : restricted.includes(club.leagueId);
}

// ------------------------------------------------------------------ regions

export const REGIONS: Region[] = ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania'];

const REGION_LIST: Record<Region, CountryCode[]> = {
  Asia: ['IND', 'PAK', 'SL', 'BAN', 'AFG', 'UAE', 'OMA', 'NEP', 'HKG', 'MAS', 'SGP', 'KUW', 'QAT', 'BRN', 'THA', 'INA', 'KSA', 'MDV', 'BHU', 'MYA', 'CHN', 'JPN', 'KOR', 'PHI', 'CAM', 'MGL', 'UZB', 'TLS'],
  Europe: ['ENG', 'IRE', 'SCO', 'NED', 'GER', 'ITA', 'DEN', 'JER', 'GUE', 'AUT', 'NOR', 'SWE', 'FRA', 'ESP', 'BEL', 'CZE', 'ROU', 'BUL', 'CYP', 'MLT', 'SUI', 'FIN', 'POR', 'GRE', 'SRB', 'GIB', 'LUX', 'HUN', 'CRO', 'IOM', 'EST', 'SLO', 'ISR', 'TUR'],
  Africa: ['SA', 'ZIM', 'NAM', 'KEN', 'UGA', 'RWA', 'NGA', 'TAN', 'BOT', 'MWI', 'SLE', 'MOZ', 'GHA', 'LES', 'SWZ', 'CMR', 'ZAM', 'MLI', 'CIV', 'SEY', 'SHN', 'GAM'],
  Americas: ['WI', 'USA', 'CAN', 'BER', 'CAY', 'ARG', 'BRA', 'MEX', 'BAH', 'BLZ', 'CRC', 'PAN', 'SUR', 'CHI', 'PER', 'TCA'],
  Oceania: ['AUS', 'NZ', 'PNG', 'VAN', 'SAM', 'FIJ', 'COK'],
};

export function regionOf(country: CountryCode): Region {
  for (const r of REGIONS) if (REGION_LIST[r].includes(country)) return r;
  return 'Asia';
}

// ------------------------------------------------------------------ fictional clubs and grounds

export interface FictionalClubSeed extends ClubSeed {
  country: CountryCode;
}

const fc = (
  id: string, name: string, shortName: string, city: string, country: CountryCode, venueId: string, colors: [string, string], personality: AuctionPersonality, brand: number,
): FictionalClubSeed => ({ id, name, shortName, city, country, venueId, colors, personality, brand });

/** Invented clubs that complete the pyramid. Clearly fictional; none represents a real team. */
export const FICTIONAL_CLUB_SEEDS: FictionalClubSeed[] = [
  fc('DUB', 'Dublin Wolfhounds', 'DWH', 'Dublin', 'IRE', 'liffeypark', ['#0B6E4F', '#F2C14E'], 'youth-builder', 44),
  fc('EDI', 'Edinburgh Thistles', 'ETH', 'Edinburgh', 'SCO', 'firthroad', ['#4B2C82', '#9ED8DB'], 'conservative', 40),
  fc('ROT', 'Rotterdam Mariners', 'RMA', 'Rotterdam', 'NED', 'maasvlakte', ['#F26B1D', '#10284A'], 'value-hunter', 41),
  fc('BER', 'Berlin Spree Bears', 'BSB', 'Berlin', 'GER', 'spreeground', ['#2B2B2B', '#E3B23C'], 'rebuilding', 34),
  fc('HRE', 'Harare Falcons', 'HFA', 'Harare', 'ZIM', 'msasapark', ['#C1272D', '#FCD116'], 'pace-first', 42),
  fc('NBO', 'Nairobi Lions', 'NLI', 'Nairobi', 'KEN', 'ngonghills', ['#006600', '#BB0000'], 'youth-builder', 36),
  fc('WDH', 'Windhoek Desert Foxes', 'WDF', 'Windhoek', 'NAM', 'khomasoval', ['#D4772C', '#1F3B73'], 'value-hunter', 38),
  fc('KLA', 'Kampala Cranes', 'KCR', 'Kampala', 'UGA', 'lugogoheights', ['#FCDC04', '#1B1B1B'], 'rebuilding', 33),
  fc('KBL', 'Kabul Eagles', 'KEA', 'Kabul', 'AFG', 'kabulhighlands', ['#0B3D91', '#D32011'], 'spin-tactician', 47),
  fc('KTM', 'Kathmandu Rhinos', 'KRH', 'Kathmandu', 'NEP', 'bagmati', ['#DC143C', '#003893'], 'youth-builder', 43),
  fc('HKJ', 'Hong Kong Junks', 'HKJ', 'Hong Kong', 'HKG', 'harbourside', ['#DE2910', '#F5F5F5'], 'star-commercial', 37),
  fc('MCT', 'Muscat Dhows', 'MDH', 'Muscat', 'OMA', 'alameratsands', ['#DB161B', '#008000'], 'value-hunter', 39),
  fc('KUL', 'Kuala Lumpur Tigers', 'KLT', 'Kuala Lumpur', 'MAS', 'bukitoval', ['#010066', '#FFCC00'], 'conservative', 35),
  fc('SGM', 'Singapore Merlions', 'SME', 'Singapore', 'SGP', 'marinaoval', ['#EF3340', '#E6E6E6'], 'star-commercial', 39),
  fc('TOR', 'Toronto Northmen', 'TNM', 'Toronto', 'CAN', 'lakeshore', ['#D80621', '#1B1B1B'], 'aggressive-contender', 42),
  fc('HOU', 'Houston Mavericks', 'HMV', 'Houston', 'USA', 'bayoufield', ['#0F4C81', '#E87722'], 'aggressive-contender', 45),
  fc('POM', 'Port Moresby Raggianas', 'PMR', 'Port Moresby', 'PNG', 'hoholapark', ['#CE1126', '#FCD116'], 'pace-first', 32),
];

const ident = (o: Partial<StadiumIdentity> & Pick<StadiumIdentity, 'standColor' | 'seatColors'>): StadiumIdentity => ({
  tiers: 2, roof: 'partial', floodlights: 'pylon', skyline: 'city', turf: '#3f7f3a', shape: 'round', ...o,
});

const fv = (
  id: string, name: string, city: string, country: CountryCode, straight: number, square: number, kind: Parameters<typeof pitchProfile>[0], dew: number,
  altitude: number, capacity: number, climate: Climate, identity: StadiumIdentity,
): Venue => ({
  id, name, city, country, boundaryStraight: straight, boundarySquare: square, altitude, pitch: pitchProfile(kind), dewChance: dew,
  capacity, fictional: true, climate, identity, provenance: 'Fictional ground. Built from original procedural Kurciv stadium modules; no third-party assets.',
});

export const FICTIONAL_VENUES: Venue[] = [
  fv('liffeypark', 'Liffey Park Oval', 'Dublin', 'IRE', 68, 63, 'green', 0.05, 20, 14000, 'maritime', ident({ tiers: 1, roof: 'partial', standColor: '#cfd8d3', seatColors: ['#0B6E4F', '#F2C14E'], skyline: 'city', turf: '#3c8a3f' })),
  fv('firthroad', 'Firth Road Ground', 'Edinburgh', 'SCO', 66, 62, 'green', 0.04, 60, 9000, 'maritime', ident({ tiers: 1, roof: 'none', standColor: '#b9b3c9', seatColors: ['#4B2C82', '#9ED8DB'], skyline: 'hills', turf: '#3a853c' })),
  fv('maasvlakte', 'Maasvlakte Oval', 'Rotterdam', 'NED', 69, 64, 'balanced', 0.06, 0, 12000, 'maritime', ident({ tiers: 1, roof: 'canopy', standColor: '#d9d4cc', seatColors: ['#F26B1D', '#10284A'], skyline: 'coast', turf: '#418c3e', shape: 'oval' })),
  fv('spreeground', 'Spree Ground', 'Berlin', 'GER', 65, 60, 'balanced', 0.05, 35, 8000, 'temperate', ident({ tiers: 1, roof: 'none', standColor: '#c8c8c8', seatColors: ['#2B2B2B', '#E3B23C'], skyline: 'city', turf: '#3e8540', shape: 'square' })),
  fv('msasapark', 'Msasa Park', 'Harare', 'ZIM', 71, 66, 'balanced', 0.15, 1490, 15000, 'highland', ident({ tiers: 1, roof: 'partial', standColor: '#e2d6c0', seatColors: ['#C1272D', '#FCD116'], skyline: 'hills', turf: '#4a8a35' })),
  fv('ngonghills', 'Ngong Hills Ground', 'Nairobi', 'KEN', 70, 65, 'slow', 0.1, 1795, 11000, 'highland', ident({ tiers: 1, roof: 'none', standColor: '#ded3bb', seatColors: ['#006600', '#BB0000'], skyline: 'mountains', turf: '#4f8c33' })),
  fv('khomasoval', 'Khomas Oval', 'Windhoek', 'NAM', 72, 67, 'flat', 0.05, 1650, 10000, 'arid', ident({ tiers: 1, roof: 'partial', standColor: '#e6d2b0', seatColors: ['#D4772C', '#1F3B73'], skyline: 'desert', turf: '#5a8c35' })),
  fv('lugogoheights', 'Lugogo Heights', 'Kampala', 'UGA', 68, 64, 'slow', 0.25, 1190, 9000, 'tropical', ident({ tiers: 1, roof: 'none', standColor: '#d8cfb5', seatColors: ['#FCDC04', '#1B1B1B'], skyline: 'hills', turf: '#3f8f36' })),
  fv('kabulhighlands', 'Kabul Highlands Stadium', 'Kabul', 'AFG', 72, 66, 'dry', 0.05, 1790, 18000, 'highland', ident({ tiers: 2, roof: 'partial', standColor: '#e0d4bd', seatColors: ['#0B3D91', '#D32011'], skyline: 'mountains', turf: '#5b8a37' })),
  fv('bagmati', 'Bagmati Riverside Stadium', 'Kathmandu', 'NEP', 68, 63, 'slow', 0.1, 1400, 20000, 'highland', ident({ tiers: 2, roof: 'partial', standColor: '#e3d9c6', seatColors: ['#DC143C', '#003893'], skyline: 'mountains', turf: '#46893a' })),
  fv('harbourside', 'Harbourside Oval', 'Hong Kong', 'HKG', 64, 60, 'flat', 0.45, 5, 12000, 'subtropical', ident({ tiers: 2, roof: 'canopy', standColor: '#d5d9de', seatColors: ['#DE2910', '#F5F5F5'], skyline: 'city', turf: '#3e8a40', shape: 'square' })),
  fv('alameratsands', 'Al Amerat Sands', 'Muscat', 'OMA', 73, 68, 'dry', 0.3, 30, 9000, 'arid', ident({ tiers: 1, roof: 'partial', standColor: '#eadbc0', seatColors: ['#DB161B', '#008000'], skyline: 'desert', turf: '#5c9038' })),
  fv('bukitoval', 'Bukit Oval', 'Kuala Lumpur', 'MAS', 69, 64, 'slow', 0.55, 60, 13000, 'tropical', ident({ tiers: 1, roof: 'canopy', standColor: '#d6d6cf', seatColors: ['#010066', '#FFCC00'], skyline: 'city', turf: '#3a8f3a', shape: 'oval' })),
  fv('marinaoval', 'Marina Bay Oval', 'Singapore', 'SGP', 65, 61, 'flat', 0.55, 10, 16000, 'tropical', ident({ tiers: 2, roof: 'canopy', standColor: '#dfe3e6', seatColors: ['#EF3340', '#E6E6E6'], skyline: 'coast', turf: '#3b9140', floodlights: 'roofline' })),
  fv('lakeshore', 'Lakeshore Oval', 'Toronto', 'CAN', 68, 64, 'balanced', 0.1, 80, 14000, 'temperate', ident({ tiers: 1, roof: 'partial', standColor: '#d4d4d4', seatColors: ['#D80621', '#1B1B1B'], skyline: 'coast', turf: '#3e8a3d' })),
  fv('bayoufield', 'Bayou Field', 'Houston', 'USA', 70, 66, 'flat', 0.45, 15, 22000, 'subtropical', ident({ tiers: 2, roof: 'canopy', standColor: '#d9d3c7', seatColors: ['#0F4C81', '#E87722'], skyline: 'city', turf: '#43903b', floodlights: 'ring' })),
  fv('hoholapark', 'Hohola Park', 'Port Moresby', 'PNG', 67, 63, 'balanced', 0.4, 40, 8000, 'tropical', ident({ tiers: 1, roof: 'none', standColor: '#d9cfb8', seatColors: ['#CE1126', '#FCD116'], skyline: 'hills', turf: '#3c8d36' })),
];

// ------------------------------------------------------------------ stadium catalogue

/** Approximate seating capacities of the real grounds (public figures, rounded). */
const CAPACITY: Record<string, number> = {
  wankhede: 33000, chepauk: 38000, chinnaswamy: 32000, eden: 66000, kotla: 41000, uppal: 55000, sms: 30000, mullanpur: 38000, motera: 132000, ekana: 50000,
  scg: 48000, showground: 22000, mcg: 100000, docklands: 53000, perth: 60000, adelaide: 53500, gabba: 42000, bellerive: 19500,
  lords: 31000, oval: 27500, oldtrafford: 26000, edgbaston: 25000, headingley: 18350, trentbridge: 17500, rosebowl: 25000, sophia: 16000,
  wanderers: 34000, newlands: 25000, kingsmead: 25000, centurion: 22000, boland: 10000, stgeorges: 19000,
  gaddafi: 34000, nationalkhi: 34000, pindi: 15000, arbab: 16000, bugti: 15000, multan: 30000,
  dubai: 25000, zayed: 20000, sharjah: 16000, sabina: 20000, kensington: 28000, providence: 15000, sammy: 15000, qpo: 20000, vivian: 10000,
  nassau: 34000, grandprairie: 7200, oakland: 8000, churchst: 6000, edenpark: 42000, skystadium: 34500, hagley: 18000, seddon: 10000, university: 6000, mclean: 19700,
  premadasa: 35000, pallekele: 35000, galle: 35000, dambulla: 16800, mirpur: 25000, zahur: 22000, sylhet: 18500,
};

const CLIMATE: Partial<Record<CountryCode, Climate>> = {
  IND: 'subtropical', AUS: 'temperate', ENG: 'maritime', SA: 'temperate', PAK: 'arid', UAE: 'arid', WI: 'tropical', USA: 'temperate', NZ: 'maritime', SL: 'tropical', BAN: 'tropical',
};

const COAST = new Set(['wankhede', 'chepauk', 'scg', 'perth', 'newlands', 'kingsmead', 'nationalkhi', 'dubai', 'sabina', 'kensington', 'sammy', 'qpo', 'edenpark', 'skystadium', 'mclean', 'premadasa', 'galle', 'zahur', 'bellerive']);
const HILLS = new Set(['pallekele', 'dambulla', 'wanderers', 'centurion', 'boland', 'university', 'sylhet', 'hagley', 'providence', 'vivian']);

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

const STAND_TONES = ['#d8d2c6', '#cfd3d6', '#e0d8c8', '#c9cdd2', '#ddd6cb', '#d3cbbd'];

/** Enriches a real venue with catalogue fields derived from public facts and its setting. */
function enrich(v: Venue, clubColors: [string, string] | undefined): Venue {
  const capacity = CAPACITY[v.id] ?? 15000;
  const h = hashOf(v.id);
  const climate = CLIMATE[v.country] ?? (v.altitude > 1000 ? 'highland' : 'temperate');
  const turf = climate === 'arid' ? '#5d8f39' : climate === 'maritime' ? '#3c853d' : climate === 'tropical' ? '#3b8c37' : '#43893a';
  const identity: StadiumIdentity = {
    tiers: capacity >= 60000 ? 3 : capacity >= 28000 ? 2 : 1,
    roof: v.id === 'docklands' ? 'canopy' : capacity >= 40000 ? 'canopy' : capacity >= 20000 ? 'partial' : 'none',
    floodlights: v.id === 'docklands' || v.id === 'perth' ? 'roofline' : capacity >= 50000 && h % 3 === 0 ? 'ring' : 'pylon',
    standColor: STAND_TONES[h % STAND_TONES.length],
    seatColors: clubColors ?? ['#2f5f8f', '#c9c9c9'],
    skyline: COAST.has(v.id) ? 'coast' : HILLS.has(v.id) ? 'hills' : v.country === 'UAE' || v.country === 'PAK' ? 'desert' : 'city',
    turf,
    shape: v.boundaryStraight - v.boundarySquare >= 6 ? 'oval' : 'round',
  };
  return {
    ...v, capacity, fictional: false, climate, identity,
    provenance: 'Real ground: name, city, approximate dimensions and capacity are public facts. The 3D view uses original procedural Kurciv stadium modules, not a replica.',
  };
}

let catalogue: Venue[] | null = null;

/** Every ground in the universe (real grounds enriched, then fictional grounds). */
export function stadiumCatalogue(): Venue[] {
  if (catalogue) return catalogue;
  const colorsByVenue = new Map<string, [string, string]>();
  for (const seeds of Object.values(CLUB_SEEDS)) for (const s of seeds) if (!colorsByVenue.has(s.venueId)) colorsByVenue.set(s.venueId, s.colors);
  catalogue = [...VENUES.map((v) => enrich(v, colorsByVenue.get(v.id))), ...FICTIONAL_VENUES];
  return catalogue;
}

export function venueById(id: string): Venue {
  return stadiumById(id);
}

export function stadiumById(id: string): Venue {
  const v = stadiumCatalogue().find((x) => x.id === id);
  if (!v) throw new Error(`Unknown venue ${id}`);
  return v;
}

// ------------------------------------------------------------------ continental cups

export const CONTINENTAL = {
  /** Entrants per cup (groups of four, then semi-finals and a final at a neutral ground). */
  championsCupSize: 8,
  shieldSize: 8,
  /** Weights for qualification: this season's pyramid finish and the club's reputation. */
  weights: { performance: 0.7, reputation: 0.3 },
  /** Start this many days after the last league match. */
  startDayAfterLeagues: 4,
  prize: {
    champions: { champion: 8, runnerUp: 4, semi: 2, group: 0.6 },
    shield: { champion: 3, runnerUp: 1.6, semi: 0.8, group: 0.25 },
  },
  cupNames: {
    Asia: ['Asian Champions Cup', 'Asian Shield'],
    Europe: ['European Champions Cup', 'European Shield'],
    Africa: ['African Champions Cup', 'African Shield'],
    Americas: ['Americas Champions Cup', 'Americas Shield'],
    Oceania: ['Oceania Champions Cup', 'Oceania Shield'],
  } as Record<Region, [string, string]>,
  /** Global Club Championship: continental winners and runners-up plus the best remaining Premier Division clubs. */
  globalTeams: 16,
  /** Coefficient points per result (continental and global matches). */
  coefficient: { win: 2, tie: 1, semi: 2, final: 3, title: 4, globalMultiplier: 1.5 },
};

// ------------------------------------------------------------------ preseason

export const PRESEASON = {
  firstDay: 42,
  lastDay: 76,
  maxFriendlies: 4,
  /** Minimum rest days between a club's matches. */
  minGap: 2,
  /** Friendlies count for this share of a competitive match in reputation and board confidence. */
  reputationWeight: 0.25,
  boardWeight: 0.2,
  aiFriendlies: [1, 2] as [number, number],
};

// ------------------------------------------------------------------ international

export interface NationSeed {
  country: CountryCode;
  full: boolean;
  colors: [string, string];
}

export const NATIONS: NationSeed[] = [
  { country: 'IND', full: true, colors: ['#1C4FA1', '#FF9933'] },
  { country: 'AUS', full: true, colors: ['#FFCD00', '#00843D'] },
  { country: 'ENG', full: true, colors: ['#1C2C5B', '#CF142B'] },
  { country: 'PAK', full: true, colors: ['#01411C', '#FFFFFF'] },
  { country: 'SA', full: true, colors: ['#007749', '#FFB81C'] },
  { country: 'NZ', full: true, colors: ['#111111', '#BFBFBF'] },
  { country: 'SL', full: true, colors: ['#0B2D8F', '#FFBE29'] },
  { country: 'BAN', full: true, colors: ['#006A4E', '#F42A41'] },
  { country: 'WI', full: true, colors: ['#7B0041', '#FFC72C'] },
  { country: 'AFG', full: true, colors: ['#0066B3', '#D32011'] },
  { country: 'IRE', full: true, colors: ['#169B62', '#FFFFFF'] },
  { country: 'ZIM', full: true, colors: ['#D40000', '#FFD200'] },
  { country: 'NED', full: false, colors: ['#FF6600', '#21468B'] },
  { country: 'SCO', full: false, colors: ['#5B2C83', '#0065BF'] },
  { country: 'USA', full: false, colors: ['#002868', '#BF0A30'] },
  { country: 'NEP', full: false, colors: ['#DC143C', '#003893'] },
  { country: 'UAE', full: false, colors: ['#00732F', '#FF0000'] },
  { country: 'NAM', full: false, colors: ['#003580', '#D21034'] },
  { country: 'OMA', full: false, colors: ['#DB161B', '#008000'] },
  { country: 'CAN', full: false, colors: ['#D80621', '#FFFFFF'] },
  { country: 'HKG', full: false, colors: ['#DE2910', '#FFFFFF'] },
  { country: 'PNG', full: false, colors: ['#CE1126', '#FCD116'] },
  { country: 'KEN', full: false, colors: ['#006600', '#BB0000'] },
  { country: 'UGA', full: false, colors: ['#FCDC04', '#000000'] },
];

export const nationName = (c: CountryCode) => COUNTRIES.find((x) => x.code === c)?.name ?? c;

export const INTERNATIONAL = {
  /** Preseason window: bilateral tours (Tests and ODIs) and the associate qualifier. */
  preseasonWindow: { from: 44, to: 76 },
  /** Post-season window for the year's world event and regional cups. */
  postseasonGap: 4,
  /** Rest days a nation's players get either side of a call-up. */
  releaseDays: 1,
  squadSize: { T20: 15, ODI: 15, Test: 16 } as Record<MatchFormat, number>,
  /** World events rotate by season: index = (season − start) mod 4. */
  worldRotation: ['T20 World Cup', 'ODI World Cup', 'World Test Championship Final', 'Champions Trophy'] as const,
  ratingK: { T20: 22, ODI: 20, Test: 26 } as Record<MatchFormat, number>,
  /** Days a Test occupies. */
  testDays: 5,
};

export const ALL_LEAGUE_CONFIGS = (): LeagueConfig[] => [...LEAGUES, ...DIVISIONS];
