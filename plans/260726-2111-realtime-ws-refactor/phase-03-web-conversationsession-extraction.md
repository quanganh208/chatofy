---
title: 'Phase 3: web ConversationSession extraction'
status: todo
phase: 3
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 3: web ConversationSession extraction

## Overview

`use-streaming-translate.ts` (349 LOC) mang 13 `useRef`, một `start()` ~100 dòng tự wiring
getUserMedia → worklet → socket → pump → playback, guard staleness thủ công bằng `runId`, và
hai đường teardown. Rút lifecycle vào `ConversationSession` — class TS thuần, deps inject
được, có test. Hook còn lại: tạo session, subscribe, `useReducer`, trả contract.

Phase rủi ro cao nhất: file này hôm nay **không có test nào**, và repo đã ship 2 defect vô
hình trong client code không test (`apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts:10`,
`apps/web/src/state/conversation-state.ts:11`). Spec viết **trước**.

## Requirements

Functional:

- [ ] Contract hook giữ nguyên **toàn bộ** với page: `status`, `turns`, `liveText`,
      `liveTranslation`, `echoHeard`, `error`, `level`, `muted`, `start`, `stop`, và tham số
      `options: StreamingTranslateOptions`. Xem non-goals ở `plan.md` — dụng cụ đo AEC được giữ
- [ ] Bất biến 1: mic chỉ mở lại khi turn ĐÃ end server-side **VÀ** playback đã cạn
- [ ] Bất biến 2: `start()` bị stale phải nhả tài nguyên nó đã tạo, **không** ghi lên state
      của run đang chạy
- [ ] Bất biến 3: `start()` khi đang chạy là no-op — không reset reducer, không mở mic thứ hai
- [ ] Bất biến 4: teardown giải phóng socket + track + context + node + pump + playback đúng
      một lần; gọi hai lần không nổ
- [ ] `pending` audio flush qua **một** code path, detach-rồi-lặp, sequence bắt đầu từ 0
- [ ] Socket rơi giữa cuộc → set error rồi teardown, và error **không** bị teardown xoá

Non-functional:

- [ ] `conversation-session.ts` ≤ 200 LOC; hook ≤ 130 LOC
- [ ] Test chạy dưới `environment: 'node'` — **không** đổi sang jsdom
- [ ] Không xoá test cũ nào (32 test web giữ nguyên)

## Architecture

### Hai tầng teardown, không phải một

Bản 1 gọi `stop()` + `abandon()` là "trùng lặp có thể drift". Sai: chúng có **phạm vi khác
nhau**, và đó là điều load-bearing.

|                     | `abandon()` (`:244-248`)       | `stop()` (`:125-147`)                                              |
| ------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Nhả                 | socket, stream tracks, context | thêm node (+`port.onmessage = null`), playback, pump               |
| Reset state chia sẻ | **không**                      | `sessionId`, `sequence`, `pending`, `turnEnded` (`:140-143`)       |
| Gọi listener        | **không**                      | `setStatus('idle')`, `setLevel(0)`, `setMuted(false)` (`:144-146`) |

Nếu gộp thành một `teardown()` có cả reset chia sẻ: user bấm stop rồi bấm start lại ngay
(generation 2 đang chạy, đã có `sessionId`, đang gửi block) → `getUserMedia` của run 1 mới
resolve, thấy stale, gọi `teardown()` → `sessionId = null` của **run 2**. Từ đó mọi
`sendBlock` rơi vào `pending` và không bao giờ được flush (vì `server.session.ready` của run 2
đã bay qua rồi). Kết quả: mic mở, level meter nhảy, status `idle`, **không byte nào tới server,
không lỗi nào hiện**.

Hình đúng:

```ts
/** Chỉ nhả tài nguyên của đúng bộ resources được truyền vào. Idempotent. Không ghi state chia sẻ, không gọi listener. */
private releaseResources(r: Partial<LiveResources>): void;

/** Teardown đầy đủ của run hiện tại: releaseResources(this.live) + reset state chia sẻ + báo listener. */
stop(): void;
```

Đường stale gọi `releaseResources(local)`. Đường `stop()` gọi cả hai. Ba checkpoint stale hôm
nay đều nằm **trước** khi node/pump/playback tồn tại (`:260`, `:264`, `:277`), nên
`releaseResources` không cần biết chúng — nhưng nhận `Partial` để an toàn nếu sau này thêm
checkpoint.

### `src/conversation/conversation-session.ts`

```ts
export interface ConversationSessionDeps {
  openMicrophone: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createWorkletNode: (ctx: AudioContext) => AudioWorkletNode; // AudioWorkletNode là global, phải inject
  createSocket: (handlers: TranslateSocketHandlers) => TranslateSocket;
  workletUrl: string;
}

export interface ConversationSessionListeners {
  onStatus: (status: ConversationStatus) => void;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
  onError: (message: string) => void;
  onEchoHeard: () => void;
  onServerEvent: (event: ServerEvent) => void; // đi thẳng vào reducer
}

export class ConversationSession {
  private generation = 0;
  private live: LiveResources | null = null;
  private turnEnded = false;
  private sessionId: string | null = null;
  private sequence = 0;
  private pending: Int16Array[] = [];
  private lastLevelAt = 0;

  constructor(
    deps,
    listeners,
    private readonly fullDuplex = false,
  ) {}

  get isRunning(): boolean; // this.live !== null
  async start(direction: TranslationDirection): Promise<void>;
  stop(): void;
  private releaseResources(r: Partial<LiveResources>): void;
  private armIfTurnComplete(): void;
  private sendBlock(block: Int16Array): void;
  private flushPending(): void;
}
```

**Reentrancy:** `start()` mở đầu bằng `if (this.isRunning) return;` — tương ứng
`if (contextRef.current) return; // already running` (`:230`). Không có nó, một double-tap sẽ
hoặc reset reducer giữa cuộc (transcript biến mất trước mắt người dùng), hoặc để lại một
`MediaStream` + socket không ai tham chiếu, mic vẫn nóng, gửi audio song song, gấp đôi chi phí
Gemini/STT mỗi lượt nói. `generation` tăng trong `stop()` và trong `start()` **sau** khi qua
guard.

**`flushPending` phải detach-rồi-lặp:**

```ts
private flushPending(): void {
  const held = this.pending;      // detach TRƯỚC khi lặp
  this.pending = [];
  for (const block of held) this.sendBlock(block);
}
```

Vì `sendBlock` ghi lại vào `pending` khi `sessionId` là null (`:167-171`). Nếu không detach
trước, lần flush sau gửi lại đúng những block đó với sequence **tiến lên**, nên guard replay
của server (`frame.sequence <= lastSequence`) không chặn — utterance bị nhân đôi im lặng, chỉ
biểu hiện thành transcript lắp và bản dịch của câu nói đôi.

Ba mảnh chuyển nguyên nghĩa từ hook:

| Hôm nay ở hook                                                            | Sau refactor                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `armNextTurnIfDone()` (`:157-164`)                                        | `armIfTurnComplete()` — vẫn kiểm cả `turnEnded` và `playback.isPlaying`, vẫn clear `turnEnded` trước khi arm |
| `sendBlock()` + bản copy trong `case 'server.session.ready'` (`:190-199`) | `sendBlock()` + `flushPending()`                                                                             |
| `runIdRef` + `isStale()`                                                  | `generation` + `isStale(gen)`                                                                                |
| `stop()` + `abandon()`                                                    | `stop()` + `releaseResources()` (hai tầng, xem trên)                                                         |

Giữ verbatim: lý do re-arm cần cả hai điều kiện (`:84-88`), lý do giữ resource ở local đến khi
hết await (`:239-240`), lý do `socket.onClosed` phải `stop()` (`:270-272`).

**Error không bị teardown xoá:** hôm nay `onClosed` set error (`:272`) **rồi** gọi `stop()`
(`:273`), và `stop()` cố ý không clear error. `stop()` mới phải giữ tính chất đó, nếu không
người dùng về `idle` mà không có lời giải thích nào cho việc socket rơi.

### `src/conversation/conversation-status.ts`

`ConversationStatus` hiện khai báo trong hook và đánh dấu `@public` (`:19-23`), page dùng qua
`STATUS_LABEL[conversation.status]` (`page.tsx:70`). Class cần nó cho `onStatus` → nếu để ở
hook thì thành vòng import hook ↔ class. Chuyển sang `src/conversation/conversation-status.ts`,
hook `export type { ConversationStatus }` lại để import của page không đổi.

### `src/conversation/fake-audio-context.ts`

Chạy ở node nên phải fake. Bề mặt tối thiểu — bản 1 thiếu 3 thứ:

- `sampleRate` (**bắt buộc**, ví dụ 48000). Hook đọc nó 2 lần trên hot path (`:310` để tính
  `blockSamples`, `:317` để downsample). Thiếu → `Math.max(1, Math.floor(1024 / (undefined/16000)))`
  = `Math.max(1, NaN)` → block size vô nghĩa, `preRollBlocks` và mọi `blockMs` sai theo.
- `currentTime`, `destination`, `close()` (resolve), `audioWorklet.addModule` (resolve)
- `createBuffer(ch, len, rate)` → object có `getChannelData(0)` ghi được và `duration`
- `createBufferSource()` → `{ buffer, connect(), start(), stop(), onended }`, kèm helper
  `flushEnded()` để test bắn `onended` — không có nó thì queue không bao giờ cạn
- `createMediaStreamSource()` → `{ connect() }`
- Fake worklet node: `{ port: { onmessage }, disconnect() }` — **`disconnect()` bắt buộc**,
  teardown gọi nó (`:130`); thiếu thì test "stop() hai lần" đỏ vì fake, không vì code
- Fake `MediaStream`: `getTracks()` → track có `stop()` đếm được
- Fake `TranslateSocket`: thu event đã gửi + cho test bơm `ServerEvent` vào

**Chiến lược timer — phải chốt, không để ngỏ:** `PcmPlaybackQueue.scheduleDrainCheck()` dùng
`setTimeout(…, 60)` thật (`pcm-playback-queue.ts:90-96`) và độ trễ đó là load-bearing (nó tồn
tại để không unmute mic giữa hai nửa một câu). Test drain phải `await vi.advanceTimersByTimeAsync(60)`
với `vi.useFakeTimers()`. Cạm bẫy: fake timers + `await` trên chuỗi promise của `start()` dễ
treo — nên bật fake timers **sau** khi `start()` đã resolve, hoặc dùng
`vi.useFakeTimers({ shouldAdvanceTime: true })`. Ghi rõ cách đã chọn trong spec.

### Hook sau refactor (~120 LOC)

```ts
export function useStreamingTranslate(
  options: StreamingTranslateOptions = {},
): UseStreamingTranslate;
```

5 `useState` + 1 `useReducer` + 1 `useRef` cho session. `LEVEL_UPDATE_MS` throttle,
`WORKLET_BLOCK_SAMPLES` và công thức `blockSamples` chuyển vào class (chúng là policy).
`FULL_DUPLEX_ALLOWED` (`:40`) ở lại hook — nó là rào build-time của UI layer.
`useEffect(() => stop, [stop])` giữ nguyên.

## Related Code Files

- Create: `apps/web/src/conversation/conversation-session.ts`
- Create: `apps/web/src/conversation/conversation-status.ts`
- Create: `apps/web/src/conversation/conversation-session.spec.ts`
- Create: `apps/web/src/conversation/fake-audio-context.ts`
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` (349 → ~120 LOC)
- Read-only: `capture-pump.ts`, `speech-gate.ts`, `pcm-playback-queue.ts`, `pcm-resampler.ts`,
  `translate-socket.ts`, `conversation-state.ts`
- Không sửa: `apps/web/app/translate/page.tsx`, `apps/web/vitest.config.ts`

## Implementation Steps

Checkpoint: `git tag plan-p3-start`.

Tests Before — 10 test, viết theo hành vi **hiện tại** đọc từ code hôm nay:

1. `fake-audio-context.ts` + `conversation-session.spec.ts`:
   1. `server.session.ended` một mình → mic **chưa** mở lại (playback còn chạy)
   2. playback drain một mình (advance 60ms) → mic **chưa** mở lại (server chưa end)
   3. cả hai xong, **test cả 2 thứ tự** → `armNextTurn` gọi đúng 1 lần, status `listening`,
      `muted` false
   4. block thu trước `server.session.ready` → giữ lại, gửi đúng thứ tự, sequence 0,1,2…
   5. **hai lượt liên tiếp** trên một session → tổng số `sendAudio` bằng số block thật, không
      có block nào gửi hai lần (net cho `flushPending` detach-rồi-lặp)
   6. `stop()` chen vào **sau `getUserMedia`, trước `createAudioContext`** → `track.stop()`
      được gọi, và **không** assert `context.close()`: ở checkpoint đó `context` còn `undefined`
      (`:241-243`, `:260`, `:262`). Bản 1 assert sai chỗ này
   7. `stop()` chen vào **sau `addModule`** → `track.stop()` **và** `context.close()`
   8. `stop()` → `start()` ngay → run 1 resolve muộn thấy stale → `sessionId`/`sequence`/
      `pending` của run 2 **không** bị chạm, run 2 vẫn gửi được audio
   9. `stop()` gọi hai lần → không throw, `track.stop()` không gọi thêm
   10. `start()` khi đang chạy → `openMicrophone` gọi đúng 1 lần, reducer không bị reset
2. Chạy `cd apps/web && pnpm test` — spec mới **đỏ** (class chưa có). Bắt buộc thấy đỏ trước
   khi implement; test xanh trên code chưa tồn tại là test rỗng.

Refactor:

3. `conversation-status.ts` + hook re-export. Test cũ → xanh.
4. `conversation-session.ts`, port logic nguyên nghĩa, comment đi theo verbatim.
5. Spec mới xanh.
6. Viết lại hook thành lớp mỏng. Giữ tham số `options` và field `echoHeard`.
7. Xoá `abandon()`, `runIdRef`, và các ref đã chuyển vào class (giữ 1 ref cho session).

Tests After:

8. `createSocket` ném → `onError` có message, tài nguyên đã nhả.
9. `socket.onClosed` giữa cuộc → error được set **và còn nguyên sau** teardown.

Regression Gate:

10. `cd apps/web && pnpm test` → 32 test cũ xanh + spec mới; 4 file (1 vẫn skip)
11. `cd apps/web && pnpm typecheck && pnpm lint`
12. `cd apps/web && pnpm build`
13. Kiểm tay ở browser: `pnpm dev:all`, mở `/translate`, nói một câu vi→en. Xác nhận:
    transcript live chạy, dịch xong phát tiếng, mic tự mở lại sau khi phát xong, nói tiếp lượt
    2 vẫn được, không có vòng lặp tự dịch. Bấm stop/start liên tiếp 3 lần → vẫn gửi được audio.
    **Không có test tự động nào phủ được điều này** — nếu môi trường không chạy được
    `pnpm dev:all` thì ghi rõ "chưa kiểm tay" vào báo cáo phase, đừng bỏ im.

## Success Criteria

- [ ] `conversation-session.ts` ≤ 200 LOC, hook ≤ 130 LOC (từ 349)
- [ ] Hai hàm teardown có phạm vi rõ: `releaseResources` (resource-only, idempotent) và `stop()`
- [ ] `sendBlock` chỉ có một bản; `flushPending` detach trước khi lặp
- [ ] 10 test mới pass, gồm cả 2 chiều thứ tự re-arm và ca stop→start→stale
- [ ] Contract hook không đổi: 10 field + tham số `options` còn nguyên; `page.tsx` diff = 0
- [ ] 32 test cũ pass, không sửa, không xoá
- [ ] typecheck + lint + build exit 0
- [ ] Kiểm tay ở browser xong (hoặc ghi rõ chưa chạy được và vì sao)

## Risk Assessment

| Rủi ro                                                                                         | Giảm thiểu                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Teardown gộp xoá state của run mới** → mic mở, meter nhảy, 0 byte tới server, 0 lỗi          | Hai tầng `releaseResources` / `stop()`; test 8                                            |
| **Thiếu guard reentrancy** → mic thứ hai nóng, gấp đôi chi phí mỗi lượt                        | `if (this.isRunning) return` + test 10                                                    |
| **`flushPending` không detach** → audio gửi 2 lần, server không chặn được vì sequence vẫn tiến | Snippet chốt cứng + test 5                                                                |
| **Đổi thứ tự re-arm mic** → app tự dịch chính nó trước mặt người dùng                          | Test cả 2 chiều + kiểm tay bước 13                                                        |
| Fake context thiếu `sampleRate` → block size NaN, test xanh mà không chứng minh gì             | Bề mặt fake liệt kê đủ; bước 2 bắt buộc thấy đỏ trước                                     |
| Fake timers treo chuỗi await của `start()`                                                     | Chốt cách dùng: bật fake timers sau khi `start()` resolve, hoặc `shouldAdvanceTime: true` |
| Test 6 assert `context.close()` ở chỗ context chưa tồn tại                                     | Tách thành test 6 + 7 theo đúng 2 checkpoint thật                                         |
| Dừng giữa refactor                                                                             | `git tag plan-p3-start`; hook và class là 2 commit riêng                                  |
