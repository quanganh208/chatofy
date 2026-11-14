import { GraduationCap, Handshake, House, Plane } from 'lucide-react';
import { getT } from '@/i18n/server';
import { Reveal } from '@/components/motion/reveal';
import { Section } from './section';

/**
 * Situations the product was built for, written as situations: no people, no quotes, no
 * numbers. A use case with a name and a smiling quote attached is a testimonial from
 * someone who does not exist, and this page has none.
 *
 * Each one maps to something above it, so none promises more than the modes do:
 * travelling is two-way at a counter, family abroad is the extension inside a call they
 * already use, partners and customers is a meeting with minutes, a class is one-way kept
 * in history.
 *
 * Tiles on the page ground, read side by side — four across on a laptop, two on a
 * tablet, one on a phone.
 */
export async function UseCases() {
  const t = await getT();

  const cases = [
    { Icon: Plane, key: 'Travel' },
    { Icon: House, key: 'Family' },
    { Icon: Handshake, key: 'Partners' },
    { Icon: GraduationCap, key: 'Study' },
  ] as const;

  return (
    <Section
      id="use-cases"
      title={t('web.landing.useCasesTitle')}
      description={t('web.landing.useCasesBody')}
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cases.map(({ Icon, key }, index) => (
          <Reveal as="li" key={key} delay={index * 90}>
            <div className="border-hairline flex h-full flex-col gap-4 rounded-2xl border p-6">
              <span
                aria-hidden
                className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <Icon className="size-5" />
              </span>
              <h3 className="text-heading font-display tracking-tight">
                {t(`web.landing.use${key}Title`)}
              </h3>
              <p className="text-prose text-body">{t(`web.landing.use${key}Body`)}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
