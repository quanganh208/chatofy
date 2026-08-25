import { MarketingHeader } from '@/components/layout/marketing-header';
import { MEASURE } from '@/components/layout/measures';
import { cn } from '@/lib/utils';

/**
 * The public surface: today just `/`.
 *
 * Wider than the app measure on purpose. A landing page is read in sections across the
 * full column; a transcript is read line by line and wants the shorter line length. The
 * value lives in `measures.ts` — this file asks for a name.
 *
 * No skip link here yet, and that is the same rule the header follows: there is no
 * section nav to skip. It arrives with the anchors in the landing phase.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto flex w-full flex-1 flex-col px-6 py-8', MEASURE.marketing)}
      >
        {children}
      </main>
    </div>
  );
}
