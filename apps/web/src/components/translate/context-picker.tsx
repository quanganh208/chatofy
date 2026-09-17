'use client';

import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@chatofy/ui/react';
import type { TranslationContext } from '@chatofy/types';
import type { TranslationContextsState } from '@/hooks/use-translation-contexts';
import { useTranslate } from '@/i18n/provider';

/**
 * Which saved AI Context a conversation runs under.
 *
 * **Renders nothing when the list is empty**, mirroring `VoicePicker`'s
 * render-nothing case and for the same reason: an account that has authored no
 * contexts has no choice to make, and a picker with one item in it is a control
 * that cannot do anything. `ready` is load-bearing — an empty list is only an
 * answer once the request that fills it has finished, so a list still loading
 * renders nothing rather than flashing "None" and then a real list.
 *
 * A `Select`, so it spends **no accent**: the screen's one accent-filled control
 * is Start, and this picker must not become a second one. `bg-primary` never
 * appears on a trigger.
 *
 * `disabled` while a conversation runs, with the words saying why — the same rule
 * every other setting that travels on `client.session.start` follows. The hints
 * are resolved once when the session starts and `ConversationSession` holds them
 * for the whole run, so a live control would accept the press and change nothing
 * until the next conversation.
 *
 * `showLabel` is for a caller that already draws the name beside the control —
 * `conversation-defaults-section.tsx` puts this inside a `SettingsSectionRow`
 * whose own label reads "AI Context" too, so drawing this one as well stacked the
 * same string twice under one row. The label element still renders when hidden,
 * `sr-only` rather than removed, because `aria-labelledby` on the trigger below
 * points at its id either way — an assistive reader still needs a name for the
 * control even where a sighted one already has it from the row.
 */

/**
 * Stands in for "no context at all".
 *
 * Not the empty string: Radix reserves that as the value a Select reports while
 * it holds nothing, which is the placeholder state this control never wants to be
 * in — "None" is a choice a reader makes, not an empty field.
 */
const NO_CONTEXT = '__no_context__';

interface ContextPickerProps {
  contexts: TranslationContext[];
  status: TranslationContextsState;
  /** The stored selection, or null for none. */
  value: string | null;
  /** A conversation is running, so the context is fixed for its duration. */
  running?: boolean;
  /** Draw the label visually. Defaults to true — see the docblock above. */
  showLabel?: boolean;
  onChange: (contextId: string | null) => void;
}

export function ContextPicker({
  contexts,
  status,
  value,
  running,
  showLabel = true,
  onChange,
}: ContextPickerProps) {
  const t = useTranslate();
  const labelId = useId();

  if (status !== 'ready' || contexts.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span
        id={labelId}
        className={
          showLabel
            ? 'text-muted-foreground text-label font-semibold tracking-wide uppercase'
            : 'sr-only'
        }
      >
        {t('web.translate.context')}
      </span>
      <Select
        // The stored id resolved against the list, so a selection naming a
        // context that no longer exists reads as "None" rather than leaving the
        // Select holding a value no item carries.
        value={
          contexts.some((context) => context.id === value) ? (value ?? NO_CONTEXT) : NO_CONTEXT
        }
        disabled={running}
        onValueChange={(next) => onChange(next === NO_CONTEXT ? null : next)}
      >
        <SelectTrigger aria-labelledby={labelId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
          <SelectItem value={NO_CONTEXT}>{t('web.translate.contextNone')}</SelectItem>
          {contexts.map((context) => (
            <SelectItem key={context.id} value={context.id}>
              {context.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Words explain a refusal, never a function: the hint exists only while the
          control is actually refusing. */}
      {running ? (
        <span className="text-muted-foreground text-hint">{t('web.translate.contextLocked')}</span>
      ) : null}
    </div>
  );
}
