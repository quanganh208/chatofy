import { getT } from '@/i18n/server';
import { Section } from './section';

/**
 * The privacy notice — the product has no other one, so this section IS it.
 *
 * It says what the translator receives and what is kept, and deliberately makes no claim
 * about where speech is processed. It used to: three "on device / over the network" hops
 * promised the voice was heard on the reader's own computer. That held for a self-hosted
 * checkout and not for anyone using the hosted service, where speech runs on Chatofy's
 * server. The facts that stay true whatever the hosting are the ones below.
 *
 * Written as what happens to the reader's recording rather than as what runs where — the
 * register rule wants the outcome, not the pipeline wearing a privacy hat.
 *
 * One fact per line. It was one paragraph, and at phone width the part a reader would be
 * surprised by later — kept, by link, through a pause — sat in the middle of thirteen
 * lines.
 */
export async function RecordingPrivacy() {
  const t = await getT();

  const kept = [
    t('web.landing.localKeptHistory'),
    t('web.landing.localKeptLink'),
    t('web.landing.localKeptPause'),
    t('web.landing.localKeptDelete'),
    t('web.landing.localKeptMeeting'),
  ];

  return (
    <Section id="privacy">
      <div className="flex max-w-prose flex-col gap-4">
        <h2 className="text-title font-display font-light tracking-tight text-balance">
          {t('web.landing.localTitle')}
        </h2>
        <p className="text-prose text-body">{t('web.landing.localBody')}</p>
        <ul className="border-hairline flex flex-col border-t">
          {kept.map((fact) => (
            <li key={fact} className="text-prose text-hint border-hairline border-b py-3">
              {fact}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
