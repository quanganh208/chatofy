---
phase: 5
title: 'Client turn pipeline and ordered playback'
status: pending
priority: P1
effort: '2d'
dependencies: [2, 3, 4]
---

# Phase 5: Client turn pipeline and ordered playback

## Overview

`ConversationSession` giữ đúng một lượt. Phase này thay bằng nhiều lượt song
song, bảo đảm bản dịch **phát đúng thứ tự người nói**, và cho extension một
reducer transcript khoá theo lượt.

Đây là phase rủi ro cao nhất của cả plan.

## Requirements

- Functional: nhiều lượt cùng bay; thứ tự phát = thứ tự nói; không lượt nào bị bỏ
  **dưới trần hàng đợi**, và mọi lần bỏ vì tràn trần đều được log.
- Non-functional: chế độ một-lượt (`apps/web`) giữ nguyên hành vi, cùng một lớp.

## Architecture

### Vì sao thứ tự có thể sai

Lượt A dài 8s, lượt B ngắn 2s bắt đầu sau. B qua pipeline nhanh hơn, frame audio
của B về trước. `PcmPlaybackQueue.enqueue()` xếp theo thứ tự **đến**
(`pcm-playback-queue.ts:40-65`), nên B phát trước A.

### Bốn thứ state, không phải hai

`ConversationSession` giữ **bốn** thứ thuộc về một lượt, và cả bốn phải thành
per-turn:

| Field       | Vị trí | Vì sao bắt buộc                                                                                       |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `sessionId` | `:82`  | định tuyến frame                                                                                      |
| `sequence`  | `:83`  | server trả `frame_rejected` nếu sequence không tăng **trong lượt của nó** (`turn-session.ts:112-118`) |
| `pending`   | `:85`  | audio giữ trong lúc bắt tay                                                                           |
| `turnEnded` | `:87`  | điều kiện re-arm                                                                                      |

`onTurnOpen` hiện đặt `this.sequence = 0; this.sessionId = null` (`:155-158`). Ở
điểm cắt của phase 4, `flushHeld()` đẩy phần đuôi của lượt N ra **sau khi** lượt
N+1 đã reset hai field đó — nên phần đuôi của N đi kèm `sessionId` của N+1 và
sequence bắt đầu lại từ 0. Server hoặc nối audio của N vào buffer N+1 (hỏng câu,
không báo lỗi), hoặc trả `frame_rejected`. Comment ở `:289-293` đã ghi đúng cơ
chế này cho một trường hợp khác.

### Thiết kế

```
TurnPipeline        — lượt nào đang bay, lượt nào đến trước
  ├─ turnId, sessionId, sequence, pending, trạng thái, thứ tự mở
  ├─ maxInFlight, hàng chờ khi vượt trần
  └─ trần backlog + chính sách bỏ, có log

OrderedPlayback     — bọc PcmPlaybackQueue
  ├─ giữ frame của lượt chưa tới lượt phát
  └─ chỉ đẩy xuống queue khi mọi lượt trước đã kết thúc VÀ phát xong
```

`PcmPlaybackQueue` cần **một** thay đổi nhỏ: nhận token lượt cùng mỗi chunk và
báo drain theo lượt. Không có nó thì `isPlaying` và `onDrained` là tín hiệu cấp
hàng đợi, không phân biệt được "lượt A xong" với "lượt A đói giữa chừng" — và đói
giữa chừng sẽ xảy ra thật, vì khẳng định "audio của một mệnh đề luôn dài hơn thời
gian tổng hợp mệnh đề sau" (`pcm-playback-queue.ts:9-12`) được đo khi **chỉ có
một lượt**, đúng thứ phase 3 đang bỏ. Nếu drain giữa chừng bị hiểu là "A xong",
lớp sắp thứ tự thả B ra rồi mệnh đề 2 của A về sau — đúng lỗi phase này tồn tại
để chặn, và replay fixture đảo thời gian hoàn thành **không** sinh ra được nó.

### Quy tắc phát

1. Lượt được cấp số thứ tự lúc `onTurnOpen`, tăng dần, khoá theo `turnId`.
2. Frame về sớm hơn lượt của nó → giữ trong bộ đệm theo lượt.
3. Lượt K phát được khi mọi lượt < K đã **kết thúc** và đã phát xong.
4. Lượt kết thúc mà không có audio phải **giải phóng** lượt sau. Ba đường:
   `server.session.ended` không kèm audio, `server.error` cấp lượt, và
   `too_many_turns` — lượt bị từ chối **không bao giờ có `sessionId`**, nên nó chỉ
   nhận diện được bằng `turnId` (phase 2). Thiếu đường thứ ba thì hàng đợi kẹt
   vĩnh viễn.
5. Watchdog: lượt ở đầu hàng đợi quá `TURN_STALL_TIMEOUT_MS` mà không có tín hiệu
   kết thúc nào thì bị giải phóng cưỡng bức và ghi log. Không có nó, một tín hiệu
   bị mất là im lặng vĩnh viễn.

### Trần backlog

Yêu cầu "không mất câu" là **có trần**, không tuyệt đối. Phát nối tiếp trong khi
thu liên tục nghĩa là mức sử dụng đã ~100% trước mọi chi phí phụ; một lượt chạm
đuôi p95 (repo đo: p95 1947ms, tệ nhất 8943ms) đẩy toàn bộ lượt sau lùi theo và
không bao giờ bù lại. Nên: trần theo số giây audio đang chờ và số lượt đang giữ;
vượt trần thì bỏ lượt **cũ nhất chưa phát** và ghi log. Repo có nguyên tắc không
cắt ngầm — mọi lần bỏ phải đếm được và phải vào metrics phase 6.

<!-- Updated: Validation Session 1 - drop-oldest confirmed as a user decision -->

**Bỏ-lượt-cũ-nhất là quyết định của người dùng, không phải mặc định kỹ thuật.**
Lý do đã chốt: ưu tiên bám thời gian thực — trong cuộc họp, nội dung của ba giây
trước đã hết giá trị, nên nghe phần mới nhất đáng hơn nghe đủ. Hai phương án kia
(bỏ lượt mới nhất; phát nhanh 1,15x) đã được trình bày và bị loại. Không tự đảo ở
các vòng review sau.

`ConversationSession.pending` cũng chưa có trần (`:265-271`): server không bao giờ
trả `ready` thì nó phình mãi. Cùng một trần.

### Transcript khoá theo lượt

`conversation-state.ts` giữ một `liveText` cho cả hội thoại và xoá nó ở
`transcript.final`/`session.ended` bất kể lượt nào (`:62-84`). Ba luồng partial
song song sẽ ghi đè lên nhau và một lượt kết thúc xoá dòng live của lượt khác
đang mở. Phase này tạo reducer khoá theo `sessionId` trong package; bản một-dòng
ở `apps/web` không đụng tới.

`armIfTurnComplete()` biến mất khi `maxInFlight > 1`; `maxInFlight: 1` giữ đường
cũ nguyên vẹn, gồm cả `onMuted(false)`.

## Related Code Files

- Create: `packages/realtime-client/src/conversation/turn-pipeline.ts`
- Create: `packages/realtime-client/src/audio/ordered-playback.ts`
- Create: `packages/realtime-client/src/state/turn-keyed-transcript.ts`
- Modify: `packages/realtime-client/src/conversation/conversation-session.ts`
- Modify: `packages/realtime-client/src/audio/pcm-playback-queue.ts` — token lượt + drain theo lượt
- Modify: `packages/realtime-client/src/conversation/fake-audio-context.ts`
- Unchanged: `apps/web/src/state/conversation-state.ts`
- Test: `turn-pipeline.spec.ts`, `ordered-playback.spec.ts`, `turn-keyed-transcript.spec.ts`, `conversation-session.spec.ts`, replay test mới

## Implementation Steps

1. `PcmPlaybackQueue` nhận token lượt, báo drain theo lượt. Nhỏ, làm trước.
2. `OrderedPlayback` — thuần logic, test với `fake-audio-context.ts`.
3. `TurnPipeline`: bốn field per-turn, `maxInFlight`, hàng chờ, trần backlog,
   watchdog.
4. `turn-keyed-transcript.ts`.
5. `ConversationSession` dùng cả bốn; `maxInFlight: 1` mặc định.
6. Test bắt buộc:
   - **thứ tự đảo**: lượt B (mở sau) trả audio trước A → phát A trước B
   - **đói giữa chừng**: mệnh đề 2 của A về sau khoảng trống dài hơn mệnh đề 1 →
     B vẫn không được phát trước
   - lượt A lỗi → B được giải phóng
   - lượt A `no_audio` → như trên
   - **`too_many_turns` chỉ có `turnId`** → lượt đó được giải phóng khỏi hàng đợi
   - watchdog giải phóng lượt kẹt và ghi log
   - `too_many_turns` → audio giữ lại rồi gửi; **vượt trần backlog → bỏ lượt cũ
     nhất và ghi log**
   - điểm cắt phase 4: đuôi lượt N đi với `sessionId` của N và sequence tăng dần;
     frame đầu của N+1 là sequence 0
   - `maxInFlight: 1` → chuỗi sự kiện giống hệt hôm nay
   - server không bao giờ trả `ready` → `pending` không phình quá trần
   - socket đóng → mọi lượt dọn sạch
   - reducer khoá lượt: `final` của lượt A không xoá dòng live của lượt B
7. **Replay test** nhiều lượt, thời gian hoàn thành đảo ngược, theo khuôn
   `capture-pump.replay.spec.ts`.

## Success Criteria

- [ ] Test thứ tự đảo pass **và fail được** khi gỡ lớp sắp thứ tự
- [ ] Test đói giữa chừng pass và cũng fail được khi gỡ token lượt
- [ ] Cả ba đường kết thúc không-audio đều giải phóng hàng đợi; watchdog có test
- [ ] Bỏ vì tràn trần được đếm và log, không im lặng
- [ ] `maxInFlight: 1` cho chuỗi sự kiện không đổi
- [ ] Replay test nhiều lượt pass
- [ ] `apps/web` chạy dev, dịch vài lượt bằng tay, không đổi cảm nhận

## Risk Assessment

- **Đúng lớp lỗi đã hai lần thoát ra `main`** (mục 6.3, và trước đó cờ half-duplex
  đặt sai đầu/cuối). Cả hai lần mọi cổng đều xanh vì test dựng chuỗi production
  không tạo ra nổi. Đối sách: mỗi test mới phải trả lời được "production tạo ra
  chuỗi này bằng cách nào", và hai test thứ tự phải chứng minh được là fail khi gỡ
  lớp tương ứng.
- **Lượt kẹt là lỗi treo, không phải lỗi sai** — khó thấy hơn. Watchdog + log.
- **Ducking kẹt.** Nếu `OrderedPlayback` bận vĩnh viễn (backlog nở), tiếng gốc bị
  duck mãi. Phase 7 phải nối duck vào trạng thái backlog, không chỉ `isPlaying`.
- **Số đo trôi phụ thuộc phase này**, nên sai ở đây làm hỏng cả số liệu luận văn.
- **Rollback:** đảo được sau phase 4; `maxInFlight: 1` là đường lui tại chỗ.
