"""The local-stt sidecar's own `DisplayRestorer`, every shipped rule included.

Runs in the sidecar's environment (see `ARMS` in `punct_bench/run.py`), so what
is measured is the code that serves `/restore`, not a re-implementation of it.

Variants:
- shipped:          the restorer as deployed, without pauses.
- gate-<ms>-<mark>: with the pause gate — a sentence end after a word followed
                    by less than <ms> of silence becomes <mark> ("none" drops
                    it, "comma" demotes it). Rows without pauses get none.
"""
import sys
from pathlib import Path

SIDECAR = Path(__file__).resolve().parents[3] / "services" / "local-stt"
sys.path.insert(0, str(SIDECAR))

from punct_bench.arm_protocol import main  # noqa: E402
from punctuation import restorer as sidecar  # noqa: E402

_MARKS = {"none": "O", "comma": "COMMA"}


def load(variant: str, threads: int):
    sidecar.RESTORE_THREADS = threads
    r = sidecar.DisplayRestorer()
    r.load()
    if not r.loaded:
        raise RuntimeError(f"restorer did not load from {SIDECAR / 'models'}")
    if variant == "shipped":
        return lambda text: r.restore(text)
    _, ms, mark = variant.split("-")
    sidecar.PAUSE_GATE_MS = int(ms)
    sidecar.PAUSE_GATE_MARK = _MARKS[mark]
    return lambda text, pauses: r.restore(text, pauses=pauses)


if __name__ == "__main__":
    main(load)
