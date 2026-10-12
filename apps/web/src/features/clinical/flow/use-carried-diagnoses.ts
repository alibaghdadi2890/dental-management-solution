import { useCallback, useState } from 'react';

const storageKey = (visitId: string) => `dcm.visit.${visitId}.carried`;

function read(visitId: string): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(visitId)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * The older diagnoses a visit carried into its Plan step (feature 10, V6, spec D23): the
 * Findings step's **Plan treatment →**. It is the dentist's intent for this sitting, not a
 * record — nothing is stored until a treatment is chosen — so it is kept for the browser tab
 * only, where it survives a reload of the visit.
 */
export function useCarriedDiagnoses(visitId: string): {
  carried: ReadonlySet<string>;
  carry: (recordId: string) => void;
} {
  const [carried, setCarried] = useState(() => read(visitId));
  const carry = useCallback(
    (recordId: string) => {
      setCarried((current) => {
        if (current.has(recordId)) return current;
        const next = new Set(current).add(recordId);
        try {
          sessionStorage.setItem(storageKey(visitId), JSON.stringify([...next]));
        } catch {
          // Storage is full or unavailable: the card still shows until the page is left.
        }
        return next;
      });
    },
    [visitId],
  );
  return { carried, carry };
}
