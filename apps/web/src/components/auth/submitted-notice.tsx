'use client';

import type { RefObject } from 'react';

/**
 * The live region `ForgotPasswordForm` and `RegisterForm` replace their form
 * with on success.
 *
 * Mounted from the start and never unmounted, for the reason `auth-alert.tsx`
 * sets out for the failure path: a live region has to exist BEFORE its
 * content changes for assistive technology to report the change, and one
 * created in the same commit as its text is a coin flip across
 * implementations.
 *
 * `sr-only` rather than absent while empty, so the region is in the
 * accessibility tree the whole time without spending a row of the card's
 * column above the form. `hidden` would collapse it and undo the point.
 *
 * `ref` is the caller's own `useSubmittedNotice().notice` — the form goes when
 * `submitted` flips, and the submit button that was pressed goes with it, so
 * focus fell to `<body>`, at the top of the page, away from the one sentence
 * that says what happened. Moving focus here is that hook's job; this
 * component only renders the target.
 */
export function SubmittedNotice({
  id,
  submitted,
  message,
  ref,
}: {
  id: string;
  submitted: boolean;
  message: string;
  ref: RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <p
      id={id}
      role="status"
      ref={ref}
      // Focusable only as a destination — never in the tab order, where an
      // empty paragraph would be a stop that says nothing.
      tabIndex={-1}
      className={submitted ? 'text-prose' : 'sr-only'}
    >
      {submitted ? message : null}
    </p>
  );
}
