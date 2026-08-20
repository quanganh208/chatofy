#!/usr/bin/env python3
"""Three visual directions for Chatofy, each applied to two real screens.

Run: python3 plans/<this plan>/visual-directions-v2.py

Why a second round of mocks. Phase 1's `visual-direction.html` was accepted and the
result was rejected at Phase 6 on four counts at once — flat ground, inconsistent
type, one overworked accent, and loose whitespace. The mock did not predict the
feeling because it showed detached fragments. These show the popup and the busiest
web state, whole, with the same copy and the same controls, so the only variable is
the visual language.

Nothing here touches the product. It is a comparison sheet.
"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "visual-directions-v2.html"

FONTS = (
    "https://fonts.googleapis.com/css2"
    "?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600"
    "&family=Instrument+Sans:wght@400;500;600;700"
    "&family=Archivo:wght@400;500;600;700"
    "&family=Roboto+Mono:wght@400;500"
    "&family=Public+Sans:wght@400;500;600;700"
    "&family=Instrument+Serif:ital@0;1"
    "&display=swap"
)

# Each direction is a complete token set. The four complaints are the scoring rubric:
# ground depth, typeface, accent strategy, density.
DIRECTIONS = [
    {
        "key": "paper",
        "name": "Bản ghi",
        "en": "Transcript",
        "thesis": "Đây là một bản ghi lời nói. Đặt bản dịch như văn xuôi để đọc, không như dữ liệu trong ô.",
        "fixes": [
            ("Nền", "Giấy ấm rất nhạt, ba bậc cách xa nhau — thẻ nổi rõ khỏi nền mà không cần đổ bóng nặng."),
            ("Font", "Newsreader cho câu dịch (thứ người ta thực sự đọc), Instrument Sans cho điều khiển. Một cặp, dùng ở cả web lẫn popup."),
            ("Accent", "Xanh mực đậm, chỉ dùng cho hành động chính và liên kết. Đỏ ghi âm là hue duy nhất còn lại."),
            ("Khoảng trống", "Cột hẹp theo chiều dài dòng chữ, nhịp dọc chặt hơn — trang không còn đuôi trống."),
        ],
        "tokens": {
            "bg": "#F4F3EF", "surface": "#FFFFFF", "raised": "#FAF9F6",
            "line": "#DEDBD2", "line2": "#C4C0B4",
            "text": "#1B1A17", "sub": "#55524A", "mute": "#807C71",
            "accent": "#1F5D4C", "accent-text": "#FFFFFF", "accent-soft": "#E4EDE8",
            "live": "#A6301F", "live-soft": "#F7E7E3",
            "radius": "6px", "shadow": "0 1px 2px rgba(27,26,23,.07), 0 12px 28px -22px rgba(27,26,23,.5)",
            "ui": "'Instrument Sans', system-ui, sans-serif",
            "prose": "'Newsreader', Georgia, serif",
            "mono": "'Roboto Mono', ui-monospace, monospace",
        },
        "prose_target": True,
    },
    {
        "key": "console",
        "name": "Bàn trộn",
        "en": "Console",
        "thesis": "Đây là thiết bị đang chạy trong cuộc họp. Nền xanh thép có tầng thật, và hai màu chia việc rõ: hổ phách báo đang ghi, lục lam để bấm.",
        "fixes": [
            ("Nền", "Xanh thép sâu thay vì đen. Bốn bậc cách nhau rộng nên bề mặt xếp lớp thấy được, không phẳng lì."),
            ("Font", "Archivo cho toàn bộ giao diện, Roboto Mono cho số liệu và nhãn trạng thái. Cùng một bộ ở cả ba bề mặt."),
            ("Accent", "Hai hue chia vai: hổ phách = đang ghi/cảnh báo, lục lam = hành động. Cyan không còn làm mọi việc."),
            ("Khoảng trống", "Dày hơn, có đường kẻ chia vùng — mật độ của bảng điều khiển chứ không phải trang tài liệu."),
        ],
        "tokens": {
            "bg": "#0F1620", "surface": "#17202C", "raised": "#1F2A38",
            "line": "#2B3949", "line2": "#3D4E62",
            "text": "#E8EDF3", "sub": "#A6B3C2", "mute": "#77879A",
            "accent": "#2AA198", "accent-text": "#05231F", "accent-soft": "#123832",
            "live": "#E0932F", "live-soft": "#33240D",
            "radius": "4px", "shadow": "0 1px 0 rgba(255,255,255,.04) inset, 0 10px 24px -18px rgba(0,0,0,.9)",
            "ui": "'Archivo', system-ui, sans-serif",
            "prose": "'Archivo', system-ui, sans-serif",
            "mono": "'Roboto Mono', ui-monospace, monospace",
        },
        "prose_target": False,
    },
    {
        "key": "quiet",
        "name": "Tĩnh",
        "en": "Quiet",
        "thesis": "Gần như không có màu. Thứ bậc do cỡ chữ, độ đậm và khoảng trống gánh — accent chỉ xuất hiện đúng một lần mỗi màn hình.",
        "fixes": [
            ("Nền", "Trắng ngà và than, cả hai theme. Bậc nền tách bằng đường kẻ mảnh chứ không bằng độ sáng."),
            ("Font", "Instrument Serif cho tiêu đề, Public Sans cho phần còn lại. Tiêu đề có cá tính, thân chữ trung tính."),
            ("Accent", "Một màu duy nhất, dùng cho đúng một nút mỗi màn. Trạng thái ghi âm dùng chấm đỏ nhỏ, không phải mảng màu."),
            ("Khoảng trống", "Rộng và có nhịp — đây là hướng trả lời trực tiếp nhất cho phàn nàn về bố cục."),
        ],
        "tokens": {
            "bg": "#FCFCFB", "surface": "#FFFFFF", "raised": "#F6F6F4",
            "line": "#E4E4E0", "line2": "#CFCFC9",
            "text": "#131313", "sub": "#4E4E4A", "mute": "#8A8A84",
            "accent": "#2F4CE0", "accent-text": "#FFFFFF", "accent-soft": "#ECEFFD",
            "live": "#C7362A", "live-soft": "#FBEAE8",
            "radius": "10px", "shadow": "0 1px 2px rgba(0,0,0,.04)",
            "ui": "'Public Sans', system-ui, sans-serif",
            "prose": "'Public Sans', system-ui, sans-serif",
            "display": "'Instrument Serif', Georgia, serif",
            "mono": "'Roboto Mono', ui-monospace, monospace",
        },
        "prose_target": False,
    },
    {
        "key": "quietdark",
        "name": "Tĩnh — nửa tối",
        "en": "Quiet · dark half",
        "thesis": "Cùng một hướng, đổi nền. Overlay buộc phải tối vì nó nằm trên video của người khác, nên nửa này mới là nửa quyết định — nếu nó không đứng được thì hướng này không dùng được.",
        "fixes": [
            ("Nền", "Than với đường kẻ mảnh, không dùng độ sáng để tách bậc — cùng cơ chế như nửa sáng."),
            ("Font", "Y hệt nửa sáng. Overlay không nhúng được font nên phần chữ ở đó rơi về system-ui — hướng này chịu được vì thứ bậc do cỡ và khoảng trống gánh, không do mặt chữ."),
            ("Accent", "Xanh dương sáng hơn cho nền tối. Vẫn đúng một nút mỗi màn."),
            ("Khoảng trống", "Không đổi. Đây là điều kiện để hai nửa là một hệ, không phải hai thiết kế."),
        ],
        "tokens": {
            "bg": "#111214", "surface": "#191B1E", "raised": "#212429",
            "line": "#292C31", "line2": "#3C4046",
            "text": "#F0F0EE", "sub": "#B0B2AE", "mute": "#7E817E",
            "accent": "#7A90F5", "accent-text": "#0B1030", "accent-soft": "#1B2140",
            "live": "#E9635A", "live-soft": "#3A1B18",
            "radius": "10px", "shadow": "0 1px 2px rgba(0,0,0,.5)",
            "ui": "'Public Sans', system-ui, sans-serif",
            "prose": "'Public Sans', system-ui, sans-serif",
            "display": "'Instrument Serif', Georgia, serif",
            "mono": "'Roboto Mono', ui-monospace, monospace",
        },
        "prose_target": False,
    },
]

TURNS = [
    ("them", "So where did we land on the pricing question?", "Vậy chúng ta đã chốt về câu hỏi giá chưa?"),
    ("me", "Tôi nghĩ chúng ta nên giữ mức cũ thêm một quý nữa.", "I think we should hold the current price for another quarter."),
    ("them", "That works for me, let us revisit in January.", "Được, tháng Một mình xem lại."),
]


SWAP_ICON = """<svg class="swap-i" viewBox="0 0 18 18" width="15" height="15" aria-hidden="true" focusable="false">
  <path d="M2.5 6.25h11m-3 -3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M15.5 11.75h-11m3 3-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""


def langpair(source, target, size="sm"):
    """Source and target as two named sides, with a drawn swap between them.

    Replaces two things at once: the typed arrow, and the fact that the web panel
    stated the direction twice — once as a heading and again as a segmented control
    directly beneath it. A pair that can be swapped is the control, so the heading
    stops being a separate claim about the same thing.

    The two sides borrow the transcript's own relationship: the source is the quiet
    one, the translation is the one being read.
    """
    return f'''<div class="langpair {size}">
      <div class="lang from">
        <p class="lang-role">Source</p>
        <p class="lang-name">{source}</p>
      </div>
      <button type="button" class="swap" aria-label="Swap source and translation">{SWAP_ICON}</button>
      <div class="lang to">
        <p class="lang-role">Translation</p>
        <p class="lang-name">{target}</p>
      </div>
    </div>'''


def popup(d):
    """The extension popup, 320px, in the state that carries the most controls."""
    k = d["key"]
    display = "display" in d["tokens"]
    brand_tag = "h3" if not display else "h3"
    return f"""
<div class="device popup {k}">
  <div class="pop-head">
    <div>
      <{brand_tag} class="brand">Chatofy</{brand_tag}>
      <p class="host">meet.google.com</p>
    </div>
    <span class="pill">Idle</span>
  </div>
  <div class="pop-body">
    {langpair('English', 'Vietnamese')}

    <p class="group-label">Speech</p>
    <label class="field-label">Voice</label>
    <div class="control">Female</div>
    <label class="check"><span class="box"></span>Also translate what I say</label>

    <p class="group-label">Runs on</p>
    <label class="check"><span class="box on"></span>Enable Chatofy on meeting pages</label>
    <div class="sites">
      <span><span class="box on"></span>Google Meet <em>meet.google.com</em></span>
      <span><span class="box on"></span>Zoom <em>the web client</em></span>
      <span><span class="box on"></span>Facebook <em>group calls</em></span>
    </div>
  </div>
  <div class="pop-foot">
    <button class="primary">Start</button>
    <p class="status">Ready.</p>
  </div>
</div>"""


def web(d):
    """The busiest web state: a running conversation with real turns."""
    k = d["key"]
    lines = "\n".join(
        f"""      <li class="turn {who}">
        <p class="src">{src}</p>
        <p class="tgt">{tgt}</p>
      </li>"""
        for who, src, tgt in TURNS
    )
    return f"""
<div class="device web {k}">
  <div class="web-head"><span class="brand">Chatofy</span></div>
  <div class="web-body">
    <section class="panel">
      {langpair('Vietnamese', 'English', 'lg')}
      <p class="h-sub">Speak naturally and pause. The translation plays back on its own.</p>
      <div class="row-actions">
        <button class="primary live-btn">End</button>
        <span class="statusline"><span class="dot"></span>Hearing you…<span class="meter"><i></i></span></span>
      </div>
      <div class="segs">
        <div class="seg-group">
          <p class="group-label">Voice</p>
          <div class="seg"><span class="on">Female</span><span>Male</span></div>
        </div>
      </div>
    </section>
    <ul class="turns">
{lines}
    </ul>
  </div>
</div>"""


def tokens_css(d):
    t = d["tokens"]
    decls = "\n".join(f"    --{name}: {value};" for name, value in t.items())
    display = t.get("display", t["ui"])
    return f"""  .{d['key']} {{
{decls}
    --display: {display};
  }}"""


SHARED = """
  /* Every screen below is built from the same markup; only the token block above it
     changes. That is the point of the comparison — the layout, the copy and the
     controls are held constant so the visual language is the only variable. */
  .device { color: var(--text); font-family: var(--ui); background: var(--bg); }
  .device *, .device *::before, .device *::after { box-sizing: border-box; }

  /* ---- popup ---------------------------------------------------------- */
  .popup {
    width: 320px; border: 1px solid var(--line); border-radius: var(--radius);
    overflow: hidden; box-shadow: var(--shadow); display: flex; flex-direction: column;
  }
  .pop-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--surface);
  }
  .brand { margin: 0; font-family: var(--display); font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  .host { margin: 1px 0 0; font-size: 11.5px; color: var(--mute); }
  .pill {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: .04em;
    color: var(--sub); border: 1px solid var(--line2); border-radius: 999px; padding: 2px 9px;
  }
  .pop-body { padding: 14px; background: var(--bg); display: flex; flex-direction: column; }
  .field-label { display: block; font-size: 12.5px; color: var(--sub); margin: 0 0 5px; }
  .control {
    border: 1px solid var(--line2); border-radius: var(--radius); background: var(--surface);
    padding: 8px 10px; font-size: 13px; color: var(--text); margin-bottom: 14px;
  }
  .group-label {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--mute); margin: 6px 0 9px; padding-top: 11px; border-top: 1px solid var(--line);
  }
  .check { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--text); margin: 10px 0; }
  .box {
    width: 14px; height: 14px; flex: none; border: 1px solid var(--line2);
    border-radius: 3px; background: var(--surface); display: inline-block;
  }
  .box.on { background: var(--accent); border-color: var(--accent); position: relative; }
  .box.on::after {
    content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
    border: solid var(--accent-text); border-width: 0 1.6px 1.6px 0; transform: rotate(42deg);
  }
  .sites { display: flex; flex-direction: column; gap: 8px; padding-left: 18px; margin-top: 2px; }
  .sites span { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .sites em { font-style: normal; color: var(--mute); font-size: 11.5px; }
  .pop-foot { padding: 12px 14px 14px; border-top: 1px solid var(--line); background: var(--surface); }
  .primary {
    width: 100%; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
    color: var(--accent-text); background: var(--accent); border: 1px solid transparent;
    border-radius: var(--radius); padding: 9px;
  }
  .status { margin: 8px 0 0; font-size: 12px; color: var(--mute); }

  /* ---- web ------------------------------------------------------------- */
  .web { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
  .web-head { padding: 13px 22px; border-bottom: 1px solid var(--line); background: var(--surface); }
  .web-head .brand { font-family: var(--display); font-size: 15px; font-weight: 600; }
  .web-body { padding: 26px 22px 30px; display: flex; flex-direction: column; gap: 20px; }
  .panel {
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    padding: 20px; display: flex; flex-direction: column; gap: 14px;
  }
  .h-sub { margin: -6px 0 0; font-size: 13.5px; color: var(--sub); }
  .row-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .row-actions .primary { width: auto; padding: 9px 20px; }
  /* Text colour comes from the token set, not a literal: white on the console
     amber measures 2.50:1, which is not a label anyone can read. */
  .live-btn { background: var(--live); border-color: var(--live); color: var(--surface); }
  .statusline { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--sub); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); flex: none; }
  .meter { width: 120px; height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; }
  .meter i { display: block; width: 46%; height: 100%; background: var(--accent); }
  .segs { display: flex; gap: 26px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--line); }
  .seg-group .group-label { margin: 0 0 7px; padding: 0; border: 0; }
  .seg { display: inline-flex; border: 1px solid var(--line2); border-radius: var(--radius); overflow: hidden; }
  .seg span { font-size: 12.5px; padding: 6px 13px; color: var(--sub); }
  .seg span.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

  /* ---- language pair ---------------------------------------------------- */
  /* Two named sides rather than "A to B" on one line. The typed arrow was doing
     three jobs badly: naming the direction, implying it could be changed, and being
     a glyph whose weight and baseline nothing controls. A drawn swap does the second
     job properly and the labels do the first. */
  .langpair { display: flex; align-items: stretch; gap: 8px; }
  .lang {
    flex: 1 1 0; min-width: 0;
    border: 1px solid var(--line2); border-radius: var(--radius);
    background: var(--surface); padding: 7px 11px;
  }
  .lang-role {
    margin: 0 0 1px; font-family: var(--mono); font-size: 9.5px; letter-spacing: .11em;
    text-transform: uppercase; color: var(--mute);
  }
  .lang-name { margin: 0; font-size: 13.5px; color: var(--text); white-space: nowrap;
               overflow: hidden; text-overflow: ellipsis; }
  .swap {
    flex: none; align-self: center; cursor: pointer;
    width: 30px; height: 30px; display: grid; place-items: center;
    color: var(--sub); background: var(--surface);
    border: 1px solid var(--line2); border-radius: 999px; padding: 0;
  }
  .swap:hover { color: var(--text); border-color: var(--mute); }
  /* The pair is the panel's title on web, so it takes title-sized type there while
     staying the same control. */
  .langpair.lg .lang { padding: 10px 14px; }
  .langpair.lg .lang-name { font-family: var(--display); font-size: 21px; letter-spacing: -.01em; }
  .langpair.lg .lang.to .lang-name { font-weight: 600; }
  .langpair.lg .swap { width: 36px; height: 36px; }

  .turns { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px; }
  .turn { padding-left: 14px; border-left: 2px solid var(--line2); }
  .turn.me { border-left-color: var(--accent); }
  .src { margin: 0 0 3px; font-size: 12.5px; color: var(--mute); }
  .tgt { margin: 0; font-family: var(--prose); font-size: 17px; line-height: 1.42; color: var(--text); }
"""

PROSE_NOTE = """
  /* Scoped to one direction: it is the only one that sets the translated line as
     prose rather than as UI text, which is the single idea here about the content
     rather than the chrome. */
  .paper .turns .tgt { font-size: 19px; line-height: 1.45; font-weight: 400; }
  .paper .turns .src { font-family: var(--mono); font-size: 11.5px; letter-spacing: .01em; }
"""


QUIET_NOTE = """
  /* This direction claims the accent appears once per screen. Left to the shared
     rules it appeared on four checkboxes, two segments and the level meter as well,
     which would have made the mock argue against its own thesis. Those roles fall
     back to ink here, and the accent is reserved for the one button. */
  .quiet .box.on, .quietdark .box.on { background: var(--text); border-color: var(--text); }
  .quiet .box.on::after, .quietdark .box.on::after { border-color: var(--surface); }
  .quiet .seg span.on, .quietdark .seg span.on { background: var(--raised); color: var(--text); }
  .quiet .meter i, .quietdark .meter i { background: var(--sub); }
"""


def block(d):
    fixes = "\n".join(
        f'      <div class="fix"><p class="fix-k">{k}</p><p class="fix-v">{v}</p></div>'
        for k, v in d["fixes"]
    )
    return f"""
<section class="dir">
  <div class="dir-head">
    <div>
      <p class="dir-index">{d['en']}</p>
      <h2 class="dir-name">{d['name']}</h2>
      <p class="dir-thesis">{d['thesis']}</p>
    </div>
    <div class="swatches">
      <span style="background:var(--sw-bg)"></span>
      <span style="background:var(--sw-surface)"></span>
      <span style="background:var(--sw-accent)"></span>
      <span style="background:var(--sw-live)"></span>
    </div>
  </div>
  <div class="fixes">
{fixes}
  </div>
  <div class="stage">
{popup(d)}
{web(d)}
  </div>
</section>"""


def main():
    token_blocks = "\n".join(tokens_css(d) for d in DIRECTIONS)
    # The swatch row reads from the same tokens, so it can never drift from the mock.
    swatch_blocks = "\n".join(
        f"""  .dir:nth-of-type({i + 1}) {{
    --sw-bg: {d['tokens']['bg']}; --sw-surface: {d['tokens']['surface']};
    --sw-accent: {d['tokens']['accent']}; --sw-live: {d['tokens']['live']};
  }}"""
        for i, d in enumerate(DIRECTIONS)
    )
    prose = PROSE_NOTE
    blocks = "\n".join(block(d) for d in DIRECTIONS)

    doc = f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ba hướng thị giác</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<style>
  /* The sheet itself is deliberately colourless: it is a neutral room the three
     directions are hung in, and any personality here would compete with them. */
  :root {{
    --paper: #FFFFFF; --ink: #16181C; --ink-2: #5A6069; --ink-3: #8B9198;
    --rule: #E3E5E9; --rule-2: #C8CCD2;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --paper: #101215; --ink: #EDEFF2; --ink-2: #A5ACB5; --ink-3: #757C85;
      --rule: #24272C; --rule-2: #383C43;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: 'Public Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }}
  .wrap {{ max-width: 1240px; margin: 0 auto; padding: 0 28px 120px; }}

  header.top {{ padding: 60px 0 24px; border-bottom: 1px solid var(--rule); }}
  .kicker {{
    font-family: 'Roboto Mono', monospace; font-size: 11.5px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--ink-3); margin: 0 0 12px;
  }}
  h1 {{ font-family: 'Instrument Serif', Georgia, serif; font-size: clamp(34px, 5vw, 52px);
       font-weight: 400; line-height: 1.05; margin: 0 0 14px; letter-spacing: -.01em; }}
  .intro {{ margin: 0; max-width: 66ch; color: var(--ink-2); }}
  .intro b {{ color: var(--ink); font-weight: 600; }}

  .dir {{ padding: 64px 0; border-bottom: 1px solid var(--rule); }}
  .dir-head {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; flex-wrap: wrap; }}
  .dir-index {{ font-family: 'Roboto Mono', monospace; font-size: 11.5px; letter-spacing: .12em;
                text-transform: uppercase; color: var(--ink-3); margin: 0 0 8px; }}
  .dir-name {{ font-family: 'Instrument Serif', Georgia, serif; font-weight: 400;
               font-size: 34px; margin: 0 0 10px; letter-spacing: -.01em; }}
  .dir-thesis {{ margin: 0; max-width: 62ch; color: var(--ink-2); }}
  .swatches {{ display: flex; gap: 8px; }}
  .swatches span {{ width: 30px; height: 30px; border-radius: 5px; border: 1px solid var(--rule-2); }}

  .fixes {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 18px; margin: 26px 0 34px; }}
  .fix {{ border-top: 1px solid var(--rule); padding-top: 11px; }}
  .fix-k {{ margin: 0 0 4px; font-family: 'Roboto Mono', monospace; font-size: 11px;
            letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }}
  .fix-v {{ margin: 0; font-size: 13.5px; color: var(--ink-2); }}

  .stage {{ display: flex; gap: 30px; align-items: flex-start; flex-wrap: wrap; }}
  .stage .web {{ flex: 1 1 520px; min-width: 380px; }}

{token_blocks}
{swatch_blocks}
{SHARED}
{prose}
{QUIET_NOTE}

  .closing {{ padding-top: 56px; }}
  .closing h2 {{ font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 28px; margin: 0 0 16px; }}
  .closing ol {{ max-width: 70ch; color: var(--ink-2); padding-left: 20px; }}
  .closing li {{ margin-bottom: 12px; }}
  .closing strong {{ color: var(--ink); font-weight: 600; }}

  @media (max-width: 780px) {{
    .stage {{ flex-direction: column; }}
    .stage .web {{ min-width: 0; width: 100%; }}
  }}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <p class="kicker">Chatofy · hướng thị giác, vòng 2</p>
    <h1>Ba hướng, cùng hai màn hình</h1>
    <p class="intro">Vòng mock đầu bị duyệt rồi kết quả vẫn bị bác ở Phase 6 — vì nó là những mảnh rời.
    Lần này mỗi hướng được áp lên <b>popup 320px</b> và <b>trạng thái web bận nhất</b>, cùng một nội dung,
    cùng một bố cục, cùng những điều khiển. Biến duy nhất là ngôn ngữ thị giác. Mỗi hướng phải trả lời
    đủ bốn điểm bạn nêu: nền, font, accent, khoảng trống.</p>
  </header>
{blocks}
  <section class="closing">
    <h2>Chọn thế nào</h2>
    <ol>
      <li><strong>Chọn một hướng, hoặc ghép.</strong> "Nền của Bàn trộn + chữ của Bản ghi" là câu trả lời hợp lệ.</li>
      <li><strong>Chưa cái nào đúng cũng là câu trả lời.</strong> Nói cái nào <em>gần</em> nhất và sai ở đâu — rẻ hơn nhiều so với dựng lại từ đầu.</li>
      <li><strong>Sau khi chốt</strong> mới đụng <code>packages/ui/src/tokens.ts</code>. Nó là bộ màu chung của web, extension và mobile, nên đổi palette là một phase riêng, không phải một lượt sửa.</li>
    </ol>
  </section>
</div>
</body>
</html>
"""
    OUT.write_text(doc)
    print(f"{OUT.relative_to(HERE.parents[1])}  {OUT.stat().st_size // 1000} KB")


if __name__ == "__main__":
    main()
