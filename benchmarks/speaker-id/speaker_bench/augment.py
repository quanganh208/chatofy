"""Far-field simulation: a room impulse response plus additive noise.

**Why simulate rather than fetch measured RIRs.** The plan's far-field condition
originally meant a subset of a self-recording labelled 2m. Corpus audio has no
distance label, so the condition has to be created. Measured RIR collections
(openslr RIR_NOISES and similar) are the usual source but are another
multi-gigabyte download under another licence; the image-source method is
standard and reproducible from a seed with no download at all.

**Why pyroomacoustics rather than a local implementation.** This module first
hand-rolled the image-source method. Sweeping its parameters exposed the model
as wrong: RT60 tracked `max_order` at almost exactly 0.75x the array length and
barely responded to the wall absorption coefficient, because the reflection
tail was being truncated by the array bound rather than decaying. It was
measuring its own array size. Unlike the EER sweep, acoustics offers no analytic
oracle that would have caught this from a passing test suite, so the
well-tested library is the right dependency and the hand-rolled version was
deleted rather than patched.

**What this is and is not.** It models specular reflection in a shoebox room,
reproducing the reverberant tail and the direct-to-reverberant ratio that
far-field placement costs an embedding. It is not the product's channel: no
browser DSP, no AGC pumping, no microphone response — and corpus audio is
already broadcast-processed, so this stacks a simulated room onto an unknown
real one.

Reported honestly, Checkpoint 1's far-field cell is therefore a **harder
synthetic condition**, not a measurement of production. The gate reads it
because it is the conservative of the two available cells, not because it is
faithful. Phase 7 measures the real channel.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Room geometry and source/mic placement.
#:
#: A 5 x 4 x 2.8m room with the talker 2m from the microphone: an ordinary
#: meeting room, and the distance the product's design assumes at its far end.
DEFAULT_ROOM = (5.0, 4.0, 2.8)
#: Deliberately off the room's centre line. With both source and microphone at
#: x = 2.5 in a 5.0m-wide room, the two side-wall reflections travel identical
#: paths, arrive together and sum coherently — producing a reflection LOUDER
#: than the direct path. That is a symmetry artifact of the placement, not
#: acoustics anyone experiences, and it broke direct-path detection here before
#: the geometry was moved.
DEFAULT_MIC = (2.1, 1.0, 1.2)
DEFAULT_SOURCE = (2.7, 2.88, 1.5)

#: Sabine RT60 the room is solved for, in seconds. A carpeted office.
#:
#: The RIR that comes back measures ~0.49s rather than 0.40s — Sabine is an
#: approximation and the image-source tail runs longer than it predicts.
#: :func:`build_rir` returns the MEASURED value so artifacts record what the
#: room actually was, not what was requested.
DEFAULT_RT60_S = 0.40

#: Signal-to-noise ratio for the additive noise stage, in dB.
#:
#: 15dB is a realistic room with HVAC and background chatter — audible, not
#: overwhelming. Applied after reverberation, matching the physical order.
DEFAULT_SNR_DB = 15.0


#: Fraction of the RIR peak that counts as the direct arrival.
#:
#: 20% is comfortably above the fractional-delay filter's ringing (which sits
#: near 10% of the peak) and comfortably below any real first arrival.
DIRECT_PATH_THRESHOLD = 0.2


def direct_path_index(rir: np.ndarray) -> int:
    """Sample of the direct arrival — the FIRST significant one, not the loudest.

    Using ``argmax`` is wrong and was a real bug here. A reflection can exceed
    the direct path when several arrive together and sum coherently, and when
    that happens ``argmax`` sits hundreds of samples late, shifting every
    reverberated clip against its dry counterpart.

    pyroomacoustics also prepends about half its fractional-delay filter length,
    so the direct arrival is not at the geometric delay either. Detecting the
    first sample above a fraction of the peak handles both without hard-coding
    either offset.
    """
    magnitude = np.abs(np.asarray(rir, dtype=np.float64))
    peak = float(magnitude.max())
    if peak <= 0:
        raise ValueError("silent RIR has no direct path")
    above = np.flatnonzero(magnitude >= peak * DIRECT_PATH_THRESHOLD)
    if above.size == 0:
        raise ValueError("no sample reaches the direct-path threshold")
    return int(above[0])


@dataclass(frozen=True)
class RoomConfig:
    room: tuple[float, float, float] = DEFAULT_ROOM
    mic: tuple[float, float, float] = DEFAULT_MIC
    source: tuple[float, float, float] = DEFAULT_SOURCE
    rt60_s: float = DEFAULT_RT60_S

    @property
    def source_distance_m(self) -> float:
        """Talker-to-microphone distance — the 'far' in far-field."""
        return float(np.linalg.norm(np.asarray(self.source) - np.asarray(self.mic)))


def build_rir(
    config: RoomConfig = RoomConfig(), *, sample_rate: int = 16_000
) -> tuple[np.ndarray, float]:
    """Room impulse response and its MEASURED RT60.

    Returning the measured value rather than the requested one is deliberate:
    the requested RT60 is an input to Sabine's approximation, and the room that
    comes out of it is a different room. Artifacts should record the one that
    processed the audio.
    """
    import pyroomacoustics as pra

    absorption, max_order = pra.inverse_sabine(config.rt60_s, list(config.room))
    room = pra.ShoeBox(
        list(config.room),
        fs=sample_rate,
        materials=pra.Material(absorption),
        max_order=max_order,
    )
    room.add_source(list(config.source)).add_microphone(list(config.mic))
    room.compute_rir()
    rir = np.asarray(room.rir[0][0], dtype=np.float32)

    if float(np.max(np.abs(rir))) == 0.0:
        raise RuntimeError("pyroomacoustics returned a silent RIR")
    # Normalise by the DIRECT arrival, not the peak. In a reverberant room a
    # coherent sum of reflections can exceed the direct path, so peak-normalising
    # would scale every clip by however loud that reflection happened to be — a
    # volume change the extractor could read as distance. The far field must cost
    # reverberation, not loudness.
    rir = rir / abs(float(rir[direct_path_index(rir)]))
    return rir, float(room.measure_rt60()[0][0])


def apply_rir(samples: np.ndarray, rir: np.ndarray) -> np.ndarray:
    """Convolve, then trim to the original length from the direct path.

    Trimming from the direct arrival rather than from sample zero keeps the clip
    time-aligned with its dry version. Without that, a duration bucket would
    silently include the propagation delay as if it were speech.
    """
    from scipy.signal import fftconvolve

    dry = np.asarray(samples, dtype=np.float32)
    # FFT convolution, not np.convolve. The RIR runs ~13,800 taps and a 3s clip
    # is 48,000 samples, so direct convolution is ~660M multiply-adds per clip —
    # which dominated the first full screen run and roughly doubled its wall
    # time. fftconvolve is the same operation at O(n log n).
    wet = fftconvolve(dry, np.asarray(rir, dtype=np.float32), mode="full")
    direct = direct_path_index(rir)
    trimmed = wet[direct : direct + len(dry)]
    if len(trimmed) < len(dry):
        trimmed = np.pad(trimmed, (0, len(dry) - len(trimmed)))
    return trimmed.astype(np.float32)


def add_noise(
    samples: np.ndarray, rng: np.random.Generator, *, snr_db: float = DEFAULT_SNR_DB
) -> np.ndarray:
    """Add Gaussian noise at a target SNR, measured against this clip's power.

    Per-clip rather than global, so a quiet talker and a loud one both end up at
    the stated SNR instead of the quiet one being buried.
    """
    signal = np.asarray(samples, dtype=np.float32)
    power = float(np.mean(signal.astype(np.float64) ** 2))
    if power <= 0:
        raise ValueError("cannot set an SNR against a silent signal")
    noise_power = power / (10.0 ** (snr_db / 10.0))
    noise = rng.normal(0.0, np.sqrt(noise_power), size=signal.shape)
    return (signal + noise).astype(np.float32)


def far_field(
    samples: np.ndarray,
    rir: np.ndarray,
    rng: np.random.Generator,
    *,
    snr_db: float = DEFAULT_SNR_DB,
) -> np.ndarray:
    """Reverberate then add noise — the physical order, and it matters.

    Noise added before convolution would be reverberated too, modelling a noise
    source inside the room rather than at the microphone. Real sensor and HVAC
    noise reaches the mic without the talker's room transfer applied to it.
    """
    return add_noise(apply_rir(samples, rir), rng, snr_db=snr_db)


__all__ = [
    "DEFAULT_RT60_S",
    "DIRECT_PATH_THRESHOLD",
    "DEFAULT_SNR_DB",
    "RoomConfig",
    "add_noise",
    "apply_rir",
    "build_rir",
    "direct_path_index",
    "far_field",
]
