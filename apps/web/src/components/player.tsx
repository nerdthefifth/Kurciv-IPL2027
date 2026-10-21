import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BOWL_LABEL, ROLE_LABEL, cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Confirm, Meter, Modal, Tabs } from './ui';
import { Sparkline } from './charts';
import { PlayerPortrait } from './media';

export { PlayerPortrait as Avatar };

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone="muted" title={ROLE_LABEL[role]}>{role}</Badge>;
}

/** Status chips. Text always accompanies colour. */
export function ConditionBadges({ p }: { p: any }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {p.injury && <Badge tone="danger" title={`${p.injury.type}, about ${p.injury.daysRemaining} days`}>Injured</Badge>}
      {p.fatigue >= 70 && !p.injury && <Badge tone="warn" title={`Fatigue ${p.fatigue}`}>Tired</Badge>}
      {p.transferRequest && <Badge tone="warn">Unsettled</Badge>}
      {p.source === 'generated' && <Badge tone="muted" title="Generated player — not a real person">Gen</Badge>}
      {p.source === 'youth' && <Badge tone="info" title="Academy product">Academy</Badge>}
      {p.overseas && <Badge tone="info" title="Overseas player for registration purposes">OS</Badge>}
    </span>
  );
}

export function OvrChip({ p, big = false }: { p: any; big?: boolean }) {
  const exact = p.range.lo === p.range.hi;
  return (
    <span className="inline-flex items-baseline gap-1" title={exact ? 'Overall rating' : `Scouted range ${p.range.lo}–${p.range.hi}`}>
      <span className={`num font-semibold text-lime ${big ? 'text-3xl' : 'text-lg'}`}>{p.ovr}</span>
      {!exact && <span className="text-[10px] text-ink-faint">±{Math.round((p.range.hi - p.range.lo) / 2)}</span>}
    </span>
  );
}

function FormDot({ form }: { form: number | null }) {
  if (form === null) return <span className="text-ink-faint">—</span>;
  const label = form >= 3 ? 'Hot' : form <= -3 ? 'Cold' : 'Steady';
  return <span className={`text-xs font-medium ${form >= 3 ? 'text-lime' : form <= -3 ? 'text-danger' : 'text-ink-muted'}`}>{label} {form > 0 ? '+' : ''}{form}</span>;
}

/**
 * Context-aware player card. `auction` prioritises bidding info, `squad` selection and fitness,
 * `scouting` potential and uncertainty.
 */
export function PlayerCard({ p, context = 'squad', onClick, footer }: { p: any; context?: 'auction' | 'squad' | 'scouting'; onClick?: () => void; footer?: ReactNode }) {
  const { open } = usePlayerModal();
  return (
    <article className="card group flex flex-col gap-3 p-4 transition-colors hover:border-obsidian-500">
      <div className="flex items-start gap-3">
        <PlayerPortrait player={p} size={56} />
        <div className="min-w-0 flex-1">
          <button className="block truncate text-left font-semibold text-ink hover:text-lime" onClick={onClick ?? (() => open(p.id))}>{p.name}</button>
          <div className="text-xs text-ink-muted">{p.countryName} · {p.age} · {ROLE_LABEL[p.role]}</div>
          <div className="mt-1"><ConditionBadges p={p} /></div>
        </div>
        <OvrChip p={p} />
      </div>
      {context === 'squad' && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div><div className="text-ink-faint">Form</div><FormDot form={p.form} /></div>
          <div><div className="text-ink-faint">Fitness</div><span className={p.fatigue >= 65 ? 'text-warn' : 'text-ink'}>{100 - p.fatigue}%</span></div>
          <div><div className="text-ink-faint">Morale</div><span className={p.morale !== null && p.morale < 40 ? 'text-danger' : 'text-ink'}>{p.morale ?? '—'}</span></div>
        </div>
      )}
      {context === 'scouting' && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div><div className="text-ink-faint">Potential</div><span className="num text-sm">{p.potential.lo}–{p.potential.hi}</span></div>
          <div><div className="text-ink-faint">Value</div><span className="num text-sm">{cr(p.marketValue)}</span></div>
          <div><div className="text-ink-faint">Club</div><span>{p.clubShort ?? 'Free'}</span></div>
        </div>
      )}
      {context === 'auction' && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div><div className="text-ink-faint">Bat</div><span className="num text-sm">{p.batting}</span></div>
          <div><div className="text-ink-faint">Bowl</div><span className="num text-sm">{p.bowlType === 'NONE' ? '—' : p.bowling}</span></div>
          <div><div className="text-ink-faint">Est.</div><span className="num text-sm">{cr(p.marketValue)}</span></div>
        </div>
      )}
      {footer}
    </article>
  );
}

// ------------------------------------------------------------------ global profile & compare

const PlayerCtx = createContext<{ open: (id: string) => void; compare: (a: string, b: string) => void }>({ open: () => {}, compare: () => {} });
export const usePlayerModal = () => useContext(PlayerCtx);

export function PlayerModalProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const [pair, setPair] = useState<[string, string] | null>(null);
  return (
    <PlayerCtx.Provider value={{ open: setId, compare: (a, b) => setPair([a, b]) }}>
      {children}
      {id && <PlayerProfile id={id} onClose={() => setId(null)} />}
      {pair && <CompareModal ids={pair} onClose={() => setPair(null)} />}
    </PlayerCtx.Provider>
  );
}

export function PlayerName({ p, className = '' }: { p: { id: string; name: string }; className?: string }) {
  const { open } = usePlayerModal();
  return (
    <button className={`text-left font-medium text-ink hover:text-lime hover:underline ${className}`} onClick={(e) => (e.stopPropagation(), open(p.id))}>
      {p.name}
    </button>
  );
}

const ATTR_LABEL: Record<string, string> = {
  vsPace: 'v Pace', vsSpin: 'v Spin', power: 'Power', rotation: 'Strike rotation', defence: 'Defence', powerplay: 'Powerplay', middle: 'Middle overs', death: 'Death overs',
  speed: 'Speed (km/h)', control: 'Control', movement: 'Movement', variation: 'Variations', yorker: 'Yorker', slower: 'Slower ball', stamina: 'Stamina',
  catching: 'Catching', ground: 'Ground fielding', throwing: 'Throwing', athleticism: 'Athleticism', keeping: 'Keeping',
  temperament: 'Temperament', leadership: 'Leadership', adaptability: 'Adaptability', workEthic: 'Work ethic', fitness: 'Fitness', durability: 'Durability',
};

type Tab = 'overview' | 'batting' | 'bowling' | 'fielding' | 'career' | 'seasons' | 'medical' | 'development' | 'contract' | 'scouting';

function AttrGroup({ group, p }: { group: 'bat' | 'bowl' | 'field' | 'mental' | 'phys'; p: any }) {
  return (
    <div className="space-y-2.5">
      {Object.entries(p.attrs[group]).map(([k, v]) => (k === 'speed' ? (
        <div key={k} className="flex justify-between text-xs"><span className="text-ink-muted">{ATTR_LABEL[k]}</span><span className="num">{p.bowlType === 'NONE' ? '—' : Math.round(v as number)}</span></div>
      ) : (
        <Meter key={k} label={ATTR_LABEL[k] ?? k} value={v as number} />
      )))}
    </div>
  );
}

function PlayerProfile({ id, onClose }: { id: string; onClose: () => void }) {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/players/${id}`, [career.tick, id]);
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <Modal open title="Player profile" onClose={onClose} wide>
      <Async state={state}>
        {(p) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start gap-5">
              <PlayerPortrait player={p} size={112} />
              <div className="min-w-0 flex-1">
                <div className="kicker">{ROLE_LABEL[p.role]}{p.clubName ? ` · ${p.clubName}` : p.isYouth ? ' · Academy' : ' · Free agent'}</div>
                <h3 className="headline mt-1 text-3xl">{p.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">{p.countryName} · {p.age}{p.ageConfidence !== 'curated' ? ' (est.)' : ''} · {p.batHand === 'L' ? 'Left' : 'Right'}-hand bat · {BOWL_LABEL[p.bowlType]}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.capped && <Badge tone="lime">Capped</Badge>}
                  <ConditionBadges p={p} />
                  {p.tags.map((t: string) => <Badge key={t} tone="muted">{t}</Badge>)}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="label">Ability</dt><dd><OvrChip p={p} big /></dd></div>
                <div><dt className="label">Potential</dt><dd className="num text-xl">{p.potential.lo}–{p.potential.hi}</dd></div>
                <div><dt className="label">Form</dt><dd><FormDot form={p.form} /></dd></div>
                <div><dt className="label">Value</dt><dd className="num text-xl">{cr(p.marketValue)}</dd></div>
              </dl>
            </div>
            <p className="rounded-lg border border-obsidian-700 bg-obsidian-850 px-3 py-2 text-xs text-ink-muted">{p.dataNote}{p.image?.attribution ? ` Photo: ${p.image.attribution}.` : ''}</p>
            <div className="strip -mx-1 overflow-x-auto px-1">
              <Tabs value={tab} onChange={setTab} tabs={[
                { id: 'overview', label: 'Overview' }, { id: 'batting', label: 'Batting' }, { id: 'bowling', label: 'Bowling' }, { id: 'fielding', label: 'Fielding' },
                { id: 'career', label: 'Career stats' }, { id: 'seasons', label: 'Season history' }, { id: 'medical', label: 'Fitness & medical' },
                { id: 'development', label: 'Development' }, { id: 'contract', label: 'Contract & value' }, { id: 'scouting', label: 'Scouting report' },
              ]} />
            </div>
            {tab === 'overview' && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="panel p-4">
                  <div className="label mb-3">How they compare — {p.peers.count} {ROLE_LABEL[p.role].toLowerCase()}s</div>
                  <div className="space-y-2.5">
                    <Meter label="Overall (percentile)" value={p.peers.overall} />
                    <Meter label="Batting (percentile)" value={p.peers.batting} />
                    {p.bowlType !== 'NONE' && <Meter label="Bowling (percentile)" value={p.peers.bowling} />}
                    <Meter label="Fielding (percentile)" value={p.peers.fielding} />
                  </div>
                  <p className="mt-3 text-xs text-ink-faint">Ability is an estimate; form is a short-term signal; statistics are what actually happened. None of them alone describes a player.</p>
                </div>
                <div className="panel p-4">
                  <div className="label mb-2">Recent matches</div>
                  {p.matchLog.length ? (
                    <table className="table">
                      <thead><tr><th>Opp</th><th>Stage</th><th className="text-right">Bat</th><th className="text-right">Bowl</th></tr></thead>
                      <tbody>{p.matchLog.map((m: any) => <tr key={m.fixtureId}><td><button className="text-left hover:text-lime hover:underline" onClick={() => { onClose(); nav(`/c/${career.id}/fixtures/${m.fixtureId}`); }} title="Open the match report">{m.won ? '✓ ' : ''}{m.opponent}</button></td><td className="text-ink-muted">{m.stage}</td><td className="num text-right">{m.bat ? `${m.bat.runs}${m.bat.out ? '' : '*'} (${m.bat.balls})` : '—'}</td><td className="num text-right">{m.bowl ? `${m.bowl.wickets}/${m.bowl.runs}` : '—'}</td></tr>)}</tbody>
                    </table>
                  ) : <p className="text-sm text-ink-muted">No Kurciv matches yet.</p>}
                  {p.matchLog.length > 2 && <div className="mt-2"><Sparkline values={[...p.matchLog].reverse().map((m: any) => (m.bat?.runs ?? 0) + (m.bowl?.wickets ?? 0) * 20)} width={200} /></div>}
                </div>
              </div>
            )}
            {tab === 'batting' && <div className="grid gap-5 md:grid-cols-2"><div className="panel p-4"><AttrGroup group="bat" p={p} /></div><StatBlock title="Batting record" rows={[['Runs', p.career.runs], ['Average', p.career.average ?? '—'], ['Strike rate', p.career.strikeRate ?? '—'], ['50s / 100s', `${p.career.fifties} / ${p.career.hundreds}`], ['4s / 6s', `${p.career.fours} / ${p.career.sixes}`], ['Highest', p.career.highScore]]} /></div>}
            {tab === 'bowling' && (p.bowlType === 'NONE'
              ? <p className="text-sm text-ink-muted">{p.name} does not bowl.</p>
              : <div className="grid gap-5 md:grid-cols-2"><div className="panel p-4"><AttrGroup group="bowl" p={p} /></div><StatBlock title="Bowling record" rows={[['Wickets', p.career.wickets], ['Economy', p.career.economy ?? '—'], ['Average', p.career.bowlingAverage ?? '—'], ['Best', p.career.best ?? '—'], ['Dot balls', p.career.dots], ['Overs', Math.floor(p.career.ballsBowled / 6)]]} /></div>)}
            {tab === 'fielding' && <div className="grid gap-5 md:grid-cols-2"><div className="panel p-4"><AttrGroup group="field" p={p} /></div><StatBlock title="Fielding record" rows={[['Catches', p.career.catches], ['Stumpings', p.career.stumpings], ['Run-outs', p.career.runOuts]]} /></div>}
            {tab === 'career' && <StatsTable p={p} />}
            {tab === 'seasons' && (p.bySeason.length ? <StatsTable p={{ ...p, bySeasonOnly: true }} /> : <p className="text-sm text-ink-muted">No seasons played in this career yet.</p>)}
            {tab === 'medical' && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="panel space-y-2.5 p-4">
                  <Meter label="Fatigue" value={p.fatigue} invert />
                  {p.morale !== null && <Meter label="Morale" value={p.morale} />}
                  <AttrGroup group="phys" p={p} />
                  {p.injury && <p className="text-sm text-danger">{p.injury.type}: about {p.injury.daysRemaining} days remaining (assessed {p.injury.expected}).</p>}
                </div>
                <div className="panel p-4">
                  <div className="label mb-2">Injury history</div>
                  {p.injuryHistory.length ? <ul className="space-y-1 text-sm">{p.injuryHistory.map((h: any, i: number) => <li key={i}>{h.season}: {h.type} (~{h.days} days)</li>)}</ul> : <p className="text-sm text-ink-muted">No injuries recorded.</p>}
                </div>
              </div>
            )}
            {tab === 'development' && (
              <div className="space-y-3">
                {p.development.length > 1 && <Sparkline values={p.development.map((d: any) => d.overall)} width={320} height={48} />}
                {p.development.length ? (
                  <table className="table">
                    <thead><tr><th>Season</th><th>Overall</th><th>Batting</th><th>Bowling</th><th>Potential</th><th>Note</th></tr></thead>
                    <tbody>{p.development.map((d: any) => <tr key={d.season}><td>{d.season}</td><td className="num">{d.overall.toFixed(1)}</td><td className="num">{d.bat}</td><td className="num">{d.bowl}</td><td className="num">{d.potential}</td><td className="text-ink-muted">{d.note}</td></tr>)}</tbody>
                  </table>
                ) : <p className="text-sm text-ink-muted">Development is reviewed at the end of each season. Potential is a scouted range, not a promise.</p>}
                {p.personality && <p className="text-sm text-ink-muted">Personality: {p.personality}. Work ethic and morale shape how quickly potential is realised.</p>}
              </div>
            )}
            {tab === 'contract' && (
              <StatBlock title="Contract & value" rows={[
                ['Club', p.clubName ?? (p.isYouth ? 'Academy' : 'Free agent')], ['Salary', p.contract ? cr(p.contract.salary) : '—'], ['Acquired', p.contract?.acquired ?? '—'],
                ['Times retained', p.contract?.retainedCount ?? 0], ['Estimated market value', cr(p.marketValue)], ['Reputation', p.reputation], ...(p.asking !== null ? [['Asking price', cr(p.asking)] as [string, string]] : []),
              ]} />
            )}
            {tab === 'scouting' && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="panel p-4">
                  <div className="label mb-2 text-lime">Strengths</div>
                  {p.scouting.strengths.length ? <ul className="space-y-1 text-sm">{p.scouting.strengths.map((s: string) => <li key={s}>+ {s}</li>)}</ul> : <p className="text-sm text-ink-muted">No standout strengths identified.</p>}
                  <div className="label mb-2 mt-4 text-warn">Concerns</div>
                  {p.scouting.concerns.length ? <ul className="space-y-1 text-sm">{p.scouting.concerns.map((s: string) => <li key={s}>– {s}</li>)}</ul> : <p className="text-sm text-ink-muted">No obvious weaknesses.</p>}
                </div>
                <div className="panel p-4 text-sm">
                  <div className="label mb-2">Certainty</div>
                  <Badge tone={p.scouting.certainty === 'high' ? 'lime' : p.scouting.certainty === 'medium' ? 'info' : 'muted'}>{p.scouting.certainty}</Badge>
                  <p className="mt-2 text-ink-muted">{p.scouting.note} Scouted ability {p.range.lo}–{p.range.hi}; potential {p.potential.lo}–{p.potential.hi}.</p>
                  {p.attrs && <div className="mt-3"><AttrGroup group="mental" p={p} /></div>}
                </div>
              </div>
            )}
            <PlayerActions p={p} onDone={onClose} />
          </div>
        )}
      </Async>
    </Modal>
  );
}

function StatBlock({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <div className="panel p-4">
      <div className="label mb-2">{title}</div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="num text-right text-base">{v}</dd></div>))}
      </dl>
    </div>
  );
}

function StatsTable({ p }: { p: any }) {
  const rows = p.bySeasonOnly ? p.bySeason.map((b: any) => ({ label: `${b.season} · ${b.competition}`, s: b })) : [{ label: 'This season', s: p.season }, { label: 'Kurciv career', s: p.career }];
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th></th><th>M</th><th>Runs</th><th>HS</th><th>Avg</th><th>SR</th><th>50/100</th><th>4s/6s</th><th>Wkts</th><th>Econ</th><th>Best</th><th>Ct/St</th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.label}>
              <td className="text-ink-muted">{r.label}</td><td className="num">{r.s.matches}</td><td className="num">{r.s.runs}</td><td className="num">{r.s.highScore}</td>
              <td className="num">{r.s.average ?? '—'}</td><td className="num">{r.s.strikeRate ?? '—'}</td><td className="num">{r.s.fifties}/{r.s.hundreds}</td>
              <td className="num">{r.s.fours}/{r.s.sixes}</td><td className="num">{r.s.wickets}</td><td className="num">{r.s.economy ?? '—'}</td><td className="num">{r.s.best ?? '—'}</td>
              <td className="num">{r.s.catches}/{r.s.stumpings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.career.matches === 0 && <p className="mt-2 text-xs text-ink-faint">No Kurciv matches yet. Real-world records are not imported as in-game statistics.</p>}
    </div>
  );
}

function PlayerActions({ p, onDone }: { p: any; onDone: () => void }) {
  const career = useCareer();
  const nav = useNavigate();
  const userClubId = career.overview.data?.club.id;
  const [confirm, setConfirm] = useState(false);
  if (p.retired) return null;
  if (!p.clubId && !p.isYouth && p.asking !== null) {
    return (
      <div className="flex items-center justify-end gap-3 border-t border-obsidian-700 pt-4">
        <span className="text-sm text-ink-muted">Asking {cr(p.asking)}</span>
        <button className="btn-primary" onClick={async () => (await career.mutate('/transfers/sign', { playerId: p.id }, { success: `${p.name} signed.` })) && onDone()}>Sign player</button>
      </div>
    );
  }
  if (p.clubId && p.clubId !== userClubId) {
    return (
      <div className="flex justify-end border-t border-obsidian-700 pt-4">
        <button className="btn-quiet" onClick={() => { onDone(); nav(`/c/${career.id}/club/${p.clubId}`); }}>View {p.clubShort}</button>
      </div>
    );
  }
  if (p.clubId === userClubId) {
    return (
      <div className="flex justify-end border-t border-obsidian-700 pt-4">
        <button className="btn-danger" onClick={() => setConfirm(true)}>Release player</button>
        <Confirm open={confirm} danger title="Release player?" confirmLabel="Release"
          body={`${p.name} will become a free agent. The salary is not refunded to your purse and another club may sign them.`}
          onClose={() => setConfirm(false)}
          onConfirm={async () => (await career.mutate('/transfers/release', { playerId: p.id }, { success: `${p.name} released.` })) && onDone()} />
      </div>
    );
  }
  return null;
}

function CompareModal({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const career = useCareer();
  const a = useApi<any>(`/careers/${career.id}/players/${ids[0]}`, [ids[0]]);
  const b = useApi<any>(`/careers/${career.id}/players/${ids[1]}`, [ids[1]]);
  const rows: [string, (p: any) => number | string, boolean][] = [
    ['Ability', (p) => p.ovr, true], ['Potential (high)', (p) => p.potential.hi, true], ['Age', (p) => p.age, false], ['Form', (p) => p.form ?? 0, true],
    ['Batting', (p) => p.batting, true], ['Bowling', (p) => (p.bowlType === 'NONE' ? 0 : p.bowling), true], ['Fielding', (p) => p.fielding, true],
    ['Fitness', (p) => 100 - p.fatigue, true], ['Career runs', (p) => p.career.runs, true], ['Career wickets', (p) => p.career.wickets, true], ['Value (₹ Cr)', (p) => p.marketValue, true],
  ];
  return (
    <Modal open title="Player comparison" onClose={onClose} wide>
      {a.data && b.data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[a.data, b.data].map((p) => (
              <div key={p.id} className="flex items-center gap-3"><PlayerPortrait player={p} size={64} /><div><div className="headline text-xl">{p.name}</div><div className="text-xs text-ink-muted">{ROLE_LABEL[p.role]} · {p.age} · {p.clubShort ?? 'Academy/Free'}</div></div></div>
            ))}
          </div>
          <table className="table">
            <tbody>
              {rows.map(([label, f, higher]) => {
                const x = f(a.data);
                const y = f(b.data);
                const better = (v: any, o: any) => typeof v === 'number' && typeof o === 'number' && (higher ? v > o : v < o);
                return (
                  <tr key={label}>
                    <td className={`num text-right text-base ${better(x, y) ? 'text-lime' : ''}`}>{x}</td>
                    <td className="text-center text-xs text-ink-muted">{label}</td>
                    <td className={`num text-base ${better(y, x) ? 'text-lime' : ''}`}>{y}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-ink-muted">Loading…</p>}
    </Modal>
  );
}
