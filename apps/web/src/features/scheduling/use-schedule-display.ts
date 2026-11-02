import { SLOT_LENGTHS } from '@dcm/contracts';
import { useCallback, useState } from 'react';

const DEFAULT_SLOT_LENGTH = 30;

const storageKey = (userId: string) => `dcm.scheduleDisplay.${userId}`;

function read(userId: string): number {
  const stored = Number(window.localStorage.getItem(storageKey(userId)));
  return (SLOT_LENGTHS as readonly number[]).includes(stored) ? stored : DEFAULT_SLOT_LENGTH;
}

/** The calendar's slot length: a browser preference per user (A5, G23). */
export function useScheduleDisplay(userId: string): [number, (slotLength: number) => void] {
  const [slotLength, setSlotLength] = useState(() => read(userId));
  const change = useCallback(
    (next: number) => {
      window.localStorage.setItem(storageKey(userId), String(next));
      setSlotLength(next);
    },
    [userId],
  );
  return [slotLength, change];
}
