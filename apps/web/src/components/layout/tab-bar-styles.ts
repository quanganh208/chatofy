/**
 * One tab of the mobile bar, shared by its links and the More trigger so the four read
 * as one row. 56px tall — over the 44px touch floor — and the active tab is ink on the
 * page ground rather than an accent fill, so the bar spends nothing from a screen's
 * one-accent budget.
 */
export const TAB_CLASS =
  'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-hint text-muted-foreground outline-none transition-colors duration-fast ease-standard focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 aria-[current=page]:font-semibold aria-[current=page]:text-foreground data-[active]:font-semibold data-[active]:text-foreground motion-reduce:transition-none [&_svg]:size-5';
