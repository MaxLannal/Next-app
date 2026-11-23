import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const JXA = fileURLToPath(new URL('./calendar-jxa.js', import.meta.url));
const FROM = '2026-11-22T06:00:00.000Z';
const TO = '2026-11-23T06:00:00.000Z';

/** One event, as the Calendar app's Apple Events answer a whose() query. */
const found = {
  uid: () => ['u1'],
  summary: () => ['STAT 251 lecture'],
  startDate: () => [new Date('2026-11-22T16:30:00Z')],
  endDate: () => [new Date('2026-11-22T17:20:00Z')],
  alldayEvent: () => [false],
  location: () => [''],
  description: () => [''],
  url: () => [''],
};

/** A Calendar app with two calendars; "Broken" throws with an error that quotes event text. */
const Calendar = {
  calendars: () => [
    {
      name: () => 'Broken',
      color: () => [0, 0, 0],
      events: {
        whose: () => {
          throw new Error('AppleEvent timed out: Office hours, "Bring the pie"');
        },
      },
    },
    { name: () => 'Classes', color: () => [0x8e, 0x9b, 0xf0], events: { whose: () => found } },
  ],
};

/** Runs calendar-jxa.js' run(argv) over a scripted Calendar app; returns what it printed and returned. */
function runIt(): { printed: string; result: string } {
  const lines: string[] = [];
  const context = vm.createContext({ Application: () => Calendar, console: { log: (s: string) => lines.push(s) }, Date, JSON, isNaN });
  vm.runInContext(readFileSync(JXA, 'utf8'), context);
  const result = vm.runInContext('run', context)([FROM, TO]) as string;
  return { printed: lines.join('\n'), result };
}

describe('calendar-jxa fallback', () => {
  it('skips an unreadable calendar by name, never echoing its events', () => {
    const { printed, result } = runIt();

    expect(printed).toBe('Skipped calendar "Broken": could not read its events');
    expect(printed).not.toContain('Office hours');
    expect(printed).not.toContain('Bring the pie');
    expect(printed).not.toContain('AppleEvent');
    expect(JSON.parse(result)).toHaveLength(1);
  });
});
