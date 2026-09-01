"""Fetch the VoxCeleb1-O control corpus and its OFFICIAL trial list.

M11 measured 17.15% EER on eight seconds of clean Vietnamese and could not say
whether that was a domain gap or a broken harness, because **nothing in this
repo had ever been checked against a number somebody else published.** Every EER
here was self-referential.

This fetches the one corpus that closes that. The exact checkpoint under test —
`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced` — publishes **1.16% EER
on VoxCeleb1-O** on its own ModelScope card, and Oxford's official trial list is
still served ungated even though their audio is not.

**Two artifacts, and the second is the point.** The audio comes from an ungated
mirror. The trial list is the OFFICIAL pair list, so scoring it exercises this
repo's embedder and its EER routine while **bypassing its pair construction
entirely** — which is what lets `run_known_good_control.py` separate three
suspects that would otherwise fail as one.

**Licence, stated rather than assumed.** The mirror is tagged cc-by-4.0 and
reports `gated: false`; VoxCeleb1's original terms may be stricter, and this was
not resolved. Internal benchmark use only. `corpora/` is gitignored, so nothing
here is redistributed by this repo. The mirror was also **not verified
bit-identical** to Oxford's original zip — reproducing the published EER to 0.19
points is evidence it is the right audio, not a checksum.

Run:
    uv run --directory benchmarks/speaker-id python scripts/fetch_voxceleb_control.py
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
import zipfile
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent

#: Oxford VGG still serves the metadata ungated. Their audio zips are not: the
#: site says "audio files no longer available from this website", which is why
#: the wav come from a mirror and the pairs come from here.
TRIAL_URL = "https://www.robots.ox.ac.uk/~vgg/data/voxceleb/meta/veri_test2.txt"

#: Ungated mirror of the test split. `gated: false` per the HF datasets API.
AUDIO_REPO = "ProgramComputer/voxceleb"
AUDIO_FILE = "vox1/vox1_test_wav.zip"

#: What the official list should contain. Checked rather than trusted: a
#: truncated download still parses, and an EER over a tenth of the pairs is a
#: number nobody chose.
EXPECTED_TRIAL_LINES = 37_611

EXIT_INCOMPLETE = 3


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, default=BENCH_ROOT / "corpora" / "voxceleb1")
    parser.add_argument(
        "--keep-archive",
        action="store_true",
        help="keep the 1.07GB zip after extracting; by default it is removed, "
        "since this script re-downloads it in well under a minute",
    )
    args = parser.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)

    trials = args.dest / "veri_test2.txt"
    if not trials.exists():
        print(f"fetching the official trial list -> {trials}", flush=True)
        urllib.request.urlretrieve(TRIAL_URL, trials)
    lines = sum(1 for _ in trials.open())
    print(f"trial list: {trials.stat().st_size} bytes, {lines} pairs", flush=True)
    if lines != EXPECTED_TRIAL_LINES:
        print(
            f"expected {EXPECTED_TRIAL_LINES} pairs, got {lines}. Delete "
            f"{trials} and re-run rather than scoring a list nobody chose.",
            file=sys.stderr,
        )
        return EXIT_INCOMPLETE

    wav = args.dest / "wav"
    if wav.is_dir() and any(wav.iterdir()):
        print(f"audio already extracted at {wav}", flush=True)
        return 0

    from huggingface_hub import hf_hub_download

    print(f"fetching {AUDIO_FILE} from {AUDIO_REPO} (~1.07GB) ...", flush=True)
    archive = Path(
        hf_hub_download(
            repo_id=AUDIO_REPO,
            repo_type="dataset",
            filename=AUDIO_FILE,
            local_dir=str(args.dest),
        )
    )
    print(f"extracting {archive.stat().st_size / 1e9:.2f}GB ...", flush=True)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(args.dest)
    if not args.keep_archive:
        archive.unlink()
        # The zip's own parent directory comes from the repo path and holds
        # nothing else once the archive is gone.
        if archive.parent != args.dest and not any(archive.parent.iterdir()):
            archive.parent.rmdir()

    count = sum(1 for _ in wav.rglob("*.wav"))
    print(f"\n{count} wav under {wav}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
