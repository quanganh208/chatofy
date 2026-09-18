"""How much of a clip is speech, rather than how long the clip is.

A turn's audio is not a turn's speech. What reaches `/embed` is the client's
capture buffer: a moment of pre-roll before the speaker started, the utterance,
and the hangover the endpoint detector waits out before declaring the turn over.
On the conversation this was measured against, one turn carried 720 ms of speech
inside a 1540 ms buffer — so buffer length is not a usable stand-in for how much
voice an embedding was computed from, and a caller deciding whether a vector
carries any speaker information at all needs the second number.

**The measurement is deliberately the one the client already makes.**
`packages/realtime-client/src/audio/speech-gate.ts` decides where a turn begins
and ends by comparing each block's RMS against a noise floor that tracks the
room, and every constant below is its constant. Reusing them keeps this in the
same unit as the spans the consumer's threshold was calibrated on, rather than
in a second unit that merely lands nearby; a threshold measured in one and
enforced in the other would drift the first time either was tuned. Checked
against that calibration set — 55 turns cut from a real conversation — this
reads a median 0.90 of the hand-measured span, and agrees on every turn that
falls under the consumer's floor.

**A pause inside a sentence counts, and that is the same rule.** The gate keeps
a turn open across silence until the hangover runs out, so its spans bridge
those gaps; bridging them here is what makes the two numbers comparable. Only
the silence at the ends — which is exactly the pre-roll and the hangover — is
left out.

**Energy, not a learned detector.** sherpa-onnx ships a Silero VAD and it would
be more robust in a noisy room. It is also another model to download, load and
keep warm on a box already holding two recognisers and an extractor, to answer a
question whose consumer only compares it against a single threshold more than a
second wide. The gate makes the same trade for the same reason.
"""
import numpy as np

from engines.base import SAMPLE_RATE

#: One analysis frame. Chosen to match the ~21 ms blocks the client's gate is fed
#: (1024 samples at 48 kHz), because the floor below adapts once per block: a
#: frame of another length tracks the room at another rate and stops being the
#: same detector.
FRAME_MS = 20

#: Level above the noise floor that counts as speech, and the floor below which
#: a room is treated as silent whatever it has learnt. Both from
#: `speech-gate.ts` — see the module docstring for why they are copied here
#: rather than tuned.
SPEECH_MARGIN = 0.018
MIN_NOISE_FLOOR = 0.004

#: How fast the floor tracks the room. Rises slowly and falls quickly, so one
#: loud moment does not deafen the detector for the rest of the utterance.
FLOOR_RISE = 0.002
FLOOR_FALL = 0.05

#: Silence long enough to end a turn, so silence shorter than it is a pause
#: inside one. `SPEECH_HANGOVER_MS` in `speech-gate.ts`, and the reason this
#: number matters is that the gate has already used it to decide the audio
#: either side of the gap belongs to the same turn.
PAUSE_BRIDGE_MS = 500


def speech_duration_ms(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> int:
    """Milliseconds of `samples` spent inside speech, rounded to whole frames.

    Zero for a clip with nothing above the noise floor, and for a clip shorter
    than one frame — both honest answers, and both the answer that makes a
    caller with a floor refuse the clip.
    """
    frame = int(sample_rate * FRAME_MS / 1000)
    if frame <= 0 or samples.size < frame:
        return 0

    usable = samples.size - samples.size % frame
    # float64 for the accumulate: a float32 mean over a frame of near-silence
    # loses enough precision to move a level across the margin.
    levels = np.sqrt(
        np.square(samples[:usable].reshape(-1, frame).astype(np.float64)).mean(axis=1)
    )

    floor = MIN_NOISE_FLOOR
    speech: list[int] = []
    for index, level in enumerate(levels):
        if level > floor + SPEECH_MARGIN:
            speech.append(index)
            # Only silence moves the floor. Letting speech raise it would make
            # the detector deafen itself part-way through a long sentence.
            continue
        target = max(MIN_NOISE_FLOOR, float(level))
        floor += (target - floor) * (FLOOR_RISE if target > floor else FLOOR_FALL)

    if not speech:
        return 0

    bridge = PAUSE_BRIDGE_MS // FRAME_MS
    frames = 1
    for previous, current in zip(speech, speech[1:]):
        gap = current - previous - 1
        frames += gap + 1 if gap <= bridge else 1
    return frames * FRAME_MS
