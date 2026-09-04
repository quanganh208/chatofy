'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface DeleteConversationButtonProps {
  onConfirm: () => Promise<void>;
  /**
   * Id of the element stating what deleting costs.
   *
   * The sentence lives in the caller's delete zone so it is on screen before the
   * first press; this is what still attaches it to the control for a reader who
   * never sees the two are adjacent.
   */
  describedBy?: string;
}

/**
 * Delete, behind a confirmation.
 *
 * The first press is `outline`, like every other quiet control on the screen —
 * it deletes nothing. The press that does is `destructive`, so the irreversible
 * action does not look identical to "load more". That variant fills with
 * `live-fill` rather than `primary`, so it costs nothing against the screen's
 * one-accent budget, which the minutes panel's generate button spends.
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
 * A failure is said out loud. The caller navigates away on success, so silence
 * after a press that failed reads exactly like a delete that worked.
 */
export function DeleteConversationButton({
  onConfirm,
  describedBy,
}: DeleteConversationButtonProps) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-describedby={describedBy}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden /> {t('web.history.delete')}
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
          {t('web.history.deleteFailed')}
        </p>
      ) : null}
      <Button
        variant="destructive"
        size="sm"
        aria-describedby={describedBy}
        disabled={deleting}
        onClick={() => {
          setDeleting(true);
          setFailed(false);
          // The caller navigates away on success, so nothing here re-enables the
          // button on the happy path; a failure puts the reader back where they
          // were, with the confirmation still open and told what happened.
          void onConfirm()
            .catch(() => setFailed(true))
            .finally(() => setDeleting(false));
        }}
      >
        {deleting ? t('web.history.deleting') : t('web.history.delete')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
        {t('web.history.cancel')}
      </Button>
    </div>
  );
}
