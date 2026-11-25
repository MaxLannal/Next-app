import { addDays, startOfDay } from 'date-fns';
import { focusIntervals } from '@shared/focusIntervals.ts';
import type { CalendarEvent, FocusSession, Subject } from '@shared/types.ts';

// A day as blocks of time: each stretch of focus (pauses are gaps) and each timed calendar
// event, cut to the day. The Today timeline draws one day of them tall; the review draws a
// range of days as thin bars, with the same blocks in the same places.

/** A fill and the label ink that reads on it. */
export type Swatch = { fill: string; ink: string };

const DARK_INK = '#101420';
const LIGHT_INK = '#ffffff';

/**
 * Subject colours: eight dusk-toned hues in a fixed order, handed out by subject id, so a
 * subject keeps its colour on every day and in every range (never by rank). Validated on the
 * glass's dark surface (#12161e): all inside the dark lightness band, chroma ≥ 0.1, adjacent
 * colour-blind ΔE ≥ 9.2, normal-vision ΔE ≥ 21.3, ≥ 3:1 against the surface. Each carries
 * whichever label ink reads better on it.
 */
export const SUBJECT_SWATCHES: readonly Swatch[] = [
  { fill: '#6e7ed4', ink: DARK_INK }, // periwinkle
  { fill: '#d0792a', ink: DARK_INK }, // amber
  { fill: '#199d78', ink: DARK_INK }, // sea green
  { fill: '#9565c7', ink: DARK_INK }, // violet
  { fill: '#c04637', ink: LIGHT_INK }, // brick
  { fill: '#0094bc', ink: DARK_INK }, // lagoon
  { fill: '#b38c15', ink: DARK_INK }, // ochre
  { fill: '#c04e8a', ink: DARK_INK }, // rose
];

/** Sessions with no subject, and subjects past the eighth: a ninth hue is never invented. */
export const NEUTRAL_SWATCH: Swatch = { fill: '#7d8296', ink: DARK_INK };

/** What a block is, for its colour and its legend row. */
export type Identity = { group: string; name: string; swatch: Swatch };

/** The identity of a session's subject. */
export type Palette = (subject: Subject | null) => Identity;

/**
 * Colours for subjects, by id: the eight oldest subjects take the eight hues in order; any
 * later one is "Other subjects" and a session without one is "No subject", both neutral.
 * Subjects only seen on sessions (not yet in `subjects`) take their place by id too.
 */
export function subjectPalette(subjects: Subject[], sessions: FocusSession[] = []): Palette {
  const byId = new Map<number, Subject>();
  for (const s of subjects) byId.set(s.id, s);
  for (const session of sessions) if (session.subject) byId.set(session.subject.id, session.subject);
  const slot = new Map([...byId.keys()].sort((a, b) => a - b).map((id, i) => [id, i]));

  return (subject) => {
    if (subject === null) return { group: 'subject:none', name: 'No subject', swatch: NEUTRAL_SWATCH };
    const swatch = SUBJECT_SWATCHES[slot.get(subject.id) ?? SUBJECT_SWATCHES.length];
    if (swatch === undefined) return { group: 'subject:other', name: 'Other subjects', swatch: NEUTRAL_SWATCH };
    return { group: `subject:${subject.id}`, name: subject.name, swatch };
  };
}

/** The identity of a calendar: its own colour, as the Calendar app shows it. */
export function calendarIdentity(event: CalendarEvent): Identity {
  return { group: `calendar:${event.calendar}`, name: event.calendar, swatch: { fill: event.color, ink: LIGHT_INK } };
}

export type BlockKind = 'focus' | 'event';

export type DayBlock = {
  key: string;
  kind: BlockKind;
  title: string;
  /** Where the block sits, in ms, cut to the day. */
  start: number;
  end: number;
  /** The whole stretch, in ms, for its label: a block cut at midnight still says when it ran. */
  from: number;
  to: number;
  identity: Identity;
  /** The session a focus block belongs to. */
  sessionId: number | null;
  /** The event an event block shows. */
  event: CalendarEvent | null;
  /** The open session's running stretch, still growing at `now`. */
  live: boolean;
};

/** A block with its place across: lane `lane` of `lanes` side by side where blocks overlap. */
export type PlacedBlock = DayBlock & { lane: number; lanes: number };

/** A local day as `[start, end)` in ms; 23 or 25 hours long across a clock change. */
export function dayBounds(day: Date): { start: number; end: number } {
  const start = startOfDay(day);
  return { start: start.getTime(), end: addDays(start, 1).getTime() };
}

/** How far down the day an instant sits, 0 at midnight to 1 at the next. */
export function dayFraction(ms: number, bounds: { start: number; end: number }): number {
  return Math.min(1, Math.max(0, (ms - bounds.start) / (bounds.end - bounds.start)));
}

/**
 * The day's blocks, earliest first: each stretch of focus of each session (a pause leaves a gap)
 * and each timed event, cut to the day. All-day events stay out; `allDayOn` has them.
 */
export function blocksOn(
  day: Date,
  input: { sessions: FocusSession[]; events: CalendarEvent[]; now: Date; palette: Palette },
): DayBlock[] {
  const { start: dayStart, end: dayEnd } = dayBounds(day);
  const blocks: DayBlock[] = [];
  const add = (block: Omit<DayBlock, 'start' | 'end'>) => {
    const start = Math.max(block.from, dayStart);
    const end = Math.min(block.to, dayEnd);
    if (end > start) blocks.push({ ...block, start, end });
  };

  for (const session of input.sessions) {
    const intervals = focusIntervals(session.events, input.now);
    const open = session.status === 'running' && session.autoPausedAt === null;
    intervals.forEach((interval, i) => {
      add({
        key: `focus-${session.id}-${i}`,
        kind: 'focus',
        title: session.name,
        from: interval.start.getTime(),
        to: interval.end.getTime(),
        identity: input.palette(session.subject),
        sessionId: session.id,
        event: null,
        live: open && i === intervals.length - 1 && interval.end.getTime() === input.now.getTime(),
      });
    });
  }

  for (const event of input.events) {
    if (event.allDay) continue;
    add({
      key: `event-${event.id}-${event.start}`,
      kind: 'event',
      title: event.title || 'Untitled event',
      from: new Date(event.start).getTime(),
      to: new Date(event.end).getTime(),
      identity: calendarIdentity(event),
      sessionId: null,
      event,
      live: false,
    });
  }

  return blocks.sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
}

/** The all-day events that touch a local day, in calendar order. */
export function allDayOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const { start, end } = dayBounds(day);
  return events
    .filter((e) => e.allDay && new Date(e.start).getTime() < end && new Date(e.end).getTime() > start)
    .sort((a, b) => a.calendar.localeCompare(b.calendar) || a.title.localeCompare(b.title));
}

/**
 * Lanes for overlapping blocks, as a calendar's day view lays them out: blocks that overlap
 * (directly or through a chain) share the width in equal lanes, each block in the first lane
 * free at its start. A block on its own takes the whole width. Events go left of focus at a tie.
 */
export function placeBlocks(blocks: DayBlock[]): PlacedBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1),
  );
  const out: PlacedBlock[] = [];
  let cluster: { block: DayBlock; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const { block, lane } of cluster) out.push({ ...block, lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    cluster.push({ block, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return out;
}

/** Seconds of focus among the blocks. */
export function focusSecondsOf(blocks: DayBlock[]): number {
  return Math.round(blocks.filter((b) => b.kind === 'focus').reduce((sum, b) => sum + (b.end - b.start), 0) / 1000);
}

/** How many events the blocks show; an event cut across days counts once. */
export function eventCountOf(blocks: DayBlock[]): number {
  return new Set(blocks.filter((b) => b.kind === 'event').map((b) => b.key)).size;
}

export type GroupTotal = { group: string; name: string; kind: BlockKind; swatch: Swatch; seconds: number };

/** Time per subject and per calendar: focus first, then events, each most first. */
export function totalsByGroup(blocks: DayBlock[]): GroupTotal[] {
  const totals = new Map<string, GroupTotal>();
  for (const b of blocks) {
    const seconds = (b.end - b.start) / 1000;
    const found = totals.get(b.identity.group);
    if (found) found.seconds += seconds;
    else totals.set(b.identity.group, { group: b.identity.group, name: b.identity.name, kind: b.kind, swatch: b.identity.swatch, seconds });
  }
  return [...totals.values()]
    .map((t) => ({ ...t, seconds: Math.round(t.seconds) }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'focus' ? -1 : 1) || b.seconds - a.seconds || a.name.localeCompare(b.name));
}
