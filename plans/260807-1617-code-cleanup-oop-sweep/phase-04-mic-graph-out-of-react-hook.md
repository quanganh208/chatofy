---
title: 'Phase 4: Mic Graph Out Of React Hook'
status: todo
phase: 4
priority: P1
effort: '4h'
dependencies: []
---

# Phase 4: Mic Graph Out Of React Hook

## Overview

`use-live-translate.ts:107-167` dựng **toàn bộ đồ thị audio** bên trong một React
hook: `new AudioContext`, `getUserMedia`, `audioWorklet.addModule`,
`AudioWorkletNode`, downsample, RMS. Hook anh em `use-streaming-translate.ts:91-106`
không làm gì trong số đó — nó **inject** deps vào `ConversationSession` ở package
đã có test.

Đây là "đặt hàm sai vị trí" rõ nhất phía client: một đường để hạ tầng ở workspace
có 1 spec, đường kia để ở workspace có 11 spec và harness audio giả.

## Requirements

- Functional: hành vi không đổi. Đặc biệt: **không có gate** — mọi block đều
  được đẩy đi (`:155` "Unconditional. A filter here would be the gate this path
  must not have").
- Non-functional: đồ thị mic có test; hook chỉ còn state React.

## Architecture

**KHÔNG tái dùng `CapturePump`.** Đã kiểm chứng: `CapturePump` là **chính sách
turn-taking** — `SpeechGate`, pre-roll 320 ms, half-duplex, `awaiting-result`.
Live path phải không có gate. Dùng lại nó sẽ tái tạo đúng lỗi mà nhánh live được
thiết kế để tránh.

Cần một thứ nhỏ hơn hẳn: chỉ mở mic và phát ra block PCM16 + RMS.

```ts
// packages/realtime-client/src/audio/microphone-graph.ts  (~90 dòng)
export interface MicrophoneGraphDeps {
  openMicrophone: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  workletUrl: string;
}

export class MicrophoneGraph {
  async open(onBlock: (block: Int16Array, rms: number) => void): Promise<void>;
  close(): void; // gộp logic teardown ở :87-96 và :184-185
}
```

Deps đặt tên **trùng khớp** `ConversationSessionDeps` (`use-streaming-translate.ts:91-106`)
— cùng bốn khoá, cùng chữ ký. Đó là quy ước sẵn có, không phải phát minh mới.

**Không đụng `ConversationSession`** ở phase này: nó thuộc đường cascade đang
đóng băng (Phase 8). Việc nó cũng có thể dùng `MicrophoneGraph` sau này là ghi
chú, không phải phần việc ở đây.

Sau đó `use-live-translate.ts` chỉ còn: state React, wiring callback, và dựng
`MicrophoneGraph` + `LiveSession` bằng deps thật.

## Related Code Files

- Create: `packages/realtime-client/src/audio/microphone-graph.ts`
- Create: `packages/realtime-client/src/audio/microphone-graph.spec.ts`
- Modify: `packages/realtime-client/src/index.ts` (export lớp + kiểu deps)
- Modify: `apps/web/src/hooks/use-live-translate.ts` (bỏ `:81-96`, `:107-167`, `:184-185`)

## Implementation Steps

1. Tạo `microphone-graph.ts`. Chuyển nguyên văn `:148-167` vào `open()`, và
   `:87-96` + `:184-185` vào `close()`. Mang theo comment `:155-165` — chúng ghi
   lại _lý do_ không có gate và _lý do_ đọc RMS từ block đang cầm thay vì
   `AnalyserNode`.
2. **Không** chuyển `downsampleToPcm16` / `pcm16Rms` — đã xác minh: cả hai đã nằm
   ở `packages/realtime-client/src/audio/pcm-resampler.ts:28,:64` và đã export
   qua `src/index.ts:50`. `MicrophoneGraph` import chúng từ cùng package.
3. Viết `microphone-graph.spec.ts` dùng `FakeAudioContext`, `FakeWorkletNode`,
   `FakeMediaStream` (đã có sẵn ở `conversation/fake-audio-context.ts`). Bao:
   - block phát ra không bị lọc, kể cả khi RMS ≈ 0 (**đây là ca quan trọng nhất**)
   - `close()` gọi hai lần không ném
   - `close()` dừng track, ngắt node, đóng context
4. Export từ `packages/realtime-client/src/index.ts`.
5. Viết lại `use-live-translate.ts` dùng `MicrophoneGraph`. Bỏ `contextRef`,
   `streamRef`, `nodeRef`; giữ `queueRef` (playback, không thuộc đồ thị mic).
6. Chạy cổng nghiệm thu + kiểm tra thủ công `/translate/live` một lượt.

## Success Criteria

- [x] Hook không còn **điều phối** đồ thị audio — `audioWorklet.addModule`,
      `createMediaStreamSource`, `port.onmessage`, downsample, thứ tự teardown:
      tất cả đã sang `MicrophoneGraph`
- [x] `microphone-graph.spec.ts` khẳng định block RMS = 0 **vẫn** được đẩy đi — 12 test
- [x] `packages/realtime-client` test pass (146, +12 mới); `conversation-session.spec.ts`
      (790 dòng) **không sửa** — chứng minh `ConversationSession` chưa bị đụng
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh
- [ ] **CHƯA LÀM — Kiểm tra thủ công `/translate/live`.** Cần api + 2 sidecar +
      khoá Gemini thật + micro. Đây là khoảng trống kiểm chứng còn lại của phase này.
      (`ak plan check` tick tất cả checkbox trong file; ô này bị bỏ tick lại bằng tay.)

**Hai đích đã sửa vì viết sai:**

1. _"Không còn `new AudioContext` / `getUserMedia` / `AudioWorkletNode`"_ — sai.
   Hook anh em `use-streaming-translate.ts:101-102` **cũng** gọi đúng ba thứ đó,
   dưới dạng factory được inject vào `ConversationSessionDeps`. Đó là quy ước của
   repo, không phải mùi code. Cái phải biến mất là **điều phối**, và nó đã biến mất.
2. _"Hook ≤ 90 dòng code"_ — không đạt: **132** (từ 142). Khối deps chiếm ~14 dòng,
   đúng như hook anh em. Phần còn lại là 7 `useState`, wiring callback, và
   `start`/`stop`/`useEffect` — đều là việc của một React hook.

`microphone-graph.ts`: 97 dòng tổng / 55 dòng code.

**Quyết định của tác giả cũ đã được tôn trọng.** Doc comment cũ ở hook ghi: mic
nối tay ở đây vì `ConversationSession` gắn mic với gate, mượn nó là mượn luôn gate.
`MicrophoneGraph` **không** vi phạm điều đó — nó là mic không kèm chính sách. Comment
đã cập nhật để phản ánh đúng hiện trạng thay vì để lại một câu đã sai.

## Risk Assessment

Rủi ro cao nhất trong nhóm A: `apps/web` có 1 spec, nên regression ở đây **không
có test nào bắt được** cho tới khi mở trang.

Giảm thiểu: hành vi được chuyển **vào** workspace có harness, nên test là sản
phẩm phụ của việc di chuyển chứ không phải việc phải làm thêm. Đây chính là lý do
chọn "di chuyển" thay vì "viết characterization test cho hook" — jsdom + giả lập
AudioWorklet vừa đắt vừa giòn, và sẽ đóng băng đúng cái hình dạng sắp thay đổi.

**Giả định có thể sai:** `FakeAudioContext` khớp API mà `MicrophoneGraph` cần
(`createMediaStreamSource`, `audioWorklet.addModule`).
**Tín hiệu:** spec không biên dịch được, hoặc phải thêm phương thức vào fake.
**Phản ứng đã định trước:** mở rộng `fake-audio-context.ts` là chấp nhận được —
nó là test double, không phải mã sản phẩm. Nhưng nếu phải thêm quá ~20 dòng thì
dừng lại và xem lại ranh giới của `MicrophoneGraph`.

**Giả định thứ hai:** `WORKLET_URL` phân giải được từ trong package thay vì từ app.
**Tín hiệu:** worklet 404 lúc chạy — typecheck sẽ **không** bắt được.
**Phản ứng:** giữ `workletUrl` là **dependency được inject** (như
`ConversationSessionDeps.workletUrl` đang làm), app vẫn là nơi cung cấp URL.
Đây là lý do nó nằm trong deps chứ không hard-code trong lớp.
