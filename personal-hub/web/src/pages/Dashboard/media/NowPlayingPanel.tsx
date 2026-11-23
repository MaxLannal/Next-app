import type { MediaStatus, NowPlaying } from '@shared/types.ts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../../api.ts';
import { Panel } from '../../../components/ui/Panel.tsx';
import './NowPlayingPanel.css';

const POLL_MS = 5_000;
const ALLOW_LINE = 'Allow Hub in System Settings → Privacy & Security → Accessibility to control music';

type MediaKey = 'play' | 'next' | 'previous';

/**
 * The experimental now-playing panel. Hidden when the helper isn't built or
 * macOS won't let it post media keys; one line asks for Accessibility when that
 * is the only thing missing. Otherwise previous, play/pause and next, with the
 * track when MediaRemote answers. Re-read every five seconds while it's shown.
 */
export function NowPlayingPanel() {
  const status = useQuery({
    queryKey: ['media', 'status'],
    queryFn: ({ signal }) => api<{ status: MediaStatus }>('/api/media/status', { signal }),
    refetchInterval: POLL_MS,
  });

  // Until the status is known the panel takes no room and asks for nothing else.
  if (status.data?.status === 'missing' || status.data === undefined) return null;
  if (status.data.status === 'no-accessibility') {
    return (
      <Panel title="Now playing">
        <p className="media__allow">{ALLOW_LINE}</p>
      </Panel>
    );
  }
  return <ReadyPanel />;
}

/** Posts a media key; a refusal asks for the grant rather than guessing. */
async function send(key: MediaKey): Promise<string | null> {
  try {
    await api('/api/media/key', { method: 'POST', json: { key } });
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.message : 'Couldn’t reach the hub';
  }
}

/** What the panel shows once the helper is ready; it reads only while mounted, so only while visible. */
function ReadyPanel() {
  const now = useQuery<NowPlaying | null>({
    queryKey: ['media', 'now'],
    queryFn: ({ signal }) => api<NowPlaying | null>('/api/media/now', { signal }),
    refetchInterval: POLL_MS,
  });
  const [error, setError] = useState<string | null>(null);
  const track = now.data ?? null;
  // Pause only when a playing track says so; otherwise the key is a play (or an unknown that plays).
  const playing = track?.playing === true;

  const press = async (key: MediaKey) => {
    const failure = await send(key);
    if (failure) setError(failure);
    else void now.refetch();
  };

  return (
    <Panel title="Now playing">
      {track ? (
        <div className="media__track">
          {track.artwork && <img className="media__art" src={track.artwork} alt="" width={48} height={48} />}
          <div className="media__text">
            <p className="media__title">{track.title}</p>
            <p className="media__artist">{track.artist}</p>
            {track.album && <p className="media__album">{track.album}</p>}
          </div>
        </div>
      ) : (
        <p className="media__quiet">{now.isError ? 'Couldn’t read what’s playing' : 'No track to show'}</p>
      )}

      <div className="media__controls" role="group" aria-label="Playback">
        <button className="btn btn-ghost btn-sm media__key" type="button" aria-label="Previous" onClick={() => void press('previous')}>
          <Icon name="previous" />
        </button>
        <button
          className="btn media__key media__key--main"
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void press('play')}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button className="btn btn-ghost btn-sm media__key" type="button" aria-label="Next" onClick={() => void press('next')}>
          <Icon name="next" />
        </button>
      </div>

      {error && (
        <p className="media__problem" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

function Icon({ name }: { name: 'play' | 'pause' | 'previous' | 'next' }) {
  const paths = {
    play: <path d="M5 3.5v9l8-4.5z" fill="currentColor" stroke="none" />,
    pause: (
      <>
        <path d="M5.5 3.5v9M10.5 3.5v9" />
      </>
    ),
    previous: (
      <>
        <path d="M4 3.5v9" />
        <path d="M12.5 3.5v9L5.5 8z" fill="currentColor" stroke="none" />
      </>
    ),
    next: (
      <>
        <path d="M12 3.5v9" />
        <path d="M3.5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
      </>
    ),
  } as const;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
