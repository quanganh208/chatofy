import { getT } from '@/i18n/server';

/**
 * The first thing a keyboard reaches, and the reason it has to be first.
 *
 * With a persistent sidebar, every route now opens with the navigation in front of
 * the content. Without this, reaching the transcript means tabbing past the whole nav
 * on every page — the cost the sidebar quietly added and the thing this repays.
 *
 * `sr-only` until focused, which is why it is invisible in a screenshot and still
 * load-bearing. It must be rendered BEFORE any nav in the layout: a skip link that is
 * not the first stop skips nothing.
 *
 * The target carries `tabIndex={-1}` so the browser can actually move focus there.
 * Without it the URL fragment changes and focus stays where it was, which is the
 * failure mode that makes skip links look implemented and do nothing.
 */
export async function SkipLink() {
  const t = await getT();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:bg-card focus:text-card-foreground focus:ring-ring/50 focus:text-body focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:shadow-md focus:ring-[3px] focus:outline-none"
    >
      {t('web.chrome.skipToContent')}
    </a>
  );
}
