'use client';

import { cn } from '@/lib/utils';

/**
 * A named group of settings rows: a small heading, then the rows inside one rounded
 * hairline box with a divider between each.
 *
 * The box has NO shadow and no fill of its own — it is the same hairline sheet the two
 * sides of `/translate` are drawn as, and for the same reason it is not an elevated
 * surface: the Settings dialog is already the one thing over the page, and a card in
 * it would be a second. `design/surface-count.ts` counts shadows, so it does not count
 * this box.
 *
 * Every direct child is a row: the box pads each one to the same inset and draws the
 * divider between them, so a group can hold a readout or a list beside its
 * `SettingsSectionRow`s and they line up.
 *
 * `title` is optional because the dialog's pane already opens with the tab's title and
 * one-line description; a tab that is one group needs no second heading saying the
 * same, and a tab with several (Billing) names each.
 */
export function SettingsSection({
  title,
  note,
  children,
}: {
  title?: string;
  /** One sentence under the heading, when the group needs explaining. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    // Each section settles in a beat after the one above it (see `globals.css`).
    <section
      data-slot="settings-section"
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex flex-col gap-2 duration-300 motion-reduce:animate-none"
    >
      {title || note ? (
        <div className="flex flex-col gap-1 px-1">
          {title ? (
            <h3 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
              {title}
            </h3>
          ) : null}
          {note ? <p className="text-prose text-hint max-w-[62ch]">{note}</p> : null}
        </div>
      ) : null}
      <div
        data-slot="settings-section-box"
        className="border-hairline divide-hairline flex flex-col divide-y rounded-lg border [&>*]:px-4"
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One setting inside a {@link SettingsSection}: what it is on the left, the
 * control that changes it on the right.
 *
 * Named for the section rather than for settings in general, because the popover
 * panels on `/translate` have a row of their own — `translate/settings-row.tsx`,
 * an icon and a name with nowhere to put a sentence. Two components called
 * `SettingsRow` took different props and could not stand in for each other, so a
 * caller reaching for the wrong one found out from `tsc` rather than from the
 * import.
 *
 * The pair used to be `justify-between` across the full measure, which at 672px
 * puts a label and its value at opposite ends of half a metre of nothing —
 * three of those read as a table rather than as a person's settings. A grid with
 * the control column sized to its content keeps them related.
 *
 * `block` is for a control too wide to sit beside its label — the language pair,
 * which is itself two named sides and a swap. It takes the full row and the label
 * sits above it.
 */
export function SettingsSectionRow({
  label,
  note,
  block,
  children,
}: {
  label: string;
  /** What this setting means, or when it takes effect. */
  note?: string;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // The divider between rows is the box's (`SettingsSection`), not the row's.
        'grid items-center gap-x-6 gap-y-2 py-3.5',
        block
          ? 'grid-cols-1'
          : // A row with a note stacks on a phone. Beside its control, a note was a
            // ~110px column eleven lines tall at 375px; a bare label beside a
            // switch fits and stays inline everywhere.
            note
            ? 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]'
            : 'grid-cols-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="flex min-w-0 max-w-[38ch] flex-col gap-0.5">
        <span className="text-body font-medium">{label}</span>
        {note ? <span className="text-muted-foreground text-hint">{note}</span> : null}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2.5',
          block ? '' : note ? 'sm:justify-self-end' : 'justify-self-end',
        )}
      >
        {children}
      </div>
    </div>
  );
}
