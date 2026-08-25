import { Card, CardContent } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Section } from './section';

/**
 * Three facts, each of them about what the reader does or waits for.
 *
 * Not stages. `docs/design-guidelines.md` § Copy register bans naming the pipeline —
 * "recognise, translate, speak" is the exemplar of what these three could easily have
 * become. What they say instead is drawn from the product's own writing: the second one
 * is `cascade-panel.tsx`'s docblock almost verbatim, because "the turn ends when you
 * stop talking" is a consequence the reader can act on and "voice activity detection"
 * is not.
 *
 * The one number on this page is here: about a second between the end of a sentence and
 * the start of playback. It is the measured ~0.9 s in `docs/development-journey.md`,
 * rounded in the direction that cannot flatter it.
 */
export function HowItWorks() {
  const t = getT();

  const steps = [
    { title: t('web.landing.howOneTitle'), body: t('web.landing.howOneBody') },
    { title: t('web.landing.howTwoTitle'), body: t('web.landing.howTwoBody') },
    { title: t('web.landing.howThreeTitle'), body: t('web.landing.howThreeBody') },
  ];

  return (
    <Section
      id="how-it-works"
      title={t('web.landing.howTitle')}
      description={t('web.landing.howBody')}
    >
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map((step, index) => (
          <Card key={step.title}>
            <CardContent className="flex flex-col gap-3">
              {/* Ordinal, not a count of anything — the sequence is the content. */}
              <span
                aria-hidden
                className="text-muted-foreground text-label font-semibold tracking-widest"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-body font-semibold tracking-tight">{step.title}</h3>
              <p className="text-prose text-hint">{step.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}
