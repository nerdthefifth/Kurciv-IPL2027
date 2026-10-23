/** Smoke run of a pyramid career: creation, auctions, preseason, a season, cups, internationals, rollover. */
import { DIVISIONS } from '@kurciv/config';
import { advance, advanceCascade, auctionAct, autoFillUserSquad, commitRetentions, createWorld, endSeason, enterPreseason, startSeason } from '@kurciv/world';

const t = Date.now();
const lap = (label: string) => console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
const w = createWorld({ careerId: 's', seed: 'smoke', managerName: 'Smoke', difficulty: 'professional', clubId: process.argv[2] ?? 'MUM' });
lap('created');
const players = Object.values(w.players);
console.log('players', players.length, 'fictional', players.filter((p) => p.source === 'generated' || p.source === 'youth').length, 'real', players.filter((p) => p.source === 'curated' || p.source === 'registry').length, 'clubs', Object.keys(w.clubs).length);
for (const d of DIVISIONS) console.log(d.id, Object.values(w.clubs).filter((c) => c.leagueId === d.id).map((c) => c.shortName).join(' '));
for (let season = 0; season < Number(process.argv[3] ?? 1); season++) {
  let guard = 0;
  while (!advanceCascade(w) && guard++ < 10) {
    const live = Object.values(w.auctions).find((a) => a.interactive && a.status === 'live')!;
    const r = auctionAct(w, live.id, { type: 'sim', until: 'end', assistant: true }, live.version);
    if (!r.ok) throw new Error(r.error);
  }
  if (w.phase !== 'preseason') enterPreseason(w);
  autoFillUserSquad(w);
  const ua = Object.values(w.auctions).find((a) => a.interactive)!;
  console.log('auction registration', ua.registration, 'lots', ua.lots.length);
  lap('auctions');
  console.log('intl events', Object.values(w.universe!.international.events).filter((e) => e.season === w.season).map((e) => `${e.name} (${e.format})`).join('; '));
  const pre = advance(w, 'next');
  console.log('preseason advance', pre.stoppedFor, pre.messages, 'day', w.day);
  const errs = startSeason(w);
  if (errs.length) throw new Error(errs.join(' '));
  lap('season started');
  const res = advance(w, 'season');
  console.log('season advance', res.stoppedFor, res.messages, 'records', res.records.length, 'phase', w.phase, 'day', w.day);
  let g2 = 0;
  while (w.phase !== 'offseason' && g2++ < 20) {
    const r = advance(w, 'season');
    console.log(' ...', r.stoppedFor, r.messages, w.phase, w.day);
  }
  lap('season done');
  const cups = Object.values(w.competitions).filter((c) => c.season === w.season && (c.kind === 'continental' || c.kind === 'wcc'));
  for (const c of cups) console.log(' ', c.name, '→', c.championId ? w.clubs[c.championId].name : '-');
  const evs = Object.values(w.universe!.international.events).filter((e) => e.season === w.season);
  for (const e of evs) console.log(' ', e.name, e.status, '→', e.championId ?? 'shared/drawn');
  endSeason(w);
  const moves = w.universe!.pyramidHistory.find((h) => h.season === w.season - 1)!.movements;
  console.log('movements', moves.map((m) => `${w.clubs[m.clubId].shortName} ${m.kind} ${m.from}->${m.to}`).join(', '));
  commitRetentions(w);
  lap(`season ${w.season - 1} rolled`);
}
console.log('save size MB', (JSON.stringify(w).length / 1e6).toFixed(1));
