import { BlockList, isIP } from 'node:net';
import type { ResourceKind } from '../../shared/types.ts';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['pdf', 'video', 'course', 'link'];

export const COURSE_HOSTS = [
  'coursera.org',
  'edx.org',
  'udemy.com',
  'ocw.mit.edu',
  'khanacademy.org',
  'udacity.com',
  'brilliant.org',
  'deeplearning.ai',
  'course.fast.ai',
  'classcentral.com',
  'open.edu',
];

export type ResourceMeta = { title: string; kind: ResourceKind; domain: string; thumbnail: string | null };

/** The slice of `fetch` this module uses, so tests can pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const USER_AGENT = 'Mozilla/5.0 (Macintosh) PersonalHub/1.0';
const ACCEPT = 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8';
const HTML_LIMIT = 512 * 1024;
const PDF_LIMIT = 1024 * 1024;
const OEMBED_LIMIT = 64 * 1024;
const MAX_REDIRECTS = 5;

/** A pasted value as an http(s) URL, or null for anything else (`javascript:`, `file:`, plain text). */
export function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const hostIs = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

export function detectKind(url: URL, contentType?: string): ResourceKind {
  const host = url.hostname;
  if (url.pathname.toLowerCase().endsWith('.pdf') || contentType?.toLowerCase().includes('application/pdf')) return 'pdf';
  const youTube = hostIs(host, 'youtube.com');
  if ((youTube && url.pathname === '/watch') || hostIs(host, 'youtu.be') || hostIs(host, 'vimeo.com')) return 'video';
  if ((youTube && url.pathname === '/playlist' && url.searchParams.has('list')) || COURSE_HOSTS.some((h) => hostIs(host, h))) {
    return 'course';
  }
  return 'link';
}

// Addresses the hub never fetches from: loopback, private networks, link-local
// (cloud metadata), "this host", and the 100.64/10 range Tailscale peers use.
const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv6');
}

/**
 * `localhost`, or a literal loopback/private IP (IPv4-mapped IPv6 included).
 * Names that merely resolve to such an address are not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const family = isIP(host);
  return family !== 0 && PRIVATE_RANGES.check(host, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The title, kind, domain and thumbnail for a link. YouTube videos and
 * playlists ask oEmbed; PDFs read the Info title from the first 1 MB, else use
 * the filename; pages read up to 512 KB for `og:title`, then `<title>`. On any
 * failure or timeout the title is the URL. Private addresses are never fetched.
 */
export async function fetchMeta(url: string, fetchImpl: FetchLike = fetch, timeoutMs = 8000): Promise<ResourceMeta> {
  const target = parseHttpUrl(url);
  if (!target) return { title: url, kind: 'link', domain: '', thumbnail: null };
  const fallback: ResourceMeta = {
    title: url,
    kind: detectKind(target),
    domain: target.hostname.replace(/^www\./, ''),
    thumbnail: null,
  };
  if (isPrivateHost(target.hostname)) return fallback;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Timed out'));
    }, timeoutMs);
  });
  try {
    const found = await Promise.race([lookup(target, fetchImpl, controller.signal), timeout]);
    return { ...fallback, kind: found.kind, thumbnail: found.thumbnail, title: found.title ?? url };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

type Found = { title: string | null; kind: ResourceKind; thumbnail: string | null };

async function lookup(target: URL, fetchImpl: FetchLike, signal: AbortSignal): Promise<Found> {
  const guess = detectKind(target);
  const youTube = hostIs(target.hostname, 'youtube.com') || hostIs(target.hostname, 'youtu.be');
  if (youTube && guess !== 'link') {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(target.href)}&format=json`;
    const res = await get(oembed, fetchImpl, signal);
    if (!res.ok) return { title: null, kind: guess, thumbnail: null };
    const data = JSON.parse(decode(await readCapped(res, OEMBED_LIMIT))) as { title?: unknown; thumbnail_url?: unknown };
    const thumbnail = parseHttpUrl(data.thumbnail_url)?.href ?? null;
    return { title: typeof data.title === 'string' ? squash(data.title) : null, kind: guess, thumbnail };
  }

  const res = await get(target.href, fetchImpl, signal);
  if (!res.ok) return { title: null, kind: guess, thumbnail: null };
  const contentType = res.headers.get('content-type') ?? '';
  const kind = detectKind(target, contentType);
  if (kind === 'pdf') {
    return { title: pdfTitle(await readCapped(res, PDF_LIMIT)) ?? pdfFilename(target), kind, thumbnail: null };
  }
  if (contentType === '' || /html/i.test(contentType)) {
    return { title: htmlTitle(decode(await readCapped(res, HTML_LIMIT), contentType)), kind, thumbnail: null };
  }
  await res.body?.cancel();
  return { title: null, kind, thumbnail: null };
}

/** GET with redirects followed by hand, so each hop must be http(s) and not a private address. */
async function get(start: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<Response> {
  let url = new URL(start);
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(url.href, {
      headers: { 'user-agent': USER_AGENT, accept: ACCEPT },
      redirect: 'manual',
      signal,
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    const next = parseHttpUrl(new URL(location, url).href);
    if (!next || isPrivateHost(next.hostname) || hop === MAX_REDIRECTS) {
      throw new Error(`Redirect not followed: ${location}`);
    }
    url = next;
  }
}

/** Reads at most `limit` bytes of the body, then stops the download. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

function decode(bytes: Uint8Array, contentType = ''): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** Collapses whitespace and control characters; null when nothing is left. */
function squash(text: string): string | null {
  const out = text.replace(/[\s\u0000-\u001f]+/g, ' ').trim();
  return out === '' ? null : out;
}

// ── HTML ──────────────────────────────────────────────────────────────────

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function htmlTitle(page: string): string | null {
  for (const [tag] of page.matchAll(META_TAG)) {
    const attrs = new Map<string, string>();
    for (const [, name = '', dq, sq, bare] of tag.matchAll(ATTRIBUTE)) attrs.set(name.toLowerCase(), dq ?? sq ?? bare ?? '');
    if ((attrs.get('property') ?? attrs.get('name'))?.toLowerCase() !== 'og:title') continue;
    const title = squash(decodeEntities(attrs.get('content') ?? ''));
    if (title) return title;
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(page)?.[1];
  return title === undefined ? null : squash(decodeEntities(title));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return NAMED_ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : whole;
  });
}

// ── PDF ───────────────────────────────────────────────────────────────────

/**
 * The Title from the Info dictionary: the object the trailer's `/Info n g R`
 * names when it is in reach, else the first `/Title` outside an outline item
 * (outline items carry a `/Parent`). Titles in compressed object streams are
 * out of reach.
 */
function pdfTitle(bytes: Uint8Array): string | null {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

  const info = /\/Info\s+(\d+)\s+(\d+)\s+R\b/.exec(text);
  const infoStart = info ? text.search(new RegExp(`(?:^|\\s)${info[1]}\\s+${info[2]}\\s+obj\\b`)) : -1;
  if (infoStart >= 0) {
    const title = titleIn(text.slice(infoStart, until(text, 'endobj', infoStart)), 0);
    if (title) return title;
  }

  for (const { index } of text.matchAll(/\/Title\b/g)) {
    const object = text.slice(Math.max(text.lastIndexOf(' obj', index), 0), until(text, 'endobj', index));
    if (/\/Parent\b/.test(object)) continue;
    const title = titleIn(text, index);
    if (title) return title;
  }
  return null;
}

/** Where `needle` next occurs after `from`, or the end of the text. */
const until = (text: string, needle: string, from: number) => {
  const at = text.indexOf(needle, from);
  return at < 0 ? text.length : at;
};

/** The string value of the first `/Title` at or after `from`. */
function titleIn(text: string, from: number): string | null {
  const key = text.indexOf('/Title', from);
  if (key < 0) return null;
  let i = key + '/Title'.length;
  while (/\s/.test(text[i] ?? '')) i++;
  const bytes = text[i] === '(' ? pdfLiteral(text, i) : text[i] === '<' && text[i + 1] !== '<' ? pdfHex(text, i) : null;
  return bytes ? squash(pdfText(bytes)) : null;
}

const PDF_ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };

/** A literal string `( … )` starting at `open`: balanced parentheses, backslash escapes, octal codes. */
function pdfLiteral(text: string, open: number): Uint8Array | null {
  const out: number[] = [];
  let depth = 1;
  let i = open + 1;
  while (i < text.length) {
    const c = text[i++] ?? '';
    if (c === '\\') {
      const e = text[i++] ?? '';
      if (e in PDF_ESCAPES) out.push(PDF_ESCAPES[e] ?? 0);
      else if (/[0-7]/.test(e)) {
        let octal = e;
        while (octal.length < 3 && /[0-7]/.test(text[i] ?? '')) octal += text[i++];
        out.push(parseInt(octal, 8) & 0xff);
      } else if (e === '\r') {
        if (text[i] === '\n') i++;
      } else if (e !== '\n') out.push(e.charCodeAt(0));
      continue;
    }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return Uint8Array.from(out);
    out.push(c.charCodeAt(0));
  }
  return null;
}

/** A hex string `< … >` starting at `open`. */
function pdfHex(text: string, open: number): Uint8Array | null {
  const close = text.indexOf('>', open);
  if (close < 0) return null;
  let hex = text.slice(open + 1, close).replace(/\s+/g, '');
  if (!/^[\da-f]*$/i.test(hex)) return null;
  if (hex.length % 2 === 1) hex += '0';
  return Buffer.from(hex, 'hex');
}

/** UTF-16BE or UTF-8 when marked with a byte-order mark, else PDFDocEncoding (close to Latin-1). */
function pdfText(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  return Buffer.from(bytes).toString('latin1');
}

/** The last path segment, decoded, without `.pdf`. */
function pdfFilename(url: URL): string | null {
  const segment = url.pathname.split('/').filter(Boolean).pop();
  if (!segment) return null;
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // A malformed escape: keep the segment as it is.
  }
  return squash(name.replace(/\.pdf$/i, ''));
}
