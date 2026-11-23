import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddMenu } from './AddMenu.tsx';

describe('the canvas + menu', () => {
  it('pours out Step and Experience, and closes after a choice', async () => {
    const user = userEvent.setup();
    const onStep = vi.fn();
    const onExperience = vi.fn();
    render(<AddMenu onStep={onStep} onExperience={onExperience} />);
    const plus = screen.getByRole('button', { name: 'Add to the canvas' });
    await user.click(plus);
    expect(screen.getByRole('button', { name: 'Close the add menu' }).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Step' }));
    expect(onStep).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Add to the canvas' }).getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Add to the canvas' }));
    await user.click(screen.getByRole('button', { name: 'Experience' }));
    expect(onExperience).toHaveBeenCalledOnce();
  });

  it('closes on Esc', async () => {
    const user = userEvent.setup();
    render(<AddMenu onStep={() => {}} onExperience={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Add to the canvas' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Add to the canvas' }).getAttribute('aria-expanded')).toBe('false');
  });
});
