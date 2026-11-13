import { redirect } from 'next/navigation';

/**
 * `/translate` itself is no page any more: one-way and two-way are its two
 * children. It stays as an address because every link, bookmark and saved
 * `next` written before the split points here, and it opens one-way, the mode
 * that asks nothing of the other side.
 *
 * The query string comes along. The retired settings routes land here as
 * `/translate?settings=<tab>` (`settings/legacy-settings-redirects.ts`) — Polar's
 * checkout return among them, as `?settings=billing&checkout=done` — and dropping
 * the query would drop the dialog they were sent to open.
 */
export default async function TranslatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, one);
    }
  }
  const search = query.toString();
  redirect(search ? `/translate/one-way?${search}` : '/translate/one-way');
}
