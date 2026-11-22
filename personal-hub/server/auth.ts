import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from './context.ts';

const SESSION_COOKIE = 'hub_session';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const KEY_LENGTH = 64;

/** `salt:hash`, both hex, with a 16-byte random salt. */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(passcode, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');
const isIngestPath = (path: string) => path.startsWith('/api/ingest/');

export const isLoopback = (ctx: AppContext, c: Context) => LOOPBACK.has(ctx.remoteAddress(c));

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Loopback requests and non-API paths pass. Other API requests need the session
 * cookie; `/api/ingest/*` also accepts `Authorization: Bearer <hubToken>`.
 */
export function authMiddleware(ctx: AppContext): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (!isApiPath(path) || path === '/api/auth/login' || isLoopback(ctx, c)) return next();

    const cfg = ctx.config.get();
    if (safeEqual(getCookie(c, SESSION_COOKIE) ?? '', cfg.sessionSecret)) return next();
    if (isIngestPath(path)) {
      if (safeEqual(c.req.header('authorization') ?? '', `Bearer ${cfg.hubToken}`)) return next();
      return c.json({ error: 'Hub token required' }, 401);
    }
    return c.json({ error: 'login required' }, 401);
  };
}

/** Mounted at `/api/auth`. */
export function authRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.post('/login', async (c) => {
    const cfg = ctx.config.get();
    if (!cfg.passcodeHash) return c.json({ error: 'Set a passcode on the Mac first' }, 403);

    const body: unknown = await c.req.json().catch(() => null);
    const passcode = (body as { passcode?: unknown } | null)?.passcode;
    if (typeof passcode !== 'string' || !verifyPasscode(passcode, cfg.passcodeHash)) {
      return c.json({ error: 'Wrong passcode' }, 401);
    }

    setCookie(c, SESSION_COOKIE, cfg.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 31536000,
      path: '/',
    });
    return c.json({ ok: true });
  });

  return routes;
}
