import { color, colorLight, fontSize, fontWeight, radius, space } from '@chatofy/ui';

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
 * The layout is a fixed three-part column — header, scrolling body, pinned
 * footer — and that is the point of it. Chrome caps a popup at 600px and then
 * scrolls, and the previous flat document exceeded that on first run: the
 * recording notice and the unsupported-tab notice stacked above five controls,
 * and Start, the only thing the popup exists to do, was below the fold with
 * nothing on screen to suggest scrolling. The footer is now outside the
 * scrolling region, so it cannot leave.
 *
 * Deliberately unlayered, and `theme.css` keeps Tailwind's utilities unlayered to
 * match. The note there records what happens otherwise; the short version is that
 * a cascade layer is not a safe place to put anything on an extension page.
 *
 * No backticks below: this is a template literal.
 */
export const POPUP_STYLE = `
  /*
   * Both grounds, declared once.
   *
   * This sheet used to interpolate one palette straight into every rule, which is
   * why adding a second meant changing how the file is generated rather than
   * changing values. light-dark() keeps each token to a single declaration carrying
   * both halves, and the classes below move nothing but color-scheme — which is also
   * what makes native selects and checkboxes render the right way round.
   *
   * The overlay does NOT do this and must not: a content script's colour-scheme
   * query answers for the operating system rather than for the meeting page it is
   * standing on, so it keeps one ground. This is an ordinary extension page and has
   * no such problem.
   */
  :root {
    color-scheme: light dark;
    --accent: light-dark(${colorLight.accent}, ${color.accent});
    --accent-hover: light-dark(${colorLight.accentHover}, ${color.accentHover});
    --accent-subtle: light-dark(${colorLight.accentSubtle}, ${color.accentSubtle});
    --accent-text: light-dark(${colorLight.accentText}, ${color.accentText});
    --bg: light-dark(${colorLight.bg}, ${color.bg});
    --border: light-dark(${colorLight.border}, ${color.border});
    --border-control: light-dark(${colorLight.borderControl}, ${color.borderControl});
    --border-strong: light-dark(${colorLight.borderStrong}, ${color.borderStrong});
    --live: light-dark(${colorLight.live}, ${color.live});
    --live-fill: light-dark(${colorLight.liveFill}, ${color.liveFill});
    --live-subtle: light-dark(${colorLight.liveSubtle}, ${color.liveSubtle});
    --on-accent: light-dark(${colorLight.onAccent}, ${color.onAccent});
    --on-live-fill: light-dark(${colorLight.onLiveFill}, ${color.onLiveFill});
    --surface: light-dark(${colorLight.surface}, ${color.surface});
    --surface-raised: light-dark(${colorLight.surfaceRaised}, ${color.surfaceRaised});
    --text: light-dark(${colorLight.text}, ${color.text});
    --text-muted: light-dark(${colorLight.textMuted}, ${color.textMuted});
    --text-secondary: light-dark(${colorLight.textSecondary}, ${color.textSecondary});
    --warning: light-dark(${colorLight.warning}, ${color.warning});
    --warning-subtle: light-dark(${colorLight.warningSubtle}, ${color.warningSubtle});
  }
  :root.light { color-scheme: light; }
  :root.dark { color-scheme: dark; }

  body {
    margin: 0;
    width: 320px;
    /* Under Chrome's 600px cap, so the popup never grows into a scrollbar of its
       own: "main" scrolls instead, and the footer stays put. */
    max-height: 560px;
    display: flex;
    flex-direction: column;
    font: ${fontSize.base}px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
  }

  /* Header — who this is, and what it is doing right now. */
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 12px ${space.md}px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .brand strong {
    font-size: ${fontSize.base}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.01em;
  }
  /* The tab this popup is about, truncated rather than wrapped: a long meeting
     URL is not worth a second line in a header. */
  #host {
    margin: 0;
    font-size: ${fontSize.xs}px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px 3px 7px;
    border-radius: ${radius.full}px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    color: var(--text-secondary);
  }
  .state-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    flex: none;
  }
  /* Capture running. The same red, the same pulse, as the meeting overlay's
     indicator — this popup is the other end of one fact. */
  .state.live {
    background: var(--live-subtle);
    border-color: var(--live);
    color: var(--text);
  }
  .state.live .state-dot {
    background: var(--live);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
  @media (prefers-reduced-motion: reduce) { .state.live .state-dot { animation: none } }

  main {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: ${space.md - 4}px ${space.md}px ${space.md}px;
    /* The platform scrollbar is 15px of grey furniture down the side of a 320px
       pane, and it is the widest thing on the page that answers to nothing in the
       palette. Thin, and coloured from the same border token as every other rule
       here. */
    scrollbar-width: thin;
    scrollbar-color: var(--border-strong) transparent;
  }
  /*
   * The last few pixels fade out, but only when there is something below them.
   *
   * On a tab that is not a meeting the platform list makes this taller than the
   * popup, and the boundary was a straight cut through whatever label happened to
   * be there — which reads as a clipping bug rather than as more to scroll. A
   * shadow on the footer was tried first and is invisible: it is cast onto the
   * ground token, in the colour of the ground token.
   *
   * Applied unconditionally it was worse than the problem. Content that ends near
   * the boundary without overflowing — Advanced, on a meeting tab — came out
   * dimmed for no reason, which reads as disabled. main.ts measures and adds
   * this class, so the fade only ever means what it looks like it means.
   */
  main.scrolls {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 20px), transparent);
  }

  /*
   * Three tiers, where there used to be one.
   *
   * Every label on this page was 11px uppercase semibold — the same treatment for
   * the direction of the call, the voice, the platform list and the server field.
   * Six controls announced at one volume, above the single button the popup exists
   * to offer, is the whole of what "everything looks equally important" meant here.
   *
   * A field label is now the quietest of the three: sentence case, body size, and
   * dimmer than the value it names, because the value is the part being read. The
   * uppercase treatment moves to "legend", where it marks a region rather than a
   * control, and the accent fill belongs to Start alone.
   */
  label {
    display: block;
    margin: ${space.sm + 2}px 0 ${space.xs}px;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.regular};
    color: var(--text-secondary);
  }
  main > label:first-of-type { margin-top: 0; }

  /* A group of settings that depend on the one above them, not a box. The border
     is a single rule between regions: a 320px page divided into outlined cards
     reads as four things to deal with rather than one to skim past. */
  .group {
    margin: ${space.md}px 0 0;
    padding: ${space.sm}px 0 0;
    border: 0;
    border-top: 1px solid var(--border);
    /*
     * Where the horizontal scrollbar came from.
     *
     * A fieldset carries "min-inline-size: min-content" in the UA sheet, which no
     * other block does — so unlike every sibling here it refuses to be narrower
     * than its widest content. "Runs on" holds three nowrap platform details, and
     * min-content of nowrap text is the whole line: the group measured 327px
     * inside a 288px column, and because "overflow-y: auto" on main computes
     * overflow-x to auto as well, those 39px became a scrollbar under content
     * that was already ellipsised and had nothing to reveal.
     */
    min-inline-size: 0;
  }
  legend {
    padding: 0;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .group > label:first-of-type { margin-top: ${space.sm}px; }
  /*
   * The drop-downs, drawn rather than left to the platform.
   *
   * The header of this file has claimed since it was written that the controls are
   * styled explicitly — they were not. A select without "appearance: none" keeps
   * the platform's own frame and arrow whatever else is set on it, so these three
   * arrived as GTK widgets sitting between a hand-drawn header and a hand-drawn
   * button, which is the "half native, half branded" the header warns about.
   *
   * The arrow lives on a wrapper because a select cannot carry a pseudo-element,
   * and it is two rotated borders rather than an SVG because a background image
   * cannot take a colour from a token — one URL cannot be two grounds, and this
   * page has both.
   *
   * "appearance: none" only reaches the closed control. The list that opens is
   * drawn by the operating system and no rule here can touch it, which is why
   * these still read as platform widgets the moment they are used. Taking that
   * over is what "appearance: base-select" is for, below.
   */
  .select { position: relative; }
  .select::after {
    content: '';
    position: absolute;
    right: 12px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--text-muted);
    border-bottom: 1.5px solid var(--text-muted);
    transform: translateY(-70%) rotate(45deg);
    /* The chevron is part of the control, not a target beside it: a click landing
       on this instead of the select would open nothing. */
    pointer-events: none;
  }
  .select:hover::after { border-color: var(--text-secondary); }
  .select:has(select:disabled)::after { border-color: var(--text-muted); opacity: 0.45; }
  select {
    appearance: none;
    /*
     * And the list too, on Chromium 135 and later.
     *
     * Declared after "appearance: none" rather than instead of it: an engine that
     * does not know the keyword drops this line and keeps the one above, so the
     * closed control stays drawn and only the list falls back to the platform —
     * which is where this page already was. Chrome is the only engine this
     * extension runs in, so in practice the fallback is for an old Chrome.
     */
    appearance: base-select;
    width: 100%;
    box-sizing: border-box;
    /* Room on the right for the chevron above, which is drawn over the padding. */
    padding: 7px ${space.lg + 4}px 7px ${space.sm}px;
    font: inherit;
    font-size: ${fontSize.sm}px;
    color: var(--text);
    background: var(--surface-raised);
    border: 1px solid var(--border-control);
    border-radius: ${radius.sm}px;
    cursor: pointer;
  }
  select:hover { border-color: var(--border-strong); }
  select:disabled { color: var(--text-muted); border-color: var(--border); cursor: not-allowed; }
  /* Open is a state worth showing: the list is anchored to this control and the
     accent says which one it belongs to. */
  select:open { border-color: var(--accent); }
  /* base-select draws an arrow of its own. The page already has one, on the
     wrapper, and that is the one that exists in both modes — so this would be a
     second chevron beside the first wherever the keyword is understood. */
  select::picker-icon { display: none; }

  /*
   * The list, which until now was the operating system's.
   *
   * Only reachable in base-select mode; an engine that ignored the keyword above
   * ignores this whole block, and its own list appears instead. Sized from the
   * control it hangs off rather than from its longest option, so it reads as the
   * control opening rather than as a menu arriving next to it.
   */
  ::picker(select) {
    appearance: base-select;
    box-sizing: border-box;
    min-width: anchor-size(width);
    margin-top: ${space.xs}px;
    padding: ${space.xs}px;
    border: 1px solid var(--border);
    border-radius: ${radius.md}px;
    background: var(--surface);
    /* The one shadow on this page. A list floats over the form beneath it, and
       the border alone does not say so on the dark ground, where surface and bg
       are ten steps apart. */
    box-shadow: 0 10px 24px light-dark(rgba(19, 19, 19, 0.14), rgba(0, 0, 0, 0.55));
  }
  option {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    padding: 6px ${space.sm}px;
    border-radius: ${radius.sm}px;
    font-size: ${fontSize.sm}px;
    color: var(--text);
    cursor: pointer;
  }
  /* Hover and keyboard arrive at the same highlight. Two different ones would say
     the mouse and the arrow keys are pointing at different things. */
  option:hover,
  option:focus {
    background: var(--surface-raised);
    outline: none;
  }
  option:checked { color: var(--accent-text); font-weight: ${fontWeight.medium}; }
  /* The tick base-select supplies, moved to the far edge and given the accent —
     it marks which option is current, so it belongs to the same colour as the
     text it marks rather than to the ground. */
  option::checkmark {
    order: 1;
    margin-left: auto;
    color: var(--accent-text);
  }
  .row {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    margin-top: ${space.sm + 2}px;
  }
  /*
   * The checkboxes, likewise drawn.
   *
   * "accent-color" was the whole of the previous treatment: it tints the platform
   * widget and leaves everything else — the box, its corner radius, the border it
   * draws when unchecked — to the platform. Five of these sit in a column beside
   * three drop-downs, so the one control the page repeats most was the one least
   * like the rest of it.
   *
   * Sized to the row rather than to the text: 15px reads as a peer of the 12px
   * label beside it without becoming the thing the eye lands on first.
   */
  .row input[type='checkbox'] {
    appearance: none;
    flex: none;
    position: relative;
    width: 15px;
    height: 15px;
    margin: 0;
    box-sizing: border-box;
    border: 1px solid var(--border-control);
    border-radius: 4px;
    background: var(--surface-raised);
    cursor: pointer;
  }
  .row input[type='checkbox']:hover:not(:disabled) { border-color: var(--border-strong); }
  .row input[type='checkbox']:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  /* The tick, from two borders of one rotated box. Coloured on-accent rather than
     white, because the dark ground's accent is a light blue and a white tick on it
     is the one state in this palette that cannot be read. */
  .row input[type='checkbox']:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 3px;
    height: 7px;
    border: solid var(--on-accent);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .row input[type='checkbox']:disabled { cursor: not-allowed; opacity: 0.45; }
  .row label {
    margin: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.regular};
    text-transform: none;
    letter-spacing: normal;
    color: var(--text);
  }
  /* Which of the three platforms this popup is standing over. A chip rather than
     more prose, because it is a pointer and not a sentence. */
  .here {
    margin-left: auto;
    flex: none;
    padding: 1px 7px;
    border-radius: ${radius.full}px;
    background: var(--accent-subtle);
    color: var(--accent-text);
    font-size: ${fontSize.xs}px;
  }
  /* The per-platform rows sit under the master switch that governs them. */
  #run-sites { padding-left: ${space.lg}px; }
  #run-sites .row { margin-top: 6px; }
  #run-sites label { flex: none; }
  /* Which Zoom, which Facebook. Truncated rather than wrapped: a second line per
     platform would cost more height than the qualification is worth, and the
     switch it belongs to has to stay a single scannable row. */
  .detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: ${fontSize.xs}px;
    color: var(--text-muted);
  }

  footer {
    flex: none;
    padding: ${space.sm}px ${space.md}px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  button {
    width: 100%;
    padding: ${space.sm}px;
    font: inherit;
    font-weight: ${fontWeight.semibold};
    color: var(--on-accent);
    background: var(--accent);
    border: 1px solid transparent;
    border-radius: ${radius.sm}px;
    cursor: pointer;
  }
  button:hover { background: var(--accent-hover); }
  /* Stopping takes the live colours, so the control that ends a recording looks
     like the recording it ends rather than like the one that began it. */
  button.stop { color: var(--on-live-fill); background: var(--live-fill); }
  button.stop:hover { background: var(--live); }
  /* Disabled rather than absent. The Start button used to be removed outright on
     a tab that cannot be captured, which left a popup of settings and no visible
     trace of the thing it is for; the notice above says why it is off. */
  button:disabled { cursor: not-allowed; opacity: 0.45; }
  button:disabled:hover { background: var(--accent); }
  /* Focus is drawn rather than left to the platform: this page is 320px of form
     controls and a lost focus ring is a keyboard user with nowhere to be. */
  button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
  #status { margin: ${space.sm}px 0 0; min-height: 1.4em; font-size: ${fontSize.sm}px; color: var(--text-secondary); }
  .hint { margin: ${space.xs}px 0 0; font-size: ${fontSize.sm}px; color: var(--text-muted); }

  /*
   * Notices, by how much they are asking of the reader.
   *
   * ".notice" is the ordinary one: this tab is not a meeting, which is true of
   * most tabs and is not a fault. It used to be painted on liveSubtle, the
   * blocked-capture red, so "Chatofy works on Google Meet, Zoom web, and
   * Facebook calls" arrived looking like something had gone wrong.
   *
   * ".notice.action" is amber and means the reader has a step left that can be
   * named — grant the microphone, join Zoom from the browser instead of the app.
   */
  .notice {
    margin-bottom: ${space.md - 4}px;
    padding: ${space.sm + 2}px ${space.sm + 4}px;
    border-radius: ${radius.md}px;
    /* A card, not a coloured slab. The previous version filled with
       surfaceRaised and hung a 2px rule off one edge, which on a 320px page
       read as something left behind rather than as a region — and it did it for
       the most ordinary message the popup has, which is that this tab is a tab. */
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-secondary);
    font-size: ${fontSize.sm}px;
  }
  /* Amber, and filled, because this one is asking for something. The severity
     difference is now fill-versus-outline as well as hue, so it survives being
     looked at by someone who cannot tell the two colours apart. */
  .notice.action {
    border-color: var(--warning);
    background: var(--warning-subtle);
    color: var(--text);
  }
  .notice p { margin: 0; }
  #unsupported-message { color: var(--text); font-weight: ${fontWeight.medium}; }
  #mic { margin: ${space.md - 4}px 0 0; }
  /* Outlined, not filled. This asks for something, but Start is what the popup is
     for — two accent buttons on a 320px page is two primary actions, and the one
     in the scrolling region would be the one competing from behind a fade. */
  #mic button {
    margin-top: ${space.sm}px;
    color: var(--text);
    background: transparent;
    border-color: var(--border-strong);
  }
  #mic button:hover { background: var(--surface-raised); }

  /*
   * The first-run recording notice, as a step rather than a slab.
   *
   * It replaces the whole popup instead of stacking on top of the form, which is
   * what pushed Start off screen and what made an acknowledgement look like one
   * more coloured box among several. Not dismissible by clicking outside it: the
   * acknowledgement is the button, and only the button records that it was seen.
   */
  #consent { padding: ${space.md}px; }
  #consent h1 {
    margin: 0 0 ${space.sm}px;
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: -0.01em;
  }
  #consent p {
    margin: 0 0 ${space.sm + 2}px;
    font-size: ${fontSize.sm}px;
    color: var(--text-secondary);
  }
  #consent strong { color: var(--text); }
  [hidden] { display: none !important; }
`;
