import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { DEFAULT_WALLPAPER, useWallpaper, WALLPAPER_KEY } from '../../lib/useWallpaper.ts';
import { messageOf } from './useSettings.ts';

/** The dashboard's wallpaper: the fog photograph, or a photo of one's own, from this Mac or the phone. */
export function Wallpaper() {
  const queryClient = useQueryClient();
  const current = useWallpaper();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = (url: string | null) => queryClient.setQueryData(WALLPAPER_KEY, { url });

  const choose = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      settle((await api<{ url: string | null }>('/api/settings/wallpaper', { method: 'PUT', body: form })).url);
    } catch (err) {
      setError(messageOf(err, 'Couldn’t set that photo — retry'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    setBusy(true);
    try {
      settle((await api<{ url: string | null }>('/api/settings/wallpaper', { method: 'DELETE' })).url);
    } catch (err) {
      setError(messageOf(err, 'Couldn’t put the fog back — retry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Wallpaper" className="settings-section">
      <div className="wallpaper">
        <img className="wallpaper__preview" src={current ?? DEFAULT_WALLPAPER} alt={current === null ? 'The fog photograph' : 'Your wallpaper'} />
        <div className="wallpaper__side">
          <p className="settings-note">
            {current === null ? 'The fog photograph that comes with Next.' : 'Your own photo, behind the dashboard.'}
          </p>
          <div className="wallpaper__acts">
            <label className={busy ? 'btn btn-sm is-busy' : 'btn btn-sm'}>
              {busy ? 'Setting it…' : 'Choose a photo'}
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void choose(file);
                }}
              />
            </label>
            {current !== null && (
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void reset()}>
                Use the fog photograph
              </button>
            )}
          </div>
          {error !== null && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
