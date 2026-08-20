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
  }
  /*
   * The last few pixels fade out, but only when there is something below them.
   *
   * On a tab that is not a meeting the platform list makes this taller than the
   * popup, and the boundary was a straight cut through whatever label happened to
   * be there — which reads as a clipping bug rather than as more to scroll. A
   * shadow on the footer was tried first and is invisible: the ground is #0C0C0E
   * and so is the shadow.
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
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 7px ${space.sm}px;
    font: inherit;
    font-size: ${fontSize.sm}px;
    color: var(--text);
    background: var(--surface-raised);
    border: 1px solid var(--border-control);
    border-radius: ${radius.sm}px;
  }
  select:disabled { color: var(--text-muted); border-color: var(--border); }
  .row {
    display: flex;
    align-items: center;
    gap: ${space.sm}px;
    margin-top: ${space.sm + 2}px;
  }
  .row input[type='checkbox'] { width: auto; flex: none; accent-color: var(--accent); }
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
