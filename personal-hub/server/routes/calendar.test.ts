import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CalendarEvent } from '../../shared/types.ts';
import { UnavailableError } from '../context.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

const FROM = '2026-11-22T06:00:00.000Z';
const TO = '2026-11-23T06:00:00.000Z';
const URL_TODAY = `/api/calendar?from=${FROM}&to=${TO}`;

const lecture: CalendarEvent = {
  id: 'a',
  title: 'STAT 251 lecture',
  start: '2026-11-22T16:30:00.000Z',
  end: '2026-11-22T17:20:00.000Z',
  allDay: false,
  calendar: 'Classes',
  color: '#8e9bf0',
  location: 'Ryerson 251',
  notes: null,
  url: null,
};

let t: TestContext;
let reads: [Date, Date][];
beforeEach(() => {
  t = makeTestContext();
  reads = [];
  t.fakes.mac.calendarEvents = async (from, to) => {
    reads.push([from, to]);
    return { events: [lecture], source: 'eventkit' };
  };
});
afterEach(() => {
  t.cleanup();
});

it('returns the events for a range', async () => {
  const res = await t.req('GET', URL_TODAY);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ events: [lecture], source: 'eventkit' });
  expect(reads).toEqual([[new Date(FROM), new Date(TO)]]);
});

it('caches for five minutes', async () => {
  await t.req('GET', URL_TODAY);
  t.setNow('2026-11-22T18:04:00.000Z');
  const cached = await t.req('GET', URL_TODAY);
  expect(cached.status).toBe(200);
  expect(await cached.json()).toEqual({ events: [lecture], source: 'eventkit' });
  expect(reads).toHaveLength(1);

  t.setNow('2026-11-22T18:06:00.000Z');
  await t.req('GET', URL_TODAY);
  expect(reads).toHaveLength(2);
});

it('caches each range on its own', async () => {
  await t.req('GET', URL_TODAY);
  await t.req('GET', `/api/calendar?from=${TO}&to=2026-11-24T06:00:00.000Z`);

  expect(reads).toHaveLength(2);
});

it('unavailable is 503 with the fix', async () => {
  t.fakes.mac.calendarEvents = async () => {
    throw new UnavailableError('Calendar access not granted');
  };

  const res = await t.req('GET', URL_TODAY);

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: 'Calendar access not granted', fix: 'Run npm run setup in Terminal on the Mac' });
});

it('does not cache a refusal', async () => {
  let granted = false;
  t.fakes.mac.calendarEvents = async () => {
    if (!granted) throw new UnavailableError('Calendar access not granted');
    return { events: [lecture], source: 'eventkit' };
  };

  expect((await t.req('GET', URL_TODAY)).status).toBe(503);
  granted = true;
  expect((await t.req('GET', URL_TODAY)).status).toBe(200);
});

it('rejects a missing or backwards range', async () => {
  expect((await t.req('GET', '/api/calendar')).status).toBe(400);
  expect((await t.req('GET', `/api/calendar?from=${FROM}&to=soon`)).status).toBe(400);
  expect((await t.req('GET', `/api/calendar?from=${TO}&to=${FROM}`)).status).toBe(400);
  expect(reads).toHaveLength(0);
});
