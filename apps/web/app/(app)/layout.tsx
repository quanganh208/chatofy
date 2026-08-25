/**
 * The signed-in product surface.
 *
 * A pass-through in this phase; the sidebar and topbar arrive in the next one.
 *
 * `/translate/live` and `/translate/baseline` are deliberately NOT in this group.
 * They are the continuous-mode experiment and the latency baseline — reachable by
 * URL, linked from nothing. Putting them inside the product chrome would say they
 * are part of the product, and the sidebar would then have to explain them.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
