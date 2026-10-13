import { serverEnv } from '@/config/server-env';
import { getT } from '@/i18n/server';
import { llmsTxt, machineReadableHeaders } from '@/lib/landing-markdown';

/** `/llms.txt`: what Chatofy is, and where its markdown lives. */
export async function GET() {
  const t = await getT();
  return new Response(llmsTxt(t, serverEnv.WEB_BASE_URL), {
    headers: machineReadableHeaders('text/plain'),
  });
}
