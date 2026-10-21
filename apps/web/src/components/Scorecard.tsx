import { overs } from '../lib/api';
import { PlayerName } from './player';

export function nameMap(state: any): Record<string, { id: string; name: string; shortName: string }> {
  const m: Record<string, any> = {};
  for (const p of [...state.setup.home.xi, ...state.setup.away.xi]) m[p.id] = p;
  return m;
}

export function Scorecard({ state }: { state: any }) {
  const names = nameMap(state);
  return (
    <div className="space-y-6">
      {state.innings.map((inn: any) => {
        const team = state.setup[inn.battingSide];
        const bowlTeam = state.setup[inn.bowlingSide];
        const batted = inn.order.filter((id: string) => inn.batters[id]);
        const dnb = inn.order.filter((id: string) => !inn.batters[id]);
        const extras = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
        return (
          <div key={inn.index}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-xl font-semibold uppercase">
                {team.name} {inn.superOver && <span className="text-sm text-warn">(Super Over)</span>}
              </h3>
              <span className="num text-2xl">
                {inn.runs}/{inn.wickets} <span className="text-sm text-ink-muted">({overs(inn.legalBalls)} ov)</span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <caption className="sr-only">{team.name} batting</caption>
                <thead><tr><th>Batter</th><th></th><th className="text-right">R</th><th className="text-right">B</th><th className="text-right">4s</th><th className="text-right">6s</th><th className="text-right">SR</th></tr></thead>
                <tbody>
                  {batted.map((id: string) => {
                    const b = inn.batters[id];
                    return (
                      <tr key={id}>
                        <td><PlayerName p={names[id]} /></td>
                        <td className="text-xs text-ink-muted">{b.out ? b.out.text : 'not out'}</td>
                        <td className="num text-right font-semibold">{b.runs}</td>
                        <td className="num text-right">{b.balls}</td>
                        <td className="num text-right">{b.fours}</td>
                        <td className="num text-right">{b.sixes}</td>
                        <td className="num text-right text-ink-muted">{b.balls ? ((b.runs / b.balls) * 100).toFixed(1) : '—'}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="text-ink-muted">Extras</td>
                    <td className="text-xs text-ink-muted">w {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes}</td>
                    <td className="num text-right">{extras}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
            {dnb.length > 0 && <p className="mt-1 text-xs text-ink-muted">Did not bat: {dnb.map((id: string) => names[id]?.shortName).join(', ')}</p>}
            {inn.fow.length > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                Fall of wickets: {inn.fow.map((f: any) => `${f.runs}-${f.wicket} (${names[f.playerId]?.shortName}, ${overs(f.balls)})`).join(' · ')}
              </p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <caption className="sr-only">{bowlTeam.name} bowling</caption>
                <thead><tr><th>Bowler</th><th className="text-right">O</th><th className="text-right">M</th><th className="text-right">R</th><th className="text-right">W</th><th className="text-right">Econ</th><th className="text-right">Dots</th><th className="text-right">Wd/Nb</th></tr></thead>
                <tbody>
                  {Object.values(inn.bowlers).map((b: any) => (
                    <tr key={b.playerId}>
                      <td><PlayerName p={names[b.playerId]} /></td>
                      <td className="num text-right">{overs(b.balls)}</td>
                      <td className="num text-right">{b.maidens}</td>
                      <td className="num text-right">{b.runs}</td>
                      <td className="num text-right font-semibold">{b.wickets}</td>
                      <td className="num text-right text-ink-muted">{b.balls ? ((b.runs / b.balls) * 6).toFixed(2) : '—'}</td>
                      <td className="num text-right">{b.dots}</td>
                      <td className="num text-right text-ink-muted">{b.wides}/{b.noBalls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inn.partnerships.length > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                Partnerships: {[...inn.partnerships, ...(inn.complete ? [] : [{ a: inn.strikerId, b: inn.nonStrikerId, ...inn.partnership }])].map((p: any) => `${p.runs} (${p.balls})`).join(' · ')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ballLabel(d: any): string {
  if (!d.legal) return `${d.over}.${d.ball}`;
  return `${d.over}.${d.ball}`;
}

export function ballChip(d: any): { text: string; tone: string } {
  if (d.wicket) return { text: 'W', tone: 'bg-danger text-obsidian-950' };
  if (d.extras?.kind === 'wide') return { text: `${d.extras.runs}wd`, tone: 'bg-obsidian-600' };
  if (d.extras?.kind === 'no-ball') return { text: `${d.batRuns}nb`, tone: 'bg-warn text-obsidian-950' };
  if (d.boundary === 6) return { text: '6', tone: 'bg-lime text-obsidian-950' };
  if (d.boundary === 4 && d.batRuns === 4) return { text: '4', tone: 'bg-info text-obsidian-950' };
  if (d.extras) return { text: `${d.extras.runs}${d.extras.kind === 'bye' ? 'b' : 'lb'}`, tone: 'bg-obsidian-600' };
  return { text: d.batRuns === 0 ? '•' : String(d.batRuns), tone: 'bg-obsidian-700' };
}
