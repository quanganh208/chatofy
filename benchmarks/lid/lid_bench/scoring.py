"""From an arm's per-turn probabilities to the plan's criteria A1-A9.

The unit is a TRIAL: one turn, decided in one mode (a pair, or detect's
triple), with one declared source, inside the session it was spoken in. A turn
is tried in every pair that contains its language and, unless its session
declared a source, with each of the pair's two languages as source -- the
source prior favours one side, so scoring only one orientation would score
only the easy side.

Which turns count for which criterion is the table in phase-00 step 4, encoded
in `CRITERIA`. A criterion whose data is missing is reported `insufficient`
rather than passed or failed; with `substitute_public=True` public read speech
stands in for missing real speech and the row says so (`data:
"public-substitute"`), which makes the number a preliminary signal and never a
gate result.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from itertools import combinations

import numpy as np

from lid_bench.manifest import LANGUAGES, Turn
from lid_bench.prior import Decision, Params, decide_session
from lid_bench.runtime_policy import LockParams, Outcome, Prefix, replay

PAIRS = tuple(tuple(sorted(p)) for p in combinations(LANGUAGES, 2))
TRIPLE = tuple(sorted(LANGUAGES))
LONG = ("1.5-3", "3-8")

#: The API's speech floor (`STT_MIN_SPEECH_MS`, apps/api turn-tuning.ts): a turn
#: whose Silero speech is below it is never decoded.
STT_MIN_SPEECH_MS = 300
#: The client's pre-roll: a turn's audio starts this long before its speech.
PRE_ROLL_MS = 320
#: A6: with the label held until the lock, when it must be on screen (p95).
#: The 1000 ms bar of a label shown on every partial is unreachable together
#: with <= 10% changes for any arm measured; the user moved it on 2026-10-21.
FIRST_LANGUAGE_P95_MS = 3500

ProbsFn = Callable[[str, tuple[str, ...]], dict[str, float]]
PrefixFn = Callable[[str, tuple[str, ...]], list[Prefix]]


@dataclass(frozen=True)
class Trial:
    turn: Turn
    candidates: tuple[str, ...]
    source: str | None
    decision: Decision
    outcome: Outcome | None

    @property
    def mode(self) -> str:
        return "detect" if len(self.candidates) == 3 else "pair"

    @property
    def correct(self) -> bool:
        return self.decision.final == self.turn.lang

    @property
    def raw_correct(self) -> bool:
        return self.decision.raw == self.turn.lang


@dataclass(frozen=True)
class Episode:
    turns: tuple[Turn, ...]
    candidates: tuple[str, ...]
    source: str | None


def episodes(turns: list[Turn]) -> list[Episode]:
    """Every (session, mode, source) a set of speech turns is decided in."""
    sessions: dict[str, list[Turn]] = {}
    for turn in turns:
        if turn.noise:
            continue
        key = turn.session if turn.session is not None else f"single:{turn.id}"
        sessions.setdefault(key, []).append(turn)
    out: list[Episode] = []
    for members in sessions.values():
        members.sort(key=lambda t: t.order or 0)
        langs = {t.lang for t in members}
        declared = members[0].declared_source
        pairs = [p for p in PAIRS if langs <= set(p)] if len(langs) <= 2 else []
        for pair in pairs:
            sources = [declared] if declared in pair else list(pair)
            out += [Episode(tuple(members), pair, source) for source in sources]
        out.append(Episode(tuple(members), TRIPLE, None))
    return out


def run_trials(eps: list[Episode], probs: ProbsFn, prefixes: PrefixFn | None,
               params: Params, lock: LockParams | None,
               voices: dict[str, int | None] | None = None) -> list[Trial]:
    trials: list[Trial] = []
    for ep in eps:
        dists = [probs(t.id, ep.candidates) for t in ep.turns]
        labels = [voices.get(t.id) for t in ep.turns] if voices else None
        decisions = decide_session(dists, ep.source, params, labels)
        for turn, decision in zip(ep.turns, decisions):
            outcome = None
            if prefixes is not None and lock is not None:
                # The turn's partials see the prior the turn itself was decided
                # with: once the session has shown both sides it is gone for
                # the partials too, as it would be in the API.
                outcome = replay(prefixes(turn.id, ep.candidates), decision.final, ep.source, decision.bonus,
                                 lock, final_ms=turn.speech_ms + PRE_ROLL_MS)
            trials.append(Trial(turn, ep.candidates, ep.source, decision, outcome))
    return trials


# --- criteria ---------------------------------------------------------------

@dataclass(frozen=True)
class Result:
    name: str
    value: float | None
    threshold: str
    passed: bool | None
    n: int
    data: str

    def as_dict(self) -> dict:
        return {"value": None if self.value is None else round(self.value, 4), "threshold": self.threshold,
                "pass": self.passed, "n": self.n, "data": self.data}


def _real_or_public(trials: list[Trial], want: Callable[[Trial], bool], real_only_langs: set[str],
                    substitute: bool) -> tuple[list[Trial], str]:
    """Trials for a criterion. Every language in `real_only_langs` must have
    real turns -- one real vi turn does not make an en-vi number "real" -- and
    public turns of those languages are dropped. When a required language has
    no real turn, the criterion is insufficient, or with `substitute` public
    turns stand in and the row says so."""
    chosen = [t for t in trials if want(t) and (t.turn.real or t.turn.lang not in real_only_langs)]
    present = {t.turn.lang for t in chosen if t.turn.real}
    if real_only_langs <= present:
        has_real = any(t.turn.real for t in chosen)
        mixed = has_real and any(not t.turn.real for t in chosen)
        return chosen, "mixed" if mixed else ("real" if has_real else "public")
    if substitute:
        return [t for t in trials if want(t)], "public-substitute"
    return [], "real"


def _accuracy(rows: list[Trial]) -> float | None:
    return float(np.mean([t.correct for t in rows])) if rows else None


def _speech(t: Trial) -> bool:
    return t.turn.source != "l2arctic"


def _pair_name(pair: tuple[str, ...]) -> str:
    return "-".join(pair)


def criteria(trials: list[Trial], added_ms: list[float], noise: dict[str, tuple[int, int] | None],
             substitute: bool = False) -> dict[str, Result]:
    """Offline criteria. A7's `added_ms` and A5's held-out rejections per noise
    source (`{"real": (rejected, total), "esc50": ...}`, None when a turn of it
    had no Silero measurement) are computed by the caller: they come from
    latency and the speech gate, not from decisions."""
    out: dict[str, Result] = {}

    def row(name, value, threshold_text, passed, n, data):
        out[name] = Result(name, value, threshold_text, passed, n, data)

    def accuracy_row(name: str, want, real_langs: set[str], threshold: float) -> None:
        rows, data = _real_or_public(trials, want, real_langs, substitute)
        value = _accuracy(rows)
        row(name, value, f">={threshold}", None if value is None else value >= threshold, len(rows), data)

    for pair in PAIRS:
        real_langs = {"vi", "en"} & set(pair)
        accuracy_row(f"A1.{_pair_name(pair)}",
                     lambda t, p=pair: t.candidates == p and t.turn.bucket in LONG and _speech(t),
                     real_langs, 0.97)

    # A2 counts real turns and Common Voice's short clips together (step 4:
    # ">=40 per language, merged"), each also reported on its own. Per pair, so
    # weak zh can never fail the vi<->en criterion.
    for pair in PAIRS:
        name = _pair_name(pair)
        base = [t for t in trials if t.candidates == pair and t.turn.bucket == "<1.5" and _speech(t)]
        merged = [t for t in base if t.turn.real or t.turn.source == "cv"]
        data = "real+cv"
        if not merged and substitute:
            merged, data = base, "public-substitute"
        if merged:
            raw = float(np.mean([t.raw_correct for t in merged]))
            err = 1.0 - float(np.mean([t.correct for t in merged]))
            row(f"A2.{name}", raw, ">=0.90 raw OR <=0.05 err after fallback", raw >= 0.90 or err <= 0.05,
                len(merged), data)
            row(f"A2.{name}.err_after_fallback", err, "<=0.05", err <= 0.05, len(merged), data)
        else:
            row(f"A2.{name}", None, ">=0.90 raw OR <=0.05 err", None, 0, data)
        # Per source, so pause-cut fragments (`vietmed-cut`) never hide inside a
        # "real" number.
        for source in sorted({t.turn.source for t in merged}):
            subset = [t for t in merged if t.turn.source == source]
            row(f"A2.{name}.{source}", _accuracy(subset), "report", None, len(subset), source)

    # Split by zh so G3 (vi<->en ships, zh does not) can be told apart from G4.
    for bucket, buckets, threshold in (("long", LONG, 0.95), ("short", ("<1.5",), 0.85)):
        for part, langs, real_langs in (("vien", {"vi", "en"}, {"vi", "en"}), ("zh", {"zh"}, set())):
            accuracy_row(f"A3.{bucket}.{part}",
                         lambda t, b=buckets, l=langs: t.mode == "detect" and t.turn.bucket in b
                         and t.turn.lang in l and _speech(t),
                         real_langs, threshold)
    accuracy_row("A4", lambda t: t.turn.codeswitch and t.candidates in (("en", "vi"), TRIPLE), {"vi"}, 0.95)

    counts = [v for v in noise.values() if v is not None]
    if counts and len(counts) == len(noise):
        rejected, total = sum(c[0] for c in counts), sum(c[1] for c in counts)
        value = rejected / total if total else None
        row("A5", value, ">=0.90 rejected", None if value is None else value >= 0.90, total,
            "+".join(sorted(k for k, v in noise.items() if v and v[1])))
    else:
        # A noise turn with no Silero measurement would count as rejected by
        # the floor; that is a missing fact, not a pass.
        row("A5", None, ">=0.90 rejected", None, 0, "missing silero facts")
    for source, value in noise.items():
        if value is not None and value[1]:
            row(f"A5.{source}", value[0] / value[1], "report", None, value[1], source)

    for pair in PAIRS:
        name = _pair_name(pair)
        policy, data = _real_or_public(
            trials, lambda t, p=pair: t.candidates == p and t.outcome is not None and _speech(t),
            {"vi", "en"} & set(pair), substitute)
        if not policy:
            continue
        first = [t.outcome.first_language_ms for t in policy if t.outcome.first_language_ms is not None]
        p95 = float(np.percentile(first, 95)) if first else None
        shown = [t for t in policy if t.outcome.had_partials]
        changed = float(np.mean([t.outcome.changed for t in shown])) if shown else None
        row(f"A6.{name}.first_language_p95_ms", p95, f"<={FIRST_LANGUAGE_P95_MS}",
            None if p95 is None else p95 <= FIRST_LANGUAGE_P95_MS,
            len(first), data)
        row(f"A6.{name}.changed", changed, "<=0.10", None if changed is None else changed <= 0.10,
            len(shown), data)
        locked = [t for t in policy if t.outcome.locked is not None]
        lock_acc = float(np.mean([t.outcome.locked == t.turn.lang for t in locked])) if locked else None
        row(f"lock.{name}.accuracy", lock_acc, "report", None, len(locked), data)

    p95_added = float(np.percentile(added_ms, 95)) if added_ms else None
    row("A7", p95_added, "<=150 ms p95", None if p95_added is None else p95_added <= 150, len(added_ms), "mixed")

    for mode, cands in (("pair", ("en", "vi")), ("detect", TRIPLE)):
        rows = [t for t in trials if t.turn.accent_l1 == "vi" and t.candidates == cands and t.turn.bucket in LONG]
        value = _accuracy(rows)
        row(f"A-ACC.{mode}", value, ">=0.95", None if value is None else value >= 0.95, len(rows), "public")

    for lang in ("en", "vi"):
        rows = [t for t in trials if t.turn.mono and t.turn.real and t.turn.lang == lang
                and t.candidates == ("en", "vi")]
        worst = None
        for source in ("en", "vi"):
            subset = [t for t in rows if t.source == source]
            if subset:
                err = 1.0 - float(np.mean([t.correct for t in subset]))
                worst = err if worst is None else max(worst, err)
        row(f"A9-mono.{lang}", worst, "<=0.03 err (worst source)", None if worst is None else worst <= 0.03,
            len(rows), "real")

    # Real zh, reported on its own (step 7): accuracy over real zh turns only,
    # never gating, whatever the rest of the row's data was.
    for name, want in [(f"A1.{_pair_name(p)}", lambda t, p=p: t.candidates == p and t.turn.bucket in LONG)
                       for p in PAIRS if "zh" in p] + [("A3", lambda t: t.mode == "detect")]:
        rows = [t for t in trials if t.turn.lang == "zh" and t.turn.real and want(t)]
        row(f"zh_real.{name}", _accuracy(rows), "report", None, len(rows), "real")
    return out


def noise_rejection(noise_turns: list[Turn], silero_ms: dict[str, int], max_prob: dict[str, float],
                    tau_noise: float) -> tuple[int, int] | None:
    """(rejected, total) noise turns: the speech floor drops it, or no language
    reaches `tau_noise` (0 disables the second test). None when any turn has
    no Silero measurement -- defaulting it would count it as dropped."""
    if any(t.id not in silero_ms for t in noise_turns):
        return None
    rejected = sum(
        1 for t in noise_turns
        if silero_ms[t.id] < STT_MIN_SPEECH_MS or max_prob.get(t.id, 1.0) < tau_noise
    )
    return rejected, len(noise_turns)
