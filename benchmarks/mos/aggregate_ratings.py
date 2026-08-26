"""Screen a returned panel and render its MOS report.

    uv run python aggregate_ratings.py --key session/key.json --ratings returned/

Prints the markdown report to stdout. Screening runs first and its result is
reported whether or not anyone was dropped, because "12 listeners, none excluded"
and "12 listeners, 4 excluded" are different claims and the second one has to be
visible in the chapter.
"""

import argparse
from pathlib import Path

from mos_bench.aggregate import (
    DEFAULT_ATTENTION_TOLERANCE,
    icc_two_way,
    load_ratings,
    mos_table,
    rating_matrix,
    screen_listeners,
)
from mos_bench.report import render_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", type=Path, required=True, help="session key.json")
    parser.add_argument(
        "--ratings",
        type=Path,
        required=True,
        help="directory of ratings-*.json, or a single file",
    )
    parser.add_argument("--attention-tolerance", type=int, default=DEFAULT_ATTENTION_TOLERANCE)
    parser.add_argument(
        "--include-flagged",
        action="store_true",
        help="score every listener, including flagged ones (report says so)",
    )
    return parser.parse_args()


def resolve_rating_paths(target: Path) -> list[Path]:
    if target.is_dir():
        paths = sorted(target.glob("ratings-*.json"))
        if not paths:
            raise SystemExit(f"no ratings-*.json under {target}")
        return paths
    if target.is_file():
        return [target]
    raise SystemExit(f"not found: {target}")


def main() -> None:
    import json

    args = parse_args()
    key = json.loads(args.key.read_text(encoding="utf-8"))
    ratings = load_ratings(resolve_rating_paths(args.ratings))

    screens = screen_listeners(key, ratings, attention_tolerance=args.attention_tolerance)
    keep = {s.listener_id for s in screens if args.include_flagged or s.passed}
    if not keep:
        raise SystemExit("every listener was screened out; nothing to score")

    rows = mos_table(key, ratings, keep)

    icc_by_lang: dict[str, dict] = {}
    for lang in sorted({row["lang"] for row in rows}):
        try:
            icc_by_lang[lang] = icc_two_way(rating_matrix(key, ratings, keep, lang))
        except ValueError as error:
            icc_by_lang[lang] = {"error": str(error)}

    print(
        render_report(
            rows=rows,
            screens=screens,
            keep=keep,
            icc_by_lang=icc_by_lang,
            attention_tolerance=args.attention_tolerance,
            include_flagged=args.include_flagged,
        )
    )


if __name__ == "__main__":
    main()
