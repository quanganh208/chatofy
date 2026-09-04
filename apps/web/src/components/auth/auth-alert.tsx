'use client';

/**
 * The place a form's failure appears, present before there is one.
 *
 * Two reasons it is drawn empty rather than inserted on demand, and they are the
 * same reason twice.
 *
 * **The card stops jumping.** Inserting a paragraph when the error arrives adds
 * its height and its gap to the form at the moment the reader is looking at the
 * submit button, moving the button out from under the pointer.
 *
 * **The message reliably announces.** A live region has to exist BEFORE its
 * content changes for assistive technology to report the change; a region created
 * together with its content is a coin flip across implementations. `role="alert"`
 * on a node that was always there, filled in, is the shape that speaks.
 *
 * The empty state carries no height and no margin — `grid-rows-[0fr]` collapses
 * the row without `display: none`, which would take the region out of the
 * accessibility tree and undo the point.
 */
export function AuthAlert({
  id,
  message,
  tone = 'error',
}: {
  id?: string;
  /** `undefined` while there is nothing to say. */
  message?: string;
  /** A failure, or the outcome of something that worked. */
  tone?: 'error' | 'status';
}) {
  return (
    <div
      className="duration-fast ease-standard grid grid-rows-[0fr] transition-[grid-template-rows] motion-reduce:transition-none data-[filled=true]:grid-rows-[1fr]"
      data-filled={message !== undefined}
    >
      <div className="overflow-hidden">
        <p
          id={id}
          // The role sits on the element that HOLDS the message, not on a wrapper
          // around it: a describedby target and a live region have to be the same
          // node, or a screen reader announces the change and then describes the
          // field with nothing.
          //
          // `alert` is assertive and `status` is polite, which is the whole
          // difference between "your sign-in failed" and "check your email".
          role={tone === 'error' ? 'alert' : 'status'}
          className={tone === 'error' ? 'text-destructive text-prose' : 'text-prose'}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
