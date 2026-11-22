import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs.tsx';

const options = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

describe('Tabs', () => {
  it('arrow keys move selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs options={options} value="day" onChange={onChange} label="Range" />);

    expect(screen.getByRole('tablist', { name: 'Range' })).toBeTruthy();
    const day = screen.getByRole('tab', { name: 'Day' });
    expect(day.getAttribute('aria-selected')).toBe('true');
    expect(day.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Week' }).tabIndex).toBe(-1);

    day.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('week');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Week' }));

    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('year');
  });

  it('wraps with ArrowLeft and jumps home with Home', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs options={options} value="week" onChange={onChange} label="Range" />);

    screen.getByRole('tab', { name: 'Week' }).focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('day');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('year');
  });

  it('selects a tab on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs options={options} value="day" onChange={onChange} label="Range" />);

    await user.click(screen.getByRole('tab', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });
});
