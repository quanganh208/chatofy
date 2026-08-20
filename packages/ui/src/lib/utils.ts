import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's class helper, moved here with the components it serves.
 *
 * `clsx` resolves the conditionals; `twMerge` then resolves the conflicts, so a
 * caller passing `className="px-6"` to a component whose base is `px-4` gets
 * `px-6` rather than both and a coin toss on source order. That second half is
 * the reason this is not just `clsx`.
 *
 * Lives under `src/lib` and is re-exported from the React entry rather than
 * kept in its own — the entry is banner'd `"use client"` in full, and a helper
 * exported from it becomes a client reference. That is correct for `cn`, which
 * only ever runs where the components run. The moment something here needs to
 * be callable from a server component, it needs an entry of its own without the
 * banner; see `tsup.react.config.ts`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
