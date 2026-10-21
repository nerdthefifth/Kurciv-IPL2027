import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dayLabel, useApi } from '../lib/api';
import { useCareer, useToast } from '../lib/context';
import { Async, Badge, Card, Empty, Modal, PageHeader, Tabs } from '../components/ui';
import { Scorecard } from '../components/Scorecard';
import { MatchCharts } from './MatchCentre';

export function FixtureRow({ f, season, userClubId }: { f: any; season: number; userClubId?: string }) {
  const { id } = useCareer();
  const r = f.result;
  const won = r && r.winnerId === userClubId;
  const lost = r && f.involvesUser && r.winnerId && r.winnerId !== userClubId;
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-obsidian-800 px-4 py-2.5 text-sm ${f.involvesUser ? 'bg-lime/[0.03]' : ''}`}>
      <span className="w-16 shrink-0 text-xs text-ink-muted">{dayLabel(season, f.day)}</span>
      <span className="w-28 shrink-0 text-xs text-ink-faint">{f.stage}</span>
      <span className="min-w-[180px] flex-1">
        <span className={r?.winnerId === f.homeId ? 'font-semibold' : ''}>{f.homeName}</span>
        <span className="text-ink-faint"> v </span>
        <span className={r?.winnerId === f.awayId ? 'font-semibold' : ''}>{f.awayName}</span>
      </span>
      {r ? (
        <>
          <span className="num text-ink-muted">{r.innings.map((i: any) => `${i.runs}/${i.wickets}`).join(' · ')}</span>
          <span className="text-xs text-ink-muted">{r.margin}{r.superOver ? ' (super over)' : ''}</span>
          {f.involvesUser && <Badge tone={won ? 'lime' : lost ? 'danger' : 'warn'}>{won ? 'Won' : lost ? 'Lost' : 'Tied'}</Badge>}
          <Link to={`/c/${id}/fixtures/${f.id}`} className="text-xs text-lime hover:underline">Scorecard</Link>
        </>
      ) : (
        <span className="text-xs text-ink-faint">{f.status === 'live' ? 'In progress' : f.venue}</span>
      )}
    </li>
  );
}

export function FixturesPage() {
  const career = useCareer();
  const [mine, setMine] = useState<'mine' | 'all'>('mine');
  const state = useApi<any>(`/careers/${career.id}/fixtures${mine === 'mine' ? '?mine=1' : ''}`, [career.tick, mine]);
  const [comp, setComp] = useState('all');
  const o = career.overview.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Fixtures & results" subtitle="Every match — yours and the AI’s — is played by the same ball-by-ball engine." actions={<Tabs value={mine} onChange={setMine} tabs={[{ id: 'mine', label: 'My club' }, { id: 'all', label: 'All competitions' }]} />} />
      <Async state={state}>
        {(d) => {
          const comps = [...new Set(d.fixtures.map((f: any) => f.competition))] as string[];
          const list = d.fixtures.filter((f: any) => comp === 'all' || f.competition === comp);
          return (
            <Card pad={false} title={mine === 'all' ? <select aria-label="Competition" className="input w-auto" value={comp} onChange={(e) => setComp(e.target.value)}><option value="all">All competitions</option>{comps.map((c) => <option key={c}>{c}</option>)}</select> : 'My fixtures'}>
              {list.length ? <ul>{list.slice(0, 600).map((f: any) => <FixtureRow key={f.id} f={f} season={o?.season ?? 2027} userClubId={o?.club.id} />)}</ul> : <div className="p-4"><Empty title="No fixtures yet">Fixtures are generated when the season starts.</Empty></div>}
            </Card>
          );
        }}
      </Async>
    </div>
  );
}

export function MatchReportPage() {
  const { fid } = useParams();
  const career = useCareer();
  const nav = useNavigate();
  const toast = useToast();
  const state = useApi<any>(`/careers/${career.id}/fixtures/${fid}`, [fid]);
  const [tab, setTab] = useState<'card' | 'charts' | 'balls'>('card');
  return (
    <Async state={state}>
      {(d) => {
        const f = d.fixture;
        const m = d.match;
        return (
          <div className="space-y-5">
            <PageHeader
              title={`${f.home} v ${f.away}`}
              subtitle={`${f.competition} · ${f.stage} · ${f.venue}${m ? ` · seed ${m.seed} · engine ${m.engineVersion}` : ''}`}
              actions={m && m.setup.userSide ? (
                <LabLauncher
                  deliveries={m.deliveries}
                  onStart={async (seq) => {
                    try {
                      await api(`/careers/${career.id}/lab/start`, { body: { fixtureId: f.id, fromSeq: seq } });
                      nav(`/c/${career.id}/lab`);
                    } catch (e) {
                      toast.push('error', (e as Error).message);
                    }
                  }}
                />
              ) : undefined}
            />
            {f.result && (
              <Card>
                <div className="font-display text-2xl font-bold uppercase">{f.result.winnerId ? `${f.result.winnerId === f.homeId ? f.homeName : f.awayName} ${f.result.margin}` : f.result.margin}</div>
                {f.result.playerOfMatch && <p className="text-sm text-ink-muted">Player of the match: {f.result.playerOfMatch.name}</p>}
                {d.result && <p className="text-xs text-ink-faint">Toss: {d.result.tossWinnerId === f.homeId ? f.homeName : f.awayName} chose to {d.result.tossDecision}.</p>}
              </Card>
            )}
            {m ? (
              <>
                <Tabs value={tab} onChange={setTab} tabs={[{ id: 'card', label: 'Scorecard' }, { id: 'charts', label: 'Charts' }, { id: 'balls', label: 'Ball by ball' }]} />
                {tab === 'card' && <Card><Scorecard state={m} /></Card>}
                {tab === 'charts' && <MatchCharts state={m} deliveries={m.deliveries} />}
                {tab === 'balls' && <BallByBall m={m} />}
              </>
            ) : (
              <Empty title="No detailed record">{f.status === 'complete' ? 'This match predates detailed records.' : 'This match has not been played yet.'}</Empty>
            )}
          </div>
        );
      }}
    </Async>
  );
}

function LabLauncher({ deliveries, onStart }: { deliveries: any[]; onStart: (seq: number) => void }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(Math.floor(deliveries.length / 2));
  const d = deliveries[i];
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>Open in Scenario Lab</button>
      <Modal open={open} title="Scenario Lab" onClose={() => setOpen(false)}>
        <p className="text-sm text-ink-muted">Replay this match up to a chosen delivery with the original decisions, then take over and try something different. Lab replays never change your career.</p>
        <label className="label mt-4 block" htmlFor="lab-ball">Start from delivery {i + 1} of {deliveries.length}</label>
        <input id="lab-ball" type="range" min={0} max={deliveries.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} className="mt-2 w-full accent-[#c6ff1a]" />
        {d && <p className="mt-2 rounded-md border border-obsidian-700 bg-obsidian-850 p-2 text-xs"><b>{d.over}.{d.ball}</b> {d.commentary}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={() => { setOpen(false); onStart(d?.seq ?? 0); }}>Start replay</button>
        </div>
      </Modal>
    </>
  );
}

function BallByBall({ m }: { m: any }) {
  const [inn, setInn] = useState(0);
  const list = useMemo(() => m.deliveries.filter((d: any) => d.innings === inn), [m, inn]);
  return (
    <Card title={<select aria-label="Innings" className="input w-auto" value={inn} onChange={(e) => setInn(Number(e.target.value))}>{m.innings.map((i: any) => <option key={i.index} value={i.index}>{m.setup[i.battingSide].name}{i.superOver ? ' (super over)' : ''}</option>)}</select>} pad={false}>
      <ol className="max-h-[70vh] divide-y divide-obsidian-800 overflow-y-auto">
        {list.map((d: any) => (
          <li key={d.seq} className="flex gap-3 px-4 py-2 text-sm">
            <span className="num w-10 shrink-0 text-ink-muted">{d.over}.{d.legal ? d.ball : d.ball + 1}</span>
            <span>{d.commentary}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
