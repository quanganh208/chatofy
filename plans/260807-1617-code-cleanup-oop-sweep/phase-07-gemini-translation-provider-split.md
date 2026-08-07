---
title: 'Phase 7: Gemini Translation Provider Split'
status: todo
phase: 7
priority: P2
effort: '6h'
dependencies: []
---

# Phase 7: Gemini Translation Provider Split

> **BỊ CHẶN** cho tới khi lần chạy benchmark cuối nằm trong
> `benchmarks/live-translate/results/`. Xem "Cổng chặn" bên dưới.

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

- [ ] `gemini-translation-provider.ts` ≤ **250 dòng** (từ 633)
- [ ] Không file mới nào > 250 dòng
- [ ] Không file nào trong repo còn ≥ 3 free function cạnh một class
- [ ] `gemini-translation-provider.spec.ts` (773 dòng) pass **không sửa assertion nào**
- [ ] `benchmarks/prompt-injection/run.mjs` cho kết quả **giống hệt** trước/sau
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh

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
