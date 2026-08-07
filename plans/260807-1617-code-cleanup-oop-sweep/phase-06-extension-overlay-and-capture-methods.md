---
title: 'Phase 6: Extension Overlay And Capture Methods'
status: todo
phase: 6
priority: P3
effort: '3h'
dependencies: [5]
---

# Phase 6: Extension Overlay And Capture Methods

## Overview

Ba god-method còn lại của extension, đều trong lớp đã có class nên chỉ là cắt
method — không dịch chuyển kiến trúc:

| Vị trí                             | Method                               | Dòng |
| ---------------------------------- | ------------------------------------ | ---- |
| `entrypoints/content/index.ts:203` | `constructor()`                      | 98   |
| `entrypoints/content/index.ts:301` | `render(state)`                      | 91   |
| `src/meeting-capture.ts:215`       | `begin(streamId, settings, patched)` | 123  |

## Requirements

- Functional: overlay hiển thị y hệt; luồng bắt đầu capture không đổi.
- Non-functional: không method nào > 60 dòng.

## Architecture

**`content/index.ts` constructor 98 dòng** — dựng cây DOM overlay. Tách thành các
builder trả về element (`buildHeader()`, `buildTranscriptPane()`, `buildControls()`).
Constructor còn lại: ghép các phần và gắn listener.

**`render()` 91 dòng** — tách theo vùng đã cập nhật: `renderStatus()`,
`renderTranscript()`, `renderErrors()`. Đây cũng là nơi đặt logic diff nếu cần
sau này, nhưng **đừng thêm bây giờ** — chưa có bằng chứng render là nút cổ chai.

**`meeting-capture.begin()` 123 dòng** — đã ở trong class `MeetingCapture`, và
`buildDirection():374` cho thấy tác giả đã bắt đầu tách. Tiếp tục cùng hướng:
`resolveSettings()`, `openSharedLive()`, `startDirections()`.

Lưu ý `MAX_IN_FLIGHT_INBOUND = 3` / `MAX_IN_FLIGHT_OUTBOUND = 2` (`:39-40`) là
hằng số đã tinh chỉnh — mang theo, đừng hợp nhất thành một số.

## Related Code Files

- Modify: `apps/extension/entrypoints/content/index.ts`
- Modify: `apps/extension/src/meeting-capture.ts`

## Implementation Steps

1. `meeting-capture.begin()` trước — nằm ở `src/`, đã có 5 spec bao quanh.
2. `content/index.ts` constructor → builder.
3. `content/index.ts` render → renderer theo vùng.
4. Chạy cổng nghiệm thu + `pnpm --filter extension test`.
5. Kiểm tra thủ công: overlay hiện đúng, phiên âm chạy, chỉ báo capture không tắt được.

## Success Criteria

- [x] `render()` 91 → **24 dòng**, tách thành `renderErrors` / `renderControls` / `renderLines`
- [x] `begin()` 123 → **85 dòng** — tách monitor echo và watchdog tab-biến-mất
- [x] `pnpm --filter extension test` pass 88, spec **không sửa** (18 test của
      `meeting-capture` gồm cả khẳng định thứ tự passthrough-trước-micro)
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh
- [ ] **KHÔNG ĐẠT — "không method nào > 60 dòng".** Còn 4:
      `content` constructor 98, `meeting-capture` :52 (75), `begin()` 85, :395 (69)
- [ ] **CỐ Ý KHÔNG LÀM — constructor của `Overlay`.** 11 field element đều
      `readonly`; đưa việc tạo vào builder buộc phải bỏ `readonly` hoặc dùng `!`.
      Đó là **đánh đổi an toàn kiểu để lấy dễ đọc, trong file không có test** —
      không đáng. Đây là quyết định, không phải bỏ sót.
- [ ] **CHƯA LÀM — kiểm tra thủ công overlay trong cuộc họp thật**

## Risk Assessment

Rủi ro thấp — cắt method trong class sẵn có, không đổi ranh giới module.

**Giả định có thể sai:** thứ tự dựng DOM trong constructor không quan trọng.
**Tín hiệu:** overlay hiện sai layout hoặc listener không bắn sau khi tách.
**Phản ứng đã định trước:** giữ nguyên **thứ tự append**; các builder chỉ được
tạo element, không được append. Constructor giữ độc quyền thứ tự.

**Cân nhắc cắt phase:** P3 — thuần đọc được. Cắt nếu hết thời gian.
