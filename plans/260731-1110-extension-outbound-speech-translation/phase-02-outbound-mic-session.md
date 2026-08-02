---
phase: 2
title: 'Outbound mic session and per-direction state'
status: code-complete
priority: P1
effort: '2d'
dependencies: [1]
---

# Phase 2: Outbound mic session and per-direction state

## Overview

Mic của người dùng trở thành đầu vào của một `ConversationSession` thứ hai, dịch
theo hướng đảo, và turn của nó hiện trên overlay có nhãn riêng. Ở phase này bản
dịch vẫn phát ra loa của chính người dùng — **monitor tại chỗ**, chưa tới ai cả.
Đây là trạng thái chứng minh cả pipeline chạy được mà không đụng một dòng nào
vào trang của Meet/Zoom/Facebook.

Phải nói rõ trong UI rằng đây là monitor: dùng loa ngoài thì mic vẫn truyền nó
đi và người khác vẫn nghe thấy — đúng cảnh báo README đã ghi cho chiều vào.

Nửa còn lại của phase, và là nửa red team bắt ra nhiều lỗi nhất: mọi state trong
`offscreen/main.ts` hiện là **một** biến cho **một** session. Thêm session thứ
hai mà không tách chúng ra thì hai chiều ghi đè lẫn nhau, và ba trong số đó phá
đúng những bất biến kiến trúc này sinh ra để giữ.

## Requirements

- Functional: bật/tắt riêng chiều ra; hướng dịch là đảo của `settings.direction`;
  turn chiều ra có nhãn phân biệt trên overlay và popup.
- Functional: mic cấp cho session bị **câm hoàn toàn** trong lúc bản dịch đang
  thực sự kêu.
- Functional: một chiều hỏng **không** kéo chiều kia theo, và banner nói đúng
  chiều nào hỏng.
- Non-functional: tắt chiều ra thì mọi thứ y hệt hôm nay — không mở mic, không
  mở socket thứ hai.

## Architecture

### Session thứ hai

Trong `offscreen/main.ts`, dùng chung `AudioContext` đang có:

```ts
{
  openMicrophone: () => Promise.resolve(gatedMic.stream),
  createAudioContext: () => context,      // chung, không tạo mới
  createWorkletNode: (ctx) => new AudioWorkletNode(ctx, 'mic-capture-processor'),
  createSocket: (h) => new TranslateSocket(translateSocketUrl(settings.apiBaseUrl), h),
  workletUrl,
  ownsAudioResources: false,              // context là của file này
}
```

runtime options: `fullDuplex: true`, `continuous: true`,
`maxUtteranceMs: MAX_UTTERANCE_MS`, `maxInFlight: 2` (tạm; phase 3 chốt bằng số
đo).

Hai socket chứ không một: một session là một socket, và `direction` đi theo từng
turn nên server không bận tâm.

### Tách state theo chiều — bất biến, không phải bước

Ba biến trong `offscreen/main.ts` hiện là singleton của một session. Bảng dưới
là **hợp đồng**; sai ở đây là lỗi im lặng, không phải lỗi biên dịch.

| State hôm nay                          | Thành                                             | Ai đọc, và chỉ ai                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playbackBusy: boolean` (`main.ts:64`) | `{ inbound: boolean; outbound: boolean }`         | `DuckController.setBusy` ← **inbound only**; `EchoMonitor.isPlaying` ← **inbound only**; mic gate ← `inbound \|\| outbound` ở phase này, `inbound` từ phase 5 |
| `live: Live \| null` (`main.ts:54`)    | `{ shared, inbound, outbound }`                   | `end(direction)` chỉ trả phần của chiều đó; chỉ lệnh stop từ worker mới đóng `context`                                                                        |
| `error?: string` trên `CaptureStatus`  | `errors: { inbound?: string; outbound?: string }` | `reportStatus` **merge**, không ghi đè                                                                                                                        |

Vì sao `DuckController` chỉ đọc `inbound`: duck là để hạ tiếng **cuộc họp**
xuống dưới bản dịch mà người dùng đang nghe. Bản dịch chiều ra không dành cho
người dùng, nên duck cuộc họp vì nó là sai ở mọi phase.

Vì sao hai flag chứ không một: turn chiều ra drain xong sẽ gọi
`onPlaybackBusy(false)`; ghi vào biến chung thì nó mở gate và un-duck **trong
lúc bản dịch chiều vào còn đang kêu** — trên loa ngoài, mic nghe lại bản dịch
chiều vào và session chiều ra dịch ngược nó. Đó đúng là vòng lặp
`plan.md` nói cả kiến trúc sinh ra để tránh, quay lại qua một tai nạn thứ tự
giữa hai luồng turn độc lập. Nó cũng không tất định nên test kịch bản sẽ không
bắt được.

### Mic gate

File mới `src/outbound-mic.ts`:

```
getUserMedia({ echoCancellation, noiseSuppression, autoGainControl })
  → MediaStreamAudioSourceNode → GainNode → MediaStreamAudioDestinationNode
                                    ▲
                          gain = 0 khi bản dịch đang thực sự kêu
```

Session nhận `destination.stream`. Gate ở nguồn chứ không trong `CapturePump`,
vì pump không có đường chặn từ ngoài: `isMuted` của nó bám vào state
`awaiting-result` (`capture-pump.ts:219-221`), và ở chế độ `continuous` state đó
không bao giờ tới. Cho im lặng vào thì `SpeechGate` không thấy tiếng nói và
không mở turn.

**Tín hiệu lái gate là chỗ red team bắt lỗi nặng nhất.** Không được dùng
`OrderedPlayback.isBusy`. `isBusy` là `queue.isPlaying || this.turns.size > 0`
(`ordered-playback.ts:262-265`) và `turns` được nạp ngay khi turn **mở**
(`:163-177`), tức khi người kia **bắt đầu nói**, rồi chỉ rỗng khi mọi turn đã
đóng và đã drain. Người kia nói 45 giây thì với `MAX_UTTERANCE_MS = 8000` luôn
có turn đang mở, `isBusy` true suốt 45 giây đó cộng độ trễ cộng đuôi bản dịch —
gate đóng cả quãng, người dùng không mở nổi một turn chiều ra nào. Tính năng sẽ
pass trong phòng test yên tĩnh và hỏng đúng trong cuộc họp nó sinh ra để phục vụ.

Gate phải lái bằng **audio đang thực sự phát** — `PlaybackSink.isPlaying` —
cộng một release ngắn để không mở gate giữa hai clause của cùng một turn. Đo tỉ
lệ thời gian gate đóng trên tổng thời lượng cuộc họp ở phase 3; con số đó quyết
định tính năng có dùng được không.

### `EchoMonitor` — quyết định ở đây, không để sang cuối

`EchoMonitor` mở **stream riêng** của nó (`echo-monitor.ts:72` →
`tab-audio-source.ts:58-66`), không đi qua gate, và `onEchoHeard` cộng số đếm
lên session **chiều vào** (`main.ts:169-184`). Ở phase này bản dịch chiều ra
phát ra loa, nên mic đo echo nghe cả nó và ghi nhầm vào chiều vào.

Chốt ngay tại phase này: `EchoMonitor.isPlaying` đọc **`inbound` only**, và
status nói rõ số đó **không** bao gồm bleed từ monitor chiều ra. Để sang phase
sau thì mọi số đo của phase 3 đã nhiễm.

### Transcript và cài đặt

`TranscriptLine` thêm `origin: 'them' | 'me'`. Overlay tô khác nhau; không thêm
tab, không thêm filter. `publishTranscript()` gộp hai reducer (mỗi session một
`TurnKeyedTranscript` riêng) thành một danh sách, vẫn một message cho cả bộ như
hôm nay — lý do đã ghi ở `messages.ts:67-75`.

`CaptureStatus` thêm `outbound: 'off' | 'monitor' | 'sending'`, và giá trị đó
phải lái bằng **trạng thái sống của session chiều ra**, không phải bằng quyết
định lúc mở capture. Session chết thì báo `'off'` kèm lỗi, không phải `'sending'`
cho tới hết cuộc gọi.

`CaptureSettings.outbound: boolean`, mặc định `false`. Đổi nó thì worker mở lại
capture, y như `direction` (`background.ts:313-335`).

### Bẫy `onStopped`

`onStopped: () => void end()` (`main.ts:238`) hiện gọi `end()` toàn cục, và
`end()` đóng `AudioContext` cùng dừng tab stream (`:262-278`). Socket chiều ra
rớt — chuyện thường ngày khi restart server lúc dev — sẽ kéo theo đóng context,
dừng passthrough, và **cuộc họp câm hẳn** với người dùng, vì `tabCapture` đã mute
tab và đồ thị phát lại vừa bị tháo. Phải thành `end('outbound')` / `end('inbound')`.

Cùng chỗ đó: `reportStatus` hiện luôn ghi đè `error` (`main.ts:70-81`), và
`onStatus` được nối vào `reportStatus(true)` (`:203`) trong khi
`ConversationSession` bắn `onStatus('playing')` **mỗi audio frame**
(`conversation-session.ts:521-522`, ~5 lần/giây/turn). Banner lỗi vừa hiện đã bị
xoá trong 200ms. Merge thay vì ghi đè, và bỏ `onStatus` khỏi đường đẩy status
hoặc throttle nó — mỗi status hiện còn kéo theo `refreshMenuTitle()` →
`chrome.tabs.query` (`background.ts:181-187`), tức một tab query mỗi audio frame
nhân hai chiều.

## Related Code Files

- Create: `apps/extension/src/outbound-mic.ts` — mic + gain gate + destination
- Modify: `apps/extension/entrypoints/offscreen/main.ts` — session thứ hai, tách
  state theo chiều, `end(direction)`, `reportStatus` merge
- Modify: `apps/extension/src/messages.ts` — `origin` trên `TranscriptLine`,
  `outbound` + `errors` trên `CaptureStatus`, `outbound` trên `CaptureSettings`
- Modify: `apps/extension/src/echo-monitor.ts` — `isPlaying` đọc inbound
- Modify: `apps/extension/entrypoints/background.ts` — `applyStatus` cho hai
  chiều
- Modify: `apps/extension/src/settings.ts` — default `outbound: false`
- Modify: `apps/extension/entrypoints/content/index.ts` — nhãn nguồn, toggle
- Modify: `apps/extension/entrypoints/popup/main.ts`, `popup/index.html` — toggle

## Implementation Steps

1. `messages.ts` trước: `origin`, `outbound`, `errors`. Union này là thứ duy nhất
   chặn message lệch shape, sửa nó trước rồi để typecheck dẫn đường.
2. Tách `playbackBusy` thành hai flag theo bảng hợp đồng ở trên. Viết bảng đó
   thành comment cạnh khai báo — ai đọc flag nào là bất biến, không phải chi tiết.
3. Tách `Live` thành `{ shared, inbound, outbound }`, đổi `end()` thành
   `end(direction)`, và chỉ đóng `AudioContext` ở đường stop từ worker.
4. `reportStatus` merge theo chiều; bỏ `onStatus` khỏi đường đẩy status hoặc
   throttle nó.
5. `outbound-mic.ts`: mở mic với cleanup của browser bật (cùng lý lẽ đã ghi ở
   `tab-audio-source.ts:49-57`), gain gate, trả `{ stream, setSuppressed, stop }`.
   Ramp/release dùng lại hằng số của `DuckController`.
6. Tách phần dựng session ra một helper nhận đủ deps, để session tab và session
   mic không thành hai bản copy. `startGraph` hiện đã nhận `settings` — mở rộng
   chỗ đó, đừng viết hàm song song.
7. Nối gate: `setSuppressed(inbound || outbound)`, lái bằng `isPlaying` của
   sink, **không** bằng `isBusy`.
8. Gộp transcript hai chiều, cắt 20 dòng mỗi chiều trước khi gộp.
9. Toggle ở overlay và popup, mặc định tắt, kèm một câu nói rõ monitor nghĩa là
   gì.
10. Kiểm Chrome không gộp/đổi cấu hình thiết bị khi offscreen mở tới **ba**
    `getUserMedia` cùng lúc (echo mic, outbound mic, và tab stream).

## Phát hiện lúc làm: mic không có quyền cấp bằng manifest

Code review đặt câu hỏi offscreen document có gọi `getUserMedia({audio})` được
không. Câu trả lời: **không**, nếu chưa có quyền. Offscreen document không có UI
nên không hiện được prompt của Chrome — lời gọi bị từ chối thẳng chứ không hỏi.

Lần sửa đầu thêm `audioCapture` vào manifest. **Sai.** Đó là quyền của Chrome
App: extension khai nó thì Chrome từ chối ngay lúc load ("only allowed for
packaged apps") và không cấp gì cả. Extension **không có** quyền manifest nào
cấp mic — thứ duy nhất cấp là câu trả lời của người dùng cho prompt.

Cách đi đúng, đã làm: quyền lưu theo origin `chrome-extension://<id>` và mọi
trang của extension dùng chung. Nên có một trang mở trong **tab** hỏi một lần
(`entrypoints/microphone/`), rồi offscreen document thừa hưởng cho mọi cuộc họp
sau đó. Phải là tab chứ không phải popup: prompt lấy focus, popup mất focus là
đóng, và đóng lúc đó bị tính là dismiss. Popup chỉ hiện nút dẫn sang trang đó,
và chỉ khi chiều ra đang bật. Chi tiết ở `src/microphone-permission.ts`.

Hệ quả ngược về quá khứ: `EchoMonitor` nuốt lỗi của chính nó theo thiết kế
(`echo-monitor.ts:90-95`), nên thiếu quyền đọc ra thành "không nghe thấy echo
nào". Mọi con số `echoEvents` bằng 0 từ trước tới nay **không** chứng minh được
điều gì về echo. Phase 3 phải đo lại từ đầu, sau khi đã cấp mic qua trang trên,
và không được coi số cũ là mốc so sánh.

## Success Criteria

`(test)` = đã có unit test trong `apps/extension/src/meeting-capture.spec.ts`.
Các mục còn trống cần một cuộc họp thật với API + hai sidecar đang chạy — chúng
hỏi "Chrome/OS có thật sự làm X không" và "nghe có ổn không", không kiểm tĩnh
được.

- [x] Tắt chiều ra: không có `getUserMedia` thứ hai, không có socket thứ hai
      **(test)**
- [x] Hướng chiều ra là đảo của chiều vào **(test)**
- [x] Mic bị từ chối: chiều vào vẫn chạy, lỗi ghi vào đúng chiều **(test)**
- [x] Turn chiều ra drain xong **không** un-duck cuộc họp khi chiều vào còn kêu
      **(test)** — và duck không bao giờ đọc chiều ra
- [x] Socket chiều ra rớt: chiều vào vẫn chạy, context **không** đóng, mic được
      trả lại, banner nói đúng chiều **(test)**
- [x] Socket chiều vào rớt: capture dừng hẳn thay vì để chỉ báo ghi âm sáng trên
      một pipeline đã chết **(test)**
- [x] Teardown tự gọi lại chính nó: context chỉ đóng đúng một lần **(test)**
- [x] `status.outbound` phản ánh session sống/chết, không phải quyết định lúc mở
      **(test)**
- [x] Transcript sống lâu hơn chiều sinh ra nó **(test)**
- [x] Gate đóng khi **một trong hai** chiều còn kêu, mở khi cả hai im **(test)**
- [x] Stop giữa lúc đang start: không cài đồ thị sau lưng lệnh stop **(test)** —
      bug tìm ra khi viết test, không phải khi review
- [ ] Bật: nói tiếng Việt → nghe bản dịch tiếng Anh của chính mình, transcript
      hiện dòng có nhãn của mình
- [ ] Người kia nói liên tục 45 giây: người dùng vẫn mở được turn chiều ra trong
      các quãng im giữa các câu — logic gate đã có test, nhưng **có dùng được
      trong hội thoại thật không** là số đo của phase 3
- [ ] Quyền cấp ở trang `microphone.html` được offscreen document dùng lại —
      harness e2e chạy với `--use-fake-ui-for-media-stream` nên không phân biệt
      được "thừa hưởng" với "prompt thứ hai được tự động chấp nhận"
- [ ] Ba `getUserMedia` cùng lúc trên một thiết bị: Chrome không gộp/đổi cấu hình
- [ ] Chỉ báo ghi âm của Chrome tắt hẳn sau khi stop (test chứng minh mọi track
      đều được gọi `stop()`; việc Chrome tắt đèn thì chỉ Chrome trả lời được)
- [ ] Nghe có ổn không: ducking, không click ở hai đầu ramp, bản dịch nghe rõ

## Risk Assessment

| Rủi ro                                       | Giảm thiểu                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Hai chiều ghi đè state của nhau              | Bảng hợp đồng ở trên là bất biến, viết cạnh khai báo                    |
| Một session hỏng kéo theo session kia        | `end(direction)`; chỉ worker mới đóng context                           |
| Gate đóng quá lâu làm tính năng vô dụng      | Lái bằng `isPlaying`; đo tỉ lệ gate đóng ở phase 3                      |
| Gate làm mất câu nói chen ngang              | Chấp nhận trong quãng bản dịch đang kêu; đó là lúc người dùng đang nghe |
| Ba `getUserMedia` cùng lúc trên một thiết bị | Kiểm ở bước 10 trước khi xây tiếp                                       |
| Số echo nhiễm bởi monitor chiều ra           | `isPlaying` đọc inbound; status nói rõ số đó loại trừ gì                |
