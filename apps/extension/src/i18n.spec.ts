// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, vi as viMessages } from '@chatofy/i18n';
import { isMessageKey, localizeDocument, negotiateLocale } from './i18n';

/**
 * Which language the extension speaks, and the static pages that are filled in
 * from the dictionary rather than rendered by React.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('negotiateLocale', () => {
  it('takes the first preferred language this product ships, by primary subtag', () => {
    expect(negotiateLocale(['vi-VN', 'en-US'])).toBe('vi');
    expect(negotiateLocale(['fr-FR', 'zh-TW', 'en'])).toBe('zh');
    expect(negotiateLocale(['EN-gb'])).toBe('en');
  });

  it('falls back to English when nothing matches or nothing is known', () => {
    expect(negotiateLocale(['fr-FR', 'de'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

describe('the module-level translator', () => {
  it('follows navigator.languages', async () => {
    vi.stubGlobal('navigator', { language: 'vi-VN', languages: ['vi-VN', 'en-US'] });
    const { locale, intlLocale, t } = await import('./i18n');
    expect(locale).toBe('vi');
    expect(intlLocale).toBe('vi');
    expect(t('extension.capture.start')).toBe(viMessages['extension.capture.start']);
  });

  it('falls back to navigator.language when the list is empty', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN', languages: [] });
    const { locale, intlLocale } = await import('./i18n');
    expect(locale).toBe('zh');
    expect(intlLocale).toBe('zh-CN');
  });
});

describe('isMessageKey', () => {
  it('accepts dictionary keys only', () => {
    expect(isMessageKey('extension.capture.start')).toBe(true);
    expect(isMessageKey('extension.nope')).toBe(false);
    expect(isMessageKey('toString')).toBe(false);
    expect(isMessageKey(undefined)).toBe(false);
  });
});

const PAGES = ['../entrypoints/popup/index.html', '../entrypoints/microphone/index.html'].map(
  (path) => ({ path, html: readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8') }),
);

/** Parsed, not mounted: a mounted page would try to fetch its module script. */
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('static pages', () => {
  /**
   * A typo in a `data-i18n` attribute is not a compile error — the page would keep
   * its English fallback in every language and nothing would say so.
   */
  it('name only keys the dictionary has', () => {
    for (const { path, html } of PAGES) {
      const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
      expect(keys.length, path).toBeGreaterThan(0);
      for (const key of keys) expect(isMessageKey(key), `${path}: ${key}`).toBe(true);
    }
  });

  /** The no-script fallback is the English entry itself, not a drifted copy of it. */
  it('carry the English entry as each element’s fallback text', () => {
    for (const { path, html } of PAGES) {
      for (const node of parse(html).querySelectorAll<HTMLElement>('[data-i18n]')) {
        const key = node.dataset.i18n;
        if (!isMessageKey(key)) throw new Error(`${path}: ${key}`);
        expect(node.textContent?.replace(/\s+/g, ' ').trim(), `${path}: ${key}`).toBe(
          en[key].replace(/\s+/g, ' ').trim(),
        );
      }
    }
  });

  it('are rewritten in the reader’s language, text only', async () => {
    vi.stubGlobal('navigator', { language: 'vi-VN', languages: ['vi-VN'] });
    const fresh = await import('./i18n');
    const page = parse(PAGES[0]!.html);

    fresh.localizeDocument(page);

    expect(page.documentElement.lang).toBe('vi');
    const notice = page.getElementById('consent');
    expect(notice?.textContent).toContain(viMessages['extension.consent.recordsAudio']);
    expect(notice?.textContent).not.toContain(en['extension.consent.recordsAudio']);
    // The bold run stays bold: only its text changed.
    expect(notice?.querySelector('strong')?.textContent).toBe(
      viMessages['extension.consent.recordsAudio'],
    );
    expect(page.getElementById('consent-ok')?.textContent?.trim()).toBe(
      viMessages['extension.consent.acknowledge'],
    );
  });

  it('leave an element alone when its key is unknown', () => {
    document.body.innerHTML = '<p data-i18n="extension.missing">kept</p>';
    localizeDocument(document);
    expect(document.body.textContent).toBe('kept');
  });
});
