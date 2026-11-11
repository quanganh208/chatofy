"""The seam trim keeps a short, faded silence and never cuts into speech. Model-free."""
import numpy as np

from engines.seam_trim import FADE_MS, KEEP_LEAD_MS, KEEP_TAIL_MS, SILENCE_THRESHOLD, trim_lead, trim_tail

RATE = 24_000


def _clip(lead_ms, speech_ms, tail_ms):
    ms = lambda v: RATE * v // 1000  # noqa: E731
    speech = 0.5 * np.sin(np.linspace(0, 200 * np.pi, ms(speech_ms))).astype(np.float32)
    speech[0] = speech[-1] = 0.5  # loud at both edges, so the speech span is exact
    return np.concatenate([np.zeros(ms(lead_ms), np.float32), speech, np.zeros(ms(tail_ms), np.float32)])


def _loud(a):
    return np.nonzero(np.abs(a) > SILENCE_THRESHOLD)[0]


def test_tail_keeps_its_breath_and_every_loud_sample():
    clip = _clip(95, 400, 150)
    out = trim_tail(clip, RATE)
    kept_ms = (len(out) - (_loud(clip)[-1] + 1)) * 1000 / RATE
    assert abs(kept_ms - KEEP_TAIL_MS) <= 1
    assert np.array_equal(out[: _loud(clip)[-1] + 1], clip[: _loud(clip)[-1] + 1])


def test_lead_keeps_its_onset_and_every_loud_sample():
    clip = _clip(95, 400, 150)
    out = trim_lead(clip, RATE)
    assert abs(_loud(out)[0] * 1000 / RATE - KEEP_LEAD_MS) <= 1
    assert np.array_equal(out[_loud(out)[0] :], clip[_loud(clip)[0] :])


def test_edges_are_faded_to_silence():
    out = trim_tail(_clip(95, 400, 150), RATE)
    assert abs(out[-1]) < 1e-6
    n = RATE * FADE_MS // 1000
    assert np.all(np.abs(out[-n:]) <= SILENCE_THRESHOLD)


def test_short_or_silent_audio_is_untouched():
    short = _clip(10, 400, 20)
    assert trim_tail(short, RATE) is short
    assert trim_lead(short, RATE) is short
    silent = np.zeros(RATE, np.float32)
    assert trim_tail(silent, RATE) is silent
    assert trim_lead(silent, RATE) is silent
