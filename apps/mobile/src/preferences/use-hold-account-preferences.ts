/** Holds remote preference changes for as long as `active`; see `holdAccountPreferences`. */

import { useEffect } from 'react';
import { holdAccountPreferences } from './account-preferences';

export function useHoldAccountPreferences(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdAccountPreferences();
  }, [active]);
}
