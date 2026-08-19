---
title: 'Phase 1: Tách continuous, fullDuplex và đếm vọng âm'
status: done
phase: 1
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Tách continuous, fullDuplex và đếm vọng âm

## Overview

Ba quan tâm đang dính vào nhau trong một biến state. Gỡ chúng ra, và chuyển rào
production từ `NODE_ENV` sang cờ do phép đo cấp phép.

## Vấn đề (đã xác minh trong code)

`packages/realtime-client/src/audio/capture-pump.ts`:

- Dòng 208, `closeTurn()`: `this.state = this.continuous ? 'idle' : 'awaiting-result'`
- Dòng 229–239, `push()`: **cả** `echoGate.push(...)` **và** nhánh mute
  (`if (!this.fullDuplex) { gate.reset(); return; }`) đều nằm trong
  `if (this.state === 'awaiting-result')`

Hệ quả, cả hai đều là lỗi thật chứ không phải suy đoán:

1. Ở chế độ continuous, state **không bao giờ** là `'awaiting-result'` ⇒ nhánh mute
   không tới được ⇒ `continuous: true` một mình đã bật nghe-xuyên-playback, **đi
   vòng qua** `FULL_DUPLEX_ALLOWED` ở `apps/web/src/hooks/use-streaming-translate.ts:23`.
2. `echoGate` cũng không tới được ⇒ quy trình đo §10.1 ("đếm
   `SpeechGate.onSpeechStart` lúc loa đang phát") **không chạy được** ở chế độ
   continuous. Đây đúng là lý do extension phải viết `echo-monitor.ts` riêng.

## Requirements

- Functional: `continuous` chỉ quyết định turn cycling; `fullDuplex` là công tắc duy
  nhất quyết định có honor mic khi audio của ta đang phát; đếm vọng âm chạy ở **mọi**
  chế độ.
- Non-functional: đường single-turn của web giữ **nguyên hành vi hôm nay**, kể cả
  thứ tự sự kiện. Đây là đường đã sinh ra bộ số 2026-08-07.

## Architecture

### Tín hiệu "audio của ta đang kêu" — KHÔNG dùng `onPlaybackBusy`

Đây là cái bẫy đã được xác minh, và nó là ship-stopper nếu làm sai.
`OrderedPlayback.reportPlaying()` (dòng 464–468) báo `onPlayingChanged` bằng
**`isBusy`**, mà `isBusy = queue.isPlaying || turns.size > 0` (dòng 263–265) — và một
turn vào map từ lúc `open()`, tức **lúc người ta bắt đầu nói**, không phải lúc loa
kêu. Nuôi tín hiệu đó vào điều kiện mute thì với `maxInFlight: 3` mic web bị bỏ qua
gần như vĩnh viễn, và nó sẽ **pass mọi test trong phòng yên tĩnh**.

Extension đã tự đi tới kết luận này và ghi lại: đọc
`apps/extension/src/sounding-sink.ts:6-22` trước khi viết dòng nào. Ducking thì cố ý
vẫn dùng `isBusy` (xem `duck-controller.ts`) — hai câu hỏi khác nhau, đừng gộp.

**Dùng predicate, không dùng setter.** Thêm vào `CapturePumpOptions`:

```ts
/** Có sample nào đang kêu ngay lúc này không. KHÔNG phải `isBusy`. */
sounding?: () => boolean;
```

Truyền `sounding: () => playback.isPlaying` tại chỗ dựng pump
(`conversation-session.ts:323`) — `playback` đã nằm trong scope từ dòng 279–282, nên
không có chuyện "pump dựng sau ordered, phải đọc qua `this.live?.pump`". `isPlaying`
là thành viên của interface `PlaybackSink` (`ordered-playback.ts:15`) nên sink riêng
của extension cũng dùng được. Không thêm field mutable, không edge detection, và
được đánh giá đúng khoảnh khắc block được phân loại thay vì tại một transition trước
đó.

### Ba luật tách hẳn nhau

| Việc             | Điều kiện                                                      | Ghi chú                          |
| ---------------- | -------------------------------------------------------------- | -------------------------------- |
| Đếm vọng âm      | `sounding()`                                                   | luôn chạy, mọi chế độ            |
| Bỏ qua block mic | `!fullDuplex && (state === 'awaiting-result' \|\| sounding())` | giữ nguyên hành vi single-turn   |
| Turn cycling     | `continuous`                                                   | không còn dính tới hai dòng trên |

**Điều kiện mute cố ý giữ cả `awaiting-result`.** Ở đường single-turn, cửa sổ giữa
"dứt lời" và "audio đầu tiên" (~900 ms) hiện **đang** bị mute; nếu chỉ đổi sang
`sounding()` thì cửa sổ đó mở mic ra và đuôi câu hoặc tiếng phòng có thể mở một lượt
rác. Ở chế độ continuous vế `awaiting-result` là trơ (state không bao giờ vào đó),
nên nó không tái lập coupling — ở single-turn nó là tập cha của "đang kêu", nên đường
cũ y hệt.

### Ba hệ quả phải xử cùng lúc

- **`isMuted` (dòng 219) vẫn key theo state**, nên ở continuous nó sẽ báo `false`
  trong khi mic đang bị bỏ qua — chỉ báo trên web sẽ nói dối. Cho nó dùng chung
  predicate.
- **Nhánh mute `return` trước `onLevel` (dòng 242)**, nên ở continuous thanh mức sẽ
  đứng im ở giá trị cuối thay vì về 0 (single-turn zero một lần ở dòng 214). Quyết
  định rõ: báo 0 khi đang bỏ qua.
- **Pre-roll không tích luỹ khi bị bỏ qua**, nên lượt bắt đầu ngay sau khi loa dứt
  mất ~320 ms đầu. Giống hôm nay, chỉ là xảy ra thường xuyên hơn. **Không** "sửa"
  bằng cách đổ pre-roll trong lúc loa kêu — làm thế là nhét đuôi vọng âm vào đầu lượt
  sau.

## Related Code Files

- Modify: `packages/realtime-client/src/audio/capture-pump.ts` — `sounding` option;
  tách ba điều kiện; `isMuted`; `onLevel`
- Modify: `packages/realtime-client/src/conversation/conversation-session.ts` —
  truyền `sounding: () => playback.isPlaying` tại chỗ dựng pump
- Modify: `packages/realtime-client/src/audio/capture-pump.spec.ts` — test mới
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — rào production
- Create: `apps/web/src/config/full-duplex-clearance.ts` — cờ do phép đo cấp phép
  (**đã xoá 19/08**: kiểm chứng trên MacBook cấp phép thẳng, `fullDuplex: true` đặt
  trong hook; xem journey §10 mục 1)

## Implementation Steps

1. Đọc `apps/extension/src/sounding-sink.ts` trước. Nó giải thích sẵn vì sao không
   dùng `isBusy`.
2. Thêm `sounding?: () => boolean` vào `CapturePumpOptions`, mặc định `() => false`
   (giữ hành vi cũ cho caller chưa truyền).
3. Trong `push()`, tách:
   - đếm vọng âm: `if (this.sounding()) this.echoGate.push(rms, blockMs)`
   - bỏ qua mic: `if (!this.fullDuplex && (this.state === 'awaiting-result' || this.sounding())) { this.handlers.onLevel(0); this.gate.reset(); return; }`
   - bỏ khối `if (this.state === 'awaiting-result')` cũ đang gộp cả hai.
4. Cho `isMuted` dùng chung predicate.
5. Nối `sounding: () => playback.isPlaying` trong `ConversationSession`.
6. **Rào production** — _đã làm, rồi đã bỏ 19/08._ Giữ nguyên đoạn dưới vì nó ghi
   lý do file phải đứng ngoài `env.ts`, thứ vẫn đúng nếu có ai dựng lại một cờ
   `NEXT_PUBLIC_*` cần bị fold khỏi bundle:
   `export const FULL_DUPLEX_CLEARED = process.env.NEXT_PUBLIC_FULL_DUPLEX_CLEARED === 'true';`
   **Không** đưa qua `apps/web/src/config/env.ts`: module đó zod-parse lúc runtime
   (`env.ts:16-19`), nên `if (env.X)` **không** bị dead-code-eliminate và tiêu chí
   "bundle production không có đường bật" sẽ âm thầm sai. Mặc định false; comment ghi
   rõ chỉ được bật sau khi Phase 3 đạt 0/20, kèm điều kiện đo.
7. **Chốt quan hệ `continuous` ↔ `maxInFlight`.** `singleTurn = maxInFlight <= 1`
   (`conversation-session.ts:248`) hiện độc lập với `continuous`; tổ hợp
   `continuous: false` + `maxInFlight > 1` để pump kẹt ở `awaiting-result` mà
   `armIfTurnComplete` bị gate bởi `singleTurn` (dòng 291, 311) ⇒ **mic chết im
   lặng**. Suy một cái từ cái kia, hoặc assert chúng đồng thuận, kèm test.
8. Cập nhật comment đã thành sai: `capture-pump.ts:59-69` (đang nói vọng âm "reported
   in BOTH modes" — hôm nay đã sai), `:92-97`, và `conversation-session.ts:468-477`
   (cả tiền đề "ở continuous echo gate của pump không tới được" bị phase này xoá).

## Success Criteria

- [x] Test: `continuous: true, fullDuplex: false` + `sounding() === true` → block mic
      bị bỏ qua (hôm nay: **được** honor — test này phải đỏ trên code cũ)
- [x] Test: `continuous: true` + `sounding() === true` + block đủ to → `onEchoHeard`
      bắn (hôm nay: không bao giờ bắn)
- [x] Test: `continuous: true, fullDuplex: true` + sounding → block **được** honor
- [x] Test: mic **không** bị bỏ qua khi chỉ có turn đang mở mà chưa có sample nào kêu
      (chốt rằng tín hiệu là `isPlaying` chứ không phải `isBusy`)
- [x] Test: `continuous: false` + `maxInFlight: 3` bị chặn hoặc tự đồng thuận
- [x] Test đường single-turn hiện có: pass không sửa một dòng nào
- [x] `pnpm --filter @chatofy/realtime-client test` + `typecheck` + `lint` xanh
- [x] **KHÔNG CÒN ÁP DỤNG (19/08)** — tiêu chí này hỏi bundle production có còn
      đường bật full-duplex khi cờ chưa cấp hay không. Cờ đã bỏ và full duplex bật
      cứng trên web, nên không còn nhánh nào để loại. Ghi lại nguyên văn bên dưới vì
      nó là bằng chứng đã chạm tới giới hạn của hook, không phải việc bỏ dở.
      Nguyên văn: Bundle production web không có đường bật full-duplex khi
      cờ chưa được cấp. Hook `scout-block` của repo chặn đọc `.next`, và tôi không
      đi vòng qua hook. Tính **an toàn** thì không phụ thuộc điều này: hằng số tính
      lúc import nên runtime luôn `false`. Chỉ tuyên bố mạnh hơn ("không còn đường
      nào trong bundle") là chưa chứng minh — và nó chỉ đúng khi biến **có giá
      trị**, vì Next dựng bảng thay thế từ các khoá `NEXT_PUBLIC_*` thực sự có mặt
      lúc build. Đã đặt `NEXT_PUBLIC_FULL_DUPLEX_CLEARED=false` tường minh vào
      `.env.example`. Muốn chứng minh: thêm `!.next` vào `.claude/.ckignore` rồi
      grep, hoặc kiểm bằng hành vi trong lượt Playwright của Phase 2.

## Risk Assessment

**Rủi ro: nối nhầm `isBusy` thay vì `isPlaying`.** Hậu quả là mic web tắt gần như
vĩnh viễn ở `maxInFlight: 3`, và **pass mọi test trong phòng yên tĩnh**. Giảm thiểu:
test riêng ở mục Success Criteria trên (turn mở nhưng chưa kêu → không mute). Tín
hiệu hỏng ngoài đời: `isMuted` true kéo dài trong khi loa im.

**Rủi ro: đổi điều kiện mute làm hồi quy đường single-turn** (đường đã sinh bộ số
2026-08-07). Giảm thiểu: giữ vế `awaiting-result`, và bộ test single-turn hiện có
phải pass **không sửa**. Tín hiệu hỏng: bất kỳ test nào trong `capture-pump.spec.ts`
/ `conversation-session.spec.ts` phải sửa mới xanh. Phản ứng đã định trước: dừng,
không "sửa test cho hợp" — đó đúng là cách hai defect trước đã lọt ra `main` với mọi
cổng xanh.
