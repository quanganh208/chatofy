---
title: 'Phase 7: Gemini Translation Provider Split'
status: done
phase: 7
priority: P2
effort: '6h'
dependencies: []
---

# Phase 7: Gemini Translation Provider Split

> **XONG** — commit `65e0d3a`. Cổng chặn bên dưới đã gỡ trước khi chạy:
> `results/2026-08-07T10-27-54-064Z/` là dữ liệu cuối, người dùng xác nhận.

## Overview

`packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts` là
**633 dòng — file nguồn lớn nhất repo**, gấp 3 lần ngưỡng 200 dòng của dự án, và
là **file duy nhất trong repo** trộn nhiều free function quanh một class
(12 free fn + 1 class, xác nhận bằng quét toàn repo).

Đây là câu trả lời chính cho "không đặt hàm sai vị trí".

## Cổng chặn

File này nằm trên đường cascade — nhánh **đối chứng** của benchmark đồ án. Refactor
nó giữa hai lần đo khiến hai nhánh chạy trên hai phiên bản mã khác nhau.

**Điều kiện gỡ chặn:** một thư mục kết quả mới tồn tại trong
`benchmarks/live-translate/results/` được tạo **sau** commit `57b33ac`, và người
dùng xác nhận đó là dữ liệu cuối.

Kiểm tra: `ls -lt benchmarks/live-translate/results/`

## Requirements

- Functional: đầu ra dịch giống hệt. Cùng logic thử lại, cùng cooldown, cùng prompt.
- Non-functional: mỗi file một trách nhiệm; không file nào > 250 dòng.

## Architecture

Bốn trách nhiệm tách bạch đang sống chung một file:

| Trách nhiệm                   | Hàm hiện tại                                                                                                                            | File đích                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Phân loại lỗi                 | `quotaCooldownMs:175`, `isOverloaded:216`, `isAuthFailure:240`, `isModelDenied:261`, `errorMessage:147`                                 | `gemini/error-classification.ts` |
| Dựng prompt + chống injection | `asTranscriptData:304`, `stripTranscriptTags:315`, `buildTranslationInstruction:328`, `buildReminder:381` + hằng `TRANSCRIPT_*:274-291` | `gemini/prompt-builder.ts`       |
| Xoay key + model              | `resolveApiKeys:135`, `pairKey:395`, `keyOrder():562`, `cool():545` + hằng cooldown `:50-95`                                            | `gemini/key-rotation.ts`         |
| Provider                      | `GeminiTranslationProvider:399`, `translate():436`                                                                                      | giữ nguyên file, ~200 dòng       |

**Chống injection là mã bảo mật.** `stripTranscriptTags` và `asTranscriptData`
tồn tại để văn bản người dùng không thoát khỏi ranh giới `<transcript>`. Có
benchmark riêng cho nó (`benchmarks/prompt-injection/`). Tách sang file riêng
**không** được nới lỏng: cùng regex, cùng thứ tự áp dụng.

`PACIFIC_CLOCK:78` và `msUntilPacificMidnight:95` đi cùng key-rotation — chúng mô
hình hoá chu kỳ reset quota theo ngày của Gemini.

## Related Code Files

- Create: `packages/ai-providers/src/providers/gemini/error-classification.ts`
- Create: `packages/ai-providers/src/providers/gemini/prompt-builder.ts`
- Create: `packages/ai-providers/src/providers/gemini/key-rotation.ts`
- Modify: `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts`
- Có thể tạo: spec riêng cho từng file mới (spec 773 dòng hiện tại có thể tách theo)

## Implementation Steps

1. **Xác minh cổng chặn đã gỡ.** Nếu chưa, dừng.
2. Tách `error-classification.ts` — thuần, không state, dễ nhất.
3. Tách `prompt-builder.ts`. Chạy `benchmarks/prompt-injection/run.mjs` trước và
   sau, so sánh kết quả. Đây là cổng bắt buộc, không phải tuỳ chọn.
4. Tách `key-rotation.ts`. Cooldown map và cursor là state — quyết định rõ nó
   thuộc lớp rotation hay vẫn ở provider; **đừng để cả hai giữ một bản**.
5. Provider giữ lại điều phối `translate()`.
6. Chạy cổng nghiệm thu.

## Success Criteria

- [x] `gemini-translation-provider.ts` ≤ 250 dòng code — **đạt: 144** (từ 285; tổng 633 → 267)
- [x] Không file mới nào > 250 dòng code — 71 / 60 / 73
- [x] Không file nào trong repo còn ≥ 3 free function cạnh một class — **12 → 0**
- [x] `translate()` 109 → **50 dòng**
- [x] `gemini-translation-provider.spec.ts` (773 dòng, 38 ca) pass **không sửa assertion nào**
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh; 389 test api pass
- [x] **Benchmark prompt-injection chạy trước và sau.** Trước: 3.5-flash-lite 22/23,
      3.1-flash-lite 23/23. Sau: **23/23 và 23/23, 0 ca bị tác động bởi transcript**.

**Về chênh lệch 22/23 → 23/23:** không phải do refactor. Đã xác minh bằng diff:
mọi chuỗi prompt và mọi regex ranh giới (`TRANSCRIPT_OPEN/CLOSE/TAG`,
`replace(/[<>]/g)`, `replace(TRANSCRIPT_TAG)`) **giống hệt từng ký tự** so với
HEAD trước đó. Ca `fake-system-turn` là model không tất định — README của harness
đã nói: _"Answers vary between runs; a single pass proves less than it looks."_

**Ba lỗi phát sinh khi tách, đã sửa trong cùng phase:**

1. `soonestRecoverySeconds` khai `KeySlot[]` nhưng chỉ đọc `index` → nới tham số
   thay vì siết chỗ gọi.
2. `asTranscriptData` và `DEFAULT_COOLDOWN_MS` bị export nhưng chỉ dùng nội bộ →
   `knip` bắt được, đã bỏ `export`.
3. `dist/` cũ làm lint fail → build lại bằng `pnpm exec tsup`.

**State cooldown dứt khoát ở một nơi** (`KeyRotation`), đúng như plan yêu cầu —
không nhân bản giữa provider và lớp rotation.

## Risk Assessment

Lưới an toàn tốt nhất trong kế hoạch: spec 773 dòng + một benchmark chống injection
riêng. Đó là lý do phase này an toàn dù file lớn.

**Giả định có thể sai:** state cooldown chuyển sạch sang `key-rotation.ts`.
**Tín hiệu:** hai nơi cùng giữ cooldown, hoặc spec về cooldown fail.
**Phản ứng đã định trước:** state cooldown **hoặc** hoàn toàn ở lớp rotation
**hoặc** hoàn toàn ở provider. Nếu không dứt khoát được, để nguyên ở provider và
chỉ tách phần hàm thuần — nửa vời tệ hơn không tách.

**Giả định thứ hai:** hành vi chống injection không đổi khi tách file.
**Tín hiệu:** benchmark prompt-injection lệch kết quả.
**Phản ứng:** hoàn tác ngay. Đây là mã bảo mật; "gần đúng" không tính.
