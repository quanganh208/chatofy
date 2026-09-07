'use client';

import type { LucideIcon } from 'lucide-react';

/**
 * A named setting and its control, side by side.
 *
 * ## The label is a name, and the icon does the scanning
 *
 * It was the uppercase micro-label the panel headers use, which is right for two
 * words above a language and wrong for six of them stacked down a popover: six
 * uppercase lines read as six headings rather than as a list you scan. Sentence
 * case at body size, with a leading glyph, is what makes the list scannable — the
 * icon is what the eye lands on, so the words do not have to shout.
 *
 * `aria-hidden` on the icon. It repeats the label beside it, and a screen reader
 * reading both would read every row twice.
 *
 * ## No room for a sentence
 *
 * Deliberately. There is nowhere here to put an explanation, because the panels
 * that use this had five of them and the explanations outweighed the labels two
 * to one. The rule that replaced them: **words explain a refusal, never a
 * function.** A control that is disabled or has failed says why — those live with
 * the control that is refusing, in its own `hint`. A control that simply works is
 * described by its name and by what happens when you use it.
 *
 * `flex-wrap`, because the popover is narrower than the preferences card that
 * mounts the same panels: a long label and a wide control drop to two lines there
 * instead of squeezing the control to nothing.
 */
export function SettingsRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <span className="text-body flex items-center gap-2.5 font-medium">
        <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        {label}
      </span>
      {children}
    </div>
  );
}
