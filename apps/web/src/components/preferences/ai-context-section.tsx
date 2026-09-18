'use client';

import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Skeleton } from '@chatofy/ui/react';
import { CONTEXT_LIMITS, type TranslationContext } from '@chatofy/types';
import { AiContextEditor } from './ai-context-editor';
import { draftOf, emptyDraft, glossaryOf, keywordsOf, type Draft } from './ai-context-draft';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { SettingsSection } from '@/components/layout/settings-section';
import { useTranslationContexts } from '@/hooks/use-translation-contexts';
import { useTranslate } from '@/i18n/provider';

/**
 * The AI Context library, and the editor that fills it.
 *
 * **This is the screen's SECOND and last elevated surface.** The first is
 * `ConversationDefaultsSection`. A library of named authored objects is a thing
 * you work on as a unit — you sit down and write a dictionary — which is what
 * earns a panel under the rule in `settings-section.tsx`. Nothing on this screen
 * may take a third.
 *
 * **The editor is INLINE and must never become a `Dialog`.** `surface-count.ts`
 * queries `document.body` precisely so portalled content is counted, so a dialog
 * would be that third surface and the gate would fail — correctly, because a
 * modal over a settings page is a second place to be rather than a section of
 * this one. The editor expands in place under the list, which is why
 * `ai-context-editor.tsx` renders into this panel instead of supplying one.
 *
 * **Accent.** Closed, this section spends ZERO accent-filled controls, which is a
 * normal answer: "New context" is `outline`, and both row controls are quieter
 * still. Open, the editor's `Save` is the screen's ONE accent — the thing you came
 * here to do, and it exists only while there is something to save.
 *
 * The draft lives here rather than inside the editor, because opening one is this
 * component's decision: a press on "New context" and a press on a row's "Edit"
 * differ only in what they seed, and both clear a failed save on the way in.
 * `ai-context-draft.ts` holds the shape they seed and the rules that bound it.
 */

/** A row's one-line summary in the list: what is actually in it. */
function summaryOf(context: TranslationContext): string {
  const parts: string[] = [];
  if (context.topic) parts.push(context.topic);
  if (context.hotwords.length) parts.push(`${context.hotwords.length} terms`);
  if (context.glossary.length) parts.push(`${context.glossary.length} renderings`);
  return parts.join(' · ');
}

export function AiContextSection() {
  const t = useTranslate();
  const { contexts, status, save, remove } = useTranslationContexts();
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
        glossary: glossaryOf(draft.glossary),
        style: draft.style,
      });
      setDraft(null);
    } catch {
      // The draft is deliberately kept: what the user typed is the expensive
      // thing here, and a failed write must not be a way to lose it.
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title={t('web.preferences.aiContext')}
      note={t('web.preferences.aiContextHint')}
      panel
    >
      {status === 'loading' ? (
        <Skeleton aria-hidden className="h-24" />
      ) : (
        <div className="flex flex-col gap-4 py-1">
          {status === 'failed' ? (
            <p className="text-muted-foreground text-hint">
              {t('web.preferences.aiContext.loadFailed')}
            </p>
          ) : null}

          {contexts.length === 0 && status === 'ready' ? (
            <p className="text-muted-foreground text-hint">
              {t('web.preferences.aiContext.empty')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {contexts.map((context) => (
                <li
                  key={context.id}
                  className="border-hairline flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body font-medium">{context.name}</span>
                    {summaryOf(context) ? (
                      <span className="text-muted-foreground text-hint">{summaryOf(context)}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
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
                      onConfirm={() => remove(context.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {draft === null ? (
            <div className="flex flex-col items-start gap-2">
              {/* `outline`, never filled. An independent test asserts this screen
                  draws ZERO accent-filled controls in its closed state, and the
                  budget's one accent belongs to Save inside the editor. */}
              <Button
                variant="outline"
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
          ) : (
            <AiContextEditor
              draft={draft}
              patch={patch}
              saving={saving}
              saveFailed={saveFailed}
              atLimitForNew={atLimit && !editingExisting}
              onSave={() => void saveDraft()}
              onCancel={() => setDraft(null)}
            />
          )}
        </div>
      )}
    </SettingsSection>
  );
}
