---
title: 'Phase 4: dead code sweep'
status: done
phase: 4
priority: P2
effort: '2h'
dependencies: [3]
---

# Phase 4: dead code sweep

## Overview

Xoá 4 nhóm code không consumer nào. Mỗi nhóm đã được grep xác nhận độc lập hai lần (khi lập
plan và khi red-team). `knip` không bắt được nhóm này: nó không soi class member, và
`packages/types` là library workspace không có `entry` nên mọi export coi như public.

**Nhóm fullDuplex/echoHeard đã bị rút khỏi phase này** — xem non-goals ở `plan.md`. Hệ quả:
Phase 4 không xoá test nào, tổng test web vẫn là 32.

## Requirements

- [ ] Sau khi xoá, grep từng tên → 0 kết quả trong `apps/`, `packages/` (trừ `dist/`, `.next/`)
- [ ] **Không xoá test nào.** Web vẫn 32 test cũ + spec của Phase 3
- [ ] `pnpm knip` vẫn exit 0
- [ ] `packages/types` được **rebuild** trước khi typecheck toàn repo

## Architecture

| #   | Xoá                                                                                            | Bằng chứng                                                                                                                           | Sửa theo                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `speech-gate.ts` getters `isSpeaking` (:88), `level` (:93)                                     | grep: chỉ có định nghĩa. `level` còn trả `noiseFloor` — tên sai nghĩa                                                                | —                                                                                                                                                                                                                                      |
| 2   | `capture-pump.ts` getters `currentState` (:146), `blockDurationMs` (:232)                      | grep: chỉ có định nghĩa, spec cũng không dùng                                                                                        | Sau khi xoá `currentState`, `CaptureState` còn 1 chỗ dùng nội bộ (`:66`) → knip có thể báo export mồ côi, xử lý ở bước 7                                                                                                               |
| 3   | 11 type alias per-event: `ws-events.ts:47-50,120-126` + 11 dòng export `events/index.ts:12-23` | grep toàn repo: 0 consumer. Chỉ `ClientEvent`/`ServerEvent` được dùng                                                                | Giữ nguyên các `const *Schema` nội bộ và 2 union. `packages/types/src/index.ts:8` dùng `export *` → không có dòng tên nào phải xoá, nhưng nghĩa là 11 tên này **đã từng là public API** của `@chatofy/types` → ghi nhận minor-breaking |
| 4   | `apps/mobile/src/clients/ws-client.interface.ts` + `ws-client.native.ts`                       | File tự khai "Scaffold … no consumers yet"; realtime thật đã có ở web với thiết kế khác. Không nằm trong `knip.json` mobile `ignore` | —                                                                                                                                                                                                                                      |

**KHÔNG xoá** (đổi so với bản 1): `fullDuplex`, `echoGate`, `onEchoHeard`, `echoHeard`,
`StreamingTranslateOptions`, `FULL_DUPLEX_ALLOWED`. Chúng là dụng cụ cho phép đo AEC mà
`docs/development-journey.md:799-816` ghi là việc kỹ thuật mở duy nhất. Quyết định của user:
chạy phép đo trước. Sau khi có số ghi vào journey §10, việc xoá là một dọn dẹp riêng ~40 LOC

- 4 test (`capture-pump.spec.ts:236, :251, :262, :279`) — con số đúng, bản 1 ghi sai là 1 test.

**Ghi chú an toàn cho lần dọn dẹp tương lai đó:** net thật cho nhánh chống feedback
(`capture-pump.ts:161-172`, cái `return` chặn `onLevel` + `gate.push` → `onSpeechStart` →
`onTurnOpen` → `startSession` trên chính tiếng loa) là `capture-pump.spec.ts:186`, `:187`,
`:228`. **Không** phải `isMuted` ở `:185/:197/:246` như bản 1 ghi — `isMuted` chỉ đọc
`this.state`, mà cái `return` đó không hề set state, nên nó vẫn `true` dù nhánh còn hay mất.
`capture-pump.replay.spec.ts` cũng không phải net: nó không bao giờ tới `awaiting-result`
(không gọi `armNextTurn()`).

Nhóm 4 — nếu sau này làm realtime cho mobile, đường đi là port `TranslateSocket` vào
`packages/api-client` để hai app dùng chung, không dựng lại abstraction generic. Ghi câu đó
vào phần Clients của `docs/system-architecture.md` ở Phase 5.

## Related Code Files

- Modify: `apps/web/src/audio/speech-gate.ts`, `apps/web/src/audio/capture-pump.ts`
- Modify: `apps/web/src/clients/translate-socket.ts` (`isOpen` → private, 1 chỗ dùng: `:92`)
- Modify: `packages/types/src/events/ws-events.ts`, `packages/types/src/events/index.ts`
- Delete: `apps/mobile/src/clients/ws-client.interface.ts`, `ws-client.native.ts`
- Không sửa: `capture-pump.spec.ts` (không test nào bị xoá ở phase này)
- Read-only: `audio/live-translation-trigger.ts` — `spentCount` **không xoá**, Phase 2 đã nối

## Implementation Steps

Checkpoint: `git tag plan-p4-start`. Chia **3 commit theo workspace** (web / types / mobile) để
một lần chạy dở là revert sạch một workspace, không phải cây trộn.

1. Nhóm 1+2: xoá 4 getter. `cd apps/web && pnpm test && pnpm typecheck && pnpm lint`. Commit (web).
2. `translate-socket.ts`: `isOpen` → private. Test + typecheck. Gộp vào commit web.
3. Nhóm 3: xoá 11 alias + 11 dòng export.
4. **Rebuild `packages/types` trước khi typecheck** — consumer resolve qua `dist`
   (`package.json` `types: ./dist/index.d.ts`, `exports` đều trỏ `dist`), nên xoá ở `src` không
   ảnh hưởng typecheck cho tới khi `tsup` phát lại:
   ```
   pnpm --filter @chatofy/types build
   grep -c "ServerSessionReady" packages/types/dist/index.d.ts   # phải là 0
   pnpm typecheck                                                # toàn repo, không chỉ package
   ```
   Bản 1 ghi "nếu có script" — `"build": "tsup"` có sẵn, không điều kiện. Không rebuild thì
   gate này xanh mà chẳng chứng minh gì.
   Commit (types).
5. Nhóm 4: xoá 2 file mobile. `cd apps/mobile && pnpm typecheck && pnpm lint`. Commit (mobile).
6. Grep xác nhận từng tên trong bảng → 0 kết quả (loại `dist/`, `.next/`, `node_modules/`).
7. `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip` → exit 0. Nếu knip báo finding mới (`CaptureState`
   export mồ côi, dep mobile mồ côi) thì xử lý tại đây.

## Success Criteria

- [ ] 4 getter, 11 type alias, 2 file mobile: biến mất
- [ ] `grep -rn "WsClient\|NativeWSClient" apps` → rỗng
- [ ] `grep -c "ServerSessionReady" packages/types/dist/index.d.ts` → 0 (đã rebuild)
- [ ] `grep -rn "echoHeard\|fullDuplex\|onEchoHeard" apps` → **vẫn còn** (giữ có chủ ý)
- [ ] `spentCount` vẫn còn (có consumer từ Phase 2)
- [ ] Web: 32 test cũ + spec Phase 3, **không test nào bị xoá**
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm knip` exit 0 toàn repo
- [ ] 3 commit riêng theo workspace

## Kết quả — 2026-07-26

Checkpoint `plan-p4-start`. 4 commit (web / types / mobile / vá knip).

| Gate                                           | Đích                                     | Thực tế                                     |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| 4 getter                                       | biến mất                                 | **biến mất**                                |
| 11 type alias                                  | biến mất                                 | **biến mất**, `dist` đã rebuild             |
| 2 file mobile                                  | biến mất                                 | **biến mất**                                |
| `grep "WsClient\|NativeWSClient" apps`         | rỗng                                     | **0**                                       |
| `grep -c "ServerSessionReady" dist/index.d.ts` | 0                                        | **0**                                       |
| `echoHeard`/`fullDuplex`/`onEchoHeard`         | **vẫn còn**                              | **24 chỗ**, giữ nguyên                      |
| `spentCount`                                   | vẫn còn                                  | **4 chỗ** (có consumer từ Phase 2)          |
| Web test                                       | 32 cũ + spec Phase 3, không xoá test nào | **48 test + 1 skip**, không test nào bị xoá |
| typecheck / lint / build / knip                | exit 0                                   | **cả bốn**                                  |

### Hai thứ phát sinh ngoài bảng

1. **`blockSamples` thành field chết** sau khi xoá `blockDurationMs` — constructor dùng
   _tham số_, không dùng `this.blockSamples`, nên `private readonly` không còn ai đọc. Hạ
   xuống tham số thường. Đây là hệ quả trực tiếp của việc xoá getter, nằm trong phạm vi phase.
2. **knip bắt `export type { ConversationStatus }` ở hook.** Phase 3 thêm nó làm shim để
   "import của page không đổi" — nhưng `page.tsx` chưa bao giờ import type đó, nó đọc
   `conversation.status` và để TS suy ra. Shim là code chết ngay từ lúc viết. Đã xoá.
   `CaptureState` thì **không** thành orphan như plan lo: nó vẫn được dùng nội bộ ở `:66`.

### Không xoá, có chủ ý

`fullDuplex`, `echoGate`, `onEchoHeard`, `echoHeard`, `StreamingTranslateOptions`,
`FULL_DUPLEX_ALLOWED` — dụng cụ cho phép đo AEC mà `docs/development-journey.md:799-816` ghi
là việc kỹ thuật mở duy nhất. Quyết định của user: đo trước, xoá sau.

## Risk Assessment

| Rủi ro                                                        | Giảm thiểu                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Xoá alias ở `packages/types` mà không rebuild → gate vô nghĩa | Bước 4 rebuild không điều kiện + assert trên `dist`                    |
| `CaptureState` thành export mồ côi                            | Bước 7 knip chỉ ra; hạ xuống type nội bộ nếu spec không dùng           |
| Xoá lan sang nhánh half-duplex khi sửa `capture-pump.ts`      | Phase này **không** chạm `push()`. Chỉ xoá 2 getter ở `:146` và `:232` |
| Chạy dở để lại cây trộn 3 workspace                           | 3 commit riêng                                                         |
| Mất khả năng đo echo                                          | Không còn rủi ro này — nhóm đó đã rút khỏi phase                       |
