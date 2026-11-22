import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet.tsx';

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<Sheet open={false} onClose={() => {}} title="Wrap up">body</Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Esc and gives focus back', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Open</button>
        <Sheet open={false} onClose={onClose} title="Wrap up">body</Sheet>
      </>,
    );
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    rerender(
      <>
        <button type="button">Open</button>
        <Sheet open onClose={onClose} title="Wrap up">body</Sheet>
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Wrap up' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button">Open</button>
        <Sheet open={false} onClose={onClose} title="Wrap up">body</Sheet>
      </>,
    );
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Sheet open onClose={() => {}} title="Wrap up">
          <button type="button">Save</button>
        </Sheet>
      </>,
    );

    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });

  it('wraps Tab past elements that are hidden or disabled', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Sheet open onClose={() => {}} title="Wrap up">
          <button type="button">Save</button>
          <button type="button" tabIndex={0} disabled>
            Archive
          </button>
          <div hidden>
            <button type="button">Advanced</button>
          </div>
        </Sheet>
      </>,
    );

    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });
});
