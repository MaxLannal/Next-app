import { useState } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { ApiError } from '../api.ts';
import { useCurrentSession, useSessionActions } from '../pages/Dashboard/focus/useSessions.ts';
import { WrapUpSheet } from '../pages/Dashboard/focus/WrapUpSheet.tsx';
import { TimerPill } from './TimerPill.tsx';

/**
 * The nav's timer, on every page: the open session, its clock ticking
 * locally, Pause / Resume / Stop, and the wrap-up sheet right after a Stop.
 */
export function NavTimer() {
  const { session, elapsed } = useCurrentSession();
  const actions = useSessionActions();
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
    } catch {
      setError('Couldn’t stop — retry');
    }
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
        <span className="visually-hidden" role="alert">
          {error}
        </span>
      )}
      {sheet !== null && <WrapUpSheet session={sheet} open onClose={() => setSheet(null)} />}
    </>
  );
}
