import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from './context.ts';
import { noteRefusedUpload } from './routes/sleep.ts';

const SESSION_COOKIE = 'hub_session';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const KEY_LENGTH = 64;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

function scryptAsync(passcode: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passcode, salt, length, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `salt:hash`, both hex, with a 16-byte random salt. */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(passcode, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length === 0) return false;
  const actual = await scryptAsync(passcode, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');
const isIngestPath = (path: string) => path.startsWith('/api/ingest/');

function parseHost(host: string | undefined): URL | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`);
  } catch {
    return null;
  }
}

/**
 * From this Mac, addressed as localhost. Checking the Host header too stops a
 * DNS-rebound page (evil.example resolving to 127.0.0.1) from passing as local.
 */
export function isLoopback(ctx: AppContext, c: Context): boolean {
  const hostname = parseHost(c.req.header('host'))?.hostname ?? '';
  return LOOPBACK_ADDRESSES.has(ctx.remoteAddress(c)) && LOCAL_HOSTNAMES.has(hostname);
}

/** An `Origin` that isn't this host. A missing Origin (curl, the iOS Shortcut) is not cross-site. */
function isCrossSite(c: Context): boolean {
  const origin = c.req.header('origin');
  if (origin === undefined) return false;
  const host = parseHost(c.req.header('host'))?.host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Constant-time comparison that never matches an empty or non-string secret. */
function matchesSecret(given: string | undefined, secret: unknown): boolean {
  if (typeof secret !== 'string' || secret === '' || !given) return false;
  const x = Buffer.from(given);
  const y = Buffer.from(secret);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * For `/api/*`: refuses cross-site writes, then lets loopback through. Other
 * requests need the session cookie; `/api/ingest/*` also accepts
 * `Authorization: Bearer <hubToken>`. Non-API paths are public.
 */
export function authMiddleware(ctx: AppContext): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (!isApiPath(path)) return next();
    if (!SAFE_METHODS.has(c.req.method) && isCrossSite(c)) {
      return c.json({ error: 'Cross-site request refused' }, 403);
    }
    if (path === '/api/auth/login' || isLoopback(ctx, c)) return next();

    const cfg = ctx.config.get();
    if (matchesSecret(getCookie(c, SESSION_COOKIE), cfg.sessionSecret)) return next();
    if (isIngestPath(path)) {
      const bearer = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
      if (matchesSecret(bearer, cfg.hubToken)) return next();
      // The Shortcut never shows the reply: a sleep upload refused here shows in the app instead.
      if (path === '/api/ingest/sleep' && c.req.method === 'POST') {
        noteRefusedUpload(ctx, bearer === undefined ? 'no hub token sent (add the Authorization header from Settings)' : 'the hub token is wrong (copy it again from Settings)');
      }
      return c.json({ error: 'Hub token required' }, 401);
    }
    return c.json({ error: 'login required' }, 401);
  };
}

/** Mounted at `/api/auth`. */
export function authRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  // One user, so one global counter. Attempts are counted before the slow hash,
  // so parallel guesses can't slip past the limit.
  let attempts = 0;
  let lockedUntil = 0;

  routes.post(
    '/login',
    bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }),
    async (c) => {
      const cfg = ctx.config.get();
      if (!cfg.passcodeHash) return c.json({ error: 'Set a passcode on the Mac first' }, 403);

      const now = ctx.now().getTime();
      if (lockedUntil !== 0 && now >= lockedUntil) {
        lockedUntil = 0;
        attempts = 0;
      }
      if (now < lockedUntil) {
        const minutes = Math.ceil((lockedUntil - now) / 60_000);
        return c.json({ error: `Too many attempts — try again in ${minutes} min` }, 429);
      }
      attempts += 1;
      if (attempts >= MAX_FAILURES) lockedUntil = now + LOCKOUT_MS;

      const body: unknown = await c.req.json().catch(() => null);
      const passcode = (body as { passcode?: unknown } | null)?.passcode;
      if (typeof passcode !== 'string' || !(await verifyPasscode(passcode, cfg.passcodeHash))) {
        return c.json({ error: 'Wrong passcode' }, 401);
      }

      attempts = 0;
      lockedUntil = 0;
      setCookie(c, SESSION_COOKIE, cfg.sessionSecret, {
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 31536000,
        path: '/',
      });
      return c.json({ ok: true });
    },
  );

  return routes;
}
