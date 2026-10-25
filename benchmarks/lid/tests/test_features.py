import numpy as np
import pytest

from lid_bench import classifier
from lid_bench.features import (engine_features, en_lexicon_ratio, feature_names, han_ratio,
                                vector, vi_diacritic_ratio)
from lid_bench.sidecar import Decode


def decode(lang, text, logp):
    return Decode(lang=lang, text=text, tokens=list(text.split()) or [], log_probs=logp, latency_ms=1.0)


def test_script_ratios():
    assert vi_diacritic_ratio("tôi đi học") > 0.3
    assert vi_diacritic_ratio("toi di hoc") == 0.0
    assert han_ratio("你好 a") == pytest.approx(2 / 3)
    assert han_ratio("") == 0.0


def test_lexicon_ratio_tells_english_from_transliterated_vietnamese():
    pytest.importorskip("pathlib")
    try:
        english = en_lexicon_ratio("The weather is nice today.")
    except FileNotFoundError:
        pytest.skip("no system word list")
    assert english == 1.0
    assert en_lexicon_ratio("nguoi ta khong biet") < 0.5


def test_empty_answer_is_its_own_evidence():
    out = engine_features(decode("en", "", []), 2.0)
    assert out["empty"] == 1.0 and out["tokens_per_s"] == 0.0


def test_engine_with_no_log_probs_gets_zero_confidence_not_nan():
    out = engine_features(decode("zh", "你好", []), 1.0)
    assert out["mean_logp"] == 0.0 and out["script"] == 1.0


def test_vector_order_matches_names_and_includes_pairwise_difference():
    per = {lang: {"empty": 0.0, "mean_logp": v, "min_logp": 0.0, "tokens_per_s": 1.0, "script": 0.0}
           for lang, v in (("vi", -0.1), ("en", -0.6), ("zh", -1.0))}
    names = feature_names(("en", "vi"))
    values = vector(per, ("en", "vi"))
    assert len(names) == len(values)
    assert names[-1] == "d.mean_logp.vi-en"
    assert values[-1] == pytest.approx(0.5)


@pytest.mark.parametrize("classes", [("en", "vi"), ("en", "vi", "zh")])
def test_exported_model_predicts_what_sklearn_predicts(classes):
    rng = np.random.default_rng(0)
    X = rng.normal(size=(90, 4)) + np.repeat(np.arange(len(classes)), 90 // len(classes))[:, None]
    y = np.array([classes[i] for i in np.repeat(np.arange(len(classes)), 90 // len(classes))])
    model = classifier.fit_export(X, y, [f"f{i}" for i in range(4)], classes)
    scaler, sk = classifier._model()
    sk.fit(scaler.fit_transform(X), y)
    expected = sk.predict_proba(scaler.transform(X[:5]))
    for row, want in zip(X[:5], expected):
        got = classifier.predict(model, row.tolist())
        assert [got[c] for c in sk.classes_] == pytest.approx(want.tolist(), abs=1e-9)


def test_out_of_fold_never_scores_a_group_with_a_model_that_saw_it():
    # Group "b" is labelled the OPPOSITE way: a model that had seen it could
    # learn that; one that had not must get it wrong.
    X = np.array([[0.0], [1.0]] * 20 + [[0.0], [1.0]] * 20)
    y = np.array(["en", "vi"] * 20 + ["vi", "en"] * 20)
    groups = np.array(["a"] * 40 + ["b"] * 40)
    probs, _, scheme = classifier.out_of_fold(X, y, groups, ("en", "vi"))
    assert scheme == "logo"
    predicted = np.array(["en", "vi"])[probs.argmax(axis=1)]
    assert (predicted[40:] != y[40:]).all()
