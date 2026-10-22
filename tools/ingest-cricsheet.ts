/**
 * Kurciv player database ingestion (repeatable).
 *
 *   npm run ingest -- [--years 2024,2025,2026] [--download]
 *
 * Source: Cricsheet (https://cricsheet.org) match data and people register, published under the
 * Open Data Commons Attribution License 1.0. Attribution is kept in every record's provenance and
 * in docs/DATA_SOURCES.md.
 *
 * What is real (from the data): identity (Cricsheet id, names, aliases), gender, teams,
 * competitions, formats, first/last appearance in the window, and a real-world record for the
 * window (runs, balls, wickets...). Nationality is "verified" when the player appeared for a
 * national team, "inferred" when it comes from a home-country competition, otherwise unknown.
 * What is estimated (clearly labelled): game ratings (calibrated against the curated editorial
 * ratings), bowling style (from the overs a bowler is used in), batting hand and age — Cricsheet
 * does not record these, so they are never presented as facts.
 *
 * The database is completed to at least 10,000 records with clearly marked generated players.
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { COUNTRY_BY_CRICSHEET, type BowlingType, type CountryCode, type Role } from '@kurciv/domain';
import { CURATED_PLAYERS } from '@kurciv/data-ingestion';
import { Rng, hash01 } from '@kurciv/simulation';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'data/cache/cricsheet');
const OUT = path.join(ROOT, 'packages/data-ingestion/data/player-db.json');
const REPORT = path.join(ROOT, 'docs/PLAYER_DB_REPORT.md');
const args = process.argv.slice(2);
const YEARS = (args.includes('--years') ? args[args.indexOf('--years') + 1] : '2024,2025,2026').split(',');
const TARGET_TOTAL = 10000;
/** How strongly competition level shifts a rating (rating points per unit of level). */
const LEVEL_WEIGHT = 45;
const RETRIEVED = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- download / unpack (only when needed)

async function ensureData() {
  fs.mkdirSync(CACHE, { recursive: true });
  const fetchTo = async (url: string, file: string) => {
    if (fs.existsSync(file) && !args.includes('--download')) return;
    console.log(`downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  };
  await fetchTo('https://cricsheet.org/register/people.csv', path.join(CACHE, 'people.csv'));
  await fetchTo('https://cricsheet.org/register/names.csv', path.join(CACHE, 'names.csv'));
  for (const y of YEARS) {
    const zip = path.join(CACHE, `${y}_json.zip`);
    await fetchTo(`https://cricsheet.org/downloads/${y}_json.zip`, zip);
    const dir = path.join(CACHE, y);
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.json')) && !args.includes('--download')) continue;
    fs.mkdirSync(dir, { recursive: true });
    const files = unzipSync(new Uint8Array(fs.readFileSync(zip)));
    for (const [name, data] of Object.entries(files)) if (name.endsWith('.json')) fs.writeFileSync(path.join(dir, path.basename(name)), data);
  }
  // Every year Cricsheet has, used only as nationality evidence (read in memory).
  await fetchTo('https://cricsheet.org/downloads/all_male_json.zip', path.join(CACHE, 'all_male_json.zip'));
  await fetchTo('https://cricsheet.org/downloads/all_female_json.zip', path.join(CACHE, 'all_female_json.zip'));
}

/**
 * Nationality evidence from every match Cricsheet publishes: national-team appearances (facts),
 * strictly domestic competitions (evidence), and franchise leagues played (for the IPL rule).
 */
function historyEvidence() {
  const intl = new Map<string, Map<CountryCode, number>>();
  const domestic = new Map<string, Map<CountryCode, number>>();
  const leagues = new Map<string, Set<string>>();
  const bump = (m: Map<string, Map<CountryCode, number>>, id: string, c: CountryCode) => {
    const x = m.get(id) ?? m.set(id, new Map()).get(id)!;
    x.set(c, (x.get(c) ?? 0) + 1);
  };
  let matches = 0;
  for (const zip of ['all_male_json.zip', 'all_female_json.zip']) {
    const files = unzipSync(new Uint8Array(fs.readFileSync(path.join(CACHE, zip))), { filter: (f) => f.name.endsWith('.json') });
    for (const data of Object.values(files)) {
      const text = Buffer.from(data).toString('utf8');
      // Only the "info" block is needed: cut before the top-level innings array when possible.
      const cut = text.search(/\n {2}"innings":/);
      let info;
      try {
        info = JSON.parse(cut > 0 ? `${text.slice(0, cut).replace(/,\s*$/, '')}}` : text).info;
      } catch {
        info = JSON.parse(text).info;
      }
      if (!info?.players) continue;
      matches++;
      const reg: Record<string, string> = info.registry?.people ?? {};
      const comp: string = info.event?.name ?? '';
      for (const [team, names] of Object.entries(info.players as Record<string, string[]>)) {
        for (const n of names) {
          const id = reg[n];
          if (!id) continue;
          if (info.team_type === 'international') {
            const c = COUNTRY_BY_CRICSHEET[team];
            if (c) bump(intl, id, c);
          } else if (DOMESTIC[comp]) bump(domestic, id, DOMESTIC[comp]);
          else if (comp) (leagues.get(id) ?? leagues.set(id, new Set()).get(id)!).add(comp);
        }
      }
    }
  }
  return { intl, domestic, leagues, matches };
}

function readCsv(file: string): string[][] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

// ---------------------------------------------------------------- competitions → home country (for inferred nationality)

/**
 * Strictly domestic competitions (overseas players are few and usually internationals, who are
 * verified separately). Franchise leagues are deliberately absent: they are full of overseas players.
 */
const DOMESTIC: Record<string, CountryCode> = {
  'County Championship': 'ENG', 'Specsavers County Championship': 'ENG', 'LV= County Championship': 'ENG', 'Bob Willis Trophy': 'ENG',
  'Vitality Blast': 'ENG', 'Vitality Blast Men': 'ENG', 'NatWest T20 Blast': 'ENG', 'One-Day Cup': 'ENG', 'Royal London One-Day Cup': 'ENG',
  'Vitality Blast Women': 'ENG', "ECB Women's One-Day Cup": 'ENG', 'Rachael Heyhoe Flint Trophy': 'ENG', 'Charlotte Edwards Cup': 'ENG',
  'Sheffield Shield': 'AUS', 'Marsh Sheffield Shield': 'AUS', 'One-Day Cup (Australia)': 'AUS', 'The Marsh Cup': 'AUS',
  'Plunket Shield': 'NZ', 'Super Smash': 'NZ', "Women's Super Smash": 'NZ', 'HRV Twenty20': 'NZ', 'HRV Cup': 'NZ', "New Zealand Cricket Women's Twenty20": 'NZ',
  'CSA T20 Challenge': 'SA', 'CSA Pro20': 'SA', 'Ram Slam T20 Challenge': 'SA', 'MiWAY T20 Challenge': 'SA',
  'Syed Mushtaq Ali Trophy': 'IND',
  'Major Clubs Limited Over Tournament': 'SL', 'Major League Tournament': 'SL', 'Major Clubs T20 Tournament': 'SL',
  'Cricket Ireland Inter-Provincial Twenty20 Trophy': 'IRE', 'Cricket Ireland Inter-Provincial Limited Over Cup': 'IRE',
  "CG United Women's Super50": 'WI',
};
/** Competition strength used when estimating ratings (1 = top international). */
const LEVEL: Record<string, number> = {
  'Indian Premier League': 0.95, 'Big Bash League': 0.88, 'Pakistan Super League': 0.88, SA20: 0.9, 'International League T20': 0.86,
  'Caribbean Premier League': 0.85, 'Major League Cricket': 0.85, 'The Hundred Men\'s Competition': 0.88, 'Vitality Blast Men': 0.84, 'Vitality Blast': 0.84,
  'Bangladesh Premier League': 0.8, 'Lanka Premier League': 0.8, 'Super Smash': 0.8, 'County Championship': 0.84, 'Sheffield Shield': 0.86,
  'Plunket Shield': 0.8, 'One-Day Cup': 0.8, 'One-Day Cup (Australia)': 0.84, 'The Marsh Cup': 0.84, 'CSA T20 Challenge': 0.8, 'CSA Pro20': 0.8,
  'Syed Mushtaq Ali Trophy': 0.82, 'Major Clubs Limited Over Tournament': 0.72, 'Major League Tournament': 0.72, 'Major Clubs T20 Tournament': 0.72,
  'Nepal Premier League': 0.62, 'European T20 Premier League': 0.55,
};
const FULL = new Set(['India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'West Indies', 'Bangladesh', 'Afghanistan', 'Ireland', 'Zimbabwe']);

// ---------------------------------------------------------------- aggregation

interface Agg {
  id: string;
  name: string;
  gender: 'male' | 'female';
  intl: Map<string, number>;
  comps: Map<string, number>;
  teams: Set<string>;
  formats: Record<string, number>;
  first: string;
  last: string;
  matches: number;
  levelSum: number;
  t20: { runs: number; balls: number; outs: number; bowlBalls: number; conceded: number; wkts: number; ppDeath: number };
  long: { runs: number; balls: number; outs: number; bowlBalls: number; conceded: number; wkts: number };
  fours: number;
  sixes: number;
  catches: number;
  stumpings: number;
}

function newAgg(id: string, name: string, gender: 'male' | 'female'): Agg {
  return {
    id, name, gender, intl: new Map(), comps: new Map(), teams: new Set(), formats: {}, first: '9999', last: '0000', matches: 0, levelSum: 0,
    t20: { runs: 0, balls: 0, outs: 0, bowlBalls: 0, conceded: 0, wkts: 0, ppDeath: 0 },
    long: { runs: 0, balls: 0, outs: 0, bowlBalls: 0, conceded: 0, wkts: 0 }, fours: 0, sixes: 0, catches: 0, stumpings: 0,
  };
}

function aggregate() {
  const people = new Map<string, Agg>();
  let matchesRead = 0;
  for (const y of YEARS) {
    const dir = path.join(CACHE, y);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const i = j.info;
      matchesRead++;
      const reg: Record<string, string> = i.registry?.people ?? {};
      const intl = i.team_type === 'international';
      const comp: string = i.event?.name ?? (intl ? 'International' : 'Other');
      const t20 = i.match_type === 'T20' || i.match_type === 'IT20';
      const fmt = t20 ? 'T20' : i.match_type === 'Test' || i.match_type === 'MDM' ? 'First-class' : 'One-day';
      const date: string = i.dates[0];
      const teams: string[] = i.teams;
      const level = intl ? (teams.every((t) => FULL.has(t)) ? 1 : teams.some((t) => FULL.has(t)) ? 0.75 : 0.55) : LEVEL[comp] ?? 0.62;
      for (const [team, names] of Object.entries(i.players as Record<string, string[]>)) {
        for (const n of names) {
          const id = reg[n];
          if (!id) continue;
          const a = people.get(id) ?? newAgg(id, n, i.gender);
          a.matches++;
          a.levelSum += level;
          a.formats[fmt] = (a.formats[fmt] ?? 0) + 1;
          if (date < a.first) a.first = date;
          if (date > a.last) a.last = date;
          if (intl) a.intl.set(team, (a.intl.get(team) ?? 0) + 1);
          else {
            a.comps.set(comp, (a.comps.get(comp) ?? 0) + 1);
            a.teams.add(team);
          }
          people.set(id, a);
        }
      }
      for (const inn of j.innings ?? []) {
        for (const over of inn.overs ?? []) {
          const phaseEdge = t20 && (over.over <= 1 || over.over >= 16);
          for (const d of over.deliveries) {
            const bat = people.get(reg[d.batter]);
            const bowl = people.get(reg[d.bowler]);
            const wide = d.extras?.wides;
            const nb = d.extras?.noballs;
            const legal = !wide && !nb;
            const s = t20 ? 't20' : 'long';
            if (bat && !wide) {
              bat[s].runs += d.runs.batter;
              bat[s].balls += 1;
              if (d.runs.batter === 4 && !d.runs.non_boundary) bat.fours++;
              if (d.runs.batter === 6) bat.sixes++;
            }
            if (bowl) {
              const conceded = d.runs.batter + (wide ?? 0) + (nb ?? 0);
              bowl[s].conceded += conceded;
              if (legal) bowl[s].bowlBalls += 1;
              if (t20 && legal && phaseEdge) bowl.t20.ppDeath += 1;
            }
            for (const w of d.wickets ?? []) {
              const out = people.get(reg[w.player_out]);
              if (out) out[s].outs += 1;
              if (bowl && !['run out', 'retired hurt', 'retired out', 'obstructing the field'].includes(w.kind)) bowl[s].wkts += 1;
              for (const fl of w.fielders ?? []) {
                const fp = people.get(reg[fl.name]);
                if (!fp) continue;
                if (w.kind === 'stumped') fp.stumpings++;
                else if (w.kind === 'caught' || w.kind === 'caught and bowled') fp.catches++;
              }
            }
          }
        }
      }
    }
  }
  return { people, matchesRead };
}

// ---------------------------------------------------------------- names

function loadNames() {
  const variants = new Map<string, string[]>();
  for (const [id, name] of readCsv(path.join(CACHE, 'names.csv')).slice(1)) {
    if (!id || !name) continue;
    (variants.get(id) ?? variants.set(id, []).get(id)!).push(name);
  }
  const keys = new Map<string, { cricinfo: string | null; unique: string }>();
  const rows = readCsv(path.join(CACHE, 'people.csv'));
  const head = rows[0];
  const ci = head.indexOf('key_cricinfo');
  const un = head.indexOf('unique_name');
  for (const r of rows.slice(1)) keys.set(r[0], { cricinfo: r[ci] || null, unique: r[un] });
  return { variants, keys };
}

/** The fullest form of the name: prefer a variant with a spelled-out first name. */
function displayName(cricsheetName: string, variants: string[]): string {
  const spelled = (n: string) => {
    const first = n.split(' ')[0];
    return n.trim().split(/\s+/).length >= 2 && first.length > 2 && first !== first.toUpperCase();
  };
  // Cricsheet disambiguates namesakes with a suffix like "(2)"; ids keep them apart, so drop it.
  const clean = (n: string) => n.replace(/\s*\(\d+\)$/, '');
  const candidates = [cricsheetName, ...variants].map(clean).filter(spelled).sort((a, b) => b.length - a.length);
  return candidates[0] ?? clean(cricsheetName);
}

// ---------------------------------------------------------------- estimates

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function curatedIndex() {
  const byFull = new Map<string, (typeof CURATED_PLAYERS)[number]>();
  const bySurname = new Map<string, (typeof CURATED_PLAYERS)[number][]>();
  for (const row of CURATED_PLAYERS) {
    byFull.set(norm(row[0]), row);
    const parts = norm(row[0]).split(' ');
    const sur = parts[parts.length - 1];
    (bySurname.get(sur) ?? bySurname.set(sur, []).get(sur)!).push(row);
  }
  return { byFull, bySurname };
}

/**
 * Manual links for curated players whose Cricsheet name cannot be matched automatically
 * (initials only, reordered or differently spelt). Values are Cricsheet ids or exact Cricsheet names.
 */
const CURATED_LINKS: Record<string, string> = {
  'Kamindu Mendis': '08548b13', 'Varun Chakaravarthy': '5b7ab5a9', 'Sarfaraz Khan': 'f088b960', 'Mehidy Hasan Miraz': 'c58b0108',
  'Mahedi Hasan': '9dad0f2e', 'Gus Atkinson': 'AAP Atkinson', 'Salman Ali Agha': 'Agha Salman', 'Paul van Meekeren': 'PA van Meekeren',
  'Logan van Beek': 'LV van Beek', 'Muhammad Waseem': 'Waseem Muhammad', 'Nitish Kumar Reddy': 'K Nithish Kumar Reddy',
};
const LINK_BY_KEY = new Map(Object.entries(CURATED_LINKS).map(([curated, key]) => [key, curated]));

function linkedCurated(id: string, names: string[]) {
  const name = LINK_BY_KEY.get(id) ?? names.map((n) => LINK_BY_KEY.get(n)).find(Boolean);
  return name ? CURATED_PLAYERS.find((r) => r[0] === name) ?? null : null;
}

function matchCurated(idx: ReturnType<typeof curatedIndex>, names: string[], country: CountryCode | null) {
  for (const n of names) {
    const r = idx.byFull.get(norm(n));
    if (r && (!country || r[1] === country)) return r;
  }
  // "B Sai Sudharsan" is "Sai Sudharsan" with an extra initial.
  for (const n of names) {
    const nn = norm(n);
    const sur = nn.split(' ').pop()!;
    const hit = (idx.bySurname.get(sur) ?? []).filter((r) => (!country || r[1] === country) && nn.endsWith(` ${norm(r[0])}`));
    if (hit.length === 1) return hit[0];
  }
  for (const n of names) {
    const parts = norm(n).split(' ');
    if (parts.length < 2) continue;
    const sur = parts[parts.length - 1];
    const initials = parts.slice(0, -1).join('');
    const options = (idx.bySurname.get(sur) ?? []).filter((r) => !country || r[1] === country).filter((r) => {
      const first = norm(r[0]).split(' ')[0];
      return initials.length <= 3 && first[0] === initials[0];
    });
    if (options.length === 1) return options[0];
  }
  return null;
}

/** Raw skill readings from the real record, shrunk towards a level-dependent prior by sample size. */
function rawSkills(a: Agg) {
  const level = a.levelSum / Math.max(1, a.matches);
  const t = a.t20;
  const l = a.long;
  const tAvg = t.runs / Math.max(1, t.outs);
  const tSr = t.balls ? (t.runs / t.balls) * 100 : 0;
  const lAvg = l.runs / Math.max(1, l.outs);
  const tBat = 0.55 * Math.min(60, tAvg) + 0.32 * Math.min(200, tSr);
  // The game is T20: long-format runs count, but less than T20 evidence.
  const lBat = 0.85 * Math.min(70, lAvg) + 22;
  const tw = t.balls / (t.balls + 120);
  const lw = 0.6 * (l.balls / (l.balls + 300));
  const batRaw = (tBat * tw + lBat * lw + 45 * 0.15) / (tw + lw + 0.15);
  const tEcon = t.bowlBalls ? (t.conceded / t.bowlBalls) * 6 : 9;
  const tSrB = t.wkts ? t.bowlBalls / t.wkts : 40;
  const lAvgB = l.wkts ? l.conceded / l.wkts : 60;
  const bw1 = t.bowlBalls / (t.bowlBalls + 150);
  const bw2 = l.bowlBalls / (l.bowlBalls + 500);
  const tBowl = 100 - 5.2 * tEcon - 0.45 * Math.min(40, tSrB);
  const lBowl = 95 - 0.9 * Math.min(60, lAvgB);
  const bowlRaw = (tBowl * bw1 + lBowl * bw2 + 30 * 0.2) / (bw1 + bw2 + 0.2);
  return { batRaw, bowlRaw, level, batSample: t.balls + l.balls, bowlSample: t.bowlBalls + l.bowlBalls };
}

function fitLinear(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 1;
  return { a: my - b * mx, b };
}

// ---------------------------------------------------------------- build

export interface DbRecord {
  id: string;
  kind: 'real' | 'generated';
  name: string;
  aliases: string[];
  gender: 'male' | 'female';
  country: CountryCode | null;
  nationality: 'verified' | 'inferred' | 'unknown' | 'generated';
  teams: string[];
  competitions: string[];
  formats: Record<string, number>;
  firstSeen: string | null;
  lastSeen: string | null;
  status: 'active' | 'stale' | 'generated';
  /** Real-world record in the ingestion window (Cricsheet). Null for generated players. */
  record: { matches: number; runs: number; balls: number; outs: number; fours: number; sixes: number; wickets: number; ballsBowled: number; runsConceded: number; catches: number; stumpings: number } | null;
  /** Game estimates — never real-world facts. */
  est: { role: Role; batHand: 'R' | 'L'; bowlType: BowlingType; birthYear: number; bat: number; bowl: number; tags: string[]; source: 'curated' | 'derived' | 'generated' };
  provenance: { source: string; licence: string; cricsheetId?: string; cricinfoId?: string | null; retrieved: string; confidence: 'high' | 'medium' | 'low' };
}

async function main() {
  await ensureData();
  const { people, matchesRead } = aggregate();
  const { variants, keys } = loadNames();
  const idx = curatedIndex();
  const season = 2027;
  const records: DbRecord[] = [];
  const raws = new Map<string, ReturnType<typeof rawSkills>>();
  const calibBat: [number, number][] = [];
  const calibBowl: [number, number][] = [];
  const curatedMatch = new Map<string, (typeof CURATED_PLAYERS)[number]>();
  const curatedOwner = new Map<string, string>();

  // Pass 1: nationality, curated matches, calibration pairs.
  const hist = historyEvidence();
  const nat = new Map<string, { country: CountryCode | null; how: DbRecord['nationality'] }>();
  for (const a of people.values()) {
    let country: CountryCode | null = null;
    let how: DbRecord['nationality'] = 'unknown';
    const top = (m: Map<CountryCode, number> | undefined) => (m ? [...m.entries()].sort((x, y) => y[1] - x[1]) : []);
    const intl = top(hist.intl.get(a.id));
    const dom = top(hist.domestic.get(a.id));
    const leagues = hist.leagues.get(a.id) ?? new Set<string>();
    if (intl.length) {
      // Fact: the national team they have played for (most appearances if more than one).
      country = intl[0][0];
      how = 'verified';
    } else if (dom.length === 1) {
      // Evidence: strictly domestic competitions of a single country.
      country = dom[0][0];
      how = 'inferred';
    } else if (!dom.length && leagues.size && [...leagues].every((l) => l === 'Indian Premier League' || l === "Women's Premier League")) {
      // Indian players may not play in overseas leagues; uncapped overseas IPL players are rare.
      country = 'IND';
      how = 'inferred';
    }
    // Conflicting domestic evidence, or franchise-only careers elsewhere: left unknown rather than guessed.
    nat.set(a.id, { country, how });
    const r = rawSkills(a);
    raws.set(a.id, r);
    if (a.gender !== 'male') continue;
    const names = [a.name, ...(variants.get(a.id) ?? [])];
    // When nationality is not verified, match the curated list by name alone and take its nationality.
    const linked = linkedCurated(a.id, names);
    const cur = linked ?? matchCurated(idx, names, how === 'verified' ? country : null);
    if (cur && how !== 'verified') nat.set(a.id, { country: cur[1], how: 'verified' });
    if (cur) {
      // Two real people can share a name: a curated row keeps only its strongest match (most matches).
      const prev = curatedOwner.get(cur[0]);
      const prevLinked = prev ? !!linkedCurated(prev, []) : false;
      if (prev && (prevLinked || (!linked && people.get(prev)!.matches >= a.matches))) continue;
      if (prev) curatedMatch.delete(prev);
      curatedOwner.set(cur[0], a.id);
      curatedMatch.set(a.id, cur);
    }
  }
  for (const [id, cur] of curatedMatch) {
    const r = raws.get(id)!;
    if (r.batSample >= 150 && cur[3] !== 'BOWL') calibBat.push([r.batRaw + (r.level - 0.85) * LEVEL_WEIGHT, cur[6]]);
    if (r.bowlSample >= 150 && cur[5] !== 'NONE') calibBowl.push([r.bowlRaw + (r.level - 0.85) * LEVEL_WEIGHT, cur[7]]);
  }
  const fb = fitLinear(calibBat.map((x) => x[0]), calibBat.map((x) => x[1]));
  const fw = fitLinear(calibBowl.map((x) => x[0]), calibBowl.map((x) => x[1]));

  // Pass 2: records.
  const latest = [...people.values()].reduce((m, a) => (a.last > m ? a.last : m), '0000');
  const staleBefore = new Date(new Date(latest).getTime() - 365 * 86400000).toISOString().slice(0, 10);
  for (const a of people.values()) {
    const { country, how } = nat.get(a.id)!;
    const r = raws.get(a.id)!;
    const vs = variants.get(a.id) ?? [];
    const cur = curatedMatch.get(a.id) ?? null;
    const name = cur ? cur[0] : displayName(a.name, vs);
    const jit = (k: string) => hash01(`cs-${a.id}|${k}`);
    const levelAdj = (r.level - 0.85) * LEVEL_WEIGHT;
    const shrink = (sample: number, k: number) => sample / (sample + k);
    let bat = Math.round(Math.max(20, Math.min(90, 50 + (fb.a + fb.b * (r.batRaw + levelAdj) - 50) * shrink(r.batSample, 260))));
    let bowl = Math.round(Math.max(10, Math.min(90, 45 + (fw.a + fw.b * (r.bowlRaw + levelAdj) - 45) * shrink(r.bowlSample, 240))));
    // Role from how the player is used.
    const perMatchBalls = (a.t20.balls + a.long.balls) / Math.max(1, a.matches);
    const perMatchBowl = (a.t20.bowlBalls + a.long.bowlBalls) / Math.max(1, a.matches);
    let role: Role = a.stumpings >= 2 ? 'WK' : perMatchBowl >= 14 && perMatchBalls >= 10 ? 'AR' : perMatchBowl >= 12 ? 'BOWL' : 'BAT';
    if (role === 'BOWL') bat = Math.min(bat, 55);
    // Bowling style: pace bowlers are used with the new ball and at the death far more than spinners.
    let bowlType: BowlingType = 'NONE';
    if (role === 'BOWL' || role === 'AR' || perMatchBowl >= 4) {
      const edgeShare = a.t20.bowlBalls >= 48 ? a.t20.ppDeath / a.t20.bowlBalls : null;
      const pace = edgeShare === null ? jit('pace') < 0.58 : edgeShare >= 0.42;
      const left = jit('arm') < 0.2;
      bowlType = pace ? (left ? 'LFM' : jit('pspeed') < 0.35 ? 'RF' : 'RFM') : (jit('spin') < 0.42 ? 'OB' : jit('spin') < 0.72 ? 'SLA' : 'LB');
    } else bowl = 0;
    let est: DbRecord['est'] = {
      role, batHand: jit('hand') < 0.27 ? 'L' : 'R', bowlType,
      birthYear: season - Math.round(Math.max(19, Math.min(38, 27 + (jit('age') - 0.5) * 10))),
      bat, bowl, tags: [], source: 'derived',
    };
    if (cur) est = { role: cur[3], batHand: cur[4], bowlType: cur[5], birthYear: cur[2], bat: cur[6], bowl: cur[7], tags: cur[9].split(' ').filter(Boolean), source: 'curated' };
    const status: DbRecord['status'] = a.last >= staleBefore ? 'active' : 'stale';
    records.push({
      id: cur ? `p-${norm(cur[0]).replace(/ /g, '-')}` : `cs-${a.id}`,
      kind: 'real', name, aliases: [...new Set([a.name, ...vs].filter((n) => n !== name))].slice(0, 4), gender: a.gender, country, nationality: how,
      teams: [...a.teams].slice(0, 6), competitions: [...a.comps.keys(), ...(a.intl.size ? ['International'] : [])].slice(0, 6), formats: a.formats,
      firstSeen: a.first, lastSeen: a.last, status,
      record: {
        matches: a.matches, runs: a.t20.runs + a.long.runs, balls: a.t20.balls + a.long.balls, outs: a.t20.outs + a.long.outs, fours: a.fours, sixes: a.sixes,
        wickets: a.t20.wkts + a.long.wkts, ballsBowled: a.t20.bowlBalls + a.long.bowlBalls, runsConceded: a.t20.conceded + a.long.conceded, catches: a.catches, stumpings: a.stumpings,
      },
      est,
      provenance: {
        source: 'Cricsheet', licence: 'ODC-BY 1.0', cricsheetId: a.id, cricinfoId: keys.get(a.id)?.cricinfo ?? null, retrieved: RETRIEVED,
        confidence: how === 'verified' && a.matches >= 10 ? 'high' : how === 'unknown' ? 'low' : 'medium',
      },
    });
  }

  // Curated players not seen in the window still belong in the database.
  const realIds = new Set(records.map((r) => r.id));
  for (const row of CURATED_PLAYERS) {
    const id = `p-${norm(row[0]).replace(/ /g, '-')}`;
    if (realIds.has(id)) continue;
    records.push({
      id, kind: 'real', name: row[0], aliases: [], gender: 'male', country: row[1], nationality: 'verified', teams: [], competitions: [], formats: {},
      firstSeen: null, lastSeen: null, status: 'stale', record: null,
      est: { role: row[3], batHand: row[4], bowlType: row[5], birthYear: row[2], bat: row[6], bowl: row[7], tags: row[9].split(' ').filter(Boolean), source: 'curated' },
      provenance: { source: 'Kurciv curated list', licence: 'Public identity facts; editorial ratings', retrieved: RETRIEVED, confidence: 'medium' },
    });
  }

  // Generated players to complete the database (distinct names, varied countries and ages).
  const rng = Rng.from('kurciv-db-generated-v1');
  const used = new Set(records.map((r) => norm(r.name)));
  const mix: [CountryCode, number][] = [['IND', 0.24], ['ENG', 0.1], ['AUS', 0.1], ['PAK', 0.09], ['SA', 0.08], ['NZ', 0.05], ['WI', 0.06], ['SL', 0.06], ['BAN', 0.06], ['AFG', 0.03], ['USA', 0.03], ['UAE', 0.03], ['IRE', 0.02], ['NEP', 0.02], ['ZIM', 0.02], ['NED', 0.01]];
  const { generatePlayer } = await import('@kurciv/data-ingestion');
  let serial = 0;
  let attempts = 0;
  while (records.length < TARGET_TOTAL && attempts++ < 40000) {
    const country = rng.weighted(mix.map((m) => m[0]), mix.map((m) => m[1]));
    const age = Math.round(Math.max(16, Math.min(36, rng.normal(23, 4.5))));
    const p = generatePlayer(rng, { country, quality: 50 + rng.normal(4, 6), age, season, idPrefix: 'db' }, ++serial);
    if (used.has(norm(p.name))) continue;
    used.add(norm(p.name));
    const batSkill = Math.round((p.attrs.bat.vsPace + p.attrs.bat.vsSpin) / 2);
    const bowlSkill = p.bowlType === 'NONE' ? 0 : Math.round((p.attrs.bowl.control + p.attrs.bowl.movement) / 2);
    records.push({
      id: p.id, kind: 'generated', name: p.name, aliases: [], gender: 'male', country, nationality: 'generated', teams: [], competitions: [], formats: {},
      firstSeen: null, lastSeen: null, status: 'generated', record: null,
      est: { role: p.role, batHand: p.batHand, bowlType: p.bowlType, birthYear: p.birthYear, bat: batSkill, bowl: bowlSkill, tags: p.styleTags, source: 'generated' },
      provenance: { source: 'Kurciv generator', licence: 'Fictional', retrieved: RETRIEVED, confidence: 'low' },
    });
  }

  // ---------------------------------------------------------------- validation & report
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const r of records) {
    if (ids.has(r.id)) issues.push(`Duplicate id ${r.id}`);
    ids.add(r.id);
    if (!r.name.trim() || /\d/.test(r.name)) issues.push(`Suspicious name "${r.name}" (${r.id})`);
    if (r.est.bat < 0 || r.est.bat > 100 || r.est.bowl < 0 || r.est.bowl > 100) issues.push(`Rating out of range for ${r.name}`);
    if ((r.est.role === 'BOWL' || r.est.role === 'AR') && r.est.bowlType === 'NONE') issues.push(`${r.name}: bowler without a bowling type`);
  }
  const dupNames = new Map<string, number>();
  for (const r of records) if (r.kind === 'real') dupNames.set(`${norm(r.name)}|${r.country}`, (dupNames.get(`${norm(r.name)}|${r.country}`) ?? 0) + 1);
  const sameName = [...dupNames.entries()].filter(([, n]) => n > 1);

  const real = records.filter((r) => r.kind === 'real');
  const activeReal = real.filter((r) => r.status === 'active');
  const verifiedActive = activeReal.filter((r) => r.nationality === 'verified');
  const count = (xs: DbRecord[], f: (r: DbRecord) => boolean) => xs.filter(f).length;
  const summary = {
    total: records.length,
    real: real.length,
    activeReal: activeReal.length,
    activeRealVerifiedNationality: verifiedActive.length,
    activeRealInferredNationality: count(activeReal, (r) => r.nationality === 'inferred'),
    activeRealUnknownNationality: count(activeReal, (r) => r.nationality === 'unknown'),
    activeRealMale: count(activeReal, (r) => r.gender === 'male'),
    activeRealFemale: count(activeReal, (r) => r.gender === 'female'),
    stale: count(real, (r) => r.status === 'stale'),
    curatedMatched: curatedMatch.size,
    generated: count(records, (r) => r.kind === 'generated'),
    matchesRead,
    calibration: { batPairs: calibBat.length, bowlPairs: calibBowl.length, bat: fb, bowl: fw },
    issues: issues.length,
    sameNameSameCountry: sameName.length,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ meta: { built: RETRIEVED, years: YEARS, source: 'Cricsheet (cricsheet.org), Open Data Commons Attribution License 1.0', summary }, players: records }));
  // Compact form the game ships with: one array per player (see packages/data-ingestion/src/database.ts).
  const NAT = { verified: 0, inferred: 1, unknown: 2, generated: 3 } as const;
  const STATUS = { active: 0, stale: 1, generated: 2 } as const;
  const SRC = { curated: 0, derived: 1, generated: 2 } as const;
  const compact = records.map((r) => [
    r.id, r.kind === 'real' ? 1 : 0, r.name, r.gender === 'female' ? 1 : 0, r.country ?? '', NAT[r.nationality], STATUS[r.status],
    r.est.role, r.est.batHand, r.est.bowlType, r.est.birthYear, r.est.bat, r.est.bowl, r.est.tags.join(' '), SRC[r.est.source],
    r.record ? [r.record.matches, r.record.runs, r.record.balls, r.record.outs, r.record.fours, r.record.sixes, r.record.wickets, r.record.ballsBowled, r.record.runsConceded, r.record.catches, r.record.stumpings] : 0,
    r.lastSeen ?? '', r.competitions.slice(0, 3).join('|'), r.provenance.cricsheetId ?? '',
  ]);
  fs.writeFileSync(path.join(path.dirname(OUT), 'player-db.game.json'), JSON.stringify({ built: RETRIEVED, source: 'Cricsheet (cricsheet.org), ODC-BY 1.0; Kurciv curated list; Kurciv generator', summary, players: compact }));

  const lines = [
    '# Player database report', '',
    `Built ${RETRIEVED} from Cricsheet match data (${YEARS.join(', ')}; ${matchesRead} matches) and the Cricsheet people register — Open Data Commons Attribution License 1.0 — plus the Kurciv curated list and generated players.`, '',
    '| Measure | Count |', '|---|---|',
    `| Unique player records | ${summary.total} |`,
    `| Real players | ${summary.real} |`,
    `| Real players active in the window (appeared within 365 days of the latest match) | ${summary.activeReal} |`,
    `| — of which nationality verified from international appearances | ${summary.activeRealVerifiedNationality} |`,
    `| — of which nationality inferred from a home-country competition | ${summary.activeRealInferredNationality} |`,
    `| — of which nationality unknown | ${summary.activeRealUnknownNationality} |`,
    `| — men / women | ${summary.activeRealMale} / ${summary.activeRealFemale} |`,
    `| Real players marked stale (last seen over a year before the latest match) | ${summary.stale} |`,
    `| Curated players matched to a Cricsheet identity | ${summary.curatedMatched} |`,
    `| Generated players (fictional, marked as such) | ${summary.generated} |`,
    `| Validation issues | ${summary.issues} |`,
    `| Real players sharing a name and country (kept separate by Cricsheet id) | ${summary.sameNameSameCountry} |`, '',
    '## What is fact and what is estimated', '',
    '- **Facts (from Cricsheet):** identity and aliases, gender, teams, competitions, formats, first and last appearance in the window, and the real-world record for the window.',
    '- **Nationality:** verified only from international appearances; otherwise inferred from a home-country competition (labelled), otherwise unknown.',
    `- **Estimated (game data, never presented as fact):** ratings, calibrated by linear fit against ${calibBat.length} batting and ${calibBowl.length} bowling curated editorial ratings; bowling style (pace v spin from the share of new-ball and death overs); batting hand; age. Cricsheet does not record styles, handedness or dates of birth.`,
    '- **Generated players** are fictional and flagged as generated.', '',
    `Validation: ${issues.length ? issues.slice(0, 20).map((i) => `\n- ${i}`).join('') : 'no issues.'}`, '',
    'Re-run with `npm run ingest` (add `--download` to refresh the source files). Player ids are stable (Cricsheet id), so updating the database never touches a saved career.',
  ];
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

void main();
