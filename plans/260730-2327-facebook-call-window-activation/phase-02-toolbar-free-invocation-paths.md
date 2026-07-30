---
phase: 2
title: 'Toolbar-free invocation paths'
status: in-progress
priority: P1
effort: '2h'
dependencies: [1]
---

# Phase 2: Toolbar-free invocation paths

## Overview

Thêm hai cách invoke extension dùng được trong cửa sổ không có toolbar: phím tắt
`chrome.commands` và một item context menu. Cả hai đều là invocation hợp lệ nên
cấp activeTab cho đúng tab của cửa sổ call — điều kiện `getMediaStreamId` đang
thiếu.

## Requirements

- Functional: trong cửa sổ call Facebook, `Alt+Shift+C` hoặc chuột phải → item
  Chatofy bật được capture; bấm/chọn lần nữa thì dừng.
- Functional: trên tab được hỗ trợ nhưng đang capture ở tab khác, toggle chuyển
  capture sang tab đang thao tác (dùng lại `startCapture` sẵn có, nó đã tự dọn
  overlay tab cũ — `background.ts:58-71`).
- Non-functional: worker không giữ thêm state ngoài những gì rẻ để dựng lại;
  popup vẫn chạy y nguyên như trước.

## Architecture

Một điểm vào duy nhất trong worker:

```ts
async function toggleCaptureFor(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return;

  // Đang thu chính tab này → dừng. Mọi trường hợp khác là bật (kể cả khi đang
  // thu tab khác: startCapture đã xử lý việc rời tab cũ).
  if (overlay.capturing && activeTabId === tabId) {
    await stopCapture();
    return;
  }

  const support = supportOf(tab?.url);
  if (!support.ok) {
    // Chỉ những tab được hỗ trợ mới có content script để nghe; tab khác thì
    // im lặng là đúng — không có overlay nào để nói vào.
    void chrome.tabs
      .sendMessage(tabId, {
        to: 'content',
        type: 'render',
        state: { capturing: false, lines: [], error: support.message },
      })
      .catch(() => undefined);
    return;
  }

  await startCapture(tabId);
}
```

Ba nguồn gọi vào nó:

- `chrome.commands.onCommand` — nhận `(command, tab)`; `tab` là tab active của
  cửa sổ đang focus. Có fallback `chrome.tabs.query({ active: true, lastFocusedWindow: true })`
  khi Chrome không kèm tab.
- `chrome.contextMenus.onClicked` — nhận `(info, tab)`.
- Message `{ to: 'worker', type: 'toggle' }` từ content script (phase 3), lấy tab
  từ `sender.tab`.

Manifest:

```jsonc
permissions: [/* ...cũ... */, 'contextMenus'],
commands: {
  'toggle-capture': {
    suggested_key: { default: 'Alt+Shift+C' },
    description: 'Start or stop Chatofy on this meeting tab',
  },
},
```

Một `suggested_key` cho mọi OS: Chrome map `Alt` sang Option trên macOS. `Ctrl`
mới là modifier bị Chrome đổi thành Command trên macOS (muốn Control thật phải
viết `MacCtrl`), nên tránh hẳn.

Context menu đăng ký trong `chrome.runtime.onInstalled` với `removeAll()` trước
`create()` — menu được Chrome lưu, tạo lại mỗi lần worker thức dậy sẽ ném lỗi
trùng id. `contexts: ['all']` chứ không phải `['page']`: cửa sổ call gần như phủ
kín bằng `<video>`, chuột phải ở đó không phải page context. `documentUrlPatterns`
giữ đúng ba pattern site được hỗ trợ để item không hiện trên trang lạ.

Nhãn item để cố định ("Chatofy: bật/tắt dịch") thay vì đổi theo trạng thái —
đồng bộ nhãn với capture là state thứ hai phải giữ đúng, không đáng cho một dòng
menu.

## Related Code Files

- Modify: `apps/extension/wxt.config.ts` (permission `contextMenus`, khối `commands`)
- Modify: `apps/extension/entrypoints/background.ts` (`toggleCaptureFor`, hai listener, đăng ký menu, đọc binding phím tắt)
- Modify: `apps/extension/src/messages.ts` (thêm `{ to: 'worker'; type: 'toggle' }`)

## Implementation Steps

1. `messages.ts`: thêm nhánh `| { to: 'worker'; type: 'toggle' }` kèm comment nói
   rõ nguồn gửi là phím tắt / menu / overlay.
2. `wxt.config.ts`: thêm `'contextMenus'` vào `permissions`, thêm khối `commands`
   như trên. Comment: vì sao `Alt` chứ không `Ctrl`, và vì sao commands là
   invocation duy nhất còn lại khi cửa sổ không có toolbar.
3. `background.ts`: viết `toggleCaptureFor(tab)` như §Architecture, đặt cạnh
   `startCapture`/`stopCapture`. Import `supportOf` từ phase 1.
4. Đăng ký `chrome.commands.onCommand` (chỉ xử lý `'toggle-capture'`) và
   `chrome.contextMenus.onClicked` (chỉ xử lý menuItemId của mình).
5. Đăng ký menu trong `chrome.runtime.onInstalled`: `contextMenus.removeAll()` →
   `contextMenus.create({ id, title, contexts: ['all'], documentUrlPatterns })`.
6. Thêm nhánh `case 'toggle'` vào `onMessage`, dùng `_sender.tab` (đổi tên tham
   số vì từ đây nó được dùng).
7. Đọc binding thật một lần khi worker khởi động: `chrome.commands.getAll()` →
   lưu `shortcutHint: string | undefined` ở module scope (phase 3 tiêu thụ).
   Không gán được phím thì `shortcut` rỗng, để nguyên `undefined`.
8. Build, load unpacked.

## Verification (bắt buộc, làm tay)

1. Mở một cuộc gọi Facebook thật → cửa sổ `groupcall` hiện ra.
2. Bấm `Alt+Shift+C` trong cửa sổ đó. Kỳ vọng: overlay hiện chỉ báo đang thu.
   - Không có gì xảy ra → mở `chrome://extensions/shortcuts` xem phím có được gán
     không. Đã gán mà vẫn im → `onCommand` không bắn trong window `type: "popup"`;
     ghi kết luận vào plan và để context menu làm đường chính, phím tắt vẫn giữ
     cho tab thường.
3. Bấm lần nữa → dừng thu, chỉ báo biến mất.
4. Chuột phải trong cửa sổ call → chọn item Chatofy → bật; chọn lần nữa → dừng.
5. Kiểm tra tab Facebook gốc không bị đụng vào suốt quá trình.

## Todo

- [x] `toggle` trong `messages.ts`
- [x] `commands` + `contextMenus` trong manifest
- [x] `toggleCaptureFor` + ba nguồn gọi trong worker
- [x] Menu đăng ký trong `onInstalled` với `removeAll()` trước
- [x] `shortcutHint` đọc từ `commands.getAll()`
- [ ] Chạy đủ 5 bước Verification trên cuộc gọi thật, ghi kết quả bước 2

## Success Criteria

- [ ] Bật/tắt được capture trong cửa sổ call bằng ít nhất một trong hai đường, không chạm tab gốc
- [ ] Chuột phải trên `<video>` của cuộc gọi vẫn thấy item Chatofy
- [ ] Item không xuất hiện trên trang ngoài danh sách hỗ trợ
- [ ] Toggle trên tab không hỗ trợ không làm gì ngoài (nếu có overlay) hiện đúng câu giải thích
- [ ] Worker thức dậy lại không tạo menu trùng (không có lỗi "duplicate id" trong service worker log)
- [x] Build xanh, `pnpm knip` exit 0

## Risk Assessment

- **`onCommand` không bắn trong window `type: "popup"`** — chưa có bằng chứng
  thực nghiệm. Mitigation: context menu là đường độc lập, không phụ thuộc
  commands API; bước Verification 2 chốt câu trả lời trước khi làm phase 3.
- **Chrome không gán được `Alt+Shift+C` do trùng** — extension vẫn load, phím chỉ
  là "unassigned". Mitigation: `shortcutHint` để `undefined` và phase 3 chỉ sang
  context menu; user đổi được ở `chrome://extensions/shortcuts`.
- **Facebook nuốt chuột phải trên vùng video** — Mitigation: `contexts: ['all']`
  bắt cả frame/video; nếu vẫn bị nuốt ở giữa màn hình thì rìa cửa sổ vẫn cho menu
  của Chrome, và phím tắt là đường còn lại.
- **activeTab mất khi trang điều hướng** — cuộc gọi là SPA nên grant giữ được;
  nếu URL đổi thật thì người dùng invoke lại. Không cần code gì thêm.
