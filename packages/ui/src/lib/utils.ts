import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The type scale, by the names it is spelled with at a call site.
 *
 * `tokens.ts` keys these `xs`/`sm`/`base`/… because that is what a React Native
 * consumer indexes; the CSS surfaces alias them to roles (`--text-body`), and the
 * roles are what a class string carries. `token-parity.spec.ts` holds the two
 * halves together — this list is the third place the names appear, and
 * `type-scale-merge.spec.ts` is what stops it drifting from the stylesheets.
 */
const TYPE_SCALE = [
  'label',
  'hint',
  'body',
  'translation',
  'heading',
  'title',
  // Web-only in the stylesheets — the popup has no landing page — but the merge
  // config is shared, and a role missing here is filed as a COLOUR and silently
  // dropped. That costs nothing on a surface that never writes `text-display`, and
  // omitting it would reintroduce the exact bug this list exists for.
  'display',
] as const;

/**
 * shadcn's class helper, moved here with the components it serves.
 *
 * `clsx` resolves the conditionals; `twMerge` then resolves the conflicts, so a
 * caller passing `className="px-6"` to a component whose base is `px-4` gets
 * `px-6` rather than both and a coin toss on source order. That second half is
 * the reason this is not just `clsx`.
 *
 * ## Why `twMerge` has to be told about the type scale
 *
 * `text-*` is one conflict group to tailwind-merge, and it decides what a given
 * `text-…` means from its own table of Tailwind's defaults. It knows `text-sm` is
 * a size and `text-red-500` is a colour. It has never heard of `text-body`, so it
 * files it under colour — and then `cn('text-body', 'text-primary-foreground')`
 * returns the colour ALONE, having "resolved" a conflict between a size and a
 * colour that was never a conflict at all.
 *
 * That is not hypothetical. Before this configuration, `Button`'s base carried
 * `text-body` and every variant that also sets an ink colour dropped it: the same
 * component rendered at 12px in the extension popup (Chrome's own default for an
 * extension page), 16px on web (the browser default), and 14px for `outline`
 * alone — which sets no colour and so kept its size by accident. Nothing in the
 * source looked wrong; `text-body` is right there in `button.tsx`.
 *
 * Naming the scale below puts each role back in the `font-size` group, where a
 * colour cannot displace it.
 *
 * ## Where this lives
 *
 * Under `src/lib` and re-exported from the React entry rather than kept in its
 * own — the entry is banner'd `"use client"` in full, and a helper exported from
 * it becomes a client reference. That is correct for `cn`, which only ever runs
 * where the components run. The moment something here needs to be callable from
 * a server component, it needs an entry of its own without the banner; see
 * `tsup.react.config.ts`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_SCALE] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { TYPE_SCALE };
