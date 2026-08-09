'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_TRANSLATE_MODE,
  type TranslateMode,
  type TranslationDirection,
} from '@chatofy/types';
import { CascadePanel } from '@/components/translate/cascade-panel';
import { LivePanel } from '@/components/translate/live-panel';
import { ModeToggle } from '@/components/translate/mode-toggle';

/**
 * The translator, with the choice of backend on the page itself.
 *
 * Both modes speak `/ws/translate` and differ only in which start message they
 * send, so the choice belongs to the client — there is no server setting to
 * change and nothing to deploy differently. Until now it was made by navigating
 * to a URL that nothing linked to.
 *
 * Exactly ONE panel is mounted at a time, and each owns its hook. That is what
 * keeps a shared route from becoming a shared render: a session cannot outlive
 * its panel, two sockets cannot be open at once, and neither backend's markup
 * can break because the other changed.
 *
 * `direction` is held here rather than in the panels, so comparing the two on
 * the same phrase does not mean setting it twice. `voiceGender` stays inside the
 * cascade panel, which is the only mode that has a voice to pick.
 *
 * The layout puts the mode choice in the header rather than in a card of its own.
 * Three equally-weighted cards — mode, settings, transcript — told the eye that
 * all three mattered the same amount, and the translation is the only one that
 * does.
 */
export default function TranslatePage() {
  const [mode, setMode] = useState<TranslateMode>(DEFAULT_TRANSLATE_MODE);
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');
  // Reported up by whichever panel is mounted. The toggle is held while a
  // session is up: switching would unmount the panel and drop the conversation
  // mid-sentence, and a running session is the moment that costs the most.
  const [running, setRunning] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Chatofy</h1>
          <p className="text-muted-foreground text-sm">
            Realtime Vietnamese ↔ English, spoken both ways.
          </p>
        </div>
        <ModeToggle value={mode} onChange={setMode} disabled={running} />
      </header>

      {mode === 'cascade' ? (
        <CascadePanel
          direction={direction}
          onDirectionChange={setDirection}
          onRunningChange={setRunning}
        />
      ) : (
        <LivePanel
          direction={direction}
          onDirectionChange={setDirection}
          onRunningChange={setRunning}
        />
      )}

      <p className="text-muted-foreground mt-auto text-center text-xs">
        <Link
          href="/translate/baseline"
          className="hover:text-foreground underline underline-offset-4 transition-colors"
        >
          Turn-based baseline
        </Link>
      </p>
    </main>
  );
}
