import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FixedDigits } from './FixedDigits.tsx';

it('renders one cell per digit, separators unboxed', () => {
  const { container } = render(<FixedDigits text="14:59:12" />);

  const cells = [...container.querySelectorAll('.fixed-digits__d')];
  expect(cells.map((c) => c.textContent)).toEqual(['1', '4', '5', '9', '1', '2']);
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('14:59:12');
  // Read as one string, not digit by digit.
  expect(screen.getByText('14:59:12')).toBeTruthy();
});
