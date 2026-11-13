/**
 * The HTML part of every auth mail: one hand-written layout, filled with fixed
 * copy from `MAIL_CONTENT` and exactly one dynamic value, the link.
 *
 * Mail clients are not browsers. Gmail drops `<style>` in some views and Outlook
 * renders with Word, so the layout is nested tables with every colour and size
 * inline, and the `<style>` block only ADDS things a client may ignore: the dark
 * palette and the narrow-screen padding. A client that strips it still shows the
 * light mail, complete.
 *
 * Colours are the light and dark tokens of `docs/design-guidelines.md` § Palette.
 * The one filled control is the ink button, as on every app screen; dawn appears
 * only in the logo, never behind text or on the button.
 *
 * Every inserted string is HTML-escaped, including the fixed copy. The link is
 * the only value that is not ours, and it reaches both an attribute and text.
 */

/** Everything one rendered mail needs. All but `link` is fixed copy or config. */
export interface BrandedMailParts {
  readonly lang: string;
  readonly title: string;
  readonly heading: string;
  readonly intro: string;
  readonly action: string;
  readonly link: string;
  readonly fallback: string;
  readonly outro: string;
  readonly footer: readonly string[];
  readonly logoUrl: string;
}

/** Where the logo lives under the web app's `public/`. */
const LOGO_PATH = '/email/chatofy-mark@2x.png';

/**
 * CSS px the logo is shown at. The PNG is the `full` mark on a night tile,
 * 128×128, so this is about 3.5× density. 36 rather than 32 because the tile's
 * padding leaves the lotus itself only ~62% of the width.
 */
const LOGO_SIZE = 36;

/** The content column; the Outlook ghost table fixes it, everyone else caps at it. */
const MAX_WIDTH = 560;

const BUTTON_PADDING = '12px 22px';

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The wordmark is live text, the one exception to the outlined-path rule in
 * `docs/brand-mark.md`: a raster would be hidden while images are blocked and
 * could not follow the dark palette. Newsreader leads for the rare reader who
 * has it installed; Georgia is the face nearly everyone sees.
 */
const SERIF = "Newsreader,Georgia,'Times New Roman',serif";

/** Light tokens, inline. The dark half lives in `HEAD_CSS`. */
const C = {
  bg: '#F5F5F4',
  surface: '#FFFFFF',
  border: '#DDDAD7',
  text: '#1C1917',
  secondary: '#57534E',
  muted: '#6B6560',
  onAccent: '#FFFFFF',
} as const;

/**
 * Additions a client may drop: tighter padding on a phone, and the dark palette
 * for clients that honour `prefers-color-scheme` (Apple Mail, iOS, Outlook for
 * Mac). `!important` because the light values are inline.
 */
const HEAD_CSS = `
body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
@media (max-width:480px){
.cf-outer{padding:24px 12px !important;}
.cf-card{padding:24px 20px !important;}
.cf-heading{font-size:22px !important;}
}
@media (prefers-color-scheme:dark){
.cf-bg{background-color:#0C0A09 !important;}
.cf-card{background-color:#1C1917 !important;border-color:#2E2A27 !important;}
.cf-text{color:#F5F5F4 !important;}
.cf-secondary{color:#C4BFBA !important;}
.cf-muted{color:#A8A29E !important;}
.cf-btn{background-color:#F5F5F4 !important;}
.cf-btn-label{color:#0C0A09 !important;}
}`;

/** Escapes the five characters that can leave a text node or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The logo's absolute URL. `webBaseUrl` is the configured WEB_BASE_URL — the
 * image has to load from somewhere public, and where that is belongs to the
 * deployment, so it is read from configuration rather than parsed out of a link.
 */
export function brandedMailLogoUrl(webBaseUrl: string): string {
  return new URL(LOGO_PATH, webBaseUrl).toString();
}

function paragraph(text: string, style: string, className: string): string {
  return `<p class="${className}" style="margin:0 0 20px;font-family:${SANS};${style}">${text}</p>`;
}

/** Renders the complete HTML document for one mail. */
export function renderBrandedMail(parts: BrandedMailParts): string {
  const e = {
    lang: escapeHtml(parts.lang),
    title: escapeHtml(parts.title),
    heading: escapeHtml(parts.heading),
    intro: escapeHtml(parts.intro),
    action: escapeHtml(parts.action),
    link: escapeHtml(parts.link),
    fallback: escapeHtml(parts.fallback),
    outro: escapeHtml(parts.outro),
    footer: parts.footer.map(escapeHtml).join('<br>'),
    logoUrl: escapeHtml(parts.logoUrl),
  };

  // The inbox preview line. Padded with zero-width non-joiners (&#8204;) and
  // spaces so the client does not fill the rest of the preview with the logo's
  // alt text and the heading.
  const preheader =
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">` +
    `${e.intro}${'&#8204;&nbsp;'.repeat(40)}</div>`;

  const brand =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;"><tr>` +
    `<td style="vertical-align:middle;padding:0 8px 0 0;">` +
    `<img src="${e.logoUrl}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" alt="Chatofy" ` +
    `style="display:block;width:${LOGO_SIZE}px;height:${LOGO_SIZE}px;border:0;outline:none;text-decoration:none;"></td>` +
    `<td class="cf-text" style="vertical-align:middle;font-family:${SERIF};font-size:22px;font-weight:500;line-height:1;color:${C.text};">chatofy</td>` +
    `</tr></table>`;

  // Padding lives on the `<a>` so the whole button is the link, and is repeated
  // on the `<td>` as `mso-padding-alt`, because Word-engine Outlook ignores
  // padding on an inline element and would otherwise draw a button the height
  // of its label. Outlook alone reads the `mso-` property, so no client pads twice.
  const button =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr>` +
    `<td class="cf-btn" bgcolor="${C.text}" style="border-radius:6px;background-color:${C.text};mso-padding-alt:${BUTTON_PADDING};">` +
    `<a class="cf-btn-label" href="${e.link}" target="_blank" ` +
    `style="display:inline-block;padding:${BUTTON_PADDING};font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;color:${C.onAccent};text-decoration:none;border-radius:6px;">` +
    `${e.action}</a></td></tr></table>`;

  const fallback = paragraph(
    `${e.fallback}<br>` +
      `<a class="cf-text" href="${e.link}" target="_blank" style="color:${C.text};text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${e.link}</a>`,
    `font-size:13px;line-height:1.6;color:${C.muted};`,
    'cf-muted',
  );

  const card =
    `<td class="cf-card" style="background-color:${C.surface};border:1px solid ${C.border};border-radius:8px;padding:32px;">` +
    brand +
    `<h1 class="cf-text cf-heading" style="margin:0 0 12px;font-family:${SERIF};font-size:24px;font-weight:500;line-height:1.3;color:${C.text};">${e.heading}</h1>` +
    paragraph(
      e.intro,
      `font-size:15px;line-height:1.6;color:${C.secondary};`,
      'cf-secondary',
    ) +
    button +
    fallback +
    `<p class="cf-muted" style="margin:0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">${e.outro}</p>` +
    `</td>`;

  const footer =
    `<td class="cf-muted" align="center" style="padding:16px 8px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted};text-align:center;">` +
    `${e.footer}</td>`;

  return (
    `<!doctype html>\n` +
    `<html lang="${e.lang}"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
    `<meta name="supported-color-schemes" content="light dark">` +
    `<title>${e.title}</title>` +
    `<style>${HEAD_CSS}</style>` +
    `</head>\n` +
    `<body class="cf-bg" style="margin:0;padding:0;background-color:${C.bg};">` +
    preheader +
    `<table role="presentation" class="cf-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};"><tr>` +
    `<td class="cf-outer" align="center" style="padding:32px 16px;">` +
    // Word-engine Outlook ignores max-width, so it gets a fixed-width ghost
    // table that every other client skips as a comment.
    `<!--[if mso]><table role="presentation" width="${MAX_WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${MAX_WIDTH}px;">` +
    `<tr>${card}</tr><tr>${footer}</tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>` +
    `</body></html>\n`
  );
}
