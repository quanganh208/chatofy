"""How long the speaker paused after each word, measured from the audio.

The display restorer reads text only, and some sentence boundaries are not in
the text at all: "xin chào anh tuấn anh xin kính chào" is "anh Tuấn. Anh xin…"
or "anh Tuấn Anh, xin…" depending on where the speaker stopped. A recorded
correspondent said the second in one breath — no pause from "chào" to the end
of the greeting — and the tagger wrote the first.

The recognizer gives each word's onset, not its end, so a pause is measured in
the audio between two onsets: the longest run of quiet frames in that span.
Quiet is relative to the utterance's own floor and loudness, so a noisy room
and a quiet one are measured alike.

Chosen on FLEURS vi dev, not test: how well a pause separates the gaps the gold
text punctuates from those it does not. A fixed 25 dB below the speech level
read no pause at all in half the clips (background noise never got that
quiet); halfway between the floor and the speech level scored AUC 0.856
against 0.723.
"""
import numpy as np

FRAME_S = 0.010
WINDOW_S = 0.025
#: A frame is quiet when it sits below this point between the utterance's floor
#: (10th-percentile frame energy) and its speech level (90th percentile).
QUIET_POINT = 0.5
#: The word's own first syllable is never its pause: a vowel onset can start
#: soft. Skipped at the start of every span.
ONSET_GUARD_S = 0.06


def _frame_db(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    hop, win = int(FRAME_S * sample_rate), int(WINDOW_S * sample_rate)
    if len(samples) < win:
        return np.full(1, -120.0)
    count = 1 + (len(samples) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(count)[:, None]
    rms = np.sqrt(np.mean(samples[idx] ** 2, axis=1))
    return 20 * np.log10(rms + 1e-9)


def word_starts(tokens: list[str], timestamps: list[float]) -> list[float]:
    """Onset of each word: a token opening with a space starts one."""
    starts: list[float] = []
    for token, at in zip(tokens, timestamps):
        if token.startswith(" ") or not starts:
            starts.append(float(at))
    return starts


def pauses_after(samples: np.ndarray, sample_rate: int, starts: list[float]) -> list[int]:
    """Milliseconds of silence after each word; the last word's runs to the end."""
    db = _frame_db(samples, sample_rate)
    floor, speech = np.percentile(db, 10), np.percentile(db, 90)
    quiet = db < floor + QUIET_POINT * (speech - floor)
    ends = [*starts[1:], len(samples) / sample_rate]
    out = []
    for start, end in zip(starts, ends):
        lo, hi = int((start + ONSET_GUARD_S) / FRAME_S), int(end / FRAME_S)
        run = best = 0
        for q in quiet[max(lo, 0) : max(hi, 0)]:
            run = run + 1 if q else 0
            best = max(best, run)
        out.append(int(best * FRAME_S * 1000))
    return out
