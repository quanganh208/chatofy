# Data Flow

Part of the [system architecture](../system-architecture.md).

## Data Flow

### Translation Pipeline (POST /translate)

1. **Client Request** → `@chatofy/api-client.apiFetch('/translate', schema)` with `{ audioBase64, audioMimeType, direction?, voiceGender?, speed? }` (`translateRequestSchema` in `packages/types/src/http/translate.ts`; `direction` defaults to vi→en, `voiceGender` to `female`, `speed` is clamped to 0.5–2)
2. **Request Validation** → `ZodValidationPipe` validates DTO
3. **Controller** (`TranslateController.translate()`) → Decode base64 audio, build the turn's `TurnLanguagePlan` with `planForDirection`, refuse with 503 `language_unavailable` if `SpeechLanguageSupport` says no configured engine serves it, then call the service
4. **Pipeline** (`PipelineTranslatorService.translateTurn(input, plan)`):
   - Build provider trio via `AiProvidersFactory.makeProviders()` — registry resolves each by kind, memoized per backend selection; every provider handles both languages, so the trio does not depend on direction
   - **STT:** transcribe in `plan.recognition` → `sourceText`
   - **Translation:** `translateAll` over `plan.targets` → a `TranslationMap`; `targetText` is the entry for `plan.spoken` (the selected provider walks its own model list on a quota rejection)
   - **TTS:** synthesize `targetText` in `plan.spoken` with `voiceGender`/`speed` → audio bytes; `audioMimeType` read from `provider.outputMimeType`
   - Return `{ sourceText, targetText, audioBase64, audioMimeType }`
5. **Response Wrapping** → `TransformInterceptor` wraps in envelope + metadata
6. **Client Parse** → `apiFetch` safeParse against schema; returns typed `TranslateResponse` or throws

### Streaming Turn (`/ws/translate`)

Same pipeline, different transport. Message bodies follow `clientEventSchema` /
`serverEventSchema` in `@chatofy/types`; Nest's `WsAdapter` wraps each one as
`{ event, data }` on the wire.

1. **`client.session.start`** → `TranslationSessionService.start()` opens a turn
   and answers `server.session.ready` with the id every later frame must carry.
   Carries the turn's `SessionOptions` — direction plus `voiceGender`, which is
   optional on the wire and defaults to `female` before it reaches the session
2. **`client.audio.frame`** (repeated) → raw PCM16 buffered. Frames are rejected
   if they name another session, change sample rate mid-turn, or fail to advance
   their sequence. Sequence _gaps_ are accepted: a client gating on voice
   activity only transmits while someone is speaking.

   Each frame also paces a **live transcript**: at most every 300ms the turn so
   far is re-read and pushed back as `server.transcript.partial`, so the speaker
   sees their words appear as they say them. Measured in a browser, the first
   words land ~630ms after speech starts and the line updates ~17 times over a
   6-second sentence. This is what keeps the screen alive during the wait; it
   does not make the translation arrive any sooner.

   Three properties are deliberate. The reading is driven by _arriving audio_,
   not a timer, so a client that vanishes mid-sentence stops it by itself — there
   is no loop to tear down. Only the newest 9s is re-read
   (`partial-transcript-scheduler.ts` — the client's 8s utterance ceiling plus
   its 320ms pre-roll, so the window covers a whole turn), so a tick costs the same on a long turn
   as a short one and the refresh rate does not decay. And a failed or empty
   read is swallowed: the turn is answered by `client.session.end` regardless,
   so a stumbling recogniser must not interrupt someone who is still talking.

   Measured cost of running it: 422 transcriptions across 32 turns left the
   whole-turn path unchanged — STT p50 58ms, max 136ms, against 58ms/102ms
   without it. The recogniser is shared between the live reads and the final
   one; a second instance was considered and the numbers said it was unnecessary.

   The settled part of the running transcript is also translated mid-sentence,
   streamed as `server.translation.delta` pieces and closed by a
   `server.translation.partial` carrying the full text — the listener reads an
   English sentence while the Vietnamese one is still being spoken. The trigger
   (`audio/live-translation-trigger.ts`) opens on speech PROGRESS, not on the
   clock: `LIVE_TRANSLATION_COMMIT_CHARS` (15) newly settled characters, a newly
   closed clause, or a correction to text already on screen, with one request in
   flight at a time and a per-user ceiling of `LIVE_TRANSLATION_RPM` (66) per
   minute (`session/turn-tuning.ts`). It used to wait for a turn to be three
   seconds old, which left the commonest 2.5-second sentence with no
   mid-sentence translation at all.

   No audio is ever synthesized from it. The sentence is unfinished, so the
   translation is a guess later speech can overturn — and a guess on screen can
   be replaced silently, while a guess spoken aloud cannot be taken back.

3. **`client.turn.speculate`** → sent on a short silence, before the endpoint is
   confirmed. Starts `transcribeAndTranslate()` on what is buffered so far, so a
   confirmed endpoint can find it ~350ms along. Nothing is sent back. The result
   is used only if no further audio arrived.

   Each pause **replaces** the previous guess, up to four per turn. It was one
   per turn until measurement showed that backwards: a guess only survives while
   nothing follows it, so on a turn where the speaker pauses and carries on, the
   single guess was spent on the first pause and could never be redeemed — the
   turn paid for it _and_ for a full translation at the end. Renewing costs the
   same two requests there and actually arrives with an answer. Only turns that
   pause three times or more cost more than before, and the cap bounds that.

   That last condition puts a requirement on the client, and it is load-bearing:
   **from the moment it sends this, it must stop transmitting** until either
   speech resumes or the turn ends. A client that keeps streaming the silence of
   its own hangover moves `bufferedBytes` past the snapshot on every turn, and
   the guess is then discarded every single time — the work is paid for and
   never used, with nothing failing to show it. `CapturePump` holds those blocks
   back instead (`packages/realtime-client/src/audio/capture-pump.ts`), releasing them into the
   snapshot just before the guess so word-final consonants are not clipped, and
   releasing them in order if the speaker turns out to be mid-sentence.

   How often the guess survives is a property of how people speak, not of the
   protocol. Measured over 32 synthesized Vietnamese turns it survived 19 —
   and it is worth what it costs: those turns reached first audio at a p50 of
   **870ms**, against **1760ms** for the ones that lost it. Renewing the guess at
   each pause rather than only the first would have saved all 32
   (`packages/realtime-client/src/audio/capture-pump.replay.spec.ts`). Synthesized speech pauses
   only where its punctuation says to, so 19/32 is a ceiling for the one-guess
   design rather than an estimate.

   The guesses that miss are not free: 35 turns cost 45 translation requests,
   a 22% overhead against a per-model per-minute ceiling.

4. **`client.session.end`** → the turn runs:
   - Buffered frames get a WAV header (`encodePcm16Wav`) — the STT sidecar
     decodes with PyAV, which opens a container and cannot read raw samples
   - `PipelineTranslatorService.transcribeAndTranslate()` — the text half only,
     reusing the speculated result when it is still valid
   - `server.transcript.final` carries the full `TranscriptSegment`
   - `synthesizeStream()` sends the **whole** translation to the local TTS
     sidecar's `POST /synthesize/stream`, and `session/streamed-speech-delivery.ts`
     puts each pcm16 chunk on the wire as it arrives, as `server.audio.frame`s of
     at most 200ms with monotonic sequence numbers. VieNeu streams frame by frame
     and Kokoro clause by clause, inside the sidecar. Measured on 15 en→vi turns,
     this took the median translation-to-first-audio segment from 586 ms to 231 ms
   - The clause path is the fallback: `splitIntoClauses()`
     (`audio/clause-splitter.ts`), then `synthesize()` **per clause**, each WAV
     unwrapped (`decodeWavToPcm16`) into the same frames. It speaks a turn when
     the backend has no stream (`synthesizeStream` absent, or a sidecar that
     answers 404 because it predates the endpoint), when the text is past the
     stream endpoint's 2000-character cap, and when the translation is blank
   - A Vietnamese stream holds its engine for the whole turn (seeded
     reproducibility), and a second turn in that language waits up to 15 s for
     it. Past that the sidecar answers `503` with `X-Engine-Busy`, and the turn
     ends **without audio** — reason `engine_busy`, transcript already
     delivered, metrics row `completed: false` — rather than failing. English
     takes the lock per clause, so it waits one clause per English turn ahead
     of it. The busy marker exists only before the first byte: a stream that
     loses the lock part-way through (several overlapping English turns with
     long clauses, pushing a between-chunk gap past the 15 s idle deadline) is
     recorded as `error`. See `services/local-tts/README.md`
   - A client that leaves while its stream is queued or playing aborts the
     request, which frees the engine for the next turn; the turn is recorded
     `abandoned`
   - `server.session.ended`
   - One `TurnMetrics` line per turn via `services/turn-metrics.recorder.ts`,
     logged (there is no file sink). Alongside the stage timings it
     carries which path spoke it (`ttsDelivery`: `stream` or `clauses`, beside
     `clauses`, which is 1 for a streamed turn) and what the turn spent:
     `speculations` and `liveTranslations`. Both are
     metered requests that buy a head start, and neither was visible in the
     latency table before — the saving showed in `firstAudioAtMs` while its cost
     sat in no column at all
5. **Failures** → `server.error`, then `server.session.ended` carrying the reason
   the turn actually ended for, and a metrics row flagged `completed: false`:
   - a pipeline fault (STT, translation, synthesis) closes with reason `error`,
     including a stream that breaks part-way or ends mid-sample
   - a busy speech engine is not a fault: see `engine_busy` above
   - a TTS backend that does not emit 16-bit PCM WAV (ElevenLabs returns
     `audio/mpeg`) is reported rather than framed into noise, and closes with
     reason `unsupported_audio` — the listener heard less than the whole turn, so
     neither the reason nor the metrics row may call it completed
   - a client that leaves part-way through delivery is told nothing and recorded
     nowhere, exactly like one that left before synthesis began. A row for it
     would be a turn whose last audio timestamp was cut short by the departure,
     which reads as an unusually fast turn

6. **Forced cuts** → the 8 s ceiling cuts continuous speech mid-clause, and
   each piece is translated before the next exists:
   - A turn opened within `MAX_CAPTURE_GAP_MS` (1200 ms) of a forced cut sends
     `continuesCut: true`. Its translation then carries the earlier speech
     whatever its length, with the cut turn last; the ≤ 4-word
     `needsPriorSpeech` gate still applies to every other turn. The server names
     the cut turn as the one opened just before it on the socket, and waits up
     to 1.5 s for that turn's text.
   - Live translation cannot repair a clause that completes the sentence already
     spoken, because the prompt forbids re-translating earlier speech. So the
     web client sends `client.block.retranslate { segmentIds }` for every
     display group of two or more pieces, and again each time it grows. The
     server joins the transcripts it produced itself for that socket
     (`session/finished-segments.ts`, last 24 segments; no client text reaches
     the model), translates them once with `FINAL_MODELS`, and answers
     `server.block.translated` (`session/block-retranslator.ts`). Every request
     is answered while the socket is open; a refusal (unknown segment, mixed
     plans, full queue, superseded, spent budget, failed call) is answered with
     empty `translations`. The budget has two tiers: 12 per user per minute, and
     48 per minute for the whole process (four users' worth, guarding the shared
     key pool); past the process tier every user's block requests are refused
     until the minute rolls over, while live translation keeps its own budget.
     One request runs per socket, and behind it one waits per block, keyed by
     its first segment, at most 11 blocks (what the per-user budget could still
     translate that minute). Segments are checked before a request
     is queued, so unknown ids are answered at once. A grown block supersedes
     its shorter self without displacing another block, and the superseded
     request is answered empty; an identical re-ask merges with the waiting copy,
     since the client keys blocks by their ids.
   - Answers are kept per block shape (`blockKey`). `groupTranslation` uses the
     longest answered shape that is a prefix of the group, so a block that
     shrinks when a speaker is named reads the answer for its new shape, and
     `toConversationTurns` saves it. When the run ends, a drain that is
     otherwise complete first calls `onDrained`, where the web client settles
     the transcript and asks for any block the settling formed (a voice placed
     only at the end can join turns into a new block), and the session waits for
     it. It then waits up to 3 s for unanswered blocks before the socket
     closes. A block that never gets an answer keeps the joined pieces, which is
     what was saved before. `sourceText` stays the recognizer's.
   - The display is repaired the same way. Each piece was restored as a
     complete sentence with nothing after it, so the joined pieces closed
     sentences at the cuts and misplaced marks a following clause would have
     settled ("của ngành. AI khi mà" for "của ngành AI khi mà" on a recorded
     news clip). The block's joined transcript is restored once beside its
     translation (`BLOCK_RESTORE_BUDGET_MS`, 1.5 s), given the translation's
     names, typeset by the same `typesetTranscript` a turn uses, and sent as
     `display` when the client asked for displays. `groupSourceText` shows the
     longest covering block display, and the save stores it as `displayText`.
     No restore answer, or one that changed a word, sends no `display`, and the
     pieces' own displays stay.
7. **Client metrics** → `client.turn.metrics` is sent once the turn has closed
   AND ordered playback has retired it, whichever comes later, and is flushed on
   `stop()` while the socket is still open. Filed at close, a turn whose audio
   was queued behind an earlier turn's had not sounded yet and was reported
   `no_audio`: 9 of 18 spoken turns in production on 2026-10-01.

REST is therefore **not** the same call: `translateTurn()` composes
`transcribeAndTranslate()` with a **single** `synthesize()` for the whole
utterance, which is what keeps it a like-for-like latency baseline — clause
splitting changes prosody at the seams.

**Error Handling:**

- `ProviderResponseError` (non-2xx/malformed) → `ServiceUnavailableException` (HTTP 503)
- `ProviderBusyError` (a `ProviderResponseError`: the sidecar's `503` with `X-Engine-Busy`) → `SpeechEngineBusyException`, still HTTP 503 with the same message on REST; a live turn ends with reason `engine_busy` instead of failing
- `ProviderConnectionError` (transport) → `ServiceUnavailableException` (HTTP 503)
- `ProviderConfigError` (missing keys) → `ServiceUnavailableException` (HTTP 503)
- `ProviderNotImplementedError` (unknown provider name selected) → `ServiceUnavailableException` (HTTP 503)
- No configured engine serves the turn's language → `LanguageUnavailableException` (HTTP 503, `SERVICE_UNAVAILABLE`, message passed through)
- No speech detected → `BadRequestException` (HTTP 400)
- All errors mapped by `AllExceptionsFilter` to error envelope

### AI Context, and the path a hint takes to the prompt

A saved **AI Context** is what the translator is told about a KIND of
conversation before it hears any of it: a name, a subject, terms to expect,
preferred renderings, and a register. It is authored on `/preferences`, picked
per conversation on `/translate` and in the extension popup, and it reaches the
model as fenced DATA, never as instruction.

The path, and the one thing about it that is not obvious:

1. The client stores only the **id** (`apps/web/src/lib/translate-settings.ts`,
   `apps/extension/src/settings.ts`). The content lives on the server.
2. The **client** resolves that id against the fetched list and maps it to
   `TranslationHints` (`apps/web/src/hooks/use-translation-contexts.ts`,
   `apps/extension/src/translation-contexts.ts`).
3. It travels on `client.session.start` as `sessionOptions.hints`
   (`packages/types/src/events/ws-events.ts`).
4. `TurnSession` holds it for the turn, and
   `packages/ai-providers/src/providers/gemini/prompt-builder.ts` renders it into
   the `<context>` block.

**The client resolves the id, not the server, and that is deliberate.**
`client.session.start` fires once per **TURN**, not once per conversation — see
`packages/realtime-client/src/conversation/turn-pipeline.ts`. A server that
looked the id up would read the row on every turn of every conversation, for a
value that cannot change mid-conversation because the picker is disabled while
one runs.

**The block is built up to five times per turn**, plus once more on the live
preview: four speculative passes
(`apps/api/src/modules/translate/session/translation-model-policy.ts`) plus the
final one (`translation-session.service.ts`), and
`apps/api/src/modules/translate/session/live-preview.ts` passes `session.hints`
wholesale. The preview is hinted on purpose — an unhinted preview and a hinted
spoken translation would disagree on a proper noun for the length of a turn,
which reads as the system changing its mind rather than as one of them being
unhinted. That is why `MAX_GLOSSARY` is 24 against `MAX_HOTWORDS`' 48: a pair
costs about what two hotwords cost.

**Glossary entries are keyed by LANGUAGE (`{vi, en}` today, a
`translationMapSchema` over the registry), never by role.** The
extension translates one meeting in BOTH directions at once from ONE settings
object — `apps/extension/src/meeting-capture.ts` starts a session on
`settings.direction` and another on `reverseDirection(settings.direction)` — so a
`{source, target}` pair would be applied backwards in one of them, with nothing
on screen to say so. Which side is the SOURCE is therefore a property of a
session, and `buildContextBlock(hints, sourceLanguage)` resolves it against the
direction it is given. It is also why no database constraint can express the
de-duplication: the row knows of no session, so a unique index would have to pick
a direction and would be wrong half the time.

A rendering is a choice the model may make when the transcript actually contains
the term, never a substitution and never a licence to insert either side into a
sentence that lacked it. The trusted system instruction says so, and
`benchmarks/prompt-injection` grades it by name against the live API —
`hint-glossary-not-inserted` is the case, and the harness needed a
containment-based `INSERTED` verdict to be able to see that failure at all.

**One rule in that instruction is Vietnamese-only.**
`buildTranslationInstruction` appends a note, only when `sourceLanguage ===
'vi'`, that the local recognizer writes everything in lowercase and spells
English by sound — including names and brands, as Vietnamese syllables — and
that the syllable "ai" collides with the Vietnamese question word for "who":
it renders "AI" when the surrounding words are about technology, software,
models or companies, and "who" when the sentence asks who a person is. This
exists because the recognizer's lowercase ASR output is a real, measured
source of mistranslation on that leg and on no other. Graded against the
production provider (`deepseek-flash`) with 4 turns of prior context: flagged
AI-context rows from two real sessions render `AI` 21/21 across 3 runs (the
note did not regress this pair — they already rendered correctly), 30/30
synthetic who-context observations keep a who-form with 0 flips, and the new
`là ai` prompt-injection attack cases pass 156/156 behavioural checks with 0
regressions against a same-day baseline. `"có phải là ai không"` — a yes/no
question frame, not the "who are you" frame — correctly keeps rendering "are
you an AI?" in an AI-topic conversation; that is the grammatically correct
reading of that shape and not a case the note is meant to flip.

**Two models hold it** (`apps/api/prisma/schema.prisma`).
`TranslationContext` is addressed by `@@unique([ownerId, clientId])` — the only
Prisma shape where omitting the owner does not compile, which is the lesson
`MeetingMinutes` records the cost of. `GlossaryTerm` is a CHILD TABLE rather than
parallel `String[]` columns, and the distinction from `keyPoints` is the
reason: a key point is ONE string, while an entry is several correlated strings
— one per language, held as a language-keyed `terms` JSON map — and parallel
arrays make a desynchronized pair representable. The precedent is
`ConversationTurn` — an ordered list of multi-field rows written as a unit by a
transactional replace — so `position` comes from the array index and the order
the operator authored is the order the prompt sees.

With no context selected, `hints` is absent, `buildContextBlock` returns `null`,
and the prompt is byte-identical to the one without this feature
(`packages/ai-providers/src/interfaces/translation-provider.ts`) — which is what
lets the recorded injection baseline keep describing the default path.

### Live mode on the same socket

`/ws/translate` carries a second, turn-less mode. A client that sends
`client.live.start` instead of `client.session.start` gets one upstream
speech-to-speech session (`client.live.audio` in; `server.live.transcript` and
`server.live.audio` out, until `client.live.stop`), served by `LiveTranslateSessionService` over the
`realtime` provider `gemini-live`. Which mode runs is purely a client choice —
`translateModeSchema` (`cascade` | `live`, default `cascade`) in
`packages/types/src/domain/translate-mode.ts`; the wire union is
`packages/types/src/events/live-ws-events.ts` and the client side is
`packages/realtime-client/src/transport/live-translate-socket.ts`. Everything
above describes the `cascade` mode.

### Standard Request/Response

1. **Client Request** → `@chatofy/api-client.apiFetch(path, schema)` with optional headers/init
2. **Request Validation** → NestJS `ZodValidationPipe` validates DTO against schema
3. **Controller Logic** → Raw return value (no manual wrapping)
4. **Response Wrapping** → `TransformInterceptor` wraps in envelope + metadata
5. **Client Parse** → `apiFetch` safeParse against schema; returns typed data or throws

**Error Path:**

- Validation/business logic error → `AllExceptionsFilter` maps to error envelope
- Client receives error envelope → `apiFetch` throws `ApiClientError` (with code/message) or `ContractError` (drift)

---
