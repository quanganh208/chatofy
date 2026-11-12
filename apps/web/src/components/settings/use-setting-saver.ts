'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';

/** How long after the last change a burst of changes to one setting counts as over. */
export const SETTING_BURST_MS = 4500;

/**
 * Autosave, said out loud: every change to a setting confirms itself with a toast
 * that can undo it.
 *
 * **One toast per setting.** The toast id is the setting's, so dragging a slider
 * through twelve values replaces one toast twelve times rather than stacking twelve.
 *
 * **Undo goes back to before the burst, not one step.** The snapshot is taken on the
 * first change of a burst and kept until the setting has been left alone for
 * {@link SETTING_BURST_MS} (about as long as the toast stays up), so Undo after a drag
 * restores the value the reader started from — the one they know — rather than the
 * value one pixel before where they let go.
 *
 * `restore` builds the patch that puts the setting back. The default copies the
 * patched keys from the snapshot, which is right for a top-level field; a setting
 * nested inside a shared object (one language's voice in `voiceByLanguage`, one
 * processor in `micProcessing`) passes its own, so undoing it leaves its siblings —
 * possibly changed since — alone.
 *
 * **The toasts go when the saver does.** Undo calls `apply` from this instance; after
 * the reader has left the page another instance (the translator's) has already loaded
 * the pre-undo value and its next save would write it back, so an undo there would be
 * lost. Leaving the page dismisses every `setting-*` toast it raised.
 */
export function useSettingSaver<T extends object>(
  apply: (patch: Partial<T>) => void,
  read: () => T,
) {
  const t = useTranslate();
  const bursts = useRef(new Map<string, { before: T; timer: ReturnType<typeof setTimeout> }>());
  // Every toast this saver raised, which may outlive its burst.
  const raised = useRef(new Set<string>());

  useEffect(() => {
    const open = bursts.current;
    const toasts = raised.current;
    return () => {
      for (const burst of open.values()) clearTimeout(burst.timer);
      open.clear();
      for (const toastId of toasts) notify.dismiss(toastId);
      toasts.clear();
    };
  }, []);

  return useCallback(
    (
      id: string,
      name: string,
      patch: Partial<T>,
      restore: (before: T, now: T) => Partial<T> = (before) => pick(before, patch),
    ) => {
      // A patch that changes nothing (a two-way pair the turn identification cannot
      // run) is not a save, so it gets no confirmation.
      if (Object.keys(patch).length === 0) return;
      const open = bursts.current;
      const existing = open.get(id);
      const before = existing ? existing.before : read();
      if (existing) clearTimeout(existing.timer);
      open.set(id, {
        before,
        timer: setTimeout(() => open.delete(id), SETTING_BURST_MS),
      });

      apply(patch);

      const toastId = `setting-${id}`;
      raised.current.add(toastId);
      notify.success(t('web.settings.saved', { setting: name }), {
        id: toastId,
        undo: () => {
          const burst = open.get(id);
          if (burst) clearTimeout(burst.timer);
          open.delete(id);
          apply(restore(before, read()));
        },
      });
    },
    [apply, read, t],
  );
}

/** The fields of `source` that `patch` names. */
function pick<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) out[key] = source[key];
  return out;
}
