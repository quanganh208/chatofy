"""Cloud baseline — ElevenLabs Scribe v2 REST, same request shape as the app's
`ElevenLabsSttProvider` (multipart file + model_id + language_code).

Timing here is wall latency including network — the report labels it as such
instead of RTF. WER is fully comparable with the local engines.
"""

import os
from pathlib import Path

import requests

from .base import SttEngine

STT_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"


class ElevenLabsCloudEngine(SttEngine):
    is_cloud = True

    def __init__(self, lang: str) -> None:
        self.lang = lang
        self.engine_id = f"elevenlabs-{lang}"
        self._api_key: str | None = None

    def load(self) -> None:
        self._api_key = os.environ.get("ELEVENLABS_API_KEY")
        if not self._api_key:
            raise RuntimeError(
                "ELEVENLABS_API_KEY not set — cloud baseline unavailable; "
                "run local engines only and mark the cloud column pending"
            )

    def transcribe(self, wav_path: Path) -> str:
        with open(wav_path, "rb") as audio_file:
            response = requests.post(
                STT_ENDPOINT,
                headers={"xi-api-key": self._api_key},
                data={"model_id": MODEL_ID, "language_code": self.lang},
                files={"file": (wav_path.name, audio_file, "audio/wav")},
                timeout=60,
            )
        response.raise_for_status()
        payload = response.json()
        text = payload.get("text")
        if not isinstance(text, str):
            raise RuntimeError(f"unexpected Scribe response: {str(payload)[:200]}")
        return text

    def decode_params(self) -> dict:
        return {"model": MODEL_ID, "endpoint": STT_ENDPOINT, "language_code": self.lang}
