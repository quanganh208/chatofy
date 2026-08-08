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
import { Card, CardContent } from '@/components/ui/card';

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
 */
export default function TranslatePage() {
  const [mode, setMode] = useState<TranslateMode>(DEFAULT_TRANSLATE_MODE);
  const [direction, setDirection] = useState<TranslationDirection>('vi_to_en');
  // Reported up by whichever panel is mounted. The toggle is held while a
  // session is up: switching would unmount the panel and drop the conversation
  // mid-sentence, and a running session is the moment that costs the most.
  const [running, setRunning] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-6">
      <Card>
        <CardContent>
          <ModeToggle value={mode} onChange={setMode} disabled={running} />
        </CardContent>
      </Card>

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

      <p className="text-muted-foreground text-center text-sm">
        <Link href="/translate/baseline" className="underline underline-offset-4">
          Turn-based baseline
        </Link>
      </p>
    </main>
  );
}
