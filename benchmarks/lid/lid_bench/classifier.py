"""Arm 4's calibrated decision: multinomial logistic regression over features.

One model per CANDIDATE SET, not one model for everything: a two-way session
decodes only its pair's two engines, and the sidecar must still decide when one
of them did not answer in time, so each subset of engines the sidecar can end
up with gets its own coefficients (`SUBSETS`).

Scores are OUT-OF-FOLD. Every turn's probability comes from a model that never
saw its group (leave-one-group-out), because a threshold tuned on the turns it
is then scored on is the in-sample number the plan's risk table warns about.

The exported JSON is the whole model -- feature names, standardisation, coef,
intercept -- and `predict` applies it with numpy alone, which is how the
sidecar would run it (no scikit-learn at runtime).
"""

from __future__ import annotations

from itertools import combinations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from sklearn.preprocessing import StandardScaler

from lid_bench.manifest import LANGUAGES

#: Every candidate set the sidecar may have to decide over: the three pairs,
#: detect's triple, and (degenerate, never modelled) a single engine.
SUBSETS: tuple[tuple[str, ...], ...] = tuple(
    tuple(c) for size in (2, 3) for c in combinations(LANGUAGES, size)
)

C = 1.0
MAX_ITER = 2000


def _model() -> tuple[StandardScaler, LogisticRegression]:
    return StandardScaler(), LogisticRegression(C=C, max_iter=MAX_ITER)


def out_of_fold(X: np.ndarray, y: np.ndarray, groups: np.ndarray, classes: tuple[str, ...],
                apply_X: np.ndarray | None = None, apply_groups: np.ndarray | None = None,
                units: np.ndarray | None = None,
                ) -> tuple[np.ndarray, np.ndarray | None, str]:
    """Probabilities for every training row, and for every `apply_X` row, each
    from a model that did not train on that row's group.

    `apply_X` is for rows that must not train the model but must be scored by
    the fold that excludes their group -- prefixes of a turn, or turns of a
    language outside the subset. Leave-one-group-out when there are at least
    two groups; with one there is nothing to hold out, so it falls back to
    5 folds (apply rows then get the all-data model) and says so in the last
    return value -- a weaker estimate, not a hidden one. `units` keeps rows
    that belong together (the prefixes of one turn) in the same fallback
    fold, so a turn never helps score itself.
    """
    out = np.zeros((len(y), len(classes)))
    applied = None if apply_X is None else np.zeros((len(apply_X), len(classes)))

    def fit(train: np.ndarray):
        if len(set(y[train])) < 2:
            # A fold whose training side holds one class cannot be fitted.
            return None
        scaler, model = _model()
        model.fit(scaler.fit_transform(X[train]), y[train])
        return scaler, model

    def put(target: np.ndarray, rows: np.ndarray, fitted, data: np.ndarray) -> None:
        if rows.size == 0:
            # A group can have no apply rows: every turn shorter than the first prefix.
            return
        if fitted is None:
            target[rows] = 1.0 / len(classes)
            return
        scaler, model = fitted
        probs = model.predict_proba(scaler.transform(data[rows]))
        for column, label in enumerate(model.classes_):
            target[rows, classes.index(label)] = probs[:, column]

    distinct = sorted(set(groups))
    if len(distinct) >= 2:
        for group in distinct:
            train, test = np.where(groups != group)[0], np.where(groups == group)[0]
            fitted = fit(train)
            put(out, test, fitted, X)
            if applied is not None:
                put(applied, np.where(apply_groups == group)[0], fitted, apply_X)
        if applied is not None:
            # Apply rows whose group never trained the model (e.g. noise-only
            # groups) are scored by the all-data model: nothing of theirs leaked.
            unseen = np.where(~np.isin(apply_groups, distinct))[0]
            if unseen.size:
                put(applied, unseen, fit(np.arange(len(y))), apply_X)
        return out, applied, "logo"
    # Five folds, or fewer when a class has fewer members (a smoke run).
    folds = max(2, min(5, min(np.unique(y, return_counts=True)[1])))
    splitter = (StratifiedGroupKFold(folds, shuffle=True, random_state=0).split(X, y, units)
                if units is not None else StratifiedKFold(folds, shuffle=True, random_state=0).split(X, y))
    for train, test in splitter:
        put(out, test, fit(train), X)
    if applied is not None:
        put(applied, np.arange(len(apply_X)), fit(np.arange(len(y))), apply_X)
    return out, applied, "kfold5"


def fit_export(X: np.ndarray, y: np.ndarray, names: list[str], classes: tuple[str, ...]) -> dict:
    scaler, model = _model()
    model.fit(scaler.fit_transform(X), y)
    if tuple(model.classes_) != tuple(sorted(classes)):
        raise ValueError(f"training rows cover {list(model.classes_)}, expected {sorted(classes)}")
    coef, intercept = model.coef_, model.intercept_
    if len(model.classes_) == 2:
        # sklearn stores one row for a binary model; expand to one per class so
        # `predict` is the same softmax for every subset.
        coef = np.vstack([-coef[0] / 2, coef[0] / 2])
        intercept = np.array([-intercept[0] / 2, intercept[0] / 2])
    return {
        "features": names,
        "classes": list(model.classes_),
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "coef": coef.tolist(),
        "intercept": intercept.tolist(),
    }


def predict(model: dict, x: list[float]) -> dict[str, float]:
    """Apply an exported model with numpy only."""
    z = (np.asarray(x) - np.asarray(model["mean"])) / np.asarray(model["scale"])
    logits = np.asarray(model["coef"]) @ z + np.asarray(model["intercept"])
    logits -= logits.max()
    probs = np.exp(logits) / np.exp(logits).sum()
    return dict(zip(model["classes"], probs.tolist()))
