import { PlainFrame } from '@/components/layout/plain-frame';

/**
 * Sign in, register, and the three token-carrying routes.
 *
 * `PlainFrame` and not the product chrome, which is the requirement rather than a
 * styling choice: **no navigation and no sign-out control on any of these routes.**
 * Until now that held only because `SessionMenu` returned `null` when signed out — a
 * behaviour of a component two files away, not a property of these pages. The frame has
 * no session anything, so it is now structural.
 *
 * The return links stay in the pages. Each of these routes wants a different one — back
 * to sign in from the reset flow, "already have an account" from register, none at all
 * from login and verify — and a layout receives nothing from the page below it. In the
 * page they also sit where they belong: under the form they are an alternative to,
 * rather than in a header corner.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PlainFrame>{children}</PlainFrame>;
}
