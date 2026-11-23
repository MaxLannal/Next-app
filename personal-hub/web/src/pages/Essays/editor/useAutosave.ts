import { useCallback, useEffect, useRef, useState } from 'react';

/** What a save sends: the document, its derived text, and the version it was started from. */
export type SavePayload = {
  title: string;
  contentJson: unknown;
  plainText: string;
  baseUpdatedAt: string;
};

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
export type UnsavedBackup = { payload: SavePayload; at: string };

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

function writeBackup(essayId: number, payload: SavePayload): void {
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
  getPayload: () => SavePayload,
  options: AutosaveOptions = {},
): AutosaveState {
  const debounceMs = options.debounceMs ?? 800;

  const [status, setStatusState] = useState<AutosaveStatus>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictVersion | null>(null);

  // Refs: callbacks read these, so a stale render never sends an old base.
  const statusRef = useRef<AutosaveStatus>('saved');
  const base = useRef<string | null>(null);
  const pending = useRef<SavePayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryIndex = useRef(0);
  const inFlight = useRef(false);
  const afterInFlight = useRef<SavePayload | null>(null);
  // A change typed while a 409 was being answered: kept, and sent by `keepMine`.
  const held = useRef<SavePayload | null>(null);
  const getPayloadRef = useRef(getPayload);
  getPayloadRef.current = getPayload;
  const opts = useRef(options);
  opts.current = options;

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

  // Saves run one at a time. A change made during a save follows it.
  const save = useCallback(async (payload: SavePayload, retry?: SavePayload): Promise<void> => {
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
      // A retry re-sends the change that failed as it was, with the version it started from.
      result = await put(retry ?? { ...payload, baseUpdatedAt: base.current ?? payload.baseUpdatedAt });
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
    const hubVersion = result.ok ? result.updatedAt : conflictNow?.updatedAt ?? payload.baseUpdatedAt;
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
    clearTimer();
    const payload = pending.current ?? getPayloadRef.current();
    // Nothing changed since the last save, and nothing failed: there is nothing to send.
    if (pending.current === null && base.current !== null && payload.baseUpdatedAt === base.current) return;
    const retry = pending.current ?? undefined;
    await save(payload, retry);
  }, [save]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const notifyChange = useCallback(() => {
    clearTimer();
    if (statusRef.current === 'conflict') {
      // Not sent over a version that changed elsewhere; keepMine (or reload) decides.
      held.current = getPayloadRef.current();
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
    const mine = held.current ?? pending.current ?? getPayloadRef.current();
    held.current = null;
    const version = conflict?.updatedAt ?? base.current ?? mine.baseUpdatedAt;
    setConflict(null);
    const payload = { ...mine, baseUpdatedAt: version };
    pending.current = payload;
    base.current = version;
    await save(payload, payload);
  }, [conflict, save]);

  useEffect(() => {
    const onBlur = () => void flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const payload = pending.current ?? getPayloadRef.current();
      if (pending.current === null && base.current !== null && payload.baseUpdatedAt === base.current) return;
      clearTimer();
      // The page may be closing: keepalive lets the request finish anyway.
      try {
        void fetch(`/api/essays/${essayId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch {
        writeBackup(essayId, payload);
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      // Route change: what is unsaved goes now.
      void flushRef.current();
    };
  }, [essayId]);

  return { status, savedAt, conflict, flush, notifyChange, keepMine };
}
