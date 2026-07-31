---
phase: 6
title: 'Hardening and docs'
status: code-complete
priority: P2
effort: '6h'
dependencies: [5]
---

# Phase 6: Hardening and docs

## Overview

Đo lại sau khi đường bơm đã chạy, đóng những lỗ vòng đời còn lại, và viết tài
liệu cho một extension đã hai chiều — gồm cả những chỗ khó chịu mà người dùng sẽ
gặp và sẽ tưởng là hỏng.

Phase 3 đã chốt hằng số bằng số đo với monitor tại chỗ. Phase này đo lại với
đường thật, vì chặng offscreen→worker→tab→port thêm độ trễ mà phase 3 chưa có.

## Requirements

- Functional: p95 và tỉ lệ turn `played` đo lại trên đường thật, so với số của
  phase 3.
- Functional: chiều ra chết không còn là trạng thái vĩnh viễn im lặng.
- Non-functional: README và docs mô tả đúng hành vi hai chiều, gồm quyền mới,
  reload + invoke lại, mute, và việc người bên kia nghe giọng tổng hợp.

## Architecture

### Đo lại trên đường thật

Cùng kịch bản thoại của phase 3, cấu hình đã chốt, nhưng bơm vào trang thật.
So hai bảng. Nếu p95 chiều ra tệ hơn phase 3 rõ rệt thì chặng relay là thủ phạm —
lever là `START_CUSHION_S` riêng cho đường này, hoặc gộp frame trước khi gửi. Ghi
số kèm hằng số.

### Chiều ra chết

Hôm nay đường duy nhất khởi động lại một session là `stopCapture()` +
`startCapture()` do một lần ghi settings kích hoạt (`background.ts:313-335`) —
người dùng không có lý do gì để bấm. Socket chiều ra rớt giữa cuộc gọi là chuyện
thường (restart server lúc dev), và sau phase 2 nó không còn kéo cả capture theo
nữa, nhưng nó vẫn chết vĩnh viễn.

Chọn một, ghi lý do:

1. Reconnect có giới hạn cho chiều ra (backoff, số lần cố định), status hiện
   `'reconnecting'`.
2. Không reconnect, nhưng overlay nói thẳng chiều ra đã dừng và cần bật lại — và
   nút bật lại phải thật sự bật lại được.

Cấm để nguyên trạng thái "status nói `sending`, thực tế đã chết".

### Đường đẩy status

Phase 2 đã bỏ `onStatus` khỏi đường đẩy hoặc throttle nó. Phase này xác nhận
bằng số: đếm message worker nhận mỗi giây trong một cuộc gọi hai chiều thật. Mỗi
status hiện kéo theo `refreshMenuTitle()` → `chrome.tabs.query`
(`background.ts:181-187`, `:199`); một tab query mỗi audio frame nhân hai chiều
là thứ phải thấy trong số liệu, không phải trong cảm giác.

### Tài liệu

README hiện mô tả extension là dịch _"what other people say"_ (dòng 61-97). Phải
sửa, và phải nói cả những chỗ khó chịu:

- Hai chiều; chiều ra **mặc định tắt**.
- Bật chiều ra cần **reload cuộc họp**, và sau reload phải **invoke lại** bằng
  phím tắt hoặc menu chuột phải, vì reload thu hồi grant `activeTab`.
- Quyền `scripting` mới, vì sao có, và rằng nó chỉ được dùng khi chiều ra bật.
- Mute trong Meet mute luôn bản dịch — đúng ngữ nghĩa, nhưng phải nói trước.
- Người bên kia nghe **giọng tổng hợp**, không phải giọng người dùng; giọng thật
  vẫn đi kèm, nhỏ hơn.
- Số `echoEvents` không bao gồm bleed từ monitor chiều ra (đã chốt ở phase 2).

## Related Code Files

- Modify: `apps/extension/entrypoints/offscreen/main.ts` — hằng số kèm số đo,
  xử lý chiều ra chết
- Modify: `apps/extension/src/page-playback-sink.ts` — cushion riêng nếu số bắt
- Modify: `README.md` — mục browser extension
- Modify: `docs/system-architecture.md`, `docs/codebase-summary.md` — nếu chúng
  mô tả extension; đọc trước, chỉ sửa chỗ đã sai
- Modify: `plans/reports/` — bảng số đo lần hai

## Implementation Steps

1. Đo lại trên đường thật, so với bảng của phase 3.
2. Chốt cushion/gộp frame nếu cần, hằng số kèm số.
3. Xử lý chiều ra chết theo một trong hai hướng, ghi lý do.
4. Xác nhận tốc độ message bằng số.
5. Cập nhật README và docs; kiểm từng câu về hành vi bằng code hoặc bằng lần
   verify tay, không viết theo trí nhớ.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm knip`.

## Success Criteria

- [ ] Bảng số lần hai trong `plans/reports/`, so được với phase 3
- [ ] Chiều ra chết: hoặc tự nối lại, hoặc nói thẳng và bật lại được
- [ ] Tốc độ message có số, không phải cảm giác
- [ ] README nói đúng: hai chiều, mặc định tắt, reload + invoke lại, quyền
      `scripting`, mute, giọng tổng hợp
- [ ] Bốn gate xanh

## Risk Assessment

| Rủi ro                                     | Giảm thiểu                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Docs viết theo ý định thay vì theo hành vi | Mỗi câu về hành vi phải chỉ được vào code hoặc vào lần verify tay  |
| Đo lần hai không so được với lần một       | Cùng kịch bản, cùng điều kiện, ghi cả hai vào cùng thư mục báo cáo |
| Reconnect chiều ra sinh vòng lặp kết nối   | Backoff + số lần cố định; không retry vô hạn                       |
