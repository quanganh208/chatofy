# OOP/SOLID Audit Report — Chatofy Monorepo

- Date: 2026-07-18 16:45 (+07)
- Trigger: /brainstorm "kiểm tra toàn bộ code hiện tại đã chuẩn OOP hay chưa" (ultrathink)
- Method: 3 parallel read-only code-reviewer agents (apps/api, packages/*, apps/web+mobile), full-source read, evidence per file:line
- Scope decisions (user-confirmed): deep SOLID audit for backend; web/mobile judged by idiomatic-React standards (user previously rejected OOP-ifying React — journal 260718)

## Overall Verdict

**PASS — codebase chuẩn OOP ở những nơi OOP là đúng paradigm; chuẩn idiomatic React ở nơi React là đúng paradigm.** 0 critical, 1 medium, ~19 minor findings tổng cộng. Không có God class, không layering breach, không contract break.

| Area                  | Verdict                                             | Findings         |
| --------------------- | --------------------------------------------------- | ---------------- |
| apps/api (NestJS)     | PASS                                                | 6 minor          |
| packages/ai-providers | PASS (SOLID letter-by-letter)                       | 4 minor + 1 info |
| packages/api-client   | SOUND (intentional functional boundary, documented) | 1 medium         |
| packages/types        | SOUND (schema-first, compile-time drift guard)      | 2 minor          |
| packages/ui, config   | No issue (deliberate placeholder / tooling-only)    | 0                |
| apps/web (Next.js)    | PASS idiomatic React                                | 3 minor          |
| apps/mobile (Expo RN) | PASS idiomatic React                                | 4 minor          |

## apps/api — SOLID per letter

- **S: PASS** — one axis of change per class; largest class `PipelineTranslatorService` 135 LOC, cohesive. Controllers only decode/delegate; services thin facades.
- **O: PASS-with-notes** — 4 DI seams (`AUTH_ADAPTER`, `SESSION_STORE`, `USER_REPOSITORY`, `TRANSLATOR_SERVICE`, Symbol tokens) swap impls with zero consumer edits. Notes: factory if/else on provider names (localized, acceptable at 3 providers); real leak = `OUTPUT_MIME_BY_LANG` (`pipeline-translator.service.ts:38`) duplicates factory TTS-routing knowledge → 2-file edit per new TTS backend.
- **L: PASS-with-notes** — `MemorySessionStore` honors contract fully. Note: `NoopAuthAdapter`/`NoopTranslatorService`/`PrismaUserRepository` throw **synchronously** from Promise-typed methods (breaks `.then().catch()` callers; documented stubs, intentional). "Noop" is a misnomer — these are Stubs, not Null Objects.
- **I: PASS** — 4 interfaces, 3-4 methods each, `issueToken?` optional = textbook ISP; no impl stubs unused methods.
- **D: PASS-with-notes** — Symbol-token `@Inject` everywhere; `new` confined to composition root/factory/value objects. Notes: controller→concrete service class-token DI (idiomatic Nest, not violation); `main.ts:23,37` reads `process.env` directly bypassing validated ConfigService.

Patterns verified correct: token DI, Repository, Adapter, Strategy, Factory (+bounded keyed cache, correct cache key), Mapper, Facade, Nest pipe/interceptor/filter chain (order documented), single error-translation seam (`handlePipelineError`), envelope filter blocks 5xx leaks + strips zod internals.

### api findings (all minor, ~1-line fixes)

1. `pipeline-translator.service.ts:38` — OCP — MIME map duplicates factory routing. Fix: `outputMimeType` on `TtsProvider`.
2. `noop-auth.adapter.ts:13-19`, `noop-translator.service.ts:14-24`, `prisma-user.repository.ts:19-33` — LSP — sync throw from Promise methods. Fix: mark `async`.
3. `memory-session.store.ts:32,43` — encapsulation — returns live Map references. Fix: shallow copy.
4. `translate.gateway.ts:36` — dead injected dep `translator` never called. Fix: remove until streaming lands.
5. `main.ts:23,37` — DIP — direct `process.env` for CORS/PORT. Fix: `app.get(ConfigService)`.
6. `memory-session.store.ts:41` — explicit `undefined` in dto clobbers fields on spread. Fix: filter undefined keys.

## packages — key results

**ai-providers**: S/L/I/D PASS clean; O PASS-with-note — package OCP-open (Registry `register/resolve`, additive barrel) nhưng app factory (`ai-providers.factory.ts:55-64`) bypass Registry bằng hardcoded name checks → Registry exported nhưng chưa được wire end-to-end. Encapsulation: mọi provider `private readonly`, API key không lọt vào error message (verified). Error hierarchy `instanceof`-safe (ES2022 native class), `cause` preserved mọi wrap site.

**api-client**: functional factory+closure có lý do documented (RN bundler constraint + single parse boundary); closure encapsulation sound, WeakMap cache không leak. Medium finding: transport errors (network TypeError, timeout AbortError) thoát khỏi typed hierarchy — caller branch trên `ApiClientError`/`ContractError` sẽ miss timeout; timer chỉ guard fetch, không guard body read.

**types**: schema-first single source of truth, canonical schemas cross-referenced có comment; `_EnvelopeInSync` compile-time drift guard (`http/response.ts:78-85`) — điểm cộng lớn. Minor: `'vi'|'en'` literals duplicated 4 chỗ (kèm `@chatofy/types` dep trong ai-providers không được import); schema naming PascalCase vs camelCase lệch giữa `events/` và `domain|http/`.

### packages findings

1. Low — no `ProviderError` abstract base → không catch-all được. Fix: thêm base class (additive).
2. Low — `ProviderConnectionError` dùng cho cả 4xx/malformed response (không phải connection). Fix: thêm `ProviderResponseError`.
3. Low — `registry/provider-factory.ts` misnamed (chỉ chứa `readAiProviderEnv`), comment nói "returns null" nhưng code trả `undefined`, `?? undefined` no-op. Fix: rename `provider-env.ts` + sửa comment.
4. **Medium** — api-client transport errors bypass typed hierarchy (`api-client.ts:53-67`). Fix: wrap thành `NetworkError` typed + signal-aware body read.
5. Low — DRY language-code literals. Fix: `languageCodeSchema` trong @chatofy/types, hoặc bỏ unused dep.
6. Low — schema naming inconsistent. Fix: standardize camelCase`…Schema`.
7. Info — `resolve<T>` caller-asserted, không link kind→type. Fix: mapped type `ProviderKindMap`. Harmless (registry chưa có runtime consumer).

## apps/web + mobile — idiomatic React

Cả 2 app PASS mọi check: separation of concerns (logic trong hooks/clients, components pure UI), composition (max 199 LOC file, đều <200 rule), typed props interfaces 100%, shared contracts từ @chatofy/types + api-client (không duplicate), hooks encapsulation với typed public surface, kebab-case + folder boundaries sạch. Refactor translate page 287→72 LOC verified còn nguyên. `@chatofy/ui` rỗng là chủ đích (YAGNI guard comment) — web DOM vs RN không share render code được; đúng quyết định.

Rationale (cho báo cáo đồ án): functional React đúng chuẩn vì core complexity là side-effect lifecycle (MediaRecorder/AudioContext/timers) — hooks colocate acquire+cleanup trong 1 closure; class components scatter qua lifecycle methods + this-binding hazard. Codebase vẫn dùng class đúng chỗ: service objects sau interface (`StubAuthClient`, `NativeWSClient`) → paradigm per-boundary, không dogma. React class components là legacy API từ 16.8.

### web/mobile findings (non-blocking)

1. `web/src/hooks/use-translate-turn.ts:52` — `runTranslate` không guard re-entrancy; đúng đắn phụ thuộc caller `disabled`. Fix: `if (loading) return;`.
2. `web/app/translate/page.tsx:51,69` — `reset` gọi khi upload file nhưng không khi re-record → stale ResultCard. Fix: reset trong record-start handler.
3. `mobile/src/clients/ws-client.native.ts:21-33` — `connect()` không close socket cũ, không có `onclose` → state misreport, leak socket khi reconnect. Fix: close trước + handle onclose.
4. `mobile/src/providers/auth-provider.tsx:64` — context value tạo mới mỗi render → mọi `useAuth` consumer re-render. Fix: `useMemo`/`useCallback`.
5. `mobile ws-client/audio interfaces/use-auth-providers` — zero consumers (grep-verified) — scaffold có chủ đích cho conversation feature; ghi rõ "planned" trong báo cáo đồ án để tránh câu hỏi hội đồng.
6. `web/src/hooks/use-audio-recorder.ts:191` — `blobToBase64` pure util nằm trong hooks file. Fix: move `src/lib/` (cosmetic).
7. `mobile/app/index.tsx:17` + sibling stubs — hardcoded hex bypass ThemeProvider tokens. Fix: `useTheme()` khi implement screens.

## Recommended next steps (ranked by report value)

1. Fix api #1-#3 + packages #4 (medium) — strengthens LSP/OCP story trước defense, tất cả localized.
2. Fix web #1-#2, mobile #3-#4 — robustness, mỗi cái vài dòng.
3. Cosmetic batch: packages #3/#5/#6, web #6.
4. Decide Registry wiring (see unresolved) — affects report narrative về OCP.

## Unresolved questions

1. `ProviderRegistry` dành cho realtime path tương lai, hay app factory nên adopt ngay? (quyết định ảnh hưởng packages finding #7 + OCP note)
2. `@chatofy/types` dep trong `ai-providers/package.json` là planned import hay leftover?
3. Mobile scaffold (ws-client, audio interfaces) — giữ cho conversation feature hay xóa đến khi cần?
