import type { BowlingType, CountryCode, Hand, Player, PlayerAttributes, Role } from '@kurciv/domain';
import { emptyStatLine, isPace, isSpin, overallFor } from '@kurciv/domain';
import { Rng, hash01 } from '@kurciv/simulation';
import type { CuratedRow } from './curated';

const clamp = (v: number, lo = 1, hi = 99) => Math.max(lo, Math.min(hi, Math.round(v)));

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function shortNameOf(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return name;
  if (parts[0].length <= 2 && parts[0] === parts[0].toUpperCase()) return name; // "KL Rahul", "MS Dhoni"
  return `${parts[0][0]} ${parts.slice(1).join(' ')}`;
}

const SUBCONTINENT: CountryCode[] = ['IND', 'PAK', 'SL', 'BAN', 'AFG', 'NEP', 'UAE', 'OMA'];

/**
 * Expand a compact skill description into the full attribute model. `jit` provides
 * deterministic per-player variation so two 80-rated batters are not clones.
 */
export function buildAttributes(
  bat: number, bowl: number, role: Role, type: BowlingType, tags: string[], age: number, country: CountryCode, jit: (k: string) => number,
): PlayerAttributes {
  const has = (t: string) => tags.includes(t);
  const sub = SUBCONTINENT.includes(country);
  const v = (k: string, amp = 4) => (jit(k) - 0.5) * 2 * amp;
  const vsPace = bat + v('vp') + (sub ? -1.5 : 1.5);
  const vsSpin = bat + v('vs') + (sub ? 3 : -2) + (has('spin-killer') ? 6 : 0) + (has('sweeper') ? 3 : 0);
  const batAttrs = {
    vsPace: clamp(vsPace),
    vsSpin: clamp(vsSpin),
    power: clamp(bat * 0.82 + 12 + v('pw', 6) + (has('power') ? 12 : 0) - (has('anchor') ? 9 : 0)),
    rotation: clamp(bat * 0.8 + 13 + v('ro', 5) + (has('anchor') ? 7 : 0) - (has('power') ? 3 : 0)),
    defence: clamp(bat * 0.9 + 5 + v('de', 5) + (has('anchor') ? 8 : 0) - (has('power') ? 6 : 0)),
    powerplay: clamp(bat + v('pp') + (has('opener') ? 5 : -2)),
    middle: clamp(bat + v('mi') + (has('anchor') ? 4 : 0) + (has('spin-killer') ? 3 : 0)),
    death: clamp(bat + v('dt') + (has('finisher') ? 8 : 0) + (has('power') ? 4 : 0) - (has('opener') ? 3 : 0) - (has('anchor') ? 4 : 0)),
  };
  const bowls = type !== 'NONE';
  const W = bowls ? bowl : 10;
  let speed: number;
  if (type === 'RF' || type === 'LF') speed = 141 + (W - 75) * 0.12 + (has('express') ? 6 : 0) + v('sp', 2.5);
  else if (type === 'RFM' || type === 'LFM') speed = 134 + (W - 75) * 0.1 + (has('express') ? 4 : 0) + v('sp', 2.5);
  else if (type === 'RM' || type === 'LM') speed = 126 + (W - 70) * 0.08 + v('sp', 2.5);
  else if (type === 'LB' || type === 'SLC') speed = 84 + v('sp', 3);
  else if (type === 'OB' || type === 'SLA') speed = 87 + v('sp', 3);
  else speed = 110;
  const bowlAttrs = {
    speed: Math.round(speed * 10) / 10,
    control: clamp(W + v('ct') + (has('control') ? 6 : 0) - (has('express') ? 3 : 0)),
    movement: clamp(W + v('mv') + (has('swing') ? 7 : 0) + (isSpin(type) && has('mystery') ? 3 : 0)),
    variation: clamp(W * 0.88 + 6 + v('va', 5) + (has('mystery') ? 14 : 0) + (has('variations') ? 9 : 0)),
    yorker: clamp(W * 0.88 + 4 + v('yo', 5) + (has('death') ? 11 : 0) - (isSpin(type) ? 25 : 0)),
    slower: clamp(W * 0.84 + 6 + v('sl', 5) + (has('death') ? 6 : 0) + (has('variations') ? 9 : 0)),
    powerplay: clamp(W + v('bp') + (has('newball') ? 8 : 0) + (has('swing') ? 3 : 0) - (isSpin(type) ? 3 : 0)),
    death: clamp(W * 0.95 + 2 + v('bd') + (has('death') ? 10 : 0) - (has('newball') && !has('death') ? 4 : 0) - (isSpin(type) ? 4 : 0)),
    stamina: clamp(68 + v('st', 8) - Math.max(0, age - 32) * 2 + (isPace(type) ? 0 : 8)),
  };
  if (!bowls) {
    bowlAttrs.control = clamp(15 + v('ct', 5));
    bowlAttrs.movement = clamp(15 + v('mv', 5));
  }
  const athletic = 72 - Math.max(0, age - 27) * 1.6 + v('at', 7) + (has('gun-fielder') ? 15 : 0) - (role === 'BOWL' && isPace(type) ? 2 : 0);
  const field = {
    catching: clamp(66 + v('ca', 9) + (role === 'WK' ? 12 : 0) + (has('gun-fielder') ? 12 : 0)),
    ground: clamp(64 + v('gr', 9) + (has('gun-fielder') ? 14 : 0) - Math.max(0, age - 32) * 1.5),
    throwing: clamp(64 + v('th', 9) + (has('gun-fielder') ? 12 : 0) + (isPace(type) ? 4 : 0)),
    athleticism: clamp(athletic),
    keeping: clamp(role === 'WK' ? 70 + bat * 0.1 + v('kp', 6) : 12 + v('kp', 6)),
  };
  const mental = {
    temperament: clamp(56 + Math.max(bat, bowl) * 0.18 + Math.min(age - 22, 10) * 0.8 + v('te', 7) + (has('clutch') ? 12 : 0)),
    leadership: clamp(40 + Math.min(age - 20, 14) * 1.5 + v('le', 8) + (has('captain') ? 25 : 0)),
    adaptability: clamp(58 + v('ad', 10) + (has('360') ? 10 : 0)),
    workEthic: clamp(66 + v('we', 12)),
  };
  const phys = {
    fitness: clamp(74 - Math.max(0, age - 29) * 1.4 + v('fi', 8)),
    durability: clamp(70 + v('du', 10) - (has('injury-prone') ? 22 : 0) - (has('express') ? 5 : 0)),
  };
  return { bat: batAttrs, bowl: bowlAttrs, field, mental, phys };
}

function basePlayer(): Omit<Player, 'id' | 'name' | 'shortName' | 'country' | 'birthYear' | 'role' | 'batHand' | 'bowlType' | 'capped' | 'source' | 'styleTags' | 'attrs' | 'potential' | 'ratingUncertainty' | 'reputation' | 'ageConfidence' | 'personality'> {
  return {
    form: 0, fatigue: 0, workload: 0, morale: 65, injury: null, injuryHistory: [], clubId: null, contract: null, isYouth: false, retired: false,
    stats: { career: emptyStatLine(), seasons: {} }, development: [],
    image: { url: null, attribution: null, licence: null, sourceUrl: null, lastChecked: null },
    benchStreak: 0, transferRequest: false,
  };
}

const PERSONALITIES: Player['personality'][] = ['professional', 'ambitious', 'temperamental', 'loyal', 'easygoing'];

export function expandCurated(row: CuratedRow, season: number): Player {
  const [name, country, birthYear, role, batHand, bowlType, bat, bowl, capped, tagStr] = row;
  const tags = tagStr.split(' ').filter(Boolean);
  const id = `p-${slug(name)}`;
  const jit = (k: string) => hash01(`${id}|${k}`);
  const age = season - birthYear;
  const attrs = buildAttributes(bat, bowl, role, bowlType, tags, age, country, jit);
  const ovr = overallFor(role, attrs, bowlType);
  const growth = age <= 24 ? (25 - age) * (1.2 + jit('pot') * 1.6) : age <= 27 ? jit('pot') * 2 : 0;
  return {
    ...basePlayer(),
    id, name, shortName: shortNameOf(name), country, birthYear, ageConfidence: 'curated', role, batHand, bowlType, capped: capped === 1,
    source: 'curated', styleTags: tags, attrs,
    potential: Math.min(97, Math.round(ovr + growth)),
    ratingUncertainty: capped ? 3.5 : 6,
    reputation: Math.round(Math.max(5, Math.min(99, (ovr - 55) * 2.2 + (capped ? 12 : 0) + (tags.includes('captain') ? 6 : 0)))),
    personality: PERSONALITIES[Math.floor(jit('pers') * PERSONALITIES.length)],
  };
}

// ------------------------------------------------------------------ generated players

const NAMES: Record<string, { first: string[]; last: string[] }> = {
  GER: {
    first: ['Lukas', 'Jonas', 'Felix', 'Maximilian', 'Leon', 'Finn', 'Niklas', 'Tobias', 'Moritz', 'Jan', 'Ahmad', 'Faisal', 'Harmanjot', 'Dylan', 'Talha', 'Venkatraman', 'Michael', 'Sahir'],
    last: ['Schmidt', 'Weber', 'Fischer', 'Becker', 'Wagner', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Schulz', 'Khan', 'Ahmadzai', 'Naqvi', 'Singh', 'Blignaut', 'Ganesh', 'Rowe'],
  },
  KEN: {
    first: ['Collins', 'Rakep', 'Shem', 'Nelson', 'Irfan', 'Alex', 'Peter', 'Dhiren', 'Lucas', 'Gerard', 'Sachin', 'Emmanuel', 'Daniel', 'Brian', 'Kennedy', 'Vraj'],
    last: ['Obuya', 'Ngoche', 'Odhiambo', 'Otieno', 'Ouma', 'Kamau', 'Mwangi', 'Ochieng', 'Patel', 'Karim', 'Wanjala', 'Oluoch', 'Bhudia', 'Kimani', 'Gondaria'],
  },
  UGA: {
    first: ['Brian', 'Riazat', 'Juma', 'Frank', 'Henry', 'Simon', 'Robinson', 'Cosmas', 'Dinesh', 'Fred', 'Kenneth', 'Bilal', 'Ronak', 'Alpesh', 'Pascal'],
    last: ['Masaba', 'Miyagi', 'Nsubuga', 'Ssenyondo', 'Obuya', 'Kyewuta', 'Waiswa', 'Achelam', 'Mukasa', 'Kakooza', 'Nakrani', 'Ramjani', 'Murungi', 'Hassan', 'Patel'],
  },
  HKG: {
    first: ['Nizakat', 'Babar', 'Kinchit', 'Aizaz', 'Ehsan', 'Yasim', 'Zeeshan', 'Martin', 'Scott', 'Waqas', 'Jason', 'Wing', 'Anshuman', 'Haroon', 'Adit'],
    last: ['Khan', 'Hayat', 'Shah', 'Ali', 'Murtaza', 'Chan', 'Wong', 'Lee', 'McKechnie', 'Rath', 'Tse', 'Arshad', 'Gaur', 'Barkat', 'Cheung'],
  },
  MAS: {
    first: ['Virandeep', 'Ahmad', 'Syazrul', 'Sharvin', 'Anwar', 'Muhammad', 'Pavandeep', 'Aminuddin', 'Zubaidi', 'Khizar', 'Syed', 'Vijay', 'Fitri', 'Rizwan'],
    last: ['Singh', 'Faiz', 'Idrus', 'Muthusamy', 'Rahman', 'Ramli', 'Hassan', 'Ismail', 'Zulkifli', 'Hayat', 'Aziz', 'Unni', 'Sharif', 'Nasir'],
  },
  SGP: {
    first: ['Aman', 'Janak', 'Surendran', 'Vinoth', 'Aritra', 'Anish', 'Rezza', 'Navin', 'Amjad', 'Rohan', 'Arjun', 'Vineet', 'Ahsan', 'Akshay'],
    last: ['Desai', 'Prakash', 'Chandramohan', 'Baskaran', 'Dutta', 'Paraam', 'Gaznavi', 'Param', 'Mahmood', 'Rangarajan', 'Puri', 'Kumar', 'Tan', 'Lim'],
  },
  PNG: {
    first: ['Assad', 'Tony', 'Kiplin', 'Charles', 'Norman', 'Sese', 'Chad', 'Lega', 'Riley', 'Kabua', 'Hiri', 'Semo', 'Damien', 'Jack', 'Alei'],
    last: ['Vala', 'Ura', 'Doriga', 'Amini', 'Vanua', 'Bau', 'Soper', 'Siaka', 'Hekure', 'Morea', 'Kila', 'Nao', 'Gavera', 'Raho', 'Reva'],
  },
  IND: {
    first: ['Aarav', 'Vihaan', 'Arjun', 'Kabir', 'Rohan', 'Aditya', 'Siddharth', 'Karthik', 'Pranav', 'Nikhil', 'Harsh', 'Yash', 'Dev', 'Ishaan', 'Manav', 'Rahul', 'Tanmay', 'Varun', 'Akshay', 'Sahil', 'Omkar', 'Kunal', 'Ritesh', 'Gaurav', 'Parth', 'Sanket', 'Abhay', 'Chirag', 'Vedant', 'Atharva', 'Shivansh', 'Anirudh', 'Mohit', 'Sumeet', 'Lakshay', 'Tushar', 'Nishant', 'Jatin', 'Ruturaj', 'Hemant'],
    last: ['Sharma', 'Verma', 'Patil', 'Iyer', 'Nair', 'Reddy', 'Kulkarni', 'Chauhan', 'Rathore', 'Mishra', 'Pandey', 'Joshi', 'Desai', 'Menon', 'Saini', 'Thakur', 'Bhatt', 'Yadav', 'Rawat', 'Tiwari', 'Gill', 'Sandhu', 'Pillai', 'Shetty', 'Kamath', 'Jadhav', 'More', 'Naik', 'Rana', 'Bisht', 'Dubey', 'Tripathi', 'Hegde', 'Sinha', 'Malhotra'],
  },
  AUS: {
    first: ['Jack', 'Liam', 'Noah', 'Oliver', 'Riley', 'Cooper', 'Mitchell', 'Lachlan', 'Hamish', 'Brody', 'Callum', 'Jayden', 'Fergus', 'Tom', 'Sam', 'Will', 'Harry', 'Archie', 'Max', 'Kai', 'Toby', 'Lucas', 'Charlie', 'Ethan'],
    last: ['Walsh', 'McAllister', 'Doyle', 'Barker', 'Fitzgerald', 'Hollis', 'Pearce', 'Kerr', 'Langford', 'Brennan', 'Crowther', 'Haddon', 'Mackie', 'Sutton', 'Rowe', 'Gardiner', 'Hewitt', 'Lowe', 'Prentice', 'Tully', 'Whitlock', 'Ashby', 'Burgess', 'Cullen'],
  },
  ENG: {
    first: ['George', 'Alfie', 'Freddie', 'Theo', 'Oscar', 'Henry', 'Arthur', 'Jacob', 'Ollie', 'Ben', 'Dan', 'Joe', 'Matt', 'Rory', 'Tom', 'Josh', 'Luke', 'Ed', 'Sam', 'Jamie', 'Will', 'Zak', 'Rehan', 'Danny'],
    last: ['Hargreaves', 'Pemberton', 'Ashworth', 'Wainwright', 'Fletcher', 'Cartwright', 'Holloway', 'Pritchard', 'Bramley', 'Thornton', 'Lockwood', 'Whitaker', 'Ellison', 'Fairbairn', 'Kettle', 'Marsden', 'Oakley', 'Radford', 'Sheldon', 'Tranter', 'Vickers', 'Yardley', 'Bassett', 'Crowley'],
  },
  PAK: {
    first: ['Usman', 'Hamza', 'Bilal', 'Fahad', 'Saad', 'Zain', 'Ahmed', 'Haider', 'Umair', 'Ali', 'Hassan', 'Talha', 'Junaid', 'Waqas', 'Asad', 'Imran', 'Kamran', 'Shoaib', 'Arsalan', 'Danish'],
    last: ['Khan', 'Malik', 'Butt', 'Qureshi', 'Iqbal', 'Siddiqui', 'Chaudhry', 'Raza', 'Abbasi', 'Hussain', 'Mirza', 'Sheikh', 'Gul', 'Javed', 'Akhtar', 'Niazi', 'Tariq', 'Anwar', 'Saeed', 'Rasheed'],
  },
  SA: {
    first: ['Pieter', 'Johan', 'Ruan', 'Sipho', 'Thando', 'Kyle', 'Jason', 'Dean', 'Lutho', 'Wihan', 'Matthew', 'Andile', 'Grant', 'Tiaan', 'Keegan', 'Bongani', 'Shaun', 'Liam', 'Zubayr', 'Eathan'],
    last: ['van Wyk', 'Botha', 'Nkosi', 'Smit', 'Pretorius', 'Mokoena', 'du Toit', 'Ndlovu', 'Venter', 'Coetzer', 'Fourie', 'Mahlangu', 'Swart', 'Booysen', 'Dlamini', 'Kruger', 'Naidoo', 'Petersen', 'Hendriks', 'Mbeki'],
  },
  NZ: {
    first: ['Finn', 'Hamish', 'Jacob', 'Logan', 'Blake', 'Henry', 'Nathan', 'Tama', 'Will', 'Ben', 'Dane', 'Cole', 'Josh', 'Ryan', 'Ollie', 'Kieran'],
    last: ['McKenzie', 'Tane', 'Bryce', 'Harland', 'Ngata', 'Weston', 'Kingsley', 'Dunmore', 'Parata', 'Reece', 'Sheehan', 'Thorne', 'Wiremu', 'Allcott', 'Bevan', 'Corbett'],
  },
  WI: {
    first: ['Kemar', 'Andre', 'Jermaine', 'Kavem', 'Shamarh', 'Kirk', 'Justin', 'Tevin', 'Keacy', 'Odean', 'Nyeem', 'Jahmar', 'Ackeem', 'Raymon', 'Marquino', 'Kevlon'],
    last: ['Blackwood', 'Greaves', 'Joseph', 'Ramdin', 'Phillip', 'Seecharan', 'Mohammed', 'Clarke', 'Carty', 'Bishop', 'Walcott', 'Hodge', 'Sinclair', 'Dowrich', 'Gooding', 'Lashley'],
  },
  SL: {
    first: ['Kasun', 'Nuwan', 'Dhananjaya', 'Lahiru', 'Pathum', 'Chamika', 'Sadeera', 'Janith', 'Ramesh', 'Asitha', 'Nipun', 'Dunith', 'Lakshan', 'Pramod', 'Chaturanga'],
    last: ['Perera', 'Fernando', 'Silva', 'Jayasuriya', 'Bandara', 'Rajapaksa', 'Wickramasinghe', 'Dissanayake', 'Kumara', 'Herath', 'Gunathilaka', 'Rathnayake', 'Samarawickrama', 'Liyanage', 'Weerakoon'],
  },
  BAN: {
    first: ['Mahmud', 'Shamim', 'Afif', 'Nasum', 'Rakibul', 'Saif', 'Mosaddek', 'Anamul', 'Tanvir', 'Rony', 'Ripon', 'Akbar', 'Yasir', 'Parvez', 'Mahfuz'],
    last: ['Hossain', 'Islam', 'Rahman', 'Hasan', 'Ahmed', 'Mondol', 'Sarkar', 'Chowdhury', 'Kabir', 'Talukdar', 'Mia', 'Haque', 'Ali', 'Uddin', 'Karim'],
  },
  AFG: { first: ['Hazrat', 'Sediqullah', 'Darwish', 'Ijaz', 'Zia', 'Bilal', 'Farid', 'Nangeyalia', 'Qais', 'Shahidullah'], last: ['Zazai', 'Atal', 'Rasooli', 'Ahmadzai', 'Safi', 'Malik', 'Kharoti', 'Stanikzai', 'Sharifi', 'Jamal'] },
  USA: { first: ['Ryan', 'Nitish', 'Jasdeep', 'Shayan', 'Milind', 'Nosthush', 'Elmore', 'Sujith', 'Cameron', 'Tyler', 'Vatsal', 'Rushil', 'Juanoy', 'Ethan', 'Marcus'], last: ['Patel', 'Kumar', 'Jahangir', 'Singh', 'Gowda', 'Hutchinson', 'Brooks', 'Vasudevan', 'Mendez', 'Collins', 'Drysdale', 'Reyes', 'Shah', 'Lopez', 'Gibson'] },
  UAE: { first: ['Rohan', 'Zahoor', 'Vriitya', 'Alishan', 'Basil', 'Ethan', 'Karthik', 'Hazrat', 'Sanchit', 'Adhitya'], last: ['Mustafa', 'Khan', 'Aravind', 'Sharafu', 'Hameed', "D'Souza", 'Meiyappan', 'Bilal', 'Sharma', 'Shetty'] },
  IRE: { first: ['Conor', 'Fionn', 'Cian', 'Darragh', 'Rory'], last: ["O'Brien", 'McCarthy', 'Doheny', 'Kennedy', 'Hume'] },
  SCO: { first: ['Callum', 'Angus', 'Ewan', 'Fraser'], last: ['MacLeod', 'Sharif', 'Greaves', 'Cross'] },
  NED: { first: ['Teja', 'Vikram', 'Sybrand', 'Aryan'], last: ['Nidamanuru', 'Engelbrecht', 'Klein', 'Dutt'] },
  ZIM: { first: ['Tinashe', 'Wessly', 'Brian', 'Tendai'], last: ['Madhevere', 'Bennett', 'Chatara', 'Masakadza'] },
  NEP: { first: ['Aarif', 'Kushal', 'Gulsan', 'Lalit'], last: ['Sheikh', 'Malla', 'Jha', 'Rajbanshi'] },
  NAM: { first: ['JJ', 'Zane', 'Bernard', 'Jan'], last: ['Smit', 'Green', 'Scholtz', 'Frylinck'] },
  OMA: { first: ['Jatinder', 'Kashyap', 'Shoaib', 'Ayaan'], last: ['Singh', 'Prajapati', 'Khan', 'Khan'] },
  CAN: { first: ['Navneet', 'Aaron', 'Pargat', 'Harsh'], last: ['Dhaliwal', 'Johnson', 'Singh', 'Thaker'] },
};

const STYLE_BY_ROLE: Record<Role, string[]> = {
  BAT: ['opener', 'anchor', 'power', 'finisher', 'spin-killer', '', '', ''],
  WK: ['opener', 'power', 'finisher', '', ''],
  AR: ['power', 'finisher', 'control', '', ''],
  BOWL: ['newball', 'death', 'swing', 'control', 'variations', 'express', '', '', ''],
};

export interface GenerateOptions {
  country: CountryCode;
  role?: Role;
  quality: number; // target overall (mean)
  age?: number;
  season: number;
  source?: 'generated' | 'youth';
  idPrefix?: string;
}

export function generatePlayer(rng: Rng, opts: GenerateOptions, serial: number): Player {
  const pool = NAMES[opts.country] ?? NAMES.IND;
  const name = `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
  const role: Role = opts.role ?? rng.weighted<Role>(['BAT', 'WK', 'AR', 'BOWL'], [0.34, 0.11, 0.2, 0.35]);
  const age = opts.age ?? Math.round(rng.range(19, 33));
  const batHand: Hand = rng.chance(0.27) ? 'L' : 'R';
  let bowlType: BowlingType = 'NONE';
  if (role === 'BOWL' || role === 'AR' || (role === 'BAT' && rng.chance(0.35))) {
    bowlType = rng.weighted<BowlingType>(['RF', 'RFM', 'RM', 'LF', 'LFM', 'LM', 'OB', 'LB', 'SLA', 'SLC'], [0.12, 0.2, 0.1, 0.03, 0.08, 0.03, 0.17, 0.11, 0.13, 0.03]);
  }
  const q = opts.quality + rng.normal(0, 5);
  let bat: number;
  let bowl: number;
  switch (role) {
    case 'BAT': bat = q; bowl = bowlType === 'NONE' ? 0 : q * 0.45; break;
    case 'WK': bat = q - 2; bowl = 0; break;
    case 'AR': bat = q - 6 + rng.normal(0, 4); bowl = q - 4 + rng.normal(0, 4); break;
    case 'BOWL': bat = 15 + rng.range(0, 25); bowl = q; break;
  }
  const tag = rng.pick(STYLE_BY_ROLE[role]);
  const tags = tag ? [tag] : [];
  const id = `${opts.idPrefix ?? 'g'}-${opts.country.toLowerCase()}-${serial}`;
  const jit = (k: string) => hash01(`${id}|${k}`);
  const attrs = buildAttributes(bat, bowl, role, bowlType, tags, age, opts.country, jit);
  const ovr = overallFor(role, attrs, bowlType);
  const youthBoost = age <= 21 ? rng.range(6, 18) : age <= 24 ? rng.range(2, 10) : rng.range(0, 3);
  return {
    ...basePlayer(),
    id, name, shortName: shortNameOf(name), country: opts.country, birthYear: opts.season - age, ageConfidence: 'generated', role, batHand, bowlType,
    capped: false, source: opts.source ?? 'generated', styleTags: tags, attrs,
    potential: Math.min(95, Math.round(ovr + youthBoost)),
    ratingUncertainty: 9,
    reputation: Math.round(Math.max(1, Math.min(60, (ovr - 50) * 1.5))),
    personality: rng.pick(PERSONALITIES),
  };
}

// ------------------------------------------------------------------ validation (import pipeline)

export interface ValidationIssue {
  row: number;
  name: string;
  level: 'error' | 'warning';
  message: string;
}

export function validateCuratedRows(rows: CuratedRow[], season: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const [name, country, birthYear, role, hand, type, bat, bowl, capped] = r;
    const id = slug(name);
    if (seen.has(id)) issues.push({ row: i, name, level: 'error', message: `Duplicate identity (also row ${seen.get(id)})` });
    seen.set(id, i);
    if (!NAMES[country] && !['IND'].includes(country)) issues.push({ row: i, name, level: 'warning', message: `No generated-name pool for ${country}` });
    const age = season - birthYear;
    if (age < 14 || age > 47) issues.push({ row: i, name, level: 'error', message: `Implausible age ${age}` });
    if (bat < 0 || bat > 100 || bowl < 0 || bowl > 100) issues.push({ row: i, name, level: 'error', message: 'Skill out of 0–100 range' });
    if ((role === 'BOWL' || role === 'AR') && type === 'NONE') issues.push({ row: i, name, level: 'error', message: `${role} must have a bowling type` });
    if (type === 'NONE' && bowl > 0) issues.push({ row: i, name, level: 'warning', message: 'Bowling skill set for a non-bowler' });
    if (hand !== 'R' && hand !== 'L') issues.push({ row: i, name, level: 'error', message: 'Bad batting hand' });
    if (capped !== 0 && capped !== 1) issues.push({ row: i, name, level: 'error', message: 'Capped flag must be 0/1' });
  });
  return issues;
}
