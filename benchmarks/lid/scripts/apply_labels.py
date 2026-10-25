"""Reviewed labels -> manifests, and whether the labelled set is big enough.

    uv run python scripts/apply_labels.py            # labels.tsv -> data/{prod,recorded}/manifest.jsonl
    uv run python scripts/apply_labels.py --check    # exit != 0 unless step 4's minimums hold

Only rows with `reviewed=1` become manifest rows; the count of unreviewed rows
is printed so a half-reviewed file cannot pass for a finished one.

`--check` counts across every manifest (public, prod, recorded) against the
table in phase-00 step 4. The minimums are not lowered when short: the fix is
to record more (step 3b).
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench.labelling import read_labels  # noqa: E402
from lid_bench.manifest import BUCKETS, Turn, load, save  # noqa: E402

DATA = BENCH_ROOT / "data"
LICENSES = {"prod": "private (prod users, consent per README)", "recorded": "private (recorded, consent per README)"}


def apply() -> int:
    status = 0
    for source, license in LICENSES.items():
        labels = DATA / source / "labels.tsv"
        if not labels.exists():
            print(f"{source}: no labels.tsv yet")
            continue
        turns, pending = read_labels(labels, license)
        save(DATA / source / "manifest.jsonl", turns)
        print(f"{source}: {len(turns)} reviewed turns -> manifest; {pending} still unreviewed")
        status |= int(pending > 0)
    return status


def minimums(turns: list[Turn]) -> list[tuple[str, int, int]]:
    """(requirement, have, need) rows for phase-00 step 4."""
    real = [t for t in turns if t.real]
    lang = Counter(t.lang for t in real)
    rows = [("real vi", lang["vi"], 150), ("real en", lang["en"], 100)]
    for code in ("vi", "en"):
        channels = {t.channel for t in real if t.lang == code}
        rows.append((f"real {code} channels", len(channels), 2))
        for bucket, _ in BUCKETS:
            rows.append((f"real {code} bucket {bucket}",
                         sum(1 for t in real if t.lang == code and t.bucket == bucket), 30))
        short = sum(1 for t in turns if t.lang == code and t.bucket == "<1.5" and (t.real or t.source == "cv"))
        rows.append((f"{code} <1.5 s (real + CV)", short, 40))
    rows.append(("public zh", sum(1 for t in turns if t.lang == "zh" and not t.real), 400))
    rows.append(("real vi code-switch", sum(1 for t in real if t.lang == "vi" and t.codeswitch), 50))
    rows.append(("real noise", sum(1 for t in real if t.noise), 30))
    rows.append(("ESC-50 noise", sum(1 for t in turns if t.source == "esc50"), 40))
    # EdAcc (conversational) or L2-ARCTIC (read): any English from a Vietnamese L1.
    rows.append(("en from L1-vi speakers", sum(1 for t in turns if t.accent_l1 == "vi"), 300))
    for code in ("en", "vi"):
        sessions = Counter(t.session for t in real if t.mono and t.lang == code)
        rows.append((f"mono {code} sessions with >=40 turns", sum(1 for n in sessions.values() if n >= 40), 1))
    return rows


def check() -> int:
    turns = [t for name in ("public", "conversational", "rerecorded", "prod", "recorded") if (DATA / name / "manifest.jsonl").exists()
             for t in load(DATA / name / "manifest.jsonl")]
    rows = minimums(turns)
    print("| requirement | have | need | |")
    print("|---|---|---|---|")
    for name, have, need in rows:
        print(f"| {name} | {have} | {need} | {'ok' if have >= need else 'SHORT'} |")
    real_zh = sum(1 for t in turns if t.real and t.lang == "zh")
    print(f"\nreal zh (no minimum, reported separately): {real_zh}")
    return 0 if all(have >= need for _, have, need in rows) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    return check() if args.check else apply()


if __name__ == "__main__":
    sys.exit(main())
