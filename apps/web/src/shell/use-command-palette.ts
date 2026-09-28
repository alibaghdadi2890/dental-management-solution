import { useEffect, useState } from 'react';

/** Ctrl+K, or ⌘K on a Mac — not mid-composition in an input method. A layout whose K key types
 * another letter (Arabic, Cyrillic, …) is matched by the physical key instead; a Latin layout by
 * the letter it types. */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || !(event.ctrlKey || event.metaKey)) return false;
  if (event.altKey || event.shiftKey || event.repeat) return false;
  const key = event.key.toLowerCase();
  return key === 'k' || (event.code === 'KeyK' && !/^[a-z]$/.test(key));
}

/** A confirm dialog (`ConfirmDialog`, the unsaved-changes guard, the idle timeout) is open: it
 * must be answered first, not covered by the palette. */
const alertOpen = () => document.querySelector('[role="alertdialog"]') !== null;

/**
 * The shell-owned open state of the ⌘K patient palette, with the global shortcut: Ctrl/⌘+K
 * toggles it from anywhere (POC: it always opens, taking the browser's own shortcut), except over
 * a modal alert. `enabled` off (no clinic, or no `patient:read`) closes it and unbinds the key.
 */
export function useCommandPalette(enabled: boolean) {
  const [open, setOpen] = useState(false);
  if (!enabled && open) setOpen(false);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (alertOpen()) return;
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);

  return { open, setOpen };
}
