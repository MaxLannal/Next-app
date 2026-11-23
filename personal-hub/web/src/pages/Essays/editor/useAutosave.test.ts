import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave, type SavePayload, type SaveResult } from './useAutosave.ts';

const ID = 7;
const KEY = `hub:essay:${ID}:unsaved`;
const BASE = '2026-11-22T18:00:00.000Z';

const payload = (title: string): SavePayload => ({
  title,
  contentJson: { type: 'doc' },
  plainText: title,
  baseUpdatedAt: BASE,
});

type Reply = { status: number; body: string };
const reply = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
const ok = reply(200, { updatedAt: '2026-11-22T18:00:01.000Z' });

function stubFetch(replies: Reply[]) {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => {
    const next = replies.length > 1 ? replies.shift()! : replies[0]!;
    return new Response(next.body, { status: next.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The hub's PUT, read the way the editor's default one reads it. */
const save = async (init: RequestInit & { json?: unknown }): Promise<SaveResult> => {
  const res = await fetch(`/api/essays/${ID}`, { method: 'PUT', body: JSON.stringify(init.json) });
  const body = (await res.json()) as { updatedAt?: string; current?: never };
  if (res.ok) return { ok: true, updatedAt: body.updatedAt! };
  return { ok: false, status: res.status, current: body.current };
};
const put = (init: SavePayload) => save({ json: init });

const sent = (fetchMock: ReturnType<typeof stubFetch>) => {
  const calls = fetchMock.mock.calls;
  const [path, init] = calls[calls.length - 1] as unknown as [string, { body: string }];
  return { path, body: JSON.parse(init.body) as SavePayload, init };
};

const render = (getPayload = () => payload('Draft')) =>
  renderHook(() => useAutosave(ID, getPayload, { save: put, debounceMs: 800 }));

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces: two notifyChange 300 ms apart make one PUT', async () => {
    const fetchMock = stubFetch([ok]);
    const { result } = render();
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock).path).toBe(`/api/essays/${ID}`);
    expect(result.current.status).toBe('saved');
    expect(result.current.savedAt).toBe('2026-11-22T18:00:01.000Z');
  });

  it('backs up on failure, says retrying, and retries at 2 s', async () => {
    const fetchMock = stubFetch([reply(500, { error: 'Boom' }), ok]);
    const { result } = render();
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(result.current.status).toBe('retrying');
    const backup = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { payload: SavePayload; at: string } | null;
    expect(backup?.payload.title).toBe('Draft');
    expect(typeof backup?.at).toBe('string');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('retries after 5 s, 10 s, then every 30 s', async () => {
    const fetchMock = stubFetch([reply(500, { error: 'Boom' })]);
    const { result } = render();
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.current.status).toBe('retrying');
  });

  it('conflict on 409, and keepMine re-PUTs against the hub’s version', async () => {
    const current = { id: ID, title: 'Theirs', updatedAt: '2026-11-22T18:05:00.000Z' };
    const fetchMock = stubFetch([reply(409, { error: 'Changed elsewhere', current }), ok]);
    const { result } = render();
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(result.current.status).toBe('conflict');
    expect(result.current.conflict?.updatedAt).toBe(current.updatedAt);
    await act(async () => {
      await result.current.keepMine();
    });
    const mine = sent(fetchMock);
    expect(mine.body.baseUpdatedAt).toBe('2026-11-22T18:05:00.000Z');
    expect(mine.body.title).toBe('Draft');
    expect(result.current.status).toBe('saved');
  });

  it('holds a change typed during a 409, and keepMine sends that one', async () => {
    const current = { id: ID, title: 'Theirs', updatedAt: '2026-11-22T18:05:00.000Z' };
    const fetchMock = stubFetch([reply(409, { error: 'Changed elsewhere', current }), ok]);
    let typed = 'Draft one';
    const { result } = render(() => payload(typed));
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(result.current.status).toBe('conflict');
    typed = 'Draft two';
    act(() => result.current.notifyChange());
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(result.current.status).toBe('conflict');
    await act(async () => result.current.keepMine());
    const mine = sent(fetchMock);
    expect(mine.body.title).toBe('Draft two');
    expect(mine.body.baseUpdatedAt).toBe('2026-11-22T18:05:00.000Z');
  });

  it('flushes on blur and on page hide (keepalive), and on route change', async () => {
    const fetchMock = stubFetch([ok, ok, ok]);
    const { result, unmount } = render();
    act(() => result.current.notifyChange());
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => result.current.notifyChange());
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).keepalive).toBe(true);
    act(() => result.current.notifyChange());
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
