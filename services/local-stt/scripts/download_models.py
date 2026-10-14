"""Fetch and cache the sidecar's model weights into models/ (gitignored).

- Zipformer-30M vi: encoder/decoder/joiner INT8 ONNX + bpe.model from HF, then
  generates tokens.txt from bpe.model (the repo does not ship one; sherpa-onnx
  requires the "SYMBOL ID" token table).
- ZipFormer-150M vi, the alternate recognizer behind `/transcribe`'s
  `alternates`: the same four files and the same generated tokens.txt, from a
  pinned HF revision, each file pinned by size and sha256. Optional, like
  Dewpoint.
- Parakeet-TDT-0.6b-v2 en INT8 (~630MB): k2-fsa release tarball, extracted.
- Paraformer-zh int8 (2023-09-14): k2-fsa release tarball (~234MB), pinned by
  size and sha256, of which only the model and its token table are extracted.
- CAM++ speaker embedding: one ONNX file from the k2-fsa speaker release. fp32,
  because that release publishes no int8 variant of any speaker model.
- Silero VAD: one ONNX file, pinned by sha256 (see below) rather than trusted
  on whatever the URL currently serves — see `audio/silero_speech.py`.
- CT-Transformer punctuation for the zh display: k2-fsa release tarball, pinned
  by the digest GitHub publishes for it; only the model is extracted. Optional,
  like Dewpoint.
- Dewpoint mmBERT punctuation/case tagger for the vi display: pinned HF
  revision, then its embedding matrix quantized to 8 bits here by
  `quantize_embedding.py` — see `punctuation/restorer.py` for why only the
  embedding.

Idempotent; safe to re-run.
Run: uv run --directory services/local-stt python scripts/download_models.py
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = SERVICE_ROOT / "models"

# Duplicated from `audio.silero_speech` rather than imported: this script's
# `sys.path[0]` is `scripts/`, not the service root, so the package import
# that works from `app.py` does not work here. `test_silero_speech.py`
# asserts the two stay equal.
SILERO_VAD_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
SILERO_VAD_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"

ZIPFORMER_REPO = "hynt/Zipformer-30M-RNNT-6000h"
ZIPFORMER_FILES = [
    "encoder-epoch-20-avg-10.int8.onnx",
    "decoder-epoch-20-avg-10.int8.onnx",
    "joiner-epoch-20-avg-10.int8.onnx",
    "bpe.model",
]

ZIPFORMER_ALT_REPO = "hynt/ZipFormer-150M-CR-CTC-RNNT-6000h"
#: Pinned: the fusion numbers in `engines/zipformer_vi_alternate.py` were
#: measured on exactly this revision.
ZIPFORMER_ALT_REVISION = "8c3d474d3d74cb247f4b8c7b0f8b48598ac8c1c6"
ZIPFORMER_ALT_DIR = "zipformer-vi-150m"
#: Size and sha256 of each file at that revision, from the Hub's LFS metadata
#: and checked against the files the fusion was measured on: a revision pins
#: what the repo says, these pin the bytes that land.
ZIPFORMER_ALT_PINS = {
    "encoder-epoch-11-avg-2.int8.onnx": (
        154_671_174,
        "827db843495b35ba1153a92494f89e5e58ec31f5393b4f199b39b508f5a9d025",
    ),
    "decoder-epoch-11-avg-2.int8.onnx": (
        1_308_689,
        "af6c029366f12c1feef320e601d80e6b797a0b3b23d5013b110402bde53991e3",
    ),
    "joiner-epoch-11-avg-2.int8.onnx": (
        1_033_417,
        "7d0417a93de825ab0002de19acb30500406bb7224074493387f616180b1807f0",
    ),
    "bpe.model": (
        268_106,
        "002894e7a82d80ffa5e25008ec8c5496159db804005e2103de96b01b4c13d445",
    ),
}
ZIPFORMER_ALT_FILES = list(ZIPFORMER_ALT_PINS)

PARAKEET_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
)

PARAFORMER_ZH_NAME = "sherpa-onnx-paraformer-zh-2023-09-14"
PARAFORMER_ZH_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    f"{PARAFORMER_ZH_NAME}.tar.bz2"
)
#: GitHub publishes no digest for this 2023 asset, so both values come from the
#: first fetch (2026-10-13) — the same tarball the r11 benchmark measured.
PARAFORMER_ZH_SIZE = 234_051_698
PARAFORMER_ZH_SHA256 = "9c49fd9c6fb63de8e18c1054cf3d100f804741b7e608e187923cd8ff09fa9f03"
#: The tarball also carries test WAVs and helper scripts nothing here runs.
PARAFORMER_ZH_MEMBERS = ("model.int8.onnx", "tokens.txt")

CT_PUNCT_ZH_NAME = "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8"
CT_PUNCT_ZH_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/"
    f"{CT_PUNCT_ZH_NAME}.tar.bz2"
)
#: The digest GitHub publishes for this asset, checked against the first fetch.
CT_PUNCT_ZH_SIZE = 64_717_756
CT_PUNCT_ZH_SHA256 = "c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1"
#: The model carries its own token table in its metadata; `tokens.json` and the
#: export scripts beside it are not needed to run it.
CT_PUNCT_ZH_MEMBERS = ("model.int8.onnx",)

# The release tag is misspelled upstream ("recongition"). Copied verbatim: the
# corrected spelling 404s.
CAMPPLUS_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/"
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)


DEWPOINT_REPO = "valkayuh/dewpoint"
#: Pinned: the repo is new and single-author, and the accuracy numbers in
#: `punctuation/restorer.py` were measured on exactly this revision.
DEWPOINT_REVISION = "4c45df7c148d096df50c8fbf47a9b0e34f08da68"
DEWPOINT_FILES = [
    "gazetteer.json",
    "mmbert-base/vpunct_config.json",
    "mmbert-base/tokenizer.json",
    "mmbert-base/tokenizer_config.json",
]
DEWPOINT_ONNX = "onnx/mmbert-base/model.onnx"


def fetch_zipformer_vi() -> None:
    fetch_hynt_zipformer("zipformer-vi", ZIPFORMER_REPO, None, "zipformer-vi-30m", ZIPFORMER_FILES)


def fetch_zipformer_vi_alternate() -> None:
    """The alternate vi recognizer, which is OPTIONAL: any failure is a warning.

    Same contract as `fetch_ct_punct_zh`: the sidecar serves without it (no
    `alternates` on any response) and the API shows the unfused display, so
    neither a download failure nor a read-only models mount may stop the seed or
    the runtime.
    """
    tag = "zipformer-vi-150m"
    out_dir = MODELS_DIR / ZIPFORMER_ALT_DIR
    if not _writable(out_dir) and not (out_dir / "tokens.txt").exists():
        print(f"[{tag}] skipped, {MODELS_DIR} is not writable; no vi alternates")
        return
    try:
        fetch_hynt_zipformer(
            tag,
            ZIPFORMER_ALT_REPO,
            ZIPFORMER_ALT_REVISION,
            ZIPFORMER_ALT_DIR,
            ZIPFORMER_ALT_FILES,
            pins=ZIPFORMER_ALT_PINS,
        )
    except Exception as err:  # noqa: BLE001 — see the docstring
        print(f"[{tag}] skipped, no vi alternates: {err}")


def fetch_hynt_zipformer(
    tag: str,
    repo: str,
    revision: str | None,
    dir_name: str,
    files: list[str],
    pins: dict[str, tuple[int, str]] | None = None,
) -> None:
    """One of hynt's Zipformer exports: the files as published, plus tokens.txt.

    Each file lands through a `.part` and a rename, so an interrupted run never
    leaves a truncated encoder that the existence check would accept as cached.
    A file with an entry in `pins` (size, sha256) is verified as the `.part`,
    so bytes that do not match never take the name the cache check trusts.
    """
    out_dir = MODELS_DIR / dir_name
    tokens_path = out_dir / "tokens.txt"
    if tokens_path.exists() and all((out_dir / name).exists() for name in files):
        print(f"[{tag}] ready (cached)")
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename in files:
        target = out_dir / filename
        if target.exists():
            continue
        print(f"[{tag}] fetching {filename}")
        cached = hf_hub_download(repo, filename, revision=revision)
        part = target.with_name(target.name + ".part")
        shutil.copyfile(cached, part)
        if pins is not None and filename in pins:
            try:
                verify_pinned(part, *pins[filename])
            except RuntimeError:
                part.unlink()
                raise
        part.rename(target)

    if not tokens_path.exists():
        print(f"[{tag}] generating tokens.txt from bpe.model")
        write_tokens(out_dir / "bpe.model", tokens_path)
    print(f"[{tag}] ready")


def write_tokens(bpe_model: Path, tokens_path: Path) -> None:
    """The "SYMBOL ID" table sherpa-onnx reads, from the repo's SentencePiece model.

    hynt's repos ship only `bpe.model`; through a `.part` like the weights.
    """
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor()
    sp.load(str(bpe_model))
    part = tokens_path.with_name(tokens_path.name + ".part")
    with open(part, "w", encoding="utf-8") as f:
        for token_id in range(sp.get_piece_size()):
            f.write(f"{sp.id_to_piece(token_id)} {token_id}\n")
    part.rename(tokens_path)


def fetch_parakeet_en() -> None:
    out_dir = MODELS_DIR / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
    if (out_dir / "tokens.txt").exists():
        print("[parakeet-en] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = MODELS_DIR / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
    if not tar_path.exists():
        print(f"[parakeet-en] downloading {PARAKEET_URL}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(PARAKEET_URL, timeout=60) as response, open(
            tmp, "wb"
        ) as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    print("[parakeet-en] extracting")
    with tarfile.open(tar_path, "r:bz2") as tar:
        tar.extractall(MODELS_DIR, filter="data")
    if not (out_dir / "tokens.txt").exists():
        raise RuntimeError(f"unexpected tarball layout; {out_dir} incomplete")
    tar_path.unlink()
    print("[parakeet-en] ready")


def verify_pinned(path: Path, size: int, sha256: str) -> None:
    """Raise unless `path` has exactly the pinned size and sha256.

    Size first: a truncated download fails in a stat instead of a 200MB hash.
    """
    actual_size = path.stat().st_size
    if actual_size != size:
        raise RuntimeError(f"{path.name} is {actual_size} bytes, pinned {size}")
    actual = _sha256(path)
    if actual != sha256:
        raise RuntimeError(f"{path.name} sha256 {actual} != pinned {sha256}")


def extract_members(tar_path: Path, prefix: str, members: tuple[str, ...], out_dir: Path) -> None:
    """Extract only `prefix/<member>` for each member, streamed, one at a time.

    `filter="data"` refuses links, devices and paths that leave `out_dir`, the
    same guard the Parakeet extraction uses. Each file lands through a `.part`
    and a rename, so an interrupted run never leaves a truncated model that the
    cache check would accept.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {f"{prefix}/{name}": name for name in members}
    found: set[str] = set()
    with tarfile.open(tar_path, "r|bz2") as tar:
        for member in tar:
            name = wanted.get(member.name)
            if name is None:
                continue
            member.name = name + ".part"
            tar.extract(member, out_dir, filter="data")
            (out_dir / member.name).rename(out_dir / name)
            found.add(name)
    missing = set(members) - found
    if missing:
        raise RuntimeError(f"{tar_path.name} has no {sorted(missing)}")


def fetch_pinned_release(
    tag: str, name: str, url: str, size: int, sha256: str, members: tuple[str, ...]
) -> None:
    """A k2-fsa release tarball, verified against its pin, `members` extracted.

    Verified before a single byte is extracted, cached or fresh: a tampered or
    truncated tarball is deleted and this raises, as Silero's check does.
    """
    out_dir = MODELS_DIR / name
    if all((out_dir / member).exists() for member in members):
        print(f"[{tag}] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = MODELS_DIR / f"{name}.tar.bz2"
    if not tar_path.exists():
        print(f"[{tag}] downloading {url}")
        tmp = tar_path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        tmp.rename(tar_path)
    try:
        verify_pinned(tar_path, size, sha256)
    except RuntimeError:
        tar_path.unlink()
        raise
    print(f"[{tag}] extracting")
    extract_members(tar_path, name, members, out_dir)
    tar_path.unlink()
    print(f"[{tag}] ready")


def fetch_paraformer_zh() -> None:
    fetch_pinned_release(
        "paraformer-zh",
        PARAFORMER_ZH_NAME,
        PARAFORMER_ZH_URL,
        PARAFORMER_ZH_SIZE,
        PARAFORMER_ZH_SHA256,
        PARAFORMER_ZH_MEMBERS,
    )


def fetch_ct_punct_zh() -> None:
    """The zh display restorer, which is OPTIONAL: any failure is a warning.

    Same contract as `fetch_dewpoint`: the sidecar transcribes zh without it and
    the API shows the plain transcript, so neither a download failure nor a
    read-only models mount may stop the seed or the runtime.
    """
    if not _writable(MODELS_DIR / CT_PUNCT_ZH_NAME) and not (
        MODELS_DIR / CT_PUNCT_ZH_NAME / CT_PUNCT_ZH_MEMBERS[0]
    ).exists():
        print(f"[ct-punct-zh] skipped, {MODELS_DIR} is not writable; zh display stays plain")
        return
    try:
        fetch_pinned_release(
            "ct-punct-zh",
            CT_PUNCT_ZH_NAME,
            CT_PUNCT_ZH_URL,
            CT_PUNCT_ZH_SIZE,
            CT_PUNCT_ZH_SHA256,
            CT_PUNCT_ZH_MEMBERS,
        )
    except Exception as err:  # noqa: BLE001 — see the docstring
        print(f"[ct-punct-zh] skipped, zh display stays plain: {err}")


def fetch_campplus_speaker() -> None:
    """The speaker embedding model behind POST /embed.

    One flat .onnx rather than a directory, so unlike the two above there is
    nothing to extract and the file's own presence is the cache check.
    """
    target = MODELS_DIR / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
    if target.exists():
        print("[campplus-speaker] ready (cached)")
        return
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[campplus-speaker] downloading {CAMPPLUS_URL}")
    # Downloaded to .part and renamed, so an interrupted run leaves no truncated
    # file that the existence check above would treat as cached.
    tmp = target.with_suffix(".part")
    with urllib.request.urlopen(CAMPPLUS_URL, timeout=60) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    tmp.rename(target)
    print("[campplus-speaker] ready")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_silero_vad() -> None:
    """The speech gate behind `/transcribe`'s `min_speech_ms`.

    Hash-verified before the `.part` rename AND on a cached hit: upstream
    replacing the asset under the same URL, or a partial file left by an
    interrupted run, both fail closed here instead of silently moving the
    gate's floor.
    """
    target = MODELS_DIR / "silero_vad.onnx"
    if target.exists():
        if _sha256(target) == SILERO_VAD_SHA256:
            print("[silero-vad] ready (cached)")
            return
        print("[silero-vad] cached file failed the pinned hash; refetching")
        target.unlink()
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[silero-vad] downloading {SILERO_VAD_URL}")
    tmp = target.with_suffix(".part")
    with urllib.request.urlopen(SILERO_VAD_URL, timeout=60) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    actual = _sha256(tmp)
    if actual != SILERO_VAD_SHA256:
        tmp.unlink()
        raise RuntimeError(f"silero_vad.onnx sha256 {actual} != pinned {SILERO_VAD_SHA256}")
    tmp.rename(target)
    print("[silero-vad] ready")


def _writable(path: Path) -> bool:
    """Whether `path` can be written, or created under its nearest existing parent.

    `os.access` reports a read-only mount as unwritable even for root.
    """
    while not path.exists():
        if path.parent == path:
            return False
        path = path.parent
    return os.access(path, os.W_OK)


def fetch_dewpoint() -> None:
    """The display restorer, which is OPTIONAL: any failure here is a warning.

    The sidecar transcribes without it and the API falls back to the plain
    display, so neither a Hugging Face outage nor a read-only models mount may
    keep `/transcribe` from starting — the runtime container runs this script
    before uvicorn, on the same `&&`.
    """
    try:
        _fetch_dewpoint()
    except Exception as err:  # noqa: BLE001 — see the docstring
        print(f"[dewpoint] skipped, display stays plain: {err}")


def _fetch_dewpoint() -> None:
    """The display restorer: four small files as published, one graph re-quantized.

    Only the token-embedding Gather is quantized (per channel, int8). That
    matrix is 256k rows × 768 — about two thirds of the 1.2 GB graph — and
    quantizing it alone measured identical to fp32 on the vi ruler, at half the
    resident memory. Quantizing the MatMuls as well lost "AI" on 7 of 26 calls.
    """
    out_dir = MODELS_DIR / "dewpoint-mmbert-base"
    target = out_dir / DEWPOINT_ONNX
    missing = [filename for filename in DEWPOINT_FILES if not (out_dir / filename).exists()]
    if target.exists() and not missing:
        print("[dewpoint] ready (cached)")
        return
    # Decided before anything is fetched: the runtime mounts models read-only
    # and runs this before uvicorn on every start, so a seed killed during the
    # graph step would otherwise re-download 1.2 GB and re-quantize it on each
    # restart, only to fail writing the result.
    if not _writable(out_dir):
        print(f"[dewpoint] skipped, {out_dir} is not writable; display stays plain")
        return
    for filename in missing:
        path = out_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        cached = hf_hub_download(DEWPOINT_REPO, filename, revision=DEWPOINT_REVISION)
        # Through a .part and a rename, like the graph: a run killed halfway
        # must not leave a truncated tokenizer that `load()` then trips on.
        part = path.with_name(path.name + ".part")
        shutil.copyfile(cached, part)
        part.rename(path)
    if target.exists():
        print("[dewpoint] ready (cached)")
        return
    print(f"[dewpoint] downloading {DEWPOINT_ONNX} @ {DEWPOINT_REVISION[:8]}")
    source = hf_hub_download(DEWPOINT_REPO, DEWPOINT_ONNX, revision=DEWPOINT_REVISION)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".part")
    # In a child process: the quantization is the one step here that needs
    # gigabytes, and an OOM kill is a SIGKILL no `except` sees. Out of process
    # it costs only the restorer, as the docstring of `fetch_dewpoint` promises,
    # instead of failing the whole seed and with it the deploy.
    quantizer = Path(__file__).with_name("quantize_embedding.py")
    done = subprocess.run([sys.executable, str(quantizer), source, str(tmp)], check=False)
    if done.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"quantizing {DEWPOINT_ONNX} exited with {done.returncode}")
    tmp.rename(target)
    print("[dewpoint] ready")


def main() -> int:
    for fetch in (
        fetch_zipformer_vi,
        fetch_zipformer_vi_alternate,
        fetch_parakeet_en,
        fetch_paraformer_zh,
        fetch_campplus_speaker,
        fetch_silero_vad,
        fetch_ct_punct_zh,
        fetch_dewpoint,
    ):
        fetch()
    print("[done] models cached in models/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
