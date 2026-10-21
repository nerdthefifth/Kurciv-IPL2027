import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PHASE_LABEL, api, useApi } from '../lib/api';
import { useAuth, useToast } from '../lib/context';
import { Async, Confirm, Empty, PageHeader } from '../components/ui';

export function CareersPage() {
  const state = useApi<{ careers: any[] }>('/careers');
  const { user, setUser } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [del, setDel] = useState<any>(null);
  return (
    <div className="carbon min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <PageHeader
          title="Save slots"
          subtitle={`Signed in as ${user?.username}`}
          actions={
            <>
              <Link to="/new" className="btn-primary">New career</Link>
              <button className="btn-ghost" onClick={async () => { await api('/auth/logout', { body: {} }); setUser(null); }}>Sign out</button>
            </>
          }
        />
        <Async state={state}>
          {(d) =>
            d.careers.length ? (
              <ul className="space-y-3">
                {d.careers.map((c) => (
                  <li key={c.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <div className="font-display text-xl font-semibold uppercase">{c.name}</div>
                      <div className="text-sm text-ink-muted">Season {c.season} · {PHASE_LABEL[c.phase]} · saved {new Date(c.updated_at).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary" onClick={() => nav(`/c/${c.id}`)}>Continue</button>
                      <button className="btn-danger" onClick={() => setDel(c)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No careers yet" action={<Link to="/new" className="btn-primary mt-2">Start your first career</Link>}>
                Pick a franchise in the IPL or any of ten other leagues — or found your own club — and build a dynasty from the 2027 auction onward.
              </Empty>
            )
          }
        </Async>
      </div>
      {del && (
        <Confirm
          open
          danger
          title="Delete this career?"
          body={<>“{del.name}” and all of its seasons, match records and history will be permanently deleted.</>}
          confirmLabel="Delete forever"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            try {
              await api(`/careers/${del.id}`, { method: 'DELETE' });
              toast.push('ok', 'Career deleted.');
              state.reload();
            } catch (e) {
              toast.push('error', (e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
