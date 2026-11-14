import { dawn } from '@chatofy/ui';
import { Reveal } from '@/components/motion/reveal';
import { getT } from '@/i18n/server';
import { Section } from './section';

/** The connector between two steps: the dawn trio, decoration only, never under text. */
const DAWN_LINE = (direction: 'to right' | 'to bottom') =>
  `linear-gradient(${direction}, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

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
 * The one measured number on this page is here: about a second between the end of a
 * sentence and the start of playback. It is the measured ~0.9 s in
 * `docs/development-journey.md`, rounded in the direction that cannot flatter it.
 *
 * Drawn as a timeline: an ordinal on a ring, joined to the next by a thin dawn line —
 * across from `md`, down the left edge below it. The line runs only between the rings,
 * in the row that holds them, so no dawn value is ever behind a word. A sequence on the
 * page ground rather than three cards: it reads as one explanation, and it leaves the
 * hero card as the one elevated thing on this stretch of the page.
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
      <ol className="grid gap-0 md:grid-cols-3 md:gap-8">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <Reveal
              as="li"
              key={step.title}
              delay={index * 90}
              className="relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-5 pb-10 last:pb-0 md:grid-cols-1 md:gap-y-6 md:pb-0"
            >
              {/* Ordinal, not a count of anything — the sequence is the content. */}
              <span
                aria-hidden
                className="border-hairline bg-background font-display text-heading text-muted-foreground relative z-10 flex size-12 items-center justify-center rounded-full border font-light"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              {last ? null : (
                <>
                  <span
                    aria-hidden
                    className="absolute top-14 bottom-2 left-6 w-px md:hidden"
                    style={{ backgroundImage: DAWN_LINE('to bottom') }}
                  />
                  <span
                    aria-hidden
                    className="absolute top-6 right-[-2rem] left-14 hidden h-px md:block"
                    style={{ backgroundImage: DAWN_LINE('to right') }}
                  />
                </>
              )}
              <div className="flex flex-col gap-2 pt-2.5 md:pt-0">
                <h3 className="text-heading font-display tracking-tight">{step.title}</h3>
                <p className="text-prose text-body max-w-[38ch]">{step.body}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </Section>
  );
}
