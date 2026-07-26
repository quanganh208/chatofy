# Báo cáo — 3 defect còn nợ của realtime-ws

- Ngày: 2026-07-26
- Baseline: `98f0239`
- Commit: `1062f3c` (xoá hồ sơ plan), `e6c3980` (api), `1afe4b3` (web)

## Vì sao không refactor thêm

Yêu cầu ban đầu là refactor tiếp cho "clean, chuẩn OOP, không hàm dư thừa". Đo lại thì
việc đó đã xong ở plan `260726-2111`:

| Tiêu chí         | Đo lúc 2026-07-26 23:35                                            |
| ---------------- | ------------------------------------------------------------------ |
| Ngưỡng 200 LOC   | Quét toàn bộ `.ts/.tsx` — không file non-spec nào vượt (max 199)   |
| Hàm/export dư    | `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip` exit 0 toàn repo           |
| Phần ngoài scope | `auth`/`users`/`sessions`/`common`/`mobile`/`packages`: max 88 LOC |

Phần ngoài path realtime là scaffold thật (auth adapter noop, mỗi màn mobile ~20 LOC).
Refactor ở đó là churn — không làm.

Việc còn lại không phải refactor mà là **3 defect** cùng một họ: state/metrics nói sai về
lượt không hoàn tất. Hai cái đầu là câu hỏi mở #1 và #4 của báo cáo trước; cái thứ ba
tìm ra khi đọc code để sửa cái thứ nhất.

## Defect

### 1. Lượt `unsupported_audio` giữa chừng ghi là thành công (api)

`streamClauses` gặp TTS trả sai định dạng thì `break` chứ không ném, nên `end()` chạy tiếp
`record(true)` + đóng reason `'completed'` — ngay sau khi đã emit `server.error`. Một lượt
người nghe không nghe được gì nằm trong bảng latency cạnh những lượt phát đủ.

Trái với chính doc của `TurnMetrics.completed`: _"False when the turn failed part-way"_.

### 2. Lượt bị client bỏ giữa vòng clause cũng ghi là thành công (api)

Cùng lỗi, mặt kia. `end()` từ chối ghi lượt bị bỏ **trước** synthesize (`:180`), nhưng bỏ
**trong lúc** synthesize thì vòng lặp `break` rồi rơi thẳng vào `record(true)`. Test chứng
minh in ra hàng thật:

```
{"completed": true, "firstAudioAtMs": 1, "lastAudioAtMs": 1, "clauses": 2, …}
```

`lastAudioAtMs` bị cắt ngắn bởi chính cú rời đi → đọc thành một lượt nhanh bất thường.
Trái với comment ở `:176-179` ("An abandoned turn is not a fast turn").

### 3. `catch` của `ConversationSession.start()` không kiểm `isStale()` (web)

Mọi checkpoint trong `try` đều hỏi "run này còn là của mình không" trước khi công bố gì.
`catch` thì không — gọi thẳng `this.stop()`.

Kịch bản: `start(A)` → `stop()` → `start(B)` chạy ngon → user bấm **từ chối** quyền mic muộn
→ `catch` của A **giết run B đang chạy** và đè lỗi của A lên banner. Từ chối muộn là chuyện
thường: prompt quyền đợi người thật.

Có sẵn từ trước refactor (`use-streaming-translate.ts:328-332` bản cũ làm y hệt) — không
phải hồi quy.

## Sửa

**api** — `streamClauses` trả thêm lý do dừng:

```ts
export interface ClauseDelivery extends AudioSpan {
  stoppedBy?: 'client_gone' | 'unsupported_audio';
}
```

`client_gone` → không ghi gì, không nói gì (giống hệt đường `:180`). `unsupported_audio` →
`record(false)` + đóng bằng reason riêng, đúng như `turn_too_long` vốn đã làm.

`ClauseDelivery` đặt ở `session/turn-timeline.ts` cạnh `AudioSpan` mà nó mở rộng — để trong
service thì file lên 201 LOC, quá ngưỡng.

**web** — `catch` giải phóng cái nó dựng, rồi `if (isStale()) return;` trước khi `stop()`.

## Đổi hành vi trên dây — có, đúng một chỗ, đã duyệt

| Đường                       | Trước                         | Sau                                   |
| --------------------------- | ----------------------------- | ------------------------------------- |
| TTS trả non-PCM giữa lượt   | `ended` reason `'completed'`  | `ended` reason `'unsupported_audio'`  |
| Client rời giữa vòng clause | `ended` reason `'completed'`  | không emit `ended` (socket đã đi)     |
| Cả hai                      | metrics row `completed: true` | row `completed: false` / không có row |

Căn cứ cho phép đổi: web client không đọc `reason` (`conversation-session.ts:293`,
`conversation-state.ts:78` chỉ switch theo `type`); e2e chỉ assert `reason === 'completed'`
trên đường happy; `turn_too_long` đã có tiền lệ đóng bằng reason riêng.

## Test — và cách đã chứng minh chúng bắt lỗi

Test xanh trên code hiện tại không chứng minh gì. Mỗi cái đều được viết trên build **chưa
vá** và thấy đỏ trước.

| Test                                                                    | Đỏ ở đâu trên build chưa vá                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `reports a TTS backend whose output is not PCM WAV` (mở rộng)           | `Expected "unsupported_audio" / Received "completed"` |
| ⤷ assertion `completed: false` (nằm sau, chưa chạy) → mutation riêng    | `record(true)` → `Expected: false / Received: true`   |
| `records nothing for a turn the client abandoned between clauses`       | `Expected length: 0 / Received length: 1`             |
| `does not let a failing stale start tear down the run that replaced it` | `isRunning` `Expected true / Received false`          |

Test #1 cũ chỉ assert `server.error` + số lần synthesize + transcript — không chạm reason
hay metrics, nên hai assertion mới thêm vào chứ không sửa cái cũ.

## Gate

| Gate                                    | Kết quả                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `pnpm typecheck`                        | exit 0                                                            |
| `pnpm lint`                             | 0 error (2 warning có sẵn ở `elevenlabs-providers.spec.ts`)       |
| `apps/api` jest                         | **22 suite / 236 test** (trước: 22/234)                           |
| `apps/api` e2e                          | 5 pass / 1 skip; `translate-ws-stream` pass, không sửa            |
| `apps/web` vitest                       | 4 file + 1 skip / **51 pass + 1 skip** (trước: 50)                |
| `apps/web` next build                   | exit 0                                                            |
| `KNIP_DISABLE_RAW_TRANSFER=1 pnpm knip` | exit 0                                                            |
| LOC ≤200                                | service 198, `conversation-session.ts` 200, `turn-timeline.ts` 58 |

Suite e2e skip là `translate-local-speech-sidecar` — cần 2 sidecar chạy thật. Môi trường.

## Chưa xác minh

Chưa kiểm tay ở browser. Đường sửa (`catch` của `start()`) cần user **từ chối quyền mic
muộn** sau khi đã stop/start — test phủ bằng fake, chưa chạy với `getUserMedia` thật.

## Câu hỏi chưa giải quyết

1. `channelFor` cấp một `EventChannel` + closure mỗi frame vào. Bỏ được bằng
   `WeakMap<StreamSocket, EventChannel>`. **Chưa đo** — luật repo là đo trước. Đề xuất: bỏ qua.
2. Xoá dụng cụ AEC (`fullDuplex`/`echoHeard`, ~40 LOC + 4 test) vẫn kẹt sau phép đo echo
   âm học ở `development-journey.md` §10. Không phải việc code.
3. Reason `'unsupported_audio'` giờ là giá trị mới trên dây. Không consumer nào đọc `reason`
   hôm nay — nhưng nếu sau này mobile realtime đọc, nó phải chịu được reason lạ.
