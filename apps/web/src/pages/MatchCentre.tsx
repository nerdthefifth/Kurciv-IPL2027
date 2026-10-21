import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FieldPoint } from '@kurciv/domain';
import { ZONES } from '@kurciv/simulation';
import { BOWL_LABEL, api, dayLabel, overs, useApi } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Async, Badge, Card, Confirm, Empty, Kbd, Meter, Modal, PageHeader, Slider, Tabs } from '../components/ui';
import { FieldEditor } from '../components/FieldEditor';
import { Manhattan, WinProb, Worm } from '../components/charts';
import { Scorecard, ballChip, nameMap } from '../components/Scorecard';
import { OvrChip, PlayerName } from '../components/player';
import { PlanEditor } from './Tactics';

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
    const r = await career.mutate('/match/start', { fixtureId: fx.id });
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
                      <button className="btn-primary" disabled={busy} onClick={start}>▶ Play live</button>
                      <button className="btn-ghost" disabled={busy} onClick={() => setQuick(true)}>Quick simulate</button>
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
              <Card title={`Your XI${p.lineupSaved ? ' (saved lineup)' : ' (assistant’s pick)'}`} actions={<Link to={`/c/${career.id}/squad`} className="text-xs text-lime">Change</Link>}>
                {p.userXINote && <p className="mb-2 text-xs text-warn">{p.userXINote}</p>}
                <XIList players={p.userXI} />
              </Card>
              <Card title={`${p.opponent.name} — predicted XI`}>
                <XIList players={p.opponentXI} />
              </Card>
            </div>
          </div>
        )}
      </Async>
      <Confirm
        open={quick}
        title="Quick simulate?"
        body="The full ball-by-ball engine plays the match instantly, with your assistant making decisions from your saved XI and tactics. You can review the full scorecard afterwards."
        confirmLabel="Simulate"
        onClose={() => setQuick(false)}
        onConfirm={async () => {
          const r = await career.mutate<any>('/match/quick', { fixtureId: fx.id }, { success: 'Match simulated.' });
          if (r?.fixture) nav(`/c/${career.id}/fixtures/${r.fixture.id}`);
        }}
      />
    </div>
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

import { MatchDay } from './match/MatchDay';
export const LiveMatch = MatchDay;
