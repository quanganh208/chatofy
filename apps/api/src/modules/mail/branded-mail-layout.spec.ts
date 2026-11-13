import { describe, expect, it } from 'vitest';
import {
  brandedMailLogoUrl,
  escapeHtml,
  renderBrandedMail,
} from './branded-mail-layout';

const PARTS = {
  lang: 'en',
  title: 'Title',
  heading: 'Heading',
  intro: 'Intro.',
  action: 'Act',
  link: 'https://app.example.com/x?token=abc',
  fallback: 'Paste this:',
  outro: 'Outro.',
  footer: ['Line one.', 'Line two.'],
  logoUrl: 'https://app.example.com/email/chatofy-mark@2x.png',
} as const;

describe('escapeHtml', () => {
  it('escapes the five characters that leave a text node or attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('brandedMailLogoUrl', () => {
  it('resolves the logo against the web base URL', () => {
    expect(brandedMailLogoUrl('https://chatofy.example.com')).toBe(
      'https://chatofy.example.com/email/chatofy-mark@2x.png',
    );
  });
});

describe('renderBrandedMail', () => {
  const html = renderBrandedMail(PARTS);

  it('declares both colour schemes and carries a dark palette', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
  });

  it('shows the logo with alt text and the wordmark as live text', () => {
    expect(html).toContain(
      `<img src="${PARTS.logoUrl}" width="36" height="36" alt="Chatofy"`,
    );
    expect(html).toContain('>chatofy</td>');
  });

  it('has exactly one filled button, in ink', () => {
    expect(html.match(/class="cf-btn"/g)).toHaveLength(1);
    expect(html).toContain('bgcolor="#1C1917"');
  });

  it('puts every piece of copy in the document, in a hidden preheader too', () => {
    for (const value of [
      PARTS.title,
      PARTS.heading,
      PARTS.action,
      PARTS.fallback,
      PARTS.outro,
      ...PARTS.footer,
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toMatch(/<div style="display:none;[^"]*">Intro\./);
  });

  it('lets the visible link wrap instead of widening a narrow screen', () => {
    expect(html).toMatch(/word-break:break-all;[^"]*">https:\/\/app/);
    // Only the link: on the paragraph it would split ordinary words mid-word.
    expect(html.match(/word-break:break-all/g)).toHaveLength(1);
  });

  it('pads the button for Outlook on the cell and for everyone else on the link', () => {
    expect(html).toMatch(/class="cf-btn"[^>]*mso-padding-alt:12px 22px;/);
    expect(html).toMatch(
      /class="cf-btn-label"[^>]*display:inline-block;padding:12px 22px;/,
    );
  });

  it('gives Outlook a fixed-width ghost table around the content column', () => {
    expect(html).toContain(
      '<!--[if mso]><table role="presentation" width="560" align="center"',
    );
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
    expect(html).toContain('max-width:560px;');
  });
});
