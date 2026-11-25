import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, FocusSession, SessionEvent, Subject } from '@shared/types.ts';
import {
  allDayOn,
  blocksOn,
  eventCountOf,
  focusSecondsOf,
  NEUTRAL_SWATCH,
  placeBlocks,
  SUBJECT_SWATCHES,
  subjectPalette,
  totalsByGroup,
  type DayBlock,
} from './dayBlocks.ts';

// Days are local; pin them to the hub's zone. 22 November 2026 runs 06:00Z to 06:00Z next day.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const DAY = new Date('2026-11-22T12:00:00-06:00');
const NOW = new Date('2026-11-22T16:00:00-06:00');
const at = (hhmm: string, day = '2026-11-22') => `${day}T${hhmm}:00.000-06:00`;
const ms = (hhmm: string, day = '2026-11-22') => new Date(at(hhmm, day)).getTime();

const maths: Subject = { id: 3, name: 'Mathematics' };
const next: Subject = { id: 1, name: 'Next' };

function session(over: Partial<FocusSession> & { id: number; events: SessionEvent[] }): FocusSession {
  return {
    name: `Session ${over.id}`,
    subject: maths,
    tags: [],
    goalId: null,
    notes: '',
    status: 'done',
    startedAt: over.events[0]!.at,
    endedAt: null,
    focusSeconds: 0,
    autoPausedAt: null,
    attachmentCount: 0,
    ...over,
  };
}

function event(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'start' | 'end'>): CalendarEvent {
  return { title: `Event ${over.id}`, allDay: false, calendar: 'Classes', color: '#e0a060', location: null, notes: null, url: null, ...over };
}

const palette = subjectPalette([next, maths]);

describe('blocksOn', () => {
  it('draws each stretch of focus, leaving a pause as a gap', () => {
    const s = session({
      id: 7,
      events: [
        { type: 'start', at: at('09:00') },
        { type: 'pause', at: at('09:40') },
        { type: 'resume', at: at('10:00') },
        { type: 'stop', at: at('10:30') },
      ],
    });
    const blocks = blocksOn(DAY, { sessions: [s], events: [], now: NOW, palette });
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [ms('09:00'), ms('09:40')],
      [ms('10:00'), ms('10:30')],
    ]);
    expect(blocks.every((b) => b.kind === 'focus' && b.sessionId === 7 && !b.live)).toBe(true);
    expect(focusSecondsOf(blocks)).toBe(70 * 60);
  });

  it('grows the running session up to now', () => {
    const s = session({ id: 8, status: 'running', events: [{ type: 'start', at: at('15:00') }] });
    const [block] = blocksOn(DAY, { sessions: [s], events: [], now: NOW, palette });
    expect(block).toMatchObject({ start: ms('15:00'), end: NOW.getTime(), live: true });
  });

  it('cuts a session and an event at midnight but keeps their whole span for the label', () => {
    const late = session({ id: 9, events: [{ type: 'start', at: at('23:00', '2026-11-21') }, { type: 'stop', at: at('01:00') }] });
    const party = event({ id: 'p', start: at('22:00'), end: at('02:00', '2026-11-23') });
    const blocks = blocksOn(DAY, { sessions: [late], events: [party], now: NOW, palette });
    expect(blocks.map((b) => [b.kind, b.start, b.end, b.from, b.to])).toEqual([
      ['focus', ms('00:00'), ms('01:00'), ms('23:00', '2026-11-21'), ms('01:00')],
      ['event', ms('22:00'), ms('00:00', '2026-11-23'), ms('22:00'), ms('02:00', '2026-11-23')],
    ]);
  });

  it('leaves all-day events and other days out', () => {
    const allDay = event({ id: 'a', allDay: true, start: '2026-11-22T06:00:00.000Z', end: '2026-11-23T06:00:00.000Z' });
    const tomorrow = event({ id: 't', start: at('10:00', '2026-11-23'), end: at('11:00', '2026-11-23') });
    expect(blocksOn(DAY, { sessions: [], events: [allDay, tomorrow], now: NOW, palette })).toEqual([]);
    expect(allDayOn([allDay, tomorrow], DAY)).toEqual([allDay]);
  });

  it('colours events by their calendar and counts each once', () => {
    const lecture = event({ id: 'l', start: at('10:30'), end: at('11:20'), calendar: 'Classes', color: '#e0a060' });
    const blocks = blocksOn(DAY, { sessions: [], events: [lecture], now: NOW, palette });
    expect(blocks[0]?.identity).toMatchObject({ group: 'calendar:Classes', name: 'Classes', swatch: { fill: '#e0a060' } });
    expect(eventCountOf(blocks)).toBe(1);
  });
});

describe('subjectPalette', () => {
  it('gives subjects their hue by id, whatever order they arrive in', () => {
    const a = subjectPalette([maths, next]);
    const b = subjectPalette([next, maths]);
    expect(a(next).swatch).toEqual(SUBJECT_SWATCHES[0]);
    expect(a(maths).swatch).toEqual(SUBJECT_SWATCHES[1]);
    expect(b(maths)).toEqual(a(maths));
  });

  it('folds subjects past the eighth into Other, and no subject into its own neutral row', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `S${i + 1}` }));
    const p = subjectPalette(many);
    expect(p(many[7]!).swatch).toEqual(SUBJECT_SWATCHES[7]);
    expect(p(many[8]!)).toEqual({ group: 'subject:other', name: 'Other subjects', swatch: NEUTRAL_SWATCH });
    expect(p(null)).toEqual({ group: 'subject:none', name: 'No subject', swatch: NEUTRAL_SWATCH });
  });

  it('places a subject only seen on a session by its id', () => {
    const fresh: Subject = { id: 2, name: 'Quarterly' };
    const p = subjectPalette([next, maths], [session({ id: 1, subject: fresh, events: [{ type: 'start', at: at('09:00') }] })]);
    expect(p(fresh).swatch).toEqual(SUBJECT_SWATCHES[1]);
    expect(p(maths).swatch).toEqual(SUBJECT_SWATCHES[2]);
  });
});

const block = (key: string, start: string, end: string, kind: DayBlock['kind'] = 'focus'): DayBlock => ({
  key,
  kind,
  title: key,
  start: ms(start),
  end: ms(end),
  from: ms(start),
  to: ms(end),
  identity: { group: key, name: key, swatch: NEUTRAL_SWATCH },
  sessionId: null,
  event: null,
  live: false,
});

describe('placeBlocks', () => {
  it('gives a block on its own the whole width', () => {
    const placed = placeBlocks([block('a', '09:00', '10:00'), block('b', '10:00', '11:00')]);
    expect(placed.map((p) => [p.key, p.lane, p.lanes])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('shares the width among a chain of overlaps, reusing a lane once it frees', () => {
    const placed = placeBlocks([block('a', '09:00', '10:00'), block('b', '09:30', '11:00'), block('c', '10:00', '10:30')]);
    expect(placed.map((p) => [p.key, p.lane, p.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
    ]);
  });

  it('puts the event left of the focus at a tie', () => {
    const placed = placeBlocks([block('f', '09:00', '10:00'), block('e', '09:00', '10:00', 'event')]);
    expect(placed.map((p) => [p.key, p.lane])).toEqual([
      ['e', 0],
      ['f', 1],
    ]);
  });
});

it('totals time per subject and per calendar, focus first', () => {
  const s = session({ id: 1, subject: next, events: [{ type: 'start', at: at('09:00') }, { type: 'stop', at: at('10:00') }] });
  const t = session({ id: 2, subject: maths, events: [{ type: 'start', at: at('11:00') }, { type: 'stop', at: at('13:00') }] });
  const lecture = event({ id: 'l', start: at('14:00'), end: at('17:00') });
  const totals = totalsByGroup(blocksOn(DAY, { sessions: [s, t], events: [lecture], now: NOW, palette }));
  expect(totals.map((g) => [g.name, g.kind, g.seconds])).toEqual([
    ['Mathematics', 'focus', 7200],
    ['Next', 'focus', 3600],
    ['Classes', 'event', 10800],
  ]);
});
