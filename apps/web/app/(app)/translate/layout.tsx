import type { Metadata } from 'next';

/**
 * A title for the product's main surface, which had none.
 *
 * It lives in a layout rather than beside the page because `page.tsx` is
 * `'use client'` — it owns the settings state — and a client module cannot export
 * `metadata`. Next evaluates this on the server, which is also where the locale will
 * be resolved when these become `generateMetadata`.
 *
 * The root layout's title answered for every route, so a reader with the translator
 * and the landing page open saw two tabs both reading "Chatofy".
 */
export const metadata: Metadata = { title: 'Translate · Chatofy' };

export default function TranslateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
