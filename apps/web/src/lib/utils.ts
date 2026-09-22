import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The role-named type scale, in the `font-size` group.
 *
 * tailwind-merge files an unknown `text-*` under colour, so `cn('text-heading',
 * 'text-foreground')` would return the colour alone and the size would vanish.
 * `@chatofy/ui`'s `cn` is configured the same way, but it cannot be imported
 * here: its entry is `"use client"`, and this helper runs in server components.
 * `utils.spec.ts` holds this list to the roles `globals.css` declares.
 */
export const TYPE_SCALE = [
  'label',
  'hint',
  'body',
  'translation',
  'heading',
  'title',
  'display',
] as const;

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: [...TYPE_SCALE] }] } },
});

/** Merge conditional class names and de-duplicate Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
