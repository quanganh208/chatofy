---
phase: 6
title: 'Client metrics channel'
status: done
priority: P1
effort: '1d'
dependencies: [2, 5]
---

# Phase 6: Client metrics channel

## Overview

Hai số headline của chức năng này — coverage và độ trôi tích luỹ — **chỉ đo được
ở client**. `TurnMetricsRecorder` là server-side và mọi trường tính từ endpoint;
nó không biết lúc người ta bắt đầu nói, cũng không biết lúc nào loa phát ra
tiếng. Không có kênh này thì extension vào luận văn mà không có số nào.

Đây là món nợ ở `development-journey.md` mục 10 ý 2, chuyển từ nợ thành hạng mục
chặn vì extension là một chức năng của đồ án.

## Requirements

- Functional: client gửi số đo mỗi lượt; server ghi cùng sink JSONL.
- Non-functional: tắt được, và tắt là mặc định. Metrics không bao giờ thêm độ trễ
  hay làm hỏng lượt nó đang đo. Payload từ client phải bị chặn và phải thuộc về
  socket gửi nó.

## Architecture

Sink có sẵn: `TurnMetricsRecorder` **append JSONL** vào `TURN_METRICS_PATH`, off
trừ khi biến đó được đặt (`turn-metrics.recorder.ts:58-105`). Không DB, không
migration. Dòng client đi cùng file, phân biệt bằng một trường loại.

```ts
{ type: 'client.turn.metrics',
  sessionId: string,            // z.string().max(64)
  speechStartedAt: number,      // epoch ms, lúc gate mở lượt
  speechEndedAt: number,
  capturedMs: number,           // thời lượng audio thực gửi
  heldMs: number,
  firstAudioPlayedAt?: number,
  lastAudioPlayedAt?: number,
  queuedAheadMs?: number,
  cutForced: boolean,           // bị cắt cưỡng bức hay kết bằng hangover
  outcome: 'played' | 'no_audio' | 'rejected' | 'dropped' | 'error',
  echoEvents: number }          // onEchoHeard trong lượt này
```

Mọi trường số phải có `.min()/.max()`; mọi chuỗi phải có `.max()`. Đây là dữ liệu
duy nhất client ghi thẳng xuống đĩa server.

### Ghi mọi đường kết thúc, không chỉ đường đẹp

Cả hai phía đang bỏ sót đúng những lượt đáng quan tâm nhất.

**Server** cố ý không `record()` ở ba đường: `no_audio` (`:152-156`), client bỏ đi
giữa chừng (`:182`, `:206`), và `turn_too_long` (`:93`). Nhưng `LivePreview` đã
bắn request quota **trước khi** tới các đường đó (`live-preview.ts:51-58,68-80`),
nên req/phút tính từ JSONL sẽ **thấp hơn thực tế**, và chế độ liên tục chính là
chế độ sinh nhiều lượt hỏng nhất. Sửa: ghi dòng ở mọi đường kết thúc, thêm trường
`abandoned`/`reason` thay vì bỏ qua.

**Client**: bản trước định gửi "khi lượt phát xong". Lượt bị `too_many_turns`, bị
bỏ vì tràn trần, hoặc lỗi thì **không bao giờ phát** → không có dòng → `capturedMs`
của nó biến mất khỏi tử số. Coverage khi đó đo _tỉ lệ phát thành công_, không phải
độ phủ thu âm, và nó đẹp lên đúng lúc pipeline hỏng. Sửa: gửi khi lượt **đóng**,
trường thời điểm phát để optional, `outcome` nói lượt kết thúc kiểu gì.

### Chủ quyền và log injection

`record()` nội suy `metrics.sessionId` thẳng vào `logger.log()` (`:80-86`). Hôm
nay giá trị đó là `randomUUID()` do server sinh (`turn-session.ts:33`); phase này
làm nó do client cung cấp. Hai việc bắt buộc: từ chối event có `sessionId` không
thuộc một lượt đang mở hoặc vừa đóng **của chính socket này** (server đã có id —
chính nó sinh ra), và không log chuỗi client gửi lên chưa escape.

`private warned` (`:75`) là chốt một-cảnh-báo-mỗi-tiến-trình dùng chung cho cả hai
đường ghi. Một lần ghi dòng client lỗi sẽ khoá luôn cảnh báo cho dòng server. Tách
chốt theo loại dòng.

### Ba số dẫn xuất

Tính lúc phân tích, không tính trên đường truyền:

- **coverage** = Σ`capturedMs` (mọi `outcome`) / thời lượng có speech từ VAD offline
- **độ trôi** = `firstAudioPlayedAt` − `speechStartedAt`, vẽ theo thời gian
- **tồn đọng** = `queuedAheadMs`

req/phút **theo từng model** tính từ dòng server (`speculations`,
`liveTranslations`, +1 final). Không cộng gộp hai model.

## Related Code Files

- Modify: `packages/types/src/events/ws-events.ts`
- Modify: `apps/api/src/modules/translate/translate.gateway.ts`
- Modify: `apps/api/src/modules/translate/services/turn-metrics.recorder.ts`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` — ghi ở mọi đường kết thúc
- Modify: `apps/api/src/modules/translate/session/session-registry.ts` — tra lượt vừa đóng, để validate chủ quyền
- Modify: `packages/realtime-client/src/conversation/turn-pipeline.ts`, `src/audio/ordered-playback.ts`
- Create: `benchmarks/realtime/analyze-continuous.mjs`
- Test: `turn-metrics.recorder` spec, `translate.gateway.spec.ts`, `translation-session.service.spec.ts`

## Implementation Steps

1. Thêm event vào hợp đồng với đủ `.max()`/`.min()`.
2. Gateway nhận, validate chủ quyền `sessionId` theo socket, rồi chuyển xuống.
3. Recorder: trường loại dòng, chốt `warned` tách theo loại, không log chuỗi thô.
4. Server ghi dòng ở **mọi** đường kết thúc kèm `reason`.
5. Client: `TurnPipeline` ghi mốc mở/đóng và byte đã gửi; `OrderedPlayback` ghi
   mốc phát và tồn đọng; gửi khi lượt **đóng**, không đợi phát.
6. Cờ bật/tắt phía client, mặc định tắt.
7. Script phân tích: ghép dòng client và server theo `sessionId`, in coverage /
   trôi theo mốc phút / req/phút **theo từng model**.
8. Test: dòng client đúng hình dạng; `sessionId` lạ bị từ chối; recorder tắt khi
   không có `TURN_METRICS_PATH`; lượt `rejected` và `dropped` vẫn ghi được;
   metrics hỏng không làm hỏng lượt dịch.

## Success Criteria

- [ ] Chạy một hội thoại thật: JSONL có cả dòng server lẫn client, ghép được theo `sessionId`
- [ ] Lượt bị `too_many_turns` / bị bỏ / lỗi đều có dòng client với `outcome` đúng
- [ ] Lượt `no_audio` và `turn_too_long` đều có dòng server
- [ ] `sessionId` không thuộc socket bị từ chối
- [ ] Script in coverage, độ trôi theo mốc phút, req/phút **tách theo model**
- [ ] Tắt mặc định: không đặt `TURN_METRICS_PATH` thì không ghi gì, không lỗi

## Risk Assessment

- **Đồng hồ hai phía lệch nhau.** Số client tính trong hệ đồng hồ client; số server
  giữ hệ của nó; ghép bằng `sessionId`, không bằng thời gian. Không trừ chéo.
- **Đo cái mình muốn thấy.** Coverage lấy mẫu số từ gate của chính mình thì gate
  bỏ sót tiếng sẽ làm cả tử lẫn mẫu cùng giảm. Mẫu số đến từ `vad-reference.mjs`
  (phase 4), chạy trên file bản ghi.
- **Đây là dữ liệu client ghi thẳng xuống đĩa server trên một endpoint không auth.**
  Chặn kích thước, validate chủ quyền, không log thô. Không giải quyết được vấn đề
  auth, chỉ không làm nó tệ hơn.
- **Rollback:** đảo được độc lập; sink tắt mặc định.
