// The offline service worker is plain JavaScript in web/public, where Vite copies it
// as-is. It runs here in a small stand-in for a service worker's global scope.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The web project runs in jsdom: resolve files from the working directory (the repo root).
const PUBLIC = join(process.cwd(), 'web/public');
const SW = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
const ORIGIN = 'http://100.64.0.2:4747';

type Req = { url: string; method: string; mode: string };
type Handler = (event: { request: Req; waitUntil: (p: Promise<unknown>) => void; respondWith: (p: Promise<unknown>) => void }) => void;

function worker(fetchImpl: (url: string) => Promise<unknown> = async () => ({ ok: true })) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, unknown>();
  const caches = {
    open: async () => ({
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(u, `saved:${u}`)),
      put: async (req: Req, res: unknown) => store.set(new URL(req.url).pathname, res),
    }),
    match: async (key: string | Req) => store.get(typeof key === 'string' ? key : new URL(key.url).pathname),
    keys: async () => ['hub-offline-v1', 'hub-offline-v0'],
    delete: async (key: string) => store.set(`deleted:${key}`, true),
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  runInNewContext(SW, { self, caches, fetch: fetchImpl, URL, Promise });

  const lifecycle = (name: string) => {
    const waits: Promise<unknown>[] = [];
    handlers[name]({ request: {} as Req, waitUntil: (p) => waits.push(p), respondWith: () => {} });
    return Promise.all(waits);
  };
  /** Runs the fetch handler and answers what it did: the response it served, or nothing. */
  const fetchIt = (request: Req) => {
    let answered: Promise<unknown> | undefined;
    handlers.fetch({ request, waitUntil: () => {}, respondWith: (p) => (answered = p) });
    return answered;
  };
  return { lifecycle, fetchIt, store };
}

const nav: Req = { url: `${ORIGIN}/settings`, method: 'GET', mode: 'navigate' };
const asset = (path: string): Req => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'cors' });

describe('the offline service worker', () => {
  it('caches the offline page and the fog photo on install, and drops old caches', async () => {
    const { lifecycle, store } = worker();
    await lifecycle('install');
    expect(store.get('/offline.html')).toBe('saved:/offline.html');
    expect(store.get('/photos/fog.jpg')).toBe('saved:/photos/fog.jpg');

    await lifecycle('activate');
    expect(store.get('deleted:hub-offline-v0')).toBe(true);
    expect(store.has('deleted:hub-offline-v1')).toBe(false);
  });

  it('serves the offline page when a navigation fails', async () => {
    const { fetchIt, store } = worker(async () => {
      throw new Error('Mac asleep');
    });
    await store.set('/offline.html', 'the offline page');
    expect(await fetchIt(nav)).toBe('the offline page');
  });

  it('leaves a healthy navigation to the network', async () => {
    const page = { ok: true, page: true };
    const { fetchIt } = worker(async () => page);
    expect(await fetchIt(nav)).toBe(page);
  });

  it('never handles /api/*', () => {
    const { fetchIt } = worker();
    for (const path of ['/api/settings', '/api/ping', '/api/ingest/sleep']) {
      expect(fetchIt(asset(path))).toBeUndefined();
    }
  });

  it('saves fonts as they load and serves them when the network is gone', async () => {
    let online = true;
    const { fetchIt } = worker(async () => {
      if (!online) throw new Error('offline');
      return { ok: true, clone: () => ({ font: true }) };
    });
    await fetchIt(asset('/assets/wix-madefor-text-latin-400-normal.woff2'));
    online = false;
    expect(await fetchIt(asset('/assets/wix-madefor-text-latin-400-normal.woff2'))).toEqual({ font: true });
  });

  it('ignores writes', () => {
    const { fetchIt } = worker();
    expect(fetchIt({ ...nav, method: 'POST' })).toBeUndefined();
  });
});

it('ships the offline page beside the worker', () => {
  const html = readFileSync(join(PUBLIC, 'offline.html'), 'utf8');
  expect(html).toContain('Hub unreachable');
  expect(html).toContain('Your Mac is asleep or offline. Open the lid or plug it in, then reload.');
  expect(html).toContain('/photos/fog.jpg');
});
