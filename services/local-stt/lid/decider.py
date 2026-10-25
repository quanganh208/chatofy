"""Which of a turn's candidate languages it is in.

The sidecar answers one question per turn: which candidate is this, and how
sure. Priors (the declared source, the previous turn, the speaker's voice) need
the conversation and live in the API; here there is only the audio.
"""
import os
from dataclasses import dataclass

import numpy as np

from lid.model_decider import LANGUAGES, WhisperLanguageId

#: Languages `candidates` may name, as `/healthz` reports them when loaded.
IDENTIFIABLE = LANGUAGES


@dataclass(frozen=True)
class LanguageDecision:
    language: str
    #: The chosen candidate's probability among the candidates.
    confidence: float


def lid_enabled() -> bool:
    """`LOCAL_STT_LID`: on in development, off in production until it is enabled there.

    Off means the weights are neither fetched nor loaded, and a request naming
    candidates is refused (409) rather than silently decoded as declared.
    """
    return os.environ.get("LOCAL_STT_LID", "on").strip().lower() not in {"off", "0", "false", "no"}


def decide_language(model: WhisperLanguageId, samples: np.ndarray, candidates: list[str]) -> LanguageDecision:
    """The most probable candidate. Raises `SttBusyError` when the model has no free lane."""
    scores = model.probabilities(samples, candidates)
    language = max(candidates, key=scores.__getitem__)
    return LanguageDecision(language, scores[language])
