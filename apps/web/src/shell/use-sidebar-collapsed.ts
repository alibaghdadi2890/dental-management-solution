import { useCallback, useState } from 'react';

const STORAGE_KEY = 'dcm.sidebarCollapsed';

function saved(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the sidebar shows icons only: this browser's choice, kept for the next visit. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(saved);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Private mode: the choice holds for this visit only.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
