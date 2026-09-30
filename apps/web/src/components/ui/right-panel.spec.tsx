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

  it('is a plain aside by default: no dialog role, Tab left alone', () => {
    render(<Harness />);
    openPanel();
    const panel = screen.getByRole('complementary', { name: 'Rana Haddad' });
    expect(panel.getAttribute('aria-modal')).toBeNull();
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    const tab = fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(tab).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('takes a subtitle, a toolbar and its own classes, with no eyebrow', () => {
    render(
      <RightPanel
        title="Add diagnosis"
        subtitle={<p>{'Tooth #16'}</p>}
        toolbar={<input aria-label="Search" />}
        dirty={false}
        onClose={() => undefined}
        className="w-[428px]"
        bodyClassName="px-0"
        footer={<p>{'Footer copy'}</p>}
        footerClassName="justify-start"
      >
        <p>{'Body'}</p>
      </RightPanel>,
    );
    const panel = screen.getByRole('complementary', { name: 'Add diagnosis' });
    expect(panel.className).toContain('w-[428px]');
    expect(panel.className).not.toContain('w-[440px]');
    expect(screen.getByText('Tooth #16')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByText('Body').parentElement?.className).toContain('px-0');
    expect(screen.getByText('Footer copy').parentElement?.className).toContain('justify-start');
    expect(screen.queryByText('Patient')).toBeNull();
  });

  it('modal: a dialog that keeps Tab inside it, both ways', () => {
    render(
      <RightPanel title="Add diagnosis" dirty={false} onClose={() => undefined} modal>
        <input aria-label="Search" />
        <button type="button">{'Last row'}</button>
      </RightPanel>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add diagnosis' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last row' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // From the heading (focused on open), Shift+Tab wraps to the last stop too.
    const heading = screen.getByRole('heading', { name: 'Add diagnosis' });
    heading.focus();
    fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
