import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { DEFAULT_WALLPAPER, useWallpaperBank, WALLPAPER_KEY, type WallpaperState } from '../../lib/useWallpaper.ts';
import { messageOf } from './useSettings.ts';

/**
 * The wallpaper and its photo bank: the fog photograph that comes with Next and the photos kept
 * here, from this Mac or the phone. Tap one to put it behind the dashboard; × takes one out of the
 * bank after a second tap.
 */
export function Wallpaper() {
  const queryClient = useQueryClient();
  const bank = useWallpaperBank();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = bank.data?.current ?? null;
  const photos = bank.data?.photos ?? [];

  const act = async (what: string, request: () => Promise<WallpaperState>, failure: string) => {
    setError(null);
    setBusy(what);
    try {
      queryClient.setQueryData(WALLPAPER_KEY, await request());
    } catch (err) {
      setError(messageOf(err, failure));
    } finally {
      setBusy(null);
    }
  };

  const pick = (file: string | null) =>
    void act('pick', () => api<WallpaperState>('/api/settings/wallpaper', { method: 'PUT', json: { file } }), 'Couldn’t change the wallpaper — retry');

  const add = (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    void act('add', () => api<WallpaperState>('/api/settings/wallpaper/photos', { method: 'POST', body: form }), 'Couldn’t keep those photos — retry');
  };

  const remove = (file: string) => {
    setRemoving(null);
    void act('remove', () => api<WallpaperState>(`/api/settings/wallpaper/photos/${encodeURIComponent(file)}`, { method: 'DELETE' }), 'Couldn’t remove that photo — retry');
  };

  return (
    <Panel title="Wallpaper" className="settings-section">
      <p className="settings-note">Keep photos here and put any of them behind the dashboard. Tap one to switch.</p>
      <ul className="bank" aria-label="Photo bank">
        <li className="bank__item">
          <button className={current === null ? 'bank__photo is-current' : 'bank__photo'} type="button" aria-pressed={current === null} disabled={busy !== null} onClick={() => pick(null)}>
            <img src={DEFAULT_WALLPAPER} alt="" loading="lazy" />
            <span className="bank__caption">The fog photograph</span>
            {current === null && <span className="bank__badge">On the wall</span>}
          </button>
        </li>
        {photos.map((p, i) => (
          <li key={p.file} className="bank__item">
            <button
              className={p.file === current ? 'bank__photo is-current' : 'bank__photo'}
              type="button"
              aria-pressed={p.file === current}
              aria-label={`Photo ${i + 1}${p.file === current ? ', on the wall' : ''}`}
              disabled={busy !== null}
              onClick={() => pick(p.file)}
            >
              <img src={p.thumb} alt="" loading="lazy" />
              {p.file === current && <span className="bank__badge">On the wall</span>}
            </button>
            {removing === p.file ? (
              <button className="bank__remove is-asking" type="button" disabled={busy !== null} onClick={() => remove(p.file)} onBlur={() => setRemoving(null)}>
                Remove?
              </button>
            ) : (
              <button className="bank__remove" type="button" aria-label={`Remove photo ${i + 1} from the bank`} disabled={busy !== null} onClick={() => setRemoving(p.file)}>
                ×
              </button>
            )}
          </li>
        ))}
        <li className="bank__item">
          <label className={busy === 'add' ? 'bank__add is-busy' : 'bank__add'}>
            <span className="bank__plus" aria-hidden="true">
              +
            </span>
            <span>{busy === 'add' ? 'Keeping them…' : 'Add photos'}</span>
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              disabled={busy !== null}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length > 0) add(files);
              }}
            />
          </label>
        </li>
      </ul>
      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
