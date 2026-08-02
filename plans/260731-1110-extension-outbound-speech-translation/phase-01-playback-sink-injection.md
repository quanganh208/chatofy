---
phase: 1
title: 'Playback sink injection and package exports'
status: completed
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Playback sink injection and package exports

## Overview

Mở một chỗ tiêm cho lớp phát audio trong `@chatofy/realtime-client`, để một
session có thể phát bản dịch ra nơi khác ngoài loa của máy đang chạy nó, và mở
ra ngoài package đúng ba thứ các phase sau cần import. Không đổi hành vi gì cả —
mặc định vẫn đúng thứ đang chạy hôm nay.

## Requirements

- Functional: `ConversationSession` nhận được một `PlaybackSink` do caller cung
  cấp; không cung cấp thì dùng `PcmPlaybackQueue` như cũ.
- Functional: `PlaybackSink`, `PcmPlaybackQueue` và `pcm16ToBase64` import được
  từ `@chatofy/realtime-client`.
- Non-functional: toàn bộ spec hiện có của `realtime-client` và `apps/web` pass
  không sửa một dòng nào. Đây là điều kiện nghiệm thu, không phải kỳ vọng.

## Architecture

Interface đã có sẵn: `ordered-playback.ts:12-18` khai báo `PlaybackSink` với
đúng năm thành viên `OrderedPlayback` cần (`enqueue`, `isPlayingTurn`,
`isPlaying`, `stop`, `stopTurn`), và ghi rõ `PcmPlaybackQueue` thoả nó về mặt
cấu trúc. Thiếu duy nhất là `ConversationSession` đang `new PcmPlaybackQueue(...)`
ngay trong `start()` (`conversation-session.ts:252-255`), nên caller không xen
vào được.

Thêm một dep tuỳ chọn, cùng kiểu tiêm mà file này đã dùng cho
`createWorkletNode` và `createSocket`:

```ts
createPlaybackSink?: (
  context: AudioContext,
  onTurnDrained: (turnKey: string) => void,
) => PlaybackSink;
```

`onTurnDrained` phải đi qua tham số chứ không để caller tự nối: callback hiện tại
là `(turnKey) => this.live?.ordered?.onTurnDrained(turnKey)`, tức nó đọc
`this.live` — thứ chỉ được gán ở cuối `start()`. Caller không có cách nào dựng
lại đúng cái vòng đó.

`AudioContext` vẫn truyền vào dù sink của extension không dùng tới, vì sink mặc
định cần, và một chữ ký chỉ đúng cho một trong hai implementation là chỗ để bug
chui vào sau này.

## Ba export còn thiếu

Red team bắt được: cả ba thứ phase 5 định import đều **không** ra khỏi package.
`packages/realtime-client/src/index.ts:19-41` chỉ export `ConversationSession`,
`TranslateSocket`/`translateSocketUrl` và reducer transcript. `PlaybackSink`
(`audio/ordered-playback.ts:12`), `PcmPlaybackQueue`
(`audio/pcm-playback-queue.ts:41`) và `pcm16ToBase64`
(`audio/pcm-resampler.ts:75`) đều nằm trong, và `package.json` chỉ map
`"exports": { "." }` nên deep import cũng không cứu được.

Gom cả ba vào phase này, không rải ra. Thiếu chúng ở phase 5 thì áp lực sẽ là
chép logic lịch phát sang MAIN world — đúng thứ
`packages/realtime-client/src/index.ts:1-17` tồn tại để ngăn.

## Related Code Files

- Modify: `packages/realtime-client/src/conversation/conversation-session.ts`
  — thêm field vào `ConversationSessionDeps`, dùng nó ở `start()`
- Modify: `packages/realtime-client/src/index.ts` — export `PlaybackSink`,
  `PcmPlaybackQueue`, `pcm16ToBase64`
- Modify: `packages/realtime-client/src/conversation/conversation-session.spec.ts`
  — thêm test cho đường tiêm

## Implementation Steps

1. Export `PlaybackSink`, `PcmPlaybackQueue`, `pcm16ToBase64` từ
   `packages/realtime-client/src/index.ts`. Kiểm bằng một import thật từ
   `apps/extension`, không chỉ đọc file.
2. Thêm `createPlaybackSink?` vào `ConversationSessionDeps`, kèm doc comment
   theo lối của file: nói **tại sao** nó tồn tại (chiều ra của extension phát
   audio vào trang chứ không ra loa), không chỉ nói nó làm gì.
3. Ở `start()`, đổi `const playback = new PcmPlaybackQueue(context, cb)` thành
   `const playback = this.deps.createPlaybackSink?.(context, cb) ?? new PcmPlaybackQueue(context, cb)`.
   Biến `local.playback` đổi kiểu sang `PlaybackSink`.
4. Kiểm tra `releaseResources` — nó gọi `r.playback?.stop()`, vẫn nằm trong
   interface, không phải sửa.
5. Test: một sink giả ghi lại lời gọi, chứng minh (a) session dùng sink được
   tiêm thay vì `PcmPlaybackQueue`, (b) `onTurnDrained` từ sink đó tới được
   `OrderedPlayback`, (c) không tiêm thì hành vi y hệt trước.

## Success Criteria

- [x] `pnpm --filter @chatofy/realtime-client test` xanh, không sửa spec cũ
- [x] `apps/web` chạy không đổi (không truyền dep mới)
- [x] Từ `apps/extension` import được cả ba: `PlaybackSink`, `PcmPlaybackQueue`,
      `pcm16ToBase64`
- [x] `pnpm typecheck` sạch

## Risk Assessment

Rủi ro thấp. Cái duy nhất đáng canh: `local.playback` được `releaseResources`
gọi `stop()` trên đường lỗi giữa chừng `start()`. Sink của extension sẽ gửi
message qua worker, nên `stop()` của nó phải chịu được lúc chưa có tab nào —
ghi rõ yêu cầu đó vào doc comment của interface ngay ở phase này, để phase 5
không phải phát hiện lại.
