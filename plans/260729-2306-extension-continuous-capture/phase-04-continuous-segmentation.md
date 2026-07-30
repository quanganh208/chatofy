---
phase: 4
title: 'Continuous segmentation'
status: done
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 4: Continuous segmentation

## Overview

`SpeechGate` kết thúc lượt bằng 500ms im lặng. Trong cuộc họp thật, người ta nói
hàng chục giây không có khoảng im nào dài thế. Thêm trần độ dài utterance, và sửa
máy trạng thái của `CapturePump` để chế độ liên tục không đánh rơi audio giữa các
lượt.

## Requirements

- Functional: đoạn nói liên tục 60s cắt thành các lượt ~8s; không block nào bị bỏ
  và **không block nào xuất hiện trong hai lượt**.
- Non-functional: `apps/web` không đổi hành vi — trần mặc định tắt.

## Architecture

### Điểm cắt: nhìn tới, không nhìn lui

Bản trước định "cắt tại block RMS thấp nhất trong ~500ms cuối" rồi đưa phần sau
điểm cắt vào pre-roll của lượt N+1. **Không hiện thực được.** `CapturePump` đẩy
mỗi block speech đi ngay khi nhận (`capture-pump.ts:183-184`) và không giữ bản
sao; những block đó đã nằm trong buffer của lượt N phía server. Gán lại chúng chỉ
có hai kết cục, cả hai đều sai: gửi lại cho N+1 → cùng một câu được dịch hai lần;
không gửi → N+1 mất phần đầu. Tệ hơn, `SpeechGate.push(rms, durationMs)` không hề
nhìn thấy block, nên nó không có gì để chọn giữa.

Thay bằng **arm rồi cắt tới**:

```
t = maxUtteranceMs - CUT_LOOKAHEAD_MS   → arm: "sẵn sàng cắt"
   ├─ block đầu tiên có rms dưới ngưỡng  → cắt tại đây
   └─ không có block nào → cắt cứng tại maxUtteranceMs
```

Không cần giữ block, không thêm độ trễ, và điểm cắt vẫn rơi vào chỗ yên khi có
chỗ yên. `CUT_LOOKAHEAD_MS` khởi điểm 500.

### Arm cũng là lúc bắn `speculate()`

`socket.speculate()` chỉ được bắn từ `onProbableEnd`, vốn cần 150ms im lặng
(`speech-gate.ts:125-128` → `capture-pump.ts:120-128` →
`conversation-session.ts:162`). Cắt cưỡng bức xảy ra giữa lời nói nên
`onProbableEnd` không bao giờ bắn, và lượt bị cắt sẽ trả toàn bộ tiền cho đường
final: theo số của repo, first-audio đi từ ~870ms lên ~1760ms mỗi lượt. Lượt giữ
slot lâu hơn cũng đẩy hệ thống vào trần đồng thời của phase 3.

Nên: khi arm, bắn `onProbableEnd` một lần. Server đã có sẵn cơ chế đổi mới phỏng
đoán mỗi lần nhận, và `MAX_SPECULATIONS_PER_TURN = 4` chặn chi phí.

### Trạng thái: về `idle`, không về `awaiting-result`

`armNextTurn()` là **nơi duy nhất** ghi `state = 'idle'` (`capture-pump.ts:199-205`),
và phase 5 xoá caller duy nhất của nó. Không sửa gì thì: một lượt kết thúc bằng
hangover thường — chuyện xảy ra liên tục trong họp thật, giữa các câu — để pump ở
`awaiting-result` vĩnh viễn. Ở đó, với `fullDuplex` bật, block lọt qua nhánh mute
nhưng **không khớp nhánh `in-turn` lẫn `idle`** (`:174-191`), nên bị bỏ và
`preRoll` không tích được gì. Lượt sau mở với `onTurnOpen([])`, mất
`PRE_ROLL_MS (320) + MIN_SPEECH_MS (120) ≈ 440ms` phần đầu. `isMuted` cũng kẹt
`true` nên UI báo muted cả cuộc họp.

Sửa ở đây, không đẩy sang phase 5: `CapturePump` nhận cờ `continuous`; khi bật,
`onSpeechEnd` chuyển thẳng sang `idle` thay vì `awaiting-result`.

### `echoGate` không nhận trần

`CapturePump` dựng **hai** `SpeechGate` (`:108` và `:141`). `echoGate` chỉ đếm
vọng âm; cho nó `maxUtteranceMs` sẽ khiến `onEchoHeard` bắn theo đồng hồ thay vì
theo vọng âm, làm hỏng chính phép đo phase 8 cần.

## Related Code Files

- Modify: `packages/realtime-client/src/audio/speech-gate.ts`
- Modify: `packages/realtime-client/src/audio/capture-pump.ts`
- Create: `packages/realtime-client/src/audio/speech-gate.spec.ts` — **chưa từng có**
- Test: `capture-pump.spec.ts`, `capture-pump.replay.spec.ts`, `pipeline-latency.measure.spec.ts` — **cả ba** dựng `CapturePump` trực tiếp
- Create: `benchmarks/realtime/vad-reference.mjs` — VAD offline cho mẫu số coverage, phase 8 dùng

## Implementation Steps

1. `SpeechGate` nhận `maxUtteranceMs` (mặc định 0 = tắt) và `cutLookaheadMs`;
   cộng dồn thời lượng lượt đang mở.
2. Arm tại `maxUtteranceMs - cutLookaheadMs`: bắn `onProbableEnd` một lần.
3. Sau khi arm: cắt tại block đầu tiên dưới ngưỡng, hoặc cắt cứng tại trần.
4. `CapturePump` nhận cờ `continuous`; `onSpeechEnd` → `idle` khi bật.
5. `echoGate` dựng **không** kèm `maxUtteranceMs`.
6. Test:
   - 60s liên tục, `maxUtteranceMs=8000` → 7–8 lượt, không lượt nào > 8,5s
   - `maxUtteranceMs=0` → chuỗi sự kiện **giống hệt** hôm nay
   - **không block nào xuất hiện trong hai lượt** — kiểm định danh từng block
   - không mất block nào qua điểm cắt
   - điểm cắt rơi vào chỗ yên khi có chỗ yên; cắt cứng khi không có
   - `speculate` được bắn đúng một lần cho mỗi lượt bị cắt
   - **lượt kết thúc bằng hangover ở chế độ liên tục → lượt sau nhận pre-roll đầy đủ**
   - `isMuted` không kẹt `true` sau hangover ở chế độ liên tục
   - `echoGate` không bắn `onEchoHeard` theo đồng hồ
7. Viết `vad-reference.mjs` và xác nhận nó cho thời lượng speech của một file
   fixture độc lập với gate.

## Success Criteria

- [ ] Test `maxUtteranceMs=0` chứng minh chuỗi sự kiện không đổi
- [ ] Không block nào trùng giữa hai lượt (định danh, không phải tổng)
- [ ] Lượt kết thúc bằng hangover ở chế độ liên tục không mất pre-roll
- [ ] `speculate` bắn cho lượt bị cắt
- [ ] `vad-reference.mjs` chạy được, cho thời lượng speech độc lập
- [ ] Ba spec dựng `CapturePump` đều pass
- [ ] `apps/web` hành vi turn-taking không đổi

## Risk Assessment

- **File này sinh ra bug tốn kém nhất dự án** (mục 6.3): cờ half-duplex đặt ở đầu
  lời nói thay vì cuối; audio im lặng vẫn gửi làm speculation không dùng được. Cả
  hai lọt qua mọi cổng. Chỉ test **thứ tự sự kiện** bắt được, và test phải dựng
  chuỗi mà production tạo ra được. Cặp `onSpeechEnd`+`onSpeechStart` liền nhau là
  chuỗi mới — test trực tiếp.
- **`held` và điểm cắt.** Block đang giữ nằm **trước** điểm cắt, thuộc lượt N,
  phải flush trước khi đóng.
- **`capture-pump.spec.ts` chưa từng chạy `fullDuplex = true` quá một lượt.** Mọi
  test chế độ liên tục ở đây là đường mới hoàn toàn.
- **Cắt giữa câu làm bản dịch mất ngữ cảnh.** Có thật, không giải quyết. Ghi nhận:
  cắt cưỡng bức đổi chất lượng dịch lấy khả năng theo kịp.
- **Rollback:** đảo được độc lập — mọi thứ mới nằm sau cờ mặc định tắt.
