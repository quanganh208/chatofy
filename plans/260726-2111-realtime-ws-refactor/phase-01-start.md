---
title: 'Phase 1: API session objects'
status: done
phase: 1
priority: P1
effort: '1.5d'
dependencies: []
---

# Phase 1: API session objects

## Overview

Tách `translation-session.service.ts` (740 LOC, 5 trách nhiệm) thành 8 module trong `session/`,
service còn lại orchestration. Public API, ctor arity và hành vi trên dây bất biến.

Trước khi tách: **thêm test cho 6 guard hiện không có net nào** (bảng ở `plan.md` §Lưới an toàn).
Bản 1 của phase này coi spec 904 dòng là đủ; red-team đã chứng minh xoá guard mà suite vẫn
xanh ở 6 chỗ.

## Requirements

Functional:

- [ ] Public API giữ nguyên: `start` / `pushFrame` / `speculate` / `end` / `disconnect`
- [ ] **Ctor arity giữ đúng 2** (`pipeline`, `metrics`) — `spec:95` gọi trực tiếp
- [ ] `StreamSocket` vẫn import được từ `services/translation-session.service`
- [ ] Thứ tự và nội dung mọi `ServerEvent` giữ nguyên, kể cả đường lỗi và từng chữ trong message
- [ ] Mọi đường đóng lượt giữ đúng thứ tự "xoá khỏi registry TRƯỚC khi emit `server.session.ended`"
- [ ] Guard `bufferedBytes > 0` giữ đúng semantics — **không** thay bằng "buffer đã cấp phát"
- [ ] `work.catch(() => undefined)` cho speculation vẫn còn, và nằm nơi caller không thể quên

Non-functional:

- [ ] Không file mới nào > 200 LOC
- [ ] `translation-session.service.ts` ≤ **260** LOC ở cuối phase này (≤200 là gate của Phase 2 —
      phase này giữ `end()` và `recordTurn` nguyên hình, cộng lại 125 dòng)
- [ ] `grep -rn "?? 16000" apps/api/src/modules/translate` → rỗng
- [ ] Mọi comment giải thích **số đo HOẶC quyết định an toàn/threat-model** di chuyển verbatim
- [ ] Spec cũ: chỉ thêm dòng, không sửa dòng nào

## Architecture

Hôm nay mọi private method nhận cặp `(socket, session)` — dấu hiệu cặp đó chính là object.

### `session/stream-socket.ts` (~12 LOC)

```ts
export interface StreamSocket {
  send(data: string): void;
}
```

Giữ doc comment `translation-session.service.ts:24-30` verbatim.
Service re-export: `export type { StreamSocket } from '../session/stream-socket';`
3 consumer đang import từ đường cũ: `translate.gateway.ts:13`, `translate.gateway.spec.ts:4`,
`translation-session.service.spec.ts:5`.

### `session/turn-audio.ts` (~80 LOC)

Value object; chỉ construct được khi frame đầu đã chốt sampleRate ⇒ `sampleRate` non-nullable.
Xoá 3 lần `?? 16000` (`:334`, `:368`, `:615`) và 2 bản sao `bytesPerSecond` (`:334`, `:368`).

**Không gộp** `MAX_TURN_BYTES` vào `bytesPerSecond`. Chúng khác semantics: cap tính từ
`MAX_SAMPLE_RATE` của contract, cố ý KHÔNG tính từ rate client báo. Comment `:130-138` giải
thích chính xác điều đó và phải đi theo verbatim — nó là comment threat-model, không phải
comment số đo, nên nằm trong phạm vi giữ đã mở rộng.

```ts
export const INBOUND_CHANNELS = 1;
export const MAX_TURN_SECONDS = 60;
/** Xem comment gốc :130-138 — dẫn xuất từ MAX_SAMPLE_RATE, không từ rate client báo. */
export const MAX_TURN_BYTES = MAX_SAMPLE_RATE * INBOUND_CHANNELS * 2 * MAX_TURN_SECONDS;

export class TurnAudio {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  constructor(readonly sampleRate: number) {}
  get byteLength(): number;
  get isEmpty(): boolean; // bytes === 0
  get bytesPerSecond(): number; // sampleRate * INBOUND_CHANNELS * 2
  secondsAt(byteOffset: number): number;
  wouldExceedCap(incoming: number): boolean;
  append(chunk: Buffer): void;
  toWav(fromByte = 0): Buffer;
}
```

`toWav` giữ đúng hành vi hiện tại (concat toàn bộ rồi `subarray`) — xem non-goals ở `plan.md`.

### `session/event-channel.ts` (~50 LOC)

```ts
export class EventChannel {
  constructor(
    private readonly socket: StreamSocket,
    private readonly logger: Logger,
  ) {}
  emit(event: ServerEvent): void; // JSON.stringify + try/catch + logger.warn
  fail(code: string, message: string): void;
  ended(reason: string): void; // CHỈ emit server.session.ended
}
```

`ended()` cố ý chỉ emit. Việc xoá khỏi registry là của service — xem `close()` bên dưới.
Giữ verbatim comment `:728-738` (vì sao swallow: `ws` báo send-after-close thành error event,
unhandled sẽ giết process).

EventChannel không giữ state lượt nói (chỉ socket + logger), nên `LivePreview` giữ được nó
qua `await` an toàn.

### `session/turn-session.ts` (~160 LOC)

```ts
export type TurnPhase = 'listening' | 'translating';
export interface FrameRejection {
  code: string;
  message: string;
  closesTurn?: boolean;
}

export class TurnSession {
  readonly sessionId = randomUUID();
  private phase: TurnPhase = 'listening';
  private audio: TurnAudio | null = null; // chỗ nullable DUY NHẤT
  private lastSequence = -1;
  private outboundSequence = 0;
  private speculation: Speculation | null = null;
  private speculations = 0;
  readonly partials = new PartialTranscriptScheduler();
  readonly liveTranslation = new LiveTranslationTrigger();

  constructor(readonly direction: TranslationDirection) {}

  get isListening(): boolean;
  get isTranslating(): boolean;
  /** Buffer đã có byte thật. KHÔNG phải "đã cấp phát" — xem ghi chú dưới. */
  get hasBufferedAudio(): boolean; // !!this.audio && !this.audio.isEmpty
  get buffered(): TurnAudio | null;
  get speculationCount(): number;
  get speakerRole(): 'speaker_a' | 'speaker_b';

  acceptFrame(frame: AudioFrame): FrameRejection | null; // 5 luật (xem bảng)
  beginTranslating(): void;
  nextOutboundSequence(): number;
  toSegment(sourceText: string, targetText: string): TranscriptSegment;

  canSpeculate(): boolean;
  startSpeculation(work: Promise<TranslatedTurnText>): void;
  usableSpeculation(): Promise<TranslatedTurnText> | null;
}
```

**`hasBufferedAudio`, không `hasAudio`.** Red-team: `audioFrameSchema.payload` là `z.string()`
không `.min(1)`, và `sampleRate` được chốt (`:237`) trước khi byte nào được append. Nên một
frame payload rỗng làm `audio !== null` mà `byteLength === 0`. Nếu guard là "audio != null"
thì `speculate()` sẽ đốt 4 request Gemini trên WAV chỉ có header, và `end()` mất đường
`no_audio`. Guard phải là **có byte thật**, đúng như `!session.bufferedBytes` hôm nay
(`:395`, `:436`).

**`startSpeculation` phải tự swallow:**

```ts
startSpeculation(work: Promise<TranslatedTurnText>): void {
  // Comment :414-417 verbatim — mọi guess trừ cái cuối bị bỏ không await, và một
  // rejection không ai quan sát sẽ giết process.
  work.catch(() => undefined);
  this.speculation = { atBytes: this.audio!.byteLength, work, startedAt: Date.now() };
  this.speculations += 1;
}
```

Đặt trong `startSpeculation` chứ không để caller gọi, vì caller quên là mất process.

**Bảng luật reject frame — 7 luật, 2 chủ sở hữu.** Bản 1 ghi "6 luật" và bỏ sót `session_busy`:

| #   | Luật                      | code                | Chủ                       | Đóng lượt? | Có test cũ?               |
| --- | ------------------------- | ------------------- | ------------------------- | ---------- | ------------------------- |
| 1   | chưa có session           | `no_active_session` | service (registry lookup) | không      | `spec:695`                |
| 2   | `phase !== 'listening'`   | `session_busy`      | `TurnSession`             | không      | **KHÔNG** → test mới      |
| 3   | sessionId khác            | `frame_rejected`    | `TurnSession`             | không      | `spec:706`                |
| 4   | encoding ≠ pcm16          | `unsupported_audio` | `TurnSession`             | không      | **KHÔNG** → test mới      |
| 5   | sequence không tiến       | `frame_rejected`    | `TurnSession`             | không      | `spec:719`, gap ok `:731` |
| 6   | sample rate đổi giữa lượt | `frame_rejected`    | `TurnSession`             | không      | `spec:741`                |
| 7   | vượt cap                  | `turn_too_long`     | `TurnSession`             | **CÓ**     | **KHÔNG** → test mới      |

Luật 1 không thể nằm trong `acceptFrame` (chưa có object để gọi). `acceptFrame` sở hữu 2-7.

`closesTurn: true` (chỉ luật 7) phải dẫn tới **cùng hai bước như `close()` hôm nay**:
`registry.close(socket)` rồi `channel.ended(reason)`. Bản 1 chỉ ghi `channel.ended()` → server
vẫn giữ lượt 5.76MB và client vẫn `end()` được để chạy trọn pipeline.

### `session/session-registry.ts` (~40 LOC)

```ts
export class SessionRegistry {
  private readonly sessions = new Map<StreamSocket, TurnSession>();
  get(socket): TurnSession | undefined;
  open(socket, session: TurnSession): void;
  close(socket): TurnSession | undefined;
  holds(socket, session: TurnSession): boolean; // thay isActive()
}
```

Lifetime giữ nguyên: process-global trong service singleton, evict qua `disconnect`/`close`.
Không phải leak mới.

### `session/translation-model-policy.ts` (~60 LOC)

Gom 3 ladder + `MAX_SPECULATIONS_PER_TURN`. **Khối comment `:71-118` đi theo verbatim** —
đó là lý do đo được cho từng ladder. Comment cap speculation `:400-405` (threat-model) cũng
đi theo.

```ts
// KHÔNG dùng `as const`: pipeline nhận `models?: string[]` (pipeline-translator.service.ts:36).
// readonly tuple sẽ lỗi TS2322/TS4104 tại call site.
export const TRANSLATION_MODELS: Record<'final' | 'speculation' | 'live', string[]> = {
  final: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  speculation: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  live: ['gemini-3.5-flash-lite'],
};
export const MAX_SPECULATIONS_PER_TURN = 4;
```

### `session/outbound-audio-framer.ts` (~70 LOC)

```ts
export const OUTBOUND_FRAME_MS = 200;
export type FramingResult =
  | { ok: true; sampleRate: number; frames: Iterable<Buffer> } // lazy
  | { ok: false; detail: string };
export function frameSynthesizedWav(audio: Buffer): FramingResult;
```

`frames` là generator/iterable trả `Buffer` slice, **không** phải `string[]` base64 dựng sẵn:
hôm nay `slice.toString('base64')` chạy trong vòng emit, một frame một lúc (`:664-677`).
Dựng sẵn toàn bộ base64 (1.33×) cộng buffer PCM còn sống làm peak allocation lên ~2.33× mỗi
clause, trên đường không auth. Service base64 hoá tại chỗ emit như hiện tại.

`ok: false` khi `decodeWavToPcm16` ném. Service giữ nguyên `logger.error` + message
`fail('unsupported_audio', ...)` từng chữ.

### `session/live-preview.ts` (~120 LOC)

`readPartial` + `translateLive`, cả hai fire-and-forget.

```ts
export class LivePreview {
  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly logger: Logger, // logger CỦA SERVICE, để log context không đổi
  ) {}
  onAudio(session: TurnSession, channel: EventChannel, stillCurrent: () => boolean): void;
}
```

**Hai bộ guard KHÁC NHAU, cấm dùng chung helper:**

| Nửa             | Guard sau await                                                                                | file:line                      |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `readPartial`   | `stillCurrent()` → `phase === 'listening'` → `partials.shouldEmit(atBytes)` → `text.trim()`    | `:294`, `:295`, `:296`, `:297` |
| `translateLive` | `stillCurrent()` → `phase === 'listening'`. **Hết.** Không `shouldEmit`, không check text rỗng | `:347`, `:350`                 |

Bản 1 ghi "4 lớp guard" như thuộc tính của cả `LivePreview` → mời gọi viết một `canEmit()`
dùng chung. Làm vậy sẽ **tắt live translation 100% lượt**: `readPartial` gọi
`markEmitted(atBytes)` ở `:299` **trước** khi gọi `translateLive(..., atBytes)` ở `:306`, và
`shouldEmit(b)` là `b > emittedAtBytes`, nên trong `translateLive` nó luôn là `atBytes > atBytes`
= false. Chi phí vẫn bị trừ (`markStarted` đã tăng `spent`), tức Phase 2 sẽ báo tiền cho một
tính năng không phát gì.

Viết comment ngay tại chỗ nói rõ sự bất đối xứng này là có chủ ý, vì giờ hai nửa nằm chung class.
Giữ verbatim 2 khối comment `:265-277` và `:316-327`.

### Service sau refactor (~220 LOC ở cuối phase này)

`start` / `pushFrame` / `speculate` / `end` / `streamClauses` / `recordTurn` / `disconnect`

- `channelFor(socket)` + `close(socket, reason)`.

`close(socket, reason)` giữ nguyên như một private helper của service:

```ts
private close(socket: StreamSocket, reason: string): void {
  this.registry.close(socket);          // xoá TRƯỚC
  this.channelFor(socket).ended(reason); // rồi mới emit
}
```

`streamClauses` ở lại service và vẫn cần guard `holds()` mỗi vòng (`:586`). Vì vậy tiêu chí
"grep `socket: StreamSocket, session` → 0" của bản 1 bị **bỏ** — nó cấm đúng signature mà
`streamClauses` cần. Thay bằng: không method nào nhận cặp đó _để đọc state lượt nói_; truyền
`socket` cho việc emit là hợp lệ.

## Related Code Files

- Create: `session/{stream-socket,turn-audio,event-channel,turn-session,session-registry,translation-model-policy,outbound-audio-framer,live-preview}.ts`
- Create: `session/{turn-audio,event-channel,outbound-audio-framer,turn-session}.spec.ts`
- Modify: `services/translation-session.service.ts`
- Modify (CHỈ THÊM): `services/translation-session.service.spec.ts` — 6 test mới
- Do NOT touch: `translate.gateway.ts`, `translate.gateway.spec.ts`,
  `test/translate-ws-stream.e2e-spec.ts`, `audio/*.ts`, `translate.module.ts`

## Implementation Steps

Checkpoint: `git tag plan-p1-start` trước bước 1. Commit sau **từng** bước 10-17.

Tests Before — 8 test mới vào `translation-session.service.spec.ts`, mỗi cái phải được chứng
minh là bắt được lỗi bằng cách xoá tạm guard tương ứng rồi thấy nó đỏ, rồi hoàn nguyên:

1. Chạy `cd apps/api && pnpm test` — ghi lại 17 suites / 173 tests. Nếu jest hỏng vì môi
   trường (dual-jest hoisted-linker) thì **dừng và báo**.
2. Test cap: đẩy frame vượt `MAX_TURN_BYTES` → `server.error{turn_too_long}` +
   `server.session.ended`, **và** `end()` sau đó trả `no_active_session` (chứng minh session
   đã bị xoá khỏi registry). Đây là test duy nhất bảo vệ finding Critical #2.
3. Test `session_busy` trên `pushFrame`: `end()` (phase → translating), rồi `pushFrame` →
   `server.error{session_busy}`, và `transcribe` không được gọi thêm.
4. Test `unsupported_audio`: frame `encoding: 'opus'` → `server.error{unsupported_audio}`.
5. Test disconnect giữa lúc partial decode đang bay → không có `server.transcript.partial`
   nào sau đó (guard `:294`).
6. Test disconnect giữa lúc live translation đang bay → không có `server.translation.partial`
   (guard `:347`).
7. Test disconnect giữa hai clause → `synthesize` không được gọi cho clause thứ hai
   (guard `:586`).
8. Test frame payload rỗng: `payload: ''` rồi `speculate()` → `transcribeAndTranslate` không
   được gọi; rồi `end()` → `server.error{no_audio}` (guard `hasBufferedAudio`).
9. Test hai lượt trên một socket: `start/frame/end` xong, `start` lại → `server.session.ready`
   thứ hai, không có `session_busy`. Repo hiện không có test nào chạy 2 lượt.

Refactor — thứ tự này compile được ở từng bước (bản 1 sai: bước 6 dùng registry của bước 7):

10. `stream-socket.ts` + re-export. Test → xanh. Commit.
11. `translation-model-policy.ts` (không `as const`), di chuyển comment verbatim. Test → xanh. Commit.
12. `session-registry.ts` — thay `this.sessions` và `isActive` → `registry.holds`. Test → xanh. Commit.
13. `turn-audio.ts` — service dùng `session.audio`; xoá `assembleWav`, `partialWindowStart`.
    Test → xanh. Commit.
14. `event-channel.ts` — `channelFor(socket)`, `close()` thành 2 bước theo đúng thứ tự cũ.
    Test → xanh. Commit.
15. `turn-session.ts` — `StreamSession` interface → class; gom luật 2-7 vào `acceptFrame`;
    `startSpeculation` tự swallow; `hasBufferedAudio`. Test → xanh. Commit.
16. `outbound-audio-framer.ts` (lazy frames). Test → xanh. Commit.
17. `live-preview.ts` — dựng trong **thân** constructor service, truyền logger của service,
    hai bộ guard riêng. Test → xanh. Commit.

Tests After:

18. `session/turn-audio.spec.ts`: `bytesPerSecond`; `toWav(0)` round-trip qua `decodeWavToPcm16`;
    `toWav(fromByte)` cắt đúng và luôn cắt ở biên sample chẵn; `wouldExceedCap` ở biên;
    `isEmpty` sau khi append buffer 0 byte.
19. `session/event-channel.spec.ts`: `send` ném → không propagate, có log warn.
20. `session/outbound-audio-framer.spec.ts`: WAV 1s@24kHz → 5 frame; input không WAV → `ok:false`;
    `frames` là lazy (kéo 1 phần tử không materialize hết).
21. `session/turn-session.spec.ts`: bảng 6 luật của `acceptFrame` + gap sequence hợp lệ +
    `startSpeculation` với promise reject → không có unhandledRejection.

Regression Gate:

22. `cd apps/api && pnpm test` → **21 suites**, 173 + 8 (service) + N (unit mới) test, tất cả xanh
23. `git diff --stat apps/api/src/modules/translate/services/translation-session.service.spec.ts`
    → chỉ dòng thêm. `git diff` không có dòng `-` nào ngoài context.
24. `cd apps/api && pnpm typecheck && pnpm lint`
25. `wc -l session/*.ts services/translation-session.service.ts` → file mới ≤200, service ≤260
26. Gate comment cơ học — số lần xuất hiện trước/sau phải bằng nhau:
    `git show plan-p1-start:apps/api/src/modules/translate/services/translation-session.service.ts | grep -c -e "870ms" -e "not a cap" -e "unauthenticated" -e "take the process down"`
    so với `grep -rc` các chuỗi đó trong `session/*.ts` + service.

## Success Criteria

- [ ] 8 file mới trong `session/`, mỗi file ≤ 200 LOC, mỗi file một trách nhiệm
- [ ] `translation-session.service.ts` ≤ 260 LOC
- [ ] Ctor vẫn 2 tham số; `spec:95` không sửa
- [ ] 8 test mới pass; 6 test guard đã được chứng minh bắt lỗi bằng xoá-tạm-guard (2 test còn
      lại là cấu trúc: frame payload rỗng, hai lượt một socket)
- [ ] 40 assertion cũ nguyên văn; diff spec chỉ có dòng thêm
- [ ] `translate.gateway.spec.ts` + e2e xanh, diff = 0
- [ ] 4 spec unit mới pass
- [ ] `grep -rn "?? 16000" apps/api/src/modules/translate` → rỗng
- [ ] Gate comment ở bước 26 khớp
- [ ] typecheck + lint exit 0

## Risk Assessment

| Rủi ro                                                                                                  | Giảm thiểu                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Xoá `work.catch`** → unhandledRejection giết process trên đường phổ biến nhất                         | Nằm trong `startSpeculation`, caller không thể quên; test ở bước 21 |
| **Dùng chung `canEmit`** → live translation tắt 100% lượt, không có gì đỏ                               | Bảng 2 bộ guard riêng + comment tại chỗ; cấm helper dùng chung      |
| **`closesTurn` mất `registry.close`** → giữ buffer 5.76MB + chạy pipeline sau khi đã "ended"            | Test ở bước 2 assert `end()` sau đó là `no_active_session`          |
| **`hasAudio` thay `bufferedBytes > 0`** → đốt 4 request Gemini trên WAV rỗng                            | Đặt tên `hasBufferedAudio` + test ở bước 8                          |
| Mất một message lỗi đúng từng chữ → test `rejects…` đỏ                                                  | Copy message, không paraphrase                                      |
| Mất comment số đo/threat-model                                                                          | Gate cơ học bước 26, so với tag `plan-p1-start`                     |
| Dừng giữa 8 bước refactor → cây không compile                                                           | Tag + commit sau từng bước; revert target là bước gần nhất          |
| `LivePreview` dùng field initializer → `this.pipeline === undefined` (ES2022 `useDefineForClassFields`) | Dựng trong thân constructor; ghi rõ ở bước 17                       |

## Kết quả — 2026-07-26

Baseline `plan-p1-start` = `4d8f273`. 10 commit, mỗi bước refactor một commit.

| Gate                    | Đích                       | Thực tế                                                                                            |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api` jest         | 21 suites, 173+ test       | **21 suites / 224 test**, xanh                                                                     |
| Diff spec cũ            | chỉ dòng `+`               | **+203 / −0**                                                                                      |
| 8 test guard mới        | mỗi cái chứng minh bắt lỗi | **8/8 đỏ khi xoá guard tương ứng**, xem bảng dưới                                                  |
| File mới ≤200 LOC       | ≤200                       | lớn nhất `turn-session.ts` **117 code / 173 tổng**                                                 |
| Service ≤260 LOC        | ≤260                       | **249 code / 353 tổng** — xem §Cách đo LOC ở `plan.md`                                             |
| `?? 16000`              | 0                          | **0**                                                                                              |
| Gate comment            | trước = sau                | `870ms` 1=1, `not a cap` 1=1, `unauthenticated` 1=1, `take the process down` 3→5 (thêm, không mất) |
| typecheck / lint / knip | exit 0                     | **0 / 0 lỗi (2 warning có sẵn ở `elevenlabs-providers.spec.ts`) / 0**                              |
| File cấm chạm           | diff = 0                   | gateway, gateway.spec, e2e, `audio/*`, `translate.module.ts` — **diff rỗng**                       |

### Chứng minh 8 test bắt được lỗi

Harness xoá từng guard rồi chạy đúng test tương ứng; **cả 8 đều đỏ**, rồi hoàn nguyên:

| Guard bị xoá                               | Test đỏ                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `close()` trên đường `turn_too_long`       | `ends an over-long turn AND forgets it`                           |
| `phase !== 'listening'` trong `pushFrame`  | `refuses a frame that arrives after the turn started translating` |
| `encoding !== 'pcm16'`                     | `refuses a frame in an encoding this path cannot decode`          |
| `isActive` sau await trong `readPartial`   | `emits no partial transcript for a client that left mid-decode`   |
| `isActive` sau await trong `translateLive` | `emits no live translation for a client that left mid-request`    |
| `isActive` mỗi vòng `streamClauses`        | `stops synthesizing clauses once the client has gone`             |
| `!bufferedBytes` trong `speculate()`       | `treats a frame carrying no bytes as no audio at all`             |
| `!bufferedBytes` trong `end()`             | `treats a frame carrying no bytes as no audio at all`             |

### Lệch so với plan — và lý do

1. **9 module, không phải 8.** Thêm `session/turn-speculation.ts`. `turn-session.ts` cán mốc
   206 dòng tổng khi gom cả state đoán trước; tách phần "tiêu quota" ra là ranh giới thật
   (mọi thứ trong đó là quyết định chi tiêu, không phải state lượt nói) và đưa `turn-session`
   về 173.
2. **`emitSynthesizedAudio` không ở lại service.** Thành `pushSynthesizedWav` trong
   `outbound-audio-framer.ts`, gọi thẳng trong `streamClauses`. Bản plan liệt kê surface cuối
   của service mà không có method này; và nếu để lại thì gate LOC của Phase 2 không với tới.
3. **`translation-model-policy.ts` giữ 3 const có tên**, không gộp thành record
   `TRANSLATION_MODELS`. Khối comment `:82-98` giải thích _việc tách hai ladder_ — nó thuộc về
   cặp const đó, gộp vào record sẽ đẩy comment ra xa thứ nó giải thích. Yêu cầu "không `as const`"
   vẫn giữ: cả ba khai báo `: string[]`.
4. **Thứ tự bước 10-17 đổi.** Plan để `session-registry` (bước 12) trước `turn-session`
   (bước 15), nhưng registry cần kiểu `TurnSession` để khai báo `Map` — bước 12 không compile
   được. Thứ tự đã chạy: stream-socket → model-policy → turn-audio → event-channel →
   turn-session → session-registry → framer → live-preview. Mỗi bước compile + test xanh.
5. **`startSpeculation(atBytes, work)` nhận `atBytes`** thay vì tự đọc `this.audio`. Đọc nội bộ
   thì phải có `?? 0` hoặc `!` — đúng loại default mà Goal 4 vừa xoá đi.
6. **Bỏ field `Speculation.startedAt`.** Được gán ở `:421` cũ, không nơi nào đọc. Phase 2
   (`TurnTimeline`) cũng không dùng.

### Code review — 2026-07-26

`code-reviewer` đối chiếu từng dòng với bản 740 dòng ở `plan-p1-start`.
**Kết luận: không đổi hành vi trên dây.** Cả 6 bất biến đều giữ (thứ tự event, từng chữ
message, xoá registry trước `ended`, thứ tự 6 luật reject, cách tính `TurnMetrics`, đánh số
`sequence` outbound), và cả 6 hazard được nêu tên đều xử lý đúng. Reviewer tự compile repro
`tsc --target ES2022` để xác nhận parameter property gán **sau** field initializer — tức chỗ
dựng `LivePreview` trong thân constructor là bắt buộc, không phải trang trí.

7 finding, không cái nào chặn. Đã sửa 4:

| Finding                                                                                                | Sev    | Xử lý                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mọi message lỗi service sở hữu đều không có assert nào                                                 | High   | **Sửa.** `turn-session.spec.ts` assert `toEqual({code, message})`; chứng minh bằng cách đổi chữ một message → đỏ                            |
| `frameSynthesizedWav` chỉ là alias một dòng, không consumer production                                 | Medium | **Sửa.** Xoá alias, đổi tên `frameOrExplain` vào chỗ đó                                                                                     |
| `event-channel.spec.ts` "keeps sending after one event was dropped" vẫn xanh nếu channel ngừng gửi hẳn | Medium | **Sửa.** Fake ghi lại event thành công; assert event thứ hai thật sự tới                                                                    |
| `FramingResult.frames: Iterable` trong khi generator chỉ đi được một lần                               | Low    | **Sửa.** Đổi thành `IterableIterator`                                                                                                       |
| `{@link MAX_SPECULATIONS_PER_TURN}` gãy sau khi const chuyển file                                      | Low    | **Sửa.** Trỏ thẳng tên file                                                                                                                 |
| `channelFor` cấp phát `EventChannel` + closure mỗi frame vào                                           | Low    | **Không sửa.** Là tối ưu, luật repo là đo trước. Ghi vào Còn nợ                                                                             |
| 3 mảng model export dạng `string[]` mutable                                                            | Low    | **Không sửa.** `Object.freeze` trả `readonly string[]`, gãy đúng call site `models?: string[]` mà plan đã cảnh báo ở mục "không `as const`" |

Sau khi sửa: 21 suites / 224 test xanh, typecheck + lint + knip exit 0, service 249 dòng code.

### Còn nợ

- Gate LOC của service đo theo dòng tổng vẫn trượt (353 > 260). Đã chốt đo theo dòng code
  (249) — quyết định của user, ghi ở `plan.md` §Cách đo LOC.
- `channelFor` cấp phát một `EventChannel` + một closure `stillCurrent` mỗi frame vào, kể cả
  phần lớn frame thoát ngay ở `shouldStart`. Muốn bỏ thì memo bằng
  `WeakMap<StreamSocket, EventChannel>`. Chưa đo, nên chưa làm.
- Đường `unsupported_audio` giữa chừng vẫn ghi `completed: true` và đóng với reason
  `'completed'` sau khi đã emit `server.error` — `streamClauses` `break` chứ không ném. Y như
  bản cũ (`old:502`), không phải hồi quy. Reviewer hỏi đây là cố ý hay wart; **chưa trả lời.**
