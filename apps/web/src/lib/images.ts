import Dexie, { type Table } from 'dexie';
import { useEffect, useState } from 'react';

/**
 * Runtime image provider. Nothing is bundled: images are looked up on demand and cached in
 * this browser so each one is fetched once.
 *
 *  - Team badges, fan art and player cutouts: TheSportsDB public API (free test key "123",
 *    rate-limited — requests are queued and throttled, with back-off when throttled).
 *    Team logos are the clubs' trademarks; they are shown for personal play and credited.
 *  - Player and stadium photos: Wikipedia lead images, accepted only when the file lives on
 *    Wikimedia Commons (freely licensed); author and licence are recorded and shown.
 *
 * If any service is unavailable the game falls back to original crests and silhouettes.
 */

export interface ImageEntry {
  key: string;
  status: 'ok' | 'none';
  url: string | null;
  kind: 'badge' | 'fanart' | 'cutout' | 'photo';
  source: 'TheSportsDB' | 'Wikimedia Commons' | null;
  attribution: string | null;
  licence: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
}

class MediaDB extends Dexie {
  images!: Table<ImageEntry, string>;
  constructor() {
    super('kurciv-media');
    this.version(1).stores({ images: 'key, fetchedAt' });
  }
}

let db: MediaDB | null = null;
function media(): MediaDB | null {
  try {
    db ??= new MediaDB();
    return db;
  } catch {
    return null;
  }
}

const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const TTL_OK = 30 * 86400_000;
const TTL_NONE = 7 * 86400_000;

const memory = new Map<string, ImageEntry>();
const listeners = new Map<string, Set<(e: ImageEntry) => void>>();
let enabled = true;

export function setImagesEnabled(v: boolean) {
  enabled = v;
}

function publish(e: ImageEntry) {
  memory.set(e.key, e);
  for (const fn of listeners.get(e.key) ?? []) fn(e);
  void media()?.images.put(e).catch(() => {});
}

function none(key: string, kind: ImageEntry['kind']): ImageEntry {
  return { key, status: 'none', url: null, kind, source: null, attribution: null, licence: null, sourceUrl: null, fetchedAt: new Date().toISOString() };
}

async function cached(key: string): Promise<ImageEntry | null> {
  if (memory.has(key)) return memory.get(key)!;
  const e = await media()?.images.get(key).catch(() => undefined);
  if (!e) return null;
  const age = Date.now() - new Date(e.fetchedAt).getTime();
  if (age > (e.status === 'ok' ? TTL_OK : TTL_NONE)) return null;
  memory.set(key, e);
  return e;
}

// ------------------------------------------------------------------ throttled queue (TheSportsDB)

type Job = { key: string; priority: number; run: () => Promise<void> };
const queue: Job[] = [];
const queued = new Set<string>();
let running = false;
let pauseUntil = 0;

function enqueue(job: Job) {
  if (queued.has(job.key)) {
    const j = queue.find((x) => x.key === job.key);
    if (j && job.priority > j.priority) j.priority = job.priority;
    return;
  }
  queued.add(job.key);
  queue.push(job);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const wait = Math.max(0, pauseUntil - Date.now());
    if (wait) await sleep(wait);
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue.shift()!;
    queued.delete(job.key);
    try {
      await job.run();
    } catch {
      // individual failures fall back to crests/silhouettes
    }
    await sleep(2300); // stay well under the free tier's rate limit
  }
  running = false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tsdb(path: string): Promise<any | null> {
  let r: Response;
  try {
    r = await fetch(`${TSDB}/${path}`);
  } catch (e) {
    // Throttled responses (429) carry no CORS header, so the browser reports a network error.
    pauseUntil = Date.now() + 65_000;
    throw e;
  }
  const text = await r.text();
  if (r.status === 429 || text.startsWith('error code')) {
    pauseUntil = Date.now() + 65_000; // throttled: back off, the job will be retried later
    throw new Error('rate limited');
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ------------------------------------------------------------------ clubs

export interface ClubRef {
  id: string;
  name: string;
  leagueId: string;
}

let lookup: { leagues: Record<string, string>; clubAliases: Record<string, string[]> } = { leagues: {}, clubAliases: {} };
const leagueDone = new Set<string>();
const clubsByLeague = new Map<string, ClubRef[]>();

export function configureImageLookup(l: typeof lookup) {
  lookup = l;
}

/** Registers every club of a league so a single league request can fill all their badges. */
export function registerClubs(clubs: ClubRef[]) {
  for (const c of clubs) {
    const list = clubsByLeague.get(c.leagueId) ?? [];
    if (!list.some((x) => x.id === c.id)) list.push(c);
    clubsByLeague.set(c.leagueId, list);
  }
}

function storeTeam(c: ClubRef, t: any) {
  if (t.strBadge) publish({ key: `club:${c.id}`, status: 'ok', url: `${t.strBadge}/small`, kind: 'badge', source: 'TheSportsDB', attribution: `${t.strTeam} badge via TheSportsDB (team trademark)`, licence: 'Trademark — shown for personal, non-commercial play', sourceUrl: `https://www.thesportsdb.com/team/${t.idTeam}`, fetchedAt: new Date().toISOString() });
  else publish(none(`club:${c.id}`, 'badge'));
  const art = t.strFanart1 ?? t.strBanner ?? null;
  publish(art
    ? { key: `clubart:${c.id}`, status: 'ok', url: `${art}/medium`, kind: 'fanart', source: 'TheSportsDB', attribution: `${t.strTeam} via TheSportsDB`, licence: 'Shown for personal, non-commercial play', sourceUrl: `https://www.thesportsdb.com/team/${t.idTeam}`, fetchedAt: new Date().toISOString() }
    : none(`clubart:${c.id}`, 'fanart'));
}

function matchTeam(c: ClubRef, teams: any[]): any | null {
  const names = [c.name, ...(lookup.clubAliases[c.id] ?? [])].map(norm);
  return teams.find((t) => t.strSport === 'Cricket' && names.includes(norm(t.strTeam))) ?? null;
}

function requestLeague(leagueId: string, priority: number) {
  if (leagueDone.has(leagueId)) return;
  const name = lookup.leagues[leagueId];
  if (!name) return;
  enqueue({
    key: `league:${leagueId}`, priority,
    run: async () => {
      const j = await tsdb(`search_all_teams.php?l=${encodeURIComponent(name)}`);
      leagueDone.add(leagueId);
      const teams: any[] = j?.teams ?? [];
      for (const c of clubsByLeague.get(leagueId) ?? []) {
        const t = matchTeam(c, teams);
        if (t) storeTeam(c, t);
        else requestTeam(c, priority - 1); // free tier caps league lists: look the rest up one by one
      }
    },
  });
}

function requestTeam(c: ClubRef, priority: number) {
  enqueue({
    key: `team:${c.id}`, priority,
    run: async () => {
      for (const n of [c.name, ...(lookup.clubAliases[c.id] ?? [])]) {
        const j = await tsdb(`searchteams.php?t=${encodeURIComponent(n)}`);
        const t = matchTeam(c, j?.teams ?? []);
        if (t) return storeTeam(c, t);
        await sleep(2300);
      }
      publish(none(`club:${c.id}`, 'badge'));
      publish(none(`clubart:${c.id}`, 'fanart'));
    },
  });
}

export async function ensureClub(c: ClubRef, priority = 5) {
  if (!enabled) return;
  if (await cached(`club:${c.id}`)) return;
  registerClubs([c]);
  if (lookup.leagues[c.leagueId] && !leagueDone.has(c.leagueId)) requestLeague(c.leagueId, priority);
  else if (!queued.has(`team:${c.id}`)) requestTeam(c, priority);
}

// ------------------------------------------------------------------ players

export interface PlayerRef {
  id: string;
  name: string;
  source: string;
}

const wikiBatch = new Map<string, PlayerRef>();
let wikiTimer: ReturnType<typeof setTimeout> | null = null;

export async function ensurePlayer(p: PlayerRef, priority = 3) {
  if (!enabled || p.source !== 'curated') return;
  if (await cached(`player:${p.id}`)) return;
  // Free-licensed Wikimedia photo first (batched, fast); TheSportsDB cutout for anyone missing.
  wikiBatch.set(p.id, p);
  wikiTimer ??= setTimeout(() => void flushWiki(priority), 400);
}

async function flushWiki(priority: number) {
  wikiTimer = null;
  const batch = [...wikiBatch.values()].slice(0, 25);
  for (const p of batch) wikiBatch.delete(p.id);
  if (wikiBatch.size) wikiTimer = setTimeout(() => void flushWiki(priority), 400);
  const found = await wikimediaPhotos(batch.map((p) => ({ key: `player:${p.id}`, titles: [`${p.name} (cricketer)`, p.name], mustMention: 'cricket' }))).catch(() => new Map<string, ImageEntry>());
  for (const p of batch) {
    const e = found.get(`player:${p.id}`);
    if (e) publish(e);
    else requestTsdbPlayer(p, priority);
  }
}

function requestTsdbPlayer(p: PlayerRef, priority: number) {
  enqueue({
    key: `tsdb-player:${p.id}`, priority,
    run: async () => {
      const j = await tsdb(`searchplayers.php?p=${encodeURIComponent(p.name)}`);
      const hit = (j?.player ?? []).find((x: any) => x.strSport === 'Cricket' && norm(x.strPlayer) === norm(p.name));
      const url = hit?.strCutout ?? hit?.strThumb ?? null;
      publish(url
        ? { key: `player:${p.id}`, status: 'ok', url: `${url}/small`, kind: hit.strCutout ? 'cutout' : 'photo', source: 'TheSportsDB', attribution: `${p.name} via TheSportsDB`, licence: 'Shown for personal, non-commercial play', sourceUrl: `https://www.thesportsdb.com/player/${hit.idPlayer}`, fetchedAt: new Date().toISOString() }
        : none(`player:${p.id}`, 'photo'));
    },
  });
}

// ------------------------------------------------------------------ venues

export async function ensureVenue(v: { id: string; name: string }) {
  if (!enabled) return;
  if (await cached(`venue:${v.id}`)) return;
  const found = await wikimediaPhotos([{ key: `venue:${v.id}`, titles: [v.name], mustMention: '' }], 1200).catch(() => new Map<string, ImageEntry>());
  publish(found.get(`venue:${v.id}`) ?? none(`venue:${v.id}`, 'photo'));
}

// ------------------------------------------------------------------ Wikimedia (licence-checked)

const WP = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1';
const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata|url';

function stripHtml(s: string): string {
  const d = new DOMParser().parseFromString(s, 'text/html'); // parsed inertly, never inserted
  return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function wikimediaPhotos(items: { key: string; titles: string[]; mustMention: string }[], width = 480): Promise<Map<string, ImageEntry>> {
  const out = new Map<string, ImageEntry>();
  if (!items.length) return out;
  const titles = items.flatMap((i) => i.titles);
  const r = await fetch(`${WP}&prop=pageimages|description&piprop=name&titles=${encodeURIComponent(titles.join('|'))}`);
  const j = await r.json();
  const alias = new Map<string, string>();
  for (const n of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) alias.set(n.from, n.to);
  const resolve = (t: string) => {
    let x = t;
    for (let i = 0; i < 3 && alias.has(x); i++) x = alias.get(x)!;
    return x;
  };
  const pages: Record<string, any> = {};
  for (const p of Object.values<any>(j.query?.pages ?? {})) pages[p.title] = p;
  const chosen = new Map<string, { file: string; page: string }>();
  for (const it of items) {
    for (const t of it.titles) {
      const p = pages[resolve(t)];
      if (!p?.pageimage) continue;
      if (it.mustMention && !(p.description ?? '').toLowerCase().includes(it.mustMention)) continue;
      chosen.set(it.key, { file: p.pageimage, page: p.title });
      break;
    }
  }
  if (!chosen.size) return out;
  const files = [...new Set([...chosen.values()].map((c) => `File:${c.file}`))];
  const c = await fetch(`${COMMONS}&iiurlwidth=${width}&titles=${encodeURIComponent(files.join('|'))}`);
  const cj = await c.json();
  const byFile = new Map<string, any>();
  const calias = new Map<string, string>();
  for (const n of cj.query?.normalized ?? []) calias.set(n.from, n.to);
  for (const p of Object.values<any>(cj.query?.pages ?? {})) if (!('missing' in p) && p.imageinfo?.[0]) byFile.set(p.title, p.imageinfo[0]);
  for (const [key, ch] of chosen) {
    const info = byFile.get(calias.get(`File:${ch.file}`) ?? `File:${ch.file}`);
    const meta = info?.extmetadata ?? {};
    const licence = meta.LicenseShortName?.value;
    if (!info || !licence) continue; // not on Commons → not freely licensed → not used
    out.set(key, {
      key, status: 'ok', url: info.thumburl ?? info.url, kind: 'photo', source: 'Wikimedia Commons',
      attribution: `${stripHtml(meta.Artist?.value ?? 'Unknown author')} / ${stripHtml(licence)}`, licence: stripHtml(licence),
      sourceUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(ch.file)}`, fetchedAt: new Date().toISOString(),
    });
  }
  return out;
}

// ------------------------------------------------------------------ React hook

export function useImage(key: string | null, request?: () => void): ImageEntry | null {
  const [entry, setEntry] = useState<ImageEntry | null>(() => (key ? memory.get(key) ?? null : null));
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const set = listeners.get(key) ?? new Set();
    const fn = (e: ImageEntry) => alive && setEntry(e);
    set.add(fn);
    listeners.set(key, set);
    void cached(key).then((e) => {
      if (!alive) return;
      if (e) setEntry(e);
      else request?.();
    });
    return () => {
      alive = false;
      set.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return entry;
}

export async function imageCredits(): Promise<ImageEntry[]> {
  return ((await media()?.images.where('fetchedAt').above('').toArray().catch(() => [])) ?? []).filter((e) => e.status === 'ok');
}

export async function clearImageCache() {
  memory.clear();
  await media()?.images.clear().catch(() => {});
}
