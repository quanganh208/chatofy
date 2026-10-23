"""Choosing the operating thresholds without scoring on the turns they were chosen on.

Two independent choices, in this order:

1. `(source_prior_logodds, tau_uncertain)` -- how hard to lean on the source
   and when to stop trusting the model. Chosen to maximise final accuracy over
   every pair-mode trial.
2. `(tau_lock, lock_min_speech_ms)` -- when a partial's language freezes.
   Chosen as the EARLIEST label (smallest p95 first-language time; a turn
   that never locks shows it with its final) whose on-screen change rate stays within
   `CHANGE_BUDGET`, a margin under A6's 10% so the held-out number has room;
   if no setting fits, the one that changes least. The margin is wide because
   the tuning pool and the scored set differ: the lock is tuned on every
   pair-mode trial, public corpora included, while A6 is scored per pair on
   the real tier alone. At 0.08 Whisper's tuned lock changed 0.117 of en-vi
   turns held out.

Both are chosen on all groups but one and scored on the one held out
(leave-one-group-out over `Turn.group`), and the held-out trials of every fold
are pooled into the reported numbers. The thresholds written to gate.json are
the ones chosen on everything, i.e. what would ship.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from lid_bench.prior import Params
from lid_bench.runtime_policy import LockParams
from lid_bench.scoring import Episode, PrefixFn, ProbsFn, Trial, run_trials

PRIOR_GRID = tuple((b, u) for b in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0) for u in (0.0, 0.6, 0.7, 0.8, 0.9))
LOCK_GRID = tuple((t, ms) for t in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98) for ms in (0, 300, 600, 900, 1500))
CHANGE_BUDGET = 0.05


def _pair_accuracy(trials: list[Trial]) -> float:
    rows = [t.correct for t in trials if t.mode == "pair"]
    return float(np.mean(rows)) if rows else 0.0


def _lock_cost(trials: list[Trial]) -> tuple[float, float]:
    rows = [t for t in trials if t.mode == "pair" and t.outcome is not None]
    if not rows:
        return 0.0, 0.0
    # When the label first appears: the lock, or the final for a turn that never locks.
    times = [t.outcome.first_language_ms for t in rows if t.outcome.first_language_ms is not None]
    return float(np.percentile(times, 95)), float(np.mean([t.outcome.changed for t in rows]))


def choose(eps: list[Episode], probs: ProbsFn, prefixes: PrefixFn | None, voice_prior: bool,
           voices: dict | None, tune_prior: bool = True) -> tuple[Params, LockParams | None]:
    base = Params(voice_prior=voice_prior)
    if tune_prior:
        scored = []
        for b, u in PRIOR_GRID:
            params = replace(base, source_prior_logodds=b, tau_uncertain=u)
            scored.append((_pair_accuracy(run_trials(eps, probs, None, params, None, voices)), -b, -u, params))
        # Ties go to the weaker prior and the lower uncertainty bar: the
        # simpler setting, when the data cannot tell them apart.
        params = max(scored, key=lambda s: s[:3])[3]
    else:
        params = base
    if prefixes is None:
        return params, None
    fits, fallback = [], []
    for tau, min_ms in LOCK_GRID:
        lock = LockParams(tau_lock=tau, lock_min_speech_ms=min_ms)
        p95, changed = _lock_cost(run_trials(eps, probs, prefixes, params, lock, voices))
        (fits if changed <= CHANGE_BUDGET else fallback).append((p95, changed, tau, min_ms, lock))
    best = min(fits)[4] if fits else min(fallback, key=lambda s: (s[1], s[0]))[4]
    return params, best


def episode_group(ep: Episode) -> str:
    """A stitched session mixes corpora (VietMed + EdAcc); holding out one of
    them must hold out the whole session, so its group is the set of all."""
    return "+".join(sorted({t.group for t in ep.turns}))


def held_out(eps: list[Episode], probs: ProbsFn, prefixes: PrefixFn | None, voice_prior: bool,
             voices: dict | None, tune_prior: bool = True) -> tuple[list[Trial], str]:
    """Pooled held-out trials, and the scheme used ("logo" or "in-sample" when
    there is only one group to hold out)."""
    groups = sorted({episode_group(ep) for ep in eps})
    if len(groups) < 2:
        params, lock = choose(eps, probs, prefixes, voice_prior, voices, tune_prior)
        return run_trials(eps, probs, prefixes, params, lock, voices), "in-sample"
    pooled: list[Trial] = []
    for group in groups:
        train = [ep for ep in eps if episode_group(ep) != group]
        test = [ep for ep in eps if episode_group(ep) == group]
        params, lock = choose(train, probs, prefixes, voice_prior, voices, tune_prior)
        pooled += run_trials(test, probs, prefixes, params, lock, voices)
    return pooled, "logo"
