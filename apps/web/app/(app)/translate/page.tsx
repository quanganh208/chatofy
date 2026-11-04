import { redirect } from 'next/navigation';

/**
 * `/translate` itself is no page any more: one-way and two-way are its two
 * children. It stays as an address because every link, bookmark and saved
 * `next` written before the split points here, and it opens one-way, the mode
 * that asks nothing of the other side.
 */
export default function TranslatePage() {
  redirect('/translate/one-way');
}
