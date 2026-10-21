/** Prints a one-season world report: auction prices, tables, WCC and reputation movement. `npm run world-report` */
import { advance, advanceCascade, auctionAct, autoFillUserSquad, createWorld, endSeason, nrr, sortRows, startSeason } from '@kurciv/world';
import { LEAGUES } from '@kurciv/config';
import { overall } from '@kurciv/domain';

const w = createWorld({ careerId: 'r', seed: process.argv[2] ?? 'report', managerName: 'Report', difficulty: 'professional', clubId: 'MUM' });
while (!advanceCascade(w)) {
  const a = Object.values(w.auctions).find((x) => x.interactive && x.status === 'live')!;
  auctionAct(w, a.id, { type: 'sim', until: 'end', assistant: true }, a.version);
}
w.phase = 'preseason';
autoFillUserSquad(w);
const ipl = w.auctions[w.auctionOrder[0]];
const sold = ipl.lots.filter((l) => l.status === 'sold').sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
console.log(`\nIPL auction: ${sold.length} sold, ${ipl.lots.filter((l) => l.status === 'unsold').length} unsold lots`);
for (const l of sold.slice(0, 12)) console.log(`  ${w.players[l.playerId].name.padEnd(24)} ovr ${overall(w.players[l.playerId]).toFixed(0)}  ₹${l.price!.toFixed(2)} Cr → ${w.clubs[l.soldTo!].shortName}`);
for (const c of Object.values(w.clubs).filter((x) => x.leagueId === 'IPL')) console.log(`  ${c.shortName.padEnd(4)} squad ${c.squad.length}  purse left ₹${c.purse.toFixed(2)} Cr  (${c.personality})`);
const notes = ipl.notes.slice(0, 4);
console.log('\nSample AI reasoning:');
for (const n of notes) console.log(`  ${w.clubs[n.clubId].shortName} on ${w.players[n.playerId].name}: ${n.reason}`);
startSeason(w);
console.log('\nWCC slots (seeded):', Object.entries(w.leagues).map(([k, v]) => `${k}:${v.wccSlots}`).join(' '));
advance(w, 'season');
for (const l of LEAGUES.slice(0, 3)) {
  const comp = w.competitions[`${l.id}-${w.season}`];
  console.log(`\n${comp.name} — champion ${w.clubs[comp.championId!].name}`);
  for (const r of sortRows(comp.standings.main)) console.log(`  ${w.clubs[r.clubId].shortName.padEnd(4)} P${r.played} W${r.won} L${r.lost} Pts ${r.points}  NRR ${nrr(r).toFixed(3)}`);
}
const wcc = w.competitions[`WCC-${w.season}`];
console.log(`\nWCC: ${wcc.clubIds.length} clubs — champion ${w.clubs[wcc.championId!].name} (${w.clubs[wcc.championId!].leagueId})`);
endSeason(w);
console.log('\nReputation after season:');
for (const [k, v] of Object.entries(w.leagues)) {
  const h = v.reputationHistory[v.reputationHistory.length - 1];
  console.log(`  ${k.padEnd(5)} ${v.reputation.toFixed(1)} (${h.delta >= 0 ? '+' : ''}${h.delta})  next slots ${v.wccSlots}`);
}
