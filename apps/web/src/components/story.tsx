import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dayLabel } from '../lib/api';
import { useCareer } from '../lib/context';
import { usePlayerModal } from './player';

const NAVIGATE = new Set(['open-player', 'compare', 'open-page']);

/**
 * A story from the story engine. Navigation actions just open the relevant screen; every other
 * action performs a real operation through the engine (and resolves the story).
 */
export function StoryCard({ story, compact = false, onAction }: { story: any; compact?: boolean; onAction?: () => void }) {
  const career = useCareer();
  const nav = useNavigate();
  const players = usePlayerModal();
  const [busy, setBusy] = useState(false);
  const run = async (a: any, index: number) => {
    onAction?.();
    if (a.kind === 'open-player') return players.open(a.payload.playerId);
    if (a.kind === 'compare') return players.compare(a.payload.a, a.payload.b);
    if (a.kind === 'open-page') return nav(`/c/${career.id}/${a.payload.page}`);
    setBusy(true);
    await career.mutate(`/stories/${story.id}/act`, { index }, { success: a.kind === 'dismiss' ? undefined : `${a.label} — done.` });
    setBusy(false);
  };
  const tone = story.severity === 'major' ? 'border-l-lime' : story.severity === 'notable' ? 'border-l-warn' : 'border-l-obsidian-500';
  return (
    <article className={`rounded-xl border border-obsidian-700 border-l-[3px] bg-obsidian-900 ${tone} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="kicker">{story.kicker}</div>
        <div className="shrink-0 text-[11px] text-ink-faint">{dayLabel(story.season, story.day)}</div>
      </div>
      <h3 className={`mt-1 font-semibold leading-snug ${compact ? 'text-sm' : 'headline text-lg'}`}>{story.title}</h3>
      {!compact && <p className="mt-1.5 text-sm text-ink-muted">{story.body}</p>}
      {story.status === 'active' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {story.actions.map((a: any, i: number) => (
            <button key={i} disabled={busy} onClick={() => run(a, i)}
              className={a.kind === 'dismiss' ? 'btn-quiet px-2.5 py-1 text-xs' : NAVIGATE.has(a.kind) ? 'btn-ghost px-2.5 py-1 text-xs' : 'btn-primary px-2.5 py-1 text-xs'}>
              {a.label}
            </button>
          ))}
        </div>
      ) : story.resolution ? <p className="mt-2 text-xs text-ink-faint">{story.resolution}</p> : null}
    </article>
  );
}
