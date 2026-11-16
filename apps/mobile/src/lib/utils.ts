import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The type scale's names are not Tailwind's (`text-md`, `text-display`), so plain
// twMerge would read `text-display` as a colour and drop `text-foreground` beside it.
// Kept in step with `fontSize` in tailwind.config.js.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['xs', 'sm', 'base', 'md', 'lg', 'xl', 'display'] }],
    },
  },
});

/** Join class names and let a later Tailwind utility win over an earlier one. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
