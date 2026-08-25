'use client';

import { AppShell } from '@/components/layout/app-shell';
import { CascadePanel } from '@/components/translate/cascade-panel';
import { useTranslateSettings } from '@/hooks/use-translate-settings';

/**
 * The translator. One path, no backend picker.
 *
 * This page used to open with a choice between two backends named after their
 * implementations, plus a footer link to a measurement page. Both are gone from the
 * product surface: the streaming turn-based path is what ships, the continuous
 * experiment lives at `/translate/live` with nothing linking to it, and the
 * single-shot comparison keeps its own route under a name that says what it does.
 * Neither route was deleted — hiding an experiment from the UI is not the same as
 * throwing away the instrument it was built to measure.
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
export default function TranslatePage() {
  // `current` is a reader, handed to the conversation so its once-built playback
  // graph can pick up the saved volume rather than the first-render default.
  const { settings, set, current } = useTranslateSettings();

  return (
    <AppShell>
      <CascadePanel settings={settings} onChange={set} getVolume={() => current().volume} />
    </AppShell>
  );
}
