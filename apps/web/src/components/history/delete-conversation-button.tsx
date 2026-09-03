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
 * `destructive-outline`, never filled: the detail screen's one accent-filled
 * control is the minutes panel's generate button, and a filled delete beside it
 * would make two — with the louder of the two being the irreversible one.
 *
 * Two-step in place rather than a dialog. The action is one row deep and the
 * consequence fits in a sentence, so a modal would be more ceremony than the
 * decision needs; what matters is that the first press cannot delete anything.
 */
export function DeleteConversationButton({ onConfirm }: DeleteConversationButtonProps) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> {t('web.history.delete')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-muted-foreground text-hint">{t('web.history.deleteConfirm')}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={deleting}
        onClick={() => {
          setDeleting(true);
          // The caller navigates away on success, so nothing here re-enables the
          // button on the happy path; a failure puts the reader back where they
          // were, with the confirmation still open.
          void onConfirm().finally(() => setDeleting(false));
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
