import { createContext, useContext, useState, type ReactNode } from 'react';
import { BOWL_LABEL, ROLE_LABEL, cr, useApi } from '../lib/api';
import { useCareer } from '../lib/context';
import { Async, Badge, Meter, Modal, Tabs } from './ui';

/** Portrait with graceful fallback: licensed image if one exists, otherwise a clean silhouette. */
export function Avatar({ name, colors, image, size = 40 }: { name: string; colors?: [string, string]; image?: { url: string | null; attribution: string | null } | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (image?.url && !broken) {
    return <img src={image.url} alt={name} title={image.attribution ?? undefined} loading="lazy" width={size} height={size} className="rounded-lg object-cover" onError={() => setBroken(true)} />;
  }
  const [a, b] = colors ?? ['#1e2128', '#2a2e37'];
  const initials = name.split(' ').map((x) => x[0]).slice(0, 2).join('');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${name} (no portrait)`} className="shrink-0 rounded-lg">
      <defs>
        <linearGradient id={`g-${initials}-${size}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} stopOpacity="0.55" />
          <stop offset="1" stopColor="#0c0d10" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="8" fill={`url(#g-${initials}-${size})`} />
      <circle cx="20" cy="15" r="7" fill="#0c0d10" opacity="0.65" />
      <path d="M6 40c1-9 7-14 14-14s13 5 14 14z" fill="#0c0d10" opacity="0.65" />
      <text x="34" y="10" textAnchor="end" fontSize="8" fontWeight="700" fill={b === '#ffffff' ? '#c6ff1a' : '#f4f6f8'} opacity="0.9">
        {initials}
      </text>
    </svg>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone="muted" title={ROLE_LABEL[role]}>{role}</Badge>;
}

export function ConditionBadges({ p }: { p: any }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {p.injury && <Badge tone="danger" title={`${p.injury.type}, ~${p.injury.daysRemaining} days`}>✚ Injured</Badge>}
      {p.fatigue >= 70 && !p.injury && <Badge tone="warn" title={`Fatigue ${p.fatigue}`}>Tired</Badge>}
      {p.transferRequest && <Badge tone="warn">Unsettled</Badge>}
      {p.source === 'generated' && <Badge tone="muted" title="Generated player — not a real person">Gen</Badge>}
      {p.source === 'youth' && <Badge tone="info" title="Academy product">Academy</Badge>}
      {p.overseas && <Badge tone="info" title="Overseas player for registration purposes">OS</Badge>}
    </span>
  );
}

export function OvrChip({ p }: { p: any }) {
  const exact = p.range.lo === p.range.hi;
  return (
    <span className="inline-flex items-baseline gap-1" title={exact ? 'Overall rating' : `Scouted range ${p.range.lo}–${p.range.hi}`}>
      <span className="num text-lg font-semibold text-lime">{p.ovr}</span>
      {!exact && <span className="text-[10px] text-ink-faint">±{Math.round((p.range.hi - p.range.lo) / 2)}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ global profile modal

const PlayerCtx = createContext<{ open: (id: string) => void }>({ open: () => {} });
export const usePlayerModal = () => useContext(PlayerCtx);

export function PlayerModalProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  return (
    <PlayerCtx.Provider value={{ open: setId }}>
      {children}
      {id && <PlayerProfile id={id} onClose={() => setId(null)} />}
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

function PlayerProfile({ id, onClose }: { id: string; onClose: () => void }) {
  const career = useCareer();
  const state = useApi<any>(`/careers/${career.id}/players/${id}`, [career.tick]);
  const [tab, setTab] = useState<'profile' | 'stats' | 'development'>('profile');
  return (
    <Modal open title="Player profile" onClose={onClose} wide>
      <Async state={state}>
        {(p) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={p.name} image={p.image} size={72} />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-3xl font-bold uppercase leading-none">{p.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {p.countryName} · {p.age}{p.ageConfidence !== 'curated' ? ' (est.)' : ''} · {ROLE_LABEL[p.role]} · {p.batHand === 'L' ? 'Left' : 'Right'}-hand bat · {BOWL_LABEL[p.bowlType]}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.capped && <Badge tone="lime">Capped</Badge>}
                  <ConditionBadges p={p} />
                  {p.tags.map((t: string) => (
                    <Badge key={t} tone="muted">{t}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="label">Overall</div>
                  <OvrChip p={p} />
                </div>
                <div>
                  <div className="label">Potential</div>
                  <div className="num text-lg">{p.potential.lo}–{p.potential.hi}</div>
                </div>
                <div>
                  <div className="label">Value</div>
                  <div className="num text-lg">{cr(p.marketValue)}</div>
                </div>
              </div>
            </div>
            <p className="rounded-md border border-obsidian-700 bg-obsidian-850 px-3 py-2 text-xs text-ink-muted">{p.dataNote}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-ink-muted">Club:</span> <span>{p.clubName ?? (p.isYouth ? 'Academy' : 'Free agent')}</span>
              {p.contract && <span className="text-ink-muted">Contract: {cr(p.contract.salary)} ({p.contract.acquired})</span>}
              {p.injury && <Badge tone="danger">{p.injury.type} — {p.injury.daysRemaining} days ({p.injury.expected} expected)</Badge>}
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Attributes' }, { id: 'stats', label: 'Statistics' }, { id: 'development', label: 'Development' }]} />
            {tab === 'profile' && (
              <div className="grid gap-4 md:grid-cols-2">
                {(['bat', 'bowl', 'field', 'mental', 'phys'] as const).map((g) => (
                  <div key={g} className="rounded-lg border border-obsidian-700 p-3">
                    <div className="label mb-2">{{ bat: 'Batting', bowl: 'Bowling', field: 'Fielding', mental: 'Mental', phys: 'Physical' }[g]}</div>
                    <div className="space-y-2">
                      {Object.entries(p.attrs[g]).map(([k, v]) => (k === 'speed' ? (
                        <div key={k} className="flex justify-between text-xs"><span className="text-ink-muted">{ATTR_LABEL[k]}</span><span className="num">{p.bowlType === 'NONE' ? '—' : Math.round(v as number)}</span></div>
                      ) : (
                        <Meter key={k} label={ATTR_LABEL[k] ?? k} value={v as number} />
                      )))}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-obsidian-700 p-3">
                  <div className="label mb-2">Condition</div>
                  <div className="space-y-2">
                    <Meter label="Fatigue" value={p.fatigue} invert />
                    {p.morale !== null && <Meter label="Morale" value={p.morale} />}
                    {p.form !== null && <div className="flex justify-between text-xs"><span className="text-ink-muted">Form</span><span className="num">{p.form > 0 ? '+' : ''}{p.form}</span></div>}
                    {p.personality && <div className="flex justify-between text-xs"><span className="text-ink-muted">Personality</span><span>{p.personality}</span></div>}
                  </div>
                </div>
              </div>
            )}
            {tab === 'stats' && <StatsTable p={p} />}
            {tab === 'development' && (
              <div className="space-y-3">
                {p.development.length ? (
                  <table className="table">
                    <thead><tr><th>Season</th><th>Overall</th><th>Batting</th><th>Bowling</th><th>Potential</th><th>Note</th></tr></thead>
                    <tbody>{p.development.map((d: any) => <tr key={d.season}><td>{d.season}</td><td className="num">{d.overall.toFixed(1)}</td><td className="num">{d.bat}</td><td className="num">{d.bowl}</td><td className="num">{d.potential}</td><td className="text-ink-muted">{d.note}</td></tr>)}</tbody>
                  </table>
                ) : <p className="text-sm text-ink-muted">Development is reviewed at the end of each season.</p>}
                {p.injuryHistory.length > 0 && (
                  <div>
                    <div className="label mb-1">Injury history</div>
                    <ul className="text-sm text-ink-muted">{p.injuryHistory.map((h: any, i: number) => <li key={i}>{h.season}: {h.type} (~{h.days} days)</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            <PlayerActions p={p} onDone={onClose} />
          </div>
        )}
      </Async>
    </Modal>
  );
}

function StatsTable({ p }: { p: any }) {
  const rows = [{ label: 'This season', s: p.season }, { label: 'Kurciv career', s: p.career }, ...p.bySeason.map((b: any) => ({ label: `${b.season} · ${b.competition}`, s: b }))];
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th></th><th>M</th><th>Runs</th><th>HS</th><th>Avg</th><th>SR</th><th>50/100</th><th>4s/6s</th><th>Wkts</th><th>Econ</th><th>Best</th><th>Ct/St</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="text-ink-muted">{r.label}</td>
              <td className="num">{r.s.matches}</td>
              <td className="num">{r.s.runs}</td>
              <td className="num">{r.s.highScore}</td>
              <td className="num">{r.s.average ?? '—'}</td>
              <td className="num">{r.s.strikeRate ?? '—'}</td>
              <td className="num">{r.s.fifties}/{r.s.hundreds}</td>
              <td className="num">{r.s.fours}/{r.s.sixes}</td>
              <td className="num">{r.s.wickets}</td>
              <td className="num">{r.s.economy ?? '—'}</td>
              <td className="num">{r.s.best ?? '—'}</td>
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
  const userClubId = career.overview.data?.club.id;
  const [confirm, setConfirm] = useState(false);
  if (p.retired) return null;
  if (!p.clubId && !p.isYouth && p.asking !== null) {
    return (
      <div className="flex items-center justify-end gap-2 border-t border-obsidian-700 pt-4">
        <span className="text-sm text-ink-muted">Asking {cr(p.asking)}</span>
        <button className="btn-primary" onClick={async () => (await career.mutate('/transfers/sign', { playerId: p.id }, { success: `${p.name} signed.` })) && onDone()}>
          Sign player
        </button>
      </div>
    );
  }
  if (p.clubId === userClubId) {
    return (
      <div className="flex justify-end border-t border-obsidian-700 pt-4">
        <button className="btn-danger" onClick={() => setConfirm(true)}>Release player</button>
        {confirm && (
          <ReleaseConfirm name={p.name} onConfirm={async () => (await career.mutate('/transfers/release', { playerId: p.id }, { success: `${p.name} released.` })) && onDone()} onClose={() => setConfirm(false)} />
        )}
      </div>
    );
  }
  return null;
}

function ReleaseConfirm({ name, onConfirm, onClose }: { name: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open title="Release player?" onClose={onClose}>
      <p className="text-sm text-ink-muted">{name} will become a free agent. Their salary is not refunded to your purse, and another club may sign them.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-danger" onClick={() => (onConfirm(), onClose())}>Release</button>
      </div>
    </Modal>
  );
}
