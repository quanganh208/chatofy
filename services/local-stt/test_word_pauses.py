import numpy as np

from engines.word_pauses import lead_pause, pauses_after

RATE = 16000


def _tone(seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _hush(seconds: float, seed: int = 0) -> np.ndarray:
    return (0.001 * np.random.default_rng(seed).standard_normal(int(seconds * RATE))).astype(np.float32)


def test_lead_pause_is_the_quiet_before_the_first_word():
    samples = np.concatenate([_hush(0.3), _tone(0.5), _hush(0.2, 1), _tone(0.5)])

    assert abs(lead_pause(samples, RATE) - 300) <= 30


def test_lead_pause_is_zero_when_speech_starts_at_once():
    samples = np.concatenate([_tone(0.5), _hush(0.3), _tone(0.5)])

    assert lead_pause(samples, RATE) <= 20


def test_a_cut_pause_is_its_two_halves_added():
    # Two words with 500ms between them, cut 100ms into the pause — where the
    # capture gate cuts a turn that ran into its length ceiling.
    first = np.concatenate([_tone(0.4), _hush(0.1)])
    second = np.concatenate([_hush(0.4, 1), _tone(0.4), _hush(0.2, 2), _tone(0.4)])
    whole = np.concatenate([first, second])

    joined = pauses_after(first, RATE, [0.0])[-1] + lead_pause(second, RATE)
    alone = pauses_after(whole, RATE, [0.0, 0.9, 1.5])[0]

    assert pauses_after(first, RATE, [0.0])[-1] < 120
    assert abs(joined - alone) <= 40
