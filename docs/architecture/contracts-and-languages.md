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
only place in the monorepo that knows which languages exist.** Every direction
string, every schema that validates a language code, and every rule that maps
between languages is derived from it — nothing else may spell `'vi'` or `'en'`
as a branch condition or write a direction literal (`'vi_to_en'`) by hand. The
module's own file header states this and explains why; read it before adding
anything nearby.

**Data plus pure functions, deliberately not a class per language.** A
direction travels as the string `${source}_to_${target}` across the socket,
Postgres, `localStorage` and React state — a class instance would break `===`
and every serializer on that path. "OOP" in this codebase, for languages, means
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
exactly how far that reaches. Production uses today: the per-language inverse-
text-normalization table (`BY_LANGUAGE` in
`packages/ai-providers/src/text/inverse-normalize-transcript.ts`) and the
per-language voice-token schema (`storedVoiceSelectionSchema` in
`apps/web/src/lib/translate-settings.ts`), and the AI Context editor's glossary
row (`GlossaryRow` in `apps/web/src/components/preferences/ai-context-draft.ts`).

**The rule this whole section exists to state: no branching on a language code
outside a `LanguageTable`, and no direction string literal anywhere but the
registry itself.** A `=== 'vi'`/`'en' ===` comparison or a hand-written
`'vi_to_en'` is either a missing registry function or a missing `LanguageTable`
entry — never a shortcut. `git grep -nE "=== '(vi|en)'|'(vi|en)' ===" -- apps packages` and `git grep -lE "'vi_to_en'|'en_to_vi'" -- apps packages` are the
checks that enforce it. Specs and e2e tests use literals freely; in production
code the only hits are the Vietnamese-only recognizer note in
`packages/ai-providers/src/providers/gemini/prompt-builder.ts`
(`sourceLanguage === 'vi'`, explained in
[Data Flow](./data-flow.md#ai-context-and-the-path-a-hint-takes-to-the-prompt)), and
the Prisma schema comments and migration SQL that record the legacy `direction`
column. Defaults are built with `directionOf` rather than spelled
(`DEFAULT_CAPTURE_DIRECTION` in `apps/extension/src/settings.ts`). The
interface-locale axis (`common.language.*`, `locale-switcher.tsx`) is a
different axis entirely, see below.

### What a turn decides, and in what order

**`TurnLanguagePlan`** (`apps/api/src/modules/translate/session/turn-language-plan.ts`) is what one turn decided, language-wise, before a single frame of its
audio is transcribed: the conversation's full language set, what the turn was
actually spoken in (`sourceLanguages`), every language it must be translated
into (`targets`), which one its audio is recognised in (`recognition`, today
always `sourceLanguages[0]` — one STT engine per language cannot read a mixed
utterance in one pass), and which one its translation is spoken aloud in
(`spoken`, today always `targets[0]` — TTS for every target at once is a
deferred seam, see below). Built once per turn by `planForDirection(direction,
identifier)` (a wrapper over `planTurnLanguages`), and read by everything
downstream instead of re-deriving anything from `direction`.
`TranslationSessionService.start()` builds it once, checks it with
`SpeechLanguageSupport`, and hands that same plan to the `TurnSession`
(`TurnSessionDeps.languages`), so the turn that runs is the turn the refusal
check approved; `TranslateController.translate()` calls the same helper for
REST. `TurnSession` derives a plan itself only when none is handed in (tests).

**`LanguageIdentifier`** (`apps/api/src/modules/translate/session/language-identifier.ts`) is the DI seam that decides which language(s) a turn was
spoken in. It is called once per turn — every WS turn and every REST call —
with the language the CLIENT declared, not with audio.
`DeclaredLanguageIdentifier` is the only implementation and the default
`TurnSessionDeps.identifier`: it trusts the declaration outright and returns
exactly one code. A real identifier (reading the turn's own audio) is a
deferred seam — the interface already takes a turn-shaped argument rather than
a bare code so that swap can add fields (a sample rate, a byte buffer) without
another interface change — see "LID and audio-based detection" below.

### LID and audio-based detection

There is no language identification (LID) from audio today. A turn's source
language is whatever the client declared for it; `DeclaredLanguageIdentifier`
turns that into a one-element `sourceLanguages`, so no turn is ever reported as
mixed-language. The multi-source shape exists end to end
(`TurnLanguagePlan.sourceLanguages`, `translationTargets`, the segment's
`sourceLanguages`) so that an audio-based identifier is a new
`LanguageIdentifier` bound to `LANGUAGE_IDENTIFIER` in `translate.module.ts`,
not a contract change. What it would still leave undone is listed under
"Deferred seams" below (items 1, 2 and 10).

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
serving a language OUTSIDE the registry is merely logged, never refused —
today's registry only has `vi`/`en`, and a `ja`-serving sidecar imposes no
config change on the API. **The failure mode is fail-OPEN on purpose**: `null`
("no restriction known") is returned for a cloud provider with no
`supportedLanguages()` at all, for an unresolved boot-time probe, and for a
failed probe alike — refusing a language the operator never actually
restricted is judged a worse fault than occasionally forwarding a turn to an
engine that, it turns out, was not there (the engine's own error is the
backstop for that case, same as before this existed).

### Legacy wire fields, and when they may be removed

Every wire and stored shape that predates this registry work is KEPT
alongside its language-keyed replacement, because `apps/api` does not deploy
atomically with `apps/web`, `apps/extension`, or an already-open browser tab:

| Legacy field                                | Replacement                                                                         | Where the compatibility lives                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `direction` (`'vi_to_en'` string)           | `Conversation.languages` / turn `sourceLanguages`                                   | `packages/types/src/domain/language-fields-compat.ts` (`fillConversationLanguages`, `legacyDirectionOf`)                                                                 |
| segment/turn `targetText` (one string)      | `translations` (`Partial<Record<LanguageCode, string>>`)                            | same file (`fillTurnLanguages`), plus `primaryTranslation` in `domain/conversation.ts`                                                                                   |
| glossary entry `{ vi: string; en: string }` | `glossaryEntrySchema` = `translationMapSchema(glossaryTermSchema)` (≥2 filled keys) | `packages/types/src/events/ws-events.ts` — an old `{vi, en}` object is already a valid instance of the new partial-map type, so nothing had to migrate at the wire level |

A response and a save request both still parse and still emit the legacy
shape (pinned by `packages/types/src/domain/language-fields-compat.spec.ts`). **Removal criterion**: the legacy
fields may be dropped once every extension build on the Chrome/Firefox store
is at or above the version that writes the language-keyed shape for at least
14 days, AND no open web tab from before that version can still be sending the
old shape. Removing them is explicitly a SEPARATE change from this one — it touches the wire contracts, the two
DB columns the migrations already dropped stay dropped either way, and it is
not scheduled here.

### Deferred seams

These are seams the plan's design deliberately did NOT build, because nothing
in the live vi↔en traffic exercises them yet and a seam with no real caller and
no test touching it is dead code by this repo's own rule: build a seam only
where the real vi↔en flow passes through it and a test touches it. Each is a specific, small change
when it is actually needed — not a redesign:

1. **Audio-based language identification.** `LanguageIdentifier.identify`
   already takes a turn-shaped argument (not a bare code) so a real
   implementation can add audio fields without another interface change; only
   `DeclaredLanguageIdentifier` exists today.
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
   than the two-language direction toggle today.
7. **A wire field for declaring more than two conversation languages.** No
   client sends one; `direction` remains the only way a conversation declares
   its languages.
8. **A `targetLanguage` field on `server.translation.partial`/`.delta`.** The
   event's own `direction` field already says source→target for a
   single-target turn.
9. **An N-ary `speakerRoleSchema`.** The roster already supports more than two
   speakers; the binary `speaker_a`/`speaker_b` role stays a fallback label.
10. **Splitting a turn at a language-change boundary, and lazy-loading a
    sidecar engine on demand.**

### Checklist: adding a language to the registry

Verified against a real, throwaway spike — `ja: {englishName:'Japanese', nativeName:'日本語'}` added to `LANGUAGES` on a disposable worktree, then
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
   `TranslationDirection` to an exact closed set (`expectTypeOf<...>.toEqualTypeOf<'vi_to_en' | 'en_to_vi'>()`) must be updated to the new
   direction set; this is a real, intentional assertion about the CURRENT
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
