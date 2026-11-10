'use client';

import { CascadePanel } from '@/components/translate/cascade-panel';
import { TranslateSkeleton } from '@/components/translate/translate-skeleton';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { languageVoice, pairFor, type ConversationMode } from '@/lib/translate-settings';

/**
 * The translator, as both of its pages draw it: `/translate/one-way` and
 * `/translate/two-way`. One component for the two rather than a copy in each,
 * because everything below — the skeleton, the settings gate, the panel — is the
 * same screen; only the mode differs, and the panel takes it as a prop.
 *
 * One path, no backend picker.
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
 * **`useTranslateSettings` is called HERE and nowhere else** on either page. It is per-call-site
 * `useState`, not a store: a second call would read storage independently, then
 * diverge, so a change made in the panel would never reach the `start()` reading the
 * other copy — and the two debounced writes would race into localStorage. It fails
 * silently and looks like settings that randomly do not apply, so every consumer
 * takes them as props.
 */
export function TranslatePageBody({ conversationMode }: { conversationMode: ConversationMode }) {
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
  if (!ready) return <TranslateSkeleton conversationMode={conversationMode} />;

  return (
    <CascadePanel
      conversationMode={conversationMode}
      settings={settings}
      onChange={set}
      // Per language: a two-way reply's frames say which language they are in.
      // An untagged frame belongs to a one-way turn, which speaks its target.
      getVolume={(language) => {
        const now = current();
        return languageVoice(now, language ?? pairFor(now, conversationMode).target).volume;
      }}
    />
  );
}
