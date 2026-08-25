/**
 * Sign in, register, and the three token-carrying routes.
 *
 * A pass-through in this phase. The chrome cannot move up here yet: each of these
 * pages passes its own `back` link to `AppShell` — `/forgot-password` and
 * `/reset-password` point at `/login`, the others have none — and a layout receives
 * nothing from the page below it. Hoisting the header now would either drop those
 * links or invent a slot, and both are visible changes in a phase whose whole value
 * is that there are none.
 *
 * The next phase gives this group a real auth frame and solves the back link with it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
