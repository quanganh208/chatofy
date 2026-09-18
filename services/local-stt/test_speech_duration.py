"""Unit tests for the speech-duration measurement.

No model, so these run wherever pytest does. What they pin is the property the
consumer's threshold depends on: that the number answers *how much voice*, and
not *how long the clip is*. Every test below is a clip whose two answers differ.
"""
import numpy as np

from audio.speech_duration import FRAME_MS, MIN_NOISE_FLOOR, speech_duration_ms

SR = 16000


def tone(duration_s: float, amplitude: float = 0.3) -> np.ndarray:
    """Speech-level signal. A real utterance sits well above the margin."""
    t = np.arange(int(SR * duration_s), dtype=np.float32) / SR
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(duration_s: float, amplitude: float = 0.0) -> np.ndarray:
    n = int(SR * duration_s)
    if amplitude == 0.0:
        return np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(1)
    return (rng.standard_normal(n) * amplitude).astype(np.float32)


def test_digital_silence_holds_no_speech():
    assert speech_duration_ms(silence(2.0)) == 0


def test_room_tone_under_the_margin_holds_no_speech():
    # The failure this guards is the one that matters most: a near-silent clip
    # reading as a full turn would hand the consumer a vector built on nothing
    # while telling it there was plenty of voice.
    assert speech_duration_ms(silence(2.0, amplitude=MIN_NOISE_FLOOR)) == 0


def test_continuous_speech_measures_the_whole_clip():
    # Whole frames, so the answer is the clip length rounded down to one.
    assert speech_duration_ms(tone(1.0)) == 1000


def test_pre_roll_and_hangover_are_not_speech():
    # The defect that made this endpoint report a duration at all: the client
    # sends a buffer, and the silence at both ends of it is not voice. 500ms of
    # speech inside a 2.1s buffer must read as 500ms.
    clip = np.concatenate([silence(0.8), tone(0.5), silence(0.8)])

    assert speech_duration_ms(clip) == 500


def test_a_pause_inside_a_sentence_is_still_inside_the_turn():
    # Bridged on purpose, and the reason is that the client's gate has already
    # used the same 500ms to decide the audio either side belongs to one turn.
    # Measuring the gap out here would put this function in a different unit
    # from the spans the consumer's floor was calibrated against.
    clip = np.concatenate([tone(0.6), silence(0.3), tone(0.6)])

    assert speech_duration_ms(clip) == 1500


def test_a_gap_long_enough_to_end_a_turn_is_not_bridged():
    # Past the hangover the gate would have closed the turn, so this is two
    # utterances that happen to share a buffer, not one with a pause in it.
    clip = np.concatenate([tone(0.6), silence(0.9), tone(0.6)])

    assert speech_duration_ms(clip) == 1200


def test_a_clip_shorter_than_one_frame_measures_nothing():
    # Not an error: a caller with a floor refuses it either way, and zero is the
    # only honest reading of audio too short to frame.
    assert speech_duration_ms(tone(FRAME_MS / 2000)) == 0


def test_a_loud_start_does_not_deafen_the_rest():
    # The floor only adapts on silence. If speech raised it, a clip that opens
    # loudly would measure as though the quieter half of the sentence were room
    # tone — which is the shape of every real utterance.
    clip = np.concatenate([tone(0.5, amplitude=0.9), tone(1.0, amplitude=0.1)])

    assert speech_duration_ms(clip) == 1500
