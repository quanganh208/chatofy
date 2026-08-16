---
phase: 5b
title: 'Micro liên tục trong lúc bản dịch đang phát'
status: in_progress
priority: P1
effort: '1d'
dependencies: [5]
---

# Phase 5b: Micro liên tục trong lúc bản dịch đang phát

## Overview

Cascade còn một chỗ không mượt bằng Live: **khi bản dịch đang phát thì micro
không thu**. Live thu liên tục, phát liên tục, không có khoảng dừng nào.

Nguyên nhân không phải một dòng viết sai. Cổng micro
(`meeting-capture.ts:230-251`) **giống hệt `main`** — kiểm bằng
`git diff main...HEAD -- apps/extension/src/meeting-capture.ts`, nhánh này chỉ
thêm cờ `streaming`. Cái đổi là **thời điểm phát**, và tiền đề mà cổng đang đứng
lên đã hết đúng.

Tiền đề đó được ghi thẳng trong chính comment ở `:237-250`, viết cho việc miễn
trừ Live: _"cổng echo giả định playback có khoảng hở để mở lại. Backend liên tục
không có khoảng hở nào — nó trễ sau người nói vài giây và nói xen vào các quãng
nghỉ — nên áp nó ở đó không làm micro im giữa các câu, mà giữ micro ở 0 từ mẫu
dịch đầu tiên tới hết cuộc họp. Đo được: người dùng nói được một câu, sau đó
không câu nào được nghe nữa."_

**Câu đó bây giờ mô tả cascade streaming.** Phase này đi hỏi lại đúng câu hỏi mà
comment ấy nói là câu hỏi thật: _playback còn khoảng hở không_ — và thay thứ bảo
vệ bị mất bằng một cơ chế khác, chứ không bỏ trống.

## Cơ chế hỏng

Cổng đặt ở **nguồn**, trước `CapturePump`/`SpeechGate` (`outbound-mic.ts:20-24`),
và kéo về **gain 0** chứ không phải duck (`outbound-mic.ts:28`, ghim đúng 0 ở
`duck-controller.ts:113-116`). Nên khoảng bị chặn không phải "nhỏ tiếng" — nó
**không tồn tại** với bộ dò lượt.

Hai lỗ, khác nhau:

**Vế inbound** (`sounding.inbound`). Commit theo vế làm `SoundingSink` bật gần
như liên tục suốt đoạn người kia nói, nên micro của người dùng bị giữ gần 0 gần
hết đoạn đó.

**Vế outbound monitor** (`sounding.outbound && !this.sending`, tức trang không
mang patch micro). Đây là dao động **tự bóp cổ**, và nó là hồi quy hành vi của
nhánh này: vế của lượt N phát trong lúc lượt N **vẫn đang được thu** (trần 45s) →
micro về 0 → endpointer thấy im lặng → **đóng lượt sớm** → vế của lượt cụt đó lại
phát → lại gate. Trước nhánh này, outbound chỉ phát sau khi lượt đóng (≤8s), nên
cái giá chỉ là mất phần đầu của lượt kế — có biên. Bây giờ thì không.

## Vì sao không thể chỉ dựa vào AEC sẵn có

`openGatedMicrophone` đã mở với `echoCancellation: true` — và **nó không phủ
được thứ này**. Tham chiếu AEC mặc định của Chrome chỉ lấy từ luồng
peer-connection, **không** lấy audio phát qua Web Audio, nên bản dịch mà offscreen
document phát là vô hình với AEC của micro outbound (đúng như
`echo-monitor.ts:16-21` đã mô tả cho phía Meet). Cổng cứng hiện tại **không hề
thừa** — nó là thứ duy nhất đang chặn vòng lặp tự dịch.

Cái đã đổi so với lúc viết `echo-monitor.ts` (_"None of that is fixable from an
extension"_) là Chrome 141 ship `echoCancellationMode`, nhận `'all'`: bỏ **toàn
bộ** system playout khỏi tín hiệu micro. Câu đó giờ chỉ còn đúng cho đường bậc
hai (loa của người khác), không còn đúng cho vòng lặp cục bộ.

`'all'` trên Chrome/Linux **chưa xác minh**. Đó là lý do bước đo dưới đây quyết
định _chữ trong popup_ và _độ an toàn khi dùng loa ngoài_ — **không** quyết định
việc có mở cổng hay không.

## Requirements

- Functional: trong một lượt streaming, micro **không** bị đưa về 0 vì có bản
  dịch đang phát.
- **Luật riêng tư giữ nguyên văn:** vế `muted` (`sending && !transmitting`) sống
  sót không sứt mẻ. Người dùng mute thì không bao giờ bị capture, bất kể backend.
- Non-functional: không đổi hành vi `apps/web`; không đụng đường Live; không đụng
  `SpeechGate` trong `realtime-client` (dùng chung với web).

## Architecture

**Miễn trừ khoá vào chính `CASCADE_STREAMING`,** không phải vào một cờ mới.
`direction-session.ts:66-67` tuyên bố tắt hằng đó là rollback cho cả tính năng;
khoá miễn trừ vào thứ khác làm câu tuyên bố ấy thành sai.

```
audible && !this.live && !CASCADE_STREAMING   ||  muted
```

**Thay thứ bảo vệ vừa mất** bằng `echoCancellationMode: 'all'` trên micro
outbound. Chrome cũ bỏ qua dict member lạ nên không gãy; ghi lại giá trị thật
đọc từ `track.getSettings()` để report không phải đoán.

**`EchoMonitor` giữ nguyên AEC boolean thường.** Nó là proxy cho "một meeting
client nghe thấy gì"; chuyển nó sang `'all'` là làm phép đo đo đúng con số không.

**Phương án đã cân và loại:**

- _Duck thay vì zero / nâng sàn `SpeechGate`_ — mâu thuẫn hai bất biến đã ghi tại
  chỗ (`outbound-mic.ts:27` "anything above zero can still confirm as speech", và
  cú ghim đúng 0), **và** `SpeechGate` nằm trong `realtime-client` dùng chung với
  web, vi phạm ràng buộc "web không đổi một byte".
- _Chỉ gate khi chưa có lượt outbound nào mở_ — bế tắc con gà quả trứng: lượt
  không bao giờ mở được vì micro bị gate đang nuôi chính cái speech gate lẽ ra
  phải mở nó.
- _Lọc theo text (bỏ lượt trùng bản dịch vừa phát)_ — tốn quota rồi mới lọc, và
  false positive thì **âm thầm nuốt tiếng thật của người dùng**, hạng lỗi tệ nhất
  cho một cái máy phiên dịch. Giữ làm lớp phụ, chỉ dựng nếu đo ra echo tồn dư xấu
  và người dùng từ chối đeo tai nghe.

## Related Code Files

- Modify: `apps/extension/src/meeting-capture.ts` — điều kiện cổng ở
  `applyMicrophoneGate()`; viết lại comment `:237-250` (câu chuyện "đo được" của
  nó giờ **lập luận cho** miễn trừ, không phải chống lại)
- Modify: `apps/extension/src/outbound-mic.ts` — `echoCancellation: 'all'`, log
  giá trị thật từ `track.getSettings()`
- Modify: `apps/extension/src/echo-monitor.ts` — câu "None of that is fixable
  from an extension" giờ chỉ còn đúng cho đường bậc hai
- Create: `apps/extension/src/microphone-gate.ts` + spec — quyết định cổng dưới
  dạng hàm thuần, để ca rollback chạm tới được
- Create: `apps/extension/src/meeting-capture-rollback.spec.ts` — `vi.mock` hằng
  về `false`; phải là file riêng vì `vi.mock` theo từng file
- Modify: `apps/extension/src/meeting-capture.spec.ts` — ba ca dưới
- Modify: `apps/extension/entrypoints/popup/main.ts:117-118` — chữ cho cascade
  (**phải đổi dù đo ra gì**: câu hiện tại "Waits for a sentence to finish before
  answering" đã sai từ lúc nhánh này bật streaming)
- Create: `plans/reports/measure-260816-1620-cascade-microphone-echo.md` —
  runbook + số đo

## Implementation Steps

1. Đổi điều kiện cổng, khoá vào `CASCADE_STREAMING`. Viết lại comment tại chỗ.
2. Spec, ba ca: cascade streaming + inbound đang phát → micro **không** bị chặn;
   `sending && !transmitting` → **vẫn** bị chặn; `CASCADE_STREAMING = false` →
   khôi phục đúng cổng cũ.
3. Thêm `echoCancellationMode: 'all'`; log giá trị áp dụng thật.
4. Chạy runbook đo (mẫu: `plans/reports/measure-260730-continuous-capture-runbook.md`):
   fixture `fake-meeting-audio.ts` làm cuộc họp, phòng yên, ghi rõ máy/loa/mức âm
   lượng. Ba lần chạy: **loa + AEC mặc định**, **loa + `'all'`**, **tai nghe**
   (đối chứng, kỳ vọng ≈0). Số báo cáo là `echoEvents / phút playback`
   (`meeting-capture.ts:210` đã đưa ra sẵn). Ghi rõ `'all'` có được Linux nhận
   hay không.
5. Chốt chữ popup theo số đo. Nếu loa vẫn còn echo mở được lượt, cascade thừa
   hưởng đúng câu tai nghe của Live.
6. Nghe thật: nói chồng lên lúc bản dịch inbound đang phát, xác nhận lượt vẫn mở.

## Trạng thái (2026-08-16)

**Code xong.** Quyết định cổng tách thành module thuần `microphone-gate.ts` —
không phải để cho đẹp, mà vì `CASCADE_STREAMING` là hằng biên dịch nên tiêu chí
"chứng minh được rollback khôi phục cổng cũ" **không cách nào chạm tới** qua
`MeetingCapture`. Hỏi thẳng hàm thuần thì chạm được.

`meeting-capture.ts` truyền `continuousPlayback: this.live || CASCADE_STREAMING`;
`muted` chặn trước trong hàm thuần nên luật riêng tư không phụ thuộc thứ tự đọc.
`outbound-mic.ts` xin `echoCancellation: 'all'` và **log giá trị được cấp** đọc
ngược từ `track.getSettings()`. Chữ popup cho cascade đổi sang câu tai nghe
**trước khi đo** — có chủ ý: phép đo chỉ có thể nới câu đó ra, không thể làm nó
cần thiết hơn.

**Bản nháp đầu của phần AEC là một no-op, review bắt được.** Nó viết
`echoCancellationMode: 'all'` như một member riêng. Không có member nào tên đó —
`"all"` là **giá trị của chính `echoCancellation`**, thứ Chrome 141 nới từ
`ConstrainBoolean` lên `ConstrainBooleanOrDOMString`; `EchoCancellationModeEnum`
chỉ là tên của enum. WebIDL bỏ member lạ trong im lặng, nên: cổng echo đã gỡ mà
**không có gì thay thế**, và dòng log dựng ra để đo chuyện đó sẽ báo "không hỗ
trợ" trên **mọi** máy kể cả máy chạy được — một phép đo nói dối, tệ hơn không đo.
Nguyên nhân cho phép nó lọt: cast `as MediaTrackConstraints` trùm cả object, tắt
excess-property checking cho mọi trường. Giờ cast đúng **một giá trị**, phần còn
lại vẫn được compiler kiểm.

Đã xác minh lại bằng W3C mediacapture-main và MDN trước khi sửa, không chỉ dựa
vào lời review.

**Rollback được chứng minh thật, không chỉ ở tầng hàm thuần.**
`meeting-capture-rollback.spec.ts` `vi.mock` hằng đó về `false` trong một file
riêng (vì `vi.mock` theo từng file) rồi khẳng định cổng cũ quay lại nguyên vẹn,
gồm cả vế `sounding.outbound && !sending`. Bài test đầu tiên tôi viết cho việc
này **vô dụng** và mutation check đã bắt được: trong khi `CASCADE_STREAMING` còn
là `true` thì mọi khẳng định — kể cả so với chính hằng đó — đều đồng ý với một
bản hardcode `continuousPlayback: true`.

**Đã kiểm bằng mutation, không chỉ bằng "test xanh":** đổi
`continuousPlayback` thành `true` → 2 test đỏ; bỏ `&& !this.sending` khỏi
`audible` → 1 test đỏ.

`pnpm --filter extension test` 166/166, `tsc --noEmit` sạch, `lint` sạch. Không
đụng `packages/` nên `apps/web` không thể đổi.

**Chưa làm được, cần bạn:** bước 4 (đo trên loa thật, runbook đã dựng sẵn) và
bước 6 (nghe thật).

## Success Criteria

- [x] Trong lượt streaming, không có khoảng nào micro ở gain 0 ngoài lúc `muted`
- [x] Ba spec ở bước 2 xanh, gồm cả ca rollback `CASCADE_STREAMING = false`
      (ở tầng hàm thuần — xem giới hạn ghi tại §Trạng thái)
- [ ] `echoEvents/phút` ghi lại cho cả ba cấu hình, tái lập được bằng runbook đã
      commit; ghi rõ micro có được cấp quyền không (số 0 vì bị từ chối khác hẳn
      số 0 thật — `echo-monitor.ts:90-95`)
- [ ] Không lượt outbound nào trong kịch bản runbook mang text của bản dịch
      inbound (đếm được, không khẳng định suông)
- [ ] Chữ popup cho cascade khớp với kết quả đo
- [ ] `pnpm --filter extension test` xanh; `apps/web` không đổi hành vi

## Risk Assessment

- **`'all'` không được Chrome/Linux hỗ trợ.** Giả định chịu lực duy nhất, **độ
  tin cậy thấp**. **Tín hiệu:** `track.getSettings()` không trả về mode đã xin,
  hoặc `echoEvents` trên loa không khác gì AEC mặc định. **Phản ứng đã định:**
  cascade thừa hưởng câu tai nghe của Live — khuyến nghị không đổi, chỉ chữ đổi.
- **Ca mới lộ ra do chính việc mở cổng: endpointer nghe tiếng loa như tiếng
  người.** Trên loa ngoài, nếu `'all'` báo nhận mà không thật sự cắt, micro giờ
  **mở** nên tiếng vế đang phát chảy thẳng vào bộ dò lượt. Không còn là chuyện
  micro chết nữa; nó thành lượt bị ép cắt ở trần 45s và **text bản dịch tự chèn
  vào giữa lượt của chính người dùng**. **Tín hiệu:** lượt outbound dài chạm trần
  đều đặn, và transcript lẫn chữ của bản dịch.
- **Tín hiệu phân biệt để quyết có lùi hay không:** chỉ lùi miễn trừ khi vòng lặp
  tự dịch xuất hiện **lúc đang đeo tai nghe**. Đeo tai nghe thì không có đường
  âm học, nên một vòng lặp ở đó nghĩa là lỗi nằm chỗ khác, không phải echo — và
  đóng cổng lại sẽ không chữa được gì, chỉ đổi lại lấy một cái micro chết.
- **Chế độ `sending` (trang có patch micro) hiếm hay phổ biến — chưa rõ.** Nếu
  phổ biến hơn dự kiến thì ca xấu nhất của việc mở cổng mà không có `'all'` (bản
  dịch bị dịch lại rồi **đi vào cuộc họp** như tiếng của người dùng) lộ ra nhiều
  hơn. Điều đó nâng độ ưu tiên của bước 3, không đổi lựa chọn.
- **Rollback:** `CASCADE_STREAMING = false` khôi phục cổng cũ cùng lúc với khôi
  phục cả tính năng — đúng một đòn bẩy, đúng như file kia đã hứa.

## Nhánh web: đo, chưa đổi

Web bị **cùng triệu chứng, khác cơ chế** — không phải cổng gain-0 mà là máy trạng
thái nửa song công: lượt đóng → `awaiting-result` (`capture-pump.ts:208`), block
micro ở trạng thái đó bị vứt (`:229-238`), chỉ mở lại sau khi playback cạn
(`conversation-session.ts:464-466`). Bản vá của extension **không** chảy sang, và
`capture-pump.ts:76-82` nói lý do: full duplex an toàn khi capture và playback
tách nhau về cấu trúc; extension có (tab + offscreen), web không có.

Nên hành động ở đây là **đo, không bật** — và cờ để đo vốn đã có sẵn, dev-only,
dựng đúng cho câu hỏi này (`use-streaming-translate.ts:15-34`), chưa ai kéo.

Đã làm để đo được: `echoCancellation: 'all'` cho cả hai hook của web (điều kiện
tiên quyết — đo full duplex trên AEC mặc định là đo cái mặc định); `?fullDuplex=1`
trên `/translate` bật cờ cho một lần chạy, URL chứ không phải nút bấm nên giao
diện không đổi và lệnh tái lập được; khi cờ bật thì panel hiện `echo heard`. Cả ba
bị `NODE_ENV === 'production'` chặn ở tầng hook.

Runbook: `plans/reports/measure-260816-1635-web-full-duplex-gate.md`.

**Chưa lật quyết định "chỉ extension".** Nếu số đo cho phép, ba tầng còn lại —
bỏ trần production, `continuous: true`, `streaming: true` + `maxInFlight > 1` —
là ba quyết định riêng và tầng cuối phải quay lại hỏi.

## Quan hệ với phase 6

**Không chặn** benchmark phase 6: phase 6 dùng bản ghi đẩy thẳng vào socket
server, không đi qua cổng micro của extension. Chạy song song, và làm thế còn đỡ
quota.

**Có chặn** việc gọi tính năng là đã xong, và chặn demo thật: tuyên bố đầu bảng
của plan là độ trễ tới tiếng nói đầu tiên phẳng, mà một cái micro chết trong lúc
đang phát thì phản chứng đúng vào kịch bản mà một buổi demo sẽ diễn.
