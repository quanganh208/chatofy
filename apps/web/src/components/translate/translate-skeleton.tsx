import { Skeleton } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import { TopbarActions } from '@/components/layout/chrome-slots';
import type { ConversationMode } from '@/lib/translate-settings';

/**
 * The translate screen's geometry, before its settings are known.
 *
 * Drawn in the default arrangement — `split` with the panes in a `row` — because
 * that is the only honest guess before the settings are read: a reader who chose
 * `list` or `column` sees the layout change once, which no skeleton can avoid
 * without reading storage during render (a hydration mismatch). Everything else
 * copies the real screen's boxes, so the panel replaces this without moving
 * anything: the regions (`transcript-panes.tsx`), their headers and the topbar's pair
 * (`panel-headers.tsx`), and the dock (`cascade-panel.tsx`).
 *
 * Used twice: by the page body while settings load, and by the route's
 * `loading.tsx` while the route itself is on its way.
 */
export function TranslateSkeleton({ conversationMode }: { conversationMode: ConversationMode }) {
  const twoWay = conversationMode === 'two-way';
  return (
    // The same edge-to-edge flex chain the real panel uses, so the pair is already
    // the height it will keep. A fixed-height placeholder under a panel that fills
    // the viewport is a jump on every load — the larger of the two shifts, since it
    // moves the dock rather than a line of text.
    <div aria-hidden className="-mx-6 -my-8 flex min-h-0 flex-1 flex-col">
      {/* The pair in the topbar, from `md` — see `TranslateTopbarControls`. */}
      <TopbarActions>
        <div className="flex items-center gap-2 max-md:hidden">
          {twoWay ? <Skeleton className="h-8 w-14" /> : null}
          <Skeleton className="h-8 w-28" />
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-14" />
        </div>
      </TopbarActions>

      {/* The same bound the real section carries, so the dock sits at the height it
          will keep. See `cascade-panel.tsx` for why it is on the section. */}
      <div className="relative flex min-h-64 flex-1 flex-col sm:max-h-[calc(100svh-7.25rem)] max-sm:max-h-[calc(100svh-14rem-env(safe-area-inset-bottom))]">
        <div className="@container flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col @xl:flex-row">
            {/* The swap on the seam, below `md` only. */}
            <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 md:hidden">
              <Skeleton className="bg-background border-hairline size-11 rounded-full border" />
            </div>
            {/* The side you speak into carries a voice only on the two-way page, as
              `sourceVoiceControl` decides. */}
            <SkeletonRegion voice={twoWay} />
            <SkeletonRegion voice divided />
          </div>
        </div>
      </div>

      {/* The dock: readouts, Start, then the page's own controls. */}
      <div className="border-hairline grid grid-cols-[1fr_auto] items-center gap-3 border-t px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-[23px] w-28" />
        </div>
        <div className="col-span-2 row-start-1 flex items-center gap-2 sm:col-span-1 sm:col-start-2 sm:justify-self-center">
          <Skeleton className="h-11 w-full rounded-full sm:w-48" />
        </div>
        <div className="flex items-center justify-end gap-1">
          <Skeleton className="size-10 pointer-coarse:size-11" />
          <Skeleton className="size-10 pointer-coarse:size-11" />
          <Skeleton className="size-10 pointer-coarse:size-11" />
        </div>
      </div>
    </div>
  );
}

/**
 * One region: flat on the page ground, the second one behind the hairline seam.
 * Below `md` its header holds the side's picker (and voice); from `md` it is only
 * the quiet "Source · Vietnamese" label, the pickers being the topbar's.
 */
function SkeletonRegion({ voice, divided = false }: { voice: boolean; divided?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        divided && 'border-hairline border-t @xl:border-t-0 @xl:border-l',
      )}
    >
      <div className="border-hairline border-b px-8 md:hidden">
        <div className="flex min-h-[58px] items-center gap-2.5 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Skeleton className="my-0.5 h-3.5 w-16" />
            <Skeleton className="h-9 w-32 pointer-coarse:h-11" />
          </div>
          {voice ? <Skeleton className="ml-auto h-9 w-16 pointer-coarse:h-11" /> : null}
        </div>
      </div>
      <div className="px-8 pt-4 pb-1 max-md:hidden">
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  );
}
