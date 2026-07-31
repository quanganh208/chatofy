---
phase: 4
title: 'In-call settings reachability'
status: in-progress
priority: P1
effort: '1h'
dependencies: [3]
---

# Phase 4: In-call settings reachability

## Overview

Phase 1-3 làm được bật/tắt trong cửa sổ call nhưng **chỉ** bật/tắt. Hướng dịch và
giọng vẫn nằm sau popup — và popup ẩn toàn bộ khối settings khi tab hiện tại không
phải tab họp, nên trong lúc gọi thì không cửa sổ nào mở được chúng. Đây là lỗi có
sẵn từ trước, không phải hệ quả của ba phase kia; nó chỉ lộ ra khi cuộc gọi chuyển
sang cửa sổ riêng.

## Requirements

- Functional: settings (hướng dịch, giọng, server, metrics) mở được từ popup trên
  **bất kỳ** tab nào; chỉ nút Start mới phụ thuộc tab.
- Functional: overlay có select hướng dịch + giọng; đổi giữa cuộc gọi thì áp dụng
  ngay, không phải chờ phiên sau.
- Non-functional: content script không phình bundle — nó được nhét vào mọi trang họp.

## Architecture

**Popup.** `#controls` tách đôi: `#settings` (luôn hiện) và `#capture` (nút Start +
status, vẫn `hidden = !support.ok`). Settings không thuộc về tab nào, gate chúng
theo tab là sai từ đầu.

**Overlay.** Hai `<select>` trong hàng controls. Chúng **không** tự đọc/ghi
`chrome.storage`: bản thử đầu tiên import `src/settings.ts` vào content script và
kéo theo `@chatofy/types` — content bundle nhảy từ 8 kB lên 80 kB trên mọi trang
họp. Thay bằng một message:

```
overlay --{ to:'worker', type:'settings', direction, voiceGender }--> worker
worker: loadSettings → saveSettings(merge) → refreshSettingsHint
        nếu đang capture: stopCapture() → startCapture(tabId)   (grant activeTab còn)
        nếu không: publish(overlay)
worker --{ render, state.settings }--> overlay   (điền lại select)
```

Worker cũng nghe `chrome.storage.onChanged` rồi publish lại, nên đổi ở popup thì
overlay đang mở cập nhật theo — hai bề mặt cùng sửa một giá trị mà không lệch nhau.

Phải reopen capture chứ không vá tại chỗ: offscreen document nhận settings đúng một
lần lúc mở (`background.ts` → `begin`). Reopen giữ đúng một đường mở capture, và
grant activeTab sống qua stop nên không cần invoke lại.

## Related Code Files

- Modify: `apps/extension/entrypoints/popup/index.html` (tách `#settings` / `#capture`)
- Modify: `apps/extension/entrypoints/popup/main.ts` (chỉ gate `#capture`)
- Modify: `apps/extension/src/messages.ts` (message `settings`, `OverlayState.settings`)
- Modify: `apps/extension/entrypoints/background.ts` (`settingsHint`, `refreshSettingsHint`, case `settings`, listener `storage.onChanged`)
- Modify: `apps/extension/entrypoints/content/index.ts` (hai select, helper `select()`, gửi message, điền từ `state.settings`)

## Implementation Steps

1. Popup HTML: `#settings` bọc direction/voice/server/metrics; `#capture` bọc nút + status.
2. Popup TS: `capture.hidden = !support.ok`, bỏ gate trên settings.
3. `messages.ts`: thêm message `settings` và `OverlayState.settings`.
4. Worker: cache `settingsHint`, nạp lúc khởi động, refresh khi storage đổi, đính vào `publish`.
5. Worker: case `settings` — ghi, refresh, reopen nếu đang capture, không thì publish.
6. Content: helper `select()` dựng bằng `createElement` (không `innerHTML`), hai select
   trong hàng controls, `change` → gửi message, `render` điền lại từ `state.settings`.
7. Chạy typecheck / lint / build / knip và **kiểm tra kích thước content script**.

## Todo

- [x] Popup tách settings khỏi capture
- [x] Message `settings` + `OverlayState.settings`
- [x] Worker ghi settings, reopen capture, đồng bộ hai chiều với popup
- [x] Overlay có select hướng dịch + giọng
- [x] Content bundle không phình
- [ ] Kiểm tra tay trong cuộc gọi thật

## Verification (làm tay)

1. Trong cửa sổ call, đổi `EN → VI` sang `VI → EN` khi **đang thu**: capture mở lại,
   các dòng sau đó dịch theo chiều mới.
2. Đổi giọng khi đang thu: giọng đọc đổi ở lượt kế tiếp.
3. Mở popup từ một tab bất kỳ (không phải tab họp): thấy đủ direction / voice /
   server / metrics; không thấy nút Start, thấy câu giải thích.
4. Đổi hướng ở popup → overlay đang mở đổi select theo, không cần reload trang.

## Success Criteria

- [x] `content.js` sau build ≈ 9 kB (bản import `settings.ts` là 80 kB)
- [x] typecheck / lint / `wxt build` / `pnpm knip` xanh
- [ ] Bốn bước Verification ở trên chạy đúng trên cuộc gọi thật

## Risk Assessment

- **Reopen capture làm mất vài giây audio giữa cuộc gọi** — đúng, và không tránh
  được nếu muốn đổi hướng có tác dụng ngay. Đổi hướng giữa cuộc gọi là hành động
  hiếm và có chủ đích.
- **Hai bề mặt cùng ghi một giá trị** — worker là chỗ ghi duy nhất cho overlay;
  popup vẫn ghi thẳng nhưng `storage.onChanged` kéo overlay theo. Không có đường
  nào ghi mà bên kia không biết.
- **Hàng controls chật trên panel 340px** — `flex-wrap` cho hint xuống dòng riêng;
  nếu vẫn chật thì thu gọn nhãn select, không mở rộng panel.
