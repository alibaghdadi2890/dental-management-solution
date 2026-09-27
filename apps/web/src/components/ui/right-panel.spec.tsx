import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { RightPanel } from './right-panel';

function Harness({
  initialFocus,
  closeDisabled = false,
  onClose,
}: {
  initialFocus?: 'heading' | 'field';
  closeDisabled?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        aria-label="open"
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <RightPanel
          eyebrow="Patient"
          title="Rana Haddad"
          dirty={false}
          onClose={close}
          closeDisabled={closeDisabled}
          {...(initialFocus ? { initialFocus } : {})}
        >
          <input aria-label="Name" />
        </RightPanel>
      )}
    </>
  );
}

const openPanel = () => {
  const opener = screen.getByRole('button', { name: 'open' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

describe('RightPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('focuses its heading on open and gives focus back to the opener on close', () => {
    render(<Harness />);
    const opener = openPanel();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Rana Haddad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the first field of a form panel', () => {
    render(<Harness initialFocus="field" />);
    openPanel();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  });

  it('closes on Escape from inside the panel', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openPanel();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it('cannot be closed while closing is disabled', () => {
    const onClose = vi.fn();
    render(<Harness closeDisabled onClose={onClose} />);
    openPanel();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
