import type { Metadata } from 'next';
import { ConversationDetail } from '@/components/history/conversation-detail';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.history') };
}

/**
 * One stored conversation.
 *
 * `params` is awaited: it is a promise in this version of Next, and reading it
 * synchronously is the deprecation the framework warns about. The id is handed
 * to a client component because the fetch needs the caller's bearer token — the
 * ownership check is the API's, and a server fetch here would have to forward a
 * credential this layer does not hold.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ConversationDetail conversationId={conversationId} />;
}
