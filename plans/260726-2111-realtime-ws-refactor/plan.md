---
title: 'realtime-ws-refactor'
description: 'Tách state machine WS realtime thành object có trách nhiệm rõ, xoá dead code, giữ nguyên hành vi trên dây'
status: pending
priority: P1
effort: '2-3d'
tags: [refactor, websocket, realtime, oop]
created: 2026-07-26
blockedBy: []
blocks: []
---

# realtime-ws-refactor

## Overview

Đường realtime WebSocket (thêm ở `7112b50`…`204d2d5`) hoạt động đúng và có số đo, nhưng
`translation-session.service.ts` đã phình tới **740 LOC** — gấp 3.7× guideline 200 LOC của
repo — và mang 5 trách nhiệm trong một class: registry socket, state machine lượt nói,
assemble WAV, framing audio ra, và ghi metrics. `StreamSession` là record vô hồn nên gần
như mọi private method phải nhận cặp `(socket, session)`. Phía web,
`use-streaming-translate.ts` có 13 `useRef`, `start()` ~100 dòng, và hai đường teardown
(`stop()` + `abandon()` local) có phạm vi khác nhau mà plan bản đầu đã tưởng là trùng lặp.

Plan này tách thành object, xoá dead code, và **không đổi một bit nào trên dây**.

Contract gốc: [`plans/reports/brainstorm-260726-2100-realtime-ws-refactor.md`](../reports/brainstorm-260726-2100-realtime-ws-refactor.md)

Mode: deep-tương-đương, chạy inline, cấu trúc tests-first cho mọi phase sửa code đang chạy.
Cross-plan scan: `plans/` không có plan nào chưa xong → không có quan hệ `blockedBy`/`blocks`.

Bản plan này là **bản 2**, viết lại sau red-team (3 reviewer, 28 finding, 24 accept).
Xem `## Red Team Review` ở cuối.

## Lưới an toàn — và chỗ nó KHÔNG che

`translation-session.service.spec.ts` (904 dòng, **40 test**) drive service chỉ qua public API
— `FakeSocket implements StreamSocket` + `PipelineTranslatorService` mock, không chạm private
nào. Nên phần lớn việc tách object được bảo vệ mà không cần sửa assertion nào.

**Nhưng red-team đã chứng minh lưới này có lỗ, đúng ở những guard mà Phase 1 rewire.** Xoá
guard rồi chạy suite vẫn xanh ở 3 trong 4 post-await guard, và ở 2 guard validate frame:

| Guard                                                      | file:line | Có test bắt được nếu xoá?                                                           |
| ---------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `isActive` sau await trong `readPartial`                   | `:294`    | **Không.** `spec:516` đi qua nhánh `!session` của `pushFrame`, không phải guard này |
| `isActive` sau await trong `translateLive`                 | `:347`    | **Không.** Không test nào disconnect giữa lúc bay                                   |
| `isActive` mỗi vòng `streamClauses`                        | `:586`    | **Không.** Không test nào disconnect giữa 2 clause                                  |
| `isActive` sau await trong `end()`                         | `:469`    | Có — `spec:888`                                                                     |
| `phase !== 'listening'` trong `pushFrame` → `session_busy` | `:213`    | **Không.** `session_busy` chỉ được test qua `start()` và `end()`                    |
| Cap `turn_too_long`                                        | `:248`    | **Không.** `grep turn_too_long` trong spec + e2e → 0 kết quả                        |

Vì vậy Phase 1 phải **thêm test trước khi refactor** cho 6 dòng này. Quy tắc thay cho
"spec diff = 0" của bản 1: **40 assertion cũ không đổi một chữ; test mới chỉ được thêm vào.**
Gate: `git diff` trên file spec chỉ có dòng `+`.

Cách chứng minh một test mới thật sự bắt được lỗi: xoá tạm guard đó ở local, thấy test đỏ,
rồi hoàn nguyên. Test xanh trên code hiện tại không chứng minh gì.

Baseline đo lúc 2026-07-26 21:03, trước khi sửa dòng đầu tiên:

| Suite             | Baseline                        | Sau Phase 1       | Sau Phase 2 | Sau Phase 3            |
| ----------------- | ------------------------------- | ----------------- | ----------- | ---------------------- |
| `apps/api` jest   | 17 suites / 173 tests           | 21 suites / 173+N | 22 suites   | 22 suites              |
| `apps/web` vitest | 3 files / 32 tests, 1 file skip | —                 | —           | 4 files / 32+M, 1 skip |
| `pnpm knip`       | exit 0                          | exit 0            | exit 0      | exit 0                 |

File web bị skip là `pipeline-latency.measure.spec.ts` — `skipIf(!process.env.MEASURE_PIPELINE)`
và cần api + 2 sidecar chạy thật. **Không phải gate tự động.** Gate thật cho policy
turn-taking là `capture-pump.replay.spec.ts` (fixtures tồn tại nên nó có chạy).

## Cách đo LOC — quyết định của user (2026-07-26, trong lúc chạy Phase 1)

Ngưỡng 200/260 của plan **đếm dòng code**: bỏ dòng trắng và dòng comment.

Lý do: bản plan đặt ngưỡng LOC trước khi định giá xong luật "giữ verbatim mọi comment
giải thích số đo hoặc threat-model". Hai luật này đụng nhau. Đo Phase 1 xong:
`translation-session.service.ts` còn **353 dòng tổng / 249 dòng code** — 104 dòng là
comment được cố ý giữ. Muốn xuống ≤260 dòng tổng thì phải xoá chính những comment mà
plan xếp là "tài sản đắt nhất của module".

`CLAUDE.md` viết _"If a code file exceeds 200 lines of code"_ — đọc theo dòng code là đúng
chữ của luật gốc. Ngưỡng vẫn giữ nguyên con số, chỉ chốt cách đếm.

Lệnh đo:

```bash
grep -vE '^\s*$' "$f" | grep -vE '^\s*(//|/\*\*?|\*|\*/)' | wc -l
```

Không nới ngưỡng cho `session/*.ts`: file lớn nhất là `turn-session.ts` 173 tổng / 117 code,
đạt cả hai cách đọc.

## Goals

| #   | Goal                                                                                                                                       | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | `translation-session.service.ts` còn ~150 LOC orchestration; state+behavior nằm trong object sở hữu chúng                                  | P1       |
| 2   | Không file nào trong tập sửa vượt 200 LOC (trừ `*.spec.ts`) — đo ở cuối Phase 2, không phải Phase 1. **LOC = dòng code**, xem §Cách đo LOC | P1       |
| 3   | Hành vi trên dây bất biến: schema, thứ tự event, nội dung event, mã lỗi y nguyên                                                           | P1       |
| 4   | `sampleRate` nullable chỉ tồn tại ở đúng một chỗ; `bytesPerSecond` có đúng một owner                                                       | P1       |
| 5   | Web: teardown tách 2 tầng rõ (resource-scoped vs shared-state), lifecycle nằm trong class có test                                          | P1       |
| 6   | 6 guard hiện không có test đều có test, thêm mới, không sửa cũ                                                                             | P1       |
| 7   | Xoá code không consumer **và không có consumer đã lên kế hoạch** (xem non-goals về AEC)                                                    | P2       |
| 8   | `TurnMetrics` ghi được chi phí live-translation (hiện đang ẩn)                                                                             | P2       |
| 9   | Docs khớp cây file mới                                                                                                                     | P3       |

## Phases

| #   | Phase                                                                                                           | Status  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: API session objects](./phase-01-start.md)                                                             | Done    |
| 2   | [Phase 2: turn timeline and live translation metrics](./phase-02-turn-timeline-and-live-translation-metrics.md) | Pending |
| 3   | [Phase 3: web ConversationSession extraction](./phase-03-web-conversationsession-extraction.md)                 | Pending |
| 4   | [Phase 4: dead code sweep](./phase-04-dead-code-sweep.md)                                                       | Pending |
| 5   | [Phase 5: docs and full gate](./phase-05-docs-and-full-gate.md)                                                 | Pending |

Hai chuỗi độc lập về file ownership: **1 → 2** (api) và **3 → 4** (web/types/mobile).
Phase 5 chạy cuối.

**Checkpoint rollback (mọi phase):** trước bước 1 của mỗi phase, tạo mốc revert —
`git tag plan-p{N}-start` (hoặc branch). Phase 1 commit sau **từng** bước refactor được đánh
số, để revert target là per-step chứ không phải per-phase. Phase 4 chia 3 commit theo
workspace (web / types / mobile) để một lần chạy dở không để lại cây trộn 3 workspace.

## Kiến trúc đích — apps/api

```
apps/api/src/modules/translate/
├── translate.gateway.ts                    (không đổi)
├── services/
│   ├── translation-session.service.ts      740 → ~150 LOC, public API + ctor arity y nguyên
│   ├── pipeline-translator.service.ts      (không đổi)
│   └── turn-metrics.recorder.ts            +1 field (Phase 2)
└── session/                                ← mới
    ├── stream-socket.ts                    interface StreamSocket
    ├── turn-audio.ts                       value object: sampleRate non-null, bytesPerSecond, toWav
    ├── event-channel.ts                    emit/fail/ended + JSON + swallow + log
    ├── turn-session.ts                     state + behavior một lượt nói
    ├── session-registry.ts                 chủ Map<StreamSocket, TurnSession>
    ├── translation-model-policy.ts         3 ladder model + cap speculation
    ├── outbound-audio-framer.ts            WAV → frame pcm16 200ms, lazy
    ├── live-preview.ts                     partial transcript + live translation (fire-and-forget)
    └── turn-timeline.ts                    stamp mốc thời gian → TurnMetrics (Phase 2)
```

`StreamSocket` phải tiếp tục import được từ `services/translation-session.service` — 3
consumer đang import từ đó (`translate.gateway.ts:13`, `translate.gateway.spec.ts:4`,
`translation-session.service.spec.ts:5`). Định nghĩa ở `session/stream-socket.ts`, service
`export type { StreamSocket }` lại.

**Ctor arity phải giữ đúng 2 tham số** (`pipeline`, `metrics`) — `translation-session.service.spec.ts:95`
gọi `new TranslationSessionService(pipeline, metrics)` trực tiếp và `translate.module.ts:34`
là DI. `LivePreview` dựng trong **thân** constructor, không inject, và **không** dùng field
initializer: `target: ES2022` (`tsconfig.base.json:5`) bật `useDefineForClassFields`, nên
`private readonly preview = new LivePreview(this.pipeline, …)` sẽ thấy `this.pipeline === undefined`.

## Kiến trúc đích — apps/web

```
apps/web/src/
├── conversation/
│   ├── conversation-session.ts             ← mới: sở hữu AudioContext/stream/worklet/socket/pump/playback
│   ├── conversation-status.ts              ← mới: ConversationStatus (hook re-export để page không đổi import)
│   ├── conversation-session.spec.ts        ← mới
│   └── fake-audio-context.ts               ← mới: test double cho node env
├── hooks/use-streaming-translate.ts        349 → ≤130 LOC: subscribe + useReducer + trả contract (Phase 3)
├── audio/capture-pump.ts                   bỏ 2 getter chết; GIỮ fullDuplex/echoGate (Phase 4)
├── audio/speech-gate.ts                    bỏ 2 getter chết (Phase 4)
└── clients/translate-socket.ts             `isOpen` → private (Phase 4)
```

Hook giữ nguyên tham số `options: StreamingTranslateOptions` và field `echoHeard` — xem
non-goals. `ConversationSession` do đó phải nhận cờ `fullDuplex` và phát `onEchoHeard`.

## Non-goals (có lý do, không phải bỏ sót)

- **Gộp `speculate()` với live-partial.** Số đo bảo vệ: 870ms khi head-start còn hiệu lực vs
  1760ms khi mất, 19/32 lượt sống sót (`docs/system-architecture.md:341-351`).
- **Xoá nhánh `fullDuplex` / `onEchoHeard` / `echoHeard`.** Bản 1 của plan định xoá.
  Red-team chỉ ra `docs/development-journey.md:799-816` ghi phép đo AEC âm học là _"việc kỹ
  thuật mở duy nhất"_, `fullDuplex` + `onEchoHeard` chính là dụng cụ đo đã thiết kế, và doc
  nói thẳng _"Trượt ở đây → chưa kết luận được gì, không dùng làm căn cứ đóng hướng
  full-duplex"_. Memory nói "audio simultaneity bị loại về mặt vật lý" là về _đồng thời hai
  chiều tiếng nói_, không phải về việc phép đo AEC đã xong. **Quyết định của user
  (2026-07-26): chạy phép đo trước, rồi mới xoá.** Phép đo là việc riêng, ngoài plan này.
  Sau khi có số ghi vào journey §10, việc xoá được unblock và là một dọn dẹp ~40 LOC + 4 test.
- **Tối ưu `toWav` chỉ concat phần cửa sổ.** Mỗi tick partial (300ms) hiện concat toàn buffer
  rồi bỏ hết trừ 8s cuối — worst case 60s ≈ 1.9MB memcpy/tick. Chưa đo; luật repo là đo trước.
  Phần _sạch_ (một owner cho buffer, sampleRate non-nullable) vẫn làm ở `TurnAudio`.
- **Siết `audioFrameSchema.payload` (thêm `.min(1)`).** Đó là đổi contract chia sẻ, ngoài
  scope. Phase 1 chỉ giữ đúng invariant hiện tại (`bufferedBytes > 0`) — xem Phase 1 về
  `hasAudio`. Ghi lại như việc còn nợ.
- Đổi ngưỡng/ladder model/hằng số policy nào đang có số đo.
- Thay `SpeechGate` bằng detector học (Silero).
- Realtime cho mobile; auth cho socket; ghi transcript xuống DB.
- Viết lại `docs/development-journey.md` — bản ghi lịch sử, có line number cũ.

## Success Criteria

- [ ] `apps/api`: 173 test cũ + test mới pass; 21 suites sau Phase 1, 22 sau Phase 2
- [ ] `git diff translation-session.service.spec.ts` chỉ có dòng thêm; 40 assertion cũ nguyên văn
- [ ] 6 guard trong bảng "Lưới an toàn" đều có test, và mỗi test đã được chứng minh bắt lỗi
      bằng cách xoá tạm guard
- [ ] `apps/web`: 32 test cũ pass, không xoá test nào + spec mới cho `ConversationSession`
- [ ] `apps/api` e2e `translate-ws-stream.e2e-spec.ts` pass, không sửa
- [ ] `capture-pump.replay.spec.ts` vẫn pass
- [ ] `pnpm typecheck` + `pnpm lint` + `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip` exit 0
- [ ] Sau Phase 2: `translation-session.service.ts` ≤ 200 LOC; mọi file mới ≤ 200 LOC
      (LOC = dòng code, xem §Cách đo LOC)
- [ ] Một lượt bị bỏ giữa đường vẫn ghi **0** dòng metrics (`spec:888` là net)
- [ ] Một socket chạy được **2 lượt liên tiếp** (test mới — repo hiện không có)
- [ ] `grep -rn "?? 16000" apps/api/src/modules/translate` → rỗng
- [ ] `TurnMetrics.liveTranslations` xuất hiện trong log + JSONL
- [ ] Mọi comment giải thích **số đo hoặc quyết định an toàn/threat-model** được giữ verbatim
- [ ] `ak plan validate ./plans/260726-2111-realtime-ws-refactor` exit 0

## Rủi ro toàn plan

| Rủi ro                                                                                         | Mức        | Giảm thiểu                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mất comment giải thích số đo hoặc threat-model khi di chuyển                                   | Cao        | Comment là tài sản đắt nhất của module. Di chuyển verbatim. Gate cơ học: `grep -c` cho `870ms`, `not a cap`, `unauthenticated`, `take the process down` trước/sau phải bằng nhau |
| Guard bị xoá mà suite vẫn xanh (đã chứng minh xảy ra ở 6 chỗ)                                  | Cao        | Test mới trước khi refactor + chứng minh test bắt lỗi bằng cách xoá tạm guard                                                                                                    |
| Hook web không có test → tách class dễ hỏng thứ tự re-arm mic                                  | Cao        | Phase 3 viết spec trước; thêm test stop→start→stale; kiểm tay ở browser                                                                                                          |
| `apps/api` jest từng flip working↔broken theo lần install                                      | Trung bình | Chạy baseline trước khi sửa; nếu jest hỏng vì môi trường thì dừng, không sửa test                                                                                                |
| Dừng giữa phase → cây không compile, không có mốc revert                                       | Trung bình | `git tag plan-p{N}-start` trước mỗi phase; commit sau từng bước Phase 1                                                                                                          |
| Xoá export ở `packages/types` là đổi public API của package (`src/index.ts:8` dùng `export *`) | Thấp       | Đã grep 0 consumer. Ghi nhận là minor-breaking của `@chatofy/types`. Phải rebuild `dist` trước khi typecheck, xem Phase 4                                                        |

## Open questions

1. ~~Có harness nào đọc `TurnMetrics` JSONL theo vị trí cột?~~ **Đã trả lời:** không. Reviewer
   xác nhận độc lập: `turns.jsonl` là artifact object-key, `pipeline-latency.measure.spec.ts`
   tự đo qua WS. Row cũ thiếu `liveTranslations`; reader tương lai phải chịu được key thiếu.
2. `docs/system-architecture.md:411-418` liệt kê từng file — sau khi có `session/` thì liệt
   kê đủ 9 file hay chỉ trỏ thư mục? Quyết ở Phase 5, mặc định: trỏ thư mục + nêu
   `turn-session.ts`, `turn-audio.ts`, `event-channel.ts`.
3. `LivePreview` dùng logger riêng (`new Logger(LivePreview.name)`) hay logger của service?
   Logger riêng đổi context của 2 dòng log ở `:309`/`:359`. Plan chọn **truyền logger của
   service** để log không đổi; nếu muốn context riêng thì đó là đổi hành vi quan sát được.
4. Phase 3 bước kiểm tay ở browser cần `pnpm dev:all` (api + 2 sidecar + GEMINI_API_KEY).
   Nếu môi trường không chạy được thì Phase 3 có bị block hay ghi rõ "chưa kiểm tay"?

## Red Team Review

### Session — 2026-07-26

3 reviewer (Security Adversary + Fact Checker, Assumption Destroyer + Scope Auditor/Contract
Verifier, Failure Mode Analyst + Flow Tracer). **28 finding thô → 24 accept, 1 reject, 3 trùng
lặp gộp.**
**Severity:** 5 Critical, 10 High, 9 Medium.

| #   | Finding                                                                                           | Sev      | Disposition                  | Applied To                               |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ---------------------------------------- |
| 1   | `finally` ghi metrics cho lượt bị bỏ (`return` trong `try` tại `:469`), đỏ `spec:888`             | Critical | Accept                       | Phase 2                                  |
| 2   | Đường `turn_too_long` mất `registry.delete`; cap không có test nào                                | Critical | Accept                       | Phase 1                                  |
| 3   | Snippet `end()` của Phase 2 mất `registry.close` → lượt 2 `session_busy` mãi                      | Critical | Accept                       | Phase 2                                  |
| 4   | `work.catch(() => undefined)` (`:417`) không có trong plan → unhandledRejection giết process      | Critical | Accept                       | Phase 1                                  |
| 5   | `hasAudio` làm yếu invariant `bufferedBytes > 0`; frame payload rỗng qua được schema              | Critical | Accept                       | Phase 1                                  |
| 6   | 3/4 post-await guard không có test bắt lỗi; claim "spec bảo vệ tất cả" sai                        | High     | Accept                       | plan.md, Phase 1                         |
| 7   | Dùng chung `canEmit` cho `readPartial` + `translateLive` → live translation tắt 100% lượt         | High     | Accept                       | Phase 1                                  |
| 8   | `pushFrame` có 7 guard không phải 6; thiếu `session_busy`                                         | High     | Accept                       | Phase 1                                  |
| 9   | Thứ tự bước không compile: bước 6 dùng registry của bước 7; `as const` vs `string[]`              | High     | Accept                       | Phase 1                                  |
| 10  | Gate ≤200 LOC bất khả thi ở Phase 1 vì plan tự hoãn ~40 LOC sang Phase 2                          | High     | Accept                       | Phase 1, Phase 2                         |
| 11  | Phase 4 xoá 4 test không phải 1; gate 32−1 không thể đạt                                          | High     | Accept (moot)                | Phase 4                                  |
| 12  | Mitigation `isMuted` KHÔNG bắt được việc xoá nhánh chống feedback; net thật là `:186/:187/:228`   | High     | Accept                       | Phase 4                                  |
| 13  | Fake AudioContext thiếu `sampleRate`, `disconnect()`, và chiến lược timer 60ms                    | High     | Accept                       | Phase 3                                  |
| 14  | Test "stop() giữa getUserMedia và addModule" assert `context.close()` ở chỗ context còn undefined | High     | Accept                       | Phase 3                                  |
| 15  | Teardown gộp có thể xoá state của run mới (abandon vs stop khác phạm vi)                          | High     | Accept                       | Phase 3                                  |
| 16  | Thiếu guard reentrancy `start()` khi đang chạy                                                    | High     | Accept                       | Phase 3                                  |
| 17  | Xoá dụng cụ AEC mà journey §10 ghi là việc mở duy nhất                                            | Medium   | **User decision** → hoãn xoá | plan.md non-goals, Phase 4               |
| 18  | `packages/types` resolve qua `dist` → gate typecheck của Phase 4 vô nghĩa nếu không rebuild       | Medium   | Accept                       | Phase 4                                  |
| 19  | Framer dựng sẵn toàn bộ base64 → đổi peak memory                                                  | Medium   | Accept                       | Phase 1                                  |
| 20  | `flushPending` phải detach-rồi-lặp, nếu không audio bị gửi 2 lần                                  | Medium   | Accept                       | Phase 3                                  |
| 21  | Gate "17 suites" là baseline, sau refactor là 21/22                                               | Medium   | Accept                       | plan.md, Phase 1/2/5                     |
| 22  | Phase 3/4 tranh chấp ownership contract hook; `ConversationStatus` không có nhà                   | Medium   | Accept                       | Phase 3 (finding 17 xoá phần tranh chấp) |
| 23  | Không phase nào có mốc rollback                                                                   | Medium   | Accept                       | plan.md, mọi phase                       |
| 24  | Phạm vi giữ comment nên gồm cả comment an toàn/threat-model, kèm gate cơ học                      | Medium   | Accept                       | plan.md, Phase 1                         |
| 25  | Claim "2 defect vô hình" không có căn cứ                                                          | —        | **Reject**                   | —                                        |

**Reject #25 — lý do:** claim đúng, chỉ citation sai. Bằng chứng ở
`apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts:10` ("the two defects
this project has already shipped") và `apps/web/src/state/conversation-state.ts:11` ("this
project has twice shipped exactly that kind of defect"). Đã sửa citation trong Phase 3.

**Số liệu sai trong bản 1, đã sửa:** 46 → **40** test; 4 → **3** lần `?? 16000`; 3 → **2**
bản sao `bytesPerSecond` (cái thứ ba là công thức cap, semantics khác — gộp lại chính là cách
tạo ra bug); 8 → **7** test trong `rejects what would corrupt the turn`; 12 → **13** `useRef`;
`StreamSocket` doc là `:24-30` không phải `:24-33`.

### Whole-Plan Consistency Sweep

- Files reread: plan.md, phase-01-start.md, phase-02-turn-timeline-and-live-translation-metrics.md,
  phase-03-web-conversationsession-extraction.md, phase-04-dead-code-sweep.md,
  phase-05-docs-and-full-gate.md
- Decision deltas checked: 8 (hoãn xoá AEC; bỏ `finally`; bỏ `hasAudio`; 7 guard; đổi gate LOC
  sang Phase 2; đổi quy tắc spec từ "diff 0" sang "chỉ thêm"; suite/test count; checkpoint rollback)
- Reconciled stale references: 19 (14 từ delta + 5 mâu thuẫn đánh số nội bộ trong bản viết lại:
  dải bước commit của Phase 1, "6 test" → 8 ở 3 chỗ, "8 test" → 10 ở Phase 3, tổng test ở Phase 5)
- Unresolved contradictions: 0

<!-- slug: realtime-ws-refactor -->
