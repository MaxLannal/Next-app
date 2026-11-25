// Focus time from a session's timer events, shared by the hub and the web app so both read a
// session's stretches the same way.

import type { SessionEvent } from './types.ts';

export type Interval = { start: Date; end: Date };

/**
 * Focus intervals: each opens on start/resume and closes on pause/stop. An open one ends at `now`.
 * Stop is final: events after the first stop are ignored.
 */
export function focusIntervals(events: SessionEvent[], now: Date): Interval[] {
  const sorted = events
    .map((e) => ({ type: e.type, at: new Date(e.at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Interval[] = [];
  let open: Date | null = null;
  for (const e of sorted) {
    if (e.type === 'start' || e.type === 'resume') {
      open ??= e.at;
    } else if (open) {
      if (e.at > open) out.push({ start: open, end: e.at });
      open = null;
    }
    if (e.type === 'stop') break;
  }
  if (open && now > open) out.push({ start: open, end: now });
  return out;
}
