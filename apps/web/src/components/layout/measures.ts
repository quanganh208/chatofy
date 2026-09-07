/**
 * How wide a page is, in one place.
 *
 * This is what the old shell was actually protecting. Before it, each route picked its
 * own width and they disagreed — `max-w-2xl` here, `max-w-xl` there, nothing at all
 * on `/` — which is most of why the app read as a set of test harnesses rather than
 * one product.
 *
 * Splitting the shell apart could have brought that back. Five surfaces now decide a
 * measure — the three group layouts, the plain frame, and the lab layout — which is five
 * chances to write a different number. It does not, because the values live here and a
 * caller asks for a NAME. Nothing outside this file writes a width.
 *
 * `marketing` is wider than either app measure on purpose. A landing page is read in
 * sections across the full column; a transcript is read line by line and wants the
 * shorter line length.
 */
export const MEASURE = {
  /** A transcript, and app surfaces generally. */
  wide: 'max-w-2xl',
  /**
   * Two columns of transcript side by side, filling the window.
   *
   * `wide` was derived for a transcript read as ONE column, and it stayed put
   * when `/translate` became two. Split, it left each language about 250px —
   * narrower than a phone — because the halving happens after the 32px insets
   * and the 48px gutter come out.
   *
   * **This one deliberately breaks the line-length rule the others follow**, and
   * that is the owner's call after seeing both. The 45–75 character measure is
   * about continuous prose: it exists because the eye loses its place on the
   * return sweep from one long line to the start of the next. A transcript turn
   * is one or two sentences with a speaker chip above it and space below, so
   * there is barely a sweep to lose — and the cost of obeying the rule here is a
   * screen that is mostly gutter, which is what the layout is judged on.
   *
   * The cap is high rather than absent so an ultrawide does not get a single
   * sentence running a metre across the desk. Below roughly 1760px — every
   * laptop, and most desktops — it is never reached and the panels are simply
   * fluid.
   */
  workspace: 'max-w-[110rem]',
  /** Prose-led pages — an auth card, a short explanation. */
  reading: 'max-w-xl',
  /** The landing page's sections. */
  marketing: 'max-w-4xl',
} as const;

export type Measure = keyof typeof MEASURE;
