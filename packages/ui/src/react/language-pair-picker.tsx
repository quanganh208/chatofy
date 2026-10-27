import {
  AUTO_DETECT,
  LANGUAGES,
  LANGUAGE_CODES,
  languagePairOf,
  reversePair,
  type LanguageCode,
  type LanguagePair,
  type SessionLanguagePair,
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
 */
export interface LanguagePairLabels {
  pair: string;
  source: string;
  translation: string;
  swap: (from: string, to: string) => string;
}

const DEFAULT_LABELS: LanguagePairLabels = {
  pair: 'Languages',
  source: 'Source',
  translation: 'Translation',
  swap: (from, to) => `Swap languages — translate ${from} into ${to}`,
};

/**
 * A language by its English interface name — "Vietnamese", "Chinese" — which is what
 * the extension popup, the one caller without a dictionary, shows. Web passes the
 * reader's locale's names instead (`apps/web/src/i18n/language-pair-labels.ts`).
 *
 * A name the reader recognises in their own interface language beats the language's
 * name for itself: "简体中文" in a Vietnamese or English interface is a word most
 * readers cannot read, on the control that decides what they will hear.
 */
const englishLabel = (code: LanguageCode) => LANGUAGES[code].label;

/** What one side of a pair can hold: a language, or — on the source side only — "detect it". */
type SourceChoice = LanguageCode | typeof AUTO_DETECT;

/**
 * The pair after picking `code` on one `side`.
 *
 * Picking, on one side, the language the OTHER side already holds swaps the pair —
 * the reader asked for that language there, and the only pair with it there and no
 * repeat is the reverse. So no caller can produce a pair of one language, and every surface that
 * picks a language (`LanguagePairPicker`, the `/translate` panel headers) answers a
 * collision the same way because it calls this one function.
 *
 * An undeclared source cannot be reversed — "detect" is never a translation — so a
 * collision against one keeps the language where it was picked and gives the
 * translation side the first other registry language instead. Picking "detect"
 * itself never collides: no target can hold it.
 */
export function pairAfterPick(
  pair: LanguagePair,
  side: 'source' | 'target',
  code: LanguageCode,
): LanguagePair;
export function pairAfterPick(
  pair: SessionLanguagePair,
  side: 'source',
  code: SourceChoice,
): SessionLanguagePair;
export function pairAfterPick(
  pair: SessionLanguagePair,
  side: 'target',
  code: LanguageCode,
): SessionLanguagePair;
export function pairAfterPick(
  pair: SessionLanguagePair,
  side: 'source' | 'target',
  code: SourceChoice,
): SessionLanguagePair {
  const { source, target } = pair;
  const kept = side === 'source' ? source : target;
  const other = side === 'source' ? target : source;
  if (code === kept) return pair;
  if (code === AUTO_DETECT) return { source: AUTO_DETECT, target };
  if (code === other) {
    if (source !== AUTO_DETECT) return reversePair(languagePairOf(source, target));
    // Only the source side can collide with a detect pair's target.
    return languagePairOf(code, LANGUAGE_CODES.find((language) => language !== code) ?? target);
  }
  return side === 'source' ? { source: code, target } : { source, target: code };
}

/**
 * The "detect it" entry a source picker may lead with.
 *
 * Opt-in, and only where the caller's pair can hold an undeclared source: the
 * extension popup passes none, so its picker offers exactly the registry it
 * always did. Which surfaces offer it, and when, is the caller's call — this
 * component cannot know whether the session it configures can identify a turn.
 */
interface DetectOption {
  label: string;
}

interface LanguageSelectProps<V extends SourceChoice> {
  value: V;
  onPick: (code: V) => void;
  /** The accessible name: which side this is ("Source", "Translation"). */
  label: string;
  languages?: readonly LanguageCode[];
  disabled?: boolean;
  nameLanguage?: (code: LanguageCode) => string;
  size?: 'sm' | 'default';
  className?: string;
  /**
   * Lead the list with "detect it" (value `'detect'`). Typed so it can only be
   * passed where `onPick` accepts that value.
   */
  detectOption?: typeof AUTO_DETECT extends V ? DetectOption : never;
}

/**
 * One side of the pair: a select over the registry's languages.
 *
 * The shadcn `Select` as `packages/ui` skins it — a field, not a button, so it spends
 * no accent. `min-w-0` lets it shrink inside the 320px popup instead of widening it;
 * the value line-clamps.
 */
export function LanguageSelect<V extends SourceChoice = LanguageCode>({
  value,
  onPick,
  label,
  languages = LANGUAGE_CODES,
  disabled,
  nameLanguage = englishLabel,
  size = 'default',
  className,
  detectOption,
}: LanguageSelectProps<V>) {
  return (
    <Select value={value} onValueChange={(code) => onPick(code as V)} disabled={disabled}>
      <SelectTrigger aria-label={label} size={size} className={cn('min-w-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {detectOption ? <SelectItem value={AUTO_DETECT}>{detectOption.label}</SelectItem> : null}
        {languages.map((code) => (
          <SelectItem key={code} value={code}>
            {nameLanguage(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface LanguagePairPickerProps<P extends SessionLanguagePair> {
  value: P;
  disabled?: boolean;
  onChange: (pair: P) => void;
  labels?: LanguagePairLabels;
  /** Names the languages. Defaults to each language's English interface name. */
  nameLanguage?: (code: LanguageCode) => string;
  /** The languages offered on either side; the registry by default. */
  languages?: readonly LanguageCode[];
  /**
   * Lead the source side with "detect it". Only for a pair type that can hold
   * it; the swap is disabled while it is chosen, because there is no language
   * to swap it with.
   */
  detectOption?: typeof AUTO_DETECT extends P['source'] ? DetectOption : never;
}

/**
 * The language pair, as two languages to pick and a swap between them.
 *
 * It was a toggle of two readouts and one swap while the registry held two
 * languages: a picker on either side would have offered one alternative, which is
 * the swap. With three, each side is a real choice. The swap stays beside them,
 * because reversing the pair between turns is the common action and it is one press
 * instead of two selects. It is `outline`, and the selects are fields, so the control
 * spends no accent.
 *
 * Side by side from 18rem of its OWN width, stacked below it — a container query,
 * not a viewport one, because the same control sits in the 320px popup (a 288px row,
 * side by side) and in a padded card on a 375px phone (about 280px, where "Tiếng
 * Trung" was clipped). Stacked, the swap sits between the two and turns to point
 * up and down.
 */
export function LanguagePairPicker<P extends SessionLanguagePair = LanguagePair>({
  value,
  disabled,
  onChange,
  labels = DEFAULT_LABELS,
  nameLanguage = englishLabel,
  languages = LANGUAGE_CODES,
  detectOption,
}: LanguagePairPickerProps<P>) {
  const { source, target } = value;
  // The one cast here, and it is sound: a pick only yields `'detect'` from the
  // detect entry, which `detectOption`'s type allows only when `P` can hold it.
  const change = (pair: SessionLanguagePair) => onChange(pair as P);
  const nameSource = (code: SourceChoice) =>
    code === AUTO_DETECT ? (detectOption?.label ?? code) : nameLanguage(code);

  return (
    <div className="@container flex flex-col gap-2">
      <span className="text-foreground text-body font-medium">{labels.pair}</span>
      <div className="flex flex-col gap-2 @2xs:flex-row @2xs:items-end">
        <Side role={labels.source}>
          <LanguageSelect<SourceChoice>
            value={source}
            onPick={(code) => change(pairAfterPick(value, 'source', code))}
            label={labels.source}
            languages={languages}
            disabled={disabled}
            nameLanguage={nameLanguage}
            className={TIGHT}
            detectOption={detectOption}
          />
        </Side>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled || source === AUTO_DETECT}
          onClick={() => {
            if (source !== AUTO_DETECT) change(reversePair(languagePairOf(source, target)));
          }}
          aria-label={labels.swap(nameLanguage(target), nameSource(source))}
          className={cn(
            'text-prose hover:text-foreground disabled:hover:text-inherit',
            // `size-auto` overrides the `icon` size deliberately: a round 34px swap,
            // centred on the 40px fields beside it — or between them, stacked.
            'size-auto shrink-0 self-center rounded-full p-2 @2xs:mb-[3px] @2xs:self-auto',
          )}
        >
          <ArrowLeftRight aria-hidden className="size-3.5 @max-2xs:rotate-90" />
        </Button>
        <Side role={labels.translation}>
          <LanguageSelect
            value={target}
            onPick={(code) => change(pairAfterPick(value, 'target', code))}
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
      <span aria-hidden className="text-muted-foreground text-hint">
        {role}
      </span>
      {children}
    </div>
  );
}
