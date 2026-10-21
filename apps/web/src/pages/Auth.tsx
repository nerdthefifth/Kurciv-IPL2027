import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/context';

export function AuthPage() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await api(`/auth/${mode}`, { body: { username, password } });
      setUser(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="carbon flex min-h-screen items-center justify-center p-4">
      <div className="grid w-full max-w-5xl gap-8 md:grid-cols-2 md:items-center">
        <div>
          <img src="/favicon.svg" alt="" width={56} height={56} />
          <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-none tracking-wide md:text-6xl">
            Kurciv <span className="text-lime">IPL 2027</span>
          </h1>
          <p className="mt-4 max-w-md text-ink-muted">
            Build a franchise, master the auction, read the pitch and outthink rival captains in a living global cricket universe — every ball simulated, every season remembered.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink-muted">
            <li><span className="text-lime">▸</span> Ball-by-ball T20 engine with a live field editor</li>
            <li><span className="text-lime">▸</span> Intelligent auction AI across a global league cascade</li>
            <li><span className="text-lime">▸</span> 50-club World Club Championship that reshapes league reputations</li>
          </ul>
        </div>
        <form onSubmit={submit} className="card card-pad space-y-4" aria-labelledby="auth-title">
          <h2 id="auth-title" className="h-section">{mode === 'register' ? 'Create your manager account' : 'Welcome back'}</h2>
          <div>
            <label htmlFor="u" className="label">Username</label>
            <input id="u" className="input mt-1" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} />
          </div>
          <div>
            <label htmlFor="p" className="label">Password</label>
            <input id="p" type="password" className="input mt-1" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            {mode === 'register' && <p className="mt-1 text-xs text-ink-faint">At least 8 characters. Stored as a salted scrypt hash.</p>}
          </div>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
          <button type="button" className="w-full text-sm text-ink-muted hover:text-lime" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
          <p className="text-xs text-ink-faint">Simulation only — no real-money wagering, and simulated results are not predictions of real matches.</p>
        </form>
      </div>
    </div>
  );
}
