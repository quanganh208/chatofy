"""Words Vietnamese writes in lowercase, counted from ViCapPunc train.

Only mid-sentence occurrences count: a sentence-initial capital says nothing
about the word. ViCapPunc also capitalizes after its source's line breaks, so
even "xin" is lowercase only ~87% of the time; the threshold sits below that.
Train, not test, so the `comma-common` rule never saw the ruler it is scored on.

Run: uv run python -m punct_bench.common_words   (writes data/lowercase-words.json)
"""
import json
from collections import Counter

from punct_bench.rulers import DATA, EXTERNAL, VICAPPUNC_REV, _fetch

TRAIN_URL = f"https://raw.githubusercontent.com/anhtunguyen98/JointCapPunc/{VICAPPUNC_REV}/data/train.txt"
MIN_COUNT = 50
MIN_LOWER_RATIO = 0.8
PATH = DATA / "lowercase-words.json"


def build() -> int:
    path = _fetch(TRAIN_URL, EXTERNAL / "vicappunc-train.txt")
    lower, total = Counter(), Counter()
    sentence_start = True
    with path.open(encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 3:
                continue
            word, case, label = parts
            if not sentence_start:
                total[word] += 1
                lower[word] += case == "0"
            sentence_start = label in ("PERIOD", "QMARK")
    words = sorted(w for w, n in total.items() if n >= MIN_COUNT and lower[w] / n >= MIN_LOWER_RATIO)
    PATH.write_text(json.dumps(words, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(words)


def load() -> frozenset[str]:
    return frozenset(json.loads(PATH.read_text(encoding="utf-8")))


if __name__ == "__main__":
    print(build())
