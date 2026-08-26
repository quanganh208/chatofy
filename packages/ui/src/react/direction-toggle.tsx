import type { TranslationDirection } from '@chatofy/types';
import { ArrowLeftRight } from 'lucide-react';
import { languageName } from './lib/language-name.js';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';

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

interface DirectionToggleProps {
  value: TranslationDirection;
  disabled?: boolean;
  onChange: (direction: TranslationDirection) => void;
  labels?: DirectionToggleLabels;
  /** Names the languages. Defaults to English names; web passes the reader's locale. */
  nameLanguage?: (code: string) => string;
}

/** Which language each side of a direction is. The codes never reach the screen. */
const SIDES: Record<TranslationDirection, { source: string; target: string }> = {
  vi_to_en: { source: 'vi', target: 'en' },
  en_to_vi: { source: 'en', target: 'vi' },
};

const OPPOSITE: Record<TranslationDirection, TranslationDirection> = {
  vi_to_en: 'en_to_vi',
  en_to_vi: 'vi_to_en',
};

/**
 * The direction, as two named sides rather than one arrowed string.
 *
 * It used to be a segmented control offering `VI → EN` and `EN → VI`. Three problems
 * in one control: the arrow was a typed glyph, so its weight and baseline answered to
 * nothing in the type system; the languages appeared as codes, which the rest of the
 * product had already stopped doing; and the panel above it carried a heading saying
 * the same thing in words, so the direction was stated twice on one screen.
 *
 * Naming the sides fixes all three. The pair is the control, so the heading is gone;
 * the swap is drawn; and the languages are named by the same helper that names them
 * everywhere else.
 */
export function DirectionToggle({
  value,
  disabled,
  onChange,
  labels = DEFAULT_LABELS,
  nameLanguage = languageName,
}: DirectionToggleProps) {
  const { source, target } = SIDES[value];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {labels.direction}
      </span>
      <div className="flex items-stretch gap-2">
        <Side role={labels.source} language={nameLanguage(source)} />
        {/* The one control here, and it is a `Button` rather than a bare element:
            the swap is a real action, so it inherits the shared focus ring, the
            disabled treatment and the motion scale instead of restating them.
            The two sides beside it stay hand-written — they are labelled readouts,
            and no primitive in this package describes that. */}
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          onClick={() => onChange(OPPOSITE[value])}
          aria-label={labels.swap(nameLanguage(target), nameLanguage(source))}
          className={cn(
            // `hover:border-muted-foreground` used to live here and went inert
            // the moment C1 took the border width off the quiet button — a hover
            // that changed a colour on an edge no longer being drawn. What the
            // button has now is fill and elevation, so the hover acts on those;
            // the variant already supplies both, and this only needs to stop
            // overriding the ink.
            'text-prose hover:text-foreground',
            // `size-auto` overrides the `icon` size deliberately: this is a round
            // 34px swap control, not a 40px square, so nothing here may assume
            // the shared control height.
            'size-auto self-center rounded-full p-2',
            'disabled:hover:text-inherit',
          )}
        >
          <ArrowLeftRight aria-hidden className="size-3.5" />
        </Button>
        <Side role={labels.translation} language={nameLanguage(target)} emphasis />
      </div>
    </div>
  );
}

function Side({
  role,
  language,
  emphasis,
}: {
  role: string;
  language: string;
  emphasis?: boolean;
}) {
  return (
    // `grow basis-auto`, not `flex-1`. `flex-1` sets the basis to 0, so the box
    // starts from nothing and takes only its share of free space — fine in the
    // popup, where the component fills a 288px column, but on the web page it sits
    // in a content-sized row beside the voice control and "Vietnamese" came out as
    // "Vietnam…". An auto basis starts from the text. `min-w-0` and `truncate`
    // stay: they are the narrow surface's safety net, and without them a long
    // language name would widen the popup into a horizontal scrollbar.
    // `border-hairline`, not `border-control`. This is a readout — a div with two
    // paragraphs, no handler, no tab stop, no role — so WCAG 1.4.11's 3:1 floor for
    // the visual boundary of a user interface component does not reach it. It
    // carried the control token anyway, which made the two darkest edges on the
    // page belong to the one thing on it that cannot be operated. The swap button
    // beside it is a real control and keeps its boundary.
    <div className="border-hairline min-w-0 grow basis-auto rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-label tracking-wide uppercase">{role}</p>
      {/* The translation is the side being read, the source the side being spoken —
          the same relationship the transcript below draws between the two lines. */}
      <p className={cn('text-body truncate', emphasis ? 'font-medium' : 'text-prose')}>
        {language}
      </p>
    </div>
  );
}
