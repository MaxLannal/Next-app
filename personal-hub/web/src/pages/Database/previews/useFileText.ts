import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../api.ts';
import { asText } from './languages.ts';

/** Text files past this size are offered as a download instead of rendered. */
export const TEXT_PREVIEW_LIMIT = 512 * 1024;

const cache = new Map<string, string>();

export type FileText = { text: string } | { error: string } | null;

/**
 * Fetches a stored file as text once, then from memory. A `.tex` from one page and
 * the code view of another share the cache, so each file is read once per session.
 * A `.ipynb`'s content type contains `json`, so `api()` parses it; `asText` puts it back.
 */
export function useFileText(url: string, enabled: boolean): FileText {
  const [state, setState] = useState<FileText>(() => (enabled && cache.has(url) ? { text: cache.get(url)! } : null));

  useEffect(() => {
    if (!enabled) return;
    const cached = cache.get(url);
    if (cached !== undefined) {
      setState({ text: cached });
      return;
    }
    let live = true;
    api<unknown>(url, { headers: { accept: 'text/plain' } })
      .then((body) => {
        const text = asText(body);
        cache.set(url, text);
        if (live) setState({ text });
      })
      .catch((err: unknown) => {
        if (live) setState({ error: err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t read this file — retry' });
      });
    return () => {
      live = false;
    };
  }, [url, enabled]);

  return state;
}
