import { color, fontSize, fontWeight, overlay, radius, space } from '@chatofy/ui';

/**
 * The overlay's stylesheet.
 *
 * Colours come from the shared token module, interpolated as LITERAL VALUES.
 *
 * Not as custom properties, and that is the load-bearing part. `all: initial`
 * does not reset custom properties — they cross a shadow boundary on purpose, as
 * a public styling interface — so an overlay themed with `var(--chatofy-*)` is
 * repaintable by the meeting page, including the recording indicator the page is
 * not allowed to touch. Nothing in this sheet may ever be a `var()`.
 *
 * Two values stay hardcoded here rather than joining the token module. The
 * `z-index` is overlay-specific and must not move because a web design decision
 * moved it. The font stack is set explicitly rather than inherited, because
 * inheriting the meeting page's font is one more thing the page controls.
 *
 * And no `prefers-color-scheme`, ever: inside a content script it reports the
 * OPERATING SYSTEM, not the page, so a light-mode laptop in a dark meeting would
 * get a white slab over the video.
 *
 * The `:host` reset is `!important`, because styles cross into a shadow tree in
 * one direction: normal declarations from the outer tree beat `:host`, so a page
 * could hide the indicator with one rule. Measured, the important form also
 * defeats an inline `style="display:none!important"` the page sets on the host,
 * which is the part that is not obvious.
 *
 * It closes a second route as well, though not the one it is tempting to
 * describe. A bare `transform` on the host does nothing, because `all: initial`
 * leaves the host `display: inline` and transforms do not apply to a non-replaced
 * inline box. Paired with `display: block` it does: the host becomes a containing
 * block for the fixed panel inside it, and the page can then translate the
 * overlay off screen — `filter`, `perspective` and `will-change` do the same.
 * `all` covers that whole family; an enumerated list of `display` / `visibility`
 * / `opacity` would not.
 *
 * The cost of the blanket form: a later normal `:host` declaration in this sheet
 * would lose to it, silently. There is exactly one `:host` rule, and it should
 * stay that way.
 *
 * What none of it closes, because nothing inside a shadow tree can reach an
 * ancestor: `body { display: none }`, `body { content-visibility: hidden }`, or a
 * `filter` on `html`. The last is the worst of them — the overlay is invisible
 * while still passing a hit test.
 *
 * No backticks anywhere below — this is a template literal, and one ends it.
 */
export const OVERLAY_STYLE = `
  :host { all: initial !important; }
  /* Both the pill and the panel anchor here, so collapsing does not move the
     thing being collapsed to a different corner of the video. */
  .root {
    position: fixed;
    right: ${space.md}px;
    bottom: ${space.md}px;
    z-index: 2147483647;
    font: ${fontSize.base}px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: ${color.text};
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  /* The collapsed state, and the default one.
     ~150x32, against a 340px panel that used to sit here whether or not the
     extension had ever been used on this call. */
  .pill {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 0 12px;
    height: 32px;
    font: inherit;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    color: ${color.text};
    background: ${overlay.bg};
    border: 1px solid ${overlay.border};
    border-radius: ${radius.full}px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  .pill:hover { border-color: ${color.borderStrong}; }
  /* Capturing and collapsed. Red, and carrying the same pulsing dot as the
     indicator bar inside the panel, because collapsing must not be a way to make
     a recording look like it is not happening. */
  .pill.live {
    background: ${color.liveFill};
    border-color: ${color.liveFill};
    color: ${color.onLiveFill};
  }
  .pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${color.accentText};
    flex: none;
  }
  .pill.live .pill-dot {
    background: ${color.onLiveFill};
    animation: pulse 1.6s ease-in-out infinite;
  }
  .chevron { font-size: 9px; opacity: 0.7; flex: none; }

  .panel {
    width: 340px;
    /* The cap belongs to the transcript, not to the panel — see .lines. All this
       has to do is stay inside the viewport it is anchored to. Capping the panel
       instead made the header, the recording indicator and the control row compete
       for the same fraction of the screen as the conversation, and on a short
       window the loser was the bottom of the control row. */
    max-height: calc(100vh - ${space.md * 2}px);
    display: flex;
    flex-direction: column;
    background: ${overlay.bg};
    border: 1px solid ${overlay.border};
    border-radius: ${radius.md}px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 8px ${space.sm}px 8px ${space.md - 4}px;
    border-bottom: 1px solid ${overlay.border};
  }
  .title {
    flex: 1;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.01em;
    color: ${color.textSecondary};
  }
  /* Collapses to the pill. Never hides the overlay: while capture runs the pill
     it collapses to is the red one above. */
  .collapse {
    font: inherit;
    font-size: ${fontSize.sm}px;
    line-height: 1;
    color: ${color.textMuted};
    background: transparent;
    border: 1px solid transparent;
    border-radius: ${radius.sm}px;
    padding: 4px 7px;
    cursor: pointer;
    flex: none;
  }
  .collapse:hover { color: ${color.text}; background: ${color.surfaceRaised}; }

  .indicator {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 9px ${space.md - 4}px;
    background: ${color.liveFill};
    color: ${color.onLiveFill};
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.01em;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: ${color.onLiveFill};
    animation: pulse 1.6s ease-in-out infinite;
    flex: none;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
  @media (prefers-reduced-motion: reduce) {
    .dot, .pill.live .pill-dot { animation: none }
  }
  .error {
    padding: ${space.sm}px ${space.md - 4}px;
    background: ${color.warningSubtle};
    color: ${color.text};
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
  }
  /* The outbound state, which is not an error and must not be dressed as one:
     monitor is the honest name for a translation only the user can hear. It takes
     the accent rather than the speaking colour because it reports a persistent
     MODE, not a translation currently being spoken. */
  .outbound {
    padding: 7px ${space.md - 4}px;
    background: ${color.accentSubtle};
    color: ${color.text};
    font-size: ${fontSize.sm}px;
  }
  .lines {
    margin: 0;
    padding: ${space.sm}px ${space.md - 4}px ${space.md - 4}px;
    list-style: none;
    overflow-y: auto;
    /* The transcript takes the leftover height, so it is the part of the panel
       that grows — it is what the overlay is for, and it used to be sized by its
       own content while the rows around it kept whatever they wanted.

       min-height is not optional here. A flex item's automatic minimum size is its
       content, so without this the list refuses to shrink below the full
       transcript, the column overflows its 45vh cap, and overflow: hidden takes the
       bottom off the panel — which is the row carrying Stop, on an overlay sitting
       over someone else's meeting. A hit test does not see it. */
    flex: 1;
    /* Grows into whatever the panel has spare, up to this. The bound exists to stop
       a long conversation from turning the overlay into most of the meeting; it was
       written as a bound on the whole panel, which is not the same thing. */
    max-height: 45vh;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: ${space.md - 4}px;
  }
  /* A left rule per turn and room between them, the same rhythm the web
     transcript has. Identical stacked blocks with no rule are unscannable once a
     conversation runs past a few turns. */
  .line {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-left: 10px;
    border-left: 2px solid ${color.border};
  }
  .line.live { opacity: 0.75; font-style: italic; }
  /* The user's own turns, marked. With both directions running the transcript
     interleaves two conversations that are translations of each other, and
     without a side the reader cannot tell which is which. */
  .line.mine { border-left-color: ${color.accent}; }
  .who {
    color: ${color.accentText};
    font-size: ${fontSize.xs}px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* The translation is larger than what was heard, because it is the thing being
     read. Equal sizes made the eye pick a line every single turn. */
  .target { color: ${color.text}; font-size: ${fontSize.base + 1}px; font-weight: ${fontWeight.medium}; }
  .source { color: ${color.textMuted}; font-size: ${fontSize.sm}px; }
  .empty { padding: 10px ${space.md - 4}px 14px; color: ${color.textMuted}; }
  /* Never gives up height to the transcript above it: the row carrying Stop is the
     one thing on this panel that must be reachable at any viewport. */
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${space.sm}px;
    padding: 9px ${space.md - 4}px;
    border-top: 1px solid ${overlay.border};
    flex: none;
  }
  /* The two settings share a row beneath the button rather than standing beside
     it. Inline, start and stop read as the third and fourth control of a set;
     the act of starting a recording is not a peer of picking a voice. */
  .settings-row {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    flex: 1 0 100%;
  }
  .settings-row .setting { flex: 1 1 0; }
  .toggle {
    font: inherit;
    font-weight: ${fontWeight.semibold};
    color: ${color.onAccent};
    background: ${color.accent};
    border: 1px solid transparent;
    border-radius: ${radius.sm}px;
    padding: 7px 14px;
    cursor: pointer;
    /* Its own row, full width. This is the only thing on the panel that starts or
       ends a recording, and it was previously one item in a row of three. */
    flex: 1 0 100%;
  }
  .toggle:hover { background: ${color.accentHover}; }
  /* Stopping is not the same act as starting and is not painted as one. It takes
     the live colours the indicator uses, so the control that ends a recording
     looks like the recording it ends. */
  .toggle.stop {
    color: ${color.onLiveFill};
    background: ${color.liveFill};
  }
  .toggle.stop:hover { background: ${color.live}; }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: ${fontSize.sm}px;
    color: ${color.text};
    flex: 1 0 100%;
    cursor: pointer;
  }
  .check input { margin: 0; accent-color: ${color.accent}; }
  /* Visible focus matters more than usual: these controls sit on someone else's
     page, where no surrounding style system guarantees one. */
  .pill:focus-visible,
  .collapse:focus-visible,
  .toggle:focus-visible,
  .setting:focus-visible,
  .check:focus-within {
    outline: 2px solid ${color.accentText};
    outline-offset: 2px;
  }
  .setting {
    font: inherit;
    font-size: ${fontSize.sm}px;
    color: ${color.text};
    background: ${color.surfaceRaised};
    border: 1px solid ${color.borderControl};
    border-radius: ${radius.sm}px;
    padding: 4px 6px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .hint { color: ${color.textMuted}; font-size: ${fontSize.sm}px; flex: 1 0 100%; }
  /* The browser's own hidden-attribute rule is UA-origin, and every rule above is
     an author one, so the indicator and the error bar outranked it and ignored the
     property entirely. Belt and braces: last position would win the tie on its own,
     and important would win from anywhere. Everything in this tree is hidden by
     property, never by class. */
  [hidden] { display: none !important; }
`;
