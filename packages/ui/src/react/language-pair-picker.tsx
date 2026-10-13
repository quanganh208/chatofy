import {
  LANGUAGES,
  LANGUAGE_CODES,
  directionLanguages,
  directionOf,
  reverseDirection,
  type LanguageCode,
  type TranslationDirection,
} from '@chatofy/types';
import { ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

/**
 * The words this control says, and the only English left in it.
 *
 * Defaults rather than required props, the same arrangement as `ThemeToggle`: the
 * extension popup renders shared components and has no dictionary, so it keeps working
 * unchanged, while `apps/web` — which has one — passes localized labels down. A
 * composition here never reaches for a translation itself; it would have to know which
 * of two surfaces it was on.
 *
 * `swap` takes the two language NAMES, because the accessible name has to say what
 * pressing it does — "swap" alone is a verb with no object.
 *
 * The name is the one this type had when the control was a two-readout toggle: the
 * words did not change, and renaming the type would have rippled into every surface
 * that supplies them for no change in what they say.
 */
export interface DirectionToggleLabels {
  direction: string;
  source: string;
  translation: string;
  swap: (from: string, to: string) => string;
}

const DEFAULT_LABELS: DirectionToggleLabels = {
  direction: 'Direction',
  source: 'Source',
  translation: 'Translation',
  swap: (from, to) => `Swap direction — translate ${from} into ${to}`,
};

/**
 * A language by its own name for itself — "Tiếng Việt", "简体中文" — whatever the
 * interface locale, the rule web already follows for direction (see
 * `apps/web/src/i18n/direction-labels.ts`). It is also what fits: in the 320px
 * popup a side has about 80px of text, which "Vietnamese" overran and "Simplified
 * Chinese" would have doubled.
 */
const ownName = (code: LanguageCode) => LANGUAGES[code].nativeName;

/**
 * The pair after picking `code` on one `side`.
 *
 * Picking, on one side, the language the OTHER side already holds swaps the pair —
 * the reader asked for that language there, and the only pair with it there and no
 * repeat is the reverse. So no caller can produce `vi_to_vi`, and every surface that
 * picks a language (`LanguagePairPicker`, the `/translate` panel headers) answers a
 * collision the same way because it calls this one function.
 */
export function pairAfterPick(
  pair: TranslationDirection,
  side: 'source' | 'target',
  code: LanguageCode,
): TranslationDirection {
  const { source, target } = directionLanguages(pair);
  const kept = side === 'source' ? source : target;
  const other = side === 'source' ? target : source;
  if (code === kept) return pair;
  if (code === other) return reverseDirection(pair);
  return side === 'source' ? directionOf(code, target) : directionOf(source, code);
}

interface LanguageSelectProps {
  value: LanguageCode;
  onPick: (code: LanguageCode) => void;
  /** The accessible name: which side this is ("Source", "Translation"). */
  label: string;
  languages?: readonly LanguageCode[];
  disabled?: boolean;
  nameLanguage?: (code: LanguageCode) => string;
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * One side of the pair: a select over the registry's languages.
 *
 * The shadcn `Select` as `packages/ui` skins it — a field, not a button, so it spends
 * no accent. `min-w-0` lets it shrink inside the 320px popup instead of widening it;
 * the value line-clamps.
 */
export function LanguageSelect({
  value,
  onPick,
  label,
  languages = LANGUAGE_CODES,
  disabled,
  nameLanguage = ownName,
  size = 'default',
  className,
}: LanguageSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(code) => onPick(code as LanguageCode)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} size={size} className={cn('min-w-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((code) => (
          <SelectItem key={code} value={code}>
            {nameLanguage(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface LanguagePairPickerProps {
  value: TranslationDirection;
  disabled?: boolean;
  onChange: (direction: TranslationDirection) => void;
  labels?: DirectionToggleLabels;
  /** Names the languages. Defaults to each language's own name. */
  nameLanguage?: (code: LanguageCode) => string;
  /** The languages offered on either side; the registry by default. */
  languages?: readonly LanguageCode[];
}

/**
 * The direction, as two languages to pick and a swap between them.
 *
 * It was a toggle of two readouts and one swap while the registry held two
 * languages: a picker on either side would have offered one alternative, which is
 * the swap. With three, each side is a real choice. The swap stays beside them,
 * because reversing the pair between turns is the common action and it is one press
 * instead of two selects. It is `outline`, and the selects are fields, so the control
 * spends no accent.
 */
export function LanguagePairPicker({
  value,
  disabled,
  onChange,
  labels = DEFAULT_LABELS,
  nameLanguage = ownName,
  languages = LANGUAGE_CODES,
}: LanguagePairPickerProps) {
  const { source, target } = directionLanguages(value);
  const pick = (side: 'source' | 'target') => (code: LanguageCode) =>
    onChange(pairAfterPick(value, side, code));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {labels.direction}
      </span>
      <div className="flex items-end gap-2">
        <Side role={labels.source}>
          <LanguageSelect
            value={source}
            onPick={pick('source')}
            label={labels.source}
            languages={languages}
            disabled={disabled}
            nameLanguage={nameLanguage}
            className={TIGHT}
          />
        </Side>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          onClick={() => onChange(reverseDirection(value))}
          aria-label={labels.swap(nameLanguage(target), nameLanguage(source))}
          className={cn(
            'text-prose hover:text-foreground disabled:hover:text-inherit',
            // `size-auto` overrides the `icon` size deliberately: a round 34px swap,
            // centred on the 40px fields beside it.
            'mb-[3px] size-auto shrink-0 rounded-full p-2',
          )}
        >
          <ArrowLeftRight aria-hidden className="size-3.5" />
        </Button>
        <Side role={labels.translation}>
          <LanguageSelect
            value={target}
            onPick={pick('target')}
            label={labels.translation}
            languages={languages}
            disabled={disabled}
            nameLanguage={nameLanguage}
            className={TIGHT}
          />
        </Side>
      </div>
    </div>
  );
}

/** Full width, with the field's padding and chevron gap trimmed so a name fits at 320px. */
const TIGHT = 'w-full gap-1 px-2.5';

function Side({ role, children }: { role: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span aria-hidden className="text-muted-foreground text-label tracking-wide uppercase">
        {role}
      </span>
      {children}
    </div>
  );
}
