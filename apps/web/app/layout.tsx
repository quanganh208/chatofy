import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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
    // `dark` is set here rather than left to a media query, because the product is
    // dark on every surface: the meeting overlay cannot be anything else — inside a
    // content script `prefers-color-scheme` reports the OS, not the page — and a web
    // app that followed the OS would stop matching it half the time.
    //
    // `color-scheme` on top of the class is what makes the browser's own
    // furniture — scrollbars, form controls, the autofill background — dark too.
    <html lang="en" className={`dark ${inter.variable}`} style={{ colorScheme: 'dark' }}>
      <body>{children}</body>
    </html>
  );
}
