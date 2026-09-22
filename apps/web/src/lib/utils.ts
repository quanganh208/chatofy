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

/**
 * The transcript's two sizes, which multiply a role by the reader's scale.
 *
 * Declared as `@utility` rather than as a `--text-*` theme value, because the
 * `calc(… * var(--reading-scale))` they carry is not a token. That makes them
 * invisible to a scan for `--text-*` — and just as invisible to tailwind-merge,
 * which filed them under colour like any other name it has not heard of. The
 * reading-scale pair has to be named here for the same reason the roles above do:
 * `text-prose` is a colour, and `cn('text-prose', 'text-source')` returned the
 * size alone until it was.
 */
export const SCALED_TYPE = ['source', 'target'] as const;

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: [...TYPE_SCALE, ...SCALED_TYPE] }] } },
});

/** Merge conditional class names and de-duplicate Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
