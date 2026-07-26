# Báo cáo — realtime-ws-refactor

- Plan: `plans/260726-2111-realtime-ws-refactor/`
- Ngày: 2026-07-26
- Baseline: `4d8f273` (tag `plan-p1-start`)
- Chế độ: `/ak-cook --auto` (Phase 1 chạy trước ở chế độ có checkpoint người dùng)

## Kết luận

5/5 phase xong. Hành vi trên dây không đổi — code-reviewer đối chiếu từng dòng với bản 740
dòng và xác nhận cả 6 bất biến. Mọi file không phải spec ≤200 dòng code.

Hai việc **chưa làm được bằng máy**, ghi rõ ở cuối.

## LOC trước / sau

| File                                           | Trước | Sau (code) | Sau (tổng) |
| ---------------------------------------------- | ----- | ---------- | ---------- |
| `services/translation-session.service.ts`      | 740   | **196**    | 302        |
| `session/turn-session.ts`                      | —     | 117        | 173        |
| `session/live-preview.ts`                      | —     | 88         | 143        |
| `session/outbound-audio-framer.ts`             | —     | 58         | 103        |
| `session/turn-timeline.ts`                     | —     | 55         | 88         |
| `session/turn-audio.ts`                        | —     | 38         | 89         |
| `session/turn-speculation.ts`                  | —     | 27         | 66         |
| `session/event-channel.ts`                     | —     | 24         | 50         |
| `session/session-registry.ts`                  | —     | 19         | 37         |
| `session/translation-model-policy.ts`          | —     | 10         | 64         |
| `session/stream-socket.ts`                     | —     | 3          | 10         |
| `services/turn-metrics.recorder.ts`            | 95    | 55         | 106        |
| `web/src/conversation/conversation-session.ts` | —     | **199**    | 306        |
| `web/src/conversation/fake-audio-context.ts`   | —     | 120        | 170        |
| `web/src/hooks/use-streaming-translate.ts`     | 349   | **82**     | 136        |
| `web/src/conversation/conversation-status.ts`  | —     | 2          | 11         |

LOC đếm theo dòng code (bỏ trắng + comment) — quyết định của user, lý do ở `plan.md`
§Cách đo LOC. Ngưỡng 200 giữ nguyên; không file nào vượt.

## Đã xoá

| Thứ                                                               | Ở đâu                                            |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `SpeechGate.isSpeaking`, `SpeechGate.level`                       | `apps/web/src/audio/speech-gate.ts`              |
| `CapturePump.currentState`, `CapturePump.blockDurationMs`         | `apps/web/src/audio/capture-pump.ts`             |
| Field chết `blockSamples` (hệ quả của việc xoá `blockDurationMs`) | `apps/web/src/audio/capture-pump.ts`             |
| 11 type alias per-event                                           | `packages/types/src/events/{ws-events,index}.ts` |
| `ws-client.interface.ts`, `ws-client.native.ts`                   | `apps/mobile/src/clients/`                       |
| `export type { ConversationStatus }` (shim knip bắt được)         | `apps/web/src/hooks/use-streaming-translate.ts`  |
| `recordTurn` + inline type 11 field                               | `services/translation-session.service.ts`        |
| `Speculation.startedAt` (gán, không ai đọc)                       | `services/translation-session.service.ts`        |
| `TranslateSocket.isOpen` → `private`                              | `apps/web/src/clients/translate-socket.ts`       |

**Giữ có chủ ý:** `fullDuplex`, `echoGate`, `onEchoHeard`, `echoHeard`,
`StreamingTranslateOptions`, `FULL_DUPLEX_ALLOWED` — dụng cụ cho phép đo AEC mà
`docs/development-journey.md:799-816` ghi là việc kỹ thuật mở duy nhất.

## Guard mới có test — và cách đã chứng minh chúng bắt lỗi

Quy tắc chung: test xanh trên code hiện tại **không chứng minh gì**. Mỗi bất biến đều bị phá
tạm rồi chạy đúng test của nó, phải thấy đỏ, rồi hoàn nguyên.

### API — 8 guard (Phase 1) + 1 (Phase 2)

| Guard bị xoá                                | Test đỏ                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `close()` trên đường `turn_too_long`        | `ends an over-long turn AND forgets it`                                                                   |
| `phase !== 'listening'` trong `pushFrame`   | `refuses a frame that arrives after the turn started translating`                                         |
| `encoding !== 'pcm16'`                      | `refuses a frame in an encoding this path cannot decode`                                                  |
| `isActive` sau await trong `readPartial`    | `emits no partial transcript for a client that left mid-decode`                                           |
| `isActive` sau await trong `translateLive`  | `emits no live translation for a client that left mid-request`                                            |
| `isActive` mỗi vòng `streamClauses`         | `stops synthesizing clauses once the client has gone`                                                     |
| `!bufferedBytes` trong `speculate()`        | `treats a frame carrying no bytes as no audio at all`                                                     |
| `!bufferedBytes` trong `end()`              | `treats a frame carrying no bytes as no audio at all`                                                     |
| thêm `finally { record(true) }` vào `end()` | `abandons a turn whose socket disconnected while translating` (`Expected length: 0 / Received length: 1`) |

Thêm: đổi một chữ trong message `'Frame belongs to another session'` → test message đỏ.

### Web — 5 bất biến (Phase 3)

| Bất biến bị phá                                  | Test đỏ                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| bỏ vế `turnEnded` của điều kiện re-arm           | `stays shut when audio drained but the server has not ended the turn` |
| bỏ vế `playback.isPlaying`                       | `stays shut when the turn ended but audio is still playing`           |
| `flushPending` lặp không detach                  | `does not resend held audio when the handshake is answered twice`     |
| bỏ guard reentrancy `start()`                    | `ignores a second start while one is already running`                 |
| đường stale gọi `stop()` thay `releaseResources` | `does not let a stale start wipe the run that replaced it`            |

**Một test đã bị phát hiện là rỗng và phải viết lại.** Bản đầu
(`never sends the same block twice across two turns`) vẫn xanh khi xoá detach trong
`flushPending`, vì `onTurnOpen` gán đè `pending` nên block đã flush không sống sót sang lượt
sau. Đường thật sự tới được lỗi là **handshake trả lời hai lần**. Test cũ giữ lại, đổi tên
đúng thứ nó chứng minh.

Cùng loại: code-reviewer Phase 1 bắt được `event-channel.spec.ts` có một test xanh bất kể
hành vi mà tên nó hứa — đã sửa để fake ghi lại event thành công và assert event thứ hai tới.

## Kết quả từng gate

| Gate                                                                                    | Kết quả                                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm typecheck` (toàn repo)                                                            | exit 0                                                                     |
| `pnpm lint` (toàn repo)                                                                 | exit 0 (2 warning có sẵn ở `elevenlabs-providers.spec.ts`, không đụng tới) |
| `apps/api` jest                                                                         | **22 suite / 234 test** (baseline 17/173)                                  |
| `apps/api` e2e                                                                          | 5 suite pass / 1 skip; `translate-ws-stream` **3/3 pass**, không sửa       |
| `apps/web` vitest                                                                       | **5 file (4 chạy + 1 skip) / 48 test + 1 skip** (baseline 4 file / 32+1)   |
| `apps/web` build                                                                        | exit 0                                                                     |
| `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip`                                                 | exit 0                                                                     |
| Diff spec service cũ                                                                    | **+243 / −0** so với `plan-p1-start`                                       |
| `grep "?? 16000"`                                                                       | 0                                                                          |
| Gate comment (`870ms`, `not a cap`, `unauthenticated`)                                  | trước = sau                                                                |
| `page.tsx`, `vitest.config.ts`, gateway, gateway.spec, `audio/*`, `translate.module.ts` | diff rỗng                                                                  |
| `development-journey.md`, `README.md`, `project-overview-pdr.md`                        | diff rỗng                                                                  |
| Mọi file không phải spec ≤200 dòng code                                                 | đạt                                                                        |

Suite e2e bị skip là `translate-local-speech-sidecar.e2e-spec.ts` — cần 2 sidecar chạy thật.
Môi trường, không phải hồi quy.

## Chưa xác minh — hai chỗ

1. **Chưa kiểm tay ở browser (Phase 3 bước 13).** Cần `pnpm dev:all` = api + `local-stt` +
   `local-tts` + `GEMINI_API_KEY`, tiêu quota Gemini thật. Vì vậy chưa có bằng chứng máy cho:
   thứ tự re-arm mic với `AudioWorkletNode` thật, `addModule` thật,
   `navigator.mediaDevices.getUserMedia` thật, và bấm stop/start liên tiếp 3 lần trên UI thật.
   Test tự động phủ các đường này nhưng bằng fake + fake clock.
2. **Chưa xác minh JSONL thật có key `liveTranslations`** (Phase 2 bước 11, cần
   `TURN_METRICS_PATH` + api + 2 sidecar). Đường ghi file không đổi — chỉ thêm một key vào
   object đã `JSON.stringify` — nhưng chưa chạy thật.
3. **Chưa chạy `pipeline-latency.measure.spec.ts`** (Phase 5 bước 7, tuỳ chọn). Refactor
   không đổi đường tính toán, nhưng đây là cách duy nhất chứng minh latency không hồi quy
   bằng số. Tiêu quota thật nên để user quyết.

## Câu hỏi chưa giải quyết

1. Đường `unsupported_audio` giữa chừng vẫn ghi `completed: true` và đóng reason `'completed'`
   sau khi đã emit `server.error` (`streamClauses` `break` chứ không ném). Y hệt bản trước
   refactor, **không phải hồi quy** — nhưng một lượt phát nửa chừng đang nằm trong bảng latency
   như lượt thành công. Sửa = đổi hành vi quan sát được, mà Goal 3 cấm. Cần user quyết có mở
   một việc riêng không.
2. `channelFor` cấp phát một `EventChannel` + một closure mỗi frame vào, kể cả phần lớn frame
   thoát ngay ở `shouldStart`. Bỏ được bằng `WeakMap<StreamSocket, EventChannel>`. Chưa đo,
   luật repo là đo trước — chưa làm.
3. Xoá dụng cụ AEC (`fullDuplex`/`echoHeard`, ~40 LOC + 4 test) vẫn bị chặn sau phép đo echo
   ở journey §10. Không phải việc của plan này.
