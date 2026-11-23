import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Nav } from './Nav.tsx';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Nav timerSlot={<span data-testid="timer" />} />
    </MemoryRouter>,
  );

describe('the side rail', () => {
  it('has one named icon link per page, Settings at the foot, and the timer slot', () => {
    renderAt('/');
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Dashboard', 'Essays', 'Database']);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
    expect(screen.getByRole('link', { name: 'Next, dashboard' }).getAttribute('href')).toBe('/');
    expect(screen.getByTestId('timer')).toBeTruthy();
    for (const name of ['Dashboard', 'Essays', 'Database', 'Settings']) {
      expect(screen.getByRole('link', { name }).querySelector('svg')).not.toBeNull();
    }
  });

  it('marks only the page you are on', () => {
    renderAt('/essays/12');
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.getAttribute('aria-label'))).toEqual(['Essays']);
  });

  it('does not mark Dashboard on other pages', () => {
    renderAt('/database');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Database' }).getAttribute('aria-current')).toBe('page');
  });
});
