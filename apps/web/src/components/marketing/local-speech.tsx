import { Card, CardContent } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { cn } from '@/lib/utils';
import { Section } from './section';

/**
 * The differentiator, and the reason someone grants a microphone.
 *
 * Written as what happens to the reader's voice rather than as what runs where.
 * "Speech recognition and synthesis run on your own CPU" is the sentence the mockup
 * drew, and it is the pipeline wearing a privacy hat — the register rule wants the
 * outcome, which is that the audio never leaves the machine and only the words do.
 *
 * The three hops are the proof, and they are the honest shape of it: two of them are
 * local and the middle one is not. A privacy claim that quietly omitted the network hop
 * would be the kind of claim this section exists to be better than.
 *
 * Each hop is labelled in small capitals rather than a pill. At the size a pill needed
 * to be legible it outweighed the sentence beside it, and the label is the lesser of
 * the two: where it happens, then what happens.
 */
export async function LocalSpeech() {
  const t = await getT();

  const hops = [
    { badge: t('web.landing.hopOnDevice'), body: t('web.landing.hopHears'), local: true },
    { badge: t('web.landing.hopOverNetwork'), body: t('web.landing.hopTranslates'), local: false },
    { badge: t('web.landing.hopOnDevice'), body: t('web.landing.hopSpeaks'), local: true },
  ];

  return (
    <Section id="on-your-machine">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-title font-display font-light tracking-tight text-balance">
            {t('web.landing.localTitle')}
          </h2>
          <p className="text-prose text-body max-w-prose">{t('web.landing.localBody')}</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            {hops.map((hop, index) => (
              <div key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span
                  className={cn(
                    'text-label w-32 shrink-0 font-semibold tracking-wide uppercase',
                    hop.local ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {hop.badge}
                </span>
                <span className="text-body text-prose">{hop.body}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
