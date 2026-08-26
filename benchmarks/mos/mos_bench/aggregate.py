"""Screen the panel, then score it.

Two decisions here carry the whole result, so both are stated rather than buried.

*The unit of analysis is the listener, not the rating.* MOS is the mean of each
listener's mean, and its confidence interval is computed over those per-listener
means with n = the number of listeners. Pooling every individual rating instead
would inflate n by the clip count and shrink the interval to a width the panel
never earned — 12 listeners rating 40 clips is 12 independent observations, not
480, because one listener's ratings are correlated with each other.

*Repeat presentations are screening data, not score data.* Only the first
presentation of a clip enters MOS. Counting both would silently double the
weight of whichever clips happened to be drawn as attention checks.
"""

import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import stats

DEFAULT_ATTENTION_TOLERANCE = 2
VALID_SCORES = (1, 2, 3, 4, 5)


@dataclass(frozen=True)
class Rating:
    listener_id: str
    item_id: str
    score: int


@dataclass(frozen=True)
class ListenerScreen:
    listener_id: str
    flags: list[str]
    max_repeat_gap: float | None
    rating_sd: float
    n_ratings: int

    @property
    def passed(self) -> bool:
        return not self.flags


def load_ratings(paths: list[Path]) -> list[Rating]:
    """Read one ratings JSON per listener, as emitted by the rating form."""
    ratings: list[Rating] = []
    seen_listeners: set[str] = set()
    for path in paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        listener_id = document.get("listener_id")
        if not listener_id:
            raise ValueError(f"{path} has no listener_id")
        if listener_id in seen_listeners:
            raise ValueError(f"listener_id {listener_id!r} appears in more than one file")
        seen_listeners.add(listener_id)
        for row in document.get("ratings", []):
            score = row.get("score")
            if score not in VALID_SCORES:
                raise ValueError(
                    f"{path}: item {row.get('item_id')!r} has score {score!r};"
                    f" expected one of {VALID_SCORES}"
                )
            ratings.append(
                Rating(listener_id=listener_id, item_id=row["item_id"], score=int(score))
            )
    if not ratings:
        raise ValueError("no ratings found")
    return ratings


def _items_by_listener(key: dict) -> dict[str, dict[str, dict]]:
    return {
        listener: {item["item_id"]: item for item in items}
        for listener, items in key["playlists"].items()
    }


def screen_listeners(
    key: dict,
    ratings: list[Rating],
    attention_tolerance: int = DEFAULT_ATTENTION_TOLERANCE,
) -> list[ListenerScreen]:
    """Flag listeners whose data should not enter the MOS.

    `attention` — the two ratings of one identical clip differ by more than
    `attention_tolerance`. The clip is byte-identical, so a wide gap is evidence
    about the listener, not the audio.
    `flat` — every rating identical, which a scale cannot distinguish from
    clicking straight down the page.
    `incomplete` — the listener skipped items, so their systems are not scored
    on equal material.
    """
    playlists = _items_by_listener(key)
    by_listener: dict[str, list[Rating]] = defaultdict(list)
    for rating in ratings:
        by_listener[rating.listener_id].append(rating)

    screens: list[ListenerScreen] = []
    for listener_id in sorted(by_listener):
        items = playlists.get(listener_id)
        if items is None:
            raise ValueError(f"listener {listener_id!r} is not in the session key")
        given = by_listener[listener_id]
        unknown = [r.item_id for r in given if r.item_id not in items]
        if unknown:
            raise ValueError(
                f"listener {listener_id!r} rated unknown item(s): {sorted(unknown)[:5]}"
            )

        flags: list[str] = []
        if len({r.item_id for r in given}) != len(items):
            flags.append("incomplete")

        per_stimulus: dict[str, list[int]] = defaultdict(list)
        for rating in given:
            per_stimulus[items[rating.item_id]["stimulus_id"]].append(rating.score)
        gaps = [max(s) - min(s) for s in per_stimulus.values() if len(s) > 1]
        max_gap = float(max(gaps)) if gaps else None
        if max_gap is not None and max_gap > attention_tolerance:
            flags.append("attention")

        scores = np.asarray([r.score for r in given], dtype=np.float64)
        sd = float(scores.std(ddof=1)) if scores.size > 1 else 0.0
        if sd == 0.0:
            flags.append("flat")

        screens.append(
            ListenerScreen(
                listener_id=listener_id,
                flags=flags,
                max_repeat_gap=max_gap,
                rating_sd=sd,
                n_ratings=len(given),
            )
        )
    return screens


def _first_presentation_scores(
    key: dict, ratings: list[Rating], keep: set[str]
) -> dict[tuple[str, str, str], float]:
    """(lang, system, listener) -> that listener's mean over first presentations."""
    playlists = _items_by_listener(key)
    buckets: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for rating in ratings:
        if rating.listener_id not in keep:
            continue
        item = playlists[rating.listener_id][rating.item_id]
        if item["is_repeat"]:
            continue
        buckets[(item["lang"], item["system"], rating.listener_id)].append(rating.score)
    return {bucket: float(np.mean(scores)) for bucket, scores in buckets.items()}


def mos_table(key: dict, ratings: list[Rating], keep: set[str]) -> list[dict]:
    """Per (lang, system): MOS, 95% CI half-width, and the n it rests on."""
    listener_means = _first_presentation_scores(key, ratings, keep)
    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (lang, system, _listener), mean in listener_means.items():
        grouped[(lang, system)].append(mean)

    rows: list[dict] = []
    for (lang, system), means in sorted(grouped.items()):
        arr = np.asarray(means, dtype=np.float64)
        n = arr.size
        if n > 1:
            half_width = float(
                stats.t.ppf(0.975, n - 1) * arr.std(ddof=1) / np.sqrt(n)
            )
        else:
            half_width = float("nan")
        rows.append(
            {
                "lang": lang,
                "system": system,
                "mos": float(arr.mean()),
                "ci95": half_width,
                "n_listeners": int(n),
            }
        )
    return rows


def icc_two_way(matrix: np.ndarray) -> dict[str, float]:
    """ICC(2,1) and ICC(2,k), two-way random effects, absolute agreement.

    `matrix` is clips (rows) x listeners (columns), complete. ICC(2,1) is how
    much one listener alone can be trusted; ICC(2,k) is how much the panel's
    mean can be, which is the figure that matters when the deliverable is a MOS.
    Listener is modelled as a random effect, so a rater who is uniformly harsh
    costs agreement rather than being silently absorbed.
    """
    if matrix.ndim != 2:
        raise ValueError("matrix must be 2-dimensional (clips x listeners)")
    n, k = matrix.shape
    if n < 2 or k < 2:
        raise ValueError(f"ICC needs at least 2 clips and 2 listeners; got {n} x {k}")

    grand = matrix.mean()
    row_means = matrix.mean(axis=1)
    col_means = matrix.mean(axis=0)

    ss_rows = k * float(((row_means - grand) ** 2).sum())
    ss_cols = n * float(((col_means - grand) ** 2).sum())
    ss_total = float(((matrix - grand) ** 2).sum())
    ss_error = ss_total - ss_rows - ss_cols

    ms_rows = ss_rows / (n - 1)
    ms_cols = ss_cols / (k - 1)
    ms_error = ss_error / ((n - 1) * (k - 1))

    denominator_1 = ms_rows + (k - 1) * ms_error + k * (ms_cols - ms_error) / n
    denominator_k = ms_rows + (ms_cols - ms_error) / n
    return {
        "icc_2_1": float((ms_rows - ms_error) / denominator_1) if denominator_1 else float("nan"),
        "icc_2_k": float((ms_rows - ms_error) / denominator_k) if denominator_k else float("nan"),
        "n_clips": int(n),
        "n_listeners": int(k),
    }


def rating_matrix(key: dict, ratings: list[Rating], keep: set[str], lang: str) -> np.ndarray:
    """Complete stimuli x listeners matrix for one language, first presentations only.

    Rows are stimuli, not materials: the same sentence rendered by two systems is
    two rows, because agreement is about whether listeners rank the audio they
    were actually played the same way.
    """
    playlists = _items_by_listener(key)
    cells: dict[tuple[str, str], int] = {}
    stimulus_ids: set[str] = set()
    listeners: set[str] = set()
    for rating in ratings:
        if rating.listener_id not in keep:
            continue
        item = playlists[rating.listener_id][rating.item_id]
        if item["is_repeat"] or item["lang"] != lang:
            continue
        cells[(item["stimulus_id"], rating.listener_id)] = rating.score
        stimulus_ids.add(item["stimulus_id"])
        listeners.add(rating.listener_id)

    ordered_clips = sorted(stimulus_ids)
    ordered_listeners = sorted(listeners)
    missing = [
        (clip, listener)
        for clip in ordered_clips
        for listener in ordered_listeners
        if (clip, listener) not in cells
    ]
    if missing:
        raise ValueError(
            f"lang {lang!r}: rating matrix is incomplete, ICC needs every retained "
            f"listener to rate every clip; {len(missing)} cell(s) missing, "
            f"first: {missing[:3]}"
        )
    return np.asarray(
        [[cells[(clip, listener)] for listener in ordered_listeners] for clip in ordered_clips],
        dtype=np.float64,
    )
