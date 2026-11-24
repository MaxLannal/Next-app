import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What a save sends: the document, its derived text, and the version it was
 * started from. `getPayload` leaves `baseUpdatedAt` out — the hook owns the base,
 * so every save starts from the hub's newest version — and a backup keeps it.
 */
export type EssayPayload = {
  title: string;
  contentJson: unknown;
  plainText: string;
};
export type SavePayload = EssayPayload & { baseUpdatedAt: string };

/**
 * A save's outcome: the hub's new version, or the status it answered with.
 * `current` is the essay as the hub holds it, when a 409 refused the save.
 */
export type SaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; status: number; current?: ConflictVersion | null };

/** The essay as the hub holds it now, handed over with a 409. */
export type ConflictVersion = { id: number; title: string; updatedAt: string };

export type AutosaveOptions = {
  /** The hub's PUT, injected so tests read the timings. Defaults to writing over fetch. */
  save?: (payload: SavePayload) => Promise<SaveResult>;
  debounceMs?: number;
  /** How to read the hub's current version after a 409 that came without it. */
  readConflict?: () => Promise<ConflictVersion | null>;
};

export type AutosaveStatus = 'saved' | 'saving' | 'retrying' | 'conflict';

export type AutosaveState = {
  status: AutosaveStatus;
  /** The hub's `updatedAt` from the last good save. */
  savedAt: string | null;
  /** The hub's version, when a save was refused with 409. */
  conflict: ConflictVersion | null;
  flush: () => Promise<void>;
  notifyChange: () => void;
  /** After a 409: send mine again, based on the hub's newest version. */
  keepMine: () => Promise<void>;
};

/** A failed save waits for these, then every 30 s. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export const backupKey = (essayId: number) => `hub:essay:${essayId}:unsaved`;

/** When the backup was written, or null if there is none worth offering. */
export function backupTime(essayId: number): string | null {
  return readBackup(essayId)?.at ?? null;
}

/** A document kept after a failed save. */
export type UnsavedBackup = { payload: EssayPayload; at: string };

/** The backup for this essay, if one was written and is shaped as it should be. */
export function readBackup(essayId: number): UnsavedBackup | null {
  try {
    const raw = localStorage.getItem(backupKey(essayId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<UnsavedBackup> | null;
    const payload = parsed?.payload;
    if (typeof payload !== 'object' || payload === null || typeof parsed?.at !== 'string') return null;
    return { payload, at: parsed.at };
  } catch {
    return null;
  }
}

export function clearBackup(essayId: number): void {
  try {
    localStorage.removeItem(backupKey(essayId));
  } catch {
    // A private window may refuse storage; there is nothing to clear then.
  }
}

function writeBackup(essayId: number, payload: EssayPayload): void {
  try {
    localStorage.setItem(backupKey(essayId), JSON.stringify({ payload, at: new Date().toISOString() }));
  } catch {
    // Storage is full or refused; the retry queue still holds the document.
  }
}

/** The hub's PUT for one essay. A 409 carries the essay as the hub now holds it. */
async function putEssay(essayId: number, payload: SavePayload): Promise<SaveResult> {
  try {
    const res = await fetch(`/api/essays/${essayId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, updatedAt: ((await res.json()) as { updatedAt: string }).updatedAt };
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { current?: ConflictVersion } | null;
      return { ok: false, status: 409, current: body?.current ?? null };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Reads the hub's essay when a 409 comes without its `current`. */
async function fetchEssay(essayId: number): Promise<ConflictVersion | null> {
  try {
    const res = await fetch(`/api/essays/${essayId}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { id: number; title: string; updatedAt: string };
    return { id: body.id, title: body.title, updatedAt: body.updatedAt };
  } catch {
    return null;
  }
}

/**
 * Saves an essay 800 ms after typing stops, on blur, when the page hides, when the
 * route changes, and with `keepalive` on pagehide. A failed save is kept in
 * localStorage and retried at 2, 5 and 10 s, then every 30 s. A 409 means the essay
 * changed elsewhere: `conflict` holds the hub's version, and `keepMine` saves over it.
 */
export function useAutosave(
  essayId: number,
  getPayload: () => EssayPayload,
  options: AutosaveOptions = {},
): AutosaveState {
  const debounceMs = options.debounceMs ?? 800;

  const [status, setStatusState] = useState<AutosaveStatus>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictVersion | null>(null);

  // Refs: callbacks read these, so a stale render never sends an old base.
  const statusRef = useRef<AutosaveStatus>('saved');
  const base = useRef<string | null>(null);
  const pending = useRef<EssayPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryIndex = useRef(0);
  const inFlight = useRef(false);
  const afterInFlight = useRef<EssayPayload | null>(null);
  // A change typed while a 409 was being answered: kept, and sent by `keepMine`.
  const held = useRef<EssayPayload | null>(null);
  const getPayloadRef = useRef(getPayload);
  getPayloadRef.current = getPayload;
  const opts = useRef(options);
  opts.current = options;

  // The version this editor started from: a fresh `getPayload()` carries it once.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const first = getPayload() as Partial<SavePayload>;
    if (typeof first.baseUpdatedAt === 'string') base.current = first.baseUpdatedAt;
  }

  const setStatus = (next: AutosaveStatus) => {
    statusRef.current = next;
    setStatusState(next);
  };

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const baseOf = (p: EssayPayload) => base.current ?? (p as Partial<SavePayload>).baseUpdatedAt ?? '';

  // Saves run one at a time. A change made during a save follows it.
  const save = useCallback(async (payload: EssayPayload, retry?: EssayPayload): Promise<void> => {
    if (inFlight.current) {
      // A change during a 409 is held until keepMine; other saves queue it behind this one.
      if (statusRef.current === 'conflict') held.current = payload;
      else afterInFlight.current = payload;
      return;
    }
    inFlight.current = true;
    setStatus('saving');
    const put = opts.current.save ?? ((p: SavePayload) => putEssay(essayId, p));
    let result: SaveResult;
    try {
      // The base is the hub's newest version: a retry re-sends the same document over it.
      result = await put({ ...(retry ?? payload), baseUpdatedAt: baseOf(payload) });
    } catch {
      result = { ok: false, status: 0 };
    }
    inFlight.current = false;

    let conflictNow: ConflictVersion | null = null;
    if (result.ok) {
      base.current = result.updatedAt;
      retryIndex.current = 0;
      if (pending.current === payload) pending.current = null;
      if (afterInFlight.current === payload) afterInFlight.current = null;
      clearBackup(essayId);
      setSavedAt(result.updatedAt);
      setStatus('saved');
    } else if (result.status === 409) {
      clearTimer();
      pending.current = payload;
      // Refused, not lost: the text stays on this device until it is saved or let go.
      writeBackup(essayId, payload);
      // The hub's PUT answers the essay as `current`; the bar offers reload or keep mine.
      const read = opts.current.readConflict ?? (() => fetchEssay(essayId));
      conflictNow = result.current ?? (await read());
      setConflict(conflictNow);
      setStatus('conflict');
    } else {
      // Retries keep pending.current, which the retry path re-sends as it was.
      if (pending.current === null) pending.current = payload;
      writeBackup(essayId, pending.current);
      setStatus('retrying');
      const delay = RETRY_DELAYS_MS[Math.min(retryIndex.current, RETRY_DELAYS_MS.length - 1)]!;
      retryIndex.current += 1;
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        const failed = pending.current;
        if (failed !== null) void save(failed, failed);
      }, delay);
    }
    // The version the next save starts from: the hub's own, as its PUT answered it.
    const hubVersion = result.ok ? result.updatedAt : conflictNow?.updatedAt ?? base.current ?? baseOf(payload);
    base.current = hubVersion;

    const next = afterInFlight.current;
    afterInFlight.current = null;
    if (next !== null && next !== payload) {
      if (conflictNow === null) {
        // A change made during the save follows it; its own base is the newest version.
        void save(next);
      } else {
        // Mine is not sent over a version that changed elsewhere until the person says so.
        held.current = next;
      }
    }
  }, [essayId]);

  /** Saves what is pending now — the last change or the one that failed — without waiting. */
  const flush = useCallback(async (): Promise<void> => {
    const debouncing = timer.current !== null;
    clearTimer();
    // Nothing typed, and no save waiting or failed: a blur or a tab switch has nothing to send.
    if (pending.current === null && !debouncing) return;
    const payload = pending.current ?? getPayloadRef.current();
    await save(payload, pending.current ?? undefined);
  }, [save]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const notifyChange = useCallback(() => {
    clearTimer();
    if (statusRef.current === 'conflict') {
      // Not sent over a version that changed elsewhere; keepMine (or reload) decides.
      held.current = getPayloadRef.current();
      writeBackup(essayId, held.current);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      const payload = getPayloadRef.current();
      pending.current = payload;
      void save(payload);
    }, debounceMs);
  }, [debounceMs, save]);

  const keepMine = useCallback(async (): Promise<void> => {
    if (timer.current !== null) clearTimer();
    const mine = held.current ?? pending.current ?? getPayloadRef.current();
    held.current = null;
    const version = conflict?.updatedAt ?? base.current ?? baseOf(mine);
    setConflict(null);
    const payload = { ...mine, baseUpdatedAt: version };
    pending.current = payload;
    base.current = version;
    await save(payload, payload);
  }, [conflict, save]);

  useEffect(() => {
    const onBlur = () => void flushRef.current();
    // A tab switch is not a close: save the ordinary way, through the hook.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushRef.current();
    };
    // The page is going: one keepalive request, which the browser finishes anyway.
    const onPageHide = () => {
      const payload = pending.current ?? getPayloadRef.current();
      // Nothing typed is being dropped; and this fires once per unload.
      clearTimer();
      try {
        void fetch(`/api/essays/${essayId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ ...payload, baseUpdatedAt: baseOf(payload) }),
          keepalive: true,
        });
      } catch {
        writeBackup(essayId, payload);
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Route change: what is unsaved goes now.
      void flushRef.current();
    };
  }, [essayId]);

  return { status, savedAt, conflict, flush, notifyChange, keepMine };
}
