import { ZONES } from '@kurciv/simulation';
import { Card, Empty } from '../../components/ui';
import { FieldEditor } from '../../components/FieldEditor';
import { Manhattan, WinProb, Worm } from '../../components/charts';

export function OverAnalysis({ state, names }: { state: any; names: any }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {state.innings.filter((i: any) => i.overs.length).map((inn: any) => (
        <Card key={inn.index} title={`${state.setup[inn.battingSide].shortName} innings — tactical analysis`}>
          <ol className="space-y-2">
            {[...inn.overs].reverse().map((o: any) => (
              <li key={o.over} className="rounded-lg border border-obsidian-700 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>Over {o.over + 1}</b> · {names[o.bowlerId]?.shortName} · <span className="text-ink-muted">{o.fieldName}</span></span>
                  <span className="num">{o.runs} runs{o.wickets ? `, ${o.wickets} wkt` : ''}</span>
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  Dots {o.dots} · singles {o.singles} · boundaries {o.boundaries} · extras {o.extras} · runs saved ≈{o.runsSaved}
                  {o.chances ? ` · chances ${o.chances}${o.dropped ? ` (${o.dropped} dropped)` : ''}` : ''}
                </div>
                {o.zoneRuns.some((z: number) => z > 0) && (
                  <div className="mt-1 text-xs text-ink-faint">By zone: {o.zoneRuns.map((z: number, i: number) => (z ? `${ZONES[i]} ${z}` : null)).filter(Boolean).join(', ')}</div>
                )}
                {o.analysis.length > 0 && <ul className="mt-1 text-xs text-lime">{o.analysis.map((a: string) => <li key={a}>▸ {a}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </Card>
      ))}
      {!state.innings.some((i: any) => i.overs.length) && <Empty title="No overs completed yet" />}
    </div>
  );
}

export function MatchCharts({ state, deliveries }: { state: any; deliveries: any[] }) {
  const main = state.innings.filter((i: any) => !i.superOver);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Worm"><Worm innings={main.map((i: any) => i.overRuns)} labels={main.map((i: any) => state.setup[i.battingSide].shortName)} /></Card>
      <Card title="Win probability"><WinProb points={[0.5, ...deliveries.map((d) => d.winProbHome)]} home={state.setup.home.shortName} away={state.setup.away.shortName} /></Card>
      {main.map((inn: any) => (
        <Card key={inn.index} title={`Manhattan — ${state.setup[inn.battingSide].shortName}`}><Manhattan runs={inn.overRuns} wickets={inn.overWickets} label={state.setup[inn.battingSide].name} /></Card>
      ))}
      {main.map((inn: any) => (
        <Card key={`w${inn.index}`} title={`Wagon wheel — ${state.setup[inn.battingSide].shortName}`}>
          <FieldEditor positions={inn.field.positions} venue={state.setup.venue} showValidation={false} wagon={deliveries.filter((d) => d.innings === inn.index && d.end && d.batRuns + (d.boundary ?? 0) >= 0 && d.shot && d.contact !== 'miss').map((d) => ({ end: d.end, runs: d.batRuns }))} label="Wagon wheel" />
          <p className="mt-1 text-xs text-ink-muted">Lime = six, blue = four, white = runs, grey = dot. Shown from the right-hander’s view.</p>
        </Card>
      ))}
    </div>
  );
}

