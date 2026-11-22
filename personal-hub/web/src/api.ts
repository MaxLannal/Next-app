import { QueryClient } from '@tanstack/react-query';

/** Fired on `window` when the hub answers 401; `LoginGate` shows the passcode form. */
export const LOGIN_REQUIRED_EVENT = 'hub:login-required';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export type ApiInit = RequestInit & { json?: unknown };

/**
 * Calls the hub. `json` is sent as a JSON body. Resolves with the parsed reply,
 * or throws `ApiError` (status 0 when the hub can't be reached).
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    rest.body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers });
  } catch (err) {
    if (rest.signal?.aborted) throw err;
    throw new ApiError(0, 'Couldn’t reach the hub', null);
  }

  const body = await readBody(res);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(LOGIN_REQUIRED_EVENT));
    throw new ApiError(res.status, errorMessage(body, res), body);
  }
  return body as T;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  if (!(res.headers.get('content-type') ?? '').includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, res: Response): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === 'string' && error !== '') return error;
  return `The hub answered ${res.status}`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx won't change on retry; a dropped connection might.
      retry: (failures, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failures < 2,
    },
  },
});
