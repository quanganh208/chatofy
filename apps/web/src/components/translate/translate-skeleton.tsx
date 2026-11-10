import { Skeleton } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import type { ConversationMode } from '@/lib/translate-settings';

/**
 * The translate screen's geometry, before its settings are known.
 *
 * Drawn in the default arrangement — `split` with the panes in a `row` — because
 * that is the only honest guess before the settings are read: a reader who chose
 * `list` or `column` sees the layout change once, which no skeleton can avoid
 * without reading storage during render (a hydration mismatch). Everything else
 * copies the real screen's boxes, so the panel replaces this without moving
 * anything: the sheets (`transcript-panes.tsx`), their headers (`panel-headers.tsx`)
 * and the dock (`cascade-panel.tsx`).
 *
 * Used twice: by the page body while settings load, and by the route's
 * `loading.tsx` while the route itself is on its way.
 */
export function TranslateSkeleton({ conversationMode }: { conversationMode: ConversationMode }) {
  return (
    // The same flex chain the real panel uses, so the pair is already the height
    // it will keep. A fixed-height placeholder under a panel that fills the
    // viewport is a jump on every load — the larger of the two shifts, since it
    // moves the dock rather than a line of text.
    <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-4">
      {/* The same bound the real section carries, so the dock sits at the height it
          will keep. See `cascade-panel.tsx` for why it is on the section. */}
      <div className="relative flex max-h-[calc(100svh-12.5rem)] min-h-64 flex-1 flex-col">
        <div className="@container flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col gap-4 @xl:flex-row">
            {/* The swap, at the centre of the gap between the sheets. */}
            <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
              <Skeleton className="bg-card border-hairline size-11 rounded-full border" />
            </div>
            {/* The side you speak into on `card`; it carries a voice only on the
              two-way page, as `sourceVoiceControl` decides. */}
            <SkeletonSheet ground="bg-card" voice={conversationMode === 'two-way'} />
            {/* The side you read on `muted`. */}
            <SkeletonSheet ground="bg-muted" voice />
          </div>
        </div>
      </div>

      {/* The dock: readouts, Start, then the page's own controls. */}
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-[23px] w-28" />
        </div>
        <div className="flex items-center gap-2 justify-self-stretch sm:justify-self-center">
          <Skeleton className="h-11 w-full rounded-full sm:w-48" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="size-10 pointer-coarse:size-11" />
          <Skeleton className="size-10 pointer-coarse:size-11" />
          <Skeleton className="size-10 pointer-coarse:size-11" />
        </div>
      </div>
    </div>
  );
}

/**
 * One sheet: a hairline region on its own ground, a header naming its role and
 * language, and the empty pane under it. The header controls sit on the page
 * ground in the real screen (`bg-background`), so their placeholders do too —
 * `Skeleton`'s own fill is the same value as `muted` and would vanish on the
 * translation sheet.
 */
function SkeletonSheet({ ground, voice }: { ground: string; voice: boolean }) {
  return (
    <div
      className={cn(
        'border-hairline flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border',
        ground,
      )}
    >
      <div className="border-hairline border-b px-8">
        <div className="flex min-h-[58px] items-center gap-2.5 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Skeleton className="bg-background my-0.5 h-3.5 w-16" />
            <Skeleton className="bg-background h-9 w-32 pointer-coarse:h-11" />
          </div>
          {voice ? (
            <Skeleton className="bg-background ml-auto h-9 w-16 pointer-coarse:h-11" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
