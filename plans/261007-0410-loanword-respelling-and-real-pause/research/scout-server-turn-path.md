# Server Architecture Scout: Loanword Respelling + Per-Conversation STT Hotwords

## 1. Translation Flow (Turn Final Transcript + Display + Translation)

**Core decision point:** `displayFor()` is called BEFORE emitting the final transcript event, ensuring display arrives atomically with source.

- **Line 619-624** `translation-session.service.ts`: `displayFor(session, translated.sourceText, translated.restored, translated.translations)` called pre-emit
- **Line 626-634**: Result packed into `server.transcript.final` event as optional `display` field
- **Line 32-33**: Import path: `{ adoptTranslatedCasing, restoreKeepsWords, restoreRequestFor, typesetTranscript }` from `display-restore-request.ts`

### Translation→Restore Sequence (Parallel)

- **Line 654-658** `pipeline-translator.service.ts`: `restoreDisplay()` called BEFORE translation starts (Promise created)
- **Line 660-668**: `translateAll()` called in parallel
- **Line 669**: Both awaited after translation completes (`await restoring`)
- **Result:** Restore runs concurrently with translation, not sequenced

### Display Typeset Composition

- **Line 998-1005** `translation-session.service.ts`: `typesetTranscript(sourceText, adoptTranslatedCasing(restored, translations), recognition, logger)`
- **Line 80-111** `display-restore-request.ts`: `typesetTranscript()` inverts numerals + applies casing from translations + applies language-specific ITN

### Speaker Split Path (Alternative)

- **Line 612-613** `translation-session.service.ts`: If split occurs, calls `emitPieces(socket, session, split)` instead of single turn
- Split pieces each have their own `displayFor()` call internally

### Block Retranslation Path

- **Line 164-167** `translation-session.service.ts` constructor: `BlockRetranslator` given callbacks `restore: (block) => restoreBlock(block)` and `typeset: (block, restored, translations) => typesetBlock(block, restored, translations)`
- **Line 1075-1085**: `restoreBlock()` calls `pipeline.restoreDisplay()` for block's `sourceText`
- **Line 1093-1111**: `typesetBlock()` applies same composition logic

---

## 2. Hotwords Flow (Session.hints → STT Request → Python Form Field)

**Call chain:**

1. **Entry:** `session.hints` stored in `TurnSession` at init (line 200 `turn-session.ts`)
2. **Line 488-496** `pipeline-translator.service.ts` `transcribe()` method:
   - Builds STT request: `trio.stt.transcribe(input.audio, input.mimeType, input.language, { hotwords: input.hints?.hotwords, minSpeechMs: input.minSpeechMs })`
   - **Function name building STT request:** `transcribe()` (line 482)
3. **Line 144** `services/local-stt/app.py` `/transcribe` endpoint:
   - Receives `hotwords: list[str] = Form(default=[])`
   - **Line 144:** `terms = build_hotwords(hotwords) if engine.supports_hotwords else ""`
   - Passes to `engine.transcribe_with_pauses(samples, terms)` (line 152)

**Hotwords also used for display restore:**

- **Line 38** `display-restore-request.ts`: `terms: session.hints?.hotwords ?? []` included in `DisplayRestoreRequest`
- Passed to restorer as context for selecting mixed-case forms

---

## 3. Per-Socket / Per-Conversation State

**One WebSocket per conversation:** Line 95-106 `translation-session.service.ts` docblock describes per-connection state machine

**Persistent State Holders (keyed by socket WeakMap, survives turn boundaries):**

| State               | Container                                                        | Lifecycle                  | Use                                                         |
| ------------------- | ---------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| Finished utterances | `ConversationContext.recent` (line 50 `conversation-context.ts`) | Entire connection          | Context for fragmentary turns (max 4 utterances, FIFO ring) |
| Last opened turn    | `ConversationContext.lastOpened` (line 57)                       | Entire connection          | Identify predecessor for continuation turns                 |
| Silent turns        | `ConversationContext.silent` (line 60)                           | Entire connection          | Track turns that closed with no transcript                  |
| Turn registry       | `SessionRegistry` (line 111 `translation-session.service.ts`)    | Per-turn, cleared on close | Answer "is this still my turn"                              |
| Departed sockets    | `WeakSet gone` (line 145)                                        | Until no refs remain       | Distinguish departed client from between-turn idle          |

**Learned Terms (New Per-Conversation State Needed):**

Natural location would be alongside `ConversationContext`:

- Add a `learnedTerms: WeakMap<StreamSocket, Set<string>>` field
- Populate on transcript final (line 635-641) via new method `rememberTerms(socket, sourceText)`
- Recall via `recall(socket): string[]` returning the set as array
- Pass to hints on next turn's STT call (extend existing hints or new field)
- Clear on `forget()` (line 186)

---

## 4. PipelineTranslatorService: Translation Provider Calls

**Provider interface:**

- **File:** `packages/ai-providers/src/interfaces/translation-provider.ts`
- **Only method:** `translate(req: TranslationRequest): Promise<TranslationResult>` (line 156)
- **Streaming only:** `onChunk?: (delta: string, restart: boolean) => void` callback on request (line 141)
- **No non-streaming JSON method exists**

**Budget handling:**

- `PipelineTranslatorService` has NO budget field; budget lives in `TranslationSessionService` (line 132)
- `TranslationBudget` passed to `TurnSession` via `TurnSessionDeps.budget` (line 65 `turn-session.ts`)
- Per-turn call: `this.committer.scheduleTranslation()` runs against budget (not PipelineTranslator's concern)

**For loanword respelling call:**

- Must create new method on `TranslationProvider` interface or use existing `translate()` with special model/instruction
- No existing "JSON completion" affordance; would need to add streaming or a new method

---

## 5. Prompt Injection Benchmark Structure

**File:** `benchmarks/prompt-injection/run.mjs` and `corpus.mjs`

**Cases defined in corpus.mjs:**

- Each case has `kind` (attack/control), `any[]` (expected words), `never[]` (failure strings), `neverContains` (optional regex), optional `hints`
- Default 42 cases, 5 new ones added for context (lines 271-295 README)

**Removed repair cases (load-bearing):**

- **Line 134-142 README:** "nine same-language repair cases removed on 2026-08-29"
- Measured 34/34 pass before removal; **display path had NO model** after fix (pure function only)
- Cases measured: `repair-period`, `repair-case`, `repair-glossary`, etc. (git log needed for exact names)
- Reason removed: display restored by `typesetTranscript()` pure function, no prompt injection surface

---

## 6. Client Display Contract

**Wire event:** `server.transcript.final` (line 624 `ws-events.ts`)

```typescript
display: z.string().optional(),  // Line 676 ws-events.ts
```

**Semantics:**

- Present only when it differs from `segment.sourceText` (line 658-664)
- Clients render `display ?? segment.sourceText` (line 669-670)
- Presence triggers "show original" disclosure UI (line 14 `transcript-source-line.tsx`)
- `repaired: boolean` prop tells component whether to show toggle (line 14)

**Client disclosure UI:** `transcript-source-line.tsx` lines 40-85

- Toggle hidden if `!repaired`
- Calls `adoptTranslatedCasing()` to show how translations informed case selection
- Marked with `sourceRawLabel` text label ("Recognized" or equivalent in i18n)

**Saved to DB:**

- `SaveConversationTurn.displayText` field (line 112 `packages/types/src/http/conversations.ts`)
- Persisted as `ConversationTurn.displayText` column
- Indexed in `searchText` via `searchTextFor()` function (line 739-751 `prisma-conversation.store.ts`)
  - Joins: `displayText ?? '' + sourceText + translations values`

---

## 7. Existing Tests to Extend

| Module                           | Spec File                             | Coverage                                                                         |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `display-restore-request.ts`     | ❌ None found                         | `typesetTranscript()`, `adoptTranslatedCasing()`, `restoreKeepsWords()` untested |
| `translation-session.service.ts` | `translation-session.service.spec.ts` | Turn flow, speaker split, metrics                                                |
| `translation-session-display`    | `translation-session-display.spec.ts` | Display path only                                                                |
| `pipeline-translator.service.ts` | `pipeline-translator.service.spec.ts` | Transcribe, translate, restore phases                                            |
| `local-stt hotwords`             | `services/local-stt/test_hotwords.py` | `build_hotwords()`, `normalize_term()`                                           |
| `conversation-context.ts`        | `conversation-context.spec.ts`        | `recall()`, `remember()`, `textOf()`                                             |

**Key entry points for learned-terms tests:**

- Extend `conversation-context.spec.ts` to test new `learnedTerms` field
- Extend `turn-session.spec.ts` to verify `session.hints.hotwords` includes learned terms
- Add integration test in `translation-session.service.spec.ts` for multi-turn hotword carryover

---

## Unresolved Questions

1. **Loanword collection:** Should learned terms be extracted from `translated.translations` (target side) or inferred from `translated.sourceText` via a small model call? Latter is safer but costs a call per turn.
2. **Display respelling scope:** Respell only recognized loanwords in display, or all terms from learned set? Respelling every term learned could add false spices.
3. **Budget for inline calls:** If a new method is added to provider interface, should it draw from the shared `TranslationBudget` or have its own budget? (Currently shared per user + process-wide ceiling exists.)
