---
title: 'Facebook call window activation'
description: 'Bật/tắt capture được trong cửa sổ call Facebook không có toolbar, và gỡ Messenger web khỏi phạm vi hỗ trợ'
status: in-progress
priority: P1
effort: '4h'
tags: [extension, mv3, activetab, facebook]
created: 2026-07-30
blockedBy: []
blocks: []
---

# Facebook call window activation

## Overview

Cuộc gọi Facebook mở ra một cửa sổ `type: "popup"` — không toolbar, không icon
extension. Đường bật capture duy nhất hiện nay đi qua popup của extension
(`apps/extension/entrypoints/popup/main.ts:148-171`), nên trong cửa sổ đó không
có gì để bấm.

Không phải vấn đề quyền. `https://*.facebook.com/groupcall/*` đã có đủ trong
host_permissions, content-script matches và `supportOf()`; URL thật người dùng
kiểm chứng là `https://www.facebook.com/groupcall/ROOM:.../?...`, khớp pattern.
Thiếu là **user-invocation**: `chrome.tabCapture.getMediaStreamId`
(`entrypoints/background.ts:78`) đòi extension đã được invoke trên chính tab đó,
và Chrome chỉ cấp activeTab qua bốn cửa — click action icon, context menu item,
phím tắt của commands API, gợi ý omnibox. Click vào DOM của trang (kể cả nút
trong overlay của mình) không nằm trong danh sách đó.

Plan này thêm hai cửa dùng được trong cửa sổ không toolbar (phím tắt +
context menu), rồi tận dụng việc **activeTab sống đến khi tab điều hướng hoặc
đóng** để cho overlay một nút Start/Stop thật cho phần còn lại của cuộc gọi.
Đồng thời gỡ Messenger web — Meta đã đóng bản web, giữ lại chỉ là quyền thừa.

## Context links

- **Brainstorm:** hội thoại ngày 2026-07-30 (chốt: phím tắt `Alt+Shift+C` + context menu + nút Start/Stop trong overlay; gỡ Messenger)
- **Plan trước:** `plans/260729-2306-extension-continuous-capture` (status `code-complete`) — dựng toàn bộ extension; plan này là phần tiếp theo trên cùng bề mặt, không blocking
- **Code nền:** `apps/extension/entrypoints/background.ts`, `entrypoints/popup/main.ts`, `entrypoints/content/index.ts`, `src/messages.ts`, `wxt.config.ts`

## Quyết định đã chốt

| Câu hỏi                               | Chốt                                                 | Lý do                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bật capture trong cửa sổ call thế nào | Phím tắt commands API + context menu item            | Hai loại invocation duy nhất không cần toolbar                                                                                                                       |
| Nút trong overlay có làm không        | Có, nhưng **sau** lần invoke đầu                     | Click trong trang không cấp activeTab; grant giữ đến khi tab navigate nên từ lần 2 trở đi nút chạy bình thường                                                       |
| Dùng `desktopCapture` để bỏ activeTab | Không                                                | `tabCapture` mute tab và đưa audio qua `AudioContext` của mình — đó là điều kiện để duck (`src/tab-audio-source.ts:5-13`); `desktopCapture` để tab tự phát, mất duck |
| Phím tắt                              | `Alt+Shift+C`, một `suggested_key` cho mọi OS        | Chrome map `Alt` → Option trên macOS; `Ctrl` mới là cái bị đổi thành Command nên tránh                                                                               |
| Messenger web                         | Gỡ khỏi manifest, `supportOf`, matches, README, docs | Bản web đã đóng                                                                                                                                                      |

## Goals

| #   | Goal                                                                   | Priority |
| --- | ---------------------------------------------------------------------- | -------- |
| 1   | Bật được capture từ trong cửa sổ call Facebook, không cần chạm tab gốc | P1       |
| 2   | Có ít nhất một đường bật không phụ thuộc phím tắt còn trống            | P1       |
| 3   | Sau lần bật đầu, bật/tắt bằng nút ngay trên overlay                    | P1       |
| 4   | Một nguồn sự thật duy nhất cho danh sách site được hỗ trợ              | P2       |
| 5   | Messenger web biến mất khỏi quyền, UI và tài liệu                      | P2       |

## Phases

| #   | Phase                                                                                                  | Status      |
| --- | ------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | [Shared supported URL and Messenger removal](./phase-01-shared-supported-url-and-messenger-removal.md) | In progress |
| 2   | [Toolbar-free invocation paths](./phase-02-toolbar-free-invocation-paths.md)                           | In progress |
| 3   | [Overlay start stop control](./phase-03-overlay-start-stop-control.md)                                 | In progress |
| 4   | [In-call settings reachability](./phase-04-in-call-settings-reachability.md)                           | In progress |

Phụ thuộc: 2 cần module URL chung của 1; 3 cần đường toggle của 2; 4 cần hàng
controls của 3.

**Trạng thái 2026-07-30:** cả bốn phase đã xong phần code — typecheck, lint,
`wxt build`, `pnpm knip` đều xanh và manifest sinh ra đúng. Phần còn lại của cả
bốn là kiểm tra tay trên một cuộc gọi Facebook thật (mục Verification trong từng
phase file). Không phase nào được đánh `completed` trước khi chạy xong phần đó,
đặc biệt là câu hỏi `onCommand` có bắn trong window `type: "popup"` hay không.

## Ràng buộc

- Giữ `chrome.tabCapture`. Không đổi sang `desktopCapture` (mất duck).
- Không mở host permission rộng hơn `https://*.facebook.com/groupcall/*`.
- Chỉ báo đang thu vẫn không tắt được. Nút mới điều khiển capture, không ẩn chỉ báo.
- Không auto-start khi vào call. Mỗi phiên thu vẫn bắt đầu bằng một hành động của người dùng.
- Overlay chỉ mang hai thứ đổi giữa cuộc gọi: hướng dịch và giọng. `apiBaseUrl` và
  cờ metrics ở lại popup — gõ địa chỉ trong overlay không hợp, và chúng gần như
  không đổi giữa cuộc gọi.

> Ràng buộc ban đầu ghi "settings vẫn set ở popup từ tab thường" là **sai**. Popup
> ẩn cả khối settings khi tab hiện tại không phải tab họp, mà trong lúc gọi thì mọi
> cửa sổ có toolbar đều đang ở tab khác — nên settings không mở được từ đâu cả.
> Phase 4 sửa chỗ này.

## Non-goals

- Ép cửa sổ call thành tab thường (`tabs.move`) — thêm quyền `tabs`, đảo bố cục cửa sổ, rủi ro rớt cuộc gọi.
- Đụng pipeline STT / dịch / TTS.
- Zoom desktop, Meet, hay bất kỳ site mới nào.

## Success Criteria

- [ ] Cuộc gọi Facebook thật: bấm `Alt+Shift+C` trong cửa sổ call → overlay hiện chỉ báo thu + transcript, không chạm tab Facebook gốc
- [ ] Chuột phải trong cửa sổ call có item Chatofy và bật được, kể cả khi phím tắt chưa được gán
- [ ] Sau lần bật đầu, nút Start/Stop trên overlay bật/tắt được nhiều lần trong cùng cuộc gọi
- [ ] Overlay hiển thị đúng binding thật lấy từ `chrome.commands.getAll()`; chưa gán thì chỉ sang context menu
- [ ] Đổi hướng dịch / giọng ngay trong cửa sổ call, có tác dụng ở lượt kế tiếp
- [ ] Popup mở từ tab bất kỳ vẫn cho sửa settings; chỉ nút Start phụ thuộc tab
- [ ] Không còn `messenger.com` trong `dist/manifest.json` sinh ra, trong UI popup, README, `docs/project-overview-pdr.md`
- [x] `pnpm --filter extension typecheck && pnpm --filter extension build` xanh; `pnpm knip` exit 0

## Open questions

- `chrome.commands.onCommand` có bắn khi focus đang ở window `type: "popup"` không — chưa có bằng chứng thực nghiệm, chỉ kiểm chứng được bằng một cuộc gọi thật (phase 2, bước xác minh). Nếu không bắn thì context menu gánh toàn bộ và plan không đổi cấu trúc.

<!-- slug: facebook-call-window-activation -->
