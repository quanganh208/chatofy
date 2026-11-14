import { Download, FileText, Play } from 'lucide-react';
import type { Translate } from '@chatofy/i18n';
import { MockupChip, MockupFrame } from './mockup-parts';

/**
 * History as its list draws it: a title, the kind of conversation, and — where minutes
 * were generated — the "Minutes" readout. No durations, dates or line counts: they are
 * numbers, and this page states exactly one measured number, not invented ones.
 *
 * The first row is the open one, with the actions a stored conversation offers: play the
 * recording, download the transcript. Icons only, because they are decoration here.
 */
export function HistoryMockup({ t }: { t: Translate }) {
  const rows = [
    { title: t('web.landing.mockHistoryOne'), kind: t('web.history.kindTwoWay'), minutes: false },
    { title: t('web.landing.mockHistoryTwo'), kind: t('web.history.kindTwoWay'), minutes: true },
    {
      title: t('web.landing.mockHistoryThree'),
      kind: t('web.history.kindOneWay'),
      minutes: false,
    },
  ];

  return (
    <MockupFrame className="gap-0 p-2">
      {rows.map((row, index) => (
        <div
          key={row.title}
          className={
            index === 0
              ? 'bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5'
              : 'flex items-center gap-3 px-3 py-2.5'
          }
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-body truncate font-medium">{row.title}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-hint text-muted-foreground">{row.kind}</span>
              {row.minutes ? (
                <MockupChip className="py-0">
                  <FileText className="size-3" />
                  {t('web.history.minutesReady')}
                </MockupChip>
              ) : null}
            </div>
          </div>
          {index === 0 ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-2">
              <Play className="size-4" />
              <Download className="size-4" />
            </span>
          ) : null}
        </div>
      ))}
    </MockupFrame>
  );
}

/**
 * A glossary as its table draws it: Original beside Translation, under the page's own
 * column labels. The terms are names a translator would otherwise render word by word —
 * the case a glossary exists for.
 */
export function GlossaryMockup({ t }: { t: Translate }) {
  const terms = (['One', 'Two', 'Three'] as const).map((n) => ({
    source: t(`web.landing.mockTerm${n}Source`),
    target: t(`web.landing.mockTerm${n}Target`),
  }));

  return (
    <MockupFrame className="gap-0 p-0">
      <div className="border-hairline text-hint text-muted-foreground grid grid-cols-2 border-b px-4 py-2.5 font-medium">
        <span>{t('web.glossary.originalLabel')}</span>
        <span>{t('web.glossary.translationLabel')}</span>
      </div>
      {terms.map((term) => (
        <div
          key={term.source}
          className="border-hairline text-body grid grid-cols-2 border-b px-4 py-2.5 last:border-b-0"
        >
          <span className="text-muted-foreground">{term.source}</span>
          <span className="font-medium">{term.target}</span>
        </div>
      ))}
    </MockupFrame>
  );
}
