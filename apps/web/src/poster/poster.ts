/**
 * Match Poster Studio: data model, templates and Canvas renderer.
 *
 * The poster is drawn from the validated match report only (never from UI state), on a canvas at
 * the exact export size. The on-screen preview is the same canvas scaled down, so what you see is
 * exactly what downloads. External images are optional: anything that fails to load (or that the
 * host does not allow to be embedded) is replaced by a clean vector fallback.
 */
import { dayLabel } from '../lib/api';
import { cachedImage } from '../lib/images';

export type PosterFormat = 'portrait' | 'story' | 'square' | 'landscape';
export type PosterTemplate = 'broadcast' | 'editorial' | 'minimal';

export const FORMATS: Record<PosterFormat, { w: number; h: number; label: string }> = {
  portrait: { w: 1080, h: 1350, label: 'Portrait · 1080 × 1350' },
  story: { w: 1080, h: 1920, label: 'Story · 1080 × 1920' },
  square: { w: 1080, h: 1080, label: 'Square · 1080 × 1080' },
  landscape: { w: 1920, h: 1080, label: 'Landscape · 1920 × 1080' },
};

export const TEMPLATES: Record<PosterTemplate, string> = {
  broadcast: 'Broadcast',
  editorial: 'Editorial',
  minimal: 'Minimal',
};

export interface PosterOptions {
  template: PosterTemplate;
  format: PosterFormat;
  portraits: boolean;
  crests: boolean;
  showVenue: boolean;
  showDate: boolean;
  highlights: 'compact' | 'extended';
  theme: 'neutral' | 'team';
}

export const DEFAULT_OPTIONS: PosterOptions = { template: 'broadcast', format: 'portrait', portraits: true, crests: true, showVenue: true, showDate: true, highlights: 'compact', theme: 'neutral' };

interface PosterTeam {
  clubId: string;
  name: string;
  shortName: string;
  colors: [string, string];
  score: string | null;
  overs: string | null;
  winner: boolean;
}

export interface PosterData {
  competition: string;
  season: number;
  matchLabel: string;
  stage: string;
  headline: string;
  tone: 'close' | 'dominant' | 'tie' | 'standard';
  teams: [PosterTeam, PosterTeam];
  result: string;
  pom: { playerId: string; name: string; line: string; team: string } | null;
  highlights: { label: string; name: string; figure: string; team: string; winner: boolean }[];
  venue: string;
  date: string | null;
}

/** Builds the poster's content strictly from the report. */
export function posterData(report: any): PosterData {
  const t = report.teams;
  const team = (side: 'home' | 'away'): PosterTeam => {
    const info = t[side];
    const inn = report.innings.find((i: any) => i.battingClubId === info.clubId);
    return {
      clubId: info.clubId, name: info.name, shortName: info.shortName, colors: info.colors,
      score: inn ? `${inn.runs}${inn.allOut ? '' : `/${inn.wickets}`}` : null,
      overs: inn ? `${inn.overs} ov` : null,
      winner: report.result.winnerClubId === info.clubId,
    };
  };
  const shortOf = (clubId: string) => (t.home.clubId === clubId ? t.home.shortName : t.away.shortName);
  const pomId = report.playerOfMatch?.playerId;
  const bat = report.performances.batting.filter((p: any) => p.playerId !== pomId);
  const bowl = report.performances.bowling.filter((p: any) => p.playerId !== pomId);
  const field = report.performances.fielding.filter((p: any) => p.playerId !== pomId);
  const hl: PosterData['highlights'] = [];
  const add = (label: string, p: any) => p && hl.push({ label, name: p.name, figure: p.line, team: shortOf(p.clubId), winner: p.clubId === report.result.winnerClubId });
  // Labels must stay true: when the award winner holds the top figure, the next one is not 'top'.
  const topBat = report.performances.batting[0]?.playerId;
  const topBowl = report.performances.bowling[0]?.playerId;
  add(bat[0] && bat[0].playerId === topBat ? 'Top score' : 'Also with the bat', bat[0]);
  add(bowl[0] && bowl[0].playerId === topBowl ? 'Best bowling' : 'Also with the ball', bowl[0]);
  add('Also starred', bat[1]);
  add(field[0] ? 'In the field' : 'Tight spell', field[0] ?? bowl[1]);
  const m = report.meta;
  return {
    competition: m.competition.replace(/\s+\d{4}$/, ''),
    season: m.season,
    matchLabel: m.matchNumber ? `Match ${m.matchNumber}` : m.stage,
    stage: m.stage,
    headline: report.headline.title,
    tone: report.headline.tone,
    teams: [team('home'), team('away')],
    result: report.result.status === 'tied' ? (report.result.superOver ? report.result.text : 'Match tied') : report.result.text,
    pom: report.playerOfMatch ? { playerId: report.playerOfMatch.playerId, name: report.playerOfMatch.name, line: report.playerOfMatch.line, team: shortOf(report.playerOfMatch.clubId) } : null,
    highlights: hl,
    venue: m.venue.name + (m.venue.city && !m.venue.name.includes(m.venue.city) ? `, ${m.venue.city}` : ''),
    date: m.day !== null ? dayLabel(m.season, m.day) : null,
  };
}

export function posterFilename(report: any, format: PosterFormat): string {
  const m = report.meta;
  const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  const part = m.matchNumber ? `match-${m.matchNumber}` : slug(m.stage);
  const name = `kurciv-ipl-2027-${m.season}-${part}-${slug(report.teams.home.shortName)}-vs-${slug(report.teams.away.shortName)}${format === 'portrait' ? '' : `-${format}`}.png`;
  return name.replace(/-{2,}/g, '-').slice(0, 120);
}

// ------------------------------------------------------------------ assets

export interface PosterAssets {
  crests: Record<string, HTMLImageElement | null>;
  portrait: HTMLImageElement | null;
  notes: string[];
}

function loadImage(url: string, timeout = 7000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // only hosts that allow embedding can be drawn into an export
    img.decoding = 'async';
    const t = setTimeout(() => resolve(null), timeout);
    img.onload = () => (clearTimeout(t), resolve(img.naturalWidth ? img : null));
    img.onerror = () => (clearTimeout(t), resolve(null));
    img.src = url;
  });
}

export async function loadPosterAssets(data: PosterData, opts: PosterOptions): Promise<PosterAssets> {
  const notes: string[] = [];
  const crests: Record<string, HTMLImageElement | null> = {};
  if (opts.crests) {
    for (const tm of data.teams) {
      const e = await cachedImage(`club:${tm.clubId}`);
      crests[tm.clubId] = e?.status === 'ok' && e.url ? await loadImage(e.url) : null;
      if (e?.status === 'ok' && !crests[tm.clubId]) notes.push(`${tm.shortName}’s official badge can’t be embedded in an exported image (its host does not allow it), so the Kurciv crest is used.`);
    }
  }
  let portrait: HTMLImageElement | null = null;
  if (opts.portraits && data.pom) {
    const e = await cachedImage(`player:${data.pom.playerId}`);
    if (e?.status === 'ok' && e.url) {
      portrait = await loadImage(e.url);
      if (!portrait) notes.push(`${data.pom.name}’s photo can’t be embedded in an exported image, so a monogram is used.`);
    }
  }
  return { crests, portrait, notes };
}

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load('700 80px "Fraunces"'),
    document.fonts.load('600 80px "Fraunces"'),
    document.fonts.load('700 80px "Barlow Condensed"'),
    document.fonts.load('600 80px "Barlow Condensed"'),
    document.fonts.load('500 40px "Inter"'),
    document.fonts.load('600 40px "Inter"'),
  ]).catch(() => {});
}

// ------------------------------------------------------------------ drawing primitives

const C = {
  bg: '#101210', graphite: '#191D19', charcoal: '#232722', ivory: '#F1F0E8', sage: '#A6B09F', faint: '#6F776A', lime: '#C5F36B', line: 'rgba(241,240,232,0.10)',
};
const F = { serif: '"Fraunces", Georgia, serif', cond: '"Barlow Condensed", "Arial Narrow", sans-serif', sans: '"Inter", "Segoe UI", system-ui, sans-serif' };
type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, size: number, fam: string, spacing = 0) {
  ctx.font = `${weight} ${size}px ${fam}`;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${spacing}px`;
}

/** Shrinks text to fit `maxW` (down to `min`), then ellipsizes as a last resort. Never clips. */
function fit(ctx: Ctx, text: string, maxW: number, weight: number, size: number, fam: string, min: number, spacing = 0): { text: string; size: number } {
  let s = size;
  setFont(ctx, weight, s, fam, spacing * (s / size));
  while (ctx.measureText(text).width > maxW && s > min) {
    s = Math.max(min, s * 0.94);
    setFont(ctx, weight, s, fam, spacing * (s / size));
  }
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 3) t = `${t.slice(0, -2).trimEnd()}…`;
  return { text: t, size: s };
}

function text(ctx: Ctx, str: string, x: number, y: number, o: { weight?: number; size: number; fam?: string; color?: string; align?: CanvasTextAlign; maxW?: number; min?: number; spacing?: number; baseline?: CanvasTextBaseline; alpha?: number }): number {
  const weight = o.weight ?? 600;
  const fam = o.fam ?? F.sans;
  const r = o.maxW ? fit(ctx, str, o.maxW, weight, o.size, fam, o.min ?? o.size * 0.55, o.spacing ?? 0) : (setFont(ctx, weight, o.size, fam, o.spacing ?? 0), { text: str, size: o.size });
  ctx.fillStyle = o.color ?? C.ivory;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillText(r.text, x, y);
  ctx.globalAlpha = 1;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
  return r.size;
}

/** Word-wraps into at most `lines` lines, shrinking the font until it fits. */
function wrap(ctx: Ctx, str: string, maxW: number, weight: number, size: number, fam: string, lines: number, min: number): { lines: string[]; size: number } {
  let s = size;
  for (;;) {
    setFont(ctx, weight, s, fam);
    const words = str.split(/\s+/);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW || !cur) cur = next;
      else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    if ((out.length <= lines && out.every((l) => ctx.measureText(l).width <= maxW)) || s <= min) return { lines: out.slice(0, lines), size: s };
    s = Math.max(min, s * 0.93);
  }
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** A team colour lightened until it reads clearly on the dark poster background. */
function readable(hex: string): string {
  let n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let i = 0; i < 12 && luminance(`#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`) < 0.28; i++) {
    r = Math.round(r + (255 - r) * 0.18);
    g = Math.round(g + (255 - g) * 0.18);
    b = Math.round(b + (255 - b) * 0.18);
  }
  n = (r << 16) | (g << 8) | b;
  return `#${n.toString(16).padStart(6, '0')}`;
}

function crest(ctx: Ctx, team: PosterTeam, img: HTMLImageElement | null | undefined, cx: number, cy: number, size: number) {
  if (img) {
    const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  // Original Kurciv shield in the club's colours.
  const s = size / 40;
  ctx.save();
  ctx.translate(cx - 20 * s, cy - 20 * s);
  ctx.scale(s, s);
  const p = new Path2D('M20 2.5 35 7v12c0 9.2-6.3 15.8-15 18.5C11.3 34.8 5 28.2 5 19V7l15-4.5Z');
  ctx.fillStyle = team.colors[0];
  ctx.fill(p);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = team.colors[1];
  ctx.stroke(p);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D('M20 6.5 31.5 10v9c0 7.3-4.8 12.6-11.5 14.9V6.5Z'));
  ctx.globalAlpha = 1;
  const letters = team.shortName.slice(0, 4);
  setFont(ctx, 700, letters.length > 3 ? 7.5 : letters.length > 2 ? 9 : 11, F.cond);
  ctx.fillStyle = luminance(team.colors[1]) > 0.06 || luminance(team.colors[0]) < 0.05 ? team.colors[1] : C.ivory;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(letters, 20, 23.5);
  ctx.restore();
}

function portraitOrMonogram(ctx: Ctx, img: HTMLImageElement | null, name: string, x: number, y: number, size: number, accent: string) {
  const r = size * 0.12;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  ctx.clip();
  ctx.fillStyle = C.charcoal;
  ctx.fillRect(x, y, size, size);
  if (img) {
    const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (size - w) / 2, y, w, h); // anchor to the top: faces stay in frame
  } else {
    const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    text(ctx, initials, x + size / 2, y + size * 0.62, { weight: 700, size: size * 0.42, fam: F.serif, color: accent, align: 'center' });
  }
  ctx.restore();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1, size / 120);
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, r);
  ctx.stroke();
}

/** Deterministic film grain, so two exports of the same poster are identical. */
function grain(ctx: Ctx, w: number, h: number) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const t = tile.getContext('2d')!;
  const id = t.createImageData(128, 128);
  let seed = 1234567;
  for (let i = 0; i < id.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 10;
  }
  t.putImageData(id, 0, 0);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, w, h);
}

/** Subtle cricket-pitch markings: the strip with popping and return creases. */
function pitchMotif(ctx: Ctx, cx: number, top: number, bottom: number, width: number, u: number, accent: string, crease = 1.25) {
  ctx.save();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2 * u;
  const half = width / 2;
  ctx.strokeRect(cx - half, top, width, bottom - top);
  for (const y of [top + (bottom - top) * 0.12, bottom - (bottom - top) * 0.12]) {
    ctx.beginPath();
    ctx.moveTo(cx - half * crease, y);
    ctx.lineTo(cx + half * crease, y);
    ctx.stroke();
    for (const x of [cx - half * 0.66, cx + half * 0.66]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 40 * u);
      ctx.lineTo(x, y + 40 * u);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = accent;
  for (const y of [top + (bottom - top) * 0.12 - 18 * u, bottom - (bottom - top) * 0.12 + 6 * u]) {
    for (let i = -1; i <= 1; i++) ctx.fillRect(cx + i * 9 * u - 1.5 * u, y, 3 * u, 12 * u);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ layout

interface Block { h: number; draw: (y: number) => void }

/** Lays blocks top-to-bottom, distributing spare space as equal gaps. */
function stack(blocks: Block[], top: number, bottom: number, minGap: number) {
  const total = blocks.reduce((a, b) => a + b.h, 0);
  const gap = Math.max(minGap, (bottom - top - total) / Math.max(1, blocks.length - 1));
  let y = top;
  for (const b of blocks) {
    b.draw(y);
    y += b.h + gap;
  }
}

export function renderPoster(canvas: HTMLCanvasElement, data: PosterData, assets: PosterAssets, opts: PosterOptions, scale = 1) {
  const { w: W0, h: H0 } = FORMATS[opts.format];
  canvas.width = Math.round(W0 * scale);
  canvas.height = Math.round(H0 * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const W = W0;
  const H = H0;
  const u = Math.min(W, H) / 1080;
  const land = opts.format === 'landscape';
  const winner = data.teams.find((t) => t.winner) ?? null;
  const accent = opts.theme === 'team' && winner ? readable(winner.colors[0]) : C.lime;
  const P = (land ? 84 : 76) * u;

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, '#151815');
  vg.addColorStop(1, '#0c0e0c');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  if (data.tone === 'close') {
    const g = ctx.createRadialGradient(W * (land ? 0.32 : 0.5), H * 0.42, 0, W * (land ? 0.32 : 0.5), H * 0.42, Math.max(W, H) * 0.55);
    g.addColorStop(0, hexA(accent, 0.13));
    g.addColorStop(1, hexA(accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (opts.template === 'editorial') pitchMotif(ctx, W - P / 2, H * 0.1, H * 0.9, 30 * u, u, accent, 1.2);
  if (data.tone === 'dominant' && opts.template !== 'minimal') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 10 * u, H);
  }
  if (data.tone === 'tie') {
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = data.teams[0].colors[0];
    ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = data.teams[1].colors[0];
    ctx.fillRect(W / 2, 0, W / 2, H);
    ctx.globalAlpha = 1;
  }
  grain(ctx, W, H);

  const centered = opts.template !== 'editorial';
  const brand = (x: number, y: number, w: number): Block => ({
    h: 46 * u,
    draw: (yy) => {
      const by = y >= 0 ? y : yy;
      text(ctx, 'KURCIV', x, by + 30 * u, { weight: 700, size: 34 * u, fam: F.cond, spacing: 4 * u });
      setFont(ctx, 700, 34 * u, F.cond, 4 * u);
      const kw = ctx.measureText('KURCIV').width;
      if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
      text(ctx, 'IPL 2027', x + kw + 14 * u, by + 30 * u, { weight: 600, size: 22 * u, fam: F.cond, color: accent, spacing: 5 * u });
      text(ctx, `${data.competition} · ${data.season} · ${data.matchLabel}`.toUpperCase(), x + w, by + 28 * u, { weight: 600, size: 22 * u, fam: F.cond, color: C.sage, align: 'right', maxW: w * 0.58, min: 15 * u, spacing: 3 * u });
      ctx.fillStyle = C.line;
      ctx.fillRect(x, by + 46 * u, w, Math.max(1, 1.5 * u));
    },
  });

  const headline = (x: number, w: number, maxLines: number, size: number): Block => {
    const hw = wrap(ctx, data.headline, w, 700, size * u, F.serif, maxLines, size * u * 0.6);
    const lh = hw.size * 1.08;
    const subSize = 30 * u;
    return {
      h: hw.lines.length * lh + 14 * u,
      draw: (y) => {
        hw.lines.forEach((l, i) => text(ctx, l, centered ? x + w / 2 : x, y + hw.size * 0.9 + i * lh, { weight: 700, size: hw.size, fam: F.serif, align: centered ? 'center' : 'left' }));
        void subSize;
      },
    };
  };

  const teamsBlock = (x: number, w: number, crestSize: number, scoreSize: number): Block => {
    if (opts.template === 'editorial') {
      const rowH = Math.max(crestSize * 0.62, scoreSize * 0.95);
      return {
        h: rowH * 2 + 26 * u,
        draw: (y) => {
          data.teams.forEach((t, i) => {
            const ry = y + i * (rowH + 26 * u);
            if (t.winner) {
              ctx.fillStyle = accent;
              ctx.fillRect(x, ry, 6 * u, rowH);
            }
            const cs = crestSize * 0.6;
            let tx = x + 26 * u;
            if (opts.crests) {
              crest(ctx, t, assets.crests[t.clubId], tx + cs / 2, ry + rowH / 2, cs);
              tx += cs + 24 * u;
            }
            const scoreW = scoreSize * 2.6;
            text(ctx, t.name.toUpperCase(), tx, ry + rowH / 2 + 4 * u, { weight: 700, size: 46 * u, fam: F.cond, color: t.winner ? C.ivory : C.sage, maxW: w - (tx - x) - scoreW - 20 * u, min: 26 * u, spacing: 1 * u });
            if (t.overs) text(ctx, t.overs.toUpperCase(), tx, ry + rowH / 2 + 38 * u, { weight: 600, size: 24 * u, fam: F.cond, color: C.faint, spacing: 2 * u });
            text(ctx, t.score ?? 'DNB', x + w, ry + rowH / 2 + scoreSize * 0.36, { weight: 700, size: scoreSize, fam: F.cond, color: t.winner ? accent : C.ivory, align: 'right', alpha: t.winner ? 1 : 0.8 });
          });
        },
      };
    }
    const colW = (w - 60 * u) / 2;
    const nameSize = (opts.template === 'minimal' ? 34 : 40) * u;
    const blockH = (opts.crests ? crestSize + 26 * u : 0) + nameSize + 16 * u + scoreSize + 44 * u;
    return {
      h: blockH,
      draw: (y) => {
        if (opts.template === 'broadcast') pitchMotif(ctx, x + w / 2, y - 10 * u, y + blockH + 4 * u, 46 * u, u, accent);
        data.teams.forEach((t, i) => {
          const cx = x + colW / 2 + i * (colW + 60 * u);
          let yy = y;
          if (opts.crests) {
            crest(ctx, t, assets.crests[t.clubId], cx, yy + crestSize / 2, crestSize);
            yy += crestSize + 26 * u;
          }
          text(ctx, t.name.toUpperCase(), cx, yy + nameSize * 0.85, { weight: 700, size: nameSize, fam: F.cond, color: t.winner ? C.ivory : C.sage, align: 'center', maxW: colW, min: 22 * u, spacing: 1.5 * u });
          yy += nameSize + 16 * u;
          text(ctx, t.score ?? 'DNB', cx, yy + scoreSize * 0.82, { weight: 700, size: scoreSize, fam: F.cond, color: t.winner ? accent : C.ivory, align: 'center', maxW: colW, min: scoreSize * 0.6, alpha: t.winner || !winner ? 1 : 0.82 });
          yy += scoreSize + 8 * u;
          if (t.overs) text(ctx, t.overs.toUpperCase(), cx, yy + 28 * u, { weight: 600, size: 26 * u, fam: F.cond, color: C.faint, align: 'center', spacing: 3 * u });
        });
        if (opts.template !== 'minimal') text(ctx, 'v', x + w / 2, y + (opts.crests ? crestSize / 2 + 18 * u : nameSize + scoreSize / 2), { weight: 600, size: 44 * u, fam: F.serif, color: C.faint, align: 'center' });
      },
    };
  };

  const resultBlock = (x: number, w: number, size: number): Block => ({
    h: size * 1.6,
    draw: (y) => {
      const s = text(ctx, data.result.toUpperCase(), centered ? x + w / 2 : x, y + size, { weight: 700, size, fam: F.cond, color: accent, align: centered ? 'center' : 'left', maxW: w * (centered ? 0.86 : 1), min: size * 0.55, spacing: 2 * u });
      if (centered && opts.template === 'broadcast') {
        setFont(ctx, 700, s, F.cond, 2 * u * (s / size));
        const tw = Math.min(w * 0.86, ctx.measureText(data.result.toUpperCase()).width);
        if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
        ctx.fillStyle = hexA(accent, 0.5);
        const ly = y + size * 0.68;
        const gap = 24 * u;
        const left = x + w / 2 - tw / 2 - gap;
        const right = x + w / 2 + tw / 2 + gap;
        if (left - x > 30 * u) ctx.fillRect(x, ly, left - x, 2 * u);
        if (x + w - right > 30 * u) ctx.fillRect(right, ly, x + w - right, 2 * u);
      }
    },
  });

  const pomBlock = (x: number, w: number, pic: number, k = 1): Block => {
    if (!data.pom) return { h: 0, draw: () => {} };
    const pom = data.pom;
    const show = opts.portraits;
    return {
      h: Math.max(show ? pic : 0, 150 * u * k),
      draw: (y) => {
        let tx = x;
        if (show) {
          portraitOrMonogram(ctx, assets.portrait, pom.name, x, y, pic, accent);
          tx = x + pic + 34 * u;
        }
        const mw = x + w - tx;
        const base = show ? y + pic / 2 - 62 * u : y + 10 * u;
        text(ctx, 'PLAYER OF THE MATCH', tx, base + 10 * u, { weight: 700, size: 24 * u, fam: F.cond, color: accent, spacing: 4 * u, maxW: mw });
        text(ctx, pom.name, tx, base + 72 * u, { weight: 700, size: 56 * u, fam: F.serif, maxW: mw, min: 30 * u });
        text(ctx, `${pom.line}  ·  ${pom.team}`, tx, base + 122 * u, { weight: 600, size: 34 * u, fam: F.cond, color: C.sage, maxW: mw, min: 22 * u, spacing: 1 * u });
      },
    };
  };

  const highlightsBlock = (x: number, w: number, cols: number, k = 1): Block => {
    const items = data.highlights.slice(0, opts.highlights === 'extended' ? 4 : 2);
    if (!items.length) return { h: 0, draw: () => {} };
    const rows = Math.ceil(items.length / cols);
    const cellH = 112 * u * Math.max(0.82, k);
    return {
      h: rows * cellH + (rows - 1) * 18 * u,
      draw: (y) => {
        const cw = (w - (cols - 1) * 28 * u) / cols;
        items.forEach((it, i) => {
          const cx = x + (i % cols) * (cw + 28 * u);
          const cy = y + Math.floor(i / cols) * (cellH + 18 * u);
          ctx.fillStyle = 'rgba(241,240,232,0.035)';
          ctx.beginPath();
          ctx.roundRect(cx, cy, cw, cellH, 14 * u);
          ctx.fill();
          ctx.fillStyle = it.winner ? accent : C.faint;
          ctx.fillRect(cx, cy + 18 * u, 4 * u, cellH - 36 * u);
          text(ctx, `${it.label} · ${it.team}`.toUpperCase(), cx + 26 * u, cy + 34 * u, { weight: 600, size: 20 * u, fam: F.cond, color: C.sage, spacing: 3 * u, maxW: cw - 40 * u });
          const fig = text(ctx, it.figure, cx + cw - 22 * u, cy + 88 * u, { weight: 700, size: 44 * u, fam: F.cond, color: it.winner ? accent : C.ivory, align: 'right', maxW: cw * 0.45, min: 26 * u });
          setFont(ctx, 700, fig, F.cond);
          const fw = Math.min(cw * 0.45, ctx.measureText(it.figure).width);
          text(ctx, it.name, cx + 26 * u, cy + 84 * u, { weight: 600, size: 32 * u, fam: F.sans, maxW: cw - 70 * u - fw, min: 18 * u });
        });
      },
    };
  };

  const footer = (x: number, w: number): Block => ({
    h: 30 * u,
    draw: (y) => {
      const parts = [opts.showVenue ? data.venue : null, opts.showDate ? data.date : null, data.stage !== 'League' ? data.stage : null].filter(Boolean).join('  ·  ');
      if (parts) text(ctx, parts, x, y + 22 * u, { weight: 500, size: 22 * u, fam: F.sans, color: C.sage, maxW: w * 0.78, min: 15 * u });
      text(ctx, 'kurciv', x + w, y + 22 * u, { weight: 700, size: 22 * u, fam: F.cond, color: C.faint, align: 'right', spacing: 3 * u });
    },
  });

  if (land) {
    const leftW = W * 0.56 - P;
    const rightX = W * 0.6;
    const rightW = W - rightX - P;
    brand(P, P, W - 2 * P).draw(P);
    stack([headline(P, leftW, 2, 76), teamsBlock(P, leftW, 150 * u, 132 * u), resultBlock(P, leftW, 40 * u)], P + 90 * u, H - P - 60 * u, 22 * u);
    ctx.fillStyle = C.line;
    ctx.fillRect(rightX - 36 * u, P + 90 * u, Math.max(1, 1.5 * u), H - 2 * P - 150 * u);
    stack([pomBlock(rightX, rightW, 210 * u), highlightsBlock(rightX, rightW, 1)], P + 100 * u, H - P - 60 * u, 26 * u);
    footer(P, W - 2 * P).draw(H - P - 30 * u);
  } else {
    const w = W - 2 * P;
    const sq = opts.format === 'square';
    const story = opts.format === 'story';
    const minGap = (sq ? 14 : 24) * u;
    const build = (k: number): Block[] => [
      brand(P, -1, w),
      headline(P, w, sq ? 1 : 2, (sq ? 66 : story ? 96 : 84) * Math.max(0.8, k)),
      teamsBlock(P, w, (sq ? 108 : story ? 210 : 160) * u * k, (sq ? 112 : story ? 170 : 140) * u * k),
      resultBlock(P, w, (sq ? 34 : 42) * u * Math.max(0.85, k)),
      pomBlock(P, w, (sq ? 150 : story ? 240 : 190) * u * k, k),
      highlightsBlock(P, w, 2, k),
      footer(P, w),
    ];
    // Shrink the composition until every block fits: nothing is ever clipped.
    let k = 1;
    let blocks = build(k);
    const avail = H - 2 * P;
    for (let i = 0; i < 14 && blocks.reduce((a, b) => a + b.h, 0) + (blocks.length - 1) * minGap > avail; i++) blocks = build((k *= 0.94));
    stack(blocks, P, H - P, minGap);
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Renders at full size and returns a PNG blob; falls back to a smaller scale if memory is tight. */
export async function exportPng(data: PosterData, assets: PosterAssets, opts: PosterOptions, scale = 1): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderPoster(canvas, data, assets, opts, scale);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
