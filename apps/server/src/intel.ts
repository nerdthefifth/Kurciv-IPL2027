import type { WorldState } from '@kurciv/domain';
import { isSpin } from '@kurciv/domain';
import { ZONES, type MatchState } from '@kurciv/simulation';

/**
 * Cricket Intelligence Room. Every finding is computed from recorded deliveries involving
 * the opponent, and carries its sample size and a confidence level — recommendations are
 * probabilistic, never certainties.
 */
export function opponentReport(w: WorldState, clubId: string, records: MatchState[]) {
  const club = w.clubs[clubId];
  type Split = { runs: number; balls: number; outs: number };
  const blank = (): Split => ({ runs: 0, balls: 0, outs: 0 });
  const batters: Record<string, { pace: Split; spin: Split; death: Split; zones: number[] }> = {};
  const bowlers: Record<string, { pp: Split; mid: Split; death: Split }> = {};
  const teamZones = [0, 0, 0, 0, 0, 0, 0, 0];
  let matches = 0;
  let firstInnings = 0;
  let firstCount = 0;
  let chases = 0;
  let chaseWins = 0;
  for (const s of records) {
    const side = s.setup.home.clubId === clubId ? 'home' : s.setup.away.clubId === clubId ? 'away' : null;
    if (!side) continue;
    matches++;
    const first = s.innings[0];
    if (first?.battingSide === side) {
      firstInnings += first.runs;
      firstCount++;
    } else if (first) {
      chases++;
      if (s.result?.winner === side) chaseWins++;
    }
    const xi = [...s.setup.home.xi, ...s.setup.away.xi];
    const typeOf = (id: string) => xi.find((p) => p.id === id)?.bowlType ?? 'NONE';
    for (const d of s.deliveries) {
      const inn = s.innings[d.innings];
      if (!inn || inn.superOver || d.extras?.kind === 'wide') continue;
      const phase = d.over < 6 ? 'pp' : d.over >= 15 ? 'death' : 'mid';
      if (inn.battingSide === side) {
        const b = (batters[d.strikerId] ??= { pace: blank(), spin: blank(), death: blank(), zones: [0, 0, 0, 0, 0, 0, 0, 0] });
        const split = isSpin(typeOf(d.bowlerId)) ? b.spin : b.pace;
        split.balls++;
        split.runs += d.batRuns;
        if (d.wicket?.playerOutId === d.strikerId) split.outs++;
        if (phase === 'death') {
          b.death.balls++;
          b.death.runs += d.batRuns;
        }
        if (d.zone !== null && d.batRuns) {
          b.zones[d.zone] += d.batRuns;
          teamZones[d.zone] += d.batRuns;
        }
      } else {
        const bw = (bowlers[d.bowlerId] ??= { pp: blank(), mid: blank(), death: blank() });
        const split = bw[phase];
        if (d.legal) split.balls++;
        split.runs += d.totalRuns;
        if (d.wicket && d.wicket.kind !== 'run out') split.outs++;
      }
    }
  }
  const conf = (n: number) => (n >= 60 ? 'high' : n >= 25 ? 'medium' : 'low');
  const sr = (s: Split) => (s.balls ? Math.round((s.runs / s.balls) * 1000) / 10 : null);
  const econ = (s: Split) => (s.balls ? Math.round((s.runs / s.balls) * 60) / 10 : null);
  const squad = new Set(club.squad);
  const batterRows = Object.entries(batters)
    .filter(([id]) => squad.has(id))
    .map(([id, b]) => ({ id, name: w.players[id]?.name ?? id, vsPace: { sr: sr(b.pace), balls: b.pace.balls, outs: b.pace.outs }, vsSpin: { sr: sr(b.spin), balls: b.spin.balls, outs: b.spin.outs }, deathSr: sr(b.death), favouriteZone: b.zones.some((z) => z > 0) ? ZONES[b.zones.indexOf(Math.max(...b.zones))] : null }))
    .sort((a, b) => b.vsPace.balls + b.vsSpin.balls - (a.vsPace.balls + a.vsSpin.balls));
  const bowlerRows = Object.entries(bowlers)
    .filter(([id]) => squad.has(id))
    .map(([id, b]) => ({ id, name: w.players[id]?.name ?? id, powerplay: { econ: econ(b.pp), balls: b.pp.balls }, middle: { econ: econ(b.mid), balls: b.mid.balls }, death: { econ: econ(b.death), balls: b.death.balls }, wickets: b.pp.outs + b.mid.outs + b.death.outs }));

  const recs: { text: string; confidence: string; evidence: string }[] = [];
  for (const b of batterRows.slice(0, 7)) {
    const p = b.vsPace;
    const s = b.vsSpin;
    if (s.balls >= 12 && p.balls >= 12 && s.sr !== null && p.sr !== null && Math.abs(s.sr - p.sr) > 25) {
      const weaker = s.sr < p.sr ? 'spin' : 'pace';
      recs.push({ text: `Bowl ${weaker} at ${b.name}.`, confidence: conf(Math.min(s.balls, p.balls)), evidence: `SR ${p.sr} v pace (${p.balls} balls) against ${s.sr} v spin (${s.balls} balls).` });
    }
  }
  const totalZ = teamZones.reduce((a, b) => a + b, 0);
  if (totalZ > 40) {
    const z = teamZones.indexOf(Math.max(...teamZones));
    recs.push({ text: `Protect ${ZONES[z]} — their biggest scoring area.`, confidence: conf(totalZ / 2), evidence: `${Math.round((teamZones[z] / totalZ) * 100)}% of their runs off the bat (${totalZ} runs analysed).` });
  }
  const leaky = bowlerRows.filter((b) => b.death.balls >= 12 && (b.death.econ ?? 0) > 10.5);
  for (const b of leaky.slice(0, 2)) recs.push({ text: `Target ${b.name} at the death.`, confidence: conf(b.death.balls), evidence: `Economy ${b.death.econ} in overs 16–20 (${b.death.balls} balls).` });
  if (!recs.length) recs.push({ text: 'Not enough data yet for confident recommendations.', confidence: 'low', evidence: `${matches} matches analysed.` });

  return {
    clubId, clubName: club.name, matches, dna: club.dna,
    team: { avgFirstInnings: firstCount ? Math.round(firstInnings / firstCount) : null, chases, chaseWins, zones: ZONES.map((z, i) => ({ zone: z, runs: teamZones[i] })) },
    batters: batterRows, bowlers: bowlerRows, recommendations: recs,
  };
}
