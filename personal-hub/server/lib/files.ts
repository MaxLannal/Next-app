import { extname } from 'node:path';
import type { AttachmentKind } from '../../shared/types.ts';

const KIND_EXTENSIONS: [AttachmentKind, string[]][] = [
  ['image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']],
  ['pdf', ['pdf']],
  ['code', ['py', 'ipynb', 'js', 'ts', 'tsx', 'jsx', 'c', 'cpp', 'h', 'hpp', 'java', 'r', 'm', 'jl', 'go', 'rs', 'sh', 'sql']],
  ['latex', ['tex']],
  ['text', ['md', 'txt', 'csv', 'json', 'yaml', 'yml']],
];
const KIND_BY_EXT = new Map(KIND_EXTENSIONS.flatMap(([kind, exts]) => exts.map((ext) => [ext, kind] as const)));

const OCTET_STREAM = 'application/octet-stream';

// No HTML, SVG or XML type is ever listed, so an upload can't run script on the hub's origin.
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  py: 'text/x-python',
  ipynb: 'application/x-ipynb+json',
  tex: 'application/x-tex',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};
// Other code is text/plain, never a JavaScript type: with nosniff, a <script> tag
// on another site can't run an uploaded .js file.
const CODE_MIME = 'text/plain';
const INLINE_TYPES = new Set([...Object.values(MIME_BY_EXT), CODE_MIME]);

const MAX_NAME_BYTES = 150;
const MAX_KEPT_EXT_BYTES = 16;

const extensionOf = (filename: string) => extname(filename).slice(1).toLowerCase();

export function classifyFile(filename: string): AttachmentKind {
  return KIND_BY_EXT.get(extensionOf(filename)) ?? 'other';
}

/** Code, LaTeX and text files are copied to the GitHub repo; photos and PDFs stay local. */
export function isSyncable(kind: AttachmentKind): boolean {
  return kind === 'code' || kind === 'latex' || kind === 'text';
}

export function mimeFor(filename: string): string {
  const mime = MIME_BY_EXT[extensionOf(filename)];
  if (mime) return mime;
  return classifyFile(filename) === 'code' ? CODE_MIME : OCTET_STREAM;
}

/**
 * How to send a stored file: types from our own list are shown inline (text with
 * `charset=utf-8`); anything else is a download as `application/octet-stream`.
 */
export function servedAs(mime: string): { type: string; inline: boolean } {
  if (!INLINE_TYPES.has(mime)) return { type: OCTET_STREAM, inline: false };
  return { type: mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime, inline: true };
}

/**
 * The last path part, NFC-normalised, keeping only letters, marks, digits and
 * `.-_ ()`, capped at 150 bytes with the extension kept. Falls back to `file`.
 */
export function safeFilename(name: string): string {
  const base = name.normalize('NFC').split(/[/\\]/).pop() ?? '';
  let safe = base.replace(/[^\p{L}\p{M}\p{N}._\- ()]/gu, '').trim();
  if (/^[. ]*$/.test(safe)) return 'file';

  if (Buffer.byteLength(safe) > MAX_NAME_BYTES) {
    const ext = extname(safe);
    const kept = Buffer.byteLength(ext) <= MAX_KEPT_EXT_BYTES ? ext : '';
    const stem = safe.slice(0, safe.length - kept.length);
    safe = truncateBytes(stem, MAX_NAME_BYTES - Buffer.byteLength(kept)) + kept;
  }
  return safe;
}

function truncateBytes(text: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    bytes += Buffer.byteLength(ch);
    if (bytes > maxBytes) break;
    out += ch;
  }
  return out;
}
