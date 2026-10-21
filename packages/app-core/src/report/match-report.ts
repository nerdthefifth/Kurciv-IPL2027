import type { Fixture, MatchImpact, WorldState } from '@kurciv/domain';
import { contributions, type DeliveryEvent, type InningsState, type MatchState, type Side } from '@kurciv/simulation';
import { buildHeadline, keyMoments } from './highlights';

/**
 * MatchReportService: turns a finalised, immutable match record into a read-only report model.
 * It never mutates the record or the world. Reopening a report rebuilds exactly the same model
 * from the same record (REPORT_VERSION identifies the derivation rules).
 */
export const REPORT_VERSION = 1;

export const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface TeamInfo { side: Side; clubId: string; name: string; shortName: string; colors: [string, string]; isUser: boolean }

export interface BattingRow { playerId: string; name: string; dismissal: string; notOut: boolean; runs: number; balls: number; fours: number; sixes: number; strikeRate: number | null; milestone: '50' | '100' | null }
export interface BowlingRow { playerId: string; name: string; overs: string; balls: number; maidens: number; runs: number; wickets: number; economy: number | null; wides: number; noBalls: number; dots: number }

export interface InningsReport {
  index: number;
  superOver: boolean;
  battingClubId: string;
  bowlingClubId: string;
  battingSide: Side;
  runs: number;
  wickets: number;
  legalBalls: number;
  overs: string;
  maxOvers: number;
  runRate: number | null;
  target: number | null;
  allOut: boolean;
  extras: { wides: number; noBalls: number; byes: number; legByes: number; total: number };
  batting: BattingRow[];
  didNotBat: { playerId: string; name: string }[];
  bowling: BowlingRow[];
  fallOfWickets: { wicket: number; runs: number; over: string; playerId: string; name: string }[];
  partnerships: { wicket: number; a: string; b: string; runs: number; balls: number; unbroken: boolean }[];
  phases: { label: string; overs: string; runs: number; wickets: number; runRate: number | null }[];
  perOver: { over: number; runs: number; wickets: number; bowler: string }[];
}

export interface Performance { playerId: string; name: string; clubId: string; line: string; detail: string; tags: string[] }

export interface MatchReport {
  version: number;
  engineVersion: string;
  fixtureId: string;
  meta: {
    competition: string; competitionId: string | null; season: number; stage: string; group: string | null; matchNumber: number | null;
    day: number | null; venue: { id: string; name: string; city: string }; evening: boolean;
    toss: { winnerClubId: string; decision: 'bat' | 'bowl' | null } | null;
  };
  teams: { home: TeamInfo; away: TeamInfo };
  userSide: Side | null;
  result: {
    status: 'won' | 'tied';
    winnerClubId: string | null;
    loserClubId: string | null;
    margin: string;
    kind: 'runs' | 'wickets' | 'super-over' | 'tie';
    value: number | null;
    ballsRemaining: number | null;
    superOver: boolean;
    text: string;
  };
  innings: InningsReport[];
  superOvers: InningsReport[];
  playerOfMatch: { playerId: string; name: string; clubId: string; line: string; explanation: string; breakdown: { batting: number; bowling: number; fielding: number; impact: number; winAdded: number } } | null;
  performances: { batting: Performance[]; bowling: Performance[]; fielding: Performance[] };
  headline: { title: string; sub: string; tone: 'close' | 'dominant' | 'tie' | 'standard' };
  moments: Moment[];
  analytics: {
    worm: { clubId: string; points: number[] }[];
    manhattan: { clubId: string; runs: number[]; wickets: number[] }[];
    winProbability: { home: number[]; available: boolean; note: string | null };
    partnerships: { clubId: string; items: { wicket: number; names: string; runs: number; balls: number }[] }[];
    wagon: { clubId: string; shots: { x: number; y: number; runs: number; boundary: 4 | 6 | null }[] }[] | null;
    economy: { playerId: string; name: string; clubId: string; economy: number; overs: string; wickets: number }[];
    unavailable: string[];
  };
  tactics: { observed: string[]; estimates: string[]; suggestions: string[]; perspective: string };
  impact: MatchImpact | null;
  validation: { ok: boolean; issues: string[]; warnings: string[] };
}

export interface Moment { seq: number; innings: number; over: string; kind: string; title: string; detail: string; clubId: string | null; important: boolean }

export interface ReportContext {
  world: WorldState;
  fixture: Fixture | null;
  /** Finalised result stored on the fixture, used to cross-check the record. */
  season: number;
}

function teamOf(s: MatchState, side: Side, world: WorldState): TeamInfo {
  const t = s.setup[side];
  return { side, clubId: t.clubId, name: t.name, shortName: t.shortName, colors: t.colors, isUser: world.userClubId === t.clubId };
}

export function playerNames(s: MatchState): Map<string, { name: string; shortName: string; side: Side }> {
  const m = new Map<string, { name: string; shortName: string; side: Side }>();
  for (const side of ['home', 'away'] as Side[]) for (const p of s.setup[side].xi) m.set(p.id, { name: p.name, shortName: p.shortName, side });
  return m;
}

/** Runs charged to the bowler for a delivery (byes and leg-byes are not). */
export function bowlerConceded(d: DeliveryEvent): number {
  return d.batRuns + (d.extras?.kind === 'wide' ? d.extras.runs : 0) + (d.extras?.kind === 'no-ball' ? 1 : 0);
}

function inningsReport(s: MatchState, inn: InningsState, names: ReturnType<typeof playerNames>): InningsReport {
  const nm = (id: string) => names.get(id)?.name ?? id;
  const bat = s.setup[inn.battingSide];
  const ex = inn.extras;
  const batting: BattingRow[] = inn.order.filter((id) => inn.batters[id]).map((id) => {
    const b = inn.batters[id];
    return {
      playerId: id, name: nm(id), dismissal: b.out ? b.out.text || b.out.kind : 'not out', notOut: !b.out,
      runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, strikeRate: b.balls ? r1((b.runs / b.balls) * 100) : null,
      milestone: b.runs >= 100 ? '100' : b.runs >= 50 ? '50' : null,
    };
  });
  const didNotBat = bat.xi.filter((p) => !inn.batters[p.id]).map((p) => ({ playerId: p.id, name: p.name }));
  const bowlOrder: string[] = [];
  for (const d of s.deliveries) if (d.innings === inn.index && !bowlOrder.includes(d.bowlerId)) bowlOrder.push(d.bowlerId);
  const bowling: BowlingRow[] = bowlOrder.filter((id) => inn.bowlers[id]).map((id) => {
    const w = inn.bowlers[id];
    return { playerId: id, name: nm(id), overs: overs(w.balls), balls: w.balls, maidens: w.maidens, runs: w.runs, wickets: w.wickets, economy: w.balls ? r2((w.runs / w.balls) * 6) : null, wides: w.wides, noBalls: w.noBalls, dots: w.dots };
  });
  const partnerships = inn.partnerships.map((p, i) => ({ wicket: i + 1, a: nm(p.a), b: nm(p.b), runs: p.runs, balls: p.balls, unbroken: false }));
  if (inn.partnership.balls > 0 || inn.partnership.runs > 0) {
    partnerships.push({ wicket: inn.partnerships.length + 1, a: nm(inn.strikerId), b: nm(inn.nonStrikerId), runs: inn.partnership.runs, balls: inn.partnership.balls, unbroken: true });
  }
  const perOver = inn.overs.map((o) => ({ over: o.over + 1, runs: o.runs, wickets: o.wickets, bowler: nm(o.bowlerId) }));
  const pp = s.setup.rules.powerplayOvers;
  const total = s.setup.rules.overs;
  const phaseOf = (from: number, to: number, label: string) => {
    const evs = s.deliveries.filter((d) => d.innings === inn.index && d.over >= from && d.over < to);
    if (!evs.length) return null;
    const legal = evs.filter((d) => d.legal).length;
    return { label, overs: `${from + 1}–${Math.min(to, Math.ceil(inn.legalBalls / 6))}`, runs: evs.reduce((a, d) => a + d.totalRuns, 0), wickets: evs.filter((d) => d.wicket).length, runRate: legal ? r2((evs.reduce((a, d) => a + d.totalRuns, 0) / legal) * 6) : null };
  };
  const phases = inn.superOver ? [] : [phaseOf(0, pp, 'Powerplay'), phaseOf(pp, total - 5, 'Middle overs'), phaseOf(total - 5, total, 'Death overs')].filter(Boolean) as InningsReport['phases'];
  return {
    index: inn.index, superOver: inn.superOver, battingClubId: bat.clubId, bowlingClubId: s.setup[inn.bowlingSide].clubId, battingSide: inn.battingSide,
    runs: inn.runs, wickets: inn.wickets, legalBalls: inn.legalBalls, overs: overs(inn.legalBalls), maxOvers: inn.maxBalls / 6,
    runRate: inn.legalBalls ? r2((inn.runs / inn.legalBalls) * 6) : null, target: inn.target, allOut: inn.wickets >= inn.maxWickets,
    extras: { ...ex, total: ex.wides + ex.noBalls + ex.byes + ex.legByes },
    batting, didNotBat, bowling,
    fallOfWickets: inn.fow.map((f) => ({ wicket: f.wicket, runs: f.runs, over: overs(f.balls), playerId: f.playerId, name: nm(f.playerId) })),
    partnerships, phases, perOver,
  };
}

/** Recomputes the margin from the innings so it can be checked against the engine's text. */
function deriveResult(s: MatchState, main: InningsReport[], teams: MatchReport['teams']): MatchReport['result'] {
  const res = s.result!;
  const winnerSide = res.winner;
  const winner = winnerSide ? teams[winnerSide] : null;
  const loser = winnerSide ? teams[winnerSide === 'home' ? 'away' : 'home'] : null;
  if (!winner) return { status: 'tied', winnerClubId: null, loserClubId: null, margin: res.margin, kind: 'tie', value: null, ballsRemaining: null, superOver: res.superOver, text: 'Match tied' };
  if (res.superOver) {
    return { status: 'won', winnerClubId: winner.clubId, loserClubId: loser!.clubId, margin: res.margin, kind: 'super-over', value: null, ballsRemaining: null, superOver: true, text: `${winner.name} won the super over` };
  }
  const [first, second] = main;
  if (second && second.battingClubId === winner.clubId) {
    const wkts = (s.innings[second.index].maxWickets) - second.wickets;
    const left = second.maxOvers * 6 - second.legalBalls;
    return { status: 'won', winnerClubId: winner.clubId, loserClubId: loser!.clubId, margin: res.margin, kind: 'wickets', value: wkts, ballsRemaining: left, superOver: false, text: `${winner.name} ${res.margin}` };
  }
  const runs = first.runs - (second?.runs ?? 0);
  return { status: 'won', winnerClubId: winner.clubId, loserClubId: loser!.clubId, margin: res.margin, kind: 'runs', value: runs, ballsRemaining: null, superOver: false, text: `${winner.name} ${res.margin}` };
}

/** DataValidation: the report must agree with the engine before anything is rendered. */
function validate(s: MatchState, rep: Omit<MatchReport, 'validation'>, ctx: ReportContext): MatchReport['validation'] {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (s.status !== 'complete' || !s.result) issues.push('The match is not complete.');
  for (const inn of [...rep.innings, ...rep.superOvers]) {
    const evs = s.deliveries.filter((d) => d.innings === inn.index);
    const batRuns = inn.batting.reduce((a, b) => a + b.runs, 0);
    if (batRuns + inn.extras.total !== inn.runs) issues.push(`Innings ${inn.index + 1}: batting runs (${batRuns}) plus extras (${inn.extras.total}) do not equal the total (${inn.runs}).`);
    const delRuns = evs.reduce((a, d) => a + d.totalRuns, 0);
    if (delRuns !== inn.runs) issues.push(`Innings ${inn.index + 1}: recorded deliveries add up to ${delRuns}, not ${inn.runs}.`);
    const legal = evs.filter((d) => d.legal).length;
    if (legal !== inn.legalBalls) issues.push(`Innings ${inn.index + 1}: ${legal} legal deliveries recorded but ${inn.legalBalls} counted.`);
    const bowlRuns = inn.bowling.reduce((a, b) => a + b.runs, 0);
    const conceded = evs.reduce((a, d) => a + bowlerConceded(d), 0);
    if (bowlRuns !== conceded) issues.push(`Innings ${inn.index + 1}: bowling figures (${bowlRuns}) disagree with deliveries (${conceded}).`);
    const wkts = evs.filter((d) => d.wicket).length;
    if (wkts !== inn.wickets) issues.push(`Innings ${inn.index + 1}: ${wkts} dismissals recorded but ${inn.wickets} wickets counted.`);
    if (inn.legalBalls > inn.maxOvers * 6) issues.push(`Innings ${inn.index + 1}: more balls than the format allows.`);
  }
  const r = rep.result;
  if (r.kind === 'runs' && r.value !== null && !rep.result.margin.includes(`${r.value} run`)) issues.push(`Margin mismatch: innings say ${r.value} runs, engine says "${rep.result.margin}".`);
  if (r.kind === 'wickets' && r.value !== null && !rep.result.margin.includes(`${r.value} wicket`)) issues.push(`Margin mismatch: innings say ${r.value} wickets, engine says "${rep.result.margin}".`);
  const fx = ctx.fixture;
  if (fx?.result) {
    if ((fx.result.winnerId ?? null) !== r.winnerClubId) issues.push('The recorded result disagrees with the fixture result.');
    if (fx.result.playerOfMatch !== (s.result?.playerOfMatch ?? null)) warnings.push('Player of the Match on the fixture differs from the match record; the fixture award is shown.');
  }
  const pom = rep.playerOfMatch;
  if (pom && ![...s.setup.home.xi, ...s.setup.away.xi].some((p) => p.id === pom.playerId)) issues.push('Player of the Match did not play in this fixture.');
  for (const p of [...s.setup.home.xi, ...s.setup.away.xi]) {
    const reg = ctx.world.players[p.id];
    if (!reg) warnings.push(`${p.name} is no longer in the player registry.`);
    else if (reg.name !== p.name) issues.push(`Player identity mismatch: ${p.name} vs registry ${reg.name}.`);
  }
  if (fx && (fx.homeId !== s.setup.home.clubId || fx.awayId !== s.setup.away.clubId)) issues.push('Teams in the record do not match the fixture.');
  return { ok: issues.length === 0, issues, warnings };
}

function lineFor(id: string, rep: { innings: InningsReport[] }): string {
  const parts: string[] = [];
  for (const inn of rep.innings) {
    const b = inn.batting.find((x) => x.playerId === id);
    if (b) parts.push(`${b.runs}${b.notOut ? '*' : ''} (${b.balls})`);
  }
  for (const inn of rep.innings) {
    const w = inn.bowling.find((x) => x.playerId === id);
    if (w) parts.push(`${w.wickets}/${w.runs} (${w.overs})`);
  }
  return parts.join(' & ') || 'In the field';
}

export function buildMatchReport(s: MatchState, ctx: ReportContext): MatchReport {
  const { world, fixture } = ctx;
  const names = playerNames(s);
  const teams = { home: teamOf(s, 'home', world), away: teamOf(s, 'away', world) };
  const clubOfSide = (side: Side) => teams[side].clubId;
  const all = s.innings.map((inn) => inningsReport(s, inn, names));
  const innings = all.filter((i) => !i.superOver);
  const superOvers = all.filter((i) => i.superOver);
  const result = deriveResult(s, innings, teams);

  // Match number within the competition (fixtures sorted by day then id).
  let matchNumber: number | null = null;
  if (fixture) {
    const list = Object.values(world.fixtures).filter((f) => f.competitionId === fixture.competitionId).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const i = list.findIndex((f) => f.id === fixture.id);
    matchNumber = i >= 0 ? i + 1 : null;
  }

  // Contributions and the award (the stored award is canonical).
  const contrib = contributions(s);
  const pomId = fixture?.result?.playerOfMatch ?? s.result?.playerOfMatch ?? null;
  const pomC = contrib.find((c) => c.playerId === pomId);
  const base = { innings };
  let playerOfMatch: MatchReport['playerOfMatch'] = null;
  if (pomId && pomC) {
    const reasons: string[] = [];
    const bat = innings.flatMap((i) => i.batting).find((b) => b.playerId === pomId);
    const bowl = innings.flatMap((i) => i.bowling).find((b) => b.playerId === pomId);
    if (bat && bat.runs >= 20) reasons.push(`${bat.runs}${bat.notOut ? '*' : ''} off ${bat.balls} balls${bat.strikeRate ? ` at a strike rate of ${bat.strikeRate}` : ''}`);
    if (bowl && bowl.wickets > 0) reasons.push(`${bowl.wickets} wicket${bowl.wickets > 1 ? 's' : ''} for ${bowl.runs}${bowl.economy !== null ? ` (economy ${bowl.economy})` : ''}`);
    else if (bowl && bowl.balls >= 12 && bowl.economy !== null && bowl.economy < 7.5) reasons.push(`a tight spell at ${bowl.economy} an over`);
    const field = s.deliveries.filter((d) => d.wicket?.fielderId === pomId && !s.innings[d.innings].superOver).length;
    if (field) reasons.push(`${field} dismissal${field > 1 ? 's' : ''} in the field`);
    const swing = Math.round(pomC.winAdded * 100);
    const explanation = `${reasons.length ? reasons.join(', ') : 'An all-round contribution'}. ${swing > 0 ? `By the engine's win-probability model, their involvement added ${swing} percentage points to ${teams[pomC.side].shortName}'s chances (an estimate).` : ''}`.trim();
    playerOfMatch = {
      playerId: pomId, name: names.get(pomId)?.name ?? pomId, clubId: clubOfSide(pomC.side), line: lineFor(pomId, base), explanation,
      breakdown: { batting: pomC.batting, bowling: pomC.bowling, fielding: pomC.fielding, impact: pomC.impact, winAdded: pomC.winAdded },
    };
  }

  // Standout performances.
  const batPerf: Performance[] = innings.flatMap((inn) => inn.batting.map((b) => ({ b, inn })))
    .filter(({ b }) => b.runs >= 15).sort((x, y) => y.b.runs - x.b.runs || x.b.balls - y.b.balls).slice(0, 4)
    .map(({ b, inn }) => ({
      playerId: b.playerId, name: b.name, clubId: inn.battingClubId, line: `${b.runs}${b.notOut ? '*' : ''} (${b.balls})`,
      detail: `${b.fours}×4, ${b.sixes}×6${b.strikeRate !== null ? ` · SR ${b.strikeRate}` : ''}`, tags: [b.milestone === '100' ? 'Hundred' : b.milestone === '50' ? 'Fifty' : '', b.notOut ? 'Not out' : ''].filter(Boolean),
    }));
  const bowlPerf: Performance[] = innings.flatMap((inn) => inn.bowling.map((b) => ({ b, inn })))
    .filter(({ b }) => b.wickets >= 2 || (b.balls >= 18 && (b.economy ?? 99) <= 7))
    .sort((x, y) => y.b.wickets - x.b.wickets || x.b.runs - y.b.runs).slice(0, 4)
    .map(({ b, inn }) => {
      const keys = s.deliveries.filter((d) => d.innings === inn.index && d.wicket && d.wicket.bowlerId === b.playerId && d.wicket.kind !== 'run out')
        .map((d) => names.get(d.wicket!.playerOutId)?.shortName ?? '').filter(Boolean);
      return {
        playerId: b.playerId, name: b.name, clubId: inn.bowlingClubId, line: `${b.wickets}/${b.runs} (${b.overs})`,
        detail: `Economy ${b.economy ?? '—'} · ${b.balls ? Math.round((b.dots / b.balls) * 100) : 0}% dot balls${keys.length ? ` · ${keys.join(', ')}` : ''}`,
        tags: [b.wickets >= 5 ? 'Five-for' : b.wickets >= 3 ? `${b.wickets} wickets` : '', b.maidens ? `${b.maidens} maiden${b.maidens > 1 ? 's' : ''}` : ''].filter(Boolean),
      };
    });
  const fieldMap = new Map<string, { catches: number; stumpings: number; runOuts: number; drops: number; hard: number }>();
  for (const d of s.deliveries) {
    if (s.innings[d.innings].superOver) continue;
    const f = d.wicket?.fielderId;
    if (f) {
      const e = fieldMap.get(f) ?? { catches: 0, stumpings: 0, runOuts: 0, drops: 0, hard: 0 };
      if (d.wicket!.kind === 'caught' || d.wicket!.kind === 'caught behind') e.catches++;
      if (d.wicket!.kind === 'stumped') e.stumpings++;
      if (d.wicket!.kind === 'run out') e.runOuts++;
      if (d.chance?.taken && d.chance.difficulty === 'hard') e.hard++;
      fieldMap.set(f, e);
    }
    if (d.chance && !d.chance.taken) {
      const e = fieldMap.get(d.chance.fielderId) ?? { catches: 0, stumpings: 0, runOuts: 0, drops: 0, hard: 0 };
      e.drops++;
      fieldMap.set(d.chance.fielderId, e);
    }
  }
  const fieldPerf: Performance[] = [...fieldMap.entries()].filter(([, e]) => e.catches + e.stumpings + e.runOuts > 0)
    .sort((a, b) => b[1].catches + b[1].stumpings + b[1].runOuts - (a[1].catches + a[1].stumpings + a[1].runOuts)).slice(0, 4)
    .map(([id, e]) => ({
      playerId: id, name: names.get(id)?.name ?? id, clubId: clubOfSide(names.get(id)?.side ?? 'home'),
      line: [e.catches && `${e.catches} ct`, e.stumpings && `${e.stumpings} st`, e.runOuts && `${e.runOuts} run-out${e.runOuts > 1 ? 's' : ''}`].filter(Boolean).join(', '),
      detail: [e.hard ? `${e.hard} difficult chance${e.hard > 1 ? 's' : ''} taken` : '', e.drops ? `${e.drops} dropped` : ''].filter(Boolean).join(' · ') || 'Safe hands',
      tags: [],
    }));

  // Analytics (only what the record actually contains).
  const unavailable: string[] = [];
  const worm = innings.map((inn) => {
    let c = 0;
    return { clubId: inn.battingClubId, points: [0, ...inn.perOver.map((o) => (c += o.runs))] };
  });
  const manhattan = innings.map((inn) => ({ clubId: inn.battingClubId, runs: inn.perOver.map((o) => o.runs), wickets: inn.perOver.map((o) => o.wickets) }));
  const wp = s.deliveries.filter((d) => !s.innings[d.innings].superOver).map((d) => r2(d.winProbHome));
  const winAvailable = wp.length > 0 && wp.every((v) => Number.isFinite(v));
  if (!winAvailable) unavailable.push('Win probability was not recorded for this match.');
  const wagon = innings.map((inn) => ({
    clubId: inn.battingClubId,
    shots: s.deliveries.filter((d) => d.innings === inn.index && d.batRuns > 0 && d.end).map((d) => ({ x: r1(d.end!.x), y: r1(d.end!.y), runs: d.batRuns, boundary: d.boundary })),
  }));
  const hasWagon = wagon.some((w) => w.shots.length > 0);
  if (!hasWagon) unavailable.push('Shot locations were not recorded, so no wagon wheel is shown.');
  const economy = innings.flatMap((inn) => inn.bowling.filter((b) => b.balls >= 6 && b.economy !== null).map((b) => ({ playerId: b.playerId, name: b.name, clubId: inn.bowlingClubId, economy: b.economy!, overs: b.overs, wickets: b.wickets })))
    .sort((a, b) => a.economy - b.economy);

  const partial = {
    version: REPORT_VERSION, engineVersion: s.engineVersion, fixtureId: s.setup.fixtureId,
    meta: {
      competition: s.setup.competition, competitionId: fixture?.competitionId ?? null, season: fixture?.season ?? ctx.season, stage: s.setup.stage, group: fixture?.group ?? null, matchNumber,
      day: fixture?.day ?? null, venue: { id: s.setup.venue.id, name: s.setup.venue.name, city: s.setup.venue.city }, evening: s.setup.evening,
      toss: s.toss ? { winnerClubId: clubOfSide(s.toss.winner), decision: s.toss.decision } : null,
    },
    teams, userSide: s.setup.userSide, result, innings, superOvers, playerOfMatch,
    performances: { batting: batPerf, bowling: bowlPerf, fielding: fieldPerf },
    headline: { title: '', sub: '', tone: 'standard' } as MatchReport['headline'],
    moments: [] as Moment[],
    analytics: {
      worm, manhattan,
      winProbability: { home: winAvailable ? wp : [], available: winAvailable, note: winAvailable ? 'Estimated by the engine’s win-probability model after every delivery.' : null },
      partnerships: innings.map((inn) => ({ clubId: inn.battingClubId, items: inn.partnerships.map((p) => ({ wicket: p.wicket, names: `${p.a} & ${p.b}`, runs: p.runs, balls: p.balls })) })),
      wagon: hasWagon ? wagon : null, economy, unavailable,
    },
    tactics: tacticalReview(s, innings, teams),
    impact: world.matchImpacts?.[s.setup.fixtureId] ?? null,
  };
  partial.headline = buildHeadline(s, partial);
  partial.moments = keyMoments(s, partial, names);
  return { ...partial, validation: validate(s, partial, ctx) };
}

/** TacticalReview: observed facts first, estimates labelled as such, then suggestions. */
function tacticalReview(s: MatchState, innings: InningsReport[], teams: MatchReport['teams']): MatchReport['tactics'] {
  const observed: string[] = [];
  const estimates: string[] = [];
  const suggestions: string[] = [];
  const side: Side = s.setup.userSide ?? 'home';
  const me = teams[side];
  const perspective = s.setup.userSide ? `From ${me.name}’s point of view` : `Neutral review (${teams.home.shortName} perspective)`;
  const myBat = innings.find((i) => i.battingSide === side);
  const myBowl = innings.find((i) => i.battingSide !== side);
  const par: Record<string, number> = { Powerplay: 8.3, 'Middle overs': 7.8, 'Death overs': 10.5 };
  if (myBat) {
    for (const ph of myBat.phases) {
      if (ph.runRate === null) continue;
      observed.push(`Batting, ${ph.label.toLowerCase()} (overs ${ph.overs}): ${ph.runs}/${ph.wickets} at ${ph.runRate} an over${ph.runRate >= par[ph.label] + 1 ? ' — well above a typical T20 rate' : ph.runRate <= par[ph.label] - 1.5 ? ' — below a typical T20 rate' : ''}.`);
    }
    const inn = s.innings[myBat.index];
    for (const kind of ['pace', 'spin'] as const) {
      const o = inn.observed[kind];
      if (o.balls >= 6) observed.push(`Against ${kind}: ${o.runs} runs off ${o.balls} balls (${r1((o.runs / o.balls) * 6)} an over), ${o.wickets} wicket${o.wickets === 1 ? '' : 's'}.`);
    }
    if (myBat.target && myBat.index === 1) {
      const fifteen = s.deliveries.filter((d) => d.innings === myBat.index && d.legal);
      const at15 = fifteen[89];
      if (at15 && myBat.legalBalls > 90) {
        const need = myBat.target - at15.scoreAfter.runs;
        const ballsLeft = myBat.maxOvers * 6 - 90;
        const got = myBat.runs - at15.scoreAfter.runs;
        observed.push(`The chase after 15 overs: ${need} needed from ${ballsLeft} balls (${r1((need / ballsLeft) * 6)} an over); ${got} scored from there.`);
      }
    }
  }
  if (myBowl) {
    const inn = s.innings[myBowl.index];
    const byField = new Map<string, { overs: number; runs: number; wickets: number }>();
    for (const o of inn.overs) {
      const e = byField.get(o.fieldName) ?? { overs: 0, runs: 0, wickets: 0 };
      e.overs++;
      e.runs += o.runs;
      e.wickets += o.wickets;
      byField.set(o.fieldName, e);
    }
    for (const [name, e] of [...byField.entries()].sort((a, b) => b[1].overs - a[1].overs).slice(0, 4)) {
      observed.push(`Field “${name}”: ${e.overs} over${e.overs > 1 ? 's' : ''}, ${r1(e.runs / e.overs)} runs an over, ${e.wickets} wicket${e.wickets === 1 ? '' : 's'}.`);
    }
    const lengths = new Map<string, { balls: number; runs: number; wickets: number }>();
    for (const d of s.deliveries) {
      if (d.innings !== myBowl.index || !d.legal) continue;
      const e = lengths.get(d.length) ?? { balls: 0, runs: 0, wickets: 0 };
      e.balls++;
      e.runs += d.batRuns;
      if (d.wicket && d.wicket.kind !== 'run out') e.wickets++;
      lengths.set(d.length, e);
    }
    const ls = [...lengths.entries()].filter(([, e]) => e.balls >= 8);
    if (ls.length) observed.push(`Lengths bowled: ${ls.map(([l, e]) => `${l} ${e.balls} balls, ${r1((e.runs / e.balls) * 6)} rpo, ${e.wickets} wkt`).join('; ')}.`);
    const worst = [...ls].sort((a, b) => b[1].runs / b[1].balls - a[1].runs / a[1].balls)[0];
    const best = [...ls].sort((a, b) => a[1].runs / a[1].balls - b[1].runs / b[1].balls)[0];
    if (worst && best && worst[0] !== best[0] && worst[1].runs / worst[1].balls - best[1].runs / best[1].balls > 0.5) {
      suggestions.push(`The ${worst[0]} length cost ${r1((worst[1].runs / worst[1].balls) * 6)} an over against ${r1((best[1].runs / best[1].balls) * 6)} for ${best[0]}. Consider shifting the bowling plan’s length mix.`);
    }
    const death = myBowl.phases.find((p) => p.label === 'Death overs');
    if (death?.runRate && death.runRate > 11.5) suggestions.push(`The death overs went at ${death.runRate} an over. Yorker-heavy plans and boundary-riding fields are worth testing.`);
    const drops = s.deliveries.filter((d) => d.innings === myBowl.index && d.chance && !d.chance.taken).length;
    if (drops >= 2) suggestions.push(`${drops} chances went down in the field. A fielding training focus would help.`);
  }
  // User tactical changes, linked to what followed (observation, not causation).
  if (s.setup.userSide) {
    for (const a of s.actions.filter((x) => x.side === s.setup.userSide && (x.action.type === 'field' || x.action.type === 'plan' || x.action.type === 'intent')).slice(0, 4)) {
      const after = s.deliveries.filter((d) => d.seq > a.seq).slice(0, 18);
      if (!after.length) continue;
      const runs = after.reduce((t, d) => t + d.totalRuns, 0);
      const wk = after.filter((d) => d.wicket).length;
      const what = a.action.type === 'field' ? `field change${a.action.name ? ` to “${a.action.name}”` : ''}` : a.action.type === 'plan' ? 'bowling plan change' : 'batting intent change';
      observed.push(`After your ${what} (ball ${a.seq}), the next ${after.length} deliveries produced ${runs} runs and ${wk} wicket${wk === 1 ? '' : 's'} — what followed, not proof of cause.`);
    }
  }
  // Estimates from the win-probability model.
  const first = s.innings[0];
  const breakIdx = s.deliveries.findIndex((d) => d.innings === 1);
  if (first && breakIdx > 0) {
    const wpHome = s.deliveries[breakIdx - 1].winProbHome;
    const mine = side === 'home' ? wpHome : 1 - wpHome;
    estimates.push(`At the innings break the engine rated ${me.shortName}’s chances at about ${Math.round(mine * 100)}%.`);
  }
  if (s.deliveries.length > 12) {
    let bigIdx = -1;
    let big = 0;
    for (let i = 1; i < s.deliveries.length; i++) {
      const d = Math.abs(s.deliveries[i].winProbHome - s.deliveries[i - 1].winProbHome);
      if (d > big) {
        big = d;
        bigIdx = i;
      }
    }
    if (bigIdx > 0 && big >= 0.08) {
      const d = s.deliveries[bigIdx];
      estimates.push(`The biggest single-ball swing (about ${Math.round(big * 100)} points) came at ${d.over}.${d.ball} in innings ${d.innings + 1}: ${d.commentary}`);
    }
  }
  if (!suggestions.length) suggestions.push('No clear tactical weakness stood out in this match.');
  return { observed, estimates, suggestions, perspective };
}
