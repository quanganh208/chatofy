'use client';

import { useState } from 'react';
import type { TranslationDirection } from '@chatofy/types';
import { AppShell } from '@/components/layout/app-shell';
import { CascadePanel } from '@/components/translate/cascade-panel';

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
 * `direction` is held here rather than in the panel so the choice survives a panel
 * remount, and because it is the only setting that belongs to the page rather than
 * to a single session.
 */
export default function TranslatePage() {
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');

  return (
    <AppShell>
      <CascadePanel direction={direction} onDirectionChange={setDirection} />
    </AppShell>
  );
}
