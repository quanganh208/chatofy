import { asLocale, DEFAULT_LOCALE, type Locale } from '@chatofy/i18n';

/**
 * The reader's best supported language, from `Accept-Language`.
 *
 * Only consulted when no cookie has been set — a first visit. After that the cookie is
 * authoritative, including when it says English on a browser that asked for Vietnamese:
 * an explicit choice must not be re-negotiated away on the next request.
 *
 * The header is a q-ranked list (`vi-VN,vi;q=0.9,en;q=0.8`) and the ranking is the part
 * that matters — taking the first entry alone gets `en-US,vi;q=0.9` wrong for nobody,
 * but gets `xh,vi;q=0.9` wrong for someone whose second choice this product actually
 * has. Region subtags are dropped: `vi-VN` and `vi` are the same dictionary here.
 *
 * A malformed q (`q=abc`) sorts as 0 rather than throwing. This is a header anyone can
 * send, and the answer to nonsense is the fallback, not a 500 on the landing page.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((param) => /^\s*q=([\d.]+)\s*$/.exec(param))
        .find((match) => match !== null);
      return { tag: tag.trim().toLowerCase().split('-')[0], quality: q ? Number(q[1]) || 0 : 1 };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    const locale = asLocale(entry.tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
