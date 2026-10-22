import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dayLabel, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Card, Confirm, Empty, PageHeader } from '../components/ui';
import { OvrChip, PlayerName } from '../components/player';
import { MatchDay } from './match/MatchDay';

export function MatchCentrePage() {
  const career = useCareer();
  const live = useApi<any>(`/careers/${career.id}/match`, [career.tick]);
  return (
    <Async state={live}>
      {(d) => (d.live ? <LiveMatch slot="match" initial={d.live} /> : <PreMatch />)}
    </Async>
  );
}

// ------------------------------------------------------------------ pre-match

function PreMatch() {
  const career = useCareer();
  const o = career.overview.data;
  const nav = useNavigate();
  const fx = o?.nextChapter?.fixture;
  const pre = useApi<any>(fx ? `/careers/${career.id}/prematch/${fx.id}` : null, [career.tick, fx?.id]);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => setPicked(null), [fx?.id]);
  const xi: string[] = picked ?? pre.data?.userXI.map((p: any) => p.id) ?? [];
  const check = pre.data ? checkXI(xi, pre.data.squad, pre.data.maxOverseas) : null;
  if (!o) return null;
  if (!fx) {
    return (
      <>
        <PageHeader title="Match Centre" />
        <Empty title="No upcoming match">{o.phase === 'season' || o.phase === 'wcc' ? 'Your season is over — keep advancing to follow the rest of the world.' : 'Matches begin once the season starts.'}</Empty>
      </>
    );
  }
  const start = async () => {
    setBusy(true);
    const r = await career.mutate('/match/start', { fixtureId: fx.id, xi });
    setBusy(false);
    if (r) career.refresh();
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Match Centre" subtitle={`${fx.competition} · ${fx.stage} · ${dayLabel(o.season, fx.day)}`} />
      <Async state={pre}>
        {(p) => (
          <div className="space-y-5">
            <div className="card relative overflow-hidden p-6">
              <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(110deg, ${p.user.colors[0]} 0%, transparent 45%, transparent 55%, ${p.opponent.colors[0]} 100%)` }} aria-hidden />
              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div className="font-display text-4xl font-bold uppercase leading-none md:text-5xl">
                  {fx.homeName} <span className="text-ink-faint">v</span> {fx.awayName}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.today ? (
                    <>
                      <button className="btn-primary" disabled={busy || !check?.ok} title={check?.ok ? undefined : 'Fix your XI first'} onClick={start}>▶ Play live</button>
                      <button className="btn-ghost" disabled={busy || !check?.ok} onClick={() => setQuick(true)}>Quick simulate</button>
                    </>
                  ) : (
                    <Badge tone="info">Advance to match day ({dayLabel(o.season, fx.day)}) with Continue</Badge>
                  )}
                </div>
              </div>
              <p className="relative mt-2 text-sm text-ink-muted">{p.venue.name}, {p.venue.city}{p.headToHead ? ` · Head-to-head ${p.headToHead.record[p.user.id] ?? 0}–${p.headToHead.record[p.opponent.id] ?? 0} in ${p.headToHead.meetings} meetings` : ''}</p>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Pitch & conditions">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Surface</dt><dd className="capitalize">{p.venue.pitch.kind}</dd>
                  <dt className="text-ink-muted">Batting</dt><dd>{p.venue.pitch.batting > 0.3 ? 'Very good' : p.venue.pitch.batting > 0 ? 'Good' : 'Tricky'}</dd>
                  <dt className="text-ink-muted">Help for seam</dt><dd>{p.venue.pitch.pace > 0.3 ? 'Significant' : p.venue.pitch.pace > 0 ? 'Some' : 'Little'}</dd>
                  <dt className="text-ink-muted">Help for spin</dt><dd>{p.venue.pitch.spin > 0.3 ? 'Significant' : p.venue.pitch.spin > 0 ? 'Some' : 'Little'}{p.venue.pitch.wear > 0.3 ? ', more later' : ''}</dd>
                  <dt className="text-ink-muted">Dew risk</dt><dd>{Math.round(p.venue.dewChance * 100)}% (evening)</dd>
                  <dt className="text-ink-muted">Boundaries</dt><dd>{p.venue.boundaryStraight} m straight · {p.venue.boundarySquare} m square</dd>
                  {p.venue.altitude > 300 && <><dt className="text-ink-muted">Altitude</dt><dd>{p.venue.altitude} m — ball carries further</dd></>}
                </dl>
              </Card>
              <Card title="Cricket Intelligence Room" className="xl:col-span-2" actions={<Link to={`/c/${career.id}/club/${p.opponent.id}`} className="text-xs text-lime">Opponent dossier</Link>}>
                <ul className="space-y-2">
                  {p.intel.recommendations.map((r: any, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Badge tone={r.confidence === 'high' ? 'lime' : r.confidence === 'medium' ? 'info' : 'muted'}>{r.confidence}</Badge>
                      <span><b>{r.text}</b> <span className="text-ink-muted">{r.evidence}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-faint">Based on {p.intel.matches} recorded matches. These are probabilistic tendencies, not certainties.</p>
              </Card>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <XISelector pre={p} xi={xi} check={check!} onChange={setPicked} />
              <Card title={`${p.opponent.name} — their XI`}>
                <XIList players={p.opponentXI} />
                <SelectorNotes title="Their selector’s notes" notes={p.opponentReasons} />
              </Card>
            </div>
          </div>
        )}
      </Async>
      <Confirm
        open={quick}
        title="Quick simulate?"
        body="The full ball-by-ball engine plays the match instantly, with the XI you selected, and your assistant makes in-match decisions from your tactics. You can review the full scorecard afterwards."
        confirmLabel="Simulate"
        onClose={() => setQuick(false)}
        onConfirm={async () => {
          const r = await career.mutate<any>('/match/quick', { fixtureId: fx.id, xi }, { success: 'Match simulated.' });
          if (r?.fixture) nav(`/c/${career.id}/fixtures/${r.fixture.id}`);
        }}
      />
    </div>
  );
}

type XICheck = { ok: boolean; errors: string[]; warnings: string[]; overseas: number; bowlers: number; keeper: boolean };

/** Mirrors the server's validateXI so the user sees problems before pressing Play. */
function checkXI(ids: string[], squad: any[], maxOverseas: number): XICheck {
  const xi = ids.map((id) => squad.find((p) => p.id === id)).filter(Boolean);
  const overseas = xi.filter((p) => p.overseas).length;
  const bowlers = xi.filter((p) => p.canBowl).length;
  const keeper = xi.some((p) => p.keeper);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (xi.length !== 11) errors.push(`Pick exactly 11 players (${xi.length} selected).`);
  if (overseas > maxOverseas) errors.push(`Too many overseas players (${overseas}/${maxOverseas}).`);
  if (bowlers < 5) errors.push(`Need at least 5 bowling options (${bowlers}).`);
  for (const p of xi) if (p.injury) errors.push(`${p.name} is injured.`);
  if (!keeper) warnings.push('No specialist wicketkeeper — keeping will suffer.');
  if (xi.some((p) => p.fatigue > 75)) warnings.push('Someone in the XI is heavily fatigued.');
  return { ok: errors.length === 0, errors, warnings, overseas, bowlers, keeper };
}

function SelectorNotes({ title, notes }: { title: string; notes: string[] }) {
  if (!notes?.length) return null;
  return (
    <div className="mt-3 border-t border-obsidian-700 pt-2">
      <div className="label">{title}</div>
      <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}

/** Pick the starting XI and batting order for this match. */
function XISelector({ pre, xi, check, onChange }: { pre: any; xi: string[]; check: XICheck; onChange: (ids: string[]) => void }) {
  const career = useCareer();
  const byId = useMemo(() => new Map<string, any>(pre.squad.map((p: any) => [p.id, p])), [pre.squad]);
  const bench = pre.squad.filter((p: any) => !xi.includes(p.id)).sort((a: any, b: any) => b.ovr - a.ovr);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= xi.length) return;
    const next = [...xi];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const isAssistant = xi.length === pre.suggestedXI.length && xi.every((id, i) => id === pre.suggestedXI[i]);
  const tag = (p: any) => [p.role, p.overseas ? 'OS' : null, p.canBowl && p.role !== 'BOWL' && p.role !== 'AR' ? 'bowls' : null].filter(Boolean).join(' · ');
  const tired = (p: any) => (p.fatigue > 60 ? ` · tired ${p.fatigue}` : '');
  const promised = (p: any) => (pre.promises ?? []).find((x: any) => x.playerId === p.id);
  const PromiseTag = ({ p }: { p: any }) => (promised(p) ? <span title={`You promised: ${promised(p).text}`}><Badge tone={promised(p).kind === 'rest-next' ? 'info' : 'warn'}>promise</Badge></span> : null);
  return (
    <Card
      title="Your starting XI"
      actions={
        <span className="flex gap-3 text-xs">
          <button className="text-lime disabled:text-ink-faint" disabled={isAssistant} onClick={() => onChange(pre.suggestedXI)}>Assistant’s pick</button>
          <button className="text-lime disabled:text-ink-faint" disabled={!check.ok} onClick={() => career.mutate('/lineup', { playerIds: xi }, { success: 'Saved as your default lineup.' })}>
            Save as default
          </button>
        </span>
      }
    >
      {pre.userXINote && <p className="mb-2 text-xs text-warn">{pre.userXINote}</p>}
      <div className="mb-2 flex flex-wrap gap-2 text-xs" aria-live="polite">
        <Badge tone={xi.length === 11 ? 'lime' : 'warn'}>{xi.length}/11</Badge>
        <Badge tone={check.overseas > pre.maxOverseas ? 'warn' : 'muted'}>Overseas {check.overseas}/{pre.maxOverseas}</Badge>
        <Badge tone={check.bowlers >= 5 ? 'muted' : 'warn'}>Bowling options {check.bowlers}</Badge>
        <Badge tone={check.keeper ? 'muted' : 'warn'}>{check.keeper ? 'Keeper ✓' : 'No keeper'}</Badge>
      </div>
      {check.errors.map((m) => <p key={m} className="text-xs text-danger">{m}</p>)}
      {check.warnings.map((m) => <p key={m} className="text-xs text-warn">{m}</p>)}
      <div className="label mt-2">Batting order</div>
      <ol className="mt-1 space-y-1 text-sm">
        {xi.map((id, i) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="num w-5 text-ink-faint">{i + 1}</span>
              <PlayerName p={p} className="flex-1 truncate" />
              <PromiseTag p={p} />
              <span className="text-[11px] text-ink-faint">{tag(p)}{tired(p)}</span>
              <OvrChip p={p} />
              <span className="flex">
                <button className="btn-quiet px-1.5 py-0.5" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn-quiet px-1.5 py-0.5" aria-label={`Move ${p.name} down`} disabled={i === xi.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="btn-quiet px-1.5 py-0.5" aria-label={`Drop ${p.name}`} onClick={() => onChange(xi.filter((x) => x !== id))}>✕</button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="label mt-4">Bench</div>
      <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
        {bench.map((p: any) => (
          <li key={p.id} className={`flex items-center gap-2 ${p.injury ? 'opacity-50' : ''}`}>
            <PlayerName p={p} className="flex-1 truncate" />
            <PromiseTag p={p} />
            <span className="text-[11px] text-ink-faint">{p.injury ? `injured · ${p.injury.daysRemaining}d` : `${tag(p)}${tired(p)}`}</span>
            <OvrChip p={p} />
            <button className="btn-quiet px-2 py-0.5 text-xs" aria-label={`Add ${p.name}`} disabled={!!p.injury || xi.length >= 11} onClick={() => onChange([...xi, p.id])}>+ Add</button>
          </li>
        ))}
      </ul>
      <SelectorNotes title="Assistant’s reasoning" notes={pre.suggestedReasons} />
    </Card>
  );
}

function XIList({ players }: { players: any[] }) {
  return (
    <ol className="space-y-1 text-sm">
      {players.map((p, i) => (
        <li key={p.id} className="flex items-center gap-2">
          <span className="num w-5 text-ink-faint">{i + 1}</span>
          <PlayerName p={p} className="flex-1 truncate" />
          <span className="text-[11px] text-ink-faint">{p.role}{p.overseas ? ' · OS' : ''}</span>
          <OvrChip p={p} />
        </li>
      ))}
    </ol>
  );
}

export const LiveMatch = MatchDay;
