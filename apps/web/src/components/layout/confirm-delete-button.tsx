'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';

/** The four strings a confirmation needs, supplied by whatever is being deleted. */
interface ConfirmDeleteLabels {
  /** The verb, on both the trigger and the button that acts. */
  action: string;
  /** The verb while the request is out. */
  pending: string;
  cancel: string;
  /** Said out loud when the request comes back refused. */
  failed: string;
}

interface ConfirmDeleteButtonProps {
  onConfirm: () => Promise<void>;
  labels: ConfirmDeleteLabels;
  /**
   * Id of the element stating what deleting costs.
   *
   * The sentence lives in the caller's delete zone so it is on screen before the
   * first press; this is what still attaches it to the control for a reader who
   * never sees the two are adjacent.
   */
  describedBy?: string;
  /**
   * What this one deletes, appended to every button's accessible name.
   *
   * For a control that appears once on a screen the visible label is already
   * unambiguous and this stays unset. In a LIST it is the whole difference
   * between "Delete, Delete, Delete" and knowing which row is about to go.
   */
  name?: string;
  /** The quiet variant for the first press. `outline` unless the row is denser. */
  triggerVariant?: 'outline' | 'ghost';
  /** The trash icon, which a dense list generally does not want. */
  withIcon?: boolean;
}

/**
 * Delete, behind a confirmation.
 *
 * The first press is quiet — it deletes nothing. The press that does is
 * `destructive`, so the irreversible action does not look identical to "load
 * more". That variant fills with `live-fill` rather than `primary`, so it costs
 * nothing against a screen's one-accent budget.
 *
 * Two-step in place rather than a dialog. The action is one row deep and the
 * consequence fits in a sentence, so a modal would be more ceremony than the
 * decision needs; what matters is that the first press cannot delete anything.
 *
 * The consequence sentence is NOT here. It belongs to the delete zone the caller
 * draws, so it is on screen before the first press rather than arriving with the
 * second button — a warning that appears only once you have already committed to
 * looking is a warning arriving late.
 *
 * A failure is said out loud. A caller that navigates away or drops the row on
 * success leaves nothing on screen, so silence after a press that failed reads
 * exactly like a delete that worked.
 *
 * Shared rather than copied, because the focus handling below is the part that
 * is expensive to get right and cheap to forget: an inline second implementation
 * of this shipped without any of it, and a keyboard user pressing Delete was
 * thrown to the top of the document. One copy is one place to fix.
 */
export function ConfirmDeleteButton({
  onConfirm,
  labels,
  describedBy,
  name,
  triggerVariant = 'outline',
  withIcon = true,
}: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  /** The visible word plus what it acts on, for a reader who has only the name. */
  const label = (text: string) => (name ? `${text} ${name}` : undefined);

  // Each step swaps out the button that was pressed, and the browser drops focus
  // to `<body>` when it goes — the top of the document, above everything, for
  // somebody who was partway down a page. Both directions put it somewhere in
  // the new step instead.
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    // Cancel, not Confirm. The press that opens this step is as often a keyboard
    // Enter as a click, and a key held a beat too long repeats — focus on the
    // destructive button would let one keystroke take both steps, which is the
    // whole of what a two-step exists to prevent. The confirm is one Shift+Tab
    // away for somebody who meant it.
    if (confirming) {
      cancel.current?.focus();
      return;
    }
    // Flagged rather than focused straight after `setConfirming`, and only for a
    // press that dismissed the step: the trigger does not exist yet at that
    // point, and the first render must not steal focus from the page.
    if (!returning.current) return;
    returning.current = false;
    trigger.current?.focus();
  }, [confirming]);

  // The third direction, and the one that costs most. The destructive press
  // disables both buttons for the length of the request, and a browser blurs an
  // element that becomes disabled — so focus sits on `<body>` while the delete is
  // out, and a failure leaves it there: the alert is announced, and the reader is
  // at the top of the document rather than beside the retry it is telling them
  // about. `deleting` is in the deps because that is what re-enables the button;
  // focusing it while it is still disabled does nothing.
  useEffect(() => {
    if (!failed || deleting) return;
    confirm.current?.focus();
  }, [failed, deleting]);

  if (!confirming) {
    return (
      <Button
        ref={trigger}
        variant={triggerVariant}
        size="sm"
        aria-describedby={describedBy}
        aria-label={label(labels.action)}
        onClick={() => {
          setFailed(false);
          setConfirming(true);
        }}
      >
        {/* No literal space between the two: `Button` already spaces its icon
            with `gap-2`, and the space is a text node that survives an absent
            icon — leaving the control reading " Delete", leading space and all,
            in its accessible name and in anything matching on its text. */}
        {withIcon ? <Trash2 aria-hidden /> : null}
        {labels.action}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Inserted rather than swapped into a paragraph already on screen. A
          screen reader announces an alert that ARRIVES; rewriting the text of a
          node that was already there announces nothing, and the state after a
          press that failed would sound exactly like the state before it — the
          silence this message exists to break. */}
      {failed ? (
        <p role="alert" className="text-destructive text-hint">
          {labels.failed}
        </p>
      ) : null}
      <Button
        ref={confirm}
        variant="destructive"
        size="sm"
        aria-describedby={describedBy}
        aria-label={label(labels.action)}
        disabled={deleting}
        onClick={() => {
          setDeleting(true);
          setFailed(false);
          // Nothing here re-enables the button on the happy path: the caller
          // either navigates away or drops the row, and this component goes with
          // it. A failure puts the reader back where they were, with the
          // confirmation still open and told what happened.
          void onConfirm()
            .catch(() => setFailed(true))
            .finally(() => setDeleting(false));
        }}
      >
        {deleting ? labels.pending : labels.action}
      </Button>
      <Button
        ref={cancel}
        variant="ghost"
        size="sm"
        aria-label={label(labels.cancel)}
        onClick={() => {
          returning.current = true;
          setConfirming(false);
        }}
        disabled={deleting}
      >
        {labels.cancel}
      </Button>
    </div>
  );
}
