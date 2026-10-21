/** Career backup files: gzip-compressed JSON (.kurciv) when the browser supports it, else plain .json. */

export const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

export async function downloadPackage(pkg: unknown, baseName: string): Promise<string> {
  const json = JSON.stringify(pkg);
  let blob: Blob;
  let ext: string;
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([json], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
    blob = await new Response(stream).blob();
    ext = 'kurciv';
  } else {
    blob = new Blob([json], { type: 'application/json' });
    ext = 'json';
  }
  const name = `${baseName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'career'}.${ext}`;
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/**
 * Reads a backup file as data only — it is parsed as JSON and validated by the engine, never
 * executed. Returns a friendly error instead of throwing.
 */
export async function readPackageFile(file: File): Promise<{ pkg: unknown; error?: undefined } | { pkg?: undefined; error: string }> {
  if (file.size > MAX_IMPORT_BYTES) return { error: `That file is ${(file.size / 1048576).toFixed(0)} MB — larger than any Kurciv career should be.` };
  if (file.size === 0) return { error: 'That file is empty.' };
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    let text: string;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') return { error: 'This browser cannot open compressed backups. Try a current version of Chrome, Edge, Firefox or Safari.' };
      text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else text = await file.text();
    if (text.length > MAX_IMPORT_BYTES) return { error: 'The backup is too large once decompressed.' };
    return { pkg: JSON.parse(text) };
  } catch {
    return { error: 'That file could not be read. It may be damaged, or it is not a Kurciv career backup.' };
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}
