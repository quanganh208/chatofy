import { color, fontSize, fontWeight, radius, space } from '@chatofy/ui';

/**
 * The popup's stylesheet, injected rather than written into `index.html`.
 *
 * An HTML `<style>` block cannot import TypeScript, and the popup shares its
 * state colours with the overlay — a red that means "blocked", an amber that
 * means "you have a step left". Keeping them in the markup meant maintaining a
 * second copy of the palette and letting it drift.
 *
 * Unlike the overlay this is an ordinary extension page: no shadow root, no
 * third-party DOM, and nothing hostile to defend against. It is written the same
 * way purely because the token path already exists and a second mechanism would
 * be one more thing to know.
 *
 * The controls are styled explicitly rather than left to `color-scheme`, because
 * browsers disagree about what a dark `<select>` looks like — and a form that is
 * half native and half branded reads as broken rather than as either.
 *
 * No backticks below: this is a template literal.
 */
export const POPUP_STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    padding: ${space.md}px;
    width: 292px;
    font: ${fontSize.base}px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: ${color.bg};
    color: ${color.text};
  }
  h1 {
    margin: 0 0 ${space.md - 4}px;
    font-size: ${fontSize.base}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.01em;
  }
  label {
    display: block;
    margin: ${space.md - 4}px 0 ${space.xs}px;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${color.textMuted};
  }
  select, input[type='url'] {
    width: 100%;
    box-sizing: border-box;
    padding: 7px ${space.sm}px;
    font: inherit;
    font-size: ${fontSize.sm}px;
    color: ${color.text};
    background: ${color.surfaceRaised};
    border: 1px solid ${color.borderControl};
    border-radius: ${radius.sm}px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    margin-top: ${space.md - 4}px;
  }
  .row input[type='checkbox'] { width: auto; accent-color: ${color.accent}; }
  .row label {
    margin: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.regular};
    text-transform: none;
    letter-spacing: normal;
    color: ${color.text};
  }
  button {
    width: 100%;
    margin-top: ${space.md - 2}px;
    padding: ${space.sm}px;
    font: inherit;
    font-weight: ${fontWeight.semibold};
    color: ${color.onAccent};
    background: ${color.accent};
    border: 1px solid transparent;
    border-radius: ${radius.sm}px;
    cursor: pointer;
  }
  button:hover { background: ${color.accentHover}; }
  /* Focus is drawn rather than left to the platform: this page is 292px of form
     controls and a lost focus ring is a keyboard user with nowhere to be. */
  button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid ${color.accentText};
    outline-offset: 2px;
  }
  #status { margin-top: ${space.md - 4}px; min-height: 1.4em; font-size: ${fontSize.sm}px; color: ${color.textSecondary}; }
  .hint { margin: ${space.xs}px 0 0; font-size: ${fontSize.sm}px; color: ${color.textMuted}; }
  /* The same three meanings the overlay carries, in the same three colours. */
  .warn {
    margin-top: ${space.md - 4}px;
    padding: ${space.sm}px;
    border-radius: ${radius.sm}px;
    background: ${color.liveSubtle};
    color: ${color.text};
  }
  /* The first-run recording notice. Not dismissible by clicking outside it: the
     acknowledgement is the button, and only the button records that it was seen. */
  #notice, #mic {
    margin-top: ${space.md - 4}px;
    padding: 10px;
    border-radius: ${radius.sm}px;
    background: ${color.warningSubtle};
    color: ${color.text};
    font-size: ${fontSize.sm}px;
  }
  #notice p { margin: 0 0 ${space.sm}px; }
  #mic p { margin: 0; }
  #mic button { margin-top: 8px; }
  [hidden] { display: none !important; }
`;
