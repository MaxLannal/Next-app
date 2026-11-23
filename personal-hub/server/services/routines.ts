import type { AppContext } from '../context.ts';
import { backupLive } from './backup.ts';

export const BACKUP_EVERY_MS = 24 * 60 * 60_000;

/** Timers and the caffeinate child, so tests can put them down. */
export type Routines = { stop(): void };

/**
 * What the hub does without being asked: keeps the Mac awake when Settings says
 * to, and backs the database up once at boot and then every 24 hours. A failed
 * backup is logged and left for the next day, never fatal to the hub.
 */
export function startRoutines(
  ctx: AppContext,
  log: (message: string) => void = (message) => console.error(message),
): Routines {
  const mac = ctx.mac;
  if (ctx.config.get().keepAwake) {
    try {
      mac.keepAwake(true);
    } catch (err) {
      log(`Keep-awake didn't start: ${(err as Error).message}`);
    }
  }

  const backup = () => {
    try {
      backupLive(ctx);
    } catch (err) {
      log(`Backup failed: ${(err as Error).message}`);
    }
  };
  backup();
  const timer = setInterval(backup, BACKUP_EVERY_MS);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
      try {
        mac.keepAwake(false);
      } catch {
        // The hub is going down anyway; caffeinate ends with it.
      }
    },
  };
}
