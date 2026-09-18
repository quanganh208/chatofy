'use client';

import { Button, Input, Label, SegmentedControl, Separator, Textarea } from '@chatofy/ui/react';
import { CONTEXT_LIMITS } from '@chatofy/types';
import { AiContextGlossaryFields } from './ai-context-glossary-fields';
import {
  hotwordLinesOf,
  hotwordTooLong,
  tooLong,
  tooManyHotwords,
  type Draft,
} from './ai-context-draft';
import { useTranslate } from '@/i18n/provider';

/**
 * The form that fills the AI Context library, and every refusal it shows.
 *
 * **It supplies no surface of its own and must never become a `Dialog`.** It
 * renders INLINE inside the panel `ai-context-section.tsx` already owns, which is
 * the screen's second and last elevated surface. `surface-count.ts` queries
 * `document.body` precisely so portalled content is counted, so a dialog here
 * would be a third surface and the gate would fail — correctly, because a modal
 * over a settings page is a second place to be rather than a section of this one.
 *
 * **Save is the screen's ONE accent-filled control**, and it exists only while
 * this editor is on screen. Everything else here is `outline` or `ghost`, so the
 * section spends zero accent when the editor is closed.
 *
 * The draft itself is owned by the section, not by this component: the section is
 * what opens the editor, what decides whether a press means "a new context" or
 * "this stored one", and what clears a failed save on the way in. A copy of the
 * state down here would make each of those a message passed back up.
 */
export function AiContextEditor({
  draft,
  patch,
  saving,
  saveFailed,
  atLimitForNew,
  onSave,
  onCancel,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  saving: boolean;
  saveFailed: boolean;
  /** The library is full and this draft would add to it rather than replace a row. */
  atLimitForNew: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslate();

  const hasOverlongPair = draft.glossary.some(tooLong);
  const hasOverlongHotword = hotwordTooLong(draft.hotwords);
  const hasTooManyHotwords = tooManyHotwords(draft.hotwords);
  const hotwordCount = hotwordLinesOf(draft.hotwords).length;

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-context-name">{t('web.preferences.aiContext.name')}</Label>
          <Input
            id="ai-context-name"
            value={draft.name}
            maxLength={CONTEXT_LIMITS.MAX_NAME_CHARS}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-context-topic">{t('web.preferences.aiContext.description')}</Label>
          <Textarea
            id="ai-context-topic"
            value={draft.topic}
            maxLength={CONTEXT_LIMITS.MAX_TOPIC_CHARS}
            onChange={(event) => patch({ topic: event.target.value })}
          />
          <span className="text-muted-foreground text-hint">
            {t('web.preferences.aiContext.descriptionHint')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-context-keywords">{t('web.preferences.aiContext.keywords')}</Label>
          <Textarea
            id="ai-context-keywords"
            value={draft.hotwords}
            // No `maxLength`, deliberately, where `name`, `topic` and both
            // glossary sides carry one. Those bound a SINGLE value, so the
            // cap stops a keystroke past the limit and the writer sees it
            // stop. This field holds a whole list, and its ceilings are
            // per line and per count — neither of which a character total
            // expresses. A total long enough to allow a full list would cut
            // a pasted longer one mid-keyword and say nothing, which is the
            // silent truncation `keywordsOf` refuses to perform. The
            // refusals below do the bounding, in words, with Save disabled.
            aria-invalid={hasOverlongHotword || hasTooManyHotwords}
            onChange={(event) => patch({ hotwords: event.target.value })}
          />
          <span className="text-muted-foreground text-hint">
            {t('web.preferences.aiContext.keywordsHint')}
          </span>
          {/* Named refusals, the same rule the glossary follows below:
              silently keeping only the first 48 lines — this field's own
              earlier behaviour — is the exact silent truncation the
              glossary refuses to do. */}
          {hasOverlongHotword ? (
            <span className="text-muted-foreground text-hint">
              {t('web.preferences.aiContext.keywordTooLong', {
                max: CONTEXT_LIMITS.MAX_HOTWORD_CHARS,
              })}
            </span>
          ) : null}
          {hasTooManyHotwords ? (
            <span className="text-muted-foreground text-hint">
              {t('web.preferences.aiContext.keywordsTooMany', {
                count: hotwordCount,
                max: CONTEXT_LIMITS.MAX_HOTWORDS,
              })}
            </span>
          ) : null}
        </div>

        <AiContextGlossaryFields
          rows={draft.glossary}
          onChange={(glossary) => patch({ glossary })}
        />

        <SegmentedControl
          label={t('web.preferences.aiContext.register')}
          value={draft.style}
          options={[
            { value: 'neutral', label: t('web.translate.registerNeutral') },
            { value: 'formal', label: t('web.translate.registerFormal') },
            { value: 'casual', label: t('web.translate.registerCasual') },
          ]}
          onChange={(style) => patch({ style })}
        />

        {saveFailed ? (
          <p className="text-muted-foreground text-hint">
            {t('web.preferences.aiContext.saveFailed')}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          {/* The screen's ONE accent-filled control, and it exists only
              while the editor is open. */}
          <Button
            disabled={
              saving ||
              !draft.name.trim() ||
              hasOverlongPair ||
              hasOverlongHotword ||
              hasTooManyHotwords ||
              atLimitForNew
            }
            onClick={onSave}
          >
            {saving ? t('web.preferences.aiContext.saving') : t('web.preferences.aiContext.save')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('web.preferences.aiContext.cancel')}
          </Button>
        </div>
      </div>
    </>
  );
}
