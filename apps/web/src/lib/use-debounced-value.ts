import { useEffect, useState } from 'react';

/** `value` once it has stopped changing for `delay` ms. Pass a primitive: an object rebuilt on
 * every render would never settle. */
export function useDebouncedValue<T extends string | number | boolean>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
}
