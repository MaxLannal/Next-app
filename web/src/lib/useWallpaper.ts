import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api.ts';

export const WALLPAPER_KEY = ['wallpaper'];
/** The photograph that comes with Next. */
export const DEFAULT_WALLPAPER = '/photos/fog.jpg';
const REMEMBERED = 'hub:wallpaper';

const remembered = (): string | null => {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
};

/** A photo in the bank: its stored name, its address, and a small one for the grid. */
export type BankPhoto = { file: string; url: string; thumb: string };
/** The wallpaper (null: the fog photograph) and the photos kept to switch between. */
export type WallpaperState = { url: string | null; current: string | null; photos: BankPhoto[] };

export const wallpaperQuery = {
  queryKey: WALLPAPER_KEY,
  queryFn: ({ signal }: { signal: AbortSignal }) => api<WallpaperState>('/api/settings/wallpaper', { signal }),
  staleTime: 5 * 60_000,
};

/** The photo bank, for Settings. */
export const useWallpaperBank = () => useQuery(wallpaperQuery);

/**
 * The wallpaper chosen in Settings, or null for the fog photograph. It is remembered in this
 * browser, so the dashboard opens on it straight away instead of flashing the fog first.
 */
export function useWallpaper(): string | null {
  const query = useQuery(wallpaperQuery);
  useEffect(() => {
    if (query.data === undefined) return;
    try {
      if (query.data.url === null) localStorage.removeItem(REMEMBERED);
      else localStorage.setItem(REMEMBERED, query.data.url);
    } catch {
      // Private browsing: nothing to remember it in.
    }
  }, [query.data]);
  return query.data === undefined ? remembered() : query.data.url;
}
