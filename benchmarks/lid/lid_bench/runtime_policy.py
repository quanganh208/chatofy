"""What a live turn would have SHOWN, replayed from per-prefix probabilities.

The gate scores finals, but users read partials. The API (Phase 3) decides a
turn's language in three steps, and this module replays exactly those steps
over the prefixes an arm scored at the partial cadence:

1. **Held**: partials show their text but no language until the lock. Showing
   each partial's guess was measured to flip the label on ~38% of
   conversational turns at every lock setting; holding it trades that for a
   later first label.
2. **Locked**: the first prefix where the guess is confident (max probability
   after the source prior >= `tau_lock`) AND carries enough speech
   (>= `lock_min_speech_ms`) shows the language and freezes it for the rest of
   the partials and for live translation.
3. **Final**: re-decided on the whole turn, always -- it may overrule the lock,
   which is the only way the label can change (A6). A turn that never locks
   shows its language with the final.

Times are from the start of the turn's audio, which is at or before the start
of speech, so `first_language_ms` overstates A6's "from speech start" latency
rather than flattering it.
"""

from __future__ import annotations

from dataclasses import dataclass

from lid_bench.prior import argmax, with_source_prior


@dataclass(frozen=True)
class Prefix:
    ms: int
    speech_ms: int
    probs: dict[str, float]
    latency_ms: float = 0.0


@dataclass(frozen=True)
class LockParams:
    tau_lock: float
    lock_min_speech_ms: int


@dataclass(frozen=True)
class Outcome:
    first_language_ms: float | None
    lock_ms: float | None
    locked: str | None
    final: str
    #: The language on screen changed: the final overruled the lock.
    changed: bool
    #: False for a turn shorter than every prefix: it shows only its final, so
    #: it can neither change nor count in A6's change-rate denominator.
    had_partials: bool = True

    @property
    def final_overruled_lock(self) -> bool:
        return self.locked is not None and self.final != self.locked


def replay(
    prefixes: list[Prefix],
    final: str,
    source: str,
    source_prior_logodds: float,
    params: LockParams,
    final_ms: float | None = None,
) -> Outcome:
    """Replay one turn. `prefixes` in any order; `final` from the session decision.

    `final_ms` is when the final appears; a turn with no partial shows its
    first language then, so leaving it out would bias A6's p95 low."""
    prefixes = sorted(prefixes, key=lambda p: p.ms)
    locked: str | None = None
    lock_ms: float | None = None
    for prefix in prefixes:
        biased = with_source_prior(prefix.probs, source, source_prior_logodds)
        guess = argmax(biased)
        if biased[guess] >= params.tau_lock and prefix.speech_ms >= params.lock_min_speech_ms:
            locked, lock_ms = guess, prefix.ms + prefix.latency_ms
            break
    first = lock_ms if locked is not None else final_ms
    return Outcome(first_language_ms=first, lock_ms=lock_ms, locked=locked, final=final,
                   changed=locked is not None and final != locked, had_partials=bool(prefixes))
