import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmDialog } from './confirm-dialog';
import type { ConfirmOptions } from './confirm-context';

const base: ConfirmOptions = {
  title: 'Archive Rana Haddad?',
  body: 'Archived patients are hidden.',
  okLabel: 'Archive',
  tone: 'danger',
  reasonLabel: 'Reason',
  onConfirm: () => undefined,
};

function renderDialog(options: Partial<ConfirmOptions>) {
  const onClose = vi.fn();
  render(<ConfirmDialog options={{ ...base, ...options }} onClose={onClose} />);
  return { dialog: screen.getByRole('alertdialog'), onClose };
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('requires a reason of 3+ characters unless the reason is optional', () => {
    const required = renderDialog({});
    expect(within(required.dialog).getByRole('button', { name: 'Archive' })).toHaveProperty(
      'disabled',
      true,
    );
    cleanup();
    const optional = renderDialog({ reasonOptional: true });
    expect(within(optional.dialog).getByRole('button', { name: 'Archive' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(
      within(optional.dialog).getByPlaceholderText('Optional — saved to the audit trail'),
    ).toBeTruthy();
  });

  it('stays open with the reason and shows the error when onConfirm fails', async () => {
    const { dialog, onClose } = renderDialog({
      onConfirm: () => Promise.reject(new Error('Couldn’t archive: Conflict')),
    });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Couldn’t archive: Conflict',
    );
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Duplicate');
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('passes the trimmed reason and closes on success', async () => {
    const onConfirm = vi.fn();
    const { dialog, onClose } = renderDialog({ onConfirm });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  Moved  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onConfirm).toHaveBeenCalledWith('Moved');
  });
});
