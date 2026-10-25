import { describe, expect, it, vi } from 'vitest';

/**
 * What a shared link and a search result see of `/`.
 *
 * The case worth a spec is the silent one: adding any `openGraph` field to this page
 * replaces the root segment's whole Open Graph object, so `app/opengraph-image.png`
 * stops being emitted and `twitter:card` falls back to `summary`. Nothing renders
 * differently in a browser — only a link preview breaks, and only once shared.
 */

vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return { getT: () => Promise.resolve(createTranslator(en)) };
});

// The sections are not under test, and two of them reach the session and the server
// env at import time.
vi.mock('@/../auth', () => ({ auth: () => Promise.resolve(null) }));
vi.mock('@/components/marketing/structured-data', () => ({ StructuredData: () => null }));

const { generateMetadata } = await import('./page');

describe('the landing metadata', () => {
  it('keeps the social card when it sets Open Graph fields', async () => {
    const meta = await generateMetadata();
    const og = meta.openGraph as { images?: { url: string; alt?: string }[] } | undefined;
    expect(og?.images?.[0]).toMatchObject({ url: '/opengraph-image.png' });
    expect(og?.images?.[0]?.alt).toBeTruthy();
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('is its own canonical and advertises its markdown twin', async () => {
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe('/');
    expect(meta.alternates?.types).toEqual({ 'text/markdown': '/index.md' });
  });
});
