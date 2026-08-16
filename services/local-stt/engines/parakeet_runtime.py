"""ctypes binding to libparakeet, the ggml runtime behind the streaming model.

Why a binding and not the `parakeet-server` process that ships with the same
project: the streaming commit design needs a *session* — feed audio in chunks,
read back only the newly finalized text, keep decoder state across chunks. The
server only exposes whole-file, OpenAI-shaped transcription, which throws that
away. Binding directly also keeps one process instead of two and one less hop on
the path whose whole point is latency.

The library is built from source (see README); this module only loads it and
owns the pointer lifetimes, so nothing here has to change when it is rebuilt.
"""
from __future__ import annotations

import ctypes
import os
import re
from pathlib import Path

import numpy as np

#: Set by parakeet_capi_stream_feed when the decoder marks a complete utterance.
EVENT_EOU = 1
#: ...and when it marks a backchannel ("uh-huh") that is NOT a turn hand-off.
EVENT_EOB = 2

_LIB_ENV = "LOCAL_STT_PARAKEET_LIB"

#: Rate the audio decoder hands us; the C side would resample anything else.
SAMPLE_RATE = 16000

#: `decoder` selector in the C API: 0 = the model's own default.
_DECODER_DEFAULT = 0


#: Language-tag markers the multilingual decoder produces, e.g. `<vi-VN>`.
#:
#: The model marks the end of an utterance with one, so on short clips it turns
#: up at the end of almost every transcript — this is normal output, not a
#: glitch. The vocabulary holds 39 of them as single tokens and the runtime bars
#: those (emitting one collapses the greedy decoder into silence for the rest of
#: the stream); barred, the model spells the tag out of ordinary word pieces
#: instead, which is what this matches.
#:
#: Stripping is not cosmetic. Unstripped, the tag is read aloud by TTS, and it
#: counts as two inserted words against every reference — which is enough on
#: short utterances to swamp the WER of the model itself.
LANGUAGE_TAG = re.compile(r"<\s*[A-Za-z]{2}\s*-\s*[A-Za-z]{2}\s*>?")


def strip_language_tags(text: str) -> str:
    """Remove language-tag markers and the whitespace they leave behind."""
    return re.sub(r"\s{2,}", " ", LANGUAGE_TAG.sub(" ", text)).strip()


class ParakeetError(RuntimeError):
    """Any failure reported by the C API, with its last-error text attached."""


#: Where the built library lives when nobody says otherwise.
#:
#: Beside the weights, and gitignored the same way, so provisioning this service
#: is one script plus one build rather than a build plus an environment variable
#: every shell has to remember. `pnpm dev:all` starts the sidecar with no env of
#: its own, so a required variable would mean the default way of running the app
#: is the broken way.
DEFAULT_LIB_DIR = Path(__file__).resolve().parent.parent / "runtime"
DEFAULT_LIB = DEFAULT_LIB_DIR / "libparakeet.so"


def _library_path() -> Path:
    raw = os.environ.get(_LIB_ENV)
    path = Path(raw) if raw else DEFAULT_LIB
    if not path.exists():
        raise ParakeetError(
            f"libparakeet not found at {path}. Build it (see README) or set"
            f" {_LIB_ENV}, or run with LOCAL_STT_VI_ENGINE=zipformer to use the"
            " offline recogniser instead."
        )
    return path


def _bind(lib: ctypes.CDLL) -> ctypes.CDLL:
    """Declare every signature we use.

    ctypes defaults an unbound return type to int, which truncates 64-bit
    pointers — the failure looks like random corruption much later, so the
    argtypes/restype block is not optional bookkeeping.
    """
    f32p = ctypes.POINTER(ctypes.c_float)
    lib.parakeet_capi_load.argtypes = [ctypes.c_char_p]
    lib.parakeet_capi_load.restype = ctypes.c_void_p
    lib.parakeet_capi_free.argtypes = [ctypes.c_void_p]
    lib.parakeet_capi_free.restype = None
    lib.parakeet_capi_last_error.argtypes = [ctypes.c_void_p]
    lib.parakeet_capi_last_error.restype = ctypes.c_char_p
    lib.parakeet_capi_free_string.argtypes = [ctypes.c_void_p]
    lib.parakeet_capi_free_string.restype = None

    lib.parakeet_capi_transcribe_pcm_lang.argtypes = [
        ctypes.c_void_p, f32p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_char_p
    ]
    lib.parakeet_capi_transcribe_pcm_lang.restype = ctypes.c_void_p

    lib.parakeet_capi_stream_begin_lang.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.parakeet_capi_stream_begin_lang.restype = ctypes.c_void_p
    lib.parakeet_capi_stream_feed.argtypes = [
        ctypes.c_void_p, f32p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)
    ]
    lib.parakeet_capi_stream_feed.restype = ctypes.c_void_p
    lib.parakeet_capi_stream_finalize.argtypes = [ctypes.c_void_p]
    lib.parakeet_capi_stream_finalize.restype = ctypes.c_void_p
    lib.parakeet_capi_stream_free.argtypes = [ctypes.c_void_p]
    lib.parakeet_capi_stream_free.restype = None
    return lib


_lib: ctypes.CDLL | None = None

#: ggml backends libparakeet needs, in dependency order.
#:
#: Preloaded by absolute path rather than left to the dynamic loader, because the
#: loader cannot find them: the built `libparakeet.so` carries a RUNPATH pointing
#: at the build tree it was compiled in, and that tree is a scratch directory
#: which no longer exists. Every NEEDED soname then fails to resolve and the
#: Vietnamese engine cannot load at all — `OSError: libggml.so.0: cannot open
#: shared object file`, at import, on a machine where the files are sitting right
#: beside the library that wants them.
#:
#: Once each soname is in the process with RTLD_GLOBAL the loader is satisfied
#: without consulting RUNPATH, which is the same reason `preload_onnxruntime_dll`
#: exists a directory over. Fixing the RUNPATH instead would mean rebuilding, and
#: a rebuild does not help anyone who already has the artifact.
_GGML_PRELOAD = ("libggml-base.so.0", "libggml-cpu.so.0", "libggml.so.0")


def _preload_backends(lib_dir: Path) -> None:
    """Load the sibling ggml libraries so libparakeet's NEEDED entries resolve.

    Missing siblings are not an error here: a differently built or statically
    linked libparakeet needs none of this, and refusing to continue would break
    the case that already worked. Whatever is genuinely missing surfaces from the
    load below, with the loader's own message.
    """
    for soname in _GGML_PRELOAD:
        candidate = lib_dir / soname
        if candidate.exists():
            ctypes.CDLL(str(candidate), mode=ctypes.RTLD_GLOBAL)


def _load_library() -> ctypes.CDLL:
    global _lib
    if _lib is None:
        path = _library_path()
        _preload_backends(path.parent)
        # RTLD_GLOBAL so the ggml backend libraries libparakeet pulls in resolve
        # against the same symbols rather than loading a second copy.
        _lib = _bind(ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL))
    return _lib


def _as_float32(samples: np.ndarray) -> np.ndarray:
    """Contiguous float32 view; the C side reads the buffer directly."""
    return np.ascontiguousarray(samples, dtype=np.float32)


def _ptr(samples: np.ndarray) -> ctypes.POINTER(ctypes.c_float):
    return samples.ctypes.data_as(ctypes.POINTER(ctypes.c_float))


class ParakeetModel:
    """One loaded GGUF model. Owns the context; outlives every stream from it."""

    def __init__(self, gguf_path: Path) -> None:
        lib = _load_library()
        ctx = lib.parakeet_capi_load(str(gguf_path).encode())
        if not ctx:
            raise ParakeetError(f"failed to load model {gguf_path}")
        self._lib = lib
        self._ctx = ctx

    def _take_string(self, raw: int | None) -> str:
        """Consume a malloc'd C string, freeing it even if decoding raises."""
        if not raw:
            raise ParakeetError(self.last_error() or "parakeet returned no string")
        try:
            return ctypes.cast(raw, ctypes.c_char_p).value.decode("utf-8", "replace")
        finally:
            self._lib.parakeet_capi_free_string(ctypes.c_void_p(raw))

    def last_error(self) -> str:
        err = self._lib.parakeet_capi_last_error(self._ctx)
        return err.decode("utf-8", "replace") if err else ""

    def transcribe(self, samples: np.ndarray, lang: str) -> str:
        """Whole-utterance decode. Used by the request/response endpoint."""
        buf = _as_float32(samples)
        return self._take_string(
            self._lib.parakeet_capi_transcribe_pcm_lang(
                self._ctx, _ptr(buf), len(buf), SAMPLE_RATE, _DECODER_DEFAULT,
                lang.encode(),
            )
        )

    def stream(self, lang: str) -> "ParakeetStream":
        handle = self._lib.parakeet_capi_stream_begin_lang(self._ctx, lang.encode())
        if not handle:
            raise ParakeetError(
                self.last_error() or f"model is not cache-aware streaming ({lang})"
            )
        return ParakeetStream(self, handle)

    def close(self) -> None:
        if self._ctx:
            self._lib.parakeet_capi_free(self._ctx)
            self._ctx = None


class ParakeetStream:
    """A cache-aware streaming session: state is kept across feeds.

    This is what makes the prefix monotone by construction — audio already
    consumed is never re-decoded, so text already emitted can never be revised.
    """

    def __init__(self, model: ParakeetModel, handle: int) -> None:
        self._model = model
        self._lib = model._lib
        self._handle = handle

    def feed(self, samples: np.ndarray) -> tuple[str, int]:
        """Push a chunk; return (newly finalized text, event bitmask).

        The text is only what was finalized by this call — callers append, they
        never replace.
        """
        if not self._handle:
            raise ParakeetError("feed on a closed stream")
        buf = _as_float32(samples)
        events = ctypes.c_int(0)
        raw = self._lib.parakeet_capi_stream_feed(
            self._handle, _ptr(buf), len(buf), ctypes.byref(events)
        )
        return self._model._take_string(raw), events.value

    def finalize(self) -> str:
        """Flush the tail. Returns the last newly finalized text, possibly ''."""
        if not self._handle:
            raise ParakeetError("finalize on a closed stream")
        return self._model._take_string(
            self._lib.parakeet_capi_stream_finalize(self._handle)
        )

    def close(self) -> None:
        if self._handle:
            self._lib.parakeet_capi_stream_free(ctypes.c_void_p(self._handle))
            self._handle = None

    def __enter__(self) -> "ParakeetStream":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()
