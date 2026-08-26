"""Fetch the Vietnamese speaker corpora Checkpoint 1 screens on.

Idempotent; safe to re-run. Mirrors `scripts/download_models.py`, and like it
keeps the payload out of git.

Two corpora, deliberately different roles:

* **VoxVietnam** (primary) — 1,406 speakers, 261h, `cc-by-nc-4.0`, on
  HuggingFace. Its `test` split is 38 parquet shards separable from the 44GB
  whole, and 74.6% of its utterances are under 5s, close to this product's 1-3s
  turns.
* **Vietnam-Celeb** (secondary) — 1,000 speakers, 187h. Its hard trial list
  matches negatives on gender AND dialect, which is the honest hard case and a
  Vietnamese-specific confound nothing else here controls for; and its paper
  publishes EER on those same lists for a VoxCeleb-pretrained model, so our
  numbers land next to a published reference instead of free-floating.

LICENCES ARE NOT A FOOTNOTE HERE.

VoxVietnam is `gated: auto` on HuggingFace: it needs an account that has
accepted its conditions. This script reads a token from the environment and
FAILS with an explanation when it is missing or unaccepted. It never sends an
acceptance and never works around the gate — agreeing to a dataset licence is
the user's act, not this script's.

`cc-by-nc-4.0` is non-commercial. Evaluating off-the-shelf models on it, which
is all this gate does, is research use. Training on it or shipping any part of
it is not.

Vietnam-Celeb's repository states no licence at all, which is more restrictive
in practice than a stated NC one. It is also not fetchable: the repo holds only
a README pointing at four Google Drive parts, and the trial lists live inside
that archive rather than beside it. So this script VERIFIES a Vietnam-Celeb
extraction the user performed, and prints the licence caveat — it does not
download it.

Run:
    uv run --directory benchmarks/speaker-id python scripts/fetch_corpora.py
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
CORPORA_DIR = BENCH_ROOT / "corpora"

#: HuggingFace dataset id for VoxVietnam.
VOXVIETNAM_REPO = "hustep-lab/VoxVietnam-Dataset"

#: Only the test split. The train splits are the bulk of the 44GB and this gate
#: evaluates rather than trains, so fetching them would cost hours and tens of
#: gigabytes for data nothing reads.
VOXVIETNAM_TEST_PATTERN = "data/test-*"

#: Environment variables `huggingface_hub` itself honours, checked here only so
#: the failure is a sentence instead of a stack trace three frames deep.
HF_TOKEN_VARS = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACEHUB_API_TOKEN")

#: What a complete Vietnam-Celeb extraction puts on disk.
#:
#: These ship INSIDE the Google Drive zip, not as separate files in the GitHub
#: repository — the repo holds only a README with the Drive links. So there is
#: nothing to fetch piecemeal: the trial lists arrive with the 4-part archive or
#: not at all.
VIETNAM_CELEB_EXPECTED = (
    "vietnam-celeb-e.txt",
    "vietnam-celeb-h.txt",
    "vietnam-celeb-t.txt",
    "vietnam-celeb-metadata.tsv",
)

VIETNAM_CELEB_NOTICE = """\
Vietnam-Celeb is a MANUAL download, and its licence is unstated.

Its GitHub repository contains only a README pointing at four Google Drive
parts; the trial lists (vietnam-celeb-e/h.txt) and the speaker metadata TSV live
INSIDE that archive, so none of it can be fetched piecemeal and Drive blocks
automated downloads at this size anyway.

  https://github.com/Vietnam-Celeb/Vietnam-Celeb

  zip -F vietnam-celeb-part.zip --out full-dataset.zip
  unzip full-dataset.zip

Place the extracted contents under:
  {target}

LICENCE: the repository states none, and describes itself as an anonymous
submission artifact. Unstated is not permissive — absent an explicit grant,
default copyright applies and evaluation use is a judgement call rather than a
permission. Resolve it with the authors (Pham et al., Interspeech 2023) before
any number derived from this corpus is reported outside your own notes.

It is worth the trouble for two things VoxVietnam does not give: negatives
matched on gender AND dialect, and a published EER on those exact lists
(13.19/16.52 for a VoxCeleb-pretrained model) that our numbers can sit beside.
"""


def _hf_token() -> str | None:
    for name in HF_TOKEN_VARS:
        value = os.environ.get(name)
        if value:
            return value
    return None


def fetch_voxvietnam(target: Path, *, shards: int | None) -> int:
    """Fetch VoxVietnam's test split. Returns the number of files present."""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        raise RuntimeError(
            "huggingface_hub is not installed. Add it to pyproject.toml's "
            "dependencies and re-run `uv sync`."
        ) from None

    token = _hf_token()
    if token is None:
        raise RuntimeError(
            f"{VOXVIETNAM_REPO} is a GATED dataset and no token was found in "
            f"{' / '.join(HF_TOKEN_VARS)}.\n\n"
            "This script will not accept the dataset's conditions for you — that\n"
            "is your decision to make, not a step to automate. To proceed:\n"
            f"  1. Open https://huggingface.co/datasets/{VOXVIETNAM_REPO}\n"
            "  2. Read the licence (cc-by-nc-4.0) and accept the conditions\n"
            "  3. Create a token at https://huggingface.co/settings/tokens\n"
            "  4. export HF_TOKEN=hf_...\n"
            "  5. re-run this script"
        )

    allow = VOXVIETNAM_TEST_PATTERN
    if shards is not None:
        # EER over tens of thousands of pairs is stable well before the full
        # split, so a shard subset is a legitimate way to bound the download —
        # provided the count is recorded, which is why it is printed and
        # returned rather than silently applied.
        allow = [f"data/test-{index:05d}-of-*" for index in range(shards)]
        print(f"  limiting to the first {shards} shard(s)")

    print(f"  repo {VOXVIETNAM_REPO} (test split only)")
    try:
        snapshot_download(
            repo_id=VOXVIETNAM_REPO,
            repo_type="dataset",
            local_dir=str(target),
            allow_patterns=allow,
            token=token,
        )
    except Exception as exc:  # noqa: BLE001 - hub raises several unrelated types
        message = str(exc)
        if "gated" in message.lower() or "403" in message:
            raise RuntimeError(
                f"Access to {VOXVIETNAM_REPO} was refused. The token is valid but the\n"
                "account has probably not accepted the dataset's conditions yet.\n"
                f"Accept them at https://huggingface.co/datasets/{VOXVIETNAM_REPO}\n"
                "and re-run. This script will not accept them on your behalf."
            ) from exc
        raise RuntimeError(f"{VOXVIETNAM_REPO}: {exc}") from exc

    files = sorted((target / "data").glob("test-*")) if (target / "data").exists() else []
    return len(files)


def check_vietnam_celeb(target: Path) -> list[str]:
    """Report which expected Vietnam-Celeb files are missing from ``target``.

    Verification rather than download: nothing here can be fetched
    automatically, so the useful job is telling the user precisely what is still
    absent after their manual extraction, instead of a bench failing later with
    a missing-path error three layers down.
    """
    return [name for name in VIETNAM_CELEB_EXPECTED if not (target / name).exists()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpora-dir",
        type=Path,
        default=CORPORA_DIR,
        help="where corpora land (default: benchmarks/speaker-id/corpora)",
    )
    parser.add_argument(
        "--shards",
        type=int,
        default=None,
        help=(
            "fetch only the first N VoxVietnam test shards instead of all 38. "
            "The count used is printed and belongs in the gate report."
        ),
    )
    parser.add_argument(
        "--skip-voxvietnam",
        action="store_true",
        help="fetch only the Vietnam-Celeb trial lists (no HuggingFace token needed)",
    )
    args = parser.parse_args()

    if args.shards is not None and args.shards < 1:
        print("--shards must be at least 1", file=sys.stderr)
        return 2

    corpora = args.corpora_dir
    failures: list[str] = []

    vietnam_celeb = corpora / "vietnam-celeb"
    print("Vietnam-Celeb (manual download)")
    missing = check_vietnam_celeb(vietnam_celeb)
    present = len(VIETNAM_CELEB_EXPECTED) - len(missing)
    print(f"  {present}/{len(VIETNAM_CELEB_EXPECTED)} expected file(s) present")
    if missing:
        print(f"  missing: {', '.join(missing)}")
        print()
        print(VIETNAM_CELEB_NOTICE.format(target=vietnam_celeb))

    if args.skip_voxvietnam:
        print("\nVoxVietnam skipped (--skip-voxvietnam)")
    else:
        print("\nVoxVietnam test split")
        try:
            shards = fetch_voxvietnam(corpora / "voxvietnam", shards=args.shards)
            print(f"  {shards} shard file(s) present")
            if shards == 0:
                failures.append("voxvietnam (no shards landed)")
        except RuntimeError as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            failures.append("voxvietnam")

    # Vietnam-Celeb being absent is NOT a failure: it is a manual, licence-
    # unresolved download, and VoxVietnam alone is enough to run Checkpoint 1.
    # Exiting non-zero for it would train the user to ignore this exit code.
    if failures:
        print(f"\nincomplete: {', '.join(failures)}", file=sys.stderr)
        return 1
    print(f"\ncorpora under {corpora}")
    if missing:
        print("Vietnam-Celeb is incomplete — the screen can still run on VoxVietnam alone,")
        print("but the published-baseline comparison needs Vietnam-Celeb's lists.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
