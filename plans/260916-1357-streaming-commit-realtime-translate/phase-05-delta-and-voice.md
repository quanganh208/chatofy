---
phase: 5
title: 'Forward chunk Gemini'
status: done
priority: P3
effort: '4h'
dependencies: [6]
---

# Phase 5: Bản dịch chảy ra từng mẩu

## Goal

Bản dịch hiện dần theo từng mẩu Gemini trả về, **không tốn thêm một request nào**.

Phần "nói sớm" đã **tách ra Phase 7** và bị hoãn — xem `plan.md` mục
"Counsel đã áp".

## Chạy SAU Phase 6. Bỏ được.

Người dùng chốt ở phiên validation 2026-09-16: giữ phase này nhưng đặt **sau khi
nghiệm thu xong**, và Task 5.5 đo lại rồi mới quyết giữ hay revert.

Thứ tự: `P1 → P2 → P3 → P4 → P6 → P5`.

Lý do đặt sau: Phase 3 và 4 đã giao trọn yêu cầu gốc, nên nghiệm thu phải chạy
trên chúng trước. Phase này chỉ làm bản dịch mượt hơn trong một lớp con các câu,
và nếu sát hạn nộp thì **bỏ hẳn** mà không mất gì đã hứa.

## Giới hạn đã đo, và vì sao vẫn làm

`gemini-translation-provider.ts` ghi ngay trên hàm `generate`: `chunks p50 = 1`.
Câu ngắn về trọn gói trong một chunk, nên cơ chế này **không** tạo ra cảm giác
từng chữ. Cảm giác đó đến từ `N` ở Phase 4.

Counsel giám sát đề nghị **cắt hẳn** phase này vì con số p50 = 1. Kế hoạch giữ
lại, và đây là lý do phải ghi ra để người sau kiểm được: con số p50 = 1 được đo
trên **lượt một câu** ở chính sách cũ. Phase 4 đặt trần RPD nên mỗi request phải
gánh **nhiều chữ hơn**, và output dài hơn thì Gemini chia nhiều mẩu hơn. Tức
tiền đề của phép đo cũ đã đổi theo hướng có lợi.

Nhưng đó là suy luận, không phải số đo. Vì vậy phase này để ở **P3** và Task 5.5
yêu cầu **đo lại** `chunks p50` dưới chính sách mới trước khi kết luận nó đáng
giữ. Nếu đo lại vẫn ra 1, revert phase này và ghi vào báo cáo.

## Files to Create / Modify

- Modify: `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts`
- Modify: `packages/ai-providers/src/interfaces/` — interface `TranslationProvider`
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts`
- Modify: `packages/types/src/events/ws-events.ts`
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts`
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Modify: `apps/api/src/modules/translate/session/live-preview.ts`

---

## Task 5.1 — Cho provider nhả chunk ra ngoài

- **Goal:** người gọi nhận được từng mẩu khi chúng về, thay vì chỉ nhận cục cuối.

- **Target files:**
  `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts`,
  hàm riêng `generate` (dòng ~281-335), vòng `for await (const chunk of stream)`
  ở dòng ~312.

- **Steps:**
  1. Thêm tham số tuỳ chọn `onChunk?: (delta: string) => void` vào `generate`
     và vào phương thức công khai gọi nó.
  2. Trong vòng lặp, sau `translated += chunk.text ?? ''`, gọi
     `onChunk?.(chunk.text ?? '')` khi chuỗi khác rỗng.
  3. **Không** đổi giá trị trả về. Hàm vẫn trả `{ text, model }` đầy đủ như cũ,
     nên mọi nơi gọi hiện tại không phải sửa.
  4. Cập nhật doc comment của `generate`. Câu hiện tại — _"Streaming is used for
     latency, not for incremental delivery"_ — sẽ thành sai một nửa. Viết lại:
     streaming vẫn mua độ trễ round-trip, và **giờ** cũng chuyển giao dần khi
     người gọi yêu cầu; giữ nguyên số đo `chunks p50 = 1` và ghi rõ hệ quả là
     câu ngắn thường chỉ có một mẩu.
  5. Thêm `onChunk` vào chữ ký tương ứng trong interface
     `TranslationProvider` dưới `packages/ai-providers/src/interfaces/`, để tuỳ
     chọn nên các provider khác không phải cài đặt.

- **Success criteria:** `packages/ai-providers` typecheck và test sạch.

- **Verify:**
  ```
  pnpm --filter @chatofy/ai-providers typecheck && pnpm --filter @chatofy/ai-providers test
  ```
  Cả hai thoát mã 0, **0 failed**.

---

## Task 5.2 — Thêm sự kiện `server.translation.delta`

- **Goal:** mẩu bản dịch đi được tới client.

- **Target files:** `packages/types/src/events/ws-events.ts`, cạnh
  `serverTranslationPartialSchema` (dòng ~318).

- **Steps:**
  1. Khai báo:
     ```ts
     const serverTranslationDeltaSchema = z.object({
       type: z.literal('server.translation.delta'),
       sessionId: z.string(),
       /** Mẩu bản dịch vừa về, để NỐI THÊM. */
       delta: z.string(),
       /**
        * Lần dịch thứ mấy của lượt này. Tăng mỗi lần một request MỚI bắt đầu.
        * Client phải XOÁ bản dịch đang hiện khi số này đổi.
        */
       generation: z.number().int().nonnegative(),
       direction: translationDirectionSchema,
     });
     ```
  2. Thêm vào union sự kiện server.
  3. Doc comment nêu rõ quan hệ với `server.translation.partial`: `partial` là
     **thay cả bản dịch** của một tiền tố đã dài thêm; `delta` là **nối thêm**
     bên trong một lần dịch đang chảy. Một lần dịch phát nhiều `delta` rồi kết
     thúc bằng một `partial` mang bản đầy đủ.

- **Success criteria:** `packages/types` typecheck và build sạch.

- **Verify:**
  ```
  pnpm --filter @chatofy/types typecheck && pnpm --filter @chatofy/types build
  ```
  Cả hai thoát mã 0.

---

## Task 5.3 — Reducer và test cho `server.translation.delta`

- **Goal:** bản dịch nối thêm đúng trên client.

- **Target files:**
  `packages/realtime-client/src/state/turn-keyed-transcript.ts` (thêm case cạnh
  `server.translation.partial`, dòng ~510) và
  `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts`.

- **Steps:**
  1. Thêm `translationGeneration?: number` vào `LiveTurn`.
  2. Case mới: nếu `event.generation` **khác** `current.translationGeneration`
     thì **bắt đầu lại** `translation` từ `event.delta`; nếu bằng thì nối thêm
     bằng `appendCapped`. Luôn ghi lại `translationGeneration`.
  3. Giữ nguyên case `server.translation.partial` — vẫn ghi đè, và là thứ chốt
     lại bản đầy đủ sau khi các `delta` chảy xong.
  4. Test: hai `delta` cùng generation thì nối; một `delta` generation mới thì
     **thay**, không nối; một `partial` sau đó thì ghi đè sạch.

### Vì sao cần `generation`

Không có nó, mẩu của lần dịch **thứ hai** nối vào bản đầy đủ mà
`server.translation.partial` của lần **thứ nhất** vừa ghi. Một lượt có hai lần
dịch sẽ hiện `"HelloHello there"`. Mọi lượt dài hơn `N` ký tự đều có ít nhất hai
lần dịch, nên đây là trường hợp thường, không phải biên.

- **Success criteria:** test xanh.

- **Verify:**
  ```
  pnpm --filter @chatofy/realtime-client test
  ```
  Thoát mã 0, **0 failed**.

---

## Task 5.4 — Nối đường: server phát delta khi dịch

- **Goal:** mẩu bản dịch thật sự đi ra socket.

- **Target files:**
  - `apps/api/src/modules/translate/services/pipeline-translator.service.ts` —
    thêm `onChunk` xuyên qua tới provider.
  - `apps/api/src/modules/translate/session/live-preview.ts` — hàm
    `translateLive`.

- **Steps:**
  1. Cho `pipeline.translate(...)` nhận thêm `onChunk` tuỳ chọn và chuyển thẳng
     xuống provider.
  2. Trong `translateLive`, tăng một bộ đếm `generation` trên `TurnSession`
     **trước** khi gọi `pipeline.translate`, rồi truyền `onChunk` phát
     `server.translation.delta` kèm đúng giá trị đó. Kiểm `stillCurrent()` và
     `session.isListening` **bên trong** callback trước khi phát — lượt có thể
     đã kết thúc giữa chừng.
  3. Giữ nguyên lệnh phát `server.translation.partial` ở cuối. Nó vẫn là bản
     chốt lại đầy đủ.

- **Success criteria:** API typecheck và test xanh.

- **Verify:**
  ```
  pnpm --filter api typecheck && pnpm --filter api test
  ```
  Cả hai thoát mã 0, **0 failed**.

---

## Task 5.5 — Đo lại `chunks p50`, rồi kiểm toàn repo

- **Goal:** xác nhận phase này đáng giữ, thay vì tin vào suy luận ở đầu file.

- **Target files:** không sửa code. Ghi số vào
  `plans/260916-1357-streaming-commit-realtime-translate/reports/acceptance.md`
  (tạo trước nếu Phase 6 chưa chạy).

- **Steps:**
  1. Chạy hội thoại thật khoảng 2 phút với `LIVE_TRANSLATION_COMMIT_CHARS` đang
     cấu hình, đếm số `server.translation.delta` phát ra cho mỗi lần dịch.
  2. Lấy trung vị số mẩu mỗi lần dịch.
  3. **Nếu trung vị = 1**, phase này không mua được gì: ghi số vào báo cáo, đề
     xuất revert, và báo người dùng. Không tự revert.
  4. Nếu trung vị ≥ 2, ghi số và giữ.
  5. Chạy typecheck, lint, build toàn monorepo.

- **Success criteria:** số trung vị được ghi lại, và ba lệnh dưới sạch.

- **Verify:**
  ```
  pnpm typecheck && pnpm lint && pnpm build
  ```
  Cả ba thoát mã 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
