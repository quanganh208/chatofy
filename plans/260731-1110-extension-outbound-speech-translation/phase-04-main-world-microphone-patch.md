---
phase: 4
title: 'Main world microphone patch'
status: pending
priority: P1
effort: '2d'
dependencies: []
---

# Phase 4: Main world microphone patch

## Overview

Cài một script chạy trong world của trang, bọc
`navigator.mediaDevices.getUserMedia`, và trả cho meeting client một audio track
do mình dựng — **passthrough thuần**, chưa bơm gì. Tiêu chí xong của phase này là
_cuộc họp không hỏng gì_, và tiêu chí đó phải kiểm được chứ không phải là một
lời khẳng định.

Tách riêng vì đây là thay đổi rủi ro nhất và phụ thuộc từng site nhiều nhất
trong cả kế hoạch. Gộp nó với việc bơm audio thì lúc Zoom vỡ tiếng sẽ không biết
vỡ vì track bị thay hay vì thứ được bơm vào.

Không phụ thuộc phase 1-3; làm song song được.

## Requirements

- Functional: khi chiều ra **đang bật**, Meet / Zoom web / Facebook groupcall vẫn
  gọi bình thường — người khác nghe rõ, mute/unmute chạy, đổi thiết bị chạy, rút
  thiết bị vẫn báo đúng.
- Functional: khi chiều ra **tắt**, không có patch nào được cài, và trang không
  phát hiện được gì.
- Functional: isolated world và MAIN world có một kênh mà **trang không đọc và
  không giả được**.
- Non-functional: patch không mang transcript, không mang setting.

## Đăng ký động, không khai báo tĩnh

WXT 0.21.2 **có** phát ra `world: 'MAIN'` (đã kiểm trong `node_modules`:
`wxt/dist/types.d.mts:767-773`, `dist/core/utils/content-scripts.mjs:42`), nên
đường khai báo tĩnh khả thi. Vẫn không dùng.

Content script khai báo tĩnh chạy ở `document_start` cho **mọi** người cài
extension, trên cả ba host, mọi lần tải trang — kể cả người không bao giờ bật
chiều ra. Hai hệ quả:

1. Người chỉ dùng chiều vào vẫn bị thay mic bằng một
   `MediaStreamAudioDestinationNode`. Mọi regression tìm thấy trong bảng verify
   dưới đây sẽ đập vào người không chọn gì cả.
2. Patch phát hiện được bằng một dòng JS
   (`Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia')` trả
   về own property; `toString()` không ra `[native code]`), nên ba site đó
   fingerprint được mọi người dùng Chatofy. `wxt.config.ts:75-81` cố ý bỏ
   `web_accessible_resources` một phần vì _"keeps the extension's id unprobeable
   from those origins"_ — khai báo tĩnh mở lại đúng cánh cửa đó bằng lối khác.

Cả hai mâu thuẫn với quyết định "mặc định tắt" của chính kế hoạch này. Và MAIN
world không có `chrome.storage` lẫn `chrome.runtime`, nên script tĩnh **không tự
gate theo setting được**: lúc isolated world kịp nói "chiều ra đang tắt" thì
trang đã gọi `getUserMedia` xong.

Nên: `chrome.scripting.registerContentScripts({ world: 'MAIN', runAt: 'document_start' })`
khi chiều ra bật, `unregisterContentScripts` khi tắt.

**Đổi quyền:** cần thêm `scripting` vào manifest. Hôm nay manifest có
`tabCapture`, `offscreen`, `storage`, `activeTab`, `contextMenus`
(`wxt.config.ts:31-45`) — không có `scripting`, và grep toàn extension không ra
lời gọi nào. Thiếu nó thì lời gọi ném **lúc chạy, im lặng, giữa cuộc họp** —
đúng loại lỗi `wxt.config.ts:14-16` cảnh báo. Thay đổi quyền này phải vào phần
docs của phase 6, vì nó đổi cả prompt lúc cài.

**Cái giá phải nói thẳng:** bật chiều ra ⇒ phải reload cuộc họp ⇒ reload thu hồi
grant `activeTab` ⇒ nút Start trên overlay **không** bật lại capture được, phải
invoke lại bằng phím tắt hoặc menu chuột phải (`wxt.config.ts:39-41`, `:56-63`).
Thông báo trên overlay phải nói cả hai bước, không chỉ "reload".

## Kênh giữa isolated world và MAIN world

`event.source === window` **không phải xác thực**. Nó chỉ phân biệt cùng-frame
với khác-frame; script của Meet, script bên thứ ba, hay XSS trên trang đều thoả.
Xây kênh điều khiển trên nó là giao cho trang quyền nói thay extension — xem
phase 5 để biết trang làm được gì với quyền đó.

Dùng `MessageChannel`:

1. MAIN chạy ở `document_start`, đăng ký đúng **một** listener `message`, chờ
   bootstrap.
2. Isolated (cũng `document_start`, chứ không phải `document_idle` như overlay
   hiện tại) `postMessage` một `MessagePort` kèm `transfer`, cộng một **nonce
   ngẫu nhiên** do worker mint cho mỗi lần mở capture.
3. MAIN gỡ listener `message` ngay lập tức. Từ đó chỉ nhận trên port.
4. Mọi frame mang nonce; MAIN bỏ frame sai nonce.

Cả hai đều là content script ở `document_start`, tức chạy trước mọi script của
trang, nên lúc bootstrap bay qua thì trang chưa có listener nào. Đó là điều làm
cho bước 2 an toàn — và cũng là giới hạn của nó: **ghi rõ trong code** rằng tính
đúng đắn phụ thuộc vào việc bootstrap xảy ra trước script trang, và nonce là lớp
thứ hai cho trường hợp giả định đó sai.

Handshake "trang đã có patch chưa" đi trên port, không đi trên `window`. Trang
giả `ready` được thì extension sẽ báo `sending` trong khi audio không tới ai —
hỏng đúng mục tiêu 5 của kế hoạch.

## `AudioContext` trong MAIN world: chủ sở hữu, vòng đời, và resume

Bản đầu không nói gì về chỗ này. Ba thứ phải chốt:

**Tạo lười, trong lời gọi `getUserMedia` đã bị bọc.** Không tạo ở
`document_start`: chưa có user gesture thì context ở `suspended`, `currentTime`
không chạy, và `MediaStreamAudioDestinationNode` phát **im lặng** trong khi
`track.readyState === 'live'`. Meet hiện mic đang bật, không ai nghe thấy gì, và
không có lỗi ở đâu cả. Chính repo này đã dính bẫy đó một lần và ghi lại:
`offscreen/main.ts:136-141`.

**`await context.resume()`**, cộng `onstatechange` để resume lại. Và một đường
lui cứng: context không `running` trong N ms thì trả **stream gốc nguyên vẹn**
chứ không trả một stream im lặng. Câm mà không biết tệ hơn không có tính năng.

**Một graph cho mỗi stream trả ra, giữ trong `WeakMap<MediaStream, Graph>`.**
Meeting client gọi `getUserMedia` nhiều lần: preview trước khi vào phòng, lúc
vào, và mỗi lần đổi thiết bị. Phase 5 bơm audio vào graph nào là câu hỏi có thật;
luật: graph **mới nhất** được trả ra, và các graph cũ bị ngắt khỏi đường bơm.

## Track trả ra: bốn thứ phải đúng

1. **`stop()` phải chạm tới track thật.** Client gọi `track.stop()` để tắt mic;
   track của destination dừng nhưng thiết bị vẫn mở và chỉ báo ghi âm của Chrome
   vẫn sáng.
2. **`enabled` xuyên qua.** Nút mute set `track.enabled = false`; destination im
   theo vì nguồn im. Bản dịch cũng bị mute cùng — đúng ngữ nghĩa của mute, nhưng
   phải báo ngược về offscreen (phase 5) chứ không chỉ im ở đồ thị.
3. **Metadata.** `getSettings()`, `label`, `deviceId`, `getCapabilities()`,
   `getConstraints()`, `applyConstraints()`, `clone()`, `id` — track destination
   trả rỗng hoặc no-op. Proxy về track gốc; kiểm từng site xem site nào thật sự
   đọc.
4. **Sự kiện vòng đời — `ended`, `mute`, `unmute`.** Destination track **không
   bao giờ** bắn chúng. Rút tai nghe USB giữa cuộc họp: track thật `ended`, track
   của ta vẫn `live` và im. Client không thấy `onended`, không báo "microphone
   disconnected", không gọi lại `getUserMedia`. Người dùng nói vào một đường chết
   suốt phần còn lại của cuộc họp, hai đầu đều không thấy gì bất thường.
   Re-dispatch các sự kiện đó từ track gốc sang track trả ra.

## Related Code Files

- Create: `apps/extension/entrypoints/inject/index.ts` — patch MAIN world
- Create: `apps/extension/src/outbound-bridge.ts` — type + nonce của kênh port,
  dùng chung giữa isolated và MAIN (giữ tối thiểu; đây là biên giới tin cậy)
- Modify: `apps/extension/entrypoints/background.ts` — register/unregister theo
  toggle, mint nonce, giữ trạng thái patch theo tab
- Modify: `apps/extension/entrypoints/content/index.ts` — bootstrap port; script
  overlay hiện chạy `document_idle`, phần bootstrap phải ở `document_start`
- Modify: `apps/extension/wxt.config.ts` — thêm quyền `scripting`
- Modify: `apps/extension/src/messages.ts` — trạng thái patch của tab

## Implementation Steps

1. Thêm `scripting` vào manifest; kiểm `.output/chrome-mv3/manifest.json` sau
   build.
2. Register/unregister động theo `settings.outbound`; register lại sau khi worker
   khởi động lại (đăng ký của `scripting` có persist, kiểm chứ đừng đoán).
3. Patch passthrough + bốn điểm về track ở trên.
4. `AudioContext` lười + resume + `WeakMap` graph + đường lui trả stream gốc.
5. Bootstrap `MessageChannel` + nonce; MAIN gỡ listener `window` sau bootstrap.
6. Worker giữ "tab này đã patch chưa"; overlay hiện điều đó cùng thông báo hai
   bước (reload **và** invoke lại).
7. Verify tay từng site, ghi lại thành bảng:

   | Site               | Gọi được | Người khác nghe rõ | Mute/unmute | Đổi thiết bị | **Rút thiết bị giữa chừng** | **Context running** | Ghi chú |
   | ------------------ | -------- | ------------------ | ----------- | ------------ | --------------------------- | ------------------- | ------- |
   | Meet               |          |                    |             |              |                             |                     |         |
   | Zoom web           |          |                    |             |              |                             |                     |         |
   | Facebook groupcall |          |                    |             |              |                             |                     |         |

8. Kiểm frame: `getUserMedia` của Zoom web và Facebook groupcall có gọi từ top
   frame không. Cả content script hiện tại lẫn entry mới đều để `allFrames` mặc
   định `false`; gọi từ iframe thì patch không tới.
9. Site nào hỏng: ghi triệu chứng và tạm loại khỏi danh sách đăng ký động,
   **không** loại khỏi extension. Chiều vào vẫn phải chạy ở đó.

## Success Criteria

- [ ] Manifest có `scripting`; đăng ký động bật/tắt theo toggle, kiểm được bằng
      `chrome.scripting.getRegisteredContentScripts()`
- [ ] Chiều ra tắt: `navigator.mediaDevices.getUserMedia` là native, không own
      property nào — trang không fingerprint được
- [ ] Meet: bảng verify xanh hết, gồm cả cột rút thiết bị và context running
- [ ] Zoom web và Facebook groupcall: có kết quả đã ghi, dù xanh hay đỏ
- [ ] Rút thiết bị giữa cuộc họp: client nhận `ended` và xử lý như bình thường
- [ ] Chỉ báo ghi âm của Chrome tắt khi client dừng mic
- [ ] Trang **không** đọc được nội dung trên port, và giả `ready` trên `window`
      không có tác dụng
- [ ] Đã trả lời câu hỏi top frame vs iframe cho cả ba site

## Risk Assessment

| Rủi ro                                         | Giảm thiểu                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Context suspended → mic câm mà không ai biết   | Tạo lười + resume + đường lui trả stream gốc; "context running" là một cột trong bảng verify                        |
| Nhiều `getUserMedia` → bơm nhầm graph          | `WeakMap` + luật "graph mới nhất"; verify khi đổi thiết bị lúc turn đang phát (phase 5)                             |
| Trang giả bootstrap trước khi isolated kịp gửi | Cả hai ở `document_start`, trước script trang; nonce là lớp hai; giả định này phải ghi trong code                   |
| Trang gỡ patch hoặc bọc đè sau khi cài         | Không ngăn được. MAIN world là lãnh thổ của trang — mọi quyết định phải đúng đều nằm ở isolated/offscreen (phase 5) |
| `scripting` đổi prompt lúc cài                 | Ghi vào docs ở phase 6; đây là đánh đổi đã chọn để không đụng mic của người không dùng tính năng                    |
| Reload + invoke lại là UX xấu                  | Thông báo phải nói cả hai bước; đây là hệ quả trực tiếp của đăng ký động                                            |
| Site xử lý audio bằng WASM sau capture         | Verify riêng từng site **trước** khi bơm gì vào                                                                     |
