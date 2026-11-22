import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('sends a JSON body and returns the parsed reply', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => json({ id: 7 }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const out = await api<{ id: number }>('/api/goals', { method: 'POST', json: { title: 'Finish Ch. 4' } });

    expect(out).toEqual({ id: 7 });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"title":"Finish Ch. 4"}');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiError with the server message and asks for login on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'login required' }, 401)));
    const onLogin = vi.fn();
    window.addEventListener('hub:login-required', onLogin);

    const err = await api('/api/goals').catch((e: unknown) => e);

    window.removeEventListener('hub:login-required', onLogin);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: 'login required', body: { error: 'login required' } });
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('does not ask for login on other errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Not found' }, 404)));
    const onLogin = vi.fn();
    window.addEventListener('hub:login-required', onLogin);

    await expect(api('/api/nothing')).rejects.toMatchObject({ status: 404, message: 'Not found' });

    window.removeEventListener('hub:login-required', onLogin);
    expect(onLogin).not.toHaveBeenCalled();
  });
});
