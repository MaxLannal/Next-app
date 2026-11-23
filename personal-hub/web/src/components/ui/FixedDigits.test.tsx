import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FixedDigits } from './FixedDigits.tsx';

it('renders one cell per digit, separators unboxed', () => {
  const { container } = render(<FixedDigits text="14:59:12" />);

  const cells = [...container.querySelectorAll('.fixed-digits__d')];
  expect(cells.map((c) => c.textContent)).toEqual(['1', '4', '5', '9', '1', '2']);
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('14:59:12');
});

it('keeps exactly one copy for find and selection', () => {
  const { container } = render(<FixedDigits text="14:59:12" />);

  // No hidden second copy: text selection and browser find see the digits once.
  expect(container.querySelector('.visually-hidden')).toBeNull();
  expect(container.textContent?.match(/14:59:12/g)).toHaveLength(1);
});

it('reads the whole text once from the label', () => {
  render(<FixedDigits text="14:59:12" label="14:59:12" />);

  expect(screen.getByLabelText('14:59:12').getAttribute('role')).toBe('img');
  // The digits are laid out for show only; the label is what assistive tech reads.
  expect(screen.queryByText('14:59:12')).toBeNull();
});
