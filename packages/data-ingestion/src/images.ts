import type { PlayerImage, WorldState } from '@kurciv/domain';

/**
 * Image provider layer. Portraits are optional: gameplay never depends on them, and every
 * player falls back to a generated silhouette. Images are only accepted from a manifest that
 * records where each image came from and under what licence — Kurciv never scrapes websites
 * or hotlinks images without permission.
 */
export interface ImageManifestEntry {
  playerId: string;
  url: string;
  sourceUrl: string;
  attribution: string;
  licence: string; // e.g. "CC BY-SA 4.0", "Licensed: <provider> contract #123"
  lastChecked: string; // ISO date
}

export interface ImageProvider {
  name: string;
  lookup(playerId: string): PlayerImage | null;
}

const ACCEPTED_LICENCES = /^(CC0|CC BY(-SA)? \d\.\d|Public domain|Licensed: .+)$/i;

export function validateManifest(entries: unknown): { valid: ImageManifestEntry[]; rejected: { entry: unknown; reason: string }[] } {
  const valid: ImageManifestEntry[] = [];
  const rejected: { entry: unknown; reason: string }[] = [];
  if (!Array.isArray(entries)) return { valid, rejected: [{ entry: entries, reason: 'Manifest must be a JSON array' }] };
  for (const e of entries as Record<string, unknown>[]) {
    const reason =
      typeof e?.playerId !== 'string' ? 'missing playerId'
        : typeof e.url !== 'string' || !/^https:\/\//.test(e.url) ? 'url must be https'
          : typeof e.sourceUrl !== 'string' || !/^https?:\/\//.test(e.sourceUrl) ? 'missing sourceUrl'
            : typeof e.attribution !== 'string' || !e.attribution.trim() ? 'missing attribution'
              : typeof e.licence !== 'string' || !ACCEPTED_LICENCES.test(e.licence) ? `licence "${String(e.licence)}" is not an accepted licence or recorded permission`
                : typeof e.lastChecked !== 'string' || Number.isNaN(Date.parse(e.lastChecked)) ? 'lastChecked must be an ISO date'
                  : null;
    if (reason) rejected.push({ entry: e, reason });
    else valid.push(e as unknown as ImageManifestEntry);
  }
  return { valid, rejected };
}

export function manifestProvider(entries: ImageManifestEntry[]): ImageProvider {
  const map = new Map(entries.map((e) => [e.playerId, e]));
  return {
    name: 'manifest',
    lookup(id) {
      const e = map.get(id);
      return e ? { url: e.url, attribution: e.attribution, licence: e.licence, sourceUrl: e.sourceUrl, lastChecked: e.lastChecked } : null;
    },
  };
}

/** Applies a provider to a world. Players without an entry keep the silhouette fallback. */
export function applyImages(w: WorldState, provider: ImageProvider): number {
  let n = 0;
  for (const p of Object.values(w.players)) {
    const img = provider.lookup(p.id);
    if (img) {
      p.image = img;
      n++;
    }
  }
  return n;
}
