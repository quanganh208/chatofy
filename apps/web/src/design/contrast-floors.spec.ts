import { describe, expect, it } from 'vitest';
import { palettes, type ColorScheme } from '@chatofy/ui';

/**
 * The measured floors under the palette, and the thing that fails when one slips.
 *
 * This began life as `plans/260820-1131-two-theme-palette/measure-palette.py`,
 * which `docs/design-guidelines.md` and `packages/ui/src/tokens.ts` both cite as
 * the enforcement authority — "fails when one slips". It could not be: `plans/`
 * is a record of work rather than a part of the product, nothing ran it, and a
 * single `git rm` of the plan tree took the cited authority with it. That
 * happened, which is why this file exists.
 *
 * Two things changed in the move and both are deliberate:
 *
 * - The colours are READ FROM `tokens.ts` instead of being restated. The Python
 *   version carried its own copy of both palettes, so it measured whatever it had
 *   been told last rather than what the product ships. A hex changed in the token
 *   module and not here would have passed.
 * - It runs in CI, because it is a spec beside `token-parity.spec.ts` rather than
 *   a script someone remembers.
 *
 * The pairs are listed rather than generated. A cross-product measures hundreds of
 * combinations nobody renders and buries the handful that matter; every row below
 * is a pairing that appears on a real surface.
 */

const SCHEMES = ['light', 'dark'] as const satisfies readonly ColorScheme[];

type Token = keyof (typeof palettes)['light'];

/** `[foreground, background, floor, what it is]`. */
const PAIRS: ReadonlyArray<readonly [Token, Token, number, string]> = [
  ['text', 'bg', 4.5, 'body on the page'],
  ['text', 'surface', 4.5, 'body on a card'],
  ['text', 'surfaceRaised', 4.5, 'body on a control'],
  ['textSecondary', 'bg', 4.5, 'supporting prose'],
  ['textSecondary', 'surface', 4.5, 'supporting prose on a card'],
  ['textMuted', 'bg', 4.5, 'hints and labels'],
  ['textMuted', 'surface', 4.5, 'hints on a card'],
  ['accentText', 'bg', 4.5, 'accent used as text'],
  ['accentText', 'surface', 4.5, 'accent as text on a card'],
  ['onAccent', 'accent', 4.5, 'label on the primary button'],
  ['onAccent', 'accentHover', 4.5, 'label on the primary button, hovered'],
  ['accentText', 'accentSubtle', 4.5, 'accent text on its own tint'],
  ['onLiveFill', 'liveFill', 4.5, 'label on the stop button'],
  ['live', 'bg', 4.5, 'recording text'],
  ['live', 'surface', 4.5, 'recording text on a card'],
  ['speaking', 'bg', 4.5, 'speaking text'],
  ['warning', 'warningSubtle', 4.5, 'warning text on its own tint'],
  ['text', 'warningSubtle', 4.5, 'body inside a warning notice'],
  ['text', 'liveSubtle', 4.5, 'body inside an error notice'],
  // 3:1 is WCAG 1.4.11's floor for the visual boundary of a user interface
  // component. It applies to a control outline and not to a divider, and that
  // difference is a real distinction in the spec rather than a threshold lowered
  // because it failed.
  //
  // These two rows used to be introduced as "a control's boundary — it does not
  // recede under the elevation direction". Direction C1 made that false, and the
  // rows are rewritten rather than deleted because what they measure is still
  // load-bearing; only what they CLAIM had to change.
  //
  // What they claimed: that every control carries a 3:1 outline. Under C1 no
  // control does by default — a field is a well and a button is an object on the
  // surface, and the edge each ends up with composites to 1.13:1 light and 1.17:1
  // dark. Deliberate, measured, recorded in `docs/design-guidelines.md`. Left as
  // they were, these would be green rows asking a question nothing answers, which
  // is worse than a red one: the next reader takes them as proof the floor is met
  // everywhere.
  //
  // What they claim now: `borderControl` is the token used WHERE A REAL BOUNDARY
  // IS STILL REQUIRED, and it still clears the floor on the grounds those cases
  // stand on. The escalation list is in the guidelines and is short — a checkbox
  // or radio whose shape is its edge, an invalid field, a notice's action (which
  // has a row of its own below). `surfaceRaised` stays alongside `surface`
  // because it is the tighter of the two grounds, not because a control is
  // presumed to sit on it.
  //
  // Nothing here can see whether a component still ASKS for this token. That is
  // `packages/ui/src/react/skin-guard.spec.ts`, which reads component source; a
  // ratio between two tokens cannot.
  ['borderControl', 'surface', 3.0, 'escalation boundary on a card — WCAG 1.4.11'],
  ['borderControl', 'surfaceRaised', 3.0, 'escalation boundary on a raised ground'],
  // A control inside a filled notice — the "Allow microphone" button, and any
  // other action an Alert carries.
  //
  // This block is the RECORDED EXCEPTION to direction C1 and is deliberately
  // unchanged by it. C1 took the outline off every other control and accepted a
  // 1.13:1 at-rest edge; on a filled notice that trade was refused, so this row
  // goes on measuring a treatment that goes on rendering. The rejected
  // alternative was moving the hue to the fill, at 1.90:1 for the notice's own
  // ink in dark — see `alert.tsx`.
  //
  // This ground was missing from the table, and its absence hid a real 1.4.11
  // failure for as long as the table existed: on a notice a control stands on
  // `warningSubtle` / `liveSubtle`, not on `surface`, and `borderControl` against
  // those measures 2.95, 2.87 and 2.70:1. The table only ever asked about
  // `surface` and `surfaceRaised`, so a control standing on a notice was never a
  // question it could answer.
  //
  // The fix is in `alert.tsx`, which re-borders a notice's actions in the
  // notice's own hue. That override is what has to hold, so it is asserted where
  // it lives — `packages/ui/src/react/skin-guard.spec.ts`, which reads the
  // component source. A ratio here cannot see whether the component still asks
  // for the token it measures.
  //
  // Only the red pair is added below. `warning` on `warningSubtle`, `text` on
  // `warningSubtle` and `text` on `liveSubtle` are already held to 4.5 earlier in
  // this table, which is strictly stronger than 1.4.11's 3:1 — restating them at
  // 3.0 would be a row that cannot fail unless a 4.5 row already has.
  ['live', 'liveSubtle', 3.0, 'action outline inside an error notice'],
  // These two carried a floor because the old direction separated surfaces with
  // rules, so an invisible rule took the mechanism with it. Shadow does that work
  // now and the hairline is free to recede — but the floors stay, because nothing
  // has replaced what they measure on the surfaces still using a border, and
  // lowering a floor is a decision rather than a consequence.
  ['borderStrong', 'bg', 2.0, 'emphasised divider — visible, not a boundary'],
  ['border', 'bg', 1.2, 'hairline between surfaces'],
];

/**
 * Pairs a reader must tell apart.
 *
 * The labelling rule covers meaning — every state carries words, never colour
 * alone. This covers the case where two states sit side by side and only the hue
 * separates them, which is the red/green pair the status dot puts in one place.
 */
const HUES: ReadonlyArray<readonly [Token, Token, number]> = [
  ['accent', 'speaking', 60],
  ['live', 'speaking', 60],
  ['accent', 'live', 60],
  ['warning', 'live', 25],
];

/**
 * The achromatic-accent exemption — the one row this table has ever replaced
 * rather than kept.
 *
 * The hue rows above assume the accent HAS a hue. Direction A made it ink:
 * `#1C1917` in light, `#F5F5F4` in dark. The hue of a colour that close to grey is
 * whatever the rounding of its last few units says — `#1C1917` measures 24° and
 * `#F5F5F4` 60° — and no reader can see either, so a hue floor on it measures
 * noise. Keeping those rows would have meant tinting the ink until the arithmetic
 * passed, which is changing the approved colour to satisfy a test that no longer
 * describes it.
 *
 * What still has to hold is the reason the rows existed: the primary action and a
 * state colour, side by side, must not be mistaken for each other. For an
 * achromatic accent that separation is lightness, so the replacement row measures
 * it as a luminance ratio. 2.0 is this table's own floor for "visible, not a
 * boundary" (`borderStrong` on `bg`) — the two are never read as text against each
 * other, they are told apart at a glance.
 *
 * The exemption is narrow on purpose. It applies only while the accent's chroma
 * (max − min channel) is under `ACHROMATIC_CHROMA`; an accent that regains a hue
 * gets its hue rows back automatically, and `live`/`speaking`/`warning` never
 * leave the hue table.
 */
const ACHROMATIC_CHROMA = 0.08;
const ACCENT_SEPARATION = 2.0;

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees, for the "only colour tells these apart" check. */
function hue(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Max minus min channel, 0–1: how far a colour is from grey at all. */
function chroma(hex: string): number {
  const c = channels(hex);
  return Math.max(...c) - Math.min(...c);
}

/** The shorter way round the wheel — 350° and 10° are 20° apart, not 340°. */
function hueDistance(a: string, b: string): number {
  const raw = Math.abs(hue(a) - hue(b));
  return Math.min(raw, 360 - raw);
}

describe.each(SCHEMES)('%s palette clears its floors', (scheme) => {
  const palette = palettes[scheme];

  it.each(PAIRS)('%s on %s clears %s:1 — %s', (fg, bg, floor, what) => {
    const ratio = contrast(palette[fg], palette[bg]);
    expect(
      ratio,
      `${what}: ${fg} (${palette[fg]}) on ${bg} (${palette[bg]}) measured ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(floor);
  });

  const achromaticAccent = chroma(palette.accent) < ACHROMATIC_CHROMA;
  const hueRows = HUES.filter(
    ([a, b]) => !(achromaticAccent && (a === 'accent' || b === 'accent')),
  );
  const separationRows = HUES.filter(
    ([a, b]) => achromaticAccent && (a === 'accent' || b === 'accent'),
  ).map(([a, b]) => (a === 'accent' ? b : a));

  it.each(hueRows)('%s and %s stay at least %s° apart', (a, b, floor) => {
    const degrees = hueDistance(palette[a], palette[b]);
    expect(
      degrees,
      `${a} (${palette[a]}) and ${b} (${palette[b]}) are ${degrees.toFixed(1)}° apart`,
    ).toBeGreaterThanOrEqual(floor);
  });

  // `it.each` refuses an empty table, and a chromatic accent leaves this one empty.
  if (separationRows.length > 0) {
    it.each(separationRows)('the achromatic accent and %s stay apart in lightness', (state) => {
      const ratio = contrast(palette.accent, palette[state]);
      expect(
        ratio,
        `accent (${palette.accent}) and ${state} (${palette[state]}) measured ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(ACCENT_SEPARATION);
    });
  }
});

/**
 * The focus ring as it is DRAWN, not as the token reads.
 *
 * The default ring is `ring-ring/50` — `accentText` at half opacity, with no offset —
 * so the colour a reader sees is that ink composited over the ground the control
 * stands on. With an ink accent the full-strength token clears 3:1 by a mile while
 * the drawn ring clears it by a fraction, which is exactly the margin a token-only
 * row cannot see.
 *
 * ## What this does NOT cover
 *
 * `--ring` only. A control that is `aria-invalid` REPLACES this ring rather than
 * adding to it — `input.tsx` draws `aria-invalid:focus-visible:ring-destructive/50`,
 * and the same override is in `select`, `textarea`, `checkbox`, `radio-group`,
 * `toggle`, `badge` and `button`. A ring is one box-shadow slot, so for an invalid
 * AND focused control that destructive ring is the only state indicator there is,
 * and it measures 2.18–2.45:1 on `bg`/`surface`/`surfaceRaised` in both schemes —
 * under 1.4.11's 3:1.
 *
 * That state is older than this table and unchanged by the repalette; the
 * destructive hexes never moved. It is recorded here rather than asserted because
 * closing it is a palette decision (raise the alpha, or move `live`), not a
 * measurement. `docs/design-guidelines.md` carries the same note. Do not read the
 * rows below as proof that every focusable control clears the floor — they prove it
 * for the default ring, which is the one the ink accent put at risk.
 */
const RING_GROUNDS: readonly Token[] = [
  'bg',
  'surface',
  'surfaceRaised',
  'warningSubtle',
  'liveSubtle',
];

function over(ink: string, ground: string, alpha: number): string {
  const [a, b] = [channels(ink), channels(ground)];
  return (
    '#' +
    a
      .map((value, i) => Math.round((value * alpha + b[i]! * (1 - alpha)) * 255))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  );
}

describe.each(SCHEMES)('%s focus ring, as drawn', (scheme) => {
  const palette = palettes[scheme];
  it.each(RING_GROUNDS)('clears 3:1 on %s at 50%%', (ground) => {
    const drawn = over(palette.accentText, palette[ground], 0.5);
    const ratio = contrast(drawn, palette[ground]);
    expect(
      ratio,
      `ring ${drawn} on ${ground} measured ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(3);
  });
});
