import { Brand } from '@/components/layout/brand';
import { MarketingHeader } from '@/components/layout/marketing-header';
import { SkipLink } from '@/components/layout/skip-link';
import { MEASURE } from '@/components/layout/measures';
import { cn } from '@/lib/utils';

/**
 * The public surface: today just `/`.
 *
 * Wider than the app measure on purpose. A landing page is read in sections across the
 * full column; a transcript is read line by line and wants the shorter line length. The
 * value lives in `measures.ts` — this file asks for a name.
 *
 * The skip link arrives with the section nav it exists to skip: the header now holds
 * three anchors plus the auth pair, which is enough tab stops to be worth jumping.
 *
 * The footer is a rule and a mark, nothing more. A landing page with no legal pages, no
 * social accounts and no company behind it has a link list of length zero, and drawing
 * an empty one would be pretending otherwise.
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
      <footer className="border-hairline border-t">
        <div className={cn('mx-auto flex w-full items-center gap-4 px-6 py-6', MEASURE.marketing)}>
          <Brand className="text-hint" />
          <span className="text-hint text-muted-foreground ml-auto">Tiếng Việt ↔ English</span>
        </div>
      </footer>
    </div>
  );
}
