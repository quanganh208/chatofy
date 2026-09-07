// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The last of three invitations to the same place.
 *
 * The landing page links `/translate` from the header, the hero and this footer.
 * For a visitor with no account that is a funnel and it is fine — the proxy sends
 * them to sign in. For a visitor who already signed in it is three asks for
 * something already accepted, and only the header ever knew the difference.
 */

const session = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/../auth', () => ({ auth: () => session() }));

vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return { getT: () => Promise.resolve(createTranslator(en)) };
});

const { FooterCta } = await import('./footer-cta');
const { en } = await import('@chatofy/i18n');

async function render(): Promise<string> {
  return renderToStaticMarkup(await FooterCta());
}

describe('FooterCta', () => {
  it('asks a signed-out visitor to start', async () => {
    session.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('href="/translate"');
    expect(html).toContain(en['web.translate.startTranslating']);
  });

  it('asks nothing of someone who already signed in', async () => {
    session.mockResolvedValue({ user: { email: 'a@b.co' } });
    const html = await render();
    expect(html).not.toContain('href="/translate"');
    // The section itself stays: the closing statement is still worth reading, and
    // deleting it would leave the page ending on a feature list.
    expect(html).toContain(en['web.landing.ctaTitle']);
  });
});
