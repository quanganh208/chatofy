'use client';

import { useState } from 'react';
import { Cloud, CloudAlert } from 'lucide-react';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingsSectionRow } from './settings-section';

/**
 * One quiet line under a tab's settings: they follow the account, and whether the
 * last change has reached it.
 *
 * Inline, never a toast: it describes a state that holds while true (saving, saved,
 * a save that is being retried), which is what the inline shape is for. Each change
 * already confirms with its own toast and Undo (`use-setting-saver.ts`); this says
 * where that change went.
 *
 * "Saved" appears only once something was saved since the tab opened — before that,
 * the line is just where the settings live. A failed save keeps retrying on its own
 * (the store backs off and tries again, and again on reconnect), so the line says so
 * rather than asking for a press. A REFUSED save is different and says so: the
 * server turned that change down for good, the store dropped it and re-read what is
 * stored, so nothing is retrying — the line holds until the next change.
 */
export function PreferencesSyncNote() {
  const t = useTranslate();
  const { status, synced } = usePreferences();
  // Derived during render, not in an effect: "a save happened while this was shown".
  const [sawSave, setSawSave] = useState(false);
  if (status === 'saving' && !sawSave) setSawSave(true);

  if (!synced) return null;
  const failed = status === 'error' || status === 'refused';
  const state =
    status === 'saving'
      ? t('common.preferences.saving')
      : status === 'refused'
        ? t('common.preferences.saveRefused')
        : status === 'error'
          ? t('common.preferences.saveRetrying')
          : sawSave
            ? t('common.preferences.saved')
            : null;
  const Icon = failed ? CloudAlert : Cloud;

  return (
    <p
      data-preferences-sync={status}
      role="status"
      className="text-muted-foreground text-hint flex items-start gap-2 px-1"
    >
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        {t('common.preferences.syncNote')}
        {state ? (
          <>
            {' · '}
            <span className={cn(failed && 'text-destructive')}>{state}</span>
          </>
        ) : null}
      </span>
    </p>
  );
}

/**
 * Settings › General's last group: reset every synced preference to its default.
 *
 * Behind a confirmation because it reaches every device at once and cannot be
 * undone by Undo — there is no "before" kept anywhere but the server row it drops.
 * The press that resets is `destructive`, which costs nothing against the screen's
 * one-accent budget, and a failure stays inline in the dialog (`ConfirmDeleteButton`).
 * What it leaves alone is named in the note: the reader's own work — AI contexts,
 * glossaries, history — and this device's microphone setup are not preferences.
 */
export function PreferencesSyncSection() {
  const t = useTranslate();
  const { reset, synced } = usePreferences();
  if (!synced) return null;

  return (
    <div className="flex flex-col gap-3">
      <SettingsSection title={t('common.preferences.title')}>
        <SettingsSectionRow
          label={t('common.preferences.reset')}
          note={t('common.preferences.resetNote')}
        >
          <span data-preferences-reset className="contents">
            <ConfirmDeleteButton
              withIcon={false}
              description={t('common.preferences.resetNote')}
              labels={{
                action: t('common.preferences.reset'),
                pending: t('common.preferences.resetPending'),
                cancel: t('web.account.changePasswordCancel'),
                failed: t('common.preferences.resetFailed'),
              }}
              onConfirm={async () => {
                await reset();
                notify.success(t('common.preferences.resetDone'), { id: 'preferences-reset' });
              }}
            />
          </span>
        </SettingsSectionRow>
      </SettingsSection>
      <PreferencesSyncNote />
    </div>
  );
}
