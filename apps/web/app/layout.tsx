import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AppSessionProvider } from '@/components/session-provider';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import './globals.css';

/**
 * Self-hosted at build time rather than linked from Google, so the page pulls no
 * third-party request and cannot shift layout waiting for one.
 */
const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  // NOT `--font-sans`. Tailwind v4 defines that name itself inside `@layer theme`,
  // and both declarations would have equal specificity — Inter would survive only
  // because an unlayered rule beats a layered one, which is a source-order
  // accident waiting to be reordered. `globals.css` aliases `--font-sans` to this
  // in `@theme inline` instead, which is the supported way round.
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Chatofy',
  description: 'Realtime Vietnamese ↔ English voice translator',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No theme class from the server. Which ground the reader chose lives in their
    // browser, and the server renders the same HTML for everyone — so the class is
    // applied by the script below, before anything paints. `suppressHydrationWarning`
    // is the price: React would otherwise report the attribute it did not write.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint, which is the whole point.
          Without it, someone who chose light on a dark machine sees a dark flash on
          every load — the markup arrives with no class, `color-scheme: light dark`
          resolves to the machine's answer, and the correction only lands once React
          has hydrated. No test catches that; it is only visible on reload.

          Kept to one statement and wrapped in try/catch: it runs before any error
          handling exists, and a throw here would leave the page unstyled rather than
          merely mis-themed. The storage key is the one value duplicated from
          `lib/theme.ts`, and a spec compares them.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(c==="light"||c==="dark")document.documentElement.classList.add(c)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
