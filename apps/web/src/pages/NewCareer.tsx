import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, cr } from '../lib/api';
import { useMeta } from '../lib/meta';
import { ClubCrest } from '../components/media';
import { Icon } from '../components/icons';
import { Badge, Steps } from '../components/ui';

const DIFFICULTY = [
  { id: 'rookie', label: 'Rookie', text: 'Rival captains make more tactical mistakes and adapt slowly. Boards are patient.' },
  { id: 'professional', label: 'Professional', text: 'Competent, realistic opposition. Recommended for a first career.' },
  { id: 'elite', label: 'Elite', text: 'Sharp matchups, quick counter-tactics, a demanding board.' },
  { id: 'legend', label: 'Legend', text: 'Near-optimal captaincy. Player abilities are identical — only decisions get smarter.' },
];

const PHILOSOPHY = [
  { id: 'balanced', label: 'Balanced', text: 'Adapt to conditions. No strong lean in selection or tempo.' },
  { id: 'aggressive', label: 'Front-foot', text: 'High batting intent in the powerplay and at the death. More boundaries, more risk.' },
  { id: 'anchored', label: 'Anchored', text: 'Keep wickets in hand and launch late. Fewer collapses, lower ceilings.' },
  { id: 'spin', label: 'Spin web', text: 'Control the middle overs with spin and catching fields.' },
  { id: 'pace', label: 'Pace battery', text: 'Attack with seam up front and yorkers at the death.' },
];

const STEPS = ['League', 'Club', 'Manager', 'Summary'];

export function NewCareerPage() {
  const m = useMeta();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [worldModel, setWorldModel] = useState<'pyramid' | 'leagues'>('pyramid');
  const [leagueId, setLeagueId] = useState('IPL');
  const [clubId, setClubId] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [cc, setCc] = useState({ name: '', shortName: '', city: '', c1: '#7A1F35', c2: '#F5EFE3', venueId: '' });
  const [manager, setManager] = useState('');
  const [difficulty, setDifficulty] = useState('professional');
  const [philosophy, setPhilosophy] = useState('balanced');
  const [seed, setSeed] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pyramid = worldModel === 'pyramid';
  const divName = (id: string | null | undefined) => m.divisions?.find((d: any) => d.id === id)?.shortName ?? '';
  const startDiv = (id: string): string | null => (pyramid ? m.pyramid?.seeding?.[id] ?? null : null);
  // In the pyramid, fictional clubs appear as their own group alongside the home leagues.
  const fictional = {
    id: 'FIC', name: 'Fictional clubs', shortName: 'Fictional', countryName: 'Worldwide', country: 'IRE', reputation: 45, purse: m.divisions?.[4]?.purse ?? 18,
    squadRules: m.divisions?.[4]?.squadRules ?? m.leagues[0].squadRules,
    clubs: (m.pyramid?.fictionalClubs ?? []).map((c: any) => ({ ...c, personality: 'value-hunter', brand: 40, venue: m.venues.find((v: any) => v.id === c.venueId)?.name })),
  };
  const groups = pyramid ? [...m.leagues, fictional] : m.leagues;
  const league = groups.find((l: any) => l.id === leagueId);
  const clubDivision = clubId ? startDiv(clubId) : null;
  const ruleSource = pyramid ? m.divisions?.find((d: any) => d.id === (custom ? 'GD5' : clubDivision)) ?? null : null;
  const club = league?.clubs.find((c: any) => c.id === clubId);
  const customOk = cc.name.trim().length >= 3 && /^[A-Za-z]{2,4}$/.test(cc.shortName) && cc.city.trim().length >= 2;
  const canNext = [!!league, custom ? customOk : !!clubId, manager.trim().length >= 2, true][step];

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: any = { managerName: manager.trim(), difficulty, philosophy, seed: seed.trim() || undefined, worldModel };
      if (custom) body.customClub = { name: cc.name.trim(), shortName: cc.shortName.toUpperCase(), city: cc.city.trim(), leagueId: leagueId === 'FIC' ? 'GD5' : leagueId, colors: [cc.c1, cc.c2], venueId: cc.venueId || undefined };
      else body.clubId = clubId;
      const r = await api<{ id: string }>('/careers', { body });
      nav(`/c/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const shownClub = custom ? { id: 'custom', name: cc.name || 'Your club', shortName: (cc.shortName || 'NEW').toUpperCase(), colors: [cc.c1, cc.c2] as [string, string] } : club && { ...club, leagueId };

  return (
    <div className="grain min-h-screen bg-obsidian-950">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <Link to="/" className="btn-quiet mb-4 -ml-2 inline-flex"><Icon name="chevronLeft" /> Title screen</Link>
        <div className="kicker">New career</div>
        <h1 className="headline mt-1 text-3xl md:text-4xl">{['Choose your competition', 'Choose your club', 'Who is in charge?', 'Ready to begin'][step]}</h1>
        <div className="my-6"><Steps steps={STEPS} current={step} /></div>

        {step === 0 && (
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            {([
              { id: 'pyramid', title: 'Global pyramid', text: `${m.divisions?.length ?? 5} divisions of ${m.pyramid?.clubsPerDivision ?? 18} clubs from every region, promotion and relegation, continental cups, preseason friendlies and international cricket (Test, ODI and T20).`, badge: 'Recommended' },
              { id: 'leagues', title: 'Classic national leagues', text: `The original ${m.leagues.length} franchise leagues and the World Club Championship. No pyramid, cups or international cricket.`, badge: null },
            ] as const).map((o) => (
              <button key={o.id} onClick={() => { setWorldModel(o.id); setClubId(null); if (o.id === 'leagues' && leagueId === 'FIC') setLeagueId('IPL'); }} aria-pressed={worldModel === o.id}
                className={`card p-4 text-left transition-colors ${worldModel === o.id ? 'border-lime ring-1 ring-lime/40' : 'hover:border-obsidian-500'}`}>
                <div className="flex items-center justify-between"><span className="font-semibold">{o.title}</span>{o.badge && <Badge tone="lime">{o.badge}</Badge>}</div>
                <p className="mt-1 text-sm text-ink-muted">{o.text}</p>
              </button>
            ))}
          </div>
        )}
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pyramid && <p className="text-sm text-ink-muted sm:col-span-2 lg:col-span-3">Pick a home league to see its clubs. In the pyramid, clubs are seeded into divisions by league standing and brand; each club shows where it starts.</p>}
            {groups.map((l: any) => (
              <button key={l.id} onClick={() => { setLeagueId(l.id); setClubId(null); }} aria-pressed={leagueId === l.id}
                className={`card flex flex-col gap-2 p-4 text-left transition-colors ${leagueId === l.id ? 'border-lime ring-1 ring-lime/40' : 'hover:border-obsidian-500'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{l.shortName}</span>
                  <Badge tone={l.reputation >= 85 ? 'lime' : 'muted'}>{pyramid ? `${l.clubs.length} clubs` : `Rep ${l.reputation}`}</Badge>
                </div>
                <span className="text-sm text-ink-muted">{l.name}</span>
                <span className="text-xs text-ink-faint">{pyramid ? `${l.countryName} · starts in ${[...new Set(l.clubs.map((c: any) => divName(startDiv(c.id))))].join(', ')}` : `${l.countryName} · ${l.clubs.length} clubs · purse ${cr(l.purse)}`}</span>
                <span className="mt-1 flex -space-x-1.5">{l.clubs.slice(0, 8).map((c: any) => <ClubCrest key={c.id} club={{ ...c, leagueId: l.id }} size={22} />)}</span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && league && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                {pyramid
                  ? 'Pyramid squads: 16–22 players, up to 6 overseas (from outside the club’s own country), 6 retentions a season. The purse depends on the division.'
                  : `${league.name}: squads ${league.squadRules.minSquad}–${league.squadRules.maxSquad}, max ${league.squadRules.maxOverseas} overseas (${league.squadRules.maxPerOverseasCountry} per country), ${league.squadRules.maxRetentions} retentions a season.`}
              </p>
              <button className="btn-ghost" onClick={() => { setCustom(!custom); setClubId(null); }}>{custom ? 'Choose an existing club' : 'Create an expansion club'}</button>
            </div>
            {!custom ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {league.clubs.map((c: any) => (
                  <button key={c.id} onClick={() => setClubId(c.id)} aria-pressed={clubId === c.id}
                    className={`card relative flex items-center gap-3 overflow-hidden p-4 text-left transition-colors ${clubId === c.id ? 'border-lime ring-1 ring-lime/40' : 'hover:border-obsidian-500'}`}>
                    <span className="absolute inset-y-0 left-0 w-1" style={{ background: c.colors[0] }} aria-hidden />
                    <ClubCrest club={{ ...c, leagueId }} size={48} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="block text-xs text-ink-muted">{c.city} · {c.venue}</span>
                      <span className="block text-xs text-ink-faint">Brand {c.brand} · {c.personality.replace('-', ' ')} owners</span>
                      {pyramid && startDiv(c.id) && <span className="mt-1 inline-block"><Badge tone="info">Starts in {divName(startDiv(c.id))}</Badge></span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card grid gap-4 p-5 sm:grid-cols-2">
                <label className="block"><span className="label">Club name</span><input className="input mt-1 w-full" value={cc.name} onChange={(e) => setCc({ ...cc, name: e.target.value })} maxLength={40} /></label>
                <label className="block"><span className="label">Code (2–4 letters)</span><input className="input mt-1 w-full uppercase" value={cc.shortName} onChange={(e) => setCc({ ...cc, shortName: e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 4) })} /></label>
                <label className="block"><span className="label">City</span><input className="input mt-1 w-full" value={cc.city} onChange={(e) => setCc({ ...cc, city: e.target.value })} maxLength={40} /></label>
                <label className="block">
                  <span className="label">Home ground</span>
                  <select className="input mt-1 w-full" value={cc.venueId} onChange={(e) => setCc({ ...cc, venueId: e.target.value })}>
                    <option value="">Default for {league.countryName}</option>
                    {m.venues.filter((v: any) => (pyramid && league.id === 'FIC' ? v.fictional : v.country === league.country)).map((v: any) => <option key={v.id} value={v.id}>{v.name}, {v.city}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-5">
                  <label className="label flex items-center gap-2">Primary <input type="color" value={cc.c1} onChange={(e) => setCc({ ...cc, c1: e.target.value })} /></label>
                  <label className="label flex items-center gap-2">Secondary <input type="color" value={cc.c2} onChange={(e) => setCc({ ...cc, c2: e.target.value })} /></label>
                  {shownClub && <ClubCrest club={shownClub} size={44} />}
                </div>
                <p className="text-xs text-ink-muted sm:col-span-2">{pyramid ? 'An expansion club starts in League Three (the fifth division) with a modest brand; its country is the home ground’s country. Name and code must be unique.' : `An expansion franchise joins the ${league.shortName} with a modest brand and builds its squad in the auction like everyone else. Name and code must be unique in the league.`}</p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <label className="block">
                <span className="label">Manager name</span>
                <input className="input mt-1 w-full text-base" autoFocus value={manager} onChange={(e) => setManager(e.target.value)} maxLength={40} placeholder="How the press will know you" />
              </label>
              <fieldset>
                <legend className="label mb-2">Difficulty</legend>
                <div className="space-y-2">
                  {DIFFICULTY.map((d) => (
                    <Choice key={d.id} name="difficulty" checked={difficulty === d.id} onChange={() => setDifficulty(d.id)} label={d.label} text={d.text} />
                  ))}
                </div>
              </fieldset>
            </div>
            <fieldset>
              <legend className="label mb-2">Tactical philosophy</legend>
              <div className="space-y-2">
                {PHILOSOPHY.map((p) => (
                  <Choice key={p.id} name="philosophy" checked={philosophy === p.id} onChange={() => setPhilosophy(p.id)} label={p.label} text={p.text} />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-faint">Sets your starting tactics and club identity. Everything can be changed later in Tactics.</p>
            </fieldset>
          </div>
        )}

        {step === 3 && shownClub && league && (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="card relative overflow-hidden p-6">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${shownClub.colors[0]}, ${shownClub.colors[1]})` }} aria-hidden />
              <div className="flex items-center gap-4">
                <ClubCrest club={shownClub} size={72} />
                <div>
                  <div className="kicker">{pyramid ? `${divName(custom ? 'GD5' : clubDivision)} · global pyramid` : league.name}</div>
                  <div className="headline text-2xl">{shownClub.name}</div>
                  <div className="text-sm text-ink-muted">Managed by {manager.trim()}</div>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="label">Difficulty</dt><dd>{DIFFICULTY.find((d) => d.id === difficulty)!.label}</dd></div>
                <div><dt className="label">Philosophy</dt><dd>{PHILOSOPHY.find((p) => p.id === philosophy)!.label}</dd></div>
                <div><dt className="label">Auction purse</dt><dd className="num">{cr(ruleSource?.purse ?? league.purse)}</dd></div>
                <div><dt className="label">Squad rules</dt><dd>{(ruleSource?.squadRules ?? league.squadRules).maxSquad} max · {(ruleSource?.squadRules ?? league.squadRules).maxOverseas} overseas</dd></div>
              </dl>
            </div>
            <div className="space-y-4">
              <div className="panel p-4 text-sm text-ink-muted">
                <div className="label mb-1 text-ink">What happens next</div>
                <ol className="list-decimal space-y-1 pl-5">
                  {pyramid ? (
                    <>
                      <li>The world is built: {m.divisions?.length ?? 5} divisions, 90 clubs, about 13,000 players (over 3,000 real and 10,000 fictional) and 24 national teams.</li>
                      <li>Higher divisions run their auctions first.</li>
                      <li>You enter your division’s auction room, then arrange preseason friendlies.</li>
                    </>
                  ) : (
                    <>
                      <li>The world is built: {m.leagues.length} leagues, their clubs and players.</li>
                      <li>Higher-tier leagues run their auctions first.</li>
                      <li>You enter the {league.shortName} auction room with a full purse.</li>
                    </>
                  )}
                </ol>
              </div>
              <div className="panel p-4">
                <button className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
                  Advanced options <Icon name={advanced ? 'chevronDown' : 'chevronRight'} />
                </button>
                {advanced && (
                  <label className="mt-3 block">
                    <span className="label">World seed</span>
                    <input className="input mt-1 w-full" value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={64} placeholder="random" />
                    <span className="mt-1 block text-xs text-ink-faint">The same seed and the same decisions reproduce the same world.</span>
                  </label>
                )}
              </div>
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">{error}</p>}
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-obsidian-700 pt-5">
          <button className="btn-ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}><Icon name="chevronLeft" /> Back</button>
          {step < 3 ? (
            <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next <Icon name="chevronRight" /></button>
          ) : (
            <button className="btn-primary px-6" disabled={busy} onClick={create}>{busy ? 'Building your world…' : 'Begin career'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({ name, checked, onChange, label, text }: { name: string; checked: boolean; onChange: () => void; label: string; text: string }) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${checked ? 'border-lime/60 bg-lime/5' : 'border-obsidian-700 hover:border-obsidian-500'}`}>
      <input type="radio" name={name} className="mt-1 accent-lime" checked={checked} onChange={onChange} />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="block text-xs text-ink-muted">{text}</span>
      </span>
    </label>
  );
}
