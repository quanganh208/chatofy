'use client';

import { useState } from 'react';
import type { TranslationDirection } from '@chatofy/types';
import { AppShell } from '@/components/layout/app-shell';
import { LivePanel } from '@/components/translate/live-panel';

/**
 * The continuous end-to-end path, kept reachable and deliberately unlinked.
 *
 * This is the experiment the shipping path is measured against: it translates while
 * you are still talking rather than waiting for a sentence, and the head-to-head
 * latency numbers in `docs/development-journey.md` are reported against it. It is not
 * on any route a user walks — nothing in the product links here — because a choice
 * between two backends is not a choice a person can make, and naming them on the
 * product surface is what made the app read as a test harness.
 *
 * Unlinked rather than deleted, and that distinction was the explicit decision:
 * hiding it from the UI costs nothing, deleting it would throw away the comparison.
 * The route lives under `app/` so it stays reachable by URL and so knip sees it as
 * used — not to keep a tool quiet, but because the measurement path is genuinely
 * still wanted.
 *
 * Excluding it from a production bundle would be a build-config change, not a UI one,
 * and it is not in this plan's scope. Today it is reachable by anyone who types the
 * URL.
 */
export default function LiveTranslatePage() {
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');

  return (
    <AppShell back={{ href: '/translate', label: 'Back to the translator' }}>
      <LivePanel direction={direction} onDirectionChange={setDirection} />
    </AppShell>
  );
}
