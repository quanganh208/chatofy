import { useEffect, useRef, useState } from 'react';

/**
 * "Submitted" state plus the accessibility fix every form with a fire-once
 * success notice needs: the form that held focus disappears the moment
 * `submitted` flips, so focus falls to `<body>`, at the top of the page, away
 * from the one sentence that says what happened. This moves it to that
 * sentence instead, the moment it becomes true.
 *
 * Returns the ref rather than doing the focusing itself so the caller's own
 * live region — `id`, wording and `role="status"` differ per form — stays in
 * the form's own JSX; only the state and the effect were ever identical
 * between forms.
 */
export function useSubmittedNotice<T extends HTMLElement = HTMLParagraphElement>() {
  const [submitted, setSubmitted] = useState(false);
  const notice = useRef<T>(null);

  useEffect(() => {
    if (submitted) notice.current?.focus();
  }, [submitted]);

  return { submitted, setSubmitted, notice } as const;
}
