import type { Translate } from '@chatofy/i18n';

/**
 * The landing page's questions, in the order the page asks them.
 *
 * One list, three readers: the FAQ section renders it, the JSON-LD `FAQPage` node is
 * built from it, and `/index.md` carries it. Markup or a markdown twin that answers a
 * question the page does not — or answers it differently — is the drift this exists to
 * prevent, so none of the three spells the keys out on its own.
 *
 * Every answer is a fact about `main`; the en dictionary's comment above the FAQ keys
 * names the source each one is traced to.
 */
export const LANDING_FAQ = [
  'Languages',
  'Wait',
  'Headphones',
  'Recordings',
  'Cost',
  'Extension',
  'Account',
  'Phone',
] as const;

export type LandingFaqTopic = (typeof LANDING_FAQ)[number];

export interface LandingFaqEntry {
  topic: LandingFaqTopic;
  question: string;
  answer: string;
}

/** The questions and answers, resolved in the reader's locale. */
export function landingFaq(t: Translate): LandingFaqEntry[] {
  return LANDING_FAQ.map((topic) => ({
    topic,
    question: t(`web.landing.faq${topic}Question`),
    answer: t(`web.landing.faq${topic}Answer`),
  }));
}
