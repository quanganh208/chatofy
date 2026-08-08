---
title: 'Code Cleanup OOP Sweep'
description: 'Sửa 13 khuyết điểm chất lượng mã nguồn tìm được qua quét rộng toàn repo, xếp thứ tự quanh vùng đóng băng của benchmark đồ án.'
status: done
priority: P1
effort: '~30h'
tags: [refactor, oop, code-quality]
created: 2026-08-07
blockedBy: []
blocks: []
---

# Code Cleanup OOP Sweep

## Overview

Quét rộng toàn repo theo 5 tiêu chí (_clean, chuẩn OOP, cấu trúc rõ ràng, không
code dư thừa, không đặt hàm sai vị trí_) trả về: repo **sạch**, trừ 13 khuyết
điểm xác định được. Kế hoạch này sửa cả 13, xếp thứ tự theo **nguồn gốc** chứ
không theo khẩu vị.

Bằng chứng đầy đủ: [`plans/reports/audit-260807-1605-code-cleanup-oop.md`](../reports/audit-260807-1605-code-cleanup-oop.md)

## Ràng buộc chi phối thứ tự

Nhánh cascade của benchmark chạy xuyên qua mã ứng dụng thật
(`TranslationSessionService` → `GeminiTranslationProvider` → sidecar local).
`results/` chỉ có một lần chạy `2026-08-06T10-45-33`, còn `run-arms.mjs` bị sửa
2026-08-07 bởi commit `57b33ac`. Người dùng đã xác nhận **cần chạy lại**.

Refactor đường cascade giữa hai lần đo khiến hai nhánh được đo trên hai phiên
bản mã khác nhau — confound mà hội đồng có thể hỏi và không có câu trả lời.

**→ ĐÃ GỠ CHẶN.** Lần chạy cuối `results/2026-08-07T10-27-54-064Z/` — 200 row,
0 lỗi, 0 quota; người dùng xác nhận là dữ liệu cuối.

## Goals

| #   | Goal                                                                    | Priority |
| --- | ----------------------------------------------------------------------- | -------- |
| 1   | Mọi `@Injectable` nằm đúng thư mục theo quy tắc chứng minh được         | P1       |
| 2   | Không còn method > 110 dòng trong mã sản phẩm¹                          | P1       |
| 3   | Không còn hạ tầng audio nằm trong React hook không test được            | P1       |
| 4   | `entrypoints/` của extension mỏng; logic có state nằm ở `src/` kèm spec | P2       |
| 5   | Không file nguồn nào giữ 4 trách nhiệm tách biệt                        | P2       |
| 6   | `typecheck` / `lint` / `knip` giữ xanh suốt mọi phase                   | P1       |

¹ Phụ thuộc Phase 8. Nếu cắt Phase 8, `TranslationSessionService.end()` giữ
nguyên 121 dòng và mục tiêu 2 không đạt — lệch 1 dòng, chấp nhận được.

## Non-goals

- **`apps/mobile`** — 537 dòng tổng cộng / 19 file, lớn nhất 96 dòng. Đã sạch.
- **`services/` (Python)** — file lớn nhất 100 dòng, có test. Đã sạch.
- **Hợp nhất turn + live sau base class chung** — bị bác bỏ có chủ đích. Sự phân
  kỳ là kết quả đo được (`live-translate-session.service.ts:81-95`); base class
  chung tạo áp lực để ai đó nâng silence gate lên và vô hiệu hoá nhánh live.
- **Live path tái dùng `SessionRegistry` / `EventChannel`** — bị bác bỏ. Live có
  1 session/socket, không nhận id từ client; sẽ thừa hưởng invariant không dùng được.
- **`background.ts` → một class singleton** — nghi thức rỗng, cùng vòng đời với module.

## Phases

| #   | Phase                                                                                                 | Nhóm | Status   |
| --- | ----------------------------------------------------------------------------------------------------- | ---- | -------- |
| 1   | [Phase 1: Relocate Misplaced Injectable](./phase-01-relocate-misplaced-injectable.md)                 | A    | **Done** |
| 2   | [Phase 2: LiveSession Interface To Class](./phase-02-livesession-interface-to-class.md)               | A    | **Done** |
| 3   | [Phase 3: Gemini Live Provider Start Method](./phase-03-gemini-live-provider-start-method.md)         | A    | **Done** |
| 4   | [Phase 4: Mic Graph Out Of React Hook](./phase-04-mic-graph-out-of-react-hook.md)                     | A    | **Done** |
| —   | **CỔNG MERGE — PR #71**                                                                               | —    | —        |
| 5   | [Phase 5: Extension Background Collaborators](./phase-05-extension-background-collaborators.md)       | C    | **Done** |
| 6   | [Phase 6: Extension Overlay And Capture Methods](./phase-06-extension-overlay-and-capture-methods.md) | C    | **Done** |
| —   | **CỔNG CHẶN — benchmark chạy lại xong** (gỡ: `results/2026-08-07T10-27-54-064Z/`)                     | —    | —        |
| 7   | [Phase 7: Gemini Translation Provider Split](./phase-07-gemini-translation-provider-split.md)         | B    | **Done** |
| 8   | [Phase 8: Cascade Path God Methods](./phase-08-cascade-path-god-methods.md)                           | B    | **Cắt**  |

Phase 1-4 nằm trên `feat/gemini-live-translate`, sửa đúng những gì branch này
vừa thêm, trước khi merge PR #71. Phase 5-6 độc lập với vùng đóng băng. Phase 7
chạy sau khi có dữ liệu benchmark cuối (commit `65e0d3a`).

**Phase 8 bị cắt, 2026-08-08.** Gỡ chặn xong thì phase này lại đắt hơn chứ không
rẻ đi: dữ liệu benchmark cuối đã chốt, nên cắt `end()` bây giờ khiến mã đem bảo
vệ khác mã đã đo — đổi lấy đúng một lợi ích là dễ đọc. Chính phase file đã tự
khuyến nghị cắt nếu sát hạn nộp. Người dùng chọn cắt.

## Cổng nghiệm thu chung (mọi phase)

Mỗi phase phải giữ nguyên các cổng này, chạy **trước và sau**:

```bash
pnpm typecheck   # 13/13 pass
pnpm lint        # 0 error
pnpm knip        # sạch — 0 unused file/export/dependency
```

**Quy tắc bất biến — spec là lưới an toàn, không phải thứ để chỉnh:**
mọi phase refactor phải để spec hiện có pass **không sửa một assertion nào**.
Phải sửa assertion nghĩa là đã đổi hành vi → **dừng, báo cáo, đánh giá lại**.
Thêm spec mới thì được; sửa spec cũ để hợp với code mới thì không.

## Success Criteria

Đo lại 2026-08-08, sau khi Phase 7 xong và Phase 8 bị cắt:

- [x] Không còn `@Injectable` nào ngoài `services/` hoặc `providers/` — trong
      `modules/translate`, là phạm vi Phase 1 chứng minh quy tắc. Ngoài đó chỉ
      còn `common/interceptors`, `sessions/stores`, `users/repositories` — đúng
      quy ước Nest, không phải ngoại lệ.
- [x] `use-live-translate.ts` không còn `new AudioContext` / `getUserMedia` / `audioWorklet`
- [x] Không file nguồn non-spec nào còn giữ ≥ 3 free function cạnh một class —
      quét lại toàn `apps/api/src` + `apps/extension` + `packages`: **0 file**
- [x] `typecheck` / `lint` / `knip` xanh — `pnpm knip` exit 0, **0 phát hiện**
- [x] Mọi spec hiện có pass không sửa assertion — extension 98/98, api 389/389
- [x] PR #71 merge được sau Phase 4
- [ ] **Không đạt, đã chấp nhận: goal 2 ("không method > 110 dòng").**
      `TranslationSessionService.end()` giữ 121 dòng vì Phase 8 bị cắt. Lệch 1
      dòng, đúng như footnote goal 2 đã lường trước.

**Mục tiêu kích thước theo từng file** — chỉ liệt kê những file có phase chạm tới.

> **Cơ sở đo — sửa sau Phase 2.** Bản đầu đặt đích trên _tổng dòng_ mà không đếm
> comment. Repo này có mật độ comment **25-48%**, và các comment đó ghi lại phát
> hiện đo được và bug thật, nên chúng **không được cắt** để chạm mốc. Đích giờ đặt
> trên **dòng code** (trừ comment và dòng trắng); cột tổng chỉ để tham chiếu.
>
> Đo bằng: `tot=$(grep -c '' F); com=$(grep -cE '^\s*(//|\*|/\*)' F); blank=$(grep -cE '^\s*$' F); echo $((tot-com-blank))`

| File                                | Tổng hiện tại | Code hiện tại | Đích (code) | Phase |
| ----------------------------------- | ------------- | ------------- | ----------- | ----- |
| `background.ts`                     | 646           | 365           | ≤ 180       | 5     |
| `gemini-translation-provider.ts`    | 633           | 285           | ≤ 120       | 7     |
| `live-translate-session.service.ts` | 541 → **486** | 361 → **316** | ≤ 320 ✅    | 2     |
| `use-live-translate.ts`             | 209           | 142           | ≤ 90        | 4     |
| `content/index.ts`                  | 432           | 319           | ≤ 300       | 6     |
| `meeting-capture.ts`                | 512           | 269           | ≤ 250       | 6     |

**Đích theo method** (tổng dòng, gồm doc comment ngay trên method):

| Method                                  | Hiện tại      | Đích         | Phase |
| --------------------------------------- | ------------- | ------------ | ----- |
| `LiveTranslateSessionService.start()`   | 192 → **104** | ≤ 110 ✅     | 2     |
| `GeminiLiveTranslateProvider.start()`   | 126           | ≤ 70         | 3     |
| `MeetingCapture.begin()`                | 123           | ≤ 70         | 6     |
| `content` constructor / `render()`      | 98 / 91       | ≤ 60 mỗi cái | 6     |
| `GeminiTranslationProvider.translate()` | 109           | ≤ 70         | 7     |
| `TranslationSessionService.end()`       | 121           | ≤ 90         | 8     |
| `ConversationSession.start()`           | 181           | ≤ 100        | 8     |

**Danh sách theo dõi — cố ý KHÔNG đụng tới.** Trên ngưỡng 200 dòng nhưng gắn kết
tốt, một trách nhiệm, có spec dày. Chia nhỏ sẽ là chia cho đủ chỉ tiêu chứ không
giảm được độ phức tạp thật:
`turn-pipeline.ts` (568) · `ordered-playback.ts` (470) · `capture-pump.ts` (298) ·
`speech-gate.ts` (270) · `conversation-session.ts` (620, chỉ cắt `start()` ở Phase 8).

<!-- slug: code-cleanup-oop-sweep -->
