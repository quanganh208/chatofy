'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  SegmentedControl,
  Separator,
  Skeleton,
  Textarea,
} from '@chatofy/ui/react';
import { CONTEXT_LIMITS, countTermWords, type TranslationContext } from '@chatofy/types';
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
 * this one. The editor expands in place under the list.
 *
 * **Accent.** Closed, this section spends ZERO accent-filled controls, which is a
 * normal answer: "New context" is `outline`, and both row controls are quieter
 * still. Open, `Save` is the screen's ONE accent — the thing you came here to do,
 * and it exists only while there is something to save.
 *
 * The glossary is a repeating pair of fields, never a free-text blob: an entry is
 * TWO correlated strings, and one box to type both into makes a desynchronized
 * pair representable. The pair is keyed by LANGUAGE rather than by role, so one
 * dictionary serves a conversation running in either direction — which is why the
 * columns are named for the two languages and not for "from" and "to".
 */

/** The editor's working copy — a context being written, not one that is stored. */
interface Draft {
  /** The client-minted id. Absent for a context that has never been saved. */
  id: string;
  name: string;
  topic: string;
  /** One per line, which is how a person writes a list of names. */
  hotwords: string;
  glossary: { vi: string; en: string }[];
  style: 'neutral' | 'formal' | 'casual';
}

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: '',
  topic: '',
  hotwords: '',
  glossary: [{ vi: '', en: '' }],
  style: 'neutral',
});

const draftOf = (context: TranslationContext): Draft => ({
  id: context.id,
  name: context.name,
  topic: context.topic ?? '',
  hotwords: context.hotwords.join('\n'),
  // Always at least one empty row, so the editor opens with somewhere to type
  // rather than with a button that has to be found first.
  glossary: context.glossary.length
    ? context.glossary.map((e) => ({ ...e }))
    : [{ vi: '', en: '' }],
  style: context.style ?? 'neutral',
});

/** One entry per line, blank lines dropped and each trimmed. */
const hotwordLinesOf = (raw: string): string[] =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * What a save actually sends. NOT capped here — unlike the glossary, nothing on
 * this field structurally keeps the writer at or under the ceiling as they type,
 * so slicing silently would save a context missing the terms past the cut. The
 * editor instead refuses to save over the limit and says so, the way it already
 * does for an overlong rendering below.
 */
const keywordsOf = (raw: string): string[] => hotwordLinesOf(raw);

/** One line longer than the contract's per-term character cap. */
const hotwordTooLong = (raw: string): boolean =>
  hotwordLinesOf(raw).some((line) => line.length > CONTEXT_LIMITS.MAX_HOTWORD_CHARS);

/** More terms than the contract accepts. */
const tooManyHotwords = (raw: string): boolean =>
  hotwordLinesOf(raw).length > CONTEXT_LIMITS.MAX_HOTWORDS;

/**
 * Whether one side of a pair is a sentence rather than a term.
 *
 * Shown to the writer rather than fixed for them. The contract refuses a side
 * over `MAX_GLOSSARY_TERM_WORDS`, and silently dropping the pair here would save
 * a context missing the entry the person just typed — so the editor names the
 * row and refuses to save until it is shortened.
 *
 * `countTermWords` is the contract's own count, imported rather than
 * reimplemented: a second copy is how the editor's refusal and the schema's come
 * to disagree about the same term.
 *
 * An empty side is not over the cap and is not flagged: the editor always
 * carries a trailing blank pair so there is somewhere to type.
 */
const sideTooLong = (term: string): boolean =>
  countTermWords(term) > CONTEXT_LIMITS.MAX_GLOSSARY_TERM_WORDS;

const tooLong = (row: { vi: string; en: string }): boolean =>
  sideTooLong(row.vi) || sideTooLong(row.en);

/**
 * Pairs with both sides filled, capped.
 *
 * A half-filled pair is DROPPED WHOLE rather than saved with one side empty: half
 * a pair names a rendering of nothing, the contract refuses it, and the last row
 * of the editor is empty by design.
 */
const glossaryOf = (rows: { vi: string; en: string }[]) =>
  rows
    .map((row) => ({ vi: row.vi.trim(), en: row.en.trim() }))
    .filter((row) => row.vi && row.en)
    .slice(0, CONTEXT_LIMITS.MAX_GLOSSARY);

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
  // Delete, behind a two-step confirmation — the pattern `delete-conversation-
  // button.tsx` uses for the same reason: the first press must not be able to
  // destroy a hand-authored dictionary, and a failed request must say so rather
  // than leave the row silently still there. Keyed by id rather than a single
  // flag, because it is one control among several rows.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);

  const onDelete = (contextId: string) => {
    setDeletingId(contextId);
    setDeleteFailedId(null);
    remove(contextId)
      .then(() => setConfirmingDeleteId(null))
      .catch(() => setDeleteFailedId(contextId))
      .finally(() => setDeletingId(null));
  };

  // Each step swaps out the button that was pressed, and the browser drops focus
  // to `<body>` when it goes — the top of `/preferences`, above every section,
  // for somebody who was partway down a list of contexts. One row confirms at a
  // time, so the confirm and cancel of the open step need one ref each; the
  // triggers need a ref per row, because the one to return focus to is the row
  // whose step was just dismissed.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const returningTo = useRef<string | null>(null);

  useEffect(() => {
    // Cancel, not the destructive button. The press that opens this step is as
    // often a keyboard Enter as a click, and a key held a beat too long repeats
    // — focus on Delete would let one keystroke take both steps, which is the
    // whole of what a two-step exists to prevent.
    if (confirmingDeleteId !== null) {
      cancelRef.current?.focus();
      return;
    }
    // Flagged by the press that dismissed the step rather than focused straight
    // after it: the trigger does not exist yet at that point. A step closed by a
    // SUCCESSFUL delete sets nothing here — that row is gone, and there is no
    // longer a control on screen that belongs to it.
    const returning = returningTo.current;
    if (returning === null) return;
    returningTo.current = null;
    triggerRefs.current.get(returning)?.focus();
  }, [confirmingDeleteId]);

  // The third direction, and the one that costs most: the destructive press
  // disables both buttons for the length of the request, and a browser blurs an
  // element that becomes disabled — so focus sits on `<body>` while the delete is
  // out, and a failure leaves it there, announcing an alert to a reader parked at
  // the top of the document rather than beside the retry. `deletingId` is in the
  // deps because that is what re-enables the button; focusing it while it is
  // still disabled does nothing.
  useEffect(() => {
    if (deleteFailedId === null || deletingId !== null) return;
    confirmRef.current?.focus();
  }, [deleteFailedId, deletingId]);

  const patch = useCallback(
    (next: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...next } : current)),
    [],
  );

  const atLimit = contexts.length >= CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER;
  const hasOverlongPair = draft?.glossary.some(tooLong) ?? false;
  const hasOverlongHotword = draft ? hotwordTooLong(draft.hotwords) : false;
  const hasTooManyHotwords = draft ? tooManyHotwords(draft.hotwords) : false;
  const hotwordCount = draft ? hotwordLinesOf(draft.hotwords).length : 0;
  // A replace is always allowed, even at the ceiling — the server says so too, or
  // a full library would be uneditable.
  const editingExisting = draft !== null && contexts.some((c) => c.id === draft.id);

  const onSave = async () => {
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
                    {confirmingDeleteId === context.id ? (
                      <>
                        {/* Inserted rather than swapped into a paragraph already on
                            screen, so a screen reader announces it as arriving —
                            the same reason `delete-conversation-button.tsx` gives. */}
                        {deleteFailedId === context.id ? (
                          <p role="alert" className="text-destructive text-hint">
                            {t('web.preferences.aiContext.deleteFailed')}
                          </p>
                        ) : null}
                        {/* Every one of the three carries the row's name. A list
                            of these reads as "Delete, Delete, Delete" otherwise,
                            and the one that matters is the irreversible one. */}
                        <Button
                          ref={confirmRef}
                          variant="destructive"
                          size="sm"
                          disabled={deletingId === context.id}
                          onClick={() => onDelete(context.id)}
                          aria-label={`${t('web.preferences.aiContext.delete')} ${context.name}`}
                        >
                          {deletingId === context.id
                            ? t('web.preferences.aiContext.deleting')
                            : t('web.preferences.aiContext.delete')}
                        </Button>
                        <Button
                          ref={cancelRef}
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === context.id}
                          onClick={() => {
                            returningTo.current = context.id;
                            setConfirmingDeleteId(null);
                          }}
                          aria-label={`${t('web.preferences.aiContext.cancel')} ${context.name}`}
                        >
                          {t('web.preferences.aiContext.cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        ref={(node) => {
                          triggerRefs.current.set(context.id, node);
                        }}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteFailedId(null);
                          setConfirmingDeleteId(context.id);
                        }}
                        aria-label={`${t('web.preferences.aiContext.delete')} ${context.name}`}
                      >
                        {t('web.preferences.aiContext.delete')}
                      </Button>
                    )}
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
                  <Label htmlFor="ai-context-topic">
                    {t('web.preferences.aiContext.description')}
                  </Label>
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
                  <Label htmlFor="ai-context-keywords">
                    {t('web.preferences.aiContext.keywords')}
                  </Label>
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
                    // silent truncation `keywordsOf` above refuses to perform. The
                    // refusals below do the bounding, in words, with Save disabled.
                    aria-invalid={hasOverlongHotword || hasTooManyHotwords}
                    onChange={(event) => patch({ hotwords: event.target.value })}
                  />
                  <span className="text-muted-foreground text-hint">
                    {t('web.preferences.aiContext.keywordsHint')}
                  </span>
                  {/* Named refusals, the same rule the glossary follows below:
                      silently keeping only the first 48 lines — this field's own
                      earlier behaviour — is the exact silent truncation this
                      component's glossary refuses to do. */}
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

                <div className="flex flex-col gap-2">
                  <span className="text-body font-medium">
                    {t('web.preferences.aiContext.glossary')}
                  </span>
                  <span className="text-muted-foreground text-hint">
                    {t('web.preferences.aiContext.glossaryHint')}
                  </span>
                  <div className="flex flex-col gap-2">
                    {draft.glossary.map((row, index) => {
                      const viTooLong = sideTooLong(row.vi);
                      const enTooLong = sideTooLong(row.en);
                      return (
                        // Indexed because nothing addresses one entry: the whole
                        // context is PUT, so the rows have no stable id to key on
                        // and the list is only ever rewritten as a unit.
                        <div key={index} className="flex flex-col gap-1">
                          <div className="flex items-end gap-2">
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <Label
                                htmlFor={`ai-context-glossary-vi-${index}`}
                                className="text-muted-foreground text-hint"
                              >
                                {t('web.preferences.aiContext.glossaryVi')}
                              </Label>
                              <Input
                                id={`ai-context-glossary-vi-${index}`}
                                value={row.vi}
                                maxLength={CONTEXT_LIMITS.MAX_GLOSSARY_TERM_CHARS}
                                aria-invalid={viTooLong}
                                onChange={(event) =>
                                  patch({
                                    glossary: draft.glossary.map((entry, at) =>
                                      at === index ? { ...entry, vi: event.target.value } : entry,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <Label
                                htmlFor={`ai-context-glossary-en-${index}`}
                                className="text-muted-foreground text-hint"
                              >
                                {t('web.preferences.aiContext.glossaryEn')}
                              </Label>
                              <Input
                                id={`ai-context-glossary-en-${index}`}
                                value={row.en}
                                maxLength={CONTEXT_LIMITS.MAX_GLOSSARY_TERM_CHARS}
                                aria-invalid={enTooLong}
                                onChange={(event) =>
                                  patch({
                                    glossary: draft.glossary.map((entry, at) =>
                                      at === index ? { ...entry, en: event.target.value } : entry,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('web.preferences.aiContext.glossaryRemove')}
                              onClick={() =>
                                patch({
                                  glossary: draft.glossary.filter((_, at) => at !== index),
                                })
                              }
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                          {/* Named to THIS row rather than shown once for the whole
                              list — with 24 pairs on screen, a single message below
                              everything left the writer counting all 48 boxes by
                              hand to find the one it meant. */}
                          {viTooLong || enTooLong ? (
                            <span className="text-muted-foreground text-hint">
                              {t('web.preferences.aiContext.glossaryTooLong', {
                                max: CONTEXT_LIMITS.MAX_GLOSSARY_TERM_WORDS,
                              })}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={draft.glossary.length >= CONTEXT_LIMITS.MAX_GLOSSARY}
                    onClick={() => patch({ glossary: [...draft.glossary, { vi: '', en: '' }] })}
                  >
                    <Plus aria-hidden /> {t('web.preferences.aiContext.glossaryAdd')}
                  </Button>
                </div>

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
                      (atLimit && !editingExisting)
                    }
                    onClick={() => void onSave()}
                  >
                    {saving
                      ? t('web.preferences.aiContext.saving')
                      : t('web.preferences.aiContext.save')}
                  </Button>
                  <Button variant="ghost" onClick={() => setDraft(null)}>
                    {t('web.preferences.aiContext.cancel')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
