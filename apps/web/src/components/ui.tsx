import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiError } from '../lib/api';

export function Card({ title, actions, children, className = '', pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-obsidian-700 px-4 py-3 md:px-5">
          {title && <h2 className="h-section">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-ink-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-lime border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: ApiError | Error; retry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm" role="alert">
      <p className="font-semibold text-danger">Couldn’t load this.</p>
      <p className="mt-1 text-ink-muted">{error.message}</p>
      {retry && (
        <button className="btn-ghost mt-3" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-obsidian-600 p-8 text-center">
      <p className="font-display text-lg uppercase tracking-wide text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-muted">{children}</div>}
      {action}
    </div>
  );
}

/** Wraps a loadable: loading / error / content, so every page gets all three states. */
export function Async<T>({ state, children, label }: { state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; label?: string }) {
  if (state.error && !state.data) return <ErrorState error={state.error} retry={state.reload} />;
  if (!state.data) return <Loading label={label} />;
  return <>{children(state.data)}</>;
}

export function Badge({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'lime' | 'danger' | 'warn' | 'info' | 'muted'; title?: string }) {
  const t = {
    default: 'border-obsidian-600 bg-obsidian-800 text-ink',
    lime: 'border-lime/40 bg-lime/10 text-lime',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    info: 'border-info/40 bg-info/10 text-info',
    muted: 'border-obsidian-700 bg-transparent text-ink-muted',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${t}`}>
      {children}
    </span>
  );
}

/** A meter that always states its value in text — colour is never the only signal. */
export function Meter({ value, max = 100, label, tone, invert = false, compact = false }: { value: number; max?: number; label?: string; tone?: 'lime' | 'warn' | 'danger'; invert?: boolean; compact?: boolean }) {
  const ratio = Math.max(0, Math.min(1, value / max));
  const bad = invert ? ratio : 1 - ratio;
  const t = tone ?? (bad > 0.66 ? 'danger' : bad > 0.4 ? 'warn' : 'lime');
  const col = t === 'danger' ? 'bg-danger' : t === 'warn' ? 'bg-warn' : 'bg-lime';
  return (
    <div className={compact ? 'w-24' : 'w-full'}>
      {label && (
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-ink-muted">{label}</span>
          <span className="num text-ink">{Math.round(value)}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-obsidian-700" role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
          <div className={`h-full rounded-full ${col}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        {!label && <span className="num w-7 text-right text-xs text-ink-muted">{Math.round(value)}</span>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-obsidian-700 bg-obsidian-850 p-3">
      <div className="label">{label}</div>
      <div className="num mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg border border-obsidian-700 bg-obsidian-900 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${value === t.id ? 'bg-lime text-obsidian-950' : 'text-ink-muted hover:bg-obsidian-800 hover:text-ink'}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** `required` dialogs (a decision the match cannot continue without) have no close button and ignore Escape. */
export function Modal({ open, title, onClose, children, wide = false, required = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; required?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !required) onClose();
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!els.length) return;
        const [a, b] = [els[0], els[els.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose, required]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(e) => !required && e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`card pop max-h-[92vh] w-full overflow-auto rounded-b-none sm:rounded-xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-obsidian-700 bg-obsidian-900 px-5 py-3">
          <h2 id={titleId} className="h-section">
            {title}
          </h2>
          {!required && (
            <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close dialog">
              ✕
            </button>
          )}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-sm text-ink-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  className?: string;
  title?: string;
}

/** Sortable, keyboard-accessible table. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, initialSort, empty }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; initialSort?: { key: string; dir: 1 | -1 }; empty?: ReactNode }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className} title={c.title} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                {c.sort ? (
                  <button className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: -1 }))}>
                    {c.label}
                    <span aria-hidden className="text-[9px]">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              className={onRowClick ? 'cursor-pointer' : ''}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05, left, right, format }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; left?: string; right?: string; format?: (v: number) => string }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="num text-sm text-lime">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#c6ff1a]" />
      {(left || right) && (
        <div className="flex justify-between text-[11px] text-ink-faint">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-obsidian-500 text-[10px] text-ink-muted" title={text} aria-label={text} tabIndex={0}>
      i
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-obsidian-600 bg-obsidian-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">{children}</kbd>;
}
