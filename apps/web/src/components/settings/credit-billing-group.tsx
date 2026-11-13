'use client';

/**
 * A Billing group whose content is already drawn as hairline regions — the plan
 * columns, the top-up tiles — so it sits straight on the pane ground under its
 * heading instead of in `SettingsSection`'s box. A box around boxes drew every edge
 * twice.
 *
 * The heading matches `SettingsSection`'s exactly (same label style, same note
 * style and inset), so the four Billing groups read as one list whether or not a
 * group has a box.
 */
export function CreditBillingGroup({
  title,
  note,
  children,
  ...rest
}: {
  title: string;
  /** One sentence under the heading. */
  note?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex flex-col gap-3 duration-300 motion-reduce:animate-none"
    >
      <div className="flex flex-col gap-1 px-1">
        <h3 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
          {title}
        </h3>
        {note ? <p className="text-prose text-hint max-w-[62ch]">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
