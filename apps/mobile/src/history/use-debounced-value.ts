import { useEffect, useState } from 'react';

/**
 * `value`, but only after it has stopped changing for `delayMs`. A search box passes
 * its text through this so a request is sent when the user pauses, not once per key.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
