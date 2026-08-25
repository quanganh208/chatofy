/**
 * How wide a page is, in one place.
 *
 * This is what `AppShell` was actually protecting. Before it, each route picked its
 * own width and they disagreed — `max-w-2xl` here, `max-w-xl` there, nothing at all
 * on `/` — which is most of why the app read as a set of test harnesses rather than
 * one product.
 *
 * Splitting the shell into three route-group layouts could have brought that back:
 * three files, three chances to write a different number. It does not, because the
 * values live here and a layout asks for a NAME. Nothing outside this file writes a
 * width.
 *
 * `marketing` is wider than either app measure on purpose. A landing page is read in
 * sections across the full column; a transcript is read line by line and wants the
 * shorter line length.
 */
export const MEASURE = {
  /** A transcript, and app surfaces generally. */
  wide: 'max-w-2xl',
  /** Prose-led pages — an auth card, a short explanation. */
  reading: 'max-w-xl',
  /** The landing page's sections. */
  marketing: 'max-w-4xl',
} as const;

export type Measure = keyof typeof MEASURE;
