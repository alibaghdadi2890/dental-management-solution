import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isPaletteShortcut, useCommandPalette } from './use-command-palette';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('isPaletteShortcut', () => {
  it('is Ctrl+K or ⌘K, whatever the case of the letter', () => {
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ key: 'K', code: 'KeyK', ctrlKey: true }))).toBe(true);
  });

  it('is not K alone, nor with Shift or Alt, nor a held-down repeat, nor mid-composition', () => {
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK' }))).toBe(false);
    expect(isPaletteShortcut(key({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }))).toBe(
      false,
    );
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true, repeat: true }))).toBe(
      false,
    );
    expect(
      isPaletteShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true })),
    ).toBe(false);
  });

  it('matches the physical K key on a layout where it types a non-Latin letter (Arabic)', () => {
    expect(isPaletteShortcut(key({ key: 'ن', code: 'KeyK', ctrlKey: true }))).toBe(true);
  });

  it('follows the typed letter on a Latin layout that moves K (Dvorak)', () => {
    expect(isPaletteShortcut(key({ key: 't', code: 'KeyK', ctrlKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyV', ctrlKey: true }))).toBe(true);
  });
});

describe('useCommandPalette', () => {
  it('closes, and stays closed, once it is disabled', () => {
    const { result, rerender } = renderHook(({ enabled }) => useCommandPalette(enabled), {
      initialProps: { enabled: true },
    });
    act(() => {
      result.current.setOpen(true);
    });
    expect(result.current.open).toBe(true);
    rerender({ enabled: false });
    expect(result.current.open).toBe(false);
    rerender({ enabled: true });
    expect(result.current.open).toBe(false);
  });

  it('toggles on the shortcut only while enabled', () => {
    const { result, rerender } = renderHook(({ enabled }) => useCommandPalette(enabled), {
      initialProps: { enabled: false },
    });
    act(() => {
      window.dispatchEvent(key({ key: 'k', code: 'KeyK', ctrlKey: true }));
    });
    expect(result.current.open).toBe(false);
    rerender({ enabled: true });
    act(() => {
      window.dispatchEvent(key({ key: 'k', code: 'KeyK', ctrlKey: true }));
    });
    expect(result.current.open).toBe(true);
    act(() => {
      window.dispatchEvent(key({ key: 'k', code: 'KeyK', metaKey: true }));
    });
    expect(result.current.open).toBe(false);
  });
});
