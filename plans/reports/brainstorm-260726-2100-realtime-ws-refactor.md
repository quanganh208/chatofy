# Brainstorm — refactor đường realtime WebSocket

Date: 2026-07-26 · Branch: `main` · Status: contract accepted, chờ plan

## Contract

**Outcome.** Đường realtime (api WS + web client + shared contract) đứng đúng chuẩn
OOP của repo: state machine 740 LOC tách thành object có trách nhiệm rõ, không còn
hàm/getter/type/file không consumer, không còn 2 đường teardown song song, client
lifecycle testable như policy phía api đã làm. Hành vi trên dây và latency đo được
giữ nguyên tuyệt đối.

**Constraints.**

- Không đổi contract trên dây: `clientEventSchema` / `serverEventSchema` giữ nguyên
  shape, thứ tự event mỗi lượt giữ nguyên. Chỉ bỏ type alias không ai import.
- `TranslationSessionService` giữ nguyên public API (`start` / `pushFrame` /
  `speculate` / `end` / `disconnect` + export `StreamSocket`) — gateway và spec 904
  dòng là lưới an toàn, không viết lại assertion.
- Mọi quyết định đã có số đo giữ nguyên: hangover 500ms, PROBABLE_END 150ms, 3 ladder
  model, cadence partial 300ms, window 8s, MAX_SPECULATIONS_PER_TURN=4.
- Baseline phải xanh y như trước: api 173 tests/17 suites, web 32 tests, e2e
  `translate-ws-stream`, `pnpm typecheck`, `pnpm lint`,
  `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip`.
- Không đụng REST path (`translateTurn`) — nó là baseline đo latency.

**Non-goals.**

- Gộp `speculate()` với live-partial translate. Có số đo bảo vệ (870ms khi head-start
  còn hiệu lực vs 1760ms khi mất) — đổi là đổi hành vi, không phải refactor.
- Đổi ngưỡng / ladder model / thay `SpeechGate` bằng detector học (Silero).
- Hiện thực realtime cho mobile.
- Ghi transcript xuống DB, auth cho socket.
- Viết lại `docs/development-journey.md` — đó là bản ghi lịch sử (có line number cũ),
  không phải doc evergreen.

**Acceptance criteria.**

1. api 173 tests / 17 suites + web tests xanh; assertion cũ còn nguyên ý nghĩa (được
   phép chia spec theo class mới, không được phép nới lỏng).
2. Spec mới cho `ConversationSession` phủ 3 bất biến: mic chỉ mở lại khi turn ĐÃ end
   server-side VÀ playback đã cạn; `start()` bị stale thì nhả mic thay vì publish; teardown
   giải phóng socket/stream/context/pump đúng một lần.
3. `TurnMetrics` có cột `liveTranslations`, lấy từ `LiveTranslationTrigger.spentCount`.
4. Không file nào trong tập sửa vượt 200 LOC (trừ file `*.spec.ts`).
5. `pnpm typecheck` + `pnpm lint` + `pnpm knip` exit 0.
6. `capture-pump.replay.spec.ts` và `pipeline-latency.measure.spec.ts` vẫn pass ngưỡng
   latency của chúng.
7. `docs/system-architecture.md` + `docs/codebase-summary.md` khớp cây file mới.

## Bằng chứng (đã grep xác nhận, không suy đoán)

Dead — 0 consumer:

| Vị trí                                                    | Thứ chết                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/audio/speech-gate.ts:88,93`                 | `isSpeaking`, `level` (getter `level` trả noiseFloor — tên sai nghĩa)                                                  |
| `apps/web/src/audio/capture-pump.ts:146,232`              | `currentState`, `blockDurationMs`                                                                                      |
| `packages/types/src/events/index.ts`                      | 11 type alias per-event; chỉ `ClientEvent`/`ServerEvent` được dùng                                                     |
| `apps/mobile/src/clients/ws-client.{interface,native}.ts` | scaffold generic WS tự khai "no consumers yet"                                                                         |
| `capture-pump.ts` + `use-streaming-translate.ts`          | nhánh `fullDuplex`/`echoGate`/`onEchoHeard`/`echoHeard`/`FULL_DUPLEX_ALLOWED` — không caller nào bật, không UI nào đọc |
| `live-translation-trigger.ts:109`                         | `spentCount` chỉ spec của chính nó đọc; doc hứa "để record cost" nhưng metrics chưa ghi                                |

knip không bắt được nhóm này: nó không soi class member, và `packages/types` là library
workspace không có entry nên export coi như public.

Lệch chuẩn OOP:

- `translation-session.service.ts` 740 LOC = 3.7× guideline 200 LOC của repo.
  `StreamSession` là record vô hồn; hầu hết private method nhận `(socket, session)` —
  dấu hiệu cặp đó chính là object.
- `end()` giữ 7 biến `let` timing + inline type 11 field + gọi `recordTurn` trùng ở cả
  try và catch.
- `bytesPerSecond` lặp 3 chỗ; `sampleRate ?? 16000` lặp 4 chỗ dù sau frame đầu chắc chắn
  non-null — field nullable rò bất định ra mọi consumer.
- `assembleWav` concat toàn bộ buffer mỗi tick partial (300ms, tới 60s ≈ 1.9MB) rồi bỏ
  hết trừ 8s cuối.
- `pushFrame`: 6 khối `if` validate nối tiếp, mỗi khối tự emit lỗi.
- 3 hằng ladder model là policy config nằm trong state machine.
- Web hook: 12 `useRef`, `start()` ~100 dòng tự wiring, guard `runId` thủ công,
  `abandon()` trùng một phần `stop()` (2 đường teardown có thể drift), `sendBlock` bị copy
  nguyên trong nhánh `server.session.ready`.

## Hướng đã chọn

Scope: cả API + web + types + mobile scaffold. Xoá thẳng cả 3 nhóm dead code; `spentCount`
nối vào metrics thay vì xoá. Client: tách `ConversationSession` **kèm test**.

**apps/api/src/modules/translate/session/** (mới)

| File                          | Trách nhiệm                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn-session.ts`             | state + behavior một lượt: phase, sequence, speculation, 2 scheduler, `speakerRole`, `toSegment()`                                                       |
| `turn-audio.ts`               | value object; chỉ tạo được khi frame đầu chốt sampleRate ⇒ non-nullable. `append`, `byteLength`, `bytesPerSecond`, `toWav(fromByte)` với concat tăng dần |
| `event-channel.ts`            | bọc `StreamSocket`: `emit`/`fail`/`endSession`, sở hữu JSON + swallow + log                                                                              |
| `turn-timeline.ts`            | stamp endpoint/translated/firstAudio/lastAudio → `TurnMetrics`; `end()` record một lần trong `finally`                                                   |
| `session-registry.ts`         | chủ `Map<StreamSocket, TurnSession>`: `open`/`get`/`close`/`holds`                                                                                       |
| `translation-model-policy.ts` | một object gom 3 ladder + cap speculation                                                                                                                |

`translation-session.service.ts` co lại còn orchestration (~150–200 LOC), public API y nguyên.

**apps/web/src/conversation/conversation-session.ts** (mới) — class TS thuần sở hữu
AudioContext / MediaStream / worklet node / `TranslateSocket` / `CapturePump` /
`PcmPlaybackQueue`; một đường teardown duy nhất; dependency được inject qua factory
(getUserMedia, AudioContext, socket) để vitest chạy không cần browser. Hook co lại còn
subscribe + `useReducer` + trả contract hiện tại (bỏ `echoHeard`, bỏ option `fullDuplex`).

## Rủi ro

1. Spec 904 dòng bám vào public method + fake socket ⇒ đa phần an toàn, nhưng chia spec theo
   class mới dễ làm rơi assertion. Chia trước, xanh trước, refactor sau.
2. api jest từng flip working↔broken theo lần install (hoisted-linker dual-jest). Chạy
   baseline trước khi sửa dòng đầu tiên.
3. Hook client hôm nay 0 test — đây đúng là nơi repo từng ship 2 defect vô hình. Viết test
   đặc tả cho `ConversationSession` trước khi rút logic ra khỏi hook.
4. Xoá export ở `packages/types` là đổi public contract của package; đã grep 0 consumer nên
   an toàn, nhưng knip sẽ không bắt hồi quy nhóm này về sau.

## Câu hỏi còn mở

- `TurnMetrics.liveTranslations` là cột mới trong JSONL. Có file phân tích/harness nào đang
  đọc schema cũ theo vị trí cột không? (`benchmarks/realtime/` chỉ sinh fixture, chưa thấy
  reader — cần xác nhận khi plan.)
- `docs/system-architecture.md:413` liệt kê cây file theo tên; sau khi thêm thư mục
  `session/` cần chốt là liệt kê đủ 6 file mới hay chỉ trỏ tới thư mục.
