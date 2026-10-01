"""Build the rows every arm is run on: data/rows-<ruler>.jsonl.

Each row is {ruler, id, input, ref}. `input` is `model_input(...)` of the text
the restorer would really see; `ref` is what it should produce.

- prod:      7 prod sessions, the live ASR hypothesis against Scribe's
             transcript of the same audio. In domain, but the reference is a
             commercial ASR's punctuation, not a human's, and the hypothesis has
             recognition errors the reference does not.
- aiwho:     17 sentences where "ai" means "who", plus their "AI" twins; the
             guard against a model that writes AI everywhere.
- fleurs:    FLEURS vi test, unique `raw_transcription` sentences. Human gold,
             read Wikipedia sentences — one sentence each, so it says little
             about sentence boundaries.
- vicappunc: ViCapPunc test (JointCapPunc, Interspeech 2022). Human gold,
             informal forum Q&A, a continuous stream cut here into windows that
             start at a sentence start.

Run: uv run python -m punct_bench.rulers
"""
import csv
import json
import random
import urllib.request
from pathlib import Path

from punct_bench.text import model_input

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXTERNAL = DATA / "external"

FLEURS_URL = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/vi_vn/test.tsv"
# Pinned to a commit so the ruler cannot move under recorded results.
VICAPPUNC_URL = (
    "https://raw.githubusercontent.com/anhtunguyen98/JointCapPunc/"
    "{rev}/data/test.txt"
)
VICAPPUNC_REV = "main"

VICAPPUNC_WINDOWS = 500
VICAPPUNC_WORDS = 40
SEED = 7

_LABEL_MARK = {"O": "", "PERIOD": ".", "COMMA": ",", "QMARK": "?"}


def _fetch(url: str, path: Path) -> Path:
    if not path.exists():
        EXTERNAL.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(path)
    return path


def _row(ruler: str, row_id: str, source: str, ref: str) -> dict:
    return {"ruler": ruler, "id": row_id, "input": model_input(source), "ref": ref}


def prod_rows(name: str, path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.open(encoding="utf-8")]
    return [_row(name, f"{r['session']}/{r['row']}", r["hyp"], r["ref"]) for r in rows]


def fleurs_rows() -> list[dict]:
    path = _fetch(FLEURS_URL, EXTERNAL / "fleurs-vi-test.tsv")
    seen: dict[str, str] = {}
    with path.open(encoding="utf-8") as f:
        for record in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            seen.setdefault(record[0], record[2])
    return [_row("fleurs", sid, text, text) for sid, text in sorted(seen.items(), key=lambda kv: int(kv[0]))]


def _vicappunc_words(path: Path) -> list[tuple[str, int, str]]:
    words = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 3:
                words.append((parts[0], int(parts[1]), parts[2]))
    return words


def _surface(word: str, case: int, label: str) -> str:
    if case == 2:
        word = word.upper()
    elif case == 1:
        word = word[:1].upper() + word[1:]
    return word + _LABEL_MARK[label]


def vicappunc_rows() -> list[dict]:
    path = _fetch(VICAPPUNC_URL.format(rev=VICAPPUNC_REV), EXTERNAL / "vicappunc-test.txt")
    words = _vicappunc_words(path)
    # A window starts right after a terminal mark, so its first word opens a
    # sentence in the reference too, and ends at the first terminal mark at or
    # past the word budget, so no sentence is cut in half.
    starts = [i + 1 for i, (_, _, label) in enumerate(words[:-1]) if label in ("PERIOD", "QMARK")]
    rng = random.Random(SEED)
    picked: list[tuple[int, str]] = []
    taken: set[int] = set()
    for start in rng.sample(starts, len(starts)):
        if len(picked) == VICAPPUNC_WINDOWS:
            break
        end = start
        while end < len(words) and (end - start < VICAPPUNC_WORDS or words[end - 1][2] not in ("PERIOD", "QMARK")):
            end += 1
        span = set(range(start, end))
        # A sentence so long it would triple the budget is skipped, not cut.
        if end - start > 3 * VICAPPUNC_WORDS or span & taken:
            continue
        taken |= span
        picked.append((start, " ".join(_surface(*words[i]) for i in range(start, end))))
    return [_row("vicappunc", str(start), ref, ref) for start, ref in sorted(picked)]


# Kinship words a targeted ruler is built around; see `targeted_rows`.
_TITLES = frozenset("anh chị em ông bà cô chú bác cậu thầy dì".split())
TARGETED_WINDOWS = 300


def targeted_rows() -> dict[str, list[dict]]:
    """Two rulers aimed at single comma decisions, from ViCapPunc TRAIN.

    The general rulers hold almost none of these cases (one each on prod), so a
    rule touching them cannot be measured there. Train is the larger gold set,
    and nothing scored here was fitted to it: the comma rules are not learned.

    - title-open: windows opening with a kinship word ("Em chào bác sĩ…",
      "Anh, em xin lỗi…") — whether a comma follows it.
    - greet: windows holding "chào" before a kinship word — whether a comma
      separates them.
    """
    path = _fetch(VICAPPUNC_URL.format(rev=VICAPPUNC_REV).replace("test.txt", "train.txt"), EXTERNAL / "vicappunc-train.txt")
    words = _vicappunc_words(path)
    opens = {0} | {i + 1 for i, (_, _, label) in enumerate(words[:-1]) if label in ("PERIOD", "QMARK")}
    title_starts = [i for i in sorted(opens) if i < len(words) and words[i][0] in _TITLES]
    greet_at = [i for i in range(len(words) - 1) if words[i][0] == "chào" and words[i + 1][0] in _TITLES]
    rng = random.Random(SEED)
    out: dict[str, list[dict]] = {}
    for name, anchors, lead in (("title-open", title_starts, 0), ("greet", greet_at, 8)):
        rows = []
        for anchor in sorted(rng.sample(anchors, TARGETED_WINDOWS)):
            start = max(0, anchor - lead)
            span = words[start : start + 25]
            ref = " ".join(_surface(*w) for w in span)
            rows.append(_row(name, str(start), ref, ref))
        out[name] = rows
    return out


def build() -> dict[str, int]:
    rulers = {
        "prod": prod_rows("prod", DATA / "prod-sessions-scribe.jsonl"),
        "aiwho": prod_rows("aiwho", DATA / "ai-who-guard.jsonl"),
        "fleurs": fleurs_rows(),
        "vicappunc": vicappunc_rows(),
        **targeted_rows(),
    }
    for name, rows in rulers.items():
        with (DATA / f"rows-{name}.jsonl").open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return {name: len(rows) for name, rows in rulers.items()}


if __name__ == "__main__":
    print(build())
