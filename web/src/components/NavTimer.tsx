import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { ApiError } from '../api.ts';
import { refreshFocusData, useCurrentSession, useSessionActions } from '../pages/Dashboard/focus/useSessions.ts';
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

  // Everything a saved file or an edit touches lives under these keys.
  const saved = () => {
    void refreshFocusData(queryClient);
    void queryClient.invalidateQueries({ queryKey: ['attachments'] });
  };

  const run = async (act: () => Promise<FocusSession>) => {
    setError(null);
    try {
      await act();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t reach the hub — retry');
    }
  };

  const stop = async (id: number) => {
    setError(null);
    try {
      setSheet(await actions.stop(id));
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Couldn’t stop — retry');
    }
  };

  // The session is over by the time Stop answers, so the wrap-up outlives the pill; it keeps its
  // place in the tree either way, so nothing typed into it is lost when the pill goes.
  return (
    <>
      {session !== null && (
        <TimerPill
          session={session}
          elapsed={elapsed}
          onPause={() => void run(() => actions.pause(session.id))}
          onResume={() => void run(() => actions.resume(session.id))}
          onStop={() => void stop(session.id)}
        />
      )}
      {session !== null && error !== null && (
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
