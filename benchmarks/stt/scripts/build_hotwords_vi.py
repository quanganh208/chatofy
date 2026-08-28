"""Write data/hotwords-vi.txt for the vi beam+hotwords benchmark arm.

Thin CLI over stt_bench.hotwords, which documents the selection rule and why
the resulting numbers are a ceiling rather than an expected gain.

Run: uv run python scripts/build_hotwords_vi.py
"""

import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from stt_bench.hotwords import load_references, select_hotwords  # noqa: E402

MANIFEST = BENCH_ROOT / "data" / "manifest-vi.jsonl"
OUT_PATH = BENCH_ROOT / "data" / "hotwords-vi.txt"


def main() -> int:
    if not MANIFEST.exists():
        print(
            f"[error] {MANIFEST} missing; run: uv run python scripts/prepare_datasets.py",
            file=sys.stderr,
        )
        return 1
    hotwords = select_hotwords(load_references(MANIFEST))
    OUT_PATH.write_text("\n".join(hotwords) + "\n", encoding="utf-8")
    print(f"[hotwords-vi] wrote {len(hotwords)} phrases -> {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
