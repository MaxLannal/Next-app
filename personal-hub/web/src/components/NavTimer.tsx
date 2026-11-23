import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { ApiError } from '../api.ts';
import { useCurrentSession, useSessionActions } from '../pages/Dashboard/focus/useSessions.ts';
import { WrapUpSheet } from '../pages/Dashboard/focus/WrapUpSheet.tsx';
import { TimerPill } from './TimerPill.tsx';
import './NavTimer.css';

/**
 * The nav's timer, on every page: the open session, its clock ticking
 * locally, Pause / Resume / Stop, and the wrap-up sheet right after a Stop.
 * A failure shows the same calm line the Focus panel shows.
 */
export function NavTimer() {
  const { session, elapsed } = useCurrentSession();
  const actions = useSessionActions();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<FocusSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session === null) return null;

  const run = async (act: () => Promise<FocusSession>) => {
    setError(null);
    try {
      await act();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t reach the hub — retry');
    }
  };

  const stop = async () => {
    setError(null);
    try {
      setSheet(await actions.stop(session.id));
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t stop — retry');
    }
  };

  // Everything a saved file or an edit touches lives under these keys.
  const saved = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['attachments'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  return (
    <>
      <TimerPill
        session={session}
        elapsed={elapsed}
        onPause={() => void run(() => actions.pause(session.id))}
        onResume={() => void run(() => actions.resume(session.id))}
        onStop={() => void stop()}
      />
      {error !== null && (
        <p className="nav-timer__error" role="alert">
          {error}
        </p>
      )}
      {sheet !== null && (
        <WrapUpSheet
          session={sheet}
          open
          onSaved={saved}
          onClose={() => {
            setSheet(null);
            saved();
          }}
        />
      )}
    </>
  );
}
