import { PlainFrame } from '@/components/layout/plain-frame';
import { getT } from '@/i18n/server';

/**
 * The two lab routes: the continuous-mode experiment and the latency baseline.
 *
 * They live outside `(app)` on purpose — they are not the product — and outside
 * `(marketing)` for the obvious reason, which left them the only surfaces with no group
 * to inherit chrome from. This is that chrome, and it exists so both keep the way back
 * they had under the old shell: reachable only by URL, they are dead ends without it.
 *
 * Note the file tree, which is the whole reason this layout does not capture
 * `/translate` itself. That page is `app/(app)/translate/page.tsx`; layouts apply by
 * ancestry in the tree, not by URL, and a route group is not an ancestor of anything
 * outside it. So `/translate` gets the product chrome and `/translate/live` gets this —
 * two files claiming the same URL segment, which `next build` was checked against before
 * any of this was written.
 *
 * One measure for both, where `/translate/baseline` used to ask for the narrower one.
 * Two unlinked measurement routes are not worth two answers.
 */
export default function TranslateLabLayout({ children }: { children: React.ReactNode }) {
  const t = getT();
  return (
    <PlainFrame
      measure="wide"
      back={{ href: '/translate', label: t('web.chrome.backToTranslator') }}
    >
      {children}
    </PlainFrame>
  );
}
