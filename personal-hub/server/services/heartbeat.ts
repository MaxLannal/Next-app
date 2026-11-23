import type { AppContext } from '../context.ts';
import { appendEvent, openSession, recomputeFocus, transaction } from '../repo/sessions.ts';

export type HeartbeatOptions = { intervalMs?: number; gapMs?: number };
export type Heartbeat = { tick(): void; stop(): void };

const LAST_ALIVE = 'last_alive';

function readLastAlive(ctx: AppContext): string | null {
  const row = ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_ALIVE) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeLastAlive(ctx: AppContext, at: string): void {
  ctx.db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(LAST_ALIVE, at);
}

/**
 * Records that the server is alive, and treats a long silence as a sleeping Mac: if `now`
 * is more than `gapMs` past the last tick, the running session is paused at the last tick,
 * so the time the Mac slept never counts as focus. A resumed session clears `auto_paused_at`.
 */
export function startHeartbeat(ctx: AppContext, { intervalMs = 60_000, gapMs = 300_000 }: HeartbeatOptions = {}): Heartbeat {
  function tick(): void {
    const now = ctx.now();
    const last = readLastAlive(ctx);
    if (last !== null && now.getTime() - Date.parse(last) > gapMs) {
      const open = openSession(ctx.db);
      if (open?.status === 'running') {
        const at = new Date(last);
        transaction(ctx.db, () => {
          appendEvent(ctx.db, open.id, 'pause', at);
          ctx.db
            .prepare("UPDATE focus_sessions SET status = 'paused', auto_paused_at = ? WHERE id = ?")
            .run(at.toISOString(), open.id);
          recomputeFocus(ctx.db, open.id, now);
        });
      }
    }
    writeLastAlive(ctx, now.toISOString());
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (intervalMs > 0) {
    timer = setInterval(() => {
      try {
        tick();
      } catch (err) {
        console.error('Heartbeat tick failed', err);
      }
    }, intervalMs);
    timer.unref?.();
  }

  return {
    tick,
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

