"""Turning per-turn probabilities into the language a session would act on.

An arm answers one turn at a time; the API decides inside a session. Three
things live here because they need the session, not the turn:

**Source prior.** The user picked a source language, and a two-way session is
most likely to open in it. Until there is evidence the other side has started
talking -- a second voice, or one turn confidently in the other language -- the
source gets a log-odds bonus. After that the bonus is gone for good: a
conversation that has shown both sides is symmetric.

**Voice prior** (optional; only built when it measurably helps, see
`gate.json.prior_used`). A voice that has spoken confidently in one language is
likely to keep doing so. Grouped by the speaker label the CLIENT shows, which is
simulated here with the client's own online clusterer constants
(`packages/realtime-client/src/state/auto-attribution.ts`), never by the
human label: production never has the human label.

**Fallback chain** for an uncertain turn (max probability below
`tau_uncertain` after the source prior): the voice's language if the voice
prior is on and the voice has history, else the previous turn's language
(predecessor in the order turns were OPENED), else the source.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

#: Client attribution constants. `DEFAULT_AUTO_ATTRIBUTION` in auto-attribution.ts.
TAU_ASSIGN = 0.5
TAU_NEW = 0.45
K_MAX = 2
MINT_CONFIRMATIONS = 2


@dataclass(frozen=True)
class Params:
    source_prior_logodds: float = 0.0
    tau_uncertain: float = 0.0
    #: Confidence (max probability, no prior) at which a turn counts as evidence
    #: the other side is talking, which lifts the source prior. Shared with the
    #: lock threshold: a turn confident enough to lock a partial on is
    #: confident enough to believe.
    tau_confident: float = 0.9
    voice_prior: bool = False


@dataclass(frozen=True)
class Decision:
    raw: str
    final: str
    uncertain: bool
    via: str  # "model" | "voice" | "previous" | "source"
    #: The source-prior log-odds this turn was decided with: the configured
    #: bonus while the prior is live, 0 once the session has shown both sides.
    #: Partials of the same turn are replayed with this, not the configured one.
    bonus: float = 0.0


def with_source_prior(probs: dict[str, float], source: str, logodds: float) -> dict[str, float]:
    """Add `logodds` to the source's log-probability and renormalise."""
    if logodds == 0.0 or source not in probs:
        return dict(probs)
    logits = {lang: math.log(max(p, 1e-12)) for lang, p in probs.items()}
    logits[source] += logodds
    peak = max(logits.values())
    exp = {lang: math.exp(v - peak) for lang, v in logits.items()}
    total = sum(exp.values())
    return {lang: v / total for lang, v in exp.items()}


def argmax(probs: dict[str, float]) -> str:
    # Sorted first so a tie resolves the same way on every run.
    return max(sorted(probs), key=lambda lang: probs[lang])


def decide_session(
    turn_probs: list[dict[str, float]],
    source: str | None,
    params: Params,
    voices: list[int | None] | None = None,
) -> list[Decision]:
    """Decide every turn of one session, in opening order.

    `turn_probs[i]` is the arm's distribution over the CANDIDATE languages for
    turn i (two for a pair, three for detect). `voices[i]` is the client's
    speaker label for turn i, or None when it has none yet.
    """
    decisions: list[Decision] = []
    prior_live = True
    seen_voices: set[int] = set()
    memory: dict[int, Counter] = {}
    for index, probs in enumerate(turn_probs):
        voice = voices[index] if voices is not None else None
        if voice is not None:
            seen_voices.add(voice)
            if len(seen_voices) > 1:
                prior_live = False
        raw = argmax(probs)
        bonus = params.source_prior_logodds if (prior_live and source is not None) else 0.0
        biased = with_source_prior(probs, source, bonus)
        top = argmax(biased)
        uncertain = biased[top] < params.tau_uncertain
        if not uncertain:
            final, via = top, "model"
        elif params.voice_prior and voice is not None and memory.get(voice):
            final, via = memory[voice].most_common(1)[0][0], "voice"
        elif decisions:
            final, via = decisions[-1].final, "previous"
        elif source is not None:
            final, via = source, "source"
        else:
            # Detect has no source to fall back on; the model's guess stands.
            final, via = top, "model"
        decisions.append(Decision(raw=raw, final=final, uncertain=uncertain, via=via, bonus=bonus))
        confident = probs[raw] >= params.tau_confident
        if confident and raw != source:
            prior_live = False
        if confident and voice is not None:
            memory.setdefault(voice, Counter())[raw] += 1
    return decisions


@dataclass(eq=False)  # identity equality: list.remove must not compare arrays
class _Voice:
    total: np.ndarray
    turns: int = 1

    @property
    def centroid(self) -> np.ndarray:
        return self.total / max(float(np.linalg.norm(self.total)), 1e-12)


@dataclass
class ClientVoiceLabels:
    """The client's online speaker labels, from CAM++ turn embeddings.

    Same shape as auto-attribution.ts: assign above TAU_ASSIGN, a new voice
    below TAU_NEW (provisional until MINT_CONFIRMATIONS turns agree), at most
    K_MAX voices, undecided in between. A port of the decision, not of the UI.
    """

    voices: list[_Voice] = field(default_factory=list)
    provisional: list[_Voice] = field(default_factory=list)

    def label(self, embedding: np.ndarray) -> int | None:
        vector = embedding / max(float(np.linalg.norm(embedding)), 1e-12)
        scores = [float(vector @ v.centroid) for v in self.voices]
        best = int(np.argmax(scores)) if scores else -1
        if scores and scores[best] >= TAU_ASSIGN:
            self.voices[best].total = self.voices[best].total + vector
            self.voices[best].turns += 1
            return best
        if scores and scores[best] > TAU_NEW:
            return None
        if len(self.voices) >= K_MAX:
            return best if scores else None
        for candidate in self.provisional:
            if float(vector @ candidate.centroid) >= TAU_ASSIGN:
                candidate.total = candidate.total + vector
                candidate.turns += 1
                if candidate.turns >= MINT_CONFIRMATIONS:
                    self.provisional.remove(candidate)
                    self.voices.append(candidate)
                    return len(self.voices) - 1
                return None
        self.provisional.append(_Voice(total=vector.copy()))
        if MINT_CONFIRMATIONS <= 1:
            self.voices.append(self.provisional.pop())
            return len(self.voices) - 1
        return None
