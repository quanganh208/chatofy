---
phase: 7
title: 'Extension app'
status: code-complete
priority: P1
effort: '4-5d'
dependencies: [5]
---

# Phase 7: Extension app

## Overview

Dựng `apps/extension` — Chrome MV3, WXT, capture audio tab, chạy pipeline liên
tục, phát bản dịch và duck tiếng gốc, transcript trong overlay Shadow DOM, và đo
vọng âm khi phát qua loa.

Chia đôi: **7a** là spike capture-và-phát-lại có cổng nghiệm thu riêng; **7b** mới
nối pipeline. Bước 1–3 có quá nhiều chi tiết dễ sai để gộp chung với phần còn lại.

## Requirements

- Functional: load unpacked, bật trên tab Meet/Zoom web/Messenger, nghe được bản
  dịch và thấy transcript.
- Non-functional: **chạy được trên loa**, không đòi tai nghe; không đụng DOM của
  site ngoài một node overlay; MV3 CSP không eval/remote code.
- <!-- Updated: Validation Session 1 - capture indicator + first-run notice -->
  Overlay **luôn** cho thấy đang thu âm cuộc họp; popup cảnh báo ở lần bật đầu tiên.

## Architecture

```
service worker ──getMediaStreamId(tabId)──► offscreen document
      ▲                                          │
      │ chrome.runtime message                    ├─ getUserMedia(chromeMediaSource:'tab')
      │                                          ├─ AudioWorklet → CapturePump(continuous)
content script (Shadow DOM overlay)              ├─ TurnPipeline → WS /ws/translate
      │                                          ├─ OrderedPlayback → destination
      │                                          ├─ GainNode(tiếng gốc) ── duck
      └───── transcript ◄────────────────────────┴─ mic riêng → echoGate → onEchoHeard
```

**Vì sao offscreen document.** Service worker MV3 không giữ được `AudioContext`.
`reason`: `USER_MEDIA` + `AUDIO_PLAYBACK`.

**Echo: nửa đúng, nửa không.** TTS phát ở offscreen doc không quay lại
`tabCapture` được — đường vòng _số_ biến mất theo cấu trúc. Nhưng **mic của người
dùng vẫn mở và Meet/Zoom vẫn truyền nó đi**, và bộ khử vọng âm của Meet lấy tham
chiếu từ đầu ra của Meet trong tab, không phải từ `AudioContext` của offscreen
doc. Phát qua loa thì bản dịch tới tai mọi người trong cuộc họp, và có đường vòng
bậc hai qua loa/mic của họ về lại tab mình.

Không sửa được từ phía extension. Vì người dùng yêu cầu chạy trên loa, phải **đo**:
offscreen doc mở thêm một `getUserMedia({audio:true})` mic thường, nối vào một
`SpeechGate` riêng, đếm `onEchoHeard` trong lúc `OrderedPlayback` đang phát. Đây
là công cụ đã có sẵn (`capture-pump.ts:96-104,141-143`), chỉ đổi nguồn.

**Ducking miễn phí.** `tabCapture` tắt tiếng tab với người dùng và buộc offscreen
doc phát lại. Tiếng gốc **bắt buộc** đi qua `AudioContext` của mình — đặt
`GainNode` ở đó là xong. Duck phải theo trạng thái **backlog** của
`OrderedPlayback`, không chỉ `isPlaying`: nếu backlog nở thì `isPlaying` đúng
vĩnh viễn và tiếng gốc bị duck cả cuộc họp.

**`AudioContext` là của `ConversationSession`.** `ConversationSessionDeps` yêu cầu
`createAudioContext` (`:31`) và `releaseResources` đóng context đó (`:241-249`).
`GainNode` duck và mic đo vọng âm phải sống trong **cùng** context, nếu không
chúng chết lệch nhịp khi teardown.

**Worklet URL.** `chrome.runtime.getURL('worklets/mic-capture-processor.js')` truyền
vào `workletUrl` (`conversation-session.ts:35`). Phải khai trong
`web_accessible_resources` và là asset bundled riêng, không inline vào chunk.

**Overlay.** Content script chèn node vào `document.body`, `attachShadow({mode:
'closed'})` — `open` cho phép mọi script trên trang đọc `shadowRoot`, tức đọc được
transcript trực tiếp của cuộc họp riêng tư. CSS Tailwind nạp `?inline` và inject
vào shadow root. Transcript là output của model — render bằng text node, không
`dangerouslySetInnerHTML`.

**Manifest.** Viết đủ, vì thiếu quyền ở đây biểu hiện thành lỗi runtime im lặng:

```jsonc
{
  "permissions": ["tabCapture", "offscreen", "storage", "activeTab"],
  "host_permissions": [
    "https://meet.google.com/*",
    "https://*.zoom.us/wc/*",
    "https://www.messenger.com/*",
  ],
  "content_scripts": [{ "matches": [/* same three */], "js": ["content.js"] }],
  "web_accessible_resources": [
    {
      "resources": ["worklets/mic-capture-processor.js"],
      "matches": [/* same three */],
    },
  ],
}
```

`getMediaStreamId` cần extension đã được **invoke** trên tab đó — `host_permissions`
một mình không cấp, nên `activeTab` là bắt buộc. Overlay cần `content_scripts.matches`
hoặc quyền `scripting`; `host_permissions` không cấp cái nào. Match pattern phải có
scheme và path.

**Stack.** WXT (Vite) + React 19.2 + Tailwind 4, cùng version `apps/web`. Không
dùng Next. WXT chưa có trong lockfile và chưa có tiền lệ trong repo — chi phí đưa
vào nằm trong 7a.

## Related Code Files

- Create: `apps/extension/` — `wxt.config.ts`, `package.json`, `tsconfig.json`
- Create: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/entrypoints/offscreen/` (index.html + main.ts)
- Create: `apps/extension/entrypoints/content/`, `entrypoints/popup/`
- Create: `apps/extension/src/tab-audio-source.ts`, `src/duck-controller.ts`, `src/echo-monitor.ts`
- Modify: **`knip.json`** — workspace `apps/extension`
- Modify: `turbo.json` nếu cần task build riêng
- Depends: `@chatofy/realtime-client`, `@chatofy/types`

## Implementation Steps

### 7a — spike (cổng riêng)

1. Khung WXT + manifest đầy đủ như trên; workspace knip.
2. Service worker: popup → `getMediaStreamId({targetTabId})` → tạo offscreen doc
   → chuyển streamId. Xử lý offscreen doc đã tồn tại và streamId hết hạn.
3. Offscreen: `getUserMedia` chromeMediaSource `tab` → `createMediaStreamSource`
   → `GainNode` → `destination`. **Chưa dịch gì cả** — chỉ nghe lại tiếng gốc.
4. Content script chèn overlay rỗng, xác nhận node tồn tại trong DOM Meet.

**Cổng 7a:** `getMediaStreamId` trả id dùng được, tiếng tab nghe lại được qua
offscreen, node overlay tồn tại trên cả ba site. Không qua cổng này thì không đi
tiếp — mọi thứ sau đều dựa vào nó.

### 7b — pipeline

5. Nối `ConversationSession`: `maxInFlight: 3`, `fullDuplex: true`,
   `continuous: true`, `maxUtteranceMs: 8000`, `workletUrl` từ `getURL`.
6. `DuckController`: theo trạng thái backlog của `OrderedPlayback`; gain gốc
   xuống 0.2 khi phát, về 1 khi im. `setTargetAtTime`, không đặt thẳng.
7. `EchoMonitor`: `getUserMedia({audio:true})` trong **cùng** `AudioContext`, nối
   vào `SpeechGate` riêng, đếm `onEchoHeard` khi đang phát. Đẩy số vào metrics
   phase 6.
8. Overlay: Shadow DOM `closed`, reducer khoá theo lượt (phase 5), render text node.
9. <!-- Updated: Validation Session 1 - consent surface -->
   **Chỉ báo đang thu.** Một dòng trong overlay, hiện suốt phiên khi capture đang
   chạy, nói rõ extension đang thu âm cuộc họp. Không tắt được trong lúc chạy —
   một chỉ báo tắt được thì không còn là chỉ báo. Cộng một cảnh báo trong popup ở
   lần bật đầu tiên, ghi cờ đã-hiện vào `chrome.storage`.
10. Popup: bật/tắt, hướng dịch, `voiceGender`, trạng thái, và **báo rõ khi tab là
    Zoom desktop** thay vì im lặng không chạy.
11. Chạy tay trên cả ba site, cả loa lẫn tai nghe.

## Success Criteria

- [ ] Cổng 7a đạt trước khi bắt đầu 7b
- [ ] Load unpacked, bật trên Meet, nghe được bản dịch giọng người khác
- [ ] Chạy 3 phút liên tục không phải bật lại
- [ ] Tiếng gốc duck khi phát, trả lại khi im, **không kẹt duck khi backlog nở**
- [ ] Overlay hiện transcript, không phá layout Meet, `shadowRoot` không đọc được từ trang
- [ ] Chỉ báo đang thu hiện suốt phiên và không tắt được khi capture đang chạy
- [ ] Popup cảnh báo ở lần bật đầu tiên; cờ lưu vào `chrome.storage`
- [ ] Đếm được `onEchoHeard` khi chạy loa; số vào JSONL
- [ ] Chạy được trên Zoom web và Messenger web; popup báo rõ khi gặp Zoom desktop
- [ ] Build production không có eval/remote code
- [ ] `pnpm knip` exit 0 với workspace mới

## Risk Assessment

- **`tabCapture` + offscreen nhiều chi tiết dễ sai** — đó là lý do có cổng 7a.
- **Manifest thiếu quyền biểu hiện thành lỗi runtime**, không phải lỗi load. Viết
  đủ từ đầu.
- **Tailwind 4 trong Shadow DOM** là bẫy đã biết; nếu tốn thời gian thì viết CSS
  tay cho overlay, nó nhỏ. Không để chặn phase.
- **WXT chưa có tiền lệ trong repo** — nếu nó cản, lùi về Vite multi-entry +
  manifest viết tay. Quyết trong 7a, không giữa 7b.
- **Quota trong lúc phát triển.** Dùng bản ghi lặp lại thay vì họp thật khi debug.
- **Rollback:** app mới, xoá thư mục là xong; chỉ `knip.json` và `turbo.json` chạm
  ra ngoài.
