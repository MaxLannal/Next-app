import { describe, expect, it } from 'vitest';
import { endAfter, startBefore } from './sessionTimes.ts';

// Local clock times, so the tests hold in any zone.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes);

describe('endAfter', () => {
  it('is later the same day when the clock allows', () => {
    expect(endAfter('23:30', at(22, 23))).toEqual(at(22, 23, 30));
  });

  it('runs past midnight into the next morning', () => {
    expect(endAfter('02:00', at(22, 23))).toEqual(at(23, 2));
  });

  it('crosses a month end', () => {
    expect(endAfter('01:15', new Date(2026, 10, 30, 22, 0))).toEqual(new Date(2026, 11, 1, 1, 15));
  });

  it('is null for something that is not a time', () => {
    expect(endAfter('25:00', at(22, 23))).toBeNull();
  });
});

describe('startBefore', () => {
  it('is earlier the same day when the clock allows', () => {
    expect(startBefore('00:30', at(23, 2))).toEqual(at(23, 0, 30));
  });

  it('reaches back to the night before', () => {
    expect(startBefore('23:00', at(23, 2))).toEqual(at(22, 23));
  });

  it('is null for something that is not a time', () => {
    expect(startBefore('', at(23, 2))).toBeNull();
  });
});
