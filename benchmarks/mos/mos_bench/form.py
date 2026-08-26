"""Generate the per-listener rating page.

Self-contained HTML, opened straight from disk. It shows an opaque item id and
an audio player and nothing else — no system name, no clip id, no file path a
listener could read a condition out of.

The page refuses to export until every item has a score. Partial returns are the
main way a within-subjects panel goes lopsided, and it is much cheaper to stop
it here than to drop the listener during screening.
"""

import html
import json

SCALE = [
    (5, "Excellent — natural, no effort to follow"),
    (4, "Good — slightly unnatural, still easy"),
    (3, "Fair — noticeably unnatural, some effort"),
    (2, "Poor — hard to follow"),
    (1, "Bad — unintelligible or unusable"),
]

_STYLE = """
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 46rem;
       margin: 0 auto; padding: 2rem 1.25rem 6rem; line-height: 1.55; }
h1 { font-size: 1.4rem; margin-bottom: .25rem; }
.sub { opacity: .7; margin-top: 0; }
.scale { border: 1px solid rgba(128,128,128,.35); border-radius: .5rem;
         padding: .75rem 1rem; margin: 1.5rem 0; }
.scale dt { font-weight: 600; float: left; width: 1.5rem; }
.scale dd { margin: 0 0 .35rem 1.75rem; }
.item { border-top: 1px solid rgba(128,128,128,.28); padding: 1.1rem 0; }
.item h2 { font-size: .85rem; letter-spacing: .06em; text-transform: uppercase;
           opacity: .6; margin: 0 0 .5rem; }
audio { width: 100%; margin-bottom: .6rem; }
.options { display: flex; flex-wrap: wrap; gap: .4rem; }
.options label { border: 1px solid rgba(128,128,128,.45); border-radius: .4rem;
                 padding: .35rem .7rem; cursor: pointer; }
.options input { margin-right: .35rem; }
.options label:has(input:checked) { border-color: currentColor; font-weight: 600; }
.bar { position: fixed; left: 0; right: 0; bottom: 0; padding: .75rem 1.25rem;
       background: Canvas; border-top: 1px solid rgba(128,128,128,.4);
       display: flex; gap: 1rem; align-items: center; justify-content: center; }
button { font: inherit; padding: .5rem 1.1rem; border-radius: .4rem; cursor: pointer; }
button[disabled] { opacity: .5; cursor: not-allowed; }
"""

_SCRIPT = """
const ITEMS = __ITEMS__;
const LISTENER_ID = __LISTENER__;
const SEED = __SEED__;

const counter = document.getElementById('counter');
const exportButton = document.getElementById('export');

function collected() {
  return ITEMS
    .map(id => {
      const picked = document.querySelector(`input[name="${id}"]:checked`);
      return picked ? { item_id: id, score: Number(picked.value) } : null;
    })
    .filter(Boolean);
}

function refresh() {
  const done = collected().length;
  counter.textContent = `${done} of ${ITEMS.length} rated`;
  exportButton.disabled = done !== ITEMS.length;
}

document.addEventListener('change', event => {
  if (event.target.matches('input[type="radio"]')) refresh();
});

exportButton.addEventListener('click', () => {
  const payload = {
    listener_id: LISTENER_ID,
    session_seed: SEED,
    ratings: collected(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ratings-${LISTENER_ID}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

refresh();
"""


def _json_for_script(value) -> str:
    """JSON for embedding inside a <script> block.

    `json.dumps` does not escape `/`, so a value containing `</script>` would
    close the block early and spill the rest of the page as markup. Escaping the
    sequence is the standard guard, and is why listener ids are not trusted here
    just because they came from a config file.
    """
    return json.dumps(value).replace("</", "<\\/")


def _scale_block() -> str:
    rows = "".join(
        f"<dt>{score}</dt><dd>{html.escape(label.split(' — ', 1)[1])}</dd>"
        for score, label in SCALE
    )
    return f'<dl class="scale">{rows}</dl>'


def _item_block(item_id: str, audio_src: str) -> str:
    options = "".join(
        f'<label><input type="radio" name="{html.escape(item_id)}" value="{score}">'
        f"{score}</label>"
        for score, _label in SCALE
    )
    return (
        f'<section class="item"><h2>{html.escape(item_id)}</h2>'
        f'<audio controls preload="none" src="{html.escape(audio_src)}"></audio>'
        f'<div class="options">{options}</div></section>'
    )


def render_form(
    listener_id: str,
    seed: int,
    items: list[dict],
    audio_dir: str = "audio",
) -> str:
    """Build the rating page for one listener.

    `items` carries only `item_id` and `audio_file`; the caller resolves those
    from the session key so this function never touches a system name.
    """
    if not items:
        raise ValueError("cannot render a form with no items")
    item_ids = [item["item_id"] for item in items]
    body = "".join(
        _item_block(item["item_id"], f"{audio_dir}/{item['audio_file']}") for item in items
    )
    script = (
        _SCRIPT.replace("__ITEMS__", _json_for_script(item_ids))
        .replace("__LISTENER__", _json_for_script(listener_id))
        .replace("__SEED__", _json_for_script(seed))
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Listening panel — {html.escape(listener_id)}</title>
<style>{_STYLE}</style>
</head>
<body>
<h1>Naturalness rating</h1>
<p class="sub">Listener <strong>{html.escape(listener_id)}</strong>. Use headphones in a
quiet room. Play each clip at least once, rate how <em>natural</em> it sounds, and do not
go back to revise earlier answers. Judge the voice, not the wording or the translation.</p>
{_scale_block()}
{body}
<div class="bar"><span id="counter"></span>
<button id="export" disabled>Download ratings</button></div>
<script>{script}</script>
</body>
</html>
"""
