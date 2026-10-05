# Audit lane B — contracts-and-languages, ai-providers, data-flow

Branch `docs/audit-and-video-call-planning`, 2026-10-05. Verified against source on this branch. No code changed.
Line numbers are pre-edit.

## contracts-and-languages.md (10 fixes, 1 added subsection)

| Line    | Old claim                                                                           | Evidence                                                                                                                                                                 | Fix                                                                   |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 14      | domain has `conversationSessionSchema`                                              | no such export; `packages/types/src/domain/conversation.ts` exports `conversationSchema`                                                                                 | renamed, added minutes + registry pointer                             |
| 19      | `src/http/sessions.ts`                                                              | file absent; http/ has translate, conversations, minutes, translation-contexts                                                                                           | replaced with real files                                              |
| 24      | composite kept "for project references like `@chatofy/ai-providers`"                | `packages/ai-providers/tsconfig.json` says not referenced; composite inherited from `packages/config/tsconfig/base.json`                                                 | reworded                                                              |
| 38      | 204 "returns empty data object"                                                     | `api-client.ts:86` parses `undefined` against data schema                                                                                                                | fixed                                                                 |
| 139     | error codes list                                                                    | `errorCodeSchema` also has `RATE_LIMITED`, `SERVICE_UNAVAILABLE`                                                                                                         | added                                                                 |
| 225–229 | LanguageTable production uses: two                                                  | also `GlossaryRow` (`apps/web/.../ai-context-draft.ts:36`)                                                                                                               | added                                                                 |
| 235–239 | grep checks return nothing outside languages.ts + extension default + locale axis   | real prod hits: `prompt-builder.ts:317` (`sourceLanguage === 'vi'`), prisma schema comments + migration SQL; extension default uses `directionOf` (matches neither grep) | rewritten to actual hits                                              |
| 243–255 | plan built 3 times (TurnSession ctor, start(), controller) — "harmless duplication" | commit 70f4e1a5; `translation-session.service.ts:~240` builds via `planForDirection` and hands to `TurnSessionDeps.languages`; TurnSession only defaults                 | rewritten                                                             |
| 287–291 | `readServedLanguages` drops and warns                                               | `served-languages.ts`: returns `unknown`, caller warns (only on change, e166ea98)                                                                                        | fixed                                                                 |
| 299     | REST refusal is 400                                                                 | `LanguageUnavailableException` = 503 (6deee17e)                                                                                                                          | fixed                                                                 |
| 326–327 | cites `plans/260928-…/reports/`                                                     | removed in 953b93de                                                                                                                                                      | cite `language-fields-compat.spec.ts` instead                         |
| new     | —                                                                                   | `language-identifier.ts:20` cites "LID and audio-based detection" (missing)                                                                                              | added `### LID and audio-based detection` under "What a turn decides" |

## ai-providers.md (14 fixes)

| Line     | Old claim                                                                           | Evidence                                                                                                                        | Fix                                     |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 7,13     | interfaces = 4                                                                      | `interfaces/` also SpeakerEmbedding, DisplayRestorer, Summarization                                                             | listed                                  |
| 16       | error classes                                                                       | `ProviderBusyError`, `ProviderAbortedError` missing                                                                             | added                                   |
| 17–23    | provider list lacks OpenAI-compatible, summarization, gemini-live, display restorer | `packages/ai-providers/src/index.ts`                                                                                            | added 4 lines                           |
| 24       | model ownership                                                                     | host-table row owns model for OpenAI-compatible                                                                                 | added                                   |
| 26       | registry kinds                                                                      | `ProviderKindMap` adds displayRestorer, summarization                                                                           | fixed                                   |
| 40       | Translation `gemini` / Google Cloud only                                            | `prod.env.example:259` `AI_TRANSLATION_PROVIDER=deepseek`; schema default `gemini`                                              | row updated; added Display/Dewpoint row |
| 81       | "API always asks" min speech                                                        | REST `translateTurn` input has no `minSpeechMs`                                                                                 | scoped to WS turn path                  |
| 238      | split gated on "server flag plus" opt-ins                                           | `SPEAKER_EMBEDDING_ENABLED` removed (doc itself says so)                                                                        | dropped server flag                     |
| 279–282  | settle-pass reasoning names the server flag                                         | same                                                                                                                            | reworded                                |
| 318–323  | browser-channel merge "measured and not fixed"; higher thresholds broke rulers      | 21efe635 raised to 0.50/0.45, rulers improved (`auto-attribution.ts:82–96`)                                                     | rewritten as fixed by raising bars      |
| 345–347  | "numbers above are below the 0.85 target"                                           | numbers now 0.945/0.910/0.921                                                                                                   | reworded as historical                  |
| 358      | reducer runs only observeVoice + fillPendingTurns                                   | `turn-keyed-transcript.ts:936` also `promoteProvisional`                                                                        | added                                   |
| 377–380  | translation = Gemini only                                                           | `register-default-providers.ts` host table (deepseek/openai), `OPENAI_COMPATIBLE_API_KEY`, `translation-model-policy.ts` header | added "_Which host._" paragraph         |
| 666, 684 | `/conversations` JSON limit 1 MB                                                    | `CONVERSATIONS_JSON_BODY_LIMIT_BYTES = 2 MiB` (5520257c)                                                                        | fixed                                   |

## data-flow.md (8 fixes, 1 added subsection)

| Line    | Old claim                                                                                | Evidence                                                                                                                     | Fix                                                     |
| ------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 9       | REST body `{…, voice?}` VieNeu preset                                                    | `translateRequestSchema`: `voiceGender`, `speed`                                                                             | fixed                                                   |
| 11–17   | controller derives source/target; TTS in target                                          | controller plans via `planForDirection` + language refusal; `translateTurn(input, plan)` uses `translateAll` + `plan.spoken` | rewritten                                               |
| 46      | re-reads newest ~8s                                                                      | `DEFAULT_WINDOW_SECONDS = 9`                                                                                                 | fixed with reason                                       |
| 57–62   | live translation only on turns >3s                                                       | `live-translation-trigger.ts` header: opens on progress (15 chars / clause / correction), RPM 66; `.delta` + `.partial`      | rewritten                                               |
| 220–225 | error list                                                                               | add `ProviderNotImplementedError`, `LanguageUnavailableException` (503)                                                      | added                                                   |
| 266     | glossary `{vi, en}`                                                                      | `translationMapSchema` over registry                                                                                         | qualified                                               |
| 306–309 | GlossaryTerm entry = TWO strings                                                         | prisma `GlossaryTerm.terms Json` (7e27e2b4)                                                                                  | fixed                                                   |
| new     | continuous `client.live.*` mode on `/ws/translate` undocumented anywhere in architecture | gateway `client.live.start/audio/stop`, `LiveTranslateSessionService`, `translate-mode.ts`                                   | added `### Live mode on the same socket` (pointer only) |

## Code citations of `docs/system-architecture.md` (translate scope)

| Citation                                                    | Topic                                                    | Now lives in                                                |
| ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `language-identifier.ts:20` "LID and audio-based detection" | was missing                                              | added subsection, contracts-and-languages.md                |
| `turn-language-plan.ts:43,51`                               | deferred seams (multi-language STT, TTS for all targets) | contracts-and-languages.md → Deferred seams items 2, 5      |
| `turn-tuning.ts:18`                                         | live partials ungated                                    | ai-providers.md → Speech gate, "Live partials stay ungated" |
| `live-preview.ts:209`                                       | preview budgets one target                               | contracts-and-languages.md → Deferred seams item 4          |
| `translation-session.service.ts:1244`                       | TTS one target                                           | Deferred seams item 5                                       |
| `auto-attribution.ts:63`                                    | attribution "rest"                                       | ai-providers.md → Per-turn speaker attribution              |

## Validation

- Every backticked path in the three files resolved (`test -e` / `git ls-files`); remaining "misses" were basenames, routes, or MIME types.
- Relative markdown links checked from `docs/architecture/`: none broken. New anchors `data-flow.md#live-mode-on-the-same-socket`, `#ai-context-and-the-path-a-hint-takes-to-the-prompt` match headings.
- `npx prettier --write` run on all three. Line counts: 457 / 719 / 354 (≤ 800).

## Open questions

1. `ai-providers.md` "A minimum of 96 clean and 94 far-field exact holds over 20 order-perturbed arrival seeds" vs `auto-attribution.ts:95` "a minimum of 90 clean and 89 far-field exact". Recorded measurement; not runnable here (needs local ruler data). Left unchanged.
2. `auto-attribution.ts:90` says across-speaker cosine 0.38–0.58 is "entirely below" 0.50 — 0.58 is not. Doc uses 0.37–0.41 (podcast pair). Code comment should be checked by the owner.
3. Stale code comment, out of lane: `narrow-body-limits.ts:279` still says "a JSON save still meets the 1 MB limit" (limit is 2 MiB).
4. Index `docs/system-architecture.md` (not my file) should list the new "LID and audio-based detection" and "Live mode on the same socket" sections.
