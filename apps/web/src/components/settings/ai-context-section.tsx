'use client';

import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Skeleton } from '@chatofy/ui/react';
import { CONTEXT_LIMITS, type TranslationContext } from '@chatofy/types';
import { AiContextEditor } from './ai-context-editor';
import { draftOf, emptyDraft, keywordsOf, type Draft } from './ai-context-draft';
import { useGlossaries } from '@/hooks/use-glossaries';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { notify } from '@/lib/notify';
import { SettingsSection } from './settings-section';
import { useTranslationContexts } from '@/hooks/use-translation-contexts';
import { useTranslate } from '@/i18n/provider';

/**
 * Settings › AI context: the library, and the editor that fills it.
 *
 * **Two hairline groups, no cards.** The library is one group: its rows, then a last
 * row holding "New context". The editor opens as a second group INLINE under it,
 * titled for what it is doing, rather than in a dialog: it is a long form you sit
 * down with (a name, a topic, up to a hundred terms, a register), and a modal over
 * the Settings dialog would be a second place to be while writing the one thing this
 * tab is for.
 *
 * **Accent.** Closed, this page spends ZERO accent-filled controls: "New context" is
 * `outline`, and both row controls are quieter still. Open, the editor's `Save` is
 * the page's ONE accent.
 *
 * **Outcomes are toasts.** A save closes the editor and says so; a delete says what
 * went. A failed save stays inline beside Save, with the draft kept — what the
 * reader typed is the expensive thing here.
 *
 * The draft lives here rather than inside the editor, because opening one is this
 * component's decision: a press on "New context" and a press on a row's "Edit"
 * differ only in what they seed. `ai-context-draft.ts` holds the shape they seed and
 * the rules that bound it.
 */

/** A row's one-line summary in the list: what is actually in it. */
function summaryOf(context: TranslationContext): string {
  const parts: string[] = [];
  if (context.topic) parts.push(context.topic);
  if (context.hotwords.length) parts.push(`${context.hotwords.length} terms`);
  if (context.linkedGlossaryName) parts.push(context.linkedGlossaryName);
  return parts.join(' · ');
}

export function AiContextSection() {
  const t = useTranslate();
  const { contexts, status, save, remove } = useTranslationContexts();
  const { glossaries } = useGlossaries();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const patch = useCallback(
    (next: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...next } : current)),
    [],
  );

  const atLimit = contexts.length >= CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER;
  // A replace is always allowed, even at the ceiling — the server says so too, or
  // a full library would be uneditable.
  const editingExisting = draft !== null && contexts.some((c) => c.id === draft.id);

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await save(draft.id, {
        name: draft.name.trim(),
        topic: draft.topic.trim() || null,
        hotwords: keywordsOf(draft.hotwords),
        glossary: [],
        style: draft.style,
        glossaryId: draft.glossaryId,
      });
      setDraft(null);
      notify.success(t('web.settings.contextSaved', { name: draft.name.trim() }), {
        id: `context-${draft.id}`,
      });
    } catch {
      // The draft is deliberately kept: what the user typed is the expensive
      // thing here, and a failed write must not be a way to lose it.
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const editorTitle = editingExisting
    ? t('web.preferences.aiContext.editTitle')
    : t('web.preferences.aiContext.new');

  return (
    <div className="flex flex-col gap-6">
      {/* The library. The pane's own line says what the tab is in one sentence; the
          longer "what is it for" lives here, as the group's note, where it is read
          once beside the list it explains. */}
      <SettingsSection
        title={t('web.preferences.aiContext.libraryTitle')}
        note={t('web.preferences.aiContextHint')}
      >
        {status === 'loading' ? (
          <div className="py-3.5">
            <Skeleton aria-hidden className="h-16" />
          </div>
        ) : (
          <>
            {status === 'failed' ? (
              <p className="text-muted-foreground text-hint py-3.5">
                {t('web.preferences.aiContext.loadFailed')}
              </p>
            ) : null}

            {contexts.length === 0 ? (
              status === 'ready' ? (
                <p className="text-prose text-body py-5" data-ai-context-empty>
                  {t('web.preferences.aiContext.empty')}
                </p>
              ) : null
            ) : (
              <ul className="divide-hairline flex flex-col divide-y">
                {contexts.map((context) => (
                  // Stacked on a phone, where the name needs the width; beside each other
                  // from `sm` up. Stacked, the ghost actions are pulled left by their
                  // own padding so their words line up under the name.
                  <li
                    key={context.id}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-body truncate font-medium">{context.name}</span>
                      {summaryOf(context) ? (
                        <span className="text-muted-foreground text-hint truncate">
                          {summaryOf(context)}
                        </span>
                      ) : null}
                    </div>
                    <div className="-ml-3 flex shrink-0 items-center gap-1 sm:ml-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('web.preferences.aiContext.edit')} ${context.name}`}
                        onClick={() => {
                          setSaveFailed(false);
                          setDraft(draftOf(context));
                        }}
                      >
                        {t('web.preferences.aiContext.edit')}
                      </Button>
                      <ConfirmDeleteButton
                        name={context.name}
                        triggerVariant="ghost"
                        withIcon={false}
                        labels={{
                          action: t('web.preferences.aiContext.delete'),
                          pending: t('web.preferences.aiContext.deleting'),
                          cancel: t('web.preferences.aiContext.cancel'),
                          failed: t('web.preferences.aiContext.deleteFailed'),
                        }}
                        onConfirm={async () => {
                          await remove(context.id);
                          notify.success(t('web.settings.contextDeleted', { name: context.name }), {
                            id: `context-${context.id}`,
                          });
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Hidden while the editor is open: one draft at a time, and the editor
                below already says which. */}
            {draft === null ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                {/* `outline`, never filled: the tab spends ZERO accent while the
                    editor is closed, and its one accent belongs to Save. */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={atLimit}
                  onClick={() => {
                    setSaveFailed(false);
                    setDraft(emptyDraft());
                  }}
                >
                  <Plus aria-hidden /> {t('web.preferences.aiContext.new')}
                </Button>
                {/* The words explain the refusal, rather than leaving a dead control. */}
                {atLimit ? (
                  <span className="text-muted-foreground text-hint">
                    {t('web.preferences.aiContext.limitReached')}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </SettingsSection>

      {draft !== null ? (
        <SettingsSection title={editorTitle}>
          <AiContextEditor
            draft={draft}
            patch={patch}
            saving={saving}
            saveFailed={saveFailed}
            atLimitForNew={atLimit && !editingExisting}
            glossaries={glossaries}
            onSave={() => void saveDraft()}
            onCancel={() => setDraft(null)}
          />
        </SettingsSection>
      ) : null}
    </div>
  );
}
