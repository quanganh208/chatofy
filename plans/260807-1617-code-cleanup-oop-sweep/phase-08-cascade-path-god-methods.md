---
title: 'Phase 8: Cascade Path God Methods'
status: todo
phase: 8
priority: P3
effort: '5h'
dependencies: [7]
---

# Phase 8: Cascade Path God Methods

> **BỊ CHẶN** cùng điều kiện với Phase 7. Xem "Cổng chặn" ở
> [phase-07](./phase-07-gemini-translation-provider-split.md).

## Overview

Hai god-method còn lại trên đường cascade:

| Vị trí                                                     | Method    | Dòng | File |
| ---------------------------------------------------------- | --------- | ---- | ---- |
| `apps/api/.../services/translation-session.service.ts:222` | `end()`   | 121  | 556  |
| `packages/realtime-client/.../conversation-session.ts:228` | `start()` | 181  | 620  |

Đây là mã **hoạt động tốt và đã đo đạc**. Phase này thuần cải thiện tính đọc
được — giá trị thấp nhất, làm cuối cùng, cắt được nếu hết thời gian.

## Requirements

- Functional: hành vi không đổi tuyệt đối. Đây là nhánh đối chứng của đồ án.
- Non-functional: không method nào > 80 dòng.

## Architecture

**`TranslationSessionService.end():222`** — chạy nốt pipeline khi client báo kết
thúc lượt: gom audio, STT, dịch, TTS, phát sự kiện, ghi metrics, dọn dẹp. Tách
theo bước pipeline, dùng lại collaborator sẵn có (`TurnSession`, `EventChannel`,
`TurnTimeline`) thay vì tạo lớp mới.

**`ConversationSession.start():228`** — mở mic, dựng `CapturePump`, nối
`OrderedPlayback`, mở socket, nối handler. Tách thành `openCapture()`,
`wirePlayback()`, `wireTransport()`.

**Cân nhắc DRY có chủ đích:** sau Phase 4, `MicrophoneGraph` đã tồn tại và
`ConversationSession.start()` dựng đúng thứ đó. Dùng lại nó ở đây là **hợp lệ và
được khuyến khích** — cùng workspace, cùng harness test, không phải abstraction
xuyên giao thức.

**Vẫn cấm:** hợp nhất `ConversationSession` với `LiveSession`, hay
`TranslationSessionService` với `LiveTranslateSessionService`, sau bất kỳ base
class chung nào. Dùng chung `MicrophoneGraph` là chia sẻ **hạ tầng**; base class
chung là chia sẻ **chính sách** — và chính sách là chỗ silence gate sẽ lọt vào
rồi vô hiệu hoá nhánh live.

## Related Code Files

- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`
- Modify: `packages/realtime-client/src/conversation/conversation-session.ts`

## Implementation Steps

1. **Xác minh cổng chặn đã gỡ.** Nếu chưa, dừng.
2. `ConversationSession.start()` trước — có spec 790 dòng bao quanh, lưới tốt hơn.
3. Cân nhắc dùng lại `MicrophoneGraph` từ Phase 4 nếu ranh giới khớp sạch. Nếu
   không khớp, **đừng ép** — để nguyên.
4. `TranslationSessionService.end()` — spec 1794 dòng là lưới.
5. Chạy cổng nghiệm thu.
6. **Chạy lại benchmark** và so sánh với dữ liệu cuối. Nếu số liệu lệch, đã đổi
   hành vi → hoàn tác.

## Success Criteria

- [ ] `end()` ≤ **80 dòng** (từ 121)
- [ ] `start()` ≤ **80 dòng** (từ 181)
- [ ] `translation-session.service.spec.ts` (1794 dòng) pass **không sửa assertion**
- [ ] `conversation-session.spec.ts` (790 dòng) pass **không sửa assertion**
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh
- [ ] Benchmark chạy lại cho số liệu trùng khớp dữ liệu cuối trong sai số

## Risk Assessment

Tỷ lệ giá trị/rủi ro **tệ nhất** trong kế hoạch: mã đang chạy tốt, đã đo, là
nhánh đối chứng của đồ án, và lợi ích duy nhất là dễ đọc hơn.

**Giả định có thể sai:** refactor thuần đọc-được không dịch chuyển số liệu benchmark.
**Tín hiệu:** benchmark chạy lại lệch ngoài sai số.
**Phản ứng đã định trước:** hoàn tác toàn bộ phase. Không debug, không tinh chỉnh
— dữ liệu đồ án đáng giá hơn 5 giờ dọn dẹp.

**Khuyến nghị thẳng:** nếu tới lúc này mà hạn nộp đã gần, **bỏ hẳn phase này**.
Nhóm A + Phase 7 đã đáp ứng đủ cả 5 tiêu chí. Phase 8 chỉ thêm điểm thẩm mỹ trên
đúng đoạn mã mà rủi ro cao nhất.
