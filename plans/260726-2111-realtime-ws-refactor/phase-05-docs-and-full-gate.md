---
title: 'Phase 5: docs and full gate'
status: todo
phase: 5
priority: P3
effort: '3h'
dependencies: [2, 4]
---

# Phase 5: docs and full gate

## Overview

Cập nhật đúng phần doc bị lệch bởi 4 phase trước, rồi chạy gate toàn repo. Chỉ sửa doc nào
thật sự sai — theo `documentation-management.md`, phase xong không tự động là lý do churn doc.

## Requirements

- [ ] `docs/system-architecture.md` khớp cây file mới (api + web)
- [ ] `docs/codebase-summary.md` trỏ đúng nơi `StreamSocket` định nghĩa
- [ ] `TurnMetrics.liveTranslations` được mô tả kèm cảnh báo row cũ thiếu key
- [ ] `docs/development-journey.md` **không sửa** — và giờ điều đó nhất quán, vì Phase 4 không
      còn xoá dụng cụ đo AEC mà §10 viện dẫn
- [ ] Không doc nào mô tả hành vi mới (không có hành vi mới nào)
- [ ] Không số đo nào bị sửa

## Architecture

| File:dòng                            | Hiện tại                                                                                         | Sau refactor                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-architecture.md:413`         | `services/translation-session.service.ts` — Per-connection turn state machine                    | Vẫn là entrypoint; thêm `session/` bên dưới. Mặc định: trỏ thư mục + nêu 3 file chính `turn-session.ts`, `turn-audio.ts`, `event-channel.ts`, không liệt kê cả 9 để doc không phải sửa mỗi lần thêm module (open question #2 của plan) |
| `system-architecture.md:414`         | dòng `turn-metrics.recorder.ts`                                                                  | Thêm: row JSONL có `liveTranslations`; row ghi trước 2026-07 không có key này, reader phải chịu được key thiếu                                                                                                                         |
| `system-architecture.md:368-369`     | "One `TurnMetrics` line per turn"                                                                | Thêm mô tả cột mới                                                                                                                                                                                                                     |
| `system-architecture.md:421-427`     | Mục **Web** chỉ liệt kê `use-translate-turn.ts` + components — đã lệch từ trước khi có streaming | Thêm `src/conversation/conversation-session.ts` (chủ lifecycle), `src/hooks/use-streaming-translate.ts` (lớp mỏng), `src/audio/*` (pump/gate/queue/resampler). Sửa một chỗ vốn đã sai, không phải churn                                |
| `system-architecture.md` mục Clients | —                                                                                                | Thêm: mobile realtime sau này port `TranslateSocket` vào `packages/api-client`, không dựng abstraction WS generic (lý do 2 file scaffold bị xoá ở Phase 4)                                                                             |
| `codebase-summary.md:47`             | `StreamSocket` ở `services/translation-session.service.ts`                                       | `session/stream-socket.ts` (service vẫn re-export cho tương thích)                                                                                                                                                                     |
| `system-architecture.md:331-339`     | Đoạn `CapturePump` giữ block lại                                                                 | Không đổi — hành vi giữ nguyên. Chỉ kiểm đường dẫn file còn đúng                                                                                                                                                                       |

Không sửa mọi số đo (870ms/1760ms/19-32/p50 1163ms…): refactor không đo lại nên không được
sửa số. Muốn số mới thì phải chạy phép đo, xem bước 7.

## Related Code Files

- Modify: `docs/system-architecture.md`, `docs/codebase-summary.md`
- Do NOT modify: `docs/development-journey.md`, `docs/project-overview-pdr.md`, `README.md`
  (README nói về stack và licence, không nói cây file realtime — kiểm lại rồi bỏ qua)

## Implementation Steps

Checkpoint: `git tag plan-p5-start`.

1. Đọc `docs/system-architecture.md` phần Data Flow (≈:280-380) và Module Organization
   (≈:403-430) trước khi sửa.
2. Sửa 6 điểm lệch theo bảng. Giữ giọng văn hiện tại (giải thích tại sao, có số đo).
3. Sửa 1 dòng ở `docs/codebase-summary.md`.
4. Kiểm mọi đường dẫn trong hai doc vừa sửa còn tồn tại:
   `grep -oE '(apps|packages|services)/[a-z0-9/._-]+\.(ts|tsx|py|md)' docs/system-architecture.md docs/codebase-summary.md | sort -u`
   rồi kiểm từng file có thật.
5. Gate toàn repo, từ root:
   - `pnpm typecheck`
   - `pnpm lint`
   - `cd apps/api && pnpm test` → **22 suites**, 173 + 9 (service: 8 của Phase 1 + 1 của Phase 2)
     - N (unit mới của `session/`)
   - `cd apps/api && pnpm test:e2e` → `translate-ws-stream` + các e2e khác, không sửa
   - `cd apps/web && pnpm test` → **4 file** (1 skip), 32 test cũ + M test mới của Phase 3
   - `cd apps/web && pnpm build`
   - `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip` → exit 0
   - `ak plan validate ./plans/260726-2111-realtime-ws-refactor` → exit 0
6. Đo LOC chốt hạ:
   `wc -l apps/api/src/modules/translate/session/*.ts apps/api/src/modules/translate/services/*.ts apps/web/src/conversation/*.ts apps/web/src/hooks/use-streaming-translate.ts`
   → mọi file không phải spec ≤ 200.
7. Tuỳ chọn, nếu muốn bằng chứng latency không hồi quy: `pnpm dev:all` rồi
   `MEASURE_PIPELINE=1 pnpm --filter @chatofy/web test` để bật `pipeline-latency.measure.spec.ts`
   (cần api + local-stt + local-tts + `GEMINI_API_KEY`, tiêu quota thật). So p50/p95 với số
   trong `docs/system-architecture.md`. **Không bắt buộc** — refactor không đổi đường tính
   toán, nhưng đây là cách duy nhất chứng minh bằng số.
8. Viết báo cáo `plans/reports/refactor-<ngày>-realtime-ws-refactor.md`: LOC trước/sau từng
   file, danh sách đã xoá, 6 guard mới có test và cách đã chứng minh chúng bắt lỗi, kết quả
   từng gate, bước 7 có chạy hay không, và trạng thái kiểm tay browser của Phase 3.

## Success Criteria

- [ ] Hai doc khớp cây file mới; mọi đường dẫn trong đó tồn tại thật
- [ ] `development-journey.md` diff = 0
- [ ] Không số đo nào bị sửa
- [ ] 8 gate ở bước 5 đều pass
- [ ] Mọi file không phải spec ≤ 200 LOC
- [ ] Báo cáo có bảng LOC trước/sau, trạng thái bước 7 và trạng thái kiểm tay Phase 3

## Risk Assessment

| Rủi ro                                                         | Giảm thiểu                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Sửa doc thành mô tả ý định thay vì mô tả code                  | Bước 4 kiểm từng đường dẫn; mọi câu mới phải trỏ được về file thật                                        |
| Vô tình "cập nhật" số đo cho khớp cảm giác                     | Không đo lại thì không sửa số. Bước 7 là cách duy nhất tạo số mới                                         |
| e2e cần Postgres (`DATABASE_URL`) và có thể fail vì môi trường | Nếu fail vì hạ tầng thì báo rõ là hạ tầng, không nới test. Log 404 trong jest baseline là tiếng ồn có sẵn |
| Bước 7 tiêu quota Gemini thật                                  | Tuỳ chọn, user quyết trước khi chạy                                                                       |
