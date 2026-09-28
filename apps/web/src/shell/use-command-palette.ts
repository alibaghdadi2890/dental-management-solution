import { useEffect, useState } from 'react';

/** Ctrl+K, or ⌘K on a Mac. A layout whose K key types another letter (Arabic, Cyrillic, …) is
 * matched by the physical key instead; a Latin layout by the letter it types. */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat) {
    return false;
  }
  const key = event.key.toLowerCase();
  return key === 'k' || (event.code === 'KeyK' && !/^[a-z]$/.test(key));
}

/**
 * The shell-owned open state of the ⌘K patient palette, with the global shortcut: Ctrl/⌘+K
 * toggles it from anywhere (POC: it always opens, taking the browser's own shortcut). `enabled`
 * off (no clinic, or no `patient:read`) keeps it closed and unbound.
 */
export function useCommandPalette(enabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);

  return { open: enabled && open, setOpen };
}
