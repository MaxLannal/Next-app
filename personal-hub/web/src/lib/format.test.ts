import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatShare, formatShortDate, formatTime, sizeOf } from './format.ts';

describe('formatDuration', () => {
  it('shows minutes under an hour and hours with minutes above', () => {
    expect(formatDuration(0)).toBe('0 m');
    expect(formatDuration(59)).toBe('<1 m');
    expect(formatDuration(60)).toBe('1 m');
    expect(formatDuration(2700)).toBe('45 m');
    expect(formatDuration(5100)).toBe('1 h 25 m');
    expect(formatDuration(7200)).toBe('2 h 0 m');
  });
});

describe('formatShare', () => {
  it('rounds to a whole percentage and keeps slivers visible', () => {
    expect(formatShare(0.75)).toBe('75%');
    expect(formatShare(1 / 3)).toBe('33%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(1)).toBe('100%');
  });
});

describe('formatClock', () => {
  it('pads hours, minutes and seconds and lets hours pass 24', () => {
    expect(formatClock(2530)).toBe('00:42:10');
    expect(formatClock(90061)).toBe('25:01:01');
  });
});

describe('formatTime', () => {
  it('shows a 24-hour local time', () => {
    expect(formatTime(new Date(2026, 10, 22, 14, 2).toISOString())).toBe('14:02');
    expect(formatTime(new Date(2026, 10, 22, 0, 5).toISOString())).toBe('00:05');
  });
});

describe('formatShortDate', () => {
  it('reads a day key as that calendar day, whatever the time zone', () => {
    expect(formatShortDate('2026-11-22')).toBe('Sun 22 Nov');
  });

  it('reads an instant as its local day', () => {
    expect(formatShortDate(new Date(2026, 10, 3, 23, 30).toISOString())).toBe('Tue 3 Nov');
  });
});

describe('sizeOf', () => {
  it('shows bytes, whole kilobytes and one-decimal megabytes', () => {
    expect(sizeOf(0)).toBe('0 B');
    expect(sizeOf(812)).toBe('812 B');
    expect(sizeOf(1024)).toBe('1 KB');
    expect(sizeOf(14_336)).toBe('14 KB');
    expect(sizeOf(1_468_006)).toBe('1.4 MB');
  });
});
