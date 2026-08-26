import { AppChrome } from '@/components/layout/app-chrome';
import { SkipLink } from '@/components/layout/skip-link';

/**
 * The signed-in product surface, and from here on it looks like one.
 *
 * The skip link is rendered before the chrome, deliberately and structurally: it has to
 * be the first thing a keyboard reaches, and the only way to guarantee that is to put it
 * above everything that can hold focus. This group is where it earns its place — the
 * sidebar puts the whole navigation in front of the content on every route.
 *
 * `/translate/live` and `/translate/baseline` are deliberately NOT in this group. They
 * are the continuous-mode experiment and the latency baseline — reachable by URL, linked
 * from nothing. Putting them inside the product chrome would say they are part of the
 * product, and the sidebar would then have to explain them. They get the plain frame in
 * `app/translate/layout.tsx` instead.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <AppChrome>{children}</AppChrome>
    </>
  );
}
