"""The seed: Paraformer-zh pinned before extraction and extracting only what it
serves, and the optional alternate vi recognizer fetched at its pinned revision.

No network and no model weights: every tarball and every "download" here is
built in the test.
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


# ── Alternate vi recognizer ──────────────────────────────────────────────────


def _pin_of(data: bytes) -> tuple[int, str]:
    return len(data), hashlib.sha256(data).hexdigest()


def _fake_hub(monkeypatch, tmp_path, calls: list):
    """`hf_hub_download` answered from files written in the test, args recorded."""
    cache = tmp_path / "hub"
    cache.mkdir()

    def download(repo, filename, revision=None):
        calls.append((repo, filename, revision))
        path = cache / filename
        path.write_bytes(f"{repo}/{filename}".encode())
        return str(path)

    monkeypatch.setattr(seed, "hf_hub_download", download)
    # Pinned to what this fake hub serves, so the pin check runs for real.
    monkeypatch.setattr(
        seed,
        "ZIPFORMER_ALT_PINS",
        {name: _pin_of(f"{seed.ZIPFORMER_ALT_REPO}/{name}".encode()) for name in seed.ZIPFORMER_ALT_FILES},
    )
    # A real bpe.model is the one thing the test cannot build; the table is
    # sentencepiece's job, and only that it is written matters here.
    monkeypatch.setattr(seed, "write_tokens", lambda _bpe, path: path.write_text("<blk> 0\n"))


def test_alternate_fetches_every_file_at_the_pinned_revision(tmp_path, monkeypatch):
    models_dir = tmp_path / "models"
    monkeypatch.setattr(seed, "MODELS_DIR", models_dir)
    calls: list = []
    _fake_hub(monkeypatch, tmp_path, calls)

    seed.fetch_zipformer_vi_alternate()

    out_dir = models_dir / seed.ZIPFORMER_ALT_DIR
    assert sorted(p.name for p in out_dir.iterdir()) == sorted(
        [*seed.ZIPFORMER_ALT_FILES, "tokens.txt"]
    )
    assert calls == [
        (seed.ZIPFORMER_ALT_REPO, name, seed.ZIPFORMER_ALT_REVISION)
        for name in seed.ZIPFORMER_ALT_FILES
    ]


def test_alternate_second_run_is_a_no_op(tmp_path, monkeypatch):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path / "models")
    calls: list = []
    _fake_hub(monkeypatch, tmp_path, calls)
    seed.fetch_zipformer_vi_alternate()
    calls.clear()

    seed.fetch_zipformer_vi_alternate()

    assert calls == []


def test_the_alternate_pins_cover_every_file():
    assert seed.ZIPFORMER_ALT_FILES == list(seed.ZIPFORMER_ALT_PINS)
    for size, sha256 in seed.ZIPFORMER_ALT_PINS.values():
        assert size > 0
        assert len(sha256) == 64 and int(sha256, 16) >= 0


@pytest.mark.parametrize("pin", ["sha256", "size"])
def test_a_tampered_alternate_file_never_lands(tmp_path, monkeypatch, capsys, pin):
    models_dir = tmp_path / "models"
    monkeypatch.setattr(seed, "MODELS_DIR", models_dir)
    _fake_hub(monkeypatch, tmp_path, [])
    encoder = seed.ZIPFORMER_ALT_FILES[0]
    size, sha256 = seed.ZIPFORMER_ALT_PINS[encoder]
    tampered = (size, "0" * 64) if pin == "sha256" else (size + 1, sha256)
    monkeypatch.setitem(seed.ZIPFORMER_ALT_PINS, encoder, tampered)

    seed.fetch_zipformer_vi_alternate()

    # Neither the file nor its `.part` remains, and the half-fetched model is
    # not completed into something the sidecar would load.
    out_dir = models_dir / seed.ZIPFORMER_ALT_DIR
    assert list(out_dir.iterdir()) == []
    assert "skipped, no vi alternates" in capsys.readouterr().out


def test_alternate_download_failure_does_not_stop_the_seed(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path / "models")

    def offline(*_args, **_kwargs):
        raise OSError("hub unreachable")

    monkeypatch.setattr(seed, "hf_hub_download", offline)

    seed.fetch_zipformer_vi_alternate()

    assert "skipped, no vi alternates" in capsys.readouterr().out


def test_alternate_skips_a_read_only_models_mount(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setattr(seed, "_writable", lambda _path: False)

    def no_network(*_args, **_kwargs):
        raise AssertionError("a read-only mount must not be fetched into")

    monkeypatch.setattr(seed, "hf_hub_download", no_network)

    seed.fetch_zipformer_vi_alternate()

    assert "not writable" in capsys.readouterr().out


# ── Language identifier ──────────────────────────────────────────────────────


def _fake_lid_hub(monkeypatch, tmp_path, calls: list) -> None:
    def download(repo, filename, revision=None):
        calls.append((repo, filename, revision))
        path = tmp_path / "hub" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"{repo}/{filename}".encode())
        return str(path)

    monkeypatch.setattr(seed, "hf_hub_download", download)
    monkeypatch.setattr(
        seed,
        "WHISPER_LID_PINS",
        {name: _pin_of(f"{seed.WHISPER_LID_REPO}/{name}".encode()) for name in seed.WHISPER_LID_PINS},
    )


def test_lid_off_fetches_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setenv("LOCAL_STT_LID", "off")

    def no_network(*_args, **_kwargs):
        raise AssertionError("identification is off; nothing may be fetched")

    monkeypatch.setattr(seed, "hf_hub_download", no_network)

    seed.fetch_whisper_lid()

    assert "skipped, LOCAL_STT_LID is off" in capsys.readouterr().out
    assert not (tmp_path / "models").exists()


def test_lid_fetches_every_file_at_the_pinned_revision(tmp_path, monkeypatch):
    models_dir = tmp_path / "models"
    monkeypatch.setattr(seed, "MODELS_DIR", models_dir)
    monkeypatch.setenv("LOCAL_STT_LID", "on")
    calls: list = []
    _fake_lid_hub(monkeypatch, tmp_path, calls)

    seed.fetch_whisper_lid()
    seed.fetch_whisper_lid()

    assert calls == [
        (seed.WHISPER_LID_REPO, name, seed.WHISPER_LID_REVISION) for name in seed.WHISPER_LID_PINS
    ]
    assert all((models_dir / seed.WHISPER_LID_DIR / name).exists() for name in seed.WHISPER_LID_PINS)


def test_a_tampered_lid_file_never_lands(tmp_path, monkeypatch, capsys):
    models_dir = tmp_path / "models"
    monkeypatch.setattr(seed, "MODELS_DIR", models_dir)
    monkeypatch.setenv("LOCAL_STT_LID", "on")
    _fake_lid_hub(monkeypatch, tmp_path, [])
    encoder = next(iter(seed.WHISPER_LID_PINS))
    monkeypatch.setitem(seed.WHISPER_LID_PINS, encoder, (seed.WHISPER_LID_PINS[encoder][0], "0" * 64))

    seed.fetch_whisper_lid()

    assert not (models_dir / seed.WHISPER_LID_DIR / encoder).exists()
    assert not (models_dir / seed.WHISPER_LID_DIR / f"{encoder}.part").exists()
    assert "skipped, candidates will be refused" in capsys.readouterr().out


def test_lid_download_failure_does_not_stop_the_seed(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(seed, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setenv("LOCAL_STT_LID", "on")

    def offline(*_args, **_kwargs):
        raise OSError("hub unreachable")

    monkeypatch.setattr(seed, "hf_hub_download", offline)

    seed.fetch_whisper_lid()

    assert "skipped, candidates will be refused" in capsys.readouterr().out


def test_lid_seed_and_loader_agree_on_the_files(monkeypatch):
    from lid import decider, model_decider

    assert seed.WHISPER_LID_DIR == model_decider.MODEL_DIR.name
    assert set(seed.WHISPER_LID_PINS) == set(model_decider.FILES)
    for value in ("on", "off", "0", "false", "OFF ", "no", "yes"):
        monkeypatch.setenv("LOCAL_STT_LID", value)
        assert seed.lid_enabled() == decider.lid_enabled(), value
