#!/usr/bin/env python3
"""Assembles the review sheet: collect the stills, crop them to their subject, emit the page.

Run from the repo root: python3 plans/<this plan>/review/build.py

The cropping is the point. A screenshot of the overlay is a 1280x720 photograph of a
blank stand-in page with the overlay occupying under one percent of it; dropped into a
card, the thing being reviewed is a speck. Every still is therefore trimmed to the
pixels that differ from its own background before it reaches the page.
"""
import html
import pathlib
import shutil
import sys

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
SHOTS = HERE / "shots"

# Where each set is produced. The web stills come from a one-off capture run, so their
# source is given on the command line when it is available; otherwise whatever is
# already in shots/ is reused.
EXT_SOURCE = REPO / "apps/extension/e2e/screenshots"
WEB_SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None

PAD = 20


def crop_to_subject(path, ignore_corners=()):
    """Trim flat background, leaving a consistent margin.

    The background colour is sampled rather than assumed: the overlay stills sit on a
    white stand-in page and the web stills on the product's near-black, and the same
    trim has to work for both. Regions named in `ignore_corners` are excluded before
    the bounding box is taken — the dev-server badge in the corner of a web still is
    not part of the subject, and letting it vote keeps the whole empty page in frame.
    """
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[w // 2, 2]

    def ignored(x, y):
        return any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in ignore_corners)

    left, top, right, bottom = w, h, -1, -1
    step = 2
    for y in range(0, h, step):
        for x in range(0, w, step):
            c = px[x, y]
            if abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) <= 24:
                continue
            if ignored(x, y):
                continue
            left = min(left, x)
            right = max(right, x)
            top = min(top, y)
            bottom = max(bottom, y)

    if right < 0:
        return im  # nothing but background; leave it alone rather than crop to nothing

    box = (
        max(0, left - PAD),
        max(0, top - PAD),
        min(w, right + PAD),
        min(h, bottom + PAD),
    )
    return im.crop(box)


def collect():
    SHOTS.mkdir(exist_ok=True)
    for old in SHOTS.glob("*.png"):
        old.unlink()

    sources = []
    if EXT_SOURCE.is_dir():
        sources += sorted(EXT_SOURCE.glob("popup-*.png")) + sorted(EXT_SOURCE.glob("overlay-*.png"))
    if WEB_SOURCE and WEB_SOURCE.is_dir():
        sources += sorted(WEB_SOURCE.glob("web-*.png"))
    if not sources:
        sys.exit("no source stills found; run the e2e suite and pass the web capture directory")

    for src in sources:
        target = SHOTS / src.name
        if src.name.startswith("popup-"):
            # Already nothing but popup — 99% of the frame is subject. Copied intact so
            # it is never resampled.
            shutil.copyfile(src, target)
            continue
        if src.name.startswith("web-"):
            im = Image.open(src)
            # The dev-server badge sits alone in the bottom-left of an otherwise empty
            # page; without excluding it the crop keeps every empty row above it.
            crop = crop_to_subject(src, ignore_corners=[(0, im.size[1] - 130, 130, im.size[1])])
        else:
            # The stand-in meeting page prints its name in the top-left corner. It is
            # not the subject, and letting it vote keeps the whole blank page in frame —
            # which is how the overlay ended up as a speck in a 1280x720 card.
            crop = crop_to_subject(src, ignore_corners=[(0, 0, 240, 52)])
        crop.save(target)
    return sorted(SHOTS.glob("*.png"))


POPUP = [
    ("popup-01", "consent-unseen", "Consent unseen — the whole popup; Start is not on screen at all", None),
    ("popup-02", "consent-just-dismissed", "Consent just dismissed — the state Start once fell below the 600px cap in", None),
    ("popup-03", "meeting-tab-idle", "Meeting tab, idle — one top-level label, two named groups, Start pinned", None),
    ("popup-04", "meeting-tab-recording", "Meeting tab, capturing — header pill goes live", None),
    ("popup-05", "non-meeting-tab", "Non-meeting tab — notice, and Start disabled with a reason", None),
    ("popup-06", "zoom-desktop-tab", "Zoom desktop tab — the actionable variant of that notice", None),
    ("popup-07", "microphone-notice", "Microphone notice — only while outbound is on and permission is not granted", None),
    ("popup-08", "runs-on-switched-off", "Start disabled by Runs on being off", None),
    ("popup-09", "settings-scrolling", "The tallest state — scroll fade on, Start still pinned outside it", "Allow microphone is outlined, so Start stays the only filled action"),
]
OVERLAY = [
    ("overlay-01", "pill-idle", "Pill, idle — the collapsed surface", None),
    ("overlay-02", "pill-recording", "Pill, recording — the undismissable signal when collapsed", "Absent from the first set: capture start expands the panel by itself"),
    ("overlay-03", "panel-idle-empty", "Panel, idle, empty transcript", None),
    ("overlay-04", "panel-recording-empty", "Panel, capturing, empty — indicator above the transcript", None),
    ("overlay-05", "panel-with-turns", "Panel with turns, both origins", None),
    ("overlay-06", "error-capture", "Error bar — capture", None),
    ("overlay-07", "error-both-directions", "Error bar — one line per failing direction, deliberately", None),
    ("overlay-08", "outbound-sending", "Outbound sending — the meeting hears the translation", None),
    ("overlay-09", "outbound-muted", "Outbound muted", None),
    ("overlay-10", "outbound-not-patched", "Outbound, page not patched — the two-step reload instruction", None),
    ("overlay-11", "panel-short-viewport", "420px viewport — the state the min-height rule exists for", "Stop and the outbound row both survive; the transcript scrolls instead"),
]
WEBSHOTS = [
    ("web-01", "home", "/ — brand, one sentence, one way in", None),
    ("web-02", "translate-idle-empty", "/translate idle, transcript empty", None),
    ("web-03", "translate-listening", "Listening — just start talking", None),
    ("web-04", "translate-hearing-speech", "Hearing you — voice activity detected", None),
    ("web-05", "translate-running-with-turns", "Running with turns — real output from the local pipeline", None),
    ("web-06", "baseline-idle", "Translate a recording — renamed, with a way back", None),
    ("web-07", "baseline-audio-loaded", "Audio loaded, ready to send", None),
    ("web-08", "baseline-request-in-flight", "Request in flight", None),
    ("web-09", "baseline-result", "Result — source above translation", "The browser's own audio player is the one unstyled element; two filled buttons at once"),
    ("web-10", "live-route-unlinked", "/translate/live — kept reachable, linked from nowhere", None),
]
MISSING = [
    ("connecting, translating, playing", "Transient states between two that were captured. Reaching them needs the page paused mid-transition, which a fake capture device cannot time."),
    ("error notice, languageMismatch", "Need a failing or mismatched upstream. The local API answered every request."),
    ("baseline mic error, baseline turn error", "Same reason — the upload path succeeded."),
]


def cards(items, prefix):
    out = []
    for sid, name, note, flag in items:
        matches = sorted(SHOTS.glob(f"{prefix}{sid.split('-')[-1]}-*.png"))
        if not matches:
            sys.exit(f"missing shot for {sid}")
        w, h = Image.open(matches[0]).size
        flag_html = (
            f'<p class="flag"><span class="flag-dot" aria-hidden="true"></span>{html.escape(flag)}</p>'
            if flag else ""
        )
        out.append(
            f"""<figure class="shot">
  <figcaption>
    <span class="sid">{html.escape(sid)}</span>
    <span class="sname">{html.escape(name)}</span>
  </figcaption>
  <div class="frame"><img loading="lazy" width="{w}" height="{h}" alt="{html.escape(name)}" src="shots/{matches[0].name}"></div>
  <p class="note">{html.escape(note)}</p>
  {flag_html}
</figure>"""
        )
    return "\n".join(out)


CSS = """
  /* Three states, not two. An explicit choice stamps data-theme on <html>; the
     default setting stamps nothing, and only prefers-color-scheme separates light
     from dark there. So: :root carries the complete light palette, the media query
     redefines tokens for an unstamped dark viewer, and [data-theme="dark"] redefines
     them again so the toggle wins either way. No component reads a colour from
     anywhere but a token. */
  :root {
    --bg: #F6F7F9;
    --surface: #FFFFFF;
    --frame: #E7EAEF;
    --frame-edge: #D2D8E0;
    --border: #DFE3E9;
    --border-strong: #C3CAD4;
    --text: #11151B;
    --secondary: #464E5A;
    --muted: #6B7482;
    --accent: #067A99;
    --accent-quiet: #E1F1F6;
    --live: #C02A2F;
    --warning: #8A5A00;
    --shadow: 0 1px 2px rgba(17, 21, 27, 0.06), 0 10px 30px -20px rgba(17, 21, 27, 0.4);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0D0F13; --surface: #14181D; --frame: #1B2027; --frame-edge: #2C333C;
      --border: #252B33; --border-strong: #39414C;
      --text: #E9EBEF; --secondary: #AFB6C1; --muted: #7B8493;
      --accent: #4CCCE6; --accent-quiet: #0C2E3A;
      --live: #E5484D; --warning: #E9A23B;
      --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 10px 30px -20px rgba(0,0,0,0.8);
    }
  }
  :root[data-theme="dark"] {
    --bg: #0D0F13; --surface: #14181D; --frame: #1B2027; --frame-edge: #2C333C;
    --border: #252B33; --border-strong: #39414C;
    --text: #E9EBEF; --secondary: #AFB6C1; --muted: #7B8493;
    --accent: #4CCCE6; --accent-quiet: #0C2E3A;
    --live: #E5484D; --warning: #E9A23B;
    --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 10px 30px -20px rgba(0,0,0,0.8);
  }

  * { box-sizing: border-box; }
  html { color-scheme: light dark; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
    font-size: 15px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 32px 112px; }

  header.top {
    padding: 64px 0 28px; margin-bottom: 8px;
    border-bottom: 1px solid var(--border);
    display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: end; gap: 32px;
  }
  .eyebrow {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11.5px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 14px;
  }
  h1 {
    font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
    font-weight: 700; font-size: clamp(32px, 4.6vw, 46px); line-height: 1.04;
    letter-spacing: -0.02em; margin: 0 0 14px; text-wrap: balance;
  }
  .lede { margin: 0; color: var(--secondary); max-width: 60ch; font-size: 15.5px; }
  .meta { display: flex; align-items: center; gap: 20px; }
  .tally {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--muted);
    text-align: right; line-height: 1.7; white-space: nowrap;
  }
  .tally b { color: var(--text); font-weight: 500; }

  .theme-toggle {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--secondary); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: 999px;
    padding: 8px 15px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
  }
  .theme-toggle:hover { color: var(--text); border-color: var(--muted); }
  .theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  section { margin-top: 72px; }
  .head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 10px; }
  h2 {
    font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
    font-weight: 700; font-size: 22px; letter-spacing: -0.01em; margin: 0; color: var(--text);
  }
  .tag {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums;
  }
  .sub { margin: 0 0 32px; color: var(--secondary); font-size: 14.5px; max-width: 68ch; }

  /* Column counts differ per surface because the subjects do. A popup is a tall
     320px panel; an overlay is a wide corner card; a web route is a full page. One
     grid for all three would stretch two of them. */
  .grid { display: grid; gap: 34px 26px; }
  .grid.popup { grid-template-columns: repeat(auto-fill, minmax(216px, 1fr)); }
  .grid.overlay { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .grid.web { grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); }

  .shot { margin: 0; display: flex; flex-direction: column; gap: 11px; }
  figcaption { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
  .sid {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px;
    color: var(--accent); background: var(--accent-quiet);
    border-radius: 4px; padding: 2px 6px; white-space: nowrap;
  }
  .sname { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12.5px; color: var(--secondary); }
  .frame {
    border: 1px solid var(--frame-edge); border-radius: 8px; background: var(--frame);
    padding: 14px; display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow);
  }
  /* Never enlarged past its own pixels: the popup stills are 320 wide, and a card
     that stretches them trades a legible screenshot for a blurry one. */
  .frame img { display: block; max-width: 100%; height: auto; image-rendering: auto; }
  .note { margin: 0; font-size: 13.5px; color: var(--secondary); }
  .flag { margin: 0; font-size: 13px; color: var(--warning); display: flex; gap: 8px; align-items: baseline; }
  .flag-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--warning); flex: none; transform: translateY(-3px); }

  .gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(272px, 1fr)); gap: 20px; }
  .gap { border-left: 2px solid var(--live); padding: 2px 0 2px 16px; }
  .gap-name { margin: 0 0 5px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12.5px; color: var(--text); }
  .gap-why { margin: 0; font-size: 13.5px; color: var(--muted); }

  .asks { border-top: 2px solid var(--text); padding-top: 22px; }
  .asks ol { margin: 0; padding-left: 20px; max-width: 74ch; }
  .asks li { margin-bottom: 14px; color: var(--secondary); }
  .asks li:last-child { margin-bottom: 0; }
  .asks strong { color: var(--text); font-weight: 600; }
  code { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 0.9em; color: var(--accent); }

  @media (max-width: 700px) {
    .wrap { padding: 0 20px 72px; }
    header.top { grid-template-columns: 1fr; align-items: start; }
    .meta { justify-content: space-between; width: 100%; }
    .tally { text-align: left; }
  }
"""

BOOT = """
  (function () {
    var stored = null;
    try { stored = localStorage.getItem('chatofy-review-theme'); } catch (e) {}
    if (stored === 'light' || stored === 'dark') document.documentElement.setAttribute('data-theme', stored);
  })();
"""

TOGGLE = """
  (function () {
    var root = document.documentElement;
    var button = document.getElementById('theme-toggle');
    var glyph = button.querySelector('.glyph');
    var word = button.querySelector('.word');
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    function current() {
      var set = root.getAttribute('data-theme');
      return set === 'light' || set === 'dark' ? set : (media.matches ? 'dark' : 'light');
    }
    function paint() {
      var dark = current() === 'dark';
      glyph.textContent = dark ? '\\u2600' : '\\u263D';
      word.textContent = dark ? 'Light' : 'Dark';
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
    button.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('chatofy-review-theme', next); } catch (e) {}
      paint();
    });
    media.addEventListener('change', paint);
    paint();
  })();
"""


def main():
    collect()
    missing_html = "\n".join(
        f'<div class="gap"><p class="gap-name">{html.escape(n)}</p><p class="gap-why">{html.escape(w)}</p></div>'
        for n, w in MISSING
    )
    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chatofy Review Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<script>{BOOT}</script>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <p class="eyebrow">Phase 6 · Review pass</p>
      <h1>Every state, on one sheet</h1>
      <p class="lede">Thirty captures of the surfaces this work rebuilt. Each is trimmed to its subject —
      an overlay screenshot is mostly empty meeting page, and the thing being reviewed is the corner.
      Quote a shot ID back to me for anything you want changed.</p>
    </div>
    <div class="meta">
      <p class="tally"><b>20</b> extension<br><b>10</b> web<br><b>6</b> unshot</p>
      <button type="button" id="theme-toggle" class="theme-toggle">
        <span class="glyph" aria-hidden="true">&#9789;</span><span class="word">Dark</span>
      </button>
    </div>
  </header>

  <section>
    <div class="head"><h2>Extension popup</h2><span class="tag">9 states · 320px</span></div>
    <p class="sub">The complaint that started this was six controls of identical weight standing between the
    reader and the one button the popup exists to offer. What replaced it: one filled action, two named
    groups, and field labels demoted to the quietest tier.</p>
    <div class="grid popup">
{cards(POPUP, "popup-")}
    </div>
  </section>

  <section>
    <div class="head"><h2>Extension overlay</h2><span class="tag">11 states · closed shadow root</span></div>
    <p class="sub">Rendered inside the shadow root on a stand-in meeting page. The transcript now takes the
    panel's spare height and is the only thing that shrinks.</p>
    <div class="grid overlay">
{cards(OVERLAY, "overlay-")}
    </div>
  </section>

  <section>
    <div class="head"><h2>Web</h2><span class="tag">10 states · 3 routes</span></div>
    <p class="sub">The plan expected these to be forced against a stub, because no backend is deployed — but
    one is running locally, so they were driven through the real pipeline instead. The turns in
    <code>web-05</code> are genuine recogniser output.</p>
    <div class="grid web">
{cards(WEBSHOTS, "web-")}
    </div>
  </section>

  <section>
    <div class="head"><h2>Not captured</h2><span class="tag">6 of 14 web rows</span></div>
    <p class="sub">Listed rather than substituted with a lookalike. Each is a status string or a notice built
    from components that do appear above, so what is unreviewed is the copy, not the layout.</p>
    <div class="gaps">
{missing_html}
    </div>
  </section>

  <section>
    <div class="head"><h2>What I need from you</h2></div>
    <div class="asks">
      <ol>
        <li><strong>Accept, or list changes by shot ID.</strong> Feedback about a detail goes back to the
        surface it belongs to. Feedback about the <em>direction</em> means the brief was mis-scoped, and that
        reopens the brainstorm rather than starting another sweep.</li>
        <li><strong>The overlay on a real meeting.</strong> Still outstanding and not automatable — the shadow
        root is closed, so the harness only ever sees a stand-in page. It needs a person on Meet or Zoom web,
        including one bright video frame.</li>
        <li><strong>Two findings in <code>web-09</code>:</strong> the browser's own audio player is the single
        unstyled element in either surface, and that shot carries two filled buttons at once — the rule the
        popup was rebuilt around says one per surface. Neither is fixed; this phase changes code only if you
        ask it to.</li>
      </ol>
    </div>
  </section>
</div>
<script>{TOGGLE}</script>
</body>
</html>
"""
    out = HERE / "index.html"
    out.write_text(doc)
    print(f"{out.relative_to(REPO)}  {out.stat().st_size // 1000} KB  ·  {len(list(SHOTS.glob('*.png')))} stills")


if __name__ == "__main__":
    main()
