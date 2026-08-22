import Link from 'next/link';
import { Button } from '@chatofy/ui/react';
import { AppShell } from '@/components/layout/app-shell';

/**
 * A way into the translator, not a marketing page.
 *
 * This was eight lines of unstyled HTML that said "Coming soon" and linked nowhere,
 * while `/translate` was a working tool — so the first thing anyone saw claimed the
 * product did not exist yet. A lean entry point was the decision: name what it does
 * in one sentence, then get out of the way.
 *
 * The one claim worth making here is the local speech stack, because it is the part
 * that is unusual and the part a person actually weighs before granting a microphone.
 */
export default function HomePage() {
  return (
    <AppShell measure="reading">
      <div className="flex flex-1 flex-col justify-center gap-6 py-8">
        <h1 className="text-title max-w-[22ch] font-semibold tracking-tight text-balance">
          Speak Vietnamese. Be heard in English.
        </h1>
        <p className="text-prose text-body max-w-prose">
          Real-time voice translation, both directions. Speech recognition and synthesis run on your
          own machine — only the translation itself leaves it.
        </p>
        <div>
          {/* `asChild`, so the one action on this page is a real link — right-click,
              middle-click and prefetch all keep working — while the appearance,
              focus ring and motion come from the shared button rather than from a
              copy of its classes that would drift the first time either changed. */}
          <Button asChild size="lg">
            <Link href="/translate">Start translating</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
