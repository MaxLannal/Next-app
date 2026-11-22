import type { HeatmapDay, SubjectSlice } from '@shared/types.ts';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bars } from './Bars.tsx';
import { groupSlices, subjectColor } from './colors.ts';
import { Heatmap } from './Heatmap.tsx';
import { Pie, PieLegend } from './Pie.tsx';
import { StackedBar } from './StackedBar.tsx';

const H = 3600;
const slice = (subjectId: number | null, name: string, hours: number): SubjectSlice => ({
  subjectId,
  name,
  seconds: hours * H,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subjectColor', () => {
  it('walks the periwinkle ramp, then goes muted', () => {
    expect([0, 1, 2, 3, 4, 5].map(subjectColor)).toEqual([
      'oklch(86% 0.10 274)',
      'oklch(76% 0.10 274)',
      'oklch(66% 0.10 274)',
      'oklch(56% 0.10 274)',
      'oklch(46% 0.10 274)',
      'oklch(38% 0.10 274)',
    ]);
    expect(subjectColor(6)).toBe('var(--color-muted)');
    expect(subjectColor(9)).toBe('var(--color-muted)');
  });
});

describe('groupSlices', () => {
  it('merges the tail', () => {
    // Given smallest first, so the sort is exercised too.
    const groups = groupSlices([1, 2, 3, 4, 5, 6, 7, 8].map((h) => slice(h, `Subject ${h}`, h)));

    expect(groups).toHaveLength(7);
    expect(groups.map((g) => g.seconds / H)).toEqual([8, 7, 6, 5, 4, 3, 3]);
    expect(groups[6]).toMatchObject({ name: 'Other', seconds: 3 * H, color: 'var(--color-muted)' });
    const total = groups.reduce((sum, g) => sum + g.share, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });

  it('drops zero-second slices and colours by rank', () => {
    const groups = groupSlices([slice(1, 'Algebra', 1), slice(2, 'Idle', 0), slice(null, 'No subject', 2)]);

    expect(groups.map((g) => g.name)).toEqual(['No subject', 'Algebra']);
    expect(groups.map((g) => g.color)).toEqual([subjectColor(0), subjectColor(1)]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });
});

describe('Pie', () => {
  it('draws one arc per group', () => {
    const { container } = render(
      <Pie label="Focus by subject" slices={[slice(1, 'Algebra', 3), slice(2, 'Essay', 2), slice(null, 'No subject', 1)]} />,
    );

    expect(screen.getByRole('img', { name: 'Focus by subject' })).toBeTruthy();
    const paths = container.querySelectorAll('path[data-slice]');
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it('draws a single subject as a whole ring', () => {
    const { container } = render(<Pie label="Focus by subject" slices={[slice(1, 'Algebra', 2)]} />);

    const paths = container.querySelectorAll('path[data-slice]');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it('with no data draws a single empty ring and no paths', () => {
    const { container } = render(<Pie label="Focus by subject" slices={[]} centerTop="0 m" />);

    expect(screen.getByRole('img', { name: 'Focus by subject' })).toBeTruthy();
    expect(container.querySelectorAll('path')).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('PieLegend lists swatch, name, duration and share', () => {
    const { container } = render(<PieLegend slices={[slice(2, 'Essay', 1), slice(1, 'Algebra', 3)]} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first && within(first).getByText('Algebra')).toBeTruthy();
    expect(first && within(first).getByText('3 h 0 m')).toBeTruthy();
    expect(first && within(first).getByText('75%')).toBeTruthy();
    expect(second && within(second).getByText('Essay')).toBeTruthy();
    expect(second && within(second).getByText('1 h 0 m')).toBeTruthy();
    expect(second && within(second).getByText('25%')).toBeTruthy();
    expect(container.querySelectorAll('.legend__swatch')).toHaveLength(2);
  });
});

describe('Heatmap', () => {
  const cell = (container: HTMLElement, date: string) => {
    const el = container.querySelector(`rect[data-date="${date}"]`);
    if (!el) throw new Error(`no cell for ${date}`);
    return el;
  };
  // Columns are weeks, rows are weekdays (Monday = row 0); both ARIA indexes are 1-based.
  const position = (el: Element) => ({
    col: Number(el.getAttribute('aria-colindex')) - 1,
    row: Number(el.closest('[role="row"]')?.getAttribute('aria-rowindex')) - 1,
  });

  it('lays out 2026', () => {
    const { container } = render(<Heatmap year={2026} days={[]} onActiveDay={() => {}} describe={(d) => d.date} />);

    const cells = container.querySelectorAll('rect[data-date]');
    expect(cells).toHaveLength(365);
    expect(position(cell(container, '2026-01-01'))).toEqual({ col: 0, row: 3 });
    const lastCol = Math.max(...[...cells].map((c) => position(c).col));
    expect(lastCol).toBe(52);
    expect(position(cell(container, '2026-12-31')).col).toBe(lastCol);
    expect(screen.getByRole('grid').getAttribute('aria-colcount')).toBe('53');
  });

  it('moves a roving tab stop with arrow keys and reports the active day', async () => {
    const user = userEvent.setup();
    const onActiveDay = vi.fn();
    const jan8: HeatmapDay = { date: '2026-01-08', seconds: 2 * H, level: 3, subjects: [slice(1, 'Algebra', 2)] };
    const { container } = render(
      <Heatmap year={2026} days={[jan8]} onActiveDay={onActiveDay} describe={(d) => `${d.date} · ${d.seconds / H} h`} />,
    );
    const tip = () => container.querySelector('.chart-tip')?.textContent ?? null;

    const stops = container.querySelectorAll('rect[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-date')).toBe('2026-01-01');
    expect(tip()).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(cell(container, '2026-01-01'));
    expect(onActiveDay).toHaveBeenLastCalledWith({ date: '2026-01-01', seconds: 0, level: 0, subjects: [] });
    expect(tip()).toBe('2026-01-01 · 0 h');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell(container, '2026-01-08'));
    expect(cell(container, '2026-01-08').getAttribute('tabindex')).toBe('0');
    expect(cell(container, '2026-01-01').getAttribute('tabindex')).toBe('-1');
    expect(cell(container, '2026-01-08').getAttribute('aria-label')).toBe('2026-01-08 · 2 h');
    expect(onActiveDay).toHaveBeenLastCalledWith(jan8);
    expect(tip()).toBe('2026-01-08 · 2 h');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(container, '2026-01-09'));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(cell(container, '2026-01-07'));
    // Jan 7 minus a week is last year: the stop stays put.
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cell(container, '2026-01-07'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cell(container, '2026-12-31'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cell(container, '2026-01-01'));

    onActiveDay.mockClear();
    await user.tab();
    expect(onActiveDay).toHaveBeenCalledExactlyOnceWith(null);
    expect(tip()).toBeNull();
  });

  it('shows the tooltip on hover', async () => {
    const user = userEvent.setup();
    const onActiveDay = vi.fn();
    const { container } = render(
      <Heatmap year={2026} days={[]} onActiveDay={onActiveDay} describe={(d) => `about ${d.date}`} />,
    );

    await user.hover(cell(container, '2026-03-02'));
    expect(container.querySelector('.chart-tip')?.textContent).toBe('about 2026-03-02');
    expect(onActiveDay).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-03-02' }));

    await user.unhover(cell(container, '2026-03-02'));
    expect(container.querySelector('.chart-tip')).toBeNull();
    expect(onActiveDay).toHaveBeenLastCalledWith(null);
  });
});

describe('Bars', () => {
  const week = (values: number[]) => values.map((value, i) => ({ label: ['Mon', 'Tue', 'Wed'][i] ?? `${i}`, value }));

  it('handles all-zero', () => {
    const { container } = render(<Bars label="Push-ups" data={week([0, 0, 0])} format={String} />);

    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.getAttribute('height')).toBe('0');
      expect(rect.outerHTML).not.toMatch(/NaN|Infinity/);
    }
  });

  it('draws bars from a zero baseline against three gridlines, each with a title', () => {
    const { container } = render(<Bars label="Push-ups" data={week([10, 20, 0])} format={(v) => `${v} reps`} />);

    expect(screen.getByRole('img', { name: 'Push-ups' })).toBeTruthy();
    const grid = [...container.querySelectorAll('line.bars__grid')].map((l) => Number(l.getAttribute('y1')));
    expect(grid).toHaveLength(3);
    const [top, mid, base] = grid.sort((a, b) => a - b);
    const [mon, tue, wed] = [...container.querySelectorAll('rect')];
    // The top of each bar sits at its value: 20 on the top line, 10 on the middle one.
    expect(Number(tue?.getAttribute('y'))).toBeCloseTo(top ?? NaN);
    expect(Number(mon?.getAttribute('y'))).toBeCloseTo(mid ?? NaN);
    expect(Number(wed?.getAttribute('y'))).toBeCloseTo(base ?? NaN);
    expect(wed?.getAttribute('height')).toBe('0');
    expect([mon, tue, wed].map((r) => r?.querySelector('title')?.textContent)).toEqual([
      'Mon: 10 reps',
      'Tue: 20 reps',
      'Wed: 0 reps',
    ]);
    const width = Number(mon?.getAttribute('width'));
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(24);
    const gap = Number(tue?.getAttribute('x')) - Number(mon?.getAttribute('x')) - width;
    expect(gap).toBeGreaterThanOrEqual(2);
    expect(gap).toBeLessThanOrEqual(4);
  });

  it('shows bars at full height when IntersectionObserver is missing', () => {
    const { container } = render(<Bars label="Push-ups" data={week([4, 2])} format={String} />);
    expect(container.querySelector('.bars')?.classList.contains('is-waiting')).toBe(false);
  });

  it('grows the bars in once they scroll into view', () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const stop = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          notify = callback;
        }
        observe() {}
        disconnect = stop;
      },
    );
    const { container } = render(<Bars label="Push-ups" data={week([4, 2])} format={String} />);
    const chart = container.querySelector('.bars');

    expect(chart?.classList.contains('is-waiting')).toBe(true);
    act(() => notify([{ isIntersecting: false }]));
    expect(chart?.classList.contains('is-waiting')).toBe(true);
    act(() => notify([{ isIntersecting: true }]));
    expect(chart?.classList.contains('is-waiting')).toBe(false);
    expect(stop).toHaveBeenCalled();
  });
});

describe('StackedBar', () => {
  it('lays parts end to end with a legend below', () => {
    const parts = [
      { label: 'Awake', value: 10, color: 'oklch(83% 0.095 62)' },
      { label: 'REM', value: 30, color: 'oklch(86% 0.10 274)' },
      { label: 'Core', value: 60, color: 'oklch(66% 0.10 274)' },
      { label: 'Deep', value: 0, color: 'oklch(46% 0.10 274)' },
    ];
    const { container } = render(<StackedBar label="Sleep stages" parts={parts} />);

    expect(screen.getByRole('img', { name: 'Sleep stages' })).toBeTruthy();
    const rects = [...container.querySelectorAll('rect[data-part]')];
    expect(rects.map((r) => r.getAttribute('data-part'))).toEqual(['Awake', 'REM', 'Core']);
    const x = rects.map((r) => Number(r.getAttribute('x')));
    const w = rects.map((r) => Number(r.getAttribute('width')));
    expect((w[1] ?? 0) / (w[0] ?? 1)).toBeCloseTo(3);
    expect((w[2] ?? 0) / (w[0] ?? 1)).toBeCloseTo(6);
    expect((x[1] ?? 0) - ((x[0] ?? 0) + (w[0] ?? 0))).toBeCloseTo(2);
    expect((x[2] ?? 0) - ((x[1] ?? 0) + (w[1] ?? 0))).toBeCloseTo(2);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Awake10%',
      'REM30%',
      'Core60%',
      'Deep0%',
    ]);
  });

  it('with nothing to show draws an empty track', () => {
    const { container } = render(<StackedBar label="Sleep stages" parts={[{ label: 'Deep', value: 0, color: 'red' }]} />);
    expect(container.querySelectorAll('rect[data-part]')).toHaveLength(0);
    expect(container.querySelectorAll('rect')).toHaveLength(1);
  });
});
