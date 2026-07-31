---
phase: 3
title: 'Overlay start stop control'
status: in-progress
priority: P1
effort: '1h'
dependencies: [2]
---

# Phase 3: Overlay start stop control

## Overview

Cho overlay một nút Start/Stop thật, cộng một dòng hướng dẫn nói đúng phím tắt
đang được gán. Nút không thay được lần invoke đầu tiên — nhưng activeTab sống
đến khi tab điều hướng, nên từ sau lần đó nó bật/tắt được suốt cuộc gọi.

## Requirements

- Functional: overlay có một nút, nhãn `Start`/`Stop` theo `state.capturing`;
  bấm gửi `toggle` về worker.
- Functional: khi chưa capture, overlay nói rõ cách bật lần đầu — kèm binding
  thật, hoặc chỉ sang context menu khi phím chưa được gán.
- Non-functional: chỉ báo đang thu vẫn không tắt được; nút điều khiển capture,
  không ẩn chỉ báo. Overlay vẫn không dùng `innerHTML`.

## Architecture

`OverlayState` thêm một trường tuỳ chọn:

```ts
export interface OverlayState {
  capturing: boolean;
  lines: TranscriptLine[];
  error?: string;
  /**
   * Phím tắt đang được gán cho lệnh toggle, đọc từ `chrome.commands.getAll()`.
   * `undefined` khi Chrome không gán được — overlay chuyển sang chỉ context menu
   * thay vì in một tổ hợp phím không bấm được.
   */
  shortcut?: string;
}
```

Worker điền `shortcut` trong `publish()` từ `shortcutHint` đã đọc ở phase 2.
Trường tuỳ chọn nên popup không phải sửa gì.

Overlay dựng thêm một hàng footer dưới danh sách transcript: một `<button>` và
một dòng chữ nhỏ. `render()` cập nhật nhãn nút theo `state.capturing`, và dòng
chữ chỉ hiện khi `!state.capturing`:

- có `shortcut` → `Lần đầu trong cửa sổ call: ${shortcut} hoặc chuột phải → Chatofy`
- không có → `Lần đầu trong cửa sổ call: chuột phải → Chatofy`

Nút luôn bấm được. Lần bấm đầu tiên khi tab chưa từng được invoke sẽ thất bại ở
`getMediaStreamId` với "Extension has not been invoked for the current page" —
lỗi đó đã có đường về overlay sẵn (`background.ts:143-149` → `error` → hộp
`.error`), nên người dùng thấy lý do chứ không phải một nút im lặng. Không thử
đoán trước trạng thái grant: không có API nào hỏi được, và đoán sai thì nút bị vô
hiệu hoá oan.

Panel hiện nay tự ẩn khi không capture và chưa có dòng nào (`content/index.ts:129`).
Điều kiện đó phải bỏ, nếu không thì trong cửa sổ call sạch sẽ chẳng có nút nào để
bấm. Panel hiện thường trực trên các site được hỗ trợ; chỉ báo đỏ vẫn chỉ hiện
khi đang thu.

## Related Code Files

- Modify: `apps/extension/src/messages.ts` (`shortcut?: string` trong `OverlayState`)
- Modify: `apps/extension/entrypoints/background.ts` (`publish` đính kèm `shortcut`)
- Modify: `apps/extension/entrypoints/content/index.ts` (footer, nút, dòng hướng dẫn, bỏ tự-ẩn panel, sửa câu "Open the Chatofy popup to start")

## Implementation Steps

1. `messages.ts`: thêm `shortcut?: string` vào `OverlayState` kèm comment lý do.
2. `background.ts`: `publish()` gắn `shortcut: shortcutHint` vào state trước khi
   gửi. Giữ `overlay` trong bộ nhớ như cũ.
3. `content/index.ts`: thêm CSS cho `.controls`, `.toggle`, `.hint` theo tông sẵn
   có; nút có `:focus-visible` rõ ràng vì nó nằm trên trang của người khác.
4. Dựng `<div class="controls">` chứa `<button class="toggle">` và
   `<span class="hint">`, append vào panel sau `.lines`.
5. `render()`: nhãn nút = `Stop`/`Start`; `hint.hidden = state.capturing`; nội
   dung hint theo `state.shortcut`. Bỏ dòng tự-ẩn panel.
6. Nút `click` → `chrome.runtime.sendMessage({ to: 'worker', type: 'toggle' }).catch(() => undefined)`.
   Không đổi UI tại chỗ — trạng thái thật quay về qua `render`.
7. Đổi câu rỗng `'Not capturing. Open the Chatofy popup to start.'` cho khớp thực
   tế mới (nút ngay dưới, popup không phải đường duy nhất).
8. Build, load unpacked, chạy Verification.

## Verification (làm tay, trong cuộc gọi thật)

1. Vào cửa sổ call: panel hiện với nút `Start`, dòng hint đúng phím đang gán.
2. Bấm `Start` khi chưa invoke lần nào → hộp lỗi hiện thông báo chưa được invoke
   (đây là hành vi đúng, không phải bug).
3. Invoke bằng phím tắt hoặc context menu → đang thu.
4. Bấm `Stop` → dừng. Bấm `Start` → thu lại. Lặp vài lần.
5. Đổi `chrome://extensions/shortcuts` sang phím khác → mở lại cửa sổ call →
   hint hiện phím mới. Xoá binding → hint chỉ còn nhắc context menu.

## Todo

- [x] `shortcut?: string` trong `OverlayState`, worker điền
- [x] Footer + nút Start/Stop trong shadow root
- [x] Hint đọc theo `state.shortcut`, có nhánh chưa gán phím
- [x] Panel không còn tự ẩn khi rảnh
- [ ] Chạy đủ 5 bước Verification

## Success Criteria

- [ ] Sau lần invoke đầu, nút bật/tắt được nhiều lần trong cùng cuộc gọi
- [ ] Nhãn nút luôn khớp trạng thái thật (đổi cả khi bật/tắt từ phím tắt hay menu)
- [ ] Hint khớp binding thật; không gán phím thì không in tổ hợp phím nào
- [ ] Chỉ báo đỏ vẫn hiện suốt lúc thu và không có đường nào ẩn nó
- [x] Transcript vẫn dựng bằng `textContent`, shadow root vẫn `closed`
- [x] Build xanh, `pnpm knip` exit 0

## Risk Assessment

- **Nút bị hiểu là "tắt chỉ báo"** → nhãn là `Start`/`Stop`, đặt trong hàng
  controls tách khỏi hàng chỉ báo; chỉ báo chỉ tắt khi capture thật sự dừng.
- **Panel thường trực che UI cuộc gọi** → panel đã cố định góc phải dưới, rộng
  340px; nếu vướng nút của Facebook thì chỉnh offset, không thêm cơ chế kéo thả.
- **Bấm Start trước khi có grant gây bối rối** → thông điệp lỗi đi kèm; nếu chuỗi
  của Chrome khó hiểu, thay bằng câu của mình khi bắt lỗi ở `startCapture`.
