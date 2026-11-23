import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LatexView } from './LatexView.tsx';

describe('LatexView', () => {
  it('renders the reading with KaTeX', () => {
    const { container } = render(<LatexView latex="x^2+1=0" />);
    const math = container.querySelector('.katex');
    expect(math).not.toBeNull();
    expect(math!.textContent).toContain('x');
    expect(container.querySelector('.latex__source')).toBeNull();
  });

  it('shows the source on request and renders again', async () => {
    const user = userEvent.setup();
    const { container } = render(<LatexView latex="x^2+1=0" />);
    const toggle = screen.getByRole('button', { name: 'Source' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.latex__source')?.textContent).toBe('x^2+1=0');
    expect(container.querySelector('.latex__body')).toBeNull();

    await user.click(toggle);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('shows broken LaTeX as text instead of throwing', () => {
    const { container } = render(<LatexView latex="\frac{" />);
    expect(container.querySelector('.katex-error')).not.toBeNull();
  });

  it('offers Edit and Retry only when the caller does', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(<LatexView latex="a+b" />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    rerender(<LatexView latex="a+b" onEdit={onEdit} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onEdit).toHaveBeenCalledWith('a+b');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
