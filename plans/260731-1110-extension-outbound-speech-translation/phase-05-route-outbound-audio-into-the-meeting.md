---
phase: 5
title: 'Route outbound audio into the meeting'
status: pending
priority: P1
effort: '2d'
dependencies: [1, 2, 3, 4]
---

# Phase 5: Route outbound audio into the meeting

## Overview

Nối hai nửa lại: bản dịch chiều ra thôi phát ra loa của người dùng và đi vào
track mà meeting client đang truyền. Giọng thật vẫn đi, duck xuống trong lúc bản
dịch phát. Đây là phase làm mục tiêu của cả kế hoạch thành hiện thực, và cũng là
phase mà mô hình đe doạ phải được viết ra chứ không ngụ ý.

## Mô hình đe doạ — chốt trước, vì mọi thứ khác suy ra từ đây

**Trang họp không được tin.** Không phải vì Google hay Meta là kẻ tấn công, mà vì
một script bên thứ ba trên trang, một lỗ XSS, hay một extension khác đều chạy
trong cùng world đó. Hai thứ phải giữ:

1. Trang **không** làm cho người dùng "nói" điều họ không nói.
2. Trang **không** đọc được lời người dùng nói khi họ tin là mình đang tắt mic.

MAIN world là lãnh thổ của trang: nó đọc được code ta đặt ở đó, sửa được, gỡ
được patch, bọc đè được. Nên MAIN chỉ là **thiết bị ra không đáng tin**, mọi
quyết định phải đúng nằm ở offscreen. Báo cáo từ MAIN là gợi ý, không phải thẩm
quyền.

Đó là lý do kênh dùng `MessagePort` + nonce (phase 4), và lý do phần dưới coi
`drained`/`progress` là gợi ý.

## Requirements

- Functional: người bên kia nghe bản dịch; giọng thật nhỏ lại trong lúc đó.
- Functional: meeting client mute ⇒ chiều ra **ngừng thu và ngừng gửi**, không
  chỉ im ở đồ thị audio của trang.
- Functional: trang chưa có patch → rơi về monitor tại chỗ của phase 2, overlay
  nói cả hai bước (reload **và** invoke lại). Không im lặng nuốt audio.
- Functional: route audio sống sót qua một lần service worker bị Chrome giết.
- Non-functional: thứ tự turn, backlog và stall watchdog vẫn do `OrderedPlayback`
  ở offscreen quyết. Trang chỉ là cái loa.

## Architecture

### Sink

`src/page-playback-sink.ts`, implement `PlaybackSink` của phase 1:

| Thành viên                        | Làm gì                                          |
| --------------------------------- | ----------------------------------------------- |
| `enqueue(turnKey, samples, rate)` | `pcm16ToBase64(samples)` rồi gửi đi, kèm nonce  |
| `stopTurn(turnKey)`               | bảo trang bỏ phần còn lại của turn đó           |
| `stop()`                          | bảo trang bỏ hết; **chịu được lúc chưa có tab** |
| `isPlaying` / `isPlayingTurn`     | đọc từ sổ thời lượng tại chỗ (dưới)             |

Base64 chứ không phải typed array: message của `chrome.runtime` đi qua JSON, một
`Int16Array` sẽ tới nơi thành object có key số. ~5 message/giây mỗi turn.

### `drained` và `progress` là gợi ý, không phải thẩm quyền

Bản đầu viết _"`drained` từ trang mới là thứ chốt"_. Sai, và sai theo cách đắt.
`OrderedPlayback.pump()` cho turn đầu hàng nghỉ khi
`head.ended && !queue.isPlayingTurn(head.key)` (`ordered-playback.ts:316-318`),
và `onTurnDrained` gọi thẳng `pump()` (`:241-251`). Nếu `drained` từ trang xoá sổ
thời lượng, thì **trang** quyết định khi nào một turn kết thúc: spam `drained` là
turn sau được thả ra trong khi câu trước còn đang phát, và người bên kia nghe hai
câu chồng nhau — đúng lớp defect mà `ordered-playback.ts:28-30` nói đã hai lần
lọt vào `main` với mọi gate xanh.

Luật:

- Sổ thời lượng tại chỗ là nguồn chính: `enqueue` cộng `samples.length / rate`.
- `drained` chỉ được chấp nhận khi **đã hết** ngân sách thời lượng của turn đó
  (trừ một dung sai nhỏ). Đến sớm hơn thì bỏ.
- `turnKey` không nằm trong danh sách đang bay thì bỏ, và sổ có trần cứng — nếu
  không, key do trang đặt ra sẽ làm map phình mãi trong một offscreen document
  sống dài.
- Stall watchdog của `OrderedPlayback` vẫn là thẩm quyền cuối. Không có tin nhắn
  nào từ trang được phép **rút ngắn** một turn.

### Trong MAIN world

Thêm vào graph của phase 4:

```
mic thật ─► gain(duck) ─┐
injected PCM ─► scheduler ┴─► MediaStreamAudioDestinationNode ─► track
```

Scheduler là `PcmPlaybackQueue` import từ `@chatofy/realtime-client` (phase 1 đã
export), cho nối vào destination node thay vì `context.destination` — thêm một
tham số `destination?: AudioNode` cho constructor của nó, mặc định
`context.destination`, không đổi hành vi cũ. Đừng chép lại logic lịch phát: hai
bản copy của policy phát là đúng thứ `packages/realtime-client/src/index.ts:1-17`
tồn tại để ngăn.

Kèm theo, ghi thẳng vào phase: import module đó vào MAIN world tức là **xuất bản
mã lịch phát vào world của trang**. Đây là cái giá đã chọn, không phải điều bị bỏ
sót.

Duck: `DuckController` đặt trên nhánh mic thật, `setBusy` bám vào việc scheduler
có gì đang phát. Bơm vào graph **mới nhất** mà `getUserMedia` trả ra (`WeakMap`
của phase 4); graph cũ bị ngắt khỏi đường bơm. Không có luật này thì đổi thiết bị
giữa cuộc họp làm bản dịch chảy vào một node không ai truyền — `drained` vẫn về
đều, `OrderedPlayback` vẫn thấy turn khoẻ mạnh, và không ai nghe thấy gì.

### Mute của meeting client

Client set `track.enabled = false`. Chỉ để đồ thị im là chưa đủ: session chiều ra
ở offscreen vẫn thu, vẫn dịch, vẫn đẩy PCM base64 qua worker vào trang. Người
dùng bấm mute để nói riêng một câu, và câu đó vẫn được dịch rồi gửi vào world của
trang.

MAIN theo dõi `enabled`/`mute`/`unmute` của track trả ra và báo ngược trên port.
Offscreen nhận: chiều ra **ngừng thu** (đóng gate) và ngừng gửi. Status hiện
`outbound: 'muted'`.

### Route sống sót qua service worker restart

`activeTabId` là biến module trong worker (`background.ts:31`), và chính file đó
nói module scope chỉ được giữ thứ rẻ để dựng lại (`:20-23`). Hôm nay mất nó chỉ
làm overlay ngừng cập nhật. Phase này biến nó thành **khoá định tuyến duy nhất
của đường audio**, nên mất nó là mất hẳn tính năng, im lặng.

Kịch bản: hai bên im hơn 30 giây → Chrome giết worker → `activeTabId = null`.
Offscreen không bị ảnh hưởng, vẫn giữ hai socket. Người dùng nói, turn dịch xong,
sink gửi frame, worker tỉnh dậy với `activeTabId === null` và bỏ mọi frame. Không
có `drained` nào về, nên `isPlayingTurn` true tới khi stall watchdog nổ (~15s mỗi
turn), và status vẫn nói `'sending'`.

Luật:

- `{ activeTabId, capturing, patchedTabs }` ghi vào `chrome.storage.session` ở
  mỗi lần đổi, đọc lại lúc worker khởi động.
- Offscreen đã **nhận** `tabId` trong message `begin` (`messages.ts:56-62`) và
  đang bỏ qua nó — dùng nó để tự nhắc lại tab cho worker sau restart.
- Relay thất bại phải nổi lên thành **lỗi chiều ra**, không phải một frame bị bỏ
  âm thầm.

### Navigation

Extension hôm nay chỉ có `chrome.tabs.onRemoved` (`background.ts:365-367`); grep
`onUpdated`/`onReplaced`/`webNavigation` trên toàn `apps/extension` không ra gì.
`onRemoved` chỉ bắn khi tab **đóng**. Reload hay điều hướng không bắn gì, mà
`tabCapture` thì đi theo tab qua điều hướng — nên capture chạy tiếp trong khi
document, và patch, đã biến mất.

Thêm `chrome.tabs.onUpdated` (status `loading` trên `activeTabId`): xoá state
phát ở phía trang, chạy lại handshake, và đánh giá lại sink **giữa capture** chứ
không chốt một lần lúc mở. Không có nó, một trang có patch khởi tạo muộn sẽ mãi
kẹt ở `monitor`, và một trang vừa reload sẽ mãi kẹt ở `sending` vào hư không.

### Chọn sink

Đã patch (xác nhận trên port, không phải trên `window`) → `PagePlaybackSink`,
`outbound: 'sending'`. Chưa patch → `PcmPlaybackQueue` thường như phase 2,
`outbound: 'monitor'`, overlay hiện: reload cuộc họp **và** invoke lại bằng phím
tắt hoặc menu chuột phải (reload thu hồi grant `activeTab` —
`wxt.config.ts:39-41`, `:56-63`). Quyết định này đánh giá lại được, không đóng
băng lúc mở capture.

## Related Code Files

- Create: `apps/extension/src/page-playback-sink.ts`
- Modify: `apps/extension/entrypoints/inject/index.ts` — scheduler, duck, báo
  mute, gửi `drained`/`progress`
- Modify: `apps/extension/entrypoints/content/index.ts` — chuyển tiếp hai chiều
  trên port
- Modify: `apps/extension/entrypoints/background.ts` — relay, `storage.session`,
  `onUpdated`, lỗi relay
- Modify: `apps/extension/entrypoints/offscreen/main.ts` — chọn sink, xử lý mute
- Modify: `apps/extension/src/messages.ts` — message audio, `drained`/`progress`,
  mute, `outbound: 'muted'`
- Modify: `packages/realtime-client/src/audio/pcm-playback-queue.ts` — tham số
  `destination`
- Modify: `apps/extension/src/outbound-bridge.ts` — type của kênh port

## Implementation Steps

1. `destination?: AudioNode` cho `PcmPlaybackQueue`; test cũ pass nguyên, thêm
   test chứng minh chunk đi vào node được truyền chứ không ra `context.destination`.
2. `PagePlaybackSink` + sổ thời lượng + luật chấp nhận `drained`; test bằng
   transport giả, gồm cả `drained` đến sớm và `turnKey` lạ.
3. Message + nonce trên port; MAIN bơm vào graph mới nhất.
4. `DuckController` trên nhánh mic thật trong MAIN.
5. Mute: MAIN báo ngược, offscreen đóng gate và ngừng gửi, status `'muted'`.
6. `storage.session` cho route state; relay lỗi → lỗi chiều ra.
7. `chrome.tabs.onUpdated`; sink đánh giá lại được giữa capture.
8. Verify tay — mỗi dòng là một lần chạy riêng:
   - một câu → người bên kia nghe bản dịch, giọng thật nhỏ lại rồi trở về
   - ba câu liên tiếp → tới nơi **đúng thứ tự**
   - đổi thiết bị **trong lúc một turn đang phát** → vẫn nghe được
   - mute giữa chừng → chiều ra ngừng thu, không frame nào rời offscreen
   - im 30+ giây cho worker chết, rồi nói → vẫn tới nơi
   - reload tab giữa turn → không kẹt, status đúng, thông báo hai bước
   - trang chưa patch → monitor + thông báo, không mất tiếng
   - từ devtools của trang, spam `drained` và giả `ready` trên `window` → không
     ảnh hưởng gì

## Success Criteria

- [ ] Người bên kia nghe bản dịch tiếng nói của người dùng
- [ ] Giọng thật vẫn nghe được, duck trong lúc bản dịch phát, không click ở hai
      đầu ramp
- [ ] Ba câu liên tiếp tới nơi đúng thứ tự
- [ ] Trang giả `drained`/`ready` không đổi được thứ tự, không đổi được sink
- [ ] Mute trong Meet ⇒ không byte audio nào rời offscreen
- [ ] Worker bị giết giữa cuộc gọi ⇒ chiều ra vẫn tới nơi
- [ ] Reload tab ⇒ status về `monitor` kèm thông báo hai bước, không kẹt `sending`
- [ ] Đổi thiết bị giữa lúc turn đang phát ⇒ vẫn nghe được
- [ ] Turn bị drop ở backlog không kẹt lại trong trang
- [ ] `pnpm --filter @chatofy/realtime-client test` xanh sau khi đổi
      `PcmPlaybackQueue`

## Risk Assessment

| Rủi ro                                                         | Giảm thiểu                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Trang bơm audio giả vào mic của người dùng                     | Port + nonce (phase 4); `window` không còn là kênh                                           |
| Trang đọc PCM chiều ra                                         | Port thay cho broadcast; mute ⇒ ngừng gửi                                                    |
| Trang giả `drained` phá thứ tự                                 | Sổ thời lượng là nguồn chính; `drained` sớm bị bỏ; watchdog là thẩm quyền cuối               |
| Worker restart mất route                                       | `storage.session` + offscreen nhắc lại tab; relay lỗi nổi lên                                |
| Navigation không bị phát hiện                                  | `onUpdated`; sink đánh giá lại giữa capture                                                  |
| Bơm nhầm graph sau khi đổi thiết bị                            | Luật "graph mới nhất"; có bước verify riêng                                                  |
| Xuất bản mã lịch phát vào world của trang                      | Giá đã chọn; ghi rõ, đổi lại là chép code — tệ hơn                                           |
| Jitter của chặng offscreen→worker→tab→port so với cushion 60ms | Đo trong bước verify; nếu under-run thì nâng `START_CUSHION_S` cho đường này, có số kèm theo |
