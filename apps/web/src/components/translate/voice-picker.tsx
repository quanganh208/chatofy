'use client';

import { useId } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@chatofy/ui/react';
import type { VoiceGender } from '@chatofy/types';
import type { VoiceCatalogState } from '@/hooks/use-voice-catalog';
import type { VoiceScope } from '@/components/translate/voice-scope-toggle';
import { useTranslate } from '@/i18n/provider';

/**
 * Which voice speaks the translation, out of what the scope above it lists.
 *
 * **A list, not a row of segments.** This was a `SegmentedControl` while both
 * engines published two voices each, where a row of chips is the better control:
 * every option visible, one press to change. Both now publish twenty — Kokoro's
 * US English block and every VieNeu preset — and twenty chips inside a popover
 * wrap into a wall that has to be read before it can be used.
 *
 * **Every state of this control is an ITEM, including the default one.** `all`
 * shipped for an afternoon with no default entry, on the reasoning that a default
 * belongs to a gender and the union has none. That reasoning was right and the
 * conclusion was wrong: the state still existed, so the trigger had to show it as
 * a `placeholder` — which `SelectTrigger` paints with `text-muted-foreground`,
 * printing the voice a conversation would actually be spoken in as though the
 * field were empty. The union has two defaults, not none, and listing both is
 * what makes `all` a scope you can leave the picker sitting in.
 *
 * So there is no placeholder path at all: in a gender scope the list opens with
 * that gender's "Default", in `all` each group opens with its own.
 *
 * Empty catalog renders nothing at all, and that is a real answer rather than a
 * missing feature — a backend offering no choice leaves the scope as the control.
 * A FAILED lookup says so instead, because a stopped sidecar and a backend with
 * one voice must never look identical.
 */

/**
 * Stands in for "no specific voice, speak with this gender's own default".
 *
 * One value per gender, because in `all` both are on screen together and Radix
 * addresses items by value. The empty string is not available for any of them:
 * Radix reserves it as the value a Select reports while it holds nothing, which
 * is the state this control never wants to be in.
 */
const DEFAULT_VOICE: Record<VoiceGender, string> = {
  female: '__default_female__',
  male: '__default_male__',
};

interface VoicePickerProps {
  catalog: VoiceCatalogState;
  /** Which voices are listed: one gender's, or every one the backend published. */
  scope: VoiceScope;
  /** The gender speaking while no voice is named — which default is current. */
  gender: VoiceGender;
  /** The saved token, or `''` when no specific voice is chosen. */
  value: string;
  disabled?: boolean;
  /** The token (or `undefined` for a default) and the gender it speaks in. */
  onChange: (token: string | undefined, gender: VoiceGender) => void;
}

export function VoicePicker({
  catalog,
  scope,
  gender,
  value,
  disabled,
  onChange,
}: VoicePickerProps) {
  const t = useTranslate();
  const labelId = useId();

  if (catalog.status === 'failed') {
    return (
      <p className="text-muted-foreground text-hint max-w-prose">
        {t('web.translate.voiceListFailed')}
      </p>
    );
  }

  const genderLabel = (of: VoiceGender) =>
    t(of === 'female' ? 'web.translate.voiceFemale' : 'web.translate.voiceMale');

  const listed = catalog.voices.filter((voice) => scope === 'all' || voice.gender === scope);
  // Nothing to choose between in this scope: no voice, and a lone "Default" that
  // is the state the control is already in. The toggle above has already made the
  // only choice there is.
  if (listed.length === 0) return null;

  // Both defaults are always offered in `all`, even where the backend published
  // no voice of that gender: the engine still has one, and it is what `gender`
  // may already be pointing at. Dropping it would leave the Select holding a
  // value no item carries, which is the placeholder state again.
  const groups: ReadonlyArray<{ gender: VoiceGender; voices: typeof listed }> =
    scope === 'all'
      ? [
          { gender: 'female', voices: listed.filter((voice) => voice.gender === 'female') },
          { gender: 'male', voices: listed.filter((voice) => voice.gender === 'male') },
        ]
      : [{ gender: scope, voices: listed }];

  return (
    <div className="flex flex-col gap-2">
      <span
        id={labelId}
        className="text-muted-foreground text-label font-semibold tracking-wide uppercase"
      >
        {t('web.translate.voice')}
      </span>
      <Select
        value={value || DEFAULT_VOICE[gender]}
        disabled={disabled}
        onValueChange={(next) => {
          const chosen = catalog.voices.find((voice) => voice.token === next);
          if (chosen) return onChange(chosen.token, chosen.gender);
          // A default: which one it is says which gender now speaks.
          onChange(undefined, next === DEFAULT_VOICE.male ? 'male' : 'female');
        }}
      >
        <SelectTrigger aria-labelledby={labelId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        {/* Twenty voices are more than a list should be tall even where the
            window has room, so this caps what `SelectContent` already limits to
            the space available — whichever is smaller. Roughly eight rows: enough
            to scan, short enough to stay a list rather than a page. */}
        <SelectContent className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
          {groups.map((group) => (
            <SelectGroup key={group.gender}>
              {/* Only where two groups are on screen at once does either need
                  naming; inside one gender the toggle above already said it. */}
              {scope === 'all' ? <SelectLabel>{genderLabel(group.gender)}</SelectLabel> : null}
              <SelectItem value={DEFAULT_VOICE[group.gender]}>
                {scope === 'all'
                  ? `${t('web.translate.voiceDefault')} · ${genderLabel(group.gender)}`
                  : t('web.translate.voiceDefault')}
              </SelectItem>
              {group.voices.map((voice) => (
                <SelectItem key={voice.token} value={voice.token}>
                  {voice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
