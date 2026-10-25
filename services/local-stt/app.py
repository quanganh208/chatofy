"""Local STT HTTP sidecar.

Wraps sherpa-onnx behind a tiny FastAPI service so the NestJS API can transcribe
Vietnamese and English speech over localhost, with no cloud call. Both models are
loaded once at startup and kept warm; each engine serves several decodes at once
through a lane semaphore and refuses (503) rather than queues once every lane
has been busy past the wait budget — see engines/base.py for the measurements.

Model choices come from the measured comparison in
docs/development-journey.md.
"""
import os

# ONNX Runtime sizes its thread pool at import time, so these must be set before
# anything pulls in the engines — 8 (physical cores) beat 16 (hyperthreads).
_threads = os.environ.get("LOCAL_STT_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

import logging  # noqa: E402
from concurrent.futures import Future, ThreadPoolExecutor  # noqa: E402
from concurrent.futures import TimeoutError as FutureTimeout  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from threading import Event  # noqa: E402

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from audio.decode import AudioTooLongError, DecodeError, decode_to_16k_mono  # noqa: E402
from audio.silero_speech import SileroSpeechGate  # noqa: E402
from audio.speech_duration import speech_duration_ms  # noqa: E402
from engines.base import (  # noqa: E402
    SAMPLE_RATE,
    SttBusyError,
    stt_concurrency,
)
from engines.registry import (  # noqa: E402
    SUPPORTED_LANGUAGES,
    EngineRegistry,
    UnsupportedLanguageError,
)
from engines.word_pauses import lead_pause  # noqa: E402
from hotwords import build_hotwords  # noqa: E402
from lid.decider import decide_language, lid_enabled  # noqa: E402
from punctuation.registry import (  # noqa: E402
    PAUSE_LANGUAGES,
    PRIMARY_RESTORE_LANGUAGE,
    RESTORERS,
)
from punctuation.restorer import RestorerBusyError  # noqa: E402
from speaker.embedder import SpeakerEmbedder  # noqa: E402

registry = EngineRegistry()
embedder = SpeakerEmbedder()
speech_gate = SileroSpeechGate()
# The Vietnamese restorer, bound by name because `/healthz` reports it and the
# tests drive it directly. The same object as `RESTORERS["vi"]`, never a second
# Dewpoint.
restorer = RESTORERS[PRIMARY_RESTORE_LANGUAGE]

log = logging.getLogger(__name__)

#: How long the response waits for the alternate once the primary is done.
#: The transcript is the turn's critical path and the alternate only a display
#: enhancement, so it gets a bounded wait, never the caller's whole budget:
#: measured on 95 real turns, the alternate finished at most 287 ms after the
#: primary (p95 100 ms). Past this the turn answers without it. Also caps the
#: alternate's own lane wait: a decode that could not start within this long is
#: unlikely to finish in time to be read.
ALTERNATE_WAIT_MS = float(os.environ.get("LOCAL_STT_ALTERNATE_WAIT_MS", "400"))

#: Runs the alternate decode while the request thread runs the primary one, so
#: a turn asking for both pays the slower of the two rather than their sum.
#: Twice the lanes, so a waiting task reaches the engine's own lane wait — which
#: refuses after the wait above — instead of queueing unseen in here.
_alternate_pool = ThreadPoolExecutor(
    max_workers=2 * stt_concurrency(), thread_name_prefix="stt-alternate"
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Order matters and is not cosmetic: `load_all` runs the onnxruntime preload
    # that must precede any `import sherpa_onnx`, and the extractor's and the
    # gate's load both import it. Reversed, the process aborts with no Python
    # traceback.
    registry.load_all()
    embedder.load()
    speech_gate.load()
    # Last, and allowed to stay unloaded: see `DisplayRestorer.load`.
    for display_restorer in RESTORERS.values():
        display_restorer.load()
    try:
        yield
    finally:
        for display_restorer in RESTORERS.values():
            display_restorer.unload()
        speech_gate.unload()
        embedder.unload()
        registry.unload_all()


app = FastAPI(title="local-stt-sidecar", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> JSONResponse:
    # The extractor and the speech gate both count towards readiness. A
    # sidecar reporting ok while it cannot embed, or while `min_speech_ms`
    # would 503 on the gate never having loaded, would have callers
    # discovering that one turn at a time.
    ready = registry.ready and embedder.loaded and speech_gate.loaded
    return JSONResponse(
        {
            "status": "ok" if ready else "loading",
            # Static from `SUPPORTED_LANGUAGES`, not from load state: the API's
            # `SpeechLanguageSupport` reads this to decide which turns it can
            # serve, and a caller doing that has to get the same answer whether
            # or not the models have finished loading — the body is read
            # regardless of the 503 above for exactly that reason.
            "languages": list(SUPPORTED_LANGUAGES),
            # Reported, never gating: a sidecar that cannot restore still
            # transcribes, and the API falls back to the numerals-only display.
            "restore": restorer.loaded,
            # Reported, never gating, for the same reason: without an
            # alternate the display is exactly what it was before one existed.
            "alternates": registry.alternate_languages,
            # What a request's `candidates` may name: empty while identification
            # is off, unseeded or failed to load, and then such a request is a
            # 409. Never gating, like the two above.
            "lidLanguages": registry.lid_languages,
        },
        status_code=200 if ready else 503,
    )


@app.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    language: str = Form(...),
    # Repeated form fields rather than one delimited string: sherpa-onnx
    # separates hotwords with "/", and a caller's term containing one would
    # silently become two terms instead of being rejected or escaped.
    hotwords: list[str] = Form(default=[]),
    # 0 (the default) is today's path: no VAD call, no `speechMs` in the
    # response, engine cost unchanged. Above 0, speech is measured FIRST and a
    # clip under the floor returns empty text without ever reaching the
    # engine — the caller decided the turn is not worth decoding, and paying
    # for the decode anyway would defeat the point of asking.
    min_speech_ms: int = Form(default=0),
    # Off (the default) is today's response byte for byte: no second decode,
    # no `alternates` key. On, and with an alternate recognizer loaded for the
    # language, its unbiased reading of the same samples comes back as
    # `alternates: [text]` for the API to fuse into the display. Absent on any
    # failure of that second decode — the transcript never depends on it.
    alternates: bool = Form(default=False),
    # Empty (the default) is today's path and today's response byte for byte.
    # Two or more, including `language`: the sidecar decides which one the turn
    # is in, decodes it with that language's engine, and answers that
    # `language` with `languageConfidence` — the chosen candidate's probability,
    # or null when identification was too busy to run and `language` is the
    # declared one decoded as asked. Identification never sees the hotwords:
    # they name what the conversation expects, and biasing the decision with
    # them would answer the question it was asked to settle.
    candidates: list[str] = Form(default=[]),
) -> dict:
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models not loaded")

    # Reject an unusable language before spending time on decoding.
    try:
        engine = registry.get(language)
    except UnsupportedLanguageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    if candidates:
        _check_candidates(language, candidates)

    try:
        samples = decode_to_16k_mono(file.file.read())
    except AudioTooLongError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    speech_ms: int | None = None
    if min_speech_ms > 0:
        try:
            speech_ms = speech_gate.speech_ms(samples)
        except SttBusyError as err:
            raise HTTPException(status_code=503, detail=str(err)) from err
        if speech_ms < min_speech_ms:
            # Gated quietly: no engine call, no hotword build. The caller
            # (PipelineTranslator) turns this into a quiet turn end rather
            # than the `turn_failed` banner an ungated empty decode gets.
            return {"text": "", "language": language, "speechMs": speech_ms}

    # Asked first and on its own lanes, so the alternate below and the decode
    # both know the language. Busy means the declared language, decoded as asked
    # and reported unsure, rather than a 503 for a turn that can still be read.
    declared = language
    confidence: float | None = None
    if candidates:
        try:
            decision = decide_language(registry.lid, samples, candidates)
        except SttBusyError:
            log.warning("language identification busy; decoding the declared %s", declared)
        else:
            language, confidence = decision.language, decision.confidence
            engine = registry.get(language)

    # Sync endpoint runs in FastAPI's threadpool; the engine's lanes bound how
    # many decodes overlap. Saturation is a refusal, not a queue: a caller
    # waiting on a turn would rather hear 503 now than an answer too late to
    # speak. (The api maps this to ProviderResponseError and fails its turn.)
    # Empty for a request that named nothing, which is what keeps an ordinary
    # turn on the decoder every published number for this model was measured
    # with. An engine that cannot be biased is handed nothing either way.
    terms = build_hotwords(hotwords) if engine.supports_hotwords else ""

    # Started BEFORE the primary decode so the two overlap. Never handed the
    # hotwords: it is an independent reading, and biasing both towards the same
    # terms would make them agree for the wrong reason. After identification, so
    # a turn identified as another language never starts one; read only if the
    # decode stays in the alternate's language.
    alternate_engine = registry.alternate(language) if alternates else None
    alternate_language = language
    # Set once the response no longer wants the alternate — answered, gave up
    # waiting, or failed. A queued alternate is cancelled outright; one already
    # waiting in the engine's lane wait sees this when it gets the lane, and
    # gives the lane back instead of running a decode nobody reads.
    abandoned = Event()
    alternate: Future[str] | None = (
        _alternate_pool.submit(
            alternate_engine.transcribe,
            samples,
            lane_wait_ms=ALTERNATE_WAIT_MS,
            abandoned=abandoned,
        )
        if alternate_engine is not None
        else None
    )

    try:
        try:
            text, pauses = _decode(engine, language, samples, terms)
        except SttBusyError as err:
            if language == declared:
                raise HTTPException(status_code=503, detail=str(err)) from err
            # The identified language's engine is full; the declared one may not
            # be, and its reading is a turn rather than a refusal.
            log.warning("%s engine busy; decoding the declared %s", language, declared)
            language, confidence, engine = declared, None, registry.get(declared)
            terms = build_hotwords(hotwords) if engine.supports_hotwords else ""
            try:
                text, pauses = _decode(engine, language, samples, terms)
            except SttBusyError as busy:
                raise HTTPException(status_code=503, detail=str(busy)) from busy
        result = {"text": text, "language": language}
        if candidates:
            result["languageConfidence"] = confidence
            # How much speech the decision heard, by the measure its lock
            # threshold was tuned on (`speech_duration_ms`, not the Silero gate
            # behind `speechMs`): a caller locking a partial on "confident and
            # at least 1.5 s of speech" needs the second half in those units.
            result["lidSpeechMs"] = speech_duration_ms(samples)
        if speech_ms is not None:
            result["speechMs"] = speech_ms
        if pauses is not None:
            result["pauses"] = pauses
            # The silence before the first word: where a piece was cut out of
            # continuous speech, the pause at the cut is split between the end of
            # one piece and the start of the next, and a caller joining them adds
            # the two.
            result["leadPause"] = lead_pause(samples, SAMPLE_RATE)
        if alternate is not None and alternate_language == language:
            try:
                result["alternates"] = [alternate.result(timeout=ALTERNATE_WAIT_MS / 1000)]
            except FutureTimeout:
                # Queued or slow; the caller abandons it, so it never decodes late.
                log.warning("%s alternate decode late; answering without it", language)
            except SttBusyError:
                # An alternate the engine refused is a turn whose display is not
                # fused, not a turn that failed — and expected under load.
                log.warning("%s alternate decode refused, lanes busy", language)
            except Exception:  # noqa: BLE001 — the transcript must never fail on the alternate
                log.warning("%s alternate decode failed; answering without it", language, exc_info=True)
        return result
    finally:
        abandoned.set()
        if alternate is not None:
            alternate.cancel()


def _check_candidates(language: str, candidates: list[str]) -> None:
    """400 for a malformed list, 409 when there is nothing to identify with."""
    if len(candidates) < 2 or len(set(candidates)) != len(candidates) or language not in candidates:
        raise HTTPException(
            status_code=400,
            detail="candidates must be two or more distinct languages, including `language`",
        )
    unknown = [lang for lang in candidates if lang not in SUPPORTED_LANGUAGES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"unsupported candidates {unknown}")
    if not lid_enabled() or registry.lid is None:
        raise HTTPException(status_code=409, detail="language identification not enabled")
    if any(lang not in registry.lid_languages for lang in candidates):
        raise HTTPException(status_code=409, detail="language identification not enabled")


def _decode(engine, language: str, samples, terms: str) -> tuple[str, list[int] | None]:
    # The language the display restorer serves also gets the silence after
    # each word: the restorer reads text only, and a full stop where the
    # speaker never paused ("anh Tuấn. Anh…" for the name "Tuấn Anh") is
    # only visible in the audio. Absent when the tokens did not line up.
    if language in PAUSE_LANGUAGES:
        return engine.transcribe_with_pauses(samples, terms)
    return engine.transcribe(samples, terms), None


@app.post("/embed")
def embed(file: UploadFile = File(...)) -> dict:
    """One utterance in, one unit-norm speaker vector out, and how much voice it heard.

    Separate from `/transcribe` rather than a flag on it, and the reason is
    ordering rather than tidiness. Translation cannot start until it has the
    transcript text, so an embedding riding along in that response would land
    its cost BEFORE the translation instead of beside it. A second localhost
    upload of a few-second clip costs single-digit milliseconds; the merge would
    buy a serialization to save roughly nothing.

    No `language` field: the model is trained across languages and the caller
    would only be guessing anyway on a turn nobody has transcribed yet.
    """
    if not embedder.loaded:
        raise HTTPException(status_code=503, detail="speaker extractor not loaded")

    # Same decoder and the same two failures as /transcribe. The length cap is
    # inherited deliberately rather than tuned for this endpoint: a turn is a few
    # seconds, so nothing here approaches it, and a second limit to keep in step
    # would be a second thing to get wrong.
    try:
        samples = decode_to_16k_mono(file.file.read())
    except AudioTooLongError as err:
        raise HTTPException(status_code=413, detail=str(err)) from err
    except DecodeError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    vector = embedder.embed(samples)
    # Measured here rather than by the caller, off the samples that produced the
    # vector, because this is the only place both exist. The API holds encoded
    # bytes, and the duration the browser could report is buffer time — pre-roll
    # and hangover counted as speech. A caller deciding whether the vector
    # carries any speaker information at all needs the speech. On the
    # conversation this was measured against the two differ by more than a factor
    # of two on exactly the turns where the difference decides the answer.
    return {
        "vector": vector,
        "dim": len(vector),
        "speechMs": speech_duration_ms(samples),
    }


class RestoreRequest(BaseModel):
    """One finished transcript to typeset for display.

    Bounded like every other input here: the API sends one turn, which the
    gate caps at a few seconds of speech, so these limits only ever refuse a
    caller that is not that API.
    """

    text: str = Field(max_length=4000)
    language: str
    #: The piece this one continues, for a turn that opened on a forced cut.
    context: str = Field(default="", max_length=4000)
    #: The session's hotwords; only mixed-case single words are used.
    terms: list[str] = Field(default=[], max_length=48)
    #: Silence after each word of `text` in ms, as `/transcribe` returned it.
    #: A full stop where the speaker did not pause is dropped; a list that does
    #: not match the words is ignored.
    pauses: list[int] | None = Field(default=None, max_length=2000)


@app.post("/restore")
def restore(body: RestoreRequest) -> dict:
    """Punctuation (and for vi, case) for a transcript, for display only.

    Its own endpoint rather than part of `/transcribe` for the reason `/embed`
    is: the caller starts it beside the translation, which cannot begin until
    the transcript exists, so riding in that response would put its cost in
    front of the translation instead of next to it.
    """
    chosen = RESTORERS.get(body.language)
    if chosen is None:
        raise HTTPException(
            status_code=400, detail=f"restore serves {', '.join(RESTORERS)} only"
        )
    if not chosen.loaded:
        # 503 for the primary restorer, as it always was. A secondary model
        # that did not load answers 404 (below).
        if body.language == PRIMARY_RESTORE_LANGUAGE:
            raise HTTPException(status_code=503, detail="display restorer not loaded")
        # 404: the API reads it as "no restorer here" and stops asking for a
        # minute — for THIS language only, since its cooldown is per language —
        # instead of sending a doomed request and a warning on every zh turn.
        raise HTTPException(status_code=404, detail=f"restore for {body.language} not loaded")
    try:
        return {"text": chosen.restore(body.text, body.context, body.terms, body.pauses)}
    except RestorerBusyError as err:
        # 429, not 503: the API reads 503 as "not loaded" and stops asking for a
        # while, which a momentary queue must not trigger.
        raise HTTPException(status_code=429, detail=str(err)) from err
