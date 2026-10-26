import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createTranslator, en } from '@chatofy/i18n';
import { dawn } from '@chatofy/ui';
import { BrandMark } from '@chatofy/ui/react';

/**
 * The source of `app/opengraph-image.png`, the card a shared link shows.
 *
 * A static PNG rendered from this page, not an `opengraph-image.tsx`: `ImageResponse`
 * would need the two faces vendored as font files, cannot read the Tailwind tokens, and
 * would move the image off `/opengraph-image.png`, the URL `page-metadata.spec.ts` pins.
 * This page uses the real `next/font` faces and tokens, so the card and the landing are
 * drawn by the same hand.
 *
 * Development only: it 404s anywhere else, which is also why `proxy.ts` can let it
 * through without a session. Re-render whenever `web.landing.heroTitle` changes, with the
 * web dev server on port 3001, from the repo root:
 *
 *   pnpm --filter extension exec playwright screenshot --browser=chromium \
 *     --viewport-size=1200,630 --color-scheme=light --wait-for-timeout=3000 \
 *     http://localhost:3001/social-card ../web/app/opengraph-image.png
 *
 * English only, like the alt text in `app/(marketing)/page.tsx`: one image serves every
 * locale, so it carries the reference copy.
 */
export const metadata: Metadata = { robots: { index: false } };

export default function SocialCardPage() {
  if (process.env.NODE_ENV !== 'development') notFound();

  const t = createTranslator(en);
  const title = t('web.landing.heroTitle');
  const emphasis = t('web.landing.heroTitleEmphasis');
  // Two lines, broken after the first sentence, as the card has always set it.
  const breakAt = title.indexOf('. ') + 1;
  const [first, second] = [title.slice(0, breakAt), title.slice(breakAt + 1)];
  const at = second.indexOf(emphasis);

  return (
    <div
      className="bg-background text-foreground"
      style={{ width: 1200, height: 630, position: 'relative', overflow: 'hidden' }}
    >
      {/* The dev indicator sits bottom-left, exactly where the headline does, and a
          screenshot would capture it. */}
      <style>{'nextjs-portal{display:none}'}</style>

      {/* The dawn glow. Decorative, and kept off the headline: a dawn value is never
          behind text (`packages/ui/src/tokens.ts`). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -260,
          top: -260,
          width: 760,
          height: 760,
          borderRadius: 9999,
          backgroundImage: `radial-gradient(circle, ${dawn.lavender}, ${dawn.peach} 42%, transparent 70%)`,
          opacity: 0.85,
        }}
      />

      <div
        className="text-heading flex items-center gap-4"
        style={{ position: 'absolute', left: 88, top: 80 }}
      >
        <BrandMark variant="dawn" size={60} />
        <span
          className="font-display leading-none font-medium tracking-tight"
          style={{ fontSize: 60 }}
        >
          chatofy
        </span>
      </div>

      <h1
        className="font-display font-light tracking-tight"
        style={{ position: 'absolute', left: 88, bottom: 72, fontSize: 92, lineHeight: 1.08 }}
      >
        {first}
        <br />
        {at < 0 ? (
          second
        ) : (
          <>
            {second.slice(0, at)}
            <em className="italic">{emphasis}</em>
            {second.slice(at + emphasis.length)}
          </>
        )}
      </h1>
    </div>
  );
}
