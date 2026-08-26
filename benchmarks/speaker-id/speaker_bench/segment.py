"""Turn segmentation — a faithful port of the production speech gate.

Benches MUST cut audio the way production cuts it. Oracle or hand-placed cuts
overstate attribution accuracy and the numbers do not transfer: a cut that clips
a syllable degrades the embedding, and that degradation is part of what is being
measured.

The source of truth is `packages/realtime-client/src/audio/speech-gate.ts`
(constants), plus `PRE_ROLL_MS` from `capture-pump.ts`. Every constant below is
copied from there deliberately rather than re-derived. `scripts/gate-reference.mjs`
runs the REAL TypeScript gate over the same audio and `tests/test_segment_parity.py`
asserts the two agree, so a silent drift in this port fails a test rather than
quietly poisoning every downstream number.

Note on the oracle: parity is NOT checked against `benchmarks/realtime/vad-reference.mjs`.
That file's own header states it exists precisely so that it does not share a line
of reasoning with SpeechGate — whole-file energy threshold vs adaptive floor, dB
margin with hysteresis vs a fixed linear margin, median-smoothed mask vs per-block
streaming decisions. A correct port would legitimately disagree with it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Iterator, Literal

import numpy as np

# --- Constants, copied from speech-gate.ts. Do not re-derive. ---------------

#: Silence before the turn is declared over.
SPEECH_HANGOVER_MS = 500.0
#: Silence before the turn is *suspected* over (server starts early work).
PROBABLE_END_MS = 150.0
#: Speech must outlast this to open a turn, so a cough is not an utterance.
MIN_SPEECH_MS = 120.0
#: Level above the noise floor that counts as speech.
SPEECH_MARGIN = 0.018
#: Floor below which a room is treated as silent regardless of what it learnt.
MIN_NOISE_FLOOR = 0.004
#: How fast the noise floor tracks the room. Rises slowly, falls quickly.
FLOOR_RISE = 0.002
FLOOR_FALL = 0.05
#: Default distance ahead of ``max_utterance_ms`` to start looking for a cut.
CUT_LOOKAHEAD_MS = 500.0

# --- Constant from capture-pump.ts -----------------------------------------

#: Audio kept from just before speech is confirmed, so the first syllable
#: of a turn is not already gone by the time the gate calls it speech.
PRE_ROLL_MS = 320.0

# --- Production block framing ----------------------------------------------

#: The rate everything downstream of capture runs at (``TARGET_SAMPLE_RATE``).
SAMPLE_RATE = 16_000

#: Samples the capture worklet posts per block, at the AudioContext's OWN rate.
#:
#: This is the one framing constant production actually fixes: the worklet
#: batches the browser's 128-sample render quanta into 1024-sample blocks and
#: posts them (`packages/realtime-client/worklets/mic-capture-processor.js`).
#: Each block is then downsampled to 16 kHz, so at a 48 kHz context one block
#: becomes ``floor(1024 / 3) == 341`` samples — about 21.3ms, not the round 20ms
#: the worklet comment approximates.
#:
#: Blocking at the SOURCE rate rather than at 16 kHz matters: it is what puts
#: every block boundary where production puts it. Fixture audio is 48 kHz for
#: the same reason.
WORKLET_BLOCK_SAMPLES = 1024

SpeechEndReason = Literal["hangover", "forced"]
GateEventType = Literal["start", "probableEnd", "end"]


@dataclass(frozen=True)
class GateEvent:
    """One handler firing, addressed by the block that caused it.

    Block index rather than a timestamp is the parity contract: it is exactly
    what both implementations can agree on without also agreeing about
    capture-pump's audio-forwarding policy.
    """

    type: GateEventType
    block_index: int
    at_ms: float
    reason: SpeechEndReason | None = None


class SpeechGate:
    """Streaming endpoint detector. Port of the TypeScript class of the same name.

    Fed one block at a time with its level and duration, so it never has to know
    the sample rate or guess at wall-clock timing.
    """

    def __init__(
        self,
        on_speech_start: Callable[[], None] | None = None,
        on_probable_end: Callable[[], None] | None = None,
        on_speech_end: Callable[[SpeechEndReason], None] | None = None,
        *,
        max_utterance_ms: float = 0.0,
        cut_lookahead_ms: float = CUT_LOOKAHEAD_MS,
    ) -> None:
        self._on_speech_start = on_speech_start
        self._on_probable_end = on_probable_end
        self._on_speech_end = on_speech_end
        self._max_utterance_ms = max_utterance_ms
        self._cut_lookahead_ms = cut_lookahead_ms

        self._noise_floor = MIN_NOISE_FLOOR
        self._speaking = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        self._probable_end_fired = False
        self._utterance_ms = 0.0
        self._armed = False

    @property
    def _has_ceiling(self) -> bool:
        return self._max_utterance_ms > 0

    def push(self, rms: float, duration_ms: float) -> bool:
        """Feed one block. Returns whether it counted as speech.

        The caller needs the return value to decide whether the block belongs to
        the turn; deriving it again there would mean two copies of the threshold,
        which would drift.
        """
        is_speech = rms > self._noise_floor + SPEECH_MARGIN

        # Only adapt on silence: letting speech raise the floor would make the
        # detector deafen itself part-way through a long sentence.
        if not is_speech:
            floor_goal = max(MIN_NOISE_FLOOR, rms)
            rate = FLOOR_RISE if floor_goal > self._noise_floor else FLOOR_FALL
            self._noise_floor += (floor_goal - self._noise_floor) * rate

        if is_speech:
            self._silence_ms = 0.0
            self._probable_end_fired = False
            self._speech_ms += duration_ms
            if not self._speaking and self._speech_ms >= MIN_SPEECH_MS:
                self._speaking = True
                if self._on_speech_start:
                    self._on_speech_start()
            if self._speaking:
                self._utterance_ms += duration_ms
                self._arm_if_due()
                # Nowhere quiet turned up inside the lookahead, so the turn is
                # cut mid-word — the trade the ceiling exists to make.
                if self._has_ceiling and self._utterance_ms >= self._max_utterance_ms:
                    self._cut()
            return True

        # Silence that never became a turn is just room tone; forget it.
        if not self._speaking:
            self._speech_ms = 0.0
            return False

        self._utterance_ms += duration_ms
        self._silence_ms += duration_ms
        self._arm_if_due()

        if not self._probable_end_fired and self._silence_ms >= PROBABLE_END_MS:
            self._probable_end_fired = True
            if self._on_probable_end:
                self._on_probable_end()

        # Armed, and this block is quiet: the gap the lookahead was for. Checked
        # before the hangover because it is always the earlier of the two.
        if self._armed:
            self._cut()
            return False

        if self._silence_ms >= SPEECH_HANGOVER_MS:
            self.reset()
            if self._on_speech_end:
                self._on_speech_end("hangover")

        return False

    def _arm_if_due(self) -> None:
        """Enter the window where the next quiet block ends the turn."""
        if self._armed or not self._has_ceiling:
            return
        if self._utterance_ms < self._max_utterance_ms - self._cut_lookahead_ms:
            return

        self._armed = True
        # Suppress an immediate second call from the silence run this may sit in.
        self._probable_end_fired = True
        if self._on_probable_end:
            self._on_probable_end()

    def _cut(self) -> None:
        self.reset()
        if self._on_speech_end:
            self._on_speech_end("forced")

    def reset(self) -> None:
        """Forget the current utterance without emitting anything.

        The noise floor deliberately survives: it describes the room, not the turn.
        """
        self._speaking = False
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        self._probable_end_fired = False
        self._utterance_ms = 0.0
        self._armed = False


#: Trailing silence a clip needs for its final turn to close at all.
#:
#: The gate ends a turn only after SPEECH_HANGOVER_MS of silence, so a recording
#: that stops promptly after the last word leaves its final turn open forever —
#: and :func:`segment` drops open turns, because production never sent one. On a
#: clip that is a single utterance, that means ZERO turns.
#:
#: Phase 1 recording and any Phase 3 clip preparation must leave at least this
#: much trailing silence, or the bench measures nothing and says so quietly.
MIN_TRAILING_SILENCE_MS = SPEECH_HANGOVER_MS + 200.0


@dataclass
class Turn:
    """One segmented utterance, in the shape the benches consume."""

    index: int
    #: Where the turn's audio begins, pre-roll included — what production sends.
    start_ms: float
    #: Where the turn's AUDIO ends, which is earlier than where the gate declared
    #: the turn over. See :func:`segment` for why.
    end_ms: float
    #: Milliseconds the gate counted as speech. The short-turn ladder keys off
    #: THIS, not wall duration: a turn with long internal pauses is not a long
    #: turn as far as an embedding is concerned.
    net_speech_ms: float
    reason: SpeechEndReason
    start_block: int = 0
    end_block: int = 0

    @property
    def wall_ms(self) -> float:
        return self.end_ms - self.start_ms

    @property
    def duration_bucket(self) -> str:
        """Net-speech bucket. Benches must report these separately — pooling lets
        healthy 3s turns average away a catastrophic 1s bucket."""
        seconds = self.net_speech_ms / 1000.0
        if seconds < 1.0:
            return "sub1s"
        if seconds < 2.0:
            return "1s"
        if seconds < 3.0:
            return "2s"
        return "3s"


def iter_blocks(
    samples: np.ndarray, block_samples: int = WORKLET_BLOCK_SAMPLES
) -> Iterator[np.ndarray]:
    """Split audio into worklet-sized blocks, dropping the short tail.

    The tail is dropped rather than padded because production never sees a short
    block: the worklet only posts once its buffer is full.
    """
    total = (len(samples) // block_samples) * block_samples
    for start in range(0, total, block_samples):
        yield samples[start : start + block_samples]


def downsample_block_to_pcm16(block: np.ndarray, input_rate: int) -> np.ndarray:
    """Resample and quantise one block — mirrors ``downsampleToPcm16``.

    Linear interpolation, and each block restarts at position 0 rather than
    carrying phase across boundaries. That is what production does, and the
    fractional remainder it drops every block is precisely why this is copied
    rather than replaced with a one-shot resample of the whole file: a sharper
    or phase-continuous resample would put the levels somewhere production never
    puts them.
    """
    if input_rate <= 0:
        raise ValueError(f"invalid input rate {input_rate}")

    ratio = input_rate / SAMPLE_RATE
    output_length = int(len(block) // ratio)
    if output_length == 0:
        return np.zeros(0, dtype=np.int16)

    positions = np.arange(output_length, dtype=np.float64) * ratio
    left = np.floor(positions).astype(np.int64)
    right = np.minimum(left + 1, len(block) - 1)
    weight = positions - left

    floats = block.astype(np.float64)
    interpolated = floats[left] * (1.0 - weight) + floats[right] * weight
    clamped = np.clip(interpolated, -1.0, 1.0)
    scaled = np.where(clamped < 0, clamped * 0x8000, clamped * 0x7FFF)
    return np.rint(scaled).astype(np.int16)


def block_rms(block: np.ndarray) -> float:
    """RMS of a PCM16 block, normalised to 0..1 — mirrors ``pcm16Rms``."""
    if block.size == 0:
        return 0.0
    values = block.astype(np.float64) / 0x8000
    return float(np.sqrt(np.mean(values * values)))


@dataclass(frozen=True)
class GatePass:
    """Everything one run of the gate produced.

    Both public entry points read from this, so the gate is driven exactly once
    per audio file and there is no second copy of the loop to drift.
    """

    events: list[GateEvent]
    #: Per-block ``isSpeech``, in block order. What net-speech accounting needs.
    speech_mask: list[bool]
    block_ms: float


def run_gate(
    samples: np.ndarray,
    input_rate: int,
    *,
    block_samples: int = WORKLET_BLOCK_SAMPLES,
    max_utterance_ms: float = 0.0,
    cut_lookahead_ms: float = CUT_LOOKAHEAD_MS,
) -> GatePass:
    """Run the gate over float mono samples at their own rate.

    ``samples`` is the source audio in -1..1 at ``input_rate`` — the same thing
    the worklet hands the main thread. Downsampling happens per block here, as
    it does in production.

    ``events`` is the parity surface: `scripts/gate-reference.mjs` produces the
    same list from the real TypeScript gate over the same audio.
    """
    events: list[GateEvent] = []
    speech_mask: list[bool] = []
    state = {"index": -1}
    # Derived from the DOWNSAMPLED length, exactly as `CapturePump` does:
    # `blockMs = block.length / TARGET_SAMPLE_RATE * 1000` where `block` is the
    # 16 kHz block, not the source-rate one.
    block_ms = (int(block_samples // (input_rate / SAMPLE_RATE)) / SAMPLE_RATE) * 1000.0

    def at() -> tuple[int, float]:
        index = int(state["index"])
        return index, (index + 1) * block_ms

    def on_start() -> None:
        index, ms = at()
        events.append(GateEvent("start", index, ms))

    def on_probable() -> None:
        index, ms = at()
        events.append(GateEvent("probableEnd", index, ms))

    def on_end(reason: SpeechEndReason) -> None:
        index, ms = at()
        events.append(GateEvent("end", index, ms, reason))

    gate = SpeechGate(
        on_start,
        on_probable,
        on_end,
        max_utterance_ms=max_utterance_ms,
        cut_lookahead_ms=cut_lookahead_ms,
    )

    for index, block in enumerate(iter_blocks(samples, block_samples)):
        state["index"] = index
        pcm = downsample_block_to_pcm16(block, input_rate)
        speech_mask.append(gate.push(block_rms(pcm), block_ms))

    return GatePass(events=events, speech_mask=speech_mask, block_ms=block_ms)


@dataclass(frozen=True)
class Segmentation:
    """Turns, plus what was thrown away getting them.

    ``dropped_open_turns`` exists because dropping is silent and its usual cause
    is banal: a clip that stops promptly after the last word. On such a clip
    ``turns`` is empty, and an empty result is indistinguishable from "this audio
    contained no speech" unless the drop is reported. A bench that read only
    ``turns`` would compute zero pairs, write an empty artifact, and report a
    verdict about a measurement that never happened.
    """

    turns: list[Turn]
    #: Turns the gate opened but never closed before the audio ran out.
    dropped_open_turns: int

    def __len__(self) -> int:
        return len(self.turns)

    def require_terminated(self, source: str = "audio") -> list[Turn]:
        """Return the turns, or raise if any were dropped.

        Benches should call this rather than reading ``turns`` directly, so a
        clip with insufficient trailing silence fails loudly at the point of use
        instead of quietly contributing nothing.
        """
        if self.dropped_open_turns:
            raise ValueError(
                f"{source}: {self.dropped_open_turns} turn(s) never closed — the "
                f"clip needs >= {MIN_TRAILING_SILENCE_MS:.0f}ms of trailing "
                "silence for its final turn to end. Pad the clip or re-cut it."
            )
        return self.turns


def segment(
    samples: np.ndarray,
    input_rate: int,
    *,
    block_samples: int = WORKLET_BLOCK_SAMPLES,
    max_utterance_ms: float = 0.0,
    cut_lookahead_ms: float = CUT_LOOKAHEAD_MS,
) -> Segmentation:
    """Segment source-rate float audio into the turns production would send.

    Three things here follow `capture-pump.ts` rather than the gate, because the
    gate decides WHEN a turn ends while the pump decides WHAT AUDIO it contains:

    1. **A turn's audio stops at the last ``probableEnd``, not at the end event.**
       The pump holds silent blocks instead of forwarding them (`:429-434`),
       flushes them when `onProbableEnd` fires (`:280`), and `closeTurn` DROPS
       whatever is still held (`:321`) — "by definition nothing but silence".
       So roughly the last 350ms of a hangover-ended turn never reaches the
       server, and must not reach the embedder here either.

    2. **Pre-roll cannot reach back past the previous turn's close.**
       `closeTurn` clears `preRoll` (`:320`), so a new turn's pre-roll can only
       contain blocks from that close onward. The clamp is INCLUSIVE of the
       closing block: `gate.push` runs before the state check (`:426-445`), so on
       the block that closes a turn the state is already `idle` and line 443
       pushes that same block into the fresh pre-roll.

    3. **A turn still open when the audio ends is dropped**, because the gate
       never declared it over and production never sent it. See
       :class:`Segmentation` — the drop is counted, not silent.
    """
    result = run_gate(
        samples,
        input_rate,
        block_samples=block_samples,
        max_utterance_ms=max_utterance_ms,
        cut_lookahead_ms=cut_lookahead_ms,
    )
    block_ms = result.block_ms
    pre_roll_blocks = max(1, round(PRE_ROLL_MS / block_ms))

    turns: list[Turn] = []
    open_start: int | None = None
    last_probable: int | None = None
    # Inclusive floor for the next turn's pre-roll; see point 2 in the docstring.
    prev_end_block = 0

    for event in result.events:
        if event.type == "start":
            open_start = event.block_index
            last_probable = None
        elif event.type == "probableEnd" and open_start is not None:
            # Each of these flushed the held silence into the turn. The LAST one
            # before the turn closes is where its audio actually stops.
            last_probable = event.block_index
        elif event.type == "end" and open_start is not None:
            # No probableEnd inside the turn would mean it closed without ever
            # flushing — not reachable via either ending (the hangover passes
            # PROBABLE_END_MS on the way, and a forced cut is preceded by
            # `armIfDue` firing one) but falling back keeps this total.
            content_end = last_probable if last_probable is not None else event.block_index

            # Net speech counts only blocks the gate itself called speech, and
            # only within the content window: the pre-roll is audio kept from
            # BEFORE the gate was convinced, and the dropped tail is silence, so
            # counting either would inflate exactly the quantity the short-turn
            # ladder gates on.
            net_speech_ms = sum(result.speech_mask[open_start : content_end + 1]) * block_ms

            start_block = max(0, prev_end_block, open_start - pre_roll_blocks)
            turns.append(
                Turn(
                    index=len(turns),
                    start_ms=start_block * block_ms,
                    end_ms=(content_end + 1) * block_ms,
                    net_speech_ms=net_speech_ms,
                    reason=event.reason or "hangover",
                    start_block=start_block,
                    end_block=content_end,
                )
            )
            prev_end_block = event.block_index
            open_start = None
            last_probable = None

    return Segmentation(turns=turns, dropped_open_turns=1 if open_start is not None else 0)


def slice_turn(samples: np.ndarray, turn: Turn, *, sample_rate: int) -> np.ndarray:
    """The audio a turn covers, for embedding.

    ``sample_rate`` is the rate of ``samples`` — pass the 16 kHz rate when
    slicing resampled audio for the extractor, or the source rate when slicing
    the original. Turn boundaries are in milliseconds precisely so one Turn can
    address both.
    """
    start = max(0, int(turn.start_ms * sample_rate / 1000.0))
    end = min(len(samples), int(turn.end_ms * sample_rate / 1000.0))
    return samples[start:end]


def total_net_speech_ms(turns: Iterable[Turn]) -> float:
    return sum(turn.net_speech_ms for turn in turns)
