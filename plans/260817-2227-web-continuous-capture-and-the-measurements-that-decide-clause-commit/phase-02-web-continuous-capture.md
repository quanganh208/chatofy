---
title: 'Phase 2: Web continuous capture'
status: done
phase: 2
priority: P1
effort: '1-2d'
dependencies: [1]
---

# Phase 2: Web continuous capture

## Overview

Web chuyển sang capture liên tục: mic không dừng giữa hội thoại, các lượt chạy song
song. Đây là phần "bỏ rào chặn" mà user yêu cầu — **không** phải phần đóng khoảng
cách 7 giây (việc đó là A-lite, còn sau cổng Phase 3).

## Requirements

- Functional: `continuous: true`, `maxInFlight: 3` (khớp `MAX_IN_FLIGHT_INBOUND`
  của extension, cũng là trần per-socket của server). Transcript chịu được nhiều
  lượt sống cùng lúc. Đếm vọng âm vẫn chạy (đã có từ Phase 1).
- Non-functional: `fullDuplex` vẫn **false** cho tới khi Phase 3 cấp phép. Continuous
  mà không full-duplex là hợp lệ và đúng ý đồ: mic không còn chết theo _chu kỳ lượt_,
  chỉ còn bị bỏ qua đúng lúc loa đang kêu.

## Architecture

Ba thứ đổi theo nhau, bỏ sót cái nào cũng thành lỗi im lặng:

**1. Transcript phải turn-keyed.** `apps/web/src/state/conversation-state.ts` giữ
đúng **một** `liveText` / `liveTranslation` cho cả hội thoại. Với nhiều lượt song
song, partial của lượt B ghi đè partial của lượt A và dòng live nhảy qua lại giữa hai
câu. `packages/realtime-client/src/state/turn-keyed-transcript.ts` đã tồn tại cho
đúng việc này (`turnKeyedTranscriptReducer`, `liveTurnsInOrder`,
`initialTurnKeyedTranscript`) và đang được extension dùng.

**2. `onTurnAbandoned` bắt buộc phải nối.** Web hiện không truyền listener này.
`TurnKeyedTranscript` cần nó, nếu không dòng live của lượt bị từ chối ở trần, bị drop
ở backlog, hoặc bị stall watchdog thả sẽ **nằm lại trên màn hình cho tới hết hội
thoại** — server không bao giờ gửi `session.ended` cho những lượt đó.

**3. `status` và `muted` đổi nghĩa.** Ở chế độ continuous, `CapturePump.onTurnClose`
không còn báo `'translating'` và không còn `onMuted(true)`; `armIfTurnComplete` không
bao giờ chạy (`singleTurn` false). UI phải ngừng hiển thị "đang tắt mic" như một pha
của chu kỳ lượt, và thay bằng chỉ báo mic **luôn mở** + chỉ báo có audio đang phát
(`onPlaybackBusy`).

## Related Code Files

- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — `runtimeOptions` trả
  `continuous: true`, `maxInFlight: 3`; nối `onTurnAbandoned`, `onPlaybackBusy`,
  `onLog`; đổi reducer
- Modify/Delete: `apps/web/src/state/conversation-state.ts` +
  `conversation-state.spec.ts` — thay bằng `turnKeyedTranscriptReducer`. **Đọc
  `turn-keyed-transcript.ts` trước khi xoá**: nếu web cần hình dạng khác, bọc chứ
  không fork logic ordering
- Modify: component đọc `liveText`/`liveTranslation` (tìm bằng grep từ hook) — chuyển
  sang render danh sách `liveTurnsInOrder(...)`
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — bỏ/đổi nghĩa `muted`

## Implementation Steps

1. Grep các consumer của `liveText`, `liveTranslation`, `muted`, `status` trong
   `apps/web` trước khi đổi contract của hook.
2. Đổi reducer sang `turnKeyedTranscriptReducer`; nối `onTurnAbandoned` →
   dispatch action `TurnAbandoned` mà module đó định nghĩa.
3. Bật `continuous: true`, `maxInFlight: 3` trong `runtimeOptions`.
4. Cập nhật UI: nhiều dòng live (một dòng mỗi lượt đang chạy, theo thứ tự nói), chỉ
   báo mic luôn mở, chỉ báo phát audio lấy từ `onPlaybackBusy`. **Chỉ dùng cho chỉ
   báo UI** — `onPlaybackBusy` mang `isBusy` (true từ lúc lượt MỞ), không bao giờ được
   dùng làm tín hiệu cổng mic; cổng mic dùng predicate `sounding()` của Phase 1. Gộp
   hai thứ này là ship-stopper đã ghi ở Phase 1.
5. Nối `onLog` vào một chỗ nhìn thấy được (console + dev panel). Lượt bị drop ở trần
   backlog hoặc pending là thứ **không được im lặng** — Phase 3 đọc chính chúng.
6. **Chốt `maxUtteranceMs` cho web.** Extension đặt 8000 (`direction-session.ts:30`);
   web hiện **không đặt gì** (`use-streaming-translate.ts:121-123`), nên continuous
   trên web có thể sinh lượt dài vô hạn. Chọn một con số và ghi lý do — và biết rằng
   nó **right-censor** histogram ở Phase 3(b): "% lượt vượt 5 s" một phần là sản phẩm
   của chính trần này. Báo cáo `cutForced` (đã đếm sẵn, `analyze-continuous.mjs:195`)
   như quan sát bị kiểm duyệt.
7. Thêm log + counter cho 429 bị nuốt tại `gemini-translation-provider.ts:161-180`
   (xem Risk Assessment — đây là tín hiệu cảnh báo sớm duy nhất tồn tại).
8. Chạy lại kiểm chứng trình duyệt (Playwright + Chromium trên bản `next start`, thay
   `getUserMedia` bằng `MediaStream` dựng từ fixture WAV) theo đúng cách §6.7 đã làm.

## Success Criteria

- [x] Hai lượt chạy song song → hai dòng live riêng, không lẫn, đúng thứ tự nói
      (`turn-keyed-transcript`, có test)
- [x] Lượt bị `too_many_turns` / backlog drop / stall → dòng live của nó **biến mất**
      (`onTurnAbandoned` đã nối vào reducer)
- [x] Mic không dừng sau khi một lượt kết thúc (`continuous: true`)
- [x] `fullDuplex` vẫn false; `onEchoHeard` vẫn đếm được
- [x] `pnpm --filter web test` + `lint` + `typecheck` + `build` xanh
- [x] `maxUtteranceMs` của web được chốt (8000, khớp extension) và ghi lý do kèm
      hệ quả right-censoring ngay tại chỗ đặt hằng số
- [x] 429 bị nuốt **được log** (`onQuotaCooldown` → `GeminiQuota` logger, có test)
- [ ] **CHƯA CHẠY ĐƯỢC** — Kiểm chứng trình duyệt (chữ nguồn live, chữ dịch live,
      chốt lượt, 0 lỗi). Repo **không có** harness Playwright nào được commit; §6.7
      chạy ad hoc. Chạy lại cần Postgres + hai sidecar Python kèm model. Đây là
      việc đầu tiên phải làm khi có stack chạy được.
- [ ] **CHƯA ĐO** — req/phút mỗi model và `quotaFailures` = 0 trong phiên 5 phút.
      Cần phiên hội thoại thật; thuộc về Phase 3 cùng lúc thu JSONL cho histogram.

## Risk Assessment

**Rủi ro: tự dịch chính mình (loop loa→mic).** Continuous _không_ bật full-duplex, và
Phase 1 đã đảm bảo mic bị bỏ qua khi loa kêu. Tín hiệu hỏng: `echoHeard` tăng **và**
xuất hiện lượt mới có nội dung trùng bản dịch vừa phát. Phản ứng: dừng ngay, không
"chỉnh ngưỡng cho đỡ" — đó là dấu hiệu Phase 1 nối sai tín hiệu playback.

**Rủi ro: 3 lượt song song làm quá tải sidecar CPU** (STT+TTS+API+client cùng một
máy). §10.4 ghi rõ phép đo oversubscription 1/2/3 socket **chưa từng chạy**. Tín
hiệu: STT p50 rời khỏi mốc 58 ms, hoặc TTS mỗi mệnh đề vượt p95 1125 ms. Phản ứng:
hạ `maxInFlight` xuống 2 và ghi số, không âm thầm giữ 3.

**Rủi ro: capture liên tục làm tăng req/phút và đẩy model qua trần 15/phút.** Web
trước đây một lượt một lúc; continuous sinh nhiều lượt hơn trên cùng một phút, mỗi
lượt vẫn tốn ~1,8 request. Đây đúng là hình dạng thảm hoạ đã đo (§6.4: request thêm
đẩy `3.5-flash-lite` vượt trần, p95 nhảy lên 10112 ms, một lượt mất 18537 ms).

**Tín hiệu cảnh báo sớm — "thấy dòng gemma trong JSONL" là SAI, không quan sát
được.** Hai lý do độc lập: §6.4 đã bỏ gemma khỏi **cả hai** ladder của đường live
(`translation-model-policy.ts:39-46`, `:75`), và dòng JSONL phía server **không có
trường model** (`turn-metrics.recorder.ts`) — `analyze-continuous.mjs:89-101` chỉ
_suy ra_ model từ một map cứng. Tín hiệu thật, rẻ trước:

1. **429 bị nuốt** — cảnh báo sớm thật, và hôm nay hoàn toàn im lặng:
   `gemini-translation-provider.ts:161-180` ghi cooldown rồi return, không log gì.
   Thêm một dòng log + một counter ngay tại đó là xong, và một 429 luôn đến **trước**
   mọi fallback. Đây là việc của phase này, không phải "sau này".
2. **Dòng server có `completed === false`** — đã được tính sẵn thành `quotaFailures`
   (`analyze-continuous.mjs:211`). Với gemma đã bị bỏ, đây mới là hình dạng hiện đại
   của cạn quota.
3. `translatedAtMs` p95 — xác nhận trễ, không phải cảnh báo.

**Thứ tự dùng đòn bẩy — đảo lại so với bản đầu.** `maxInFlight` **không** giảm
req/phút: request = lượt × (1 final + live translations + speculations). Hạ nó chỉ
làm **từ chối lượt**, và lượt bị từ chối rơi vào chính con số coverage mà luận văn
báo cáo. Thứ tự đúng: **(a) key pool nhiều project** (chỉ là config, nhân trần theo
project, không đổi hành vi đã đo) → **(b) cắt ngân sách live-translation** → **(c) hạ
`maxInFlight`** sau cùng. Không nới ladder bằng cách thêm model chậm vào đường live.

**Kèm theo, một phép đo mà chính code đã yêu cầu:** `translation-model-policy.ts:50-74`
ghi rằng khi pool có hơn một key thì sự cô lập của `LIVE_TRANSLATION_MODELS` chỉ còn
một phần, và đề nghị đo lại với `TURN_METRICS_PATH`. Yêu cầu đó rơi đúng vào phase
này — đo, đừng bỏ qua.

**Rủi ro: tiếng nói trong lúc loa đang phát bị bỏ im lặng.** Continuous +
`fullDuplex: false` nghĩa là block mic lúc loa kêu bị vứt, và ở single-turn trạng
thái "translating" từng che việc đó. Không có chỉ báo thì demo sẽ ra "nó bỏ mất câu
tôi vừa nói" mà không để lại dấu vết. Phản ứng: chỉ báo nhìn thấy được + đếm số block
bị vứt khi đang kêu, đưa vào cùng kênh `onLog`.

**Rủi ro: xoá `conversation-state.ts` làm mất một quy tắc ordering đã có test.** File
đó tồn tại vì đúng loại lỗi này đã ship hai lần. Phản ứng: đọc cả 168 dòng spec của
nó, đối chiếu từng assertion với `turn-keyed-transcript.spec.ts`; assertion nào không
có bên kia thì port sang, không bỏ.
