"""English TTS — Kokoro-82M (Apache-2.0) via sherpa-onnx OfflineTts.

k2-fsa package kokoro-multi-lang-v1_0: model.onnx + voices.bin + tokens.txt +
espeak-ng-data + lexicons. Only the US English lexicon is wired up — the
package is multi-lingual, but this engine's language is fixed to `en` by the
registry, and sherpa-onnx refuses to load a v1.x model with no lexicon at all.

Measured on this machine over the benchmark's 30 sentences: mean 0.68s per
sentence, p95 0.86s, RTF 0.24, ~620MB peak RAM. Replaced kokoro-en-v0_19,
which was marginally slower and had a much worse tail (p95 up to 1.65s).
See docs/development-journey.md.
"""
from collections.abc import Iterator

import numpy as np

from .base import MODELS_DIR, TtsEngine, VoiceEntry, preload_onnxruntime_dll
from .clause_splitter import split_into_clauses

MODEL_DIR = MODELS_DIR / "kokoro-multi-lang-v1_0"


class KokoroEn(TtsEngine):
    lang = "en"
    #: Unseeded, and each clause is an independent `generate`, so nothing ties
    #: one clause to the lock the previous one held. Locking per clause lets a
    #: second English turn wait one clause behind this one instead of all of it.
    HOLDS_LOCK_FOR_TURN = False
    #: Kokoro speaker ids. The v1.0 package ships 53 voices ordered by voice
    #: name, which renumbered the two auditioned in v0_19: `af_sarah` moved
    #: from 3 to 9, `am_adam` from 5 to 11.
    VOICES = {"female": 9, "male": 11}
    #: The US English block, ids 0-19.
    #:
    #: sherpa-onnx exposes speakers as bare integers, so these names come from
    #: Kokoro's own published voice list rather than from the package — which
    #: would be a guess if the ordering were a guess. It is not: the package
    #: orders voices by name, and the two ids this engine had already auditioned
    #: pin that order at both ends of the block. `af_sarah` is 9 and `am_adam` is
    #: 11, which is exactly where alphabetical order puts them — ten `af_` voices
    #: (alloy…sky) then the `am_` ones. A mapping that were off by even one would
    #: have to move both anchors.
    #:
    #: **Stops at 19 because the lexicon does.** Ids 20+ are British, French,
    #: Hindi, Italian, Japanese, Portuguese and Chinese speakers, and `load` wires
    #: up `lexicon-us-en.txt` alone — they would be phonemized as American English
    #: whatever they sound like. The tail also cannot be pinned the way this block
    #: can: `num_speakers` reports 53 where the published list has 54 names, so
    #: one is missing somewhere after the US voices and every id past it shifts.
    #: The anchors sit at the head, so this block is unaffected.
    #:
    #: Labels are the voice's own name and nothing more. Which of them anyone
    #: PREFERS is still a listening question — `VOICES` above, the two defaults
    #: for callers who name no voice, remains the auditioned pair.
    CATALOG = (
        VoiceEntry(token="0", label="Alloy", gender="female"),
        VoiceEntry(token="1", label="Aoede", gender="female"),
        VoiceEntry(token="2", label="Bella", gender="female"),
        VoiceEntry(token="3", label="Heart", gender="female"),
        VoiceEntry(token="4", label="Jessica", gender="female"),
        VoiceEntry(token="5", label="Kore", gender="female"),
        VoiceEntry(token="6", label="Nicole", gender="female"),
        VoiceEntry(token="7", label="Nova", gender="female"),
        VoiceEntry(token="8", label="River", gender="female"),
        VoiceEntry(token="9", label="Sarah", gender="female"),
        VoiceEntry(token="10", label="Sky", gender="female"),
        VoiceEntry(token="11", label="Adam", gender="male"),
        VoiceEntry(token="12", label="Echo", gender="male"),
        VoiceEntry(token="13", label="Eric", gender="male"),
        VoiceEntry(token="14", label="Fenrir", gender="male"),
        VoiceEntry(token="15", label="Liam", gender="male"),
        VoiceEntry(token="16", label="Michael", gender="male"),
        VoiceEntry(token="17", label="Onyx", gender="male"),
        VoiceEntry(token="18", label="Puck", gender="male"),
        VoiceEntry(token="19", label="Santa", gender="male"),
    )

    def _voice_token(self, entry: VoiceEntry) -> int:
        # sherpa-onnx addresses speakers by integer id. The catalog carries every
        # token as a string because that is what crosses the wire; the conversion
        # belongs here, where the runtime's own vocabulary is known.
        return int(entry.token)

    def load(self) -> None:
        preload_onnxruntime_dll()
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(MODEL_DIR / "model.onnx"),
                    voices=str(MODEL_DIR / "voices.bin"),
                    tokens=str(MODEL_DIR / "tokens.txt"),
                    lexicon=str(MODEL_DIR / "lexicon-us-en.txt"),
                    data_dir=str(MODEL_DIR / "espeak-ng-data"),
                ),
                num_threads=self._threads,
                provider="cpu",
            ),
        )
        # validate() returns False rather than raising on a bad path; skipping
        # this check turns a missing file into an obscure crash much later.
        if not config.validate():
            raise RuntimeError(
                f"invalid Kokoro config — check the model files in {MODEL_DIR}"
            )
        self._engine = sherpa_onnx.OfflineTts(config)

    @property
    def sample_rate(self) -> int:
        return self._engine.sample_rate

    def _infer(self, text: str, voice: int | str, speed: float) -> tuple[np.ndarray, int]:
        audio = self._engine.generate(text, sid=int(voice), speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), audio.sample_rate

    def _infer_stream(
        self, text: str, voice: int | str, speed: float
    ) -> Iterator[np.ndarray]:
        """One chunk per clause, each synthesized whole and in order.

        sherpa-onnx's `OfflineTts` only produces audio at sentence boundaries —
        its streaming callback fired once for a one-sentence turn, at the same
        moment the call returned (re-measured on 1.13.4). Cutting at clauses in
        front of it is what moves this engine's first audio, exactly as the API's
        clause loop did before the turn was handed over whole.

        No callback is passed. Every clause ends at the latest at a sentence
        terminator, so the callback would fire once per clause anyway — and its
        return value is inverted against its own docstring on 1.13.4 (returning
        0 STOPS generation), which is a truncation bug waiting for whoever relies
        on the documentation.

        Sequential by construction: one `generate` finishes before the next
        starts, so a single `OfflineTts` is never driven from two places.
        """
        for clause in split_into_clauses(text):
            audio = self._engine.generate(clause, sid=int(voice), speed=speed)
            yield np.asarray(audio.samples, dtype=np.float32)
