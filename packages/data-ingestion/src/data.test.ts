import { describe, expect, it } from 'vitest';
import { overall } from '@kurciv/domain';
import { Rng } from '@kurciv/simulation';
import { CURATED_PLAYERS } from './curated';
import { expandCurated, generatePlayer, validateCuratedRows } from './players';
import { validateManifest } from './images';

describe('curated player seed', () => {
  it('has no validation errors or duplicate identities', () => {
    const issues = validateCuratedRows(CURATED_PLAYERS, 2027).filter((i) => i.level === 'error');
    expect(issues).toEqual([]);
  });

  it('expands deterministically into derived ratings', () => {
    const a = expandCurated(CURATED_PLAYERS[0], 2027);
    const b = expandCurated(CURATED_PLAYERS[0], 2027);
    expect(a).toEqual(b);
    expect(a.stats.career.matches).toBe(0); // no statistics are invented
    expect(overall(a)).toBeGreaterThan(70);
  });

  it('generated players are labelled and never elite by default', () => {
    const rng = Rng.from('gen');
    const ps = Array.from({ length: 300 }, (_, i) => generatePlayer(rng, { country: 'AUS', quality: 60, season: 2027 }, i));
    expect(ps.every((p) => p.source === 'generated' && !p.capped)).toBe(true);
    expect(ps.filter((p) => overall(p) >= 85).length).toBeLessThan(5);
  });
});

describe('image manifest', () => {
  it('accepts only attributed, licensed, https images', () => {
    const { valid, rejected } = validateManifest([
      { playerId: 'p-a', url: 'https://upload.wikimedia.org/x.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', attribution: 'Photo by X', licence: 'CC BY-SA 4.0', lastChecked: '2026-10-01' },
      { playerId: 'p-b', url: 'http://example.com/x.jpg', sourceUrl: 'https://example.com', attribution: 'X', licence: 'CC BY 4.0', lastChecked: '2026-10-01' },
      { playerId: 'p-c', url: 'https://example.com/x.jpg', sourceUrl: 'https://example.com', attribution: 'X', licence: 'found on Google', lastChecked: '2026-10-01' },
    ]);
    expect(valid.map((v) => v.playerId)).toEqual(['p-a']);
    expect(rejected).toHaveLength(2);
  });
});
