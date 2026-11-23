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
    expect(within(main).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Dashboard', 'Essays', 'Database', 'Skills', 'Traces']);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
    expect(screen.getByRole('link', { name: 'Next, dashboard' }).getAttribute('href')).toBe('/');
    expect(screen.getByTestId('timer')).toBeTruthy();
    for (const name of ['Dashboard', 'Essays', 'Database', 'Skills', 'Settings']) {
      expect(screen.getByRole('link', { name }).querySelector('svg')).not.toBeNull();
    }
  });

  it('wears the Next logo at the top, linking home', () => {
    renderAt('/settings');
    const mark = screen.getByRole('link', { name: 'Next, dashboard' }).querySelector('img');
    expect(mark?.getAttribute('alt')).toBe('');
    const src = mark?.getAttribute('src') ?? '';
    expect(src.startsWith('data:image/svg+xml,')).toBe(true);
    // The tile alone, not the app icon's canvas.
    expect(decodeURIComponent(src)).toContain('viewBox="100 100 824 824"');
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
