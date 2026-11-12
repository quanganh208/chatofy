import { dawn } from '@chatofy/ui';
import { Reveal } from '@/components/motion/reveal';
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
 *
 * Three columns divided by hairlines, not three cards. Three identical white cards in a
 * row read as three products; a sequence on the page ground reads as one explanation,
 * and it leaves the hero card as the one elevated thing on this stretch of the page.
 */
export async function HowItWorks() {
  const t = await getT();

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
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <Reveal as="li" key={step.title} delay={index * 90}>
            <div className="border-hairline duration-base ease-standard hover:border-foreground/25 flex h-full flex-col gap-3 rounded-xl border p-6 transition hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
              <span
                aria-hidden
                className="h-1 w-12 rounded-full"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
                }}
              />
              {/* Ordinal, not a count of anything — the sequence is the content. */}
              <span
                aria-hidden
                className="font-display text-muted-foreground text-display font-light leading-none"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-body mt-2 font-medium tracking-tight">{step.title}</h3>
              <p className="text-prose text-hint">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
