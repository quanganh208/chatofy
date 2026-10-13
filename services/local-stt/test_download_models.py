"""The Paraformer-zh seed: pinned before extraction, extracts only what it serves.

No network and no model weights: every tarball here is built in the test.
"""
import hashlib
import io
import tarfile
from pathlib import Path

import pytest

import scripts.download_models as seed


def _tarball(path: Path, prefix: str, files: dict[str, bytes]) -> Path:
    with tarfile.open(path, "w:bz2") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(f"{prefix}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return path


def _pin(monkeypatch, path: Path) -> None:
    monkeypatch.setattr(seed, "PARAFORMER_ZH_SIZE", path.stat().st_size)
    monkeypatch.setattr(
        seed, "PARAFORMER_ZH_SHA256", hashlib.sha256(path.read_bytes()).hexdigest()
    )


@pytest.fixture
def models_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path)
    return tmp_path


def _release(models_dir: Path) -> Path:
    return _tarball(
        models_dir / f"{seed.PARAFORMER_ZH_NAME}.tar.bz2",
        seed.PARAFORMER_ZH_NAME,
        {
            "model.int8.onnx": b"weights",
            "tokens.txt": b"tokens",
            "test_wavs/0.wav": b"riff",
            "README.md": b"readme",
        },
    )


def test_extracts_only_the_model_and_its_tokens(models_dir, monkeypatch):
    _pin(monkeypatch, _release(models_dir))

    seed.fetch_paraformer_zh()

    out_dir = models_dir / seed.PARAFORMER_ZH_NAME
    assert sorted(p.name for p in out_dir.iterdir()) == ["model.int8.onnx", "tokens.txt"]
    assert (out_dir / "model.int8.onnx").read_bytes() == b"weights"
    # The tarball is not kept beside the weights.
    assert not (models_dir / f"{seed.PARAFORMER_ZH_NAME}.tar.bz2").exists()


def test_a_second_run_is_a_no_op(models_dir, monkeypatch):
    _pin(monkeypatch, _release(models_dir))
    seed.fetch_paraformer_zh()

    def no_network(*_args, **_kwargs):
        raise AssertionError("a cached model must not be fetched again")

    monkeypatch.setattr(seed.urllib.request, "urlopen", no_network)
    seed.fetch_paraformer_zh()


def test_a_tampered_tarball_fails_before_extraction(models_dir, monkeypatch):
    tar_path = _release(models_dir)
    _pin(monkeypatch, tar_path)
    # Same size, different bytes: only the hash can catch it.
    data = bytearray(tar_path.read_bytes())
    data[-1] ^= 0xFF
    tar_path.write_bytes(bytes(data))

    with pytest.raises(RuntimeError, match="sha256"):
        seed.fetch_paraformer_zh()
    assert not (models_dir / seed.PARAFORMER_ZH_NAME).exists()
    # Deleted, so the next seed downloads afresh instead of failing forever.
    assert not tar_path.exists()


def test_a_truncated_tarball_fails_on_size(models_dir, monkeypatch):
    tar_path = _release(models_dir)
    _pin(monkeypatch, tar_path)
    tar_path.write_bytes(tar_path.read_bytes()[:-10])

    with pytest.raises(RuntimeError, match="bytes"):
        seed.fetch_paraformer_zh()


def test_a_tarball_missing_a_member_fails(tmp_path):
    tar_path = _tarball(tmp_path / "t.tar.bz2", "release", {"model.int8.onnx": b"w"})
    with pytest.raises(RuntimeError, match="tokens.txt"):
        seed.extract_members(tar_path, "release", ("model.int8.onnx", "tokens.txt"), tmp_path / "out")
