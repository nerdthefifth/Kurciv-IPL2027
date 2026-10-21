import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, cr, useApi } from '../lib/api';
import { Async, Badge, PageHeader } from '../components/ui';

const DIFFICULTY = [
  { id: 'rookie', label: 'Rookie', text: 'Rival captains make more tactical mistakes and adapt slowly.' },
  { id: 'professional', label: 'Professional', text: 'Competent, realistic opposition. Recommended.' },
  { id: 'elite', label: 'Elite', text: 'Sharp matchups, quick counter-tactics.' },
  { id: 'legend', label: 'Legend', text: 'Near-optimal captaincy. Same player abilities — smarter decisions only.' },
];

export function NewCareerPage() {
  const meta = useApi<any>('/meta');
  const nav = useNavigate();
  const [manager, setManager] = useState('');
  const [difficulty, setDifficulty] = useState('professional');
  const [seed, setSeed] = useState('');
  const [leagueId, setLeagueId] = useState('IPL');
  const [clubId, setClubId] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [cc, setCc] = useState({ name: '', shortName: '', city: '', c1: '#c6ff1a', c2: '#07080a', venueId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const league = useMemo(() => meta.data?.leagues.find((l: any) => l.id === leagueId), [meta.data, leagueId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: any = { managerName: manager, difficulty, seed: seed || undefined };
      if (custom) body.customClub = { name: cc.name, shortName: cc.shortName.toUpperCase(), city: cc.city, leagueId, colors: [cc.c1, cc.c2], venueId: cc.venueId || undefined };
      else body.clubId = clubId;
      const r = await api<{ id: string }>('/careers', { body });
      nav(`/c/${r.id}/auction`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const ready = manager.trim().length >= 2 && (custom ? cc.name.trim().length >= 3 && /^[A-Za-z]{2,4}$/.test(cc.shortName) : !!clubId);
  return (
    <div className="carbon min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader title="New career" subtitle="One club, one league — the rest of the world is run by AI." actions={<Link to="/" className="btn-ghost">Back</Link>} />
        <Async state={meta}>
          {(m) => (
            <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
              <div className="card card-pad space-y-4">
                <div>
                  <label className="label" htmlFor="mgr">Manager name</label>
                  <input id="mgr" className="input mt-1" value={manager} onChange={(e) => setManager(e.target.value)} maxLength={40} placeholder="Your name" />
                </div>
                <fieldset>
                  <legend className="label">Difficulty</legend>
                  <div className="mt-2 space-y-2">
                    {DIFFICULTY.map((d) => (
                      <label key={d.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${difficulty === d.id ? 'border-lime/60 bg-lime/5' : 'border-obsidian-700'}`}>
                        <input type="radio" name="diff" className="mt-1 accent-[#c6ff1a]" checked={difficulty === d.id} onChange={() => setDifficulty(d.id)} />
                        <span>
                          <span className="font-semibold">{d.label}</span>
                          <span className="block text-xs text-ink-muted">{d.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div>
                  <label className="label" htmlFor="seed">World seed (optional)</label>
                  <input id="seed" className="input mt-1" value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={64} placeholder="random" />
                  <p className="mt-1 text-xs text-ink-faint">The same seed and decisions reproduce the same world.</p>
                </div>
                {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                <button className="btn-primary w-full" disabled={!ready || busy} onClick={create}>
                  {busy ? 'Building the world & running higher-tier auctions…' : 'Create career'}
                </button>
              </div>

              <div className="space-y-4">
                <div className="card card-pad">
                  <div className="label mb-2">League</div>
                  <div className="flex flex-wrap gap-2">
                    {m.leagues.map((l: any) => (
                      <button key={l.id} className={`rounded-lg border px-3 py-2 text-left text-sm ${leagueId === l.id ? 'border-lime/60 bg-lime/10' : 'border-obsidian-700 hover:border-obsidian-500'}`} onClick={() => { setLeagueId(l.id); setClubId(null); }}>
                        <div className="font-semibold">{l.shortName}</div>
                        <div className="text-[11px] text-ink-muted">{l.countryName} · rep {l.reputation}</div>
                      </button>
                    ))}
                  </div>
                  {league && (
                    <p className="mt-3 text-sm text-ink-muted">
                      <b className="text-ink">{league.name}</b>{league.fictional && <> <Badge tone="muted">fictional competition</Badge></>} · purse {cr(league.purse)} · squads {league.squadRules.minSquad}–{league.squadRules.maxSquad} · max {league.squadRules.maxOverseas} overseas ({league.squadRules.maxPerOverseasCountry} per country) · {league.squadRules.maxRetentions} retentions per season.
                    </p>
                  )}
                </div>
                {league && (
                  <div className="card card-pad">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="label">Club</div>
                      <button className="btn-ghost text-xs" onClick={() => { setCustom(!custom); setClubId(null); }}>{custom ? 'Choose an existing club' : 'Create a custom club'}</button>
                    </div>
                    {!custom ? (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {league.clubs.map((c: any) => (
                          <button key={c.id} onClick={() => setClubId(c.id)} aria-pressed={clubId === c.id} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${clubId === c.id ? 'border-lime bg-lime/5' : 'border-obsidian-700 hover:border-obsidian-500'}`}>
                            <span className="h-10 w-10 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${c.colors[0]}, ${c.colors[1]})` }} aria-hidden />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{c.name}</span>
                              <span className="block text-xs text-ink-muted">{c.city} · brand {c.brand} · {c.personality.replace('-', ' ')}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><label className="label" htmlFor="cn">Club name</label><input id="cn" className="input mt-1" value={cc.name} onChange={(e) => setCc({ ...cc, name: e.target.value })} maxLength={40} /></div>
                        <div><label className="label" htmlFor="cs">Code (2–4 letters)</label><input id="cs" className="input mt-1 uppercase" value={cc.shortName} onChange={(e) => setCc({ ...cc, shortName: e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 4) })} /></div>
                        <div><label className="label" htmlFor="ci">City</label><input id="ci" className="input mt-1" value={cc.city} onChange={(e) => setCc({ ...cc, city: e.target.value })} maxLength={40} /></div>
                        <div>
                          <label className="label" htmlFor="cv">Home ground</label>
                          <select id="cv" className="input mt-1" value={cc.venueId} onChange={(e) => setCc({ ...cc, venueId: e.target.value })}>
                            <option value="">Default for {league.countryName}</option>
                            {m.venues.filter((v: any) => v.country === league.country).map((v: any) => <option key={v.id} value={v.id}>{v.name}, {v.city}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-4">
                          <label className="label flex items-center gap-2">Primary <input type="color" value={cc.c1} onChange={(e) => setCc({ ...cc, c1: e.target.value })} /></label>
                          <label className="label flex items-center gap-2">Secondary <input type="color" value={cc.c2} onChange={(e) => setCc({ ...cc, c2: e.target.value })} /></label>
                        </div>
                        <p className="text-xs text-ink-muted sm:col-span-2">A custom club joins the {league.shortName} as an expansion franchise with a modest brand and starts from the auction like everyone else. Names and codes must be unique.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </Async>
      </div>
    </div>
  );
}
