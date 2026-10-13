import { serverEnv } from '@/config/server-env';
import { getT } from '@/i18n/server';
import { landingMarkdown, machineReadableHeaders } from '@/lib/landing-markdown';

/**
 * `/index.md`: the landing page's markdown twin, in the reader's locale. The page
 * advertises it with `<link rel="alternate" type="text/markdown">`.
 *
 * Exempt from `proxy.ts` by its extension, like every other file-shaped path.
 */
export async function GET() {
  const t = await getT();
  return new Response(landingMarkdown(t, serverEnv.WEB_BASE_URL), {
    headers: machineReadableHeaders('text/markdown'),
  });
}
