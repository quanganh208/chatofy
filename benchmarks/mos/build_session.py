"""Build a blinded listening session: copied audio, per-listener forms, one key.

    uv run python build_session.py --manifest data/clips.jsonl --out session \
        --listeners 10 --seed 42

Writes `<out>/audio/`, `<out>/listener-<id>.html`, and `<out>/key.json`. Hand out
the HTML files. Keep `key.json` — it is the only thing that maps a rating back to
a system, and a listener who sees it is no longer blinded.
"""

import argparse
import json
from pathlib import Path

from mos_bench.form import render_form
from mos_bench.manifest import load_clips, systems
from mos_bench.session import DEFAULT_REPEATS, build_session, copy_blinded_audio


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="clips JSONL")
    parser.add_argument("--out", type=Path, required=True, help="session output directory")
    parser.add_argument(
        "--listeners",
        required=True,
        help="listener count (e.g. 10 -> L01..L10) or explicit comma-separated ids",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repeats", type=int, default=DEFAULT_REPEATS)
    return parser.parse_args()


def resolve_listener_ids(spec: str) -> list[str]:
    if spec.isdigit():
        count = int(spec)
        if count < 1:
            raise SystemExit("--listeners must be at least 1")
        return [f"L{index:02d}" for index in range(1, count + 1)]
    ids = [part.strip() for part in spec.split(",") if part.strip()]
    if not ids:
        raise SystemExit("--listeners produced no ids")
    return ids


def main() -> None:
    args = parse_args()
    clips = load_clips(args.manifest)
    listener_ids = resolve_listener_ids(args.listeners)
    session = build_session(clips, listener_ids, seed=args.seed, repeats_per_listener=args.repeats)

    audio_dir = args.out / "audio"
    copied = copy_blinded_audio(session, args.manifest.parent, audio_dir)
    audio_file_of_blind = {path.stem: path.name for path in sorted(audio_dir.iterdir())}

    for listener_id, items in session.playlists.items():
        form_items = [
            {"item_id": item.item_id, "audio_file": audio_file_of_blind[item.blind_id]}
            for item in items
        ]
        target = args.out / f"listener-{listener_id}.html"
        target.write_text(render_form(listener_id, args.seed, form_items), encoding="utf-8")

    key_path = args.out / "key.json"
    key_path.write_text(
        json.dumps(session.key_document(), indent=2, ensure_ascii=False), encoding="utf-8"
    )

    per_listener = len(next(iter(session.playlists.values())))
    print(f"clips        {len(clips)} across {len(systems(clips))} system(s)")
    print(f"audio        {copied} file(s) copied to {audio_dir}")
    print(f"listeners    {len(listener_ids)} x {per_listener} items ({args.repeats} repeated)")
    print(f"key          {key_path}  <- do not share with listeners")


if __name__ == "__main__":
    main()
