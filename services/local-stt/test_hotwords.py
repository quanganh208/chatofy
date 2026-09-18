"""Unit tests for the hotword list. No model weights needed."""
from hotwords import MAX_HOTWORDS, MAX_TERM_LENGTH, build_hotwords, normalize_term


def test_normalize_upper_cases_to_match_the_token_table():
    # The decoder's own output is upper case, so a lower-case term matches
    # nothing at all rather than matching weakly.
    assert normalize_term("poker") == "POKER"
    assert normalize_term("  Target  ") == "TARGET"


def test_normalize_folds_the_separator_into_a_space():
    # sherpa-onnx splits hotwords on "/", so a term carrying one would silently
    # become two terms.
    assert normalize_term("and/or") == "AND OR"


def test_normalize_truncates_an_overlong_term():
    assert len(normalize_term("A" * (MAX_TERM_LENGTH + 50))) == MAX_TERM_LENGTH


def test_build_keeps_the_caller_order():
    assert build_hotwords(["poker", "Target"]) == "POKER/TARGET"


def test_build_drops_blanks_and_duplicates():
    built = build_hotwords(["poker", "  ", "POKER", "poker"]).split("/")
    assert built.count("POKER") == 1
    assert "" not in built


def test_build_caps_the_list_keeping_the_terms_named_first():
    built = build_hotwords([f"TERM{i}" for i in range(MAX_HOTWORDS * 2)]).split("/")
    assert len(built) == MAX_HOTWORDS
    assert built[0] == "TERM0"


def test_build_with_nothing_to_bias_towards_is_empty():
    # Empty is what selects the unbiased decoder, so it must not become a graph
    # of one blank term.
    assert build_hotwords(None) == ""
    assert build_hotwords([]) == ""
    assert build_hotwords(["  ", "/"]) == ""


def test_bpe_vocab_is_not_written_into_the_model_directory():
    """Production bind-mounts the model directory read-only.

    A vocabulary written beside the weights raises OSError at load there, and the
    sidecar never reaches /healthz — a failure that dev, whose mount is writable,
    cannot reproduce.
    """
    from engines.base import MODELS_DIR
    from engines.zipformer_vi import ensure_bpe_vocab

    path = ensure_bpe_vocab()
    assert path.exists()
    assert MODELS_DIR not in path.parents
