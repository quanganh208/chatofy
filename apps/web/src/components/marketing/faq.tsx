import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { landingFaq } from '@/lib/landing-faq';

/**
 * The questions a visitor asks before granting a microphone, answered from the product.
 *
 * The list lives in `lib/landing-faq.ts` because two other readers need exactly it: the
 * JSON-LD `FAQPage` node and `/index.md`. Each answer is traced to code or existing copy —
 * the dictionary's comment above the FAQ keys names the source of each — and a question
 * whose honest answer is "not yet" says so.
 *
 * The shared `Accordion`, never a hand-written disclosure: it carries the keyboard model,
 * the `aria-expanded` wiring and the reduced-motion guard on its open and close.
 * `type="single" collapsible`, one answer open at a time, so the list stays scannable.
 *
 * Two columns from `lg`: the heading holds the left as a sticky label while the list
 * scrolls past it. No control in this section is filled.
 */
export async function Faq() {
  const t = await getT();
  const entries = landingFaq(t);

  return (
    <section id="faq" className="scroll-mt-24 py-16">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-title font-display font-light tracking-tight text-balance">
            {t('web.landing.faqTitle')}
          </h2>
        </div>
        <Accordion type="single" collapsible className="border-hairline border-t">
          {entries.map((entry) => (
            <AccordionItem key={entry.topic} value={entry.topic} className="border-hairline">
              <AccordionTrigger className="text-body py-5 hover:no-underline">
                {entry.question}
              </AccordionTrigger>
              <AccordionContent className="text-prose max-w-prose pb-5">
                {entry.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
