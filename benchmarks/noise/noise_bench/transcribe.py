"""Transcribe a WAV through the real STT sidecar.

Deliberately the sidecar and not stt-bench's in-process engines: the app
transcribes over this exact HTTP path, so a WER measured here is the WER the app
would see, decoder settings and all. It is the same `POST /transcribe` the
NestJS API calls — multipart `file` plus a `language` field, `{ "text": ... }`
back.
"""

from __future__ import annotations

from pathlib import Path

import requests

DEFAULT_STT_URL = "http://127.0.0.1:8002"


class TranscribeError(RuntimeError):
    """The sidecar refused or could not be reached — carries the status for the
    caller to decide whether the whole run is unusable or just one utterance."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def transcribe_wav(
    wav_path: Path,
    language: str,
    base_url: str = DEFAULT_STT_URL,
    timeout_s: float = 30.0,
) -> str:
    """One 16 kHz mono WAV in, its transcript out.

    Raises `TranscribeError` rather than returning an empty string on failure: an
    empty transcript is a legitimate result (silence, or noise that swamped the
    speech) and scoring it as WER 1.0 is correct, whereas a 503 from a sidecar
    still loading its models is not a data point and must not be averaged in as
    one.
    """
    try:
        with wav_path.open("rb") as handle:
            response = requests.post(
                f"{base_url}/transcribe",
                files={"file": (wav_path.name, handle, "audio/wav")},
                data={"language": language},
                timeout=timeout_s,
            )
    except requests.RequestException as err:
        raise TranscribeError(f"no reply from {base_url}: {err}") from err

    if response.status_code != 200:
        raise TranscribeError(
            f"{base_url} returned {response.status_code}: {response.text[:200]}",
            status=response.status_code,
        )
    return str(response.json().get("text", ""))


def sidecar_ready(base_url: str = DEFAULT_STT_URL, timeout_s: float = 5.0) -> bool:
    """Whether the sidecar answers /healthz — checked once before a run rather
    than discovering it utterance by utterance."""
    try:
        response = requests.get(f"{base_url}/healthz", timeout=timeout_s)
        return response.status_code == 200
    except requests.RequestException:
        return False
