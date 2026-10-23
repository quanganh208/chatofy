# Contracts, Envelope and Languages

Part of the [system architecture](../system-architecture.md).

## Type Contract Standard

**Single source of truth** for types across API, web, and mobile. Zod schemas define shape + validation; TypeScript types are `z.infer` of the schema. This eliminates duplication, enforces runtime contracts, and powers Swagger auto-generation.

### Package Layout

**`@chatofy/types`** (`packages/types`)
Dual-build (CommonJS + ESM via tsup) to support both NestJS (CJS) and frontend frameworks (ESM).

- `src/domain/*` — Entity schemas (userSchema, conversationSchema, transcriptSegmentSchema, meetingMinutesSchema, enum unions) and the language registry (`languages.ts`, below)
- `src/http/*` — Wire contracts for HTTP endpoints:
  - `response.ts` — Response envelope: errorCodeSchema, apiMetaSchema, apiErrorSchema; factory functions `apiSuccessSchema(dataSchema)` and `apiResponseSchema(dataSchema)` for wrapping data; type helpers `ApiResponse<T>` and `ApiSuccess<T>`
  - `auth.ts` — Auth endpoints: loginRequestSchema, registerRequestSchema, verifyEmailRequestSchema, forgotPasswordRequestSchema, resetPasswordRequestSchema, googleLoginRequestSchema, authTokenSchema, authSessionSchema, authMessageSchema (the one response shape register/verify/forgot/reset share, so they cannot drift into answering differently)
  - `meta.ts` — Root service descriptor for GET /: serviceDescriptorSchema
  - `translate.ts`, `conversations.ts`, `minutes.ts`, `translation-contexts.ts` — the other endpoint groups (same Request/Response naming)
- `src/events/*` — WebSocket zod schemas (imports canonical domain schemas, e.g., transcriptSegmentSchema)

Naming convention: wire contracts use `Request`/`Response` suffix (NOT `Dto`).

**Build:** `tsconfig.json` inherits `composite: true` from the shared base preset (`packages/config/tsconfig/base.json`); no consumer references it as a TypeScript project today — `@chatofy/ai-providers` typechecks against the built `.d.ts`. Build via `tsconfig.build.json` (non-composite) with tsup (generates `.cjs`, `.js`, dual `.d.ts`/`.d.cts`).

**Why dual-build:** API is CommonJS (NestJS with `require()`) and cannot consume ESM-only packages. Dual export ensures both CJS `require()` and ESM `import` work.

**`@chatofy/api-client`** (`packages/api-client`)
Framework-agnostic client for runtime contract validation.

- `createApiClient({ baseUrl, timeoutMs, getHeaders })` — factory returns client instance
- `.apiFetch(path, dataSchema, init?)` — **SINGLE response-parse boundary**
  - `safeParse` against response envelope (validates entire structure)
  - Returns typed data on success or throws:
    - `ApiClientError` — API returned error envelope (e.g., 400 with code=VALIDATION_FAILED)
    - `ContractError` — response shape drifted from schema (e.g., missing field, wrong type)
    - `NetworkError` — transport failure (network, DNS, timeout, abort); carries `timedOut` flag + `cause`
  - Handles 204 No Content (parses `undefined` against the data schema, so a void-able schema succeeds)
  - Status-first error branching: non-JSON 5xx → `ApiClientError` with real HTTP status (not `ContractError`)
  - AbortController timeout (30s default); timeout timer covers body read
- Memoizes envelope schema per data schema for performance

Also dual-built via tsup for frontend+Node compatibility.

### Recipe: Per-Endpoint Contract

1. **Define request + response schemas** in `@chatofy/types/src/http/{domain}.ts`:

   ```typescript
   import { z } from 'zod';

   export const updateUserRequestSchema = z.object({
     name: z.string().min(1),
     email: z.string().email(),
   });
   export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

   export const userResponseSchema = z.object({
     id: z.string().uuid(),
     name: z.string(),
     email: z.string().email(),
     createdAt: z.date(),
   });
   export type UserResponse = z.infer<typeof userResponseSchema>;
   ```

2. **API (NestJS):** Import from root `@chatofy/types` barrel (moduleResolution:node ignores exports subpaths):

   ```typescript
   import { updateUserRequestSchema, userResponseSchema } from '@chatofy/types';

   export class UpdateUserDto extends createZodDto(updateUserRequestSchema) {}
   export class UserResponseDto extends createZodDto(userResponseSchema) {}

   @Patch('/users/:id')
   @ApiEnvelopeResponse(UserResponseDto)
   async updateUser(
     @Param('id') id: string,
     @Body() dto: UpdateUserDto
   ): Promise<UserResponse> {
     // dto validated by pipe; return data (TransformInterceptor wraps in envelope)
   }
   ```

3. **Mobile + Web clients:** Use `@chatofy/api-client`:

   ```typescript
   import { createApiClient } from '@chatofy/api-client';
   import { userResponseSchema } from '@chatofy/types';

   const api = createApiClient({
     baseUrl: env.apiUrl,
     getHeaders: () => ({ Authorization: `Bearer ${token}` }),
   });

   const user = await api.apiFetch('/users/123', userResponseSchema);
   // user: UserResponse (typed + runtime-validated)
   // throws ApiClientError or ContractError on failure
   ```

### Enforcement

- **Compile-time:** `pnpm turbo run typecheck` catches type drift (schema ↔ usage)
- **Runtime:** Client `safeParse` catches shape/data drift at parse boundary
- **Test coverage:** E2E tests verify envelope structure + client error handling

### Caveats

- **Error message sanitization** is enforced by `AllExceptionsFilter` (5xx → generic, 4xx → sanitized), NOT by schema. Document in exception handling, not types.
- **API imports** pull from root barrel only (`@chatofy/types`, NOT subpaths like `@chatofy/types/http`). Ensures consistency; NestJS uses `moduleResolution: "node"` which ignores TypeScript `exports` subpaths.
- **Output schemas stay permissive** (e.g., don't require all fields) so legacy API responses don't break client parsing. Input schemas strict (validate format, required fields).

---

## Response Envelope Architecture

All HTTP responses (except `/health*` probes) follow a standard envelope with metadata and error handling.

**Success (2xx)**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_<uuid>|custom",
    "timestamp": "2026-06-05T...",
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}
```

**Error (4xx/5xx)**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL_ERROR|SERVICE_UNAVAILABLE",
    "message": "Human-readable message",
    "details": [{ "path": "field.nested", "message": "error reason" }]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

### Implementation

- **Envelope type:** `ApiResponse<T>` (packages/types/src/http/response.ts)
- **Success wrapping:** `TransformInterceptor` (apps/api/src/common/interceptors/transform.interceptor.ts)
  - Wraps raw controller returns in `{ success: true, data, meta }`
  - Skips WebSocket contexts and `/health*` routes
- **Error handling:** `AllExceptionsFilter` (apps/api/src/common/filters/all-exceptions.filter.ts)
  - Maps HTTP status → stable `ErrorCode` (401→UNAUTHORIZED, 404→NOT_FOUND, etc.)
  - Extracts field-level validation errors from `ZodValidationException`
  - Returns real HTTP status codes (not 200 + success:false) for proper proxy/cache/monitoring behavior
- **Validation:** Global `ZodValidationPipe` (registered in common.module.ts)
  - Request DTOs created via `createZodDto(schema)` from `@chatofy/types`
  - Validation failures → `error.code=VALIDATION_FAILED` with details array
- **Registration:** All via DI providers in `CommonModule` (apps/api/src/common/common.module.ts)
  - APP_INTERCEPTOR, APP_FILTER, APP_PIPE ensure consistent pipeline

### Request Tracing

`requestIdMiddleware` (apps/api/src/common/middleware/request-id.middleware.ts) assigns per-request correlation id:

- Honors inbound `x-request-id` header ONLY if it matches `^[A-Za-z0-9_-]{1,64}$` (prevents injection)
- Generates `req_<uuid>` otherwise
- Echoed in response `x-request-id` header and `meta.requestId`

### Swagger / OpenAPI

API documentation available at `/docs` (non-production only):

- **Setup:** `setupSwagger()` (apps/api/src/common/swagger/setup-swagger.ts)
- **Mounted when:** `NODE_ENV !== 'production'`
- **URL:** http://localhost:3000/docs
- **Schema cleanup:** nestjs-zod `cleanupOpenApiDoc` plugin ensures `createZodDto` schemas render correctly

#### Documenting Endpoints

Use `ApiEnvelopeResponse(DataDto)` helper (apps/api/src/common/swagger/api-envelope-response.helper.ts):

```typescript
import { ApiEnvelopeResponse } from '@common/swagger/api-envelope-response.helper';

@Get('/users/:id')
@ApiEnvelopeResponse(UserResponseDto)
getUser(@Param('id') id: string): Promise<UserResponse> { ... }
```

This documents the response as the standard envelope with the given data type.

---

## Languages

**One registry, `LANGUAGES` in `packages/types/src/domain/languages.ts`, is the
only place in the monorepo that knows which languages exist.** Every language
pair, every schema that validates a language code, and every rule that maps
between languages is derived from it — nothing else may spell `'vi'` or `'en'`
as a branch condition. The
module's own file header states this and explains why; read it before adding
anything nearby.

**Data plus pure functions, deliberately not a class per language.** A
conversation declares its languages as a plain `LanguagePair`
(`{ source, target }`, field `languagePair`) across the socket, `localStorage`
and React state, and Postgres stores them as `Conversation.languages`
(`pairLanguages(pair)`, declared source first) — a class instance would not
survive a serializer on that path. A pair is an object, so two equal pairs are
never `===`: compare with `samePair`, and keep a pair used as an effect
dependency in state rather than building it during render. It replaced the
`${source}_to_${target}` direction string so that `source` could widen to
"detect it" without a second wire format, and on the streaming socket it now
has: `SessionLanguagePair` (`sessionLanguagePairSchema`) allows `source:
'detect'` (`AUTO_DETECT`). It is a separate type rather than a widening of
`LanguagePair`, because only the WebSocket session path can serve an undeclared
source; REST, live and every stored record keep the two-codes pair, so none of
them has to narrow a value that can never reach them. "OOP" in this codebase, for languages, means
**encapsulation** (one module owns the knowledge) **plus strategy**
(`LanguageTable<T>`, the provider interfaces, `LanguageIdentifier`) — not
inheritance. There is no `class Vietnamese extends Language`, and there should
never be one: `packages/types` depends only on `zod`, and a language-specific
class hierarchy would need to live somewhere with real behaviour to attach to,
which the registry itself does not have. A class is the right tool only where
there is actual state to hold across calls — `SpeechLanguageSupport` below is
one, because it caches a probe result between turns; the registry, and the
`LanguageIdentifier` default implementation, hold no state at all.

**`LanguageTable<T>`** (`Readonly<Record<LanguageCode, T>>`) is the strategy
table this rule is built around: a value for EVERY registry language, no
fallback. Adding a language to `LANGUAGES` turns every `LanguageTable` in the
codebase into a compile error until it has an entry — this is what "the
compiler lists the work" means in practice, and the spike below measures
exactly how far that reaches. Production uses today:

- `BY_LANGUAGE` (`packages/ai-providers/src/text/inverse-normalize-transcript.ts`)
  — each language's ITN, as a function (zh is a character scanner, not a
  `LanguageItn` rule table);
- `RECOGNIZER_NOTES` (`prompt-builder.ts`) — what each source language's
  recognizer gets wrong, appended to the translation instruction;
- `SCRIPTS` (`packages/ai-providers/src/text/translation-script.ts`) — the script
  a translation into each language is displayed in, and what counts as a leak;
- `RESPELLS_LOANWORDS` (`translation-session.service.ts`),
  `REPAIRS_HOMOPHONES` and `FUSES_RECOGNIZERS` (`pipeline-translator.service.ts`)
  and `RESTORED_RECOGNITION` (`display-restore-request.ts`) — which recognition
  languages get a loanword respelling, a homophone repair, a second recognizer
  fused into the display, and a display restore;
- `LIVE_LANGUAGES` (`packages/types/src/domain/translate-mode.ts`) — which
  languages the live mode serves, read by the gateway and the extension picker;
- `LIVE_TRANSLATION_COMMIT_CHARS` (`session/turn-tuning.ts`) — settled
  characters per provisional translation, per recognition language;
- the per-language voice-token schema (`storedVoiceSelectionSchema` in
  `apps/web/src/lib/translate-settings.ts`) and the AI Context editor's glossary
  row (`GlossaryRow` in `apps/web/src/components/preferences/ai-context-draft.ts`).

**The rule this whole section exists to state: no branching on a language code
outside a `LanguageTable`.** A `=== 'vi'`/`'en' ===` comparison is either a
missing registry function or a missing `LanguageTable` entry — never a
shortcut. The check that enforces it catches `!==` and array
literals too, which the older `=== '(vi|en)'` pattern missed:

```bash
git grep -nE "[!=]==\s*'(vi|en|zh)'|'(vi|en|zh)'\s*[!=]==|\[\s*'(vi|en|zh)'\s*\]" \
  -- apps packages ':!*.spec.ts' ':!*.spec.tsx' ':!apps/api/prisma/**' ':!apps/api/test/**'
```

It finds nothing in production code: the last three hits (the Vietnamese
recognizer note, the loanword-respelling gate and the restore language list)
became `RECOGNIZER_NOTES`, `RESPELLS_LOANWORDS` and `RESTORED_RECOGNITION` when
zh joined. Specs and e2e tests use literals freely, and the Prisma schema
comments and migration SQL record the dropped `direction` column. Defaults are
built with `languagePairOf` / `DEFAULT_LANGUAGE_PAIR` rather than spelled. The
old `'vi_to_en'` string survives in exactly one parser,
`languagePairFromStoredDirection` (`packages/types/src/domain/stored-language-pair.ts`),
which the web and extension settings readers call so a setting saved before the
pair existed is not silently reset; no wire schema accepts it. The
interface-locale axis (`common.language.*`, `locale-switcher.tsx`) is a
different axis entirely, see below.

### What a turn decides, and in what order

**`TurnLanguagePlan`** (`apps/api/src/modules/translate/session/turn-language-plan.ts`) is what one turn does, language-wise: the conversation's full language set, what the turn was
actually spoken in (`sourceLanguages`), every language it must be translated
into (`targets`), which one its audio is recognised in (`recognition`, today
always `sourceLanguages[0]` — one STT engine per language cannot read a mixed
utterance in one pass), and which one its translation is spoken aloud in
(`spoken`, `targets[0]` — TTS for every target at once is a deferred seam, see
below — or `null` for an auto-detected turn heard in its own target, which is
transcript only). Everything downstream reads the plan instead of re-deriving
anything from the pair. A declared turn's plan is built once, before any audio,
by `planForPair(languagePair, identifier)` (a wrapper over
`planTurnLanguages`); `TranslateController.translate()` calls the same helper
for REST, which therefore never identifies anything.

**`TurnLanguageDecision`** (`session/turn-language-decision.ts`) is what a
WebSocket turn reads its plan through, so `TurnSession.languages` is a getter
(`decision.plan`), not a field. A declared turn's decision is fixed at
construction (`declaredDecision` in `turn-session.ts`) and never changes. A
two-way or detect turn's decision is late-bound, in three steps:

1. **Held.** Partials carry text but no language, and no live translation runs.
   Showing every partial's guess flipped the label on about 38% of
   conversational turns in the bake-off.
2. **Locked.** The first partial at or above `LID_LOCK_CONFIDENCE` with at
   least `LID_LOCK_MIN_SPEECH_MS` of the sidecar's `lidSpeechMs` fixes the
   language for the rest of the partials and for live translation; the
   streaming committer restarts from nothing (`TurnSession.resetCommitter`),
   because text read in the provisional language shares no prefix with the
   locked one.
3. **Final.** Re-decided on the whole turn, always (`decideFinal`). It may
   overrule the lock, which is the only way a turn's label changes. Below
   `LID_UNCERTAIN_BELOW` the final falls back to the decided language of the
   turn opened before it (`ConversationContext.languageOf`), then to the
   declared source; a detect turn with neither keeps what it heard.

The lock serves only the preview: the gate scored final accuracy on the whole
turn, so letting a prefix decide the final would ship a policy nobody measured.
A speculation asks `peekFinal`, which decides nothing, and its result is reused
only if the final, asked at the endpoint, agrees; a split turn is decided once,
on the whole turn, before its pieces are translated. The thresholds and why
they hold their values are in `session/turn-tuning.ts` (`LID_*`).
`SourcePrior` is the per-socket lean towards the declared source; its bonus,
`LID_SOURCE_PRIOR_LOGODDS`, is zero because that is what the tuning chose, so
leaning towards the source is today the fallback's job. A prior per voice was
not built: the bake-off found it added nothing held out.

`TranslationSessionService.start()` checks every candidate's plan
(`decision.planIn`) against `SpeechLanguageSupport` before the turn exists, so
any language the turn may turn out to be in is one the engines serve. The
speaker role follows the decided language (`speakerRoleFor` on
`plan.recognition`), not the voice.

**`LanguageIdentifier`** (`apps/api/src/modules/translate/session/language-identifier.ts`) is the DI seam `planForPair` asks which language(s) a
declared turn was spoken in, with the language the CLIENT declared, not with
audio. `DeclaredLanguageIdentifier` is still the only implementation, bound to
`LANGUAGE_IDENTIFIER` in `translate.module.ts` and used as `TurnSession`'s
default: it trusts the declaration outright and returns exactly one code.
Audio identification did not go behind this seam. It runs inside the STT
sidecar, in the same `/transcribe` call that decodes the turn, so a decision
costs no extra round trip and the decode uses the engine of the language just
decided; see below.

### LID and audio-based detection

A streaming session runs in one of three modes (`sessionLanguageModeSchema`):

- **`declared`** — the source the client named, one way. Every session that
  does not ask for more, and every session from a client older than this.
- **`two-way`** — `client.session.start` with a concrete pair and
  `twoWay: true`. The pair is a set: each turn is identified as one of its two
  languages and translated into the other.
- **`detect`** — `languagePair.source: 'detect'`. Each turn is identified among
  `IDENTIFIABLE_LANGUAGES` and translated into the fixed target; a turn heard in
  the target is transcript only (`planDetectTurn` gives it no target), closes
  as `voice_off`, gets no live translation, and is not remembered as context.

The candidates a turn chooses between are `turnCandidates(pair, twoWay)`.
`IDENTIFIABLE_LANGUAGES` (`packages/types/src/domain/languages.ts`) holds vi
and en: zh missed the accuracy bar the vi↔en pair met on the same labelled
set, so a pair with zh stays declared one-way and the web picker offers neither
two-way nor auto-detect with it. The choice of identifier and the numbers are
in `benchmarks/lid/README.md` and the development journey.

**Admission** is decided once per start, by `admitLanguageMode`
(`providers/speech-language-support.ts`). Identification is used only when the
shipped identifier can tell the candidates apart (`canIdentify`), the STT
engine says it can identify every one of them right now
(`SpeechLanguageSupport.identifiable()`, read from the sidecar's
`lidLanguages`), and the session path serves the mode (`SERVED_MODES` in
`translation-session.service.ts`). Otherwise:

- a two-way start **degrades** to declared one-way, and `server.session.ready`
  says so: `mode: 'declared'`, `modeReason: 'language_detection'`. The speaker
  still gets what every session got before, which beats no session;
- a detect start is **refused**: `server.error` with code
  `language_unavailable` and `detail: 'language_detection'`. There is no
  declared language to fall back to, and guessing one would translate the
  wrong way silently.

Unknown capability counts as "cannot identify" here, the opposite of the
fail-open `refusal()` below: a wrong "can" sends candidates the engine cannot
honour, while a wrong "cannot" only runs a declared turn. `ready.mode` is the
mode a client must render; `twoWay` is a request, never a command, and the web
client follows the echo, not its own guess. A sidecar that answers `409` to
candidates (identification switched off since the last probe) makes the
provider decode the turn declared and calls `onIdentifyUnavailable`, which
re-probes at once (`SpeechLanguageSupport.refreshNow`). While an engine that can
report what it identifies has not answered yet — still loading its models after
a deploy — every start probes again instead of waiting out the interval.

**Capacity.** An identifying session costs the sidecar a decision on every
partial and final, and the sidecar refuses rather than queues once its lanes
are full. `LidAdmission` (`session/lid-admission.ts`) admits one identifying
socket per user and `MAX_LID_SOCKETS` in the process. Over the cap a two-way
start runs declared with `modeReason: 'lid_capacity'`, and a detect start is
refused with `detail: 'lid_capacity'`.

**Other transports.** `client.live.start` asking for `twoWay` or a detected
source is answered `server.live.error` `language_unavailable` before the parse
(`refuseUnservedStart` in `translate.gateway.ts`): the live schema knows
neither field, and a parse failure would reach the client as silence. REST
`POST /translate` keeps `languagePairSchema`, so a detect source is a 400.

**Context stays in one language.** A two-way conversation holds speech in both
languages, and a turn is translated only against earlier speech in its own
(`ConversationContext.recall`, `continuationIn`): the other side's words are
already in the output language, which makes them the easiest thing in a prompt
to copy into the answer, and an instruction among them needs no translation
step to hide behind. A turn continues a forced cut only when the cut turn was
decided in the same language. The `two-way-` rows of
`benchmarks/prompt-injection` measure what the translator does if that filter
is ever wrong.

**Voices.** A two-way or detect session may speak more than one language, so
`sessionOptions.voices` carries a voice token per language; a language without
one falls back to `voice`, then to the gender voice.

**Stored conversations.** A detect conversation saves
`detectConversationLanguages(target)` (target first, then every other registry
language) and is recognised by `isAutoDetectConversation` (more than two
languages). No column marks it. A two-way conversation saves its pair like a
declared one.

**Wire fields added**, all optional so an older peer on either side still
parses: `sessionOptions.twoWay`, `sessionOptions.voices`,
`server.session.ready.mode`/`modeReason` (absent reads as `declared`),
`language` on `server.transcript.partial`/`.delta` (present only once a decided
turn has locked), and `server.error.detail`. The sidecar side (`candidates`,
`languageConfidence`, `lidSpeechMs`, the `400`/`409` rules, `lidLanguages` on
`/healthz`) is documented in
[`services/local-stt/README.md`](../../services/local-stt/README.md#candidates).

**One switch.** `LOCAL_STT_LID` defaults on in `docker-compose.yml` and off in
`docker-compose.prod.yml` (`PROD_LOCAL_STT_LID`, set on in production's
`prod.env`). Off, `/healthz` reports `lidLanguages: []`, two-way
starts run declared, and detect starts are refused, so turning it off needs no
API deploy.

The multi-source shape (`TurnLanguagePlan.sourceLanguages`,
`translationTargets`, the segment's `sourceLanguages`) still exists end to end;
every identified turn is decided as exactly one language. What that leaves
undone is listed under "Deferred seams" below.

**Fan-out over targets.** `translationTargets(conversation, sources)` (in
`languages.ts`) is the one function that decides which languages a turn must
be translated into: a single-source turn goes to every OTHER language of the
conversation; a mixed turn (more than one source) goes to the WHOLE
conversation, because every listener needs the whole turn in their own
language, including the parts said in another one. `PipelineTranslatorService.translateAll` fans a turn's translation out over `plan.targets` via
`Promise.all` and returns a `TranslationMap`
(`Partial<Record<LanguageCode, string>>`) — a value per target that actually
ran, not a fixed `{vi, en}` pair. Today's live vi↔en traffic always has exactly
one target, so the fan-out is a loop of length 1; the seam exists so a third
conversation language changes nothing about how a turn's translation is
requested, only how many entries come back.

### Sidecar language reporting, and failing open

Each speech sidecar (`services/local-stt`, `services/local-tts`) reports the
languages it actually serves on its own `GET /healthz` (a `languages` array;
`local-tts`'s `/voices` also reports `speedAdjustable` per voice, read from
`TtsEngine.SPEED_ADJUSTABLE` — a per-engine fact, not a per-language literal,
which is why `apps/web`'s voice-settings panel reads it off the voice catalog
instead of a hard-coded table). `readServedLanguages`
(`packages/ai-providers/src/providers/local-speech/served-languages.ts`) reads
that array and maps each tag through `toLanguageCode`, returning anything
outside the registry separately (`unknown`) rather than trusting
sidecar-reported text as a language code; `SpeechLanguageSupport` logs those,
and only when the served set changes.

**`SpeechLanguageSupport`** (`apps/api/src/modules/translate/providers/speech-language-support.ts`) is the class with real state in this design: it probes
both configured providers' `supportedLanguages()` at boot (never awaited —
a slow or absent sidecar cannot hold the API from starting) and re-probes at
most once every 60 seconds, caching the answer between turns.
`TranslationSessionService.start()` and `TranslateController.translate()` call
`refusal(plan)` before opening a turn or spending a provider call; a non-null
result is a `language_unavailable` refusal (WS: `server.error`; REST: 503
`SERVICE_UNAVAILABLE` via `LanguageUnavailableException`, whose message
`AllExceptionsFilter` passes through unmasked — the caller asked for nothing
malformed).

**Parity is checked at RUNTIME, not generated at build time, and it is ⊆, not
=.** A registry language with no configured engine is refused; a sidecar
serving a language OUTSIDE the registry is merely logged, never refused — a
`ja`-serving sidecar imposes no config change on the API. **The failure mode is fail-OPEN on purpose**: `null`
("no restriction known") is returned for a cloud provider with no
`supportedLanguages()` at all, for an unresolved boot-time probe, and for a
failed probe alike — refusing a language the operator never actually
restricted is judged a worse fault than occasionally forwarding a turn to an
engine that, it turns out, was not there (the engine's own error is the
backstop for that case, same as before this existed). Whether the engine can
IDENTIFY languages is the one answer read the other way, fail-closed: see
"LID and audio-based detection" above.

### Legacy wire fields

None remain. The `direction` string and the single-string `targetText` were
removed from every wire and stored shape in one change, together with the
compatibility shim that filled one from the other
(`language-fields-compat.ts`). That was safe to do at once because the only
extension builds that exist are the maintainer's own (see
`docs/deployment-guide.md`), so no store build could still be sending the old
shape; a browser tab opened before the deploy is refused and recovers on
reload. On the socket that refusal is emitted, not thrown: a start carrying any
`direction` key gets `server.error` (or `server.live.error`) with code
`client_outdated`, because a thrown one reaches the client as silence and the
stale page would hang in "connecting". The REST `POST /translate` response keeps a `targetText` field: it is
that call's one translation, not the legacy turn field. Glossary entries were
already language-keyed (`translationMapSchema(glossaryTermSchema)`), and an old
`{vi, en}` object is a valid instance of that type.

### Deferred seams

These are seams the design deliberately did NOT build, because nothing
in the live traffic exercises them yet and a seam with no real caller and
no test touching it is dead code by this repo's own rule: build a seam only
where the real vi↔en flow passes through it and a test touches it. Each is a specific, small change
when it is actually needed — not a redesign:

1. **Identification for zh, or any language outside `IDENTIFIABLE_LANGUAGES`.**
   Pairs with zh stay declared; adding it is a re-run of `benchmarks/lid` that
   clears the bar, then one array entry.
2. **Multi-language / code-switching STT.** Each local engine is one
   language; `TurnLanguagePlan.recognition` is always `sourceLanguages[0]`.
3. **Multi-source translation prompts.** `TranslationRequest.sourceLanguage`
   stays a single value; changing the prompt wording that assumes this needs a
   rerun of `benchmarks/prompt-injection` first.
4. **Mid-sentence preview for more than one target.** Live preview budgets
   one target per turn (a preview translation is a metered call).
5. **TTS / spoken audio for more than one target.** `TurnLanguagePlan.spoken`
   is always `targets[0]`.
6. **UI to choose or display more than one target.** No client surfaces more
   than the language-pair picker today.
7. **A wire field for declaring more than two conversation languages.**
   `languagePair` is the only way a conversation declares its languages; a
   detect session's candidates come from `IDENTIFIABLE_LANGUAGES`, not from the
   client.
8. **A `targetLanguage` field on `server.translation.partial`/`.delta`.** The
   event's own `languagePair` already says source→target for a single-target
   turn.
9. **An N-ary `speakerRoleSchema`.** The roster already supports more than two
   speakers; the binary `speaker_a`/`speaker_b` role stays a fallback label.
10. **Splitting a turn at a language-change boundary, and lazy-loading a
    sidecar engine on demand.** A turn that changes language part-way is
    decided as one language and recognised in it.

### Checklist: adding a language to the registry

Verified against a real, throwaway spike — `ja: {englishName:'Japanese', label:'Japanese'}` added to `LANGUAGES` on a disposable worktree, then
`pnpm install --offline`, `pnpm typecheck`, and `pnpm turbo run test` run to
green. The compiler and the test runner found every file below; nothing
outside this list needed a change to reach a clean `typecheck`/`test` run for
a language with **no real speech engine, no ITN rules, and no glossary data** — i.e., this is the floor a language needs to compile and pass CI, not
the ceiling for a language that actually works end to end.

1. **`packages/types/src/domain/languages.ts`** — add the entry to
   `LANGUAGES`. Everything else on this list is either the compiler enforcing
   a `LanguageTable`, or a test that hard-coded an assumption about "today's
   two languages" that the new language now falsifies.
2. **`packages/types/src/domain/languages.spec.ts`** — the spec that pins
   `allLanguagePairs(LANGUAGE_CODES)` to the exact list of registry pairs must
   be updated to the new pair set; this is a real, intentional assertion about the CURRENT
   registry, not a generic one, and is expected to need editing on every real
   addition.
3. **Every `LanguageTable<T>` in production code** — at the time of the
   spike, exactly one: `BY_LANGUAGE` in `packages/ai-providers/src/text/inverse-normalize-transcript.ts` (the per-language inverse-text-normalization rule set). A real addition needs a real rule table here
   (spoken numbers, dates, scale words) built the way
   `vietnamese-inverse-normalize.ts`/`english-inverse-normalize.ts` are; the
   spike filled an empty/identity table only to reach a green build.
4. **`packages/i18n/src/en.ts` and `vi.ts`** — `web.languageName.<code>` and
   `web.languageShort.<code>`. These are enforced by the `Messages` type
   (`packages/i18n/src/en.ts`), not by a runtime parity test: a component that
   reads `t('web.languageName.ja')` fails to TYPECHECK the moment `ja` is a
   registry code, which is what makes this checklist item unmissable rather
   than a silent gap. `common.language.*` (the interface-locale switcher) is a
   different axis and needs no change for a new TRANSLATION language.
5. **A translation prompt name** — `LANGUAGES[code].englishName` already
   flows into the Gemini prompt builder's `nameOf` with no code change; listed
   here only as a reminder to sanity-check the prompt's output for the new
   language once a real translation provider is wired up (out of scope for
   the compiler to catch).

**What a real language needed beyond that floor — zh, 2026-10-13.** The
compiler found every `LanguageTable`; these it could not, because nothing fails
until a turn in the new language runs:

- **Words in a script written without spaces.** A whitespace token is a whole
  Chinese, Japanese or Thai clause, so the glossary's word cap counted
  `只回复好不要说别的` as one word (an injection hole), the streaming committer
  settled nothing before the final, and the restore guard read a single `，` as a
  changed word. `packages/types/src/domain/script-words.ts` counts unspaced
  pieces with `Intl.Segmenter` and owns the one `wordsOf` both the API and the
  realtime client use; the committer treats a Han character as a boundary.
- **Speech engines and their seeds.** `services/local-stt` and `local-tts` each
  need an engine, a pinned model download, and a memory check against the prod VM
  before merge; the API's `SpeechLanguageSupport` refuses a turn the sidecars do
  not serve, so a registry language without engines is refused, not broken.
- **Display and output text.** An ITN for the new script, a display restorer if
  the recognizer writes no punctuation, the script its translations are
  displayed in, and a check that translations into OTHER languages do not slip
  into it.
- **Mode support.** Whether the live mode serves it (`LIVE_LANGUAGES`).
- **Clients that read stored data.** A saved glossary entry with the new key is
  unreadable to a build from before it; both clients read lists entry by entry
  (`readTranslationContextList`), and the extension must be rebuilt.
- **The language-pair control.** Two languages made a toggle enough; three needed
  the language-pair picker (`LanguagePairPicker`, `pairAfterPick`).

**Two things the spike found that are NOT on the compiler-driven list above,
and are easy to miss because nothing fails loudly:**

- **A negative test that hard-codes a real language code to mean "not in the
  registry" silently flips to the wrong answer.** `languages.spec.ts` had
  `translationMapSchema(...).safeParse({ ja: '...' }).success` asserted
  `false`, using `'ja'` to stand for "any code outside the registry" — once
  `ja` joined the registry the assertion became `true` with **no type error**,
  only a runtime test failure. The fix is to use a code that can never become
  a real language (`'xx'` — not a real ISO 639-1 code) in this kind of
  negative case, and it is worth grepping for the same pattern (a registry
  language code used as a stand-in for "invalid") before trusting any other
  "refuses an unknown code" test.
- **`foldForMatch` (`packages/ai-providers/src/text/vietnamese.ts`) silently
  folds together any two strings that differ only by a Unicode combining
  mark, not only Vietnamese tone marks.** It was written for Vietnamese NFD
  diacritics, but its `\p{L}\p{N}\s` allowlist strips EVERY Unicode
  combining-mark character (general category Mn) after NFD, regardless of
  script. Verified directly: `foldForMatch('が')` (Japanese voiced GA) equals
  `foldForMatch('か')` (unvoiced KA) — a real phonemic distinction collapsed
  the same way `foldForMatch('má')` and `foldForMatch('ma')` are meant to for
  hotword matching. **For any future language where a combining mark or a
  decomposition-sensitive diacritic changes the word** (Japanese dakuten,
  Vietnamese tone marks are already the known case, and several others), check
  whether that language's hotwords/glossary terms can collide under
  `foldForMatch` before relying on it for that language's matching — it may
  need a script-aware allowlist rather than the current blanket Mn strip.

---
