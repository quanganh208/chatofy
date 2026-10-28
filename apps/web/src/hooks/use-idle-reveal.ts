'use client';

import { useEffect, useState } from 'react';

/** How long the stage's controls stay up after the last sign of a hand on it. */
export const IDLE_REVEAL_DELAY_MS = 3000;

/**
 * Whether controls drawn over `node` should be showing: true from mount and on
 * any pointer move, press or key inside it, false once it has been left alone
 * for `delayMs`. `hold` keeps them up for as long as it is true — a panel open
 * from them, a pointer resting on them, a keyboard focus inside them.
 *
 * The timer lives in the effect rather than in state, so a pointer moving across
 * the stage costs no render: `setAwake(true)` while already awake bails out.
 */
export function useIdleReveal(
  node: HTMLElement | null,
  { hold = false, delayMs = IDLE_REVEAL_DELAY_MS }: { hold?: boolean; delayMs?: number } = {},
): boolean {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (!hold) timer = setTimeout(() => setAwake(false), delayMs);
    };
    const wake = () => {
      setAwake(true);
      arm();
    };
    arm();
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    for (const type of events) node.addEventListener(type, wake);
    return () => {
      clearTimeout(timer);
      for (const type of events) node.removeEventListener(type, wake);
    };
  }, [node, hold, delayMs]);

  return awake;
}
