'use client';

import { Skeleton } from '@chatofy/ui/react';
import { CascadePanel } from '@/components/translate/cascade-panel';
import { useTranslateSettings } from '@/hooks/use-translate-settings';

/**
 * The translator. One path, no backend picker.
 *
 * This page used to open with a choice between two backends named after their
 * implementations, plus a footer link to a measurement page. First the choice left the
 * product surface and the two lab routes went unlinked; now those routes are gone
 * outright, and the streaming turn-based path is the only one a browser can reach. What
 * they measured is not lost with them: the single-shot comparison is `POST /translate`
 * in the API, and the continuous path is measured by `benchmarks/realtime`.
 *
 * There is no page-level heading, and that is the hierarchy fix rather than an
 * omission. A product name set at display size was the largest thing on a surface
 * whose entire purpose is the translation underneath it. The brand now sits in the
 * shell at body size, as a way home. What dominates is the conversation.
 *
 * **`useTranslateSettings` is called HERE and nowhere else.** It is per-call-site
 * `useState`, not a store: a second call would read storage independently, then
 * diverge, so a change made in the panel would never reach the `start()` reading the
 * other copy — and the two debounced writes would race into localStorage. It fails
 * silently and looks like settings that randomly do not apply, so every consumer
 * takes them as props.
 */
/**
 * The screen's geometry, before its settings are known.
 *
 * Reserves the pair and the dock at the heights they actually take, so the real
 * panel replaces it without moving anything below.
 */
function TranslateSkeleton() {
  return (
    // The same flex chain the real panel uses, so the pair is already the height
    // it will keep. A fixed-height placeholder under a panel that fills the
    // viewport is a jump on every load — the larger of the two shifts, since it
    // moves the dock rather than a line of text.
    <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-4">
      {/* The same bound the real section carries, so the dock sits at the height it
          will keep rather than jumping when settings land. It is on the section
          because the number of scroll regions is a setting — see
          `cascade-panel.tsx`. */}
      <div className="border-hairline flex max-h-[calc(100svh-12.5rem)] min-h-64 flex-1 flex-col overflow-hidden rounded-xl border">
        <Skeleton className="m-0 h-[58px] rounded-b-none" />
        <Skeleton className="m-3.5 min-h-0 flex-1" />
      </div>
      <div className="flex justify-center">
        <Skeleton className="h-11 w-52 rounded-full" />
      </div>
    </div>
  );
}

export default function TranslatePage() {
  // `current` is a reader, handed to the conversation so its once-built playback
  // graph can pick up the saved volume rather than the first-render default.
  const { settings, ready, set, current } = useTranslateSettings();

  // Storage cannot be read during render — the server has none — so the first
  // paint would otherwise be the DEFAULTS, corrected a frame later. That was
  // survivable while the stored value almost always equalled the default; now
  // that the panel headers, the divider, the number of scroll regions and the
  // reading size all follow stored settings, being wrong for one frame is the
  // entire screen visibly
  // rearranging itself on every load. `ready` is what the hook exposes for
  // exactly this, and it was not being read.
  //
  // A SHAPE, not `null`. This route is server-rendered on demand, so returning
  // nothing ships an empty content column in the HTML and then fills it — trading
  // a layout that rearranges for content that appears from nowhere, which is the
  // larger shift of the two, and leaving a client whose JavaScript never arrives
  // with a permanently blank screen instead of a usable panel.
  if (!ready) return <TranslateSkeleton />;

  return <CascadePanel settings={settings} onChange={set} getVolume={() => current().volume} />;
}
