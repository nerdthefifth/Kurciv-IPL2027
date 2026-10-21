import { useState } from 'react';
import { ensureClub, ensurePlayer, ensureVenue, useImage } from '../lib/images';
import { useClubRef } from '../lib/meta';

export interface CrestClub {
  id: string;
  name: string;
  shortName: string;
  colors: [string, string];
  leagueId?: string;
}

/** Original Kurciv crest: a shield in the club's colours with its monogram. */
function FallbackCrest({ club, size }: { club: CrestClub; size: number }) {
  const [a, b] = club.colors;
  const letters = club.shortName.slice(0, 4);
  const fs = letters.length > 3 ? 7.5 : letters.length > 2 ? 9 : 11;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${club.name} crest`} className="shrink-0">
      <path d="M20 2.5 35 7v12c0 9.2-6.3 15.8-15 18.5C11.3 34.8 5 28.2 5 19V7l15-4.5Z" fill={a} stroke={b} strokeWidth="2" />
      <path d="M20 6.5 31.5 10v9c0 7.3-4.8 12.6-11.5 14.9V6.5Z" fill="#000" opacity="0.14" />
      <text x="20" y="23.5" textAnchor="middle" fontFamily="Barlow Condensed, Inter, sans-serif" fontWeight="700" fontSize={fs} fill={b} letterSpacing="0.3">
        {letters}
      </text>
    </svg>
  );
}

export function ClubCrest({ club, size = 32, className = '' }: { club: CrestClub; size?: number; className?: string }) {
  const img = useImage(`club:${club.id}`, () => club.leagueId && ensureClub({ id: club.id, name: club.name, leagueId: club.leagueId }));
  const [broken, setBroken] = useState(false);
  if (img?.status === 'ok' && img.url && !broken) {
    return (
      <img src={img.url} alt={`${club.name} badge`} title={img.attribution ?? undefined} width={size} height={size} loading="lazy" decoding="async"
        className={`shrink-0 object-contain ${className}`} style={{ width: size, height: size }} onError={() => setBroken(true)} />
    );
  }
  return <span className={className}><FallbackCrest club={club} size={size} /></span>;
}

export interface PortraitPlayer {
  id: string;
  name: string;
  source?: string;
}

function Silhouette({ name, size, tone }: { name: string; size: number; tone?: string }) {
  const initials = name.split(' ').map((x) => x[0]).slice(0, 2).join('');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${name} (no photo)`} className="shrink-0">
      <rect width="40" height="40" rx="10" fill="rgb(var(--surface-3))" />
      <circle cx="20" cy="16" r="7" fill={tone ?? 'rgb(var(--line-stronger))'} opacity="0.55" />
      <path d="M6 40c1.2-8.6 6.7-13 14-13s12.8 4.4 14 13z" fill={tone ?? 'rgb(var(--line-stronger))'} opacity="0.55" />
      <text x="35" y="9" textAnchor="end" fontSize="7" fontWeight="700" fill="rgb(var(--text-muted))">{initials}</text>
    </svg>
  );
}

/** Player portrait: licensed photo or cutout when available, otherwise a clean silhouette. */
export function PlayerPortrait({ player, size = 44, tone, className = '' }: { player: PortraitPlayer; size?: number; tone?: string; className?: string }) {
  const img = useImage(player.source === 'curated' ? `player:${player.id}` : null, () => ensurePlayer({ id: player.id, name: player.name, source: player.source ?? 'generated' }, size > 80 ? 9 : 3));
  const [broken, setBroken] = useState(false);
  if (img?.status === 'ok' && img.url && !broken) {
    const cut = img.kind === 'cutout';
    return (
      <span className={`relative inline-block shrink-0 overflow-hidden rounded-xl ${cut ? 'bg-gradient-to-b from-obsidian-700 to-obsidian-850' : 'bg-obsidian-800'} ${className}`} style={{ width: size, height: size }} title={img.attribution ?? undefined}>
        <img src={img.url} alt={player.name} loading="lazy" decoding="async" onError={() => setBroken(true)}
          className={`h-full w-full ${cut ? 'object-contain object-bottom' : 'object-cover object-top'}`} />
      </span>
    );
  }
  return <span className={className}><Silhouette name={player.name} size={size} tone={tone} /></span>;
}

/** Venue photograph (Wikimedia Commons) as a soft background, with credit. */
export function VenueBackdrop({ venue, className = '', children }: { venue: { id: string; name: string } | null; className?: string; children?: React.ReactNode }) {
  const img = useImage(venue ? `venue:${venue.id}` : null, () => venue && ensureVenue(venue));
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {img?.status === 'ok' && img.url && (
        <>
          <img src={img.url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-105 object-cover opacity-30" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-obsidian-900 via-obsidian-900/80 to-obsidian-900/40" />
        </>
      )}
      <div className="relative">{children}</div>
      {img?.status === 'ok' && img.attribution && <p className="absolute bottom-1 right-3 max-w-[60%] truncate text-[10px] text-ink-faint" title={img.attribution}>Photo: {img.attribution}</p>}
    </div>
  );
}

/** Crest for any club by id, resolved from the static metadata (custom clubs pass `fallback`). */
export function ClubCrestById({ clubId, size = 32, fallback, className = '' }: { clubId: string | null | undefined; size?: number; fallback?: CrestClub; className?: string }) {
  const ref = useClubRef(clubId);
  const club = ref ?? fallback;
  if (!club) return <span className={className}><FallbackCrest club={{ id: 'tbd', name: 'To be decided', shortName: 'TBD', colors: ['#3e443c', '#a6b09f'] }} size={size} /></span>;
  return <ClubCrest club={club} size={size} className={className} />;
}
