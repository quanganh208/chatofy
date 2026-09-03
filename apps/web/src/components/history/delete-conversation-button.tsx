'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface DeleteConversationButtonProps {
  onConfirm: () => Promise<void>;
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
 * A failure is said out loud. The caller navigates away on success, so silence
 * after a press that failed reads exactly like a delete that worked.
 */
export function DeleteConversationButton({ onConfirm }: DeleteConversationButtonProps) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> {t('web.history.delete')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Two elements with distinct keys, not one whose text is swapped. Swapping
          the sentence in place keeps the same DOM node, so a screen reader
          announces nothing and the state after a press that failed sounds
          exactly like the state before it — the silence this message exists to
          break. A separate node carrying `role="alert"` is inserted when the
          delete fails, and an inserted alert is spoken. */}
      {failed ? (
        <p key="failed" role="alert" className="text-destructive text-hint">
          {t('web.history.deleteFailed')}
        </p>
      ) : (
        <p key="confirm" className="text-muted-foreground text-hint">
          {t('web.history.deleteConfirm')}
        </p>
      )}
      <Button
        variant="destructive"
        size="sm"
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
