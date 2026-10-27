import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu';

/** A row's ⋯ menu whose Edit opens a panel that takes the focus, like Settings › Staff. */
function RowWithPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button type="button">{'Actions'}</button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            onSelect={() => {
              setOpen(true);
            }}
          >
            {'Edit'}
          </MenuItem>
          <MenuItem onSelect={() => undefined}>{'Nothing'}</MenuItem>
        </MenuContent>
      </Menu>
      {open && <input aria-label="Full name" ref={(node) => node?.focus()} />}
    </>
  );
}

const openMenu = async () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  return screen.findByRole('menu');
};

describe('MenuContent', () => {
  afterEach(cleanup);

  it('returns the focus to its trigger without scrolling it into view', async () => {
    // Radix focused it with scrolling: a table under a panel the item opened slid sideways.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<RowWithPanel />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    const onTrigger = focus.mock.contexts
      .map((context, index) => ({ context, options: focus.mock.calls[index]?.[0] }))
      .filter(({ context }) => context === trigger);
    expect(onTrigger.at(-1)?.options).toEqual({ preventScroll: true });
    focus.mockRestore();
  });

  it('returns the focus to its trigger when the item moved it nowhere', async () => {
    render(<RowWithPanel />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nothing' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
    });
  });
});
