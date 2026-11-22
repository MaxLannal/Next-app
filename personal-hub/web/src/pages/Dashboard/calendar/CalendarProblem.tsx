import type { ServiceFix } from '@shared/types.ts';
import { ApiError } from '../../../api.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';

/**
 * A failed calendar read. On a 503 it shows the hub's own error and the one
 * step that fixes it; anything else gets the error and a Retry pill.
 */
export function CalendarProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 503) {
    const fix = (error.body as Partial<ServiceFix> | null)?.fix;
    if (typeof fix === 'string') return <EmptyState title={error.message} line={fix} />;
  }
  return (
    <EmptyState
      title="Couldn’t read the calendar"
      line={error instanceof Error ? error.message : 'Something went wrong'}
      action={
        <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>
          Retry
        </button>
      }
    />
  );
}
