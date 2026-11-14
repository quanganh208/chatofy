import { MarketingFooter } from '@/components/layout/marketing-footer';
import { MarketingHeader } from '@/components/layout/marketing-header';
import { SkipLink } from '@/components/layout/skip-link';
import { MEASURE } from '@/components/layout/measures';
import { cn } from '@/lib/utils';

/**
 * The public surface: `/` and `/pricing`.
 *
 * Wider than the app measure on purpose. A landing page is read in sections across the
 * full column; a transcript is read line by line and wants the shorter line length. The
 * value lives in `measures.ts` — this file asks for a name.
 *
 * The skip link arrives with the section nav it exists to skip: the header holds five
 * anchors plus the auth pair, which is enough tab stops to be worth jumping.
 *
 * The footer (`MarketingFooter`) holds the mark and four short columns, every link in
 * them pointing at something that exists — see that component for why there are no
 * legal or social links.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <MarketingHeader />
      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto flex w-full flex-1 flex-col px-6 py-8', MEASURE.marketing)}
      >
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
