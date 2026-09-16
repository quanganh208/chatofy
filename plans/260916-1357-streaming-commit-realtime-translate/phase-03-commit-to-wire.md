---
phase: 3
title: 'Nhịp STT và đẩy chữ đã chốt lên client'
status: done
priority: P1
effort: '1.5d'
dependencies: [2]
revision: 3 (sửa sau cổng đo Phase 1 và counsel Phase 2)
---

# Phase 3: Từ chốt tới màn hình

## Goal

Chữ đã chốt đi từ server tới màn hình, hiển thị khác phần chưa chốt, và **không
bao giờ đổi sau khi đã hiện**.

Sau phase này, nửa đầu yêu cầu — "trả về từng chữ" — đã xong. Bản dịch chưa đổi.

## Bốn sửa lớn sau red team

| Bản đầu                                     | Vấn đề                                                                                                                          | Bản này                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Gửi `committedDelta`, client tự ghép        | `server.transcript.partial` ghi đè `text` mà không động `committedChars`, nên phần chốt **biến đổi trên màn hình**              | **Gửi chuỗi chốt tuyệt đối.** Client không ghép gì          |
| Sự kiện mới phát cho mọi client             | `serverEventSchema` là `discriminatedUnion` strict; extension bản cũ `safeParse` trượt và **báo lỗi ra người dùng** mỗi vòng    | **Opt-in qua `SessionOptions`**, đúng khuôn `repairDisplay` |
| Cửa sổ giữ 8s, bất biến so với trần lời nói | Lượt mở ra đã mang sẵn `PRE_ROLL_MS = 320`, nên buffer chạm ~8320ms > cửa sổ 8000ms. Mốc neo **vẫn trượt** ở đúng lượt dài nhất | **Cửa sổ 9s** cộng **chốt chặn phía server**                |
| Tiêu chí nhịp 350ms                         | Bất khả thi ở chiều en→vi (~1000ms ở divisor 2)                                                                                 | Ngưỡng lấy từ số đo Phase 1, **mỗi chiều một ngưỡng**       |

## Bất biến của phase này

`server.transcript.partial` **vẫn phải phát ra y như hôm nay** cho mọi client.
`apps/extension` dùng chung `packages/realtime-client` và có bản cài trên máy
người dùng cập nhật theo lịch riêng.

## Files to Create / Modify

- Modify: `packages/types/src/events/ws-events.ts`
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.ts`
- Modify: `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts`
- Modify: `apps/api/src/modules/translate/session/turn-session.ts`
- Modify: `apps/api/src/modules/translate/session/live-preview.ts`
- Modify: `apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts`
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Modify: `apps/web/src/hooks/use-streaming-translate.ts`

---

## Task 3.1 — Thêm `server.transcript.delta`, mang chuỗi TUYỆT ĐỐI

- **Goal:** một sự kiện mà client không phải ghép gì.

- **Target files:** `packages/types/src/events/ws-events.ts`, ngay sau
  `serverTranscriptPartialSchema` (dòng ~296-303), rồi thêm vào union sự kiện
  server (dòng ~469).

- **Steps:**
  1. Khai báo:
     ```ts
     const serverTranscriptDeltaSchema = z.object({
       type: z.literal('server.transcript.delta'),
       sessionId: z.string(),
       /** TOÀN BỘ phần đã chốt tới lúc này. Không phải phần thêm. */
       committed: z.string(),
       /** Phần chưa chốt, ghi đè mỗi lần. Rỗng trong đúng một vòng sau khi
        * bộ nhận dạng bất đồng và trước khi bất đồng đó được xác nhận. */
       pending: z.string(),
       /** Số lần phần đã chốt bị THAY thay vì nối tiếp, cộng dồn trong lượt
        * này. Phase 6 task 6.3 dùng nó để phân biệt một lần neo lại hợp lệ với
        * một lần viết lại là vi phạm — không có nó thì hai thứ đó nhìn giống
        * hệt nhau trên DOM.
        *
        * Bộ đếm chứ không phải boolean: từ bộ đếm suy ra được cờ mỗi sự kiện
        * (số tăng so với `delta` liền trước cùng `sessionId`) VÀ suy ra được
        * ngưỡng "≤ 2 mỗi lượt" từ sự kiện cuối, không phải cộng cả nhật ký.
        * Boolean chỉ cho vế đầu. */
       reanchors: z.number().int().nonnegative(),
       speaker: speakerRoleSchema,
       direction: translationDirectionSchema,
     });
     ```
  2. Thêm vào union, cạnh `serverTranscriptPartialSchema`.
  3. Thêm `streamCommitted?: boolean` vào `sessionOptionsSchema`, đúng khuôn
     `repairDisplay` đang dùng. `.optional()` để mọi `SessionOptions` literal
     sẵn có vẫn biên dịch.

### Vì sao gửi chuỗi tuyệt đối thay vì phần thêm

Bản đầu gửi `committedDelta` và để client ghép:
`current.text.slice(0, current.committedChars) + committedDelta`.

Hỏng vì `server.transcript.partial` cũng ghi vào **cùng trường `text`**, ghi đè
cả dòng mà **không** động `committedChars` (`turn-keyed-transcript.ts:504-507`),
còn `patchLive` spread `...current` nên `committedChars` cũ sống sót. Client sẽ
`slice` một chuỗi mà sự kiện kia vừa thay. Phần chốt biến đổi trên màn hình —
đúng thứ cả phase này sinh ra để chống.

`appendCapped` cắt từ **đầu** chuỗi khi vượt `LIVE_LINE_MAX`
(`turn-keyed-transcript.ts:379-382`), là con đường thứ hai làm `committedChars`
lệch khỏi `text`.

Gửi chuỗi tuyệt đối đóng cả hai đường: không có phép cộng nào ở client, nên
không có gì để lệch.

- **Success criteria:** `packages/types` typecheck và build sạch.

- **Verify:**
  ```
  pnpm --filter @chatofy/types typecheck && pnpm --filter @chatofy/types build
  ```
  Cả hai thoát mã 0.

---

## Task 3.2 — Xử lý sự kiện mới trong reducer

- **Target files:** `packages/realtime-client/src/state/turn-keyed-transcript.ts`
  — sửa `interface LiveTurn` (dòng 46) và thêm `case` cạnh
  `case 'server.transcript.partial'` (dòng 504).

- **Steps:**
  1. Thêm trường **tuỳ chọn** vào `LiveTurn`:
     ```ts
     /** Bao nhiêu ký tự đầu của `text` đã chốt và sẽ không đổi. */
     committedChars?: number;
     ```
  2. Case mới, dùng lại `appendCapped` để không vượt `LIVE_LINE_MAX`:
     ```ts
     case 'server.transcript.delta': {
       const text = appendCapped('', event.committed + event.pending);
       return patchLive(state, event.sessionId, {
         text,
         // Tính lại theo chuỗi ĐÃ cắt: appendCapped cắt từ đầu, nên một chỉ số
         // tính trước khi cắt sẽ trỏ sai chỗ.
         committedChars: Math.max(0, text.length - event.pending.length),
       });
     }
     ```
  3. Thêm **đúng một** chốt chặn vào đầu `case 'server.transcript.partial'`, và
     không sửa gì khác trong nhánh đó:
     ```ts
     case 'server.transcript.partial':
       // Lượt nào đã được trao chữ đã-chốt thì thuộc về sự kiện đó; ghi đè cả
       // dòng ở đây sẽ làm dịch chuyển thứ người đọc vừa được bảo là đã chốt.
       if (state.live[event.sessionId]?.committedChars !== undefined) return state;
       return patchLive(state, event.sessionId, { text: event.text });
     ```
     **Hành vi cho mobile và extension không đổi**, vì chúng không bao giờ nhận
     `server.transcript.delta` nên `committedChars` không bao giờ có giá trị và
     chốt chặn không bao giờ đúng. Lý do của lệnh cấm cũ được giữ nguyên; xem
     mục "Chốt chặn `partial`" bên dưới để biết vì sao lệnh cấm ấy phải nới.
  4. Ghi vào comment cạnh `appendCapped` rằng nhánh cắt-từ-đầu **không với tới
     được** với web: `LIVE_LINE_MAX = 600`, mà một lượt web bị `MAX_UTTERANCE_MS`
     chặn ở 8,32 giây ≈ 120 ký tự ở tốc độ đo được. Nó tồn tại cho một client
     không có trần đó.

- **Success criteria:** typecheck sạch, mọi test cũ vẫn xanh.

- **Verify:**
  ```
  pnpm --filter @chatofy/realtime-client test && pnpm --filter @chatofy/realtime-client typecheck
  ```
  Cả hai thoát mã 0, **0 failed**.

---

## Task 3.3 — Test cho reducer

- **Target files:**
  `packages/realtime-client/src/state/turn-keyed-transcript.spec.ts`.

- **Steps:** viết sáu ca:
  1. Hai `server.transcript.delta` liên tiếp: `text` là `committed + pending` của
     sự kiện **sau**, `committedChars` bằng độ dài `committed` của nó.
  2. `pending` bị thay chứ không nối: gửi `pending: 'abc'` rồi `pending: 'xy'` →
     `text` kết thúc bằng `'xy'`, không chứa `'abc'`.
  3. **Xen một `partial` vào giữa hai `delta`.** Gửi `delta`(committed=`'xin chào'`),
     rồi `partial`(text=`'xin chào cắc'`), rồi `delta`(committed=`'xin chào'`,
     pending=`' các bạn'`) → sau sự kiện cuối, 8 ký tự đầu của `text` vẫn đúng
     `'xin chào'`. **Đây là ca chặn lỗi của bản đầu**; không có nó thì lỗi tái
     diễn không ai thấy.
  4. **`partial` không được động vào lượt đã có `delta`.** Gửi
     `delta`(committed=`'xin chào'`, pending=`' các'`), rồi
     `partial`(text=`'chào bạn ơi'`) → `text` vẫn là `'xin chào các'` và
     `committedChars` vẫn là 8. **Đây là ca sẽ trượt nếu thiếu chốt chặn ở task
     3.2**, và nó là ca có thật: 19 vòng blackout trên 13/50 lượt đo được.
  5. **Neo lại thay được phần đã chốt.** Gửi `delta`(committed=`'cơ'`,
     pending=`''`), rồi `delta`(committed=`'cô cứ nhè'`, pending=`''`,
     `reanchors: 1`) → `text` bằng đúng `'cô cứ nhè'` và **không** chứa
     `'cơ'`. Ca này khoá điều làm cả hướng đi khả thi: reducer dựng lại cả dòng
     từ rỗng nên một `committed` không nối tiếp cái trước vẫn render đúng, không
     phải đổi giao thức.
  6. Chuỗi rất dài bị `appendCapped` cắt: `committedChars` không vượt
     `text.length`.

- **Verify:**
  ```
  pnpm --filter @chatofy/realtime-client test
  ```
  Thoát mã 0, **0 failed**.

---

### Chốt chặn `partial` — sửa lỗi 6.3 chắc chắn xảy ra

Phase này **vẫn phát** `server.transcript.partial` mỗi vòng cho mọi client, kể cả
client đã xin `delta`. Trên vòng blackout — vòng mà bất đồng vừa xuất hiện, nên
hypothesis **không** bắt đầu bằng phần đã chốt — hai sự kiện **đánh nhau**:

1. `partial` tới trước: `text = hypothesis`, `committedChars` giữ nguyên giá trị
   cũ, nên span "đã chốt" render `hypothesis.slice(0, committedChars)` — một
   chuỗi **khác**. Một lần đổi DOM, không kèm neo lại. **Vi phạm 6.3.**
2. `delta` tới sau kéo nó về. Lần đổi DOM thứ hai.

Đảo thứ tự còn tệ hơn: `partial` tới sau cùng và chuỗi sai nằm lại tới vòng kế.
Mỗi khung WebSocket là một `onmessage` riêng (`translate-socket.ts:97`) nên React
render giữa hai khung — không có gộp lô nào cứu được.

Đo được: **19 vòng blackout trên 13/50 lượt (26%)**. Tức Phase 6 task 6.3 chắc
chắn trượt, và ta chỉ biết sau khi đã viết xong Phase 3 và Phase 4.

Sửa bằng **một dòng** ở đầu case `partial` trong reducer web:

```ts
case 'server.transcript.partial':
  // Lượt nào đã được trao chữ đã-chốt thì thuộc về sự kiện đó; ghi đè cả dòng
  // ở đây sẽ làm dịch chuyển thứ người đọc vừa được bảo là đã chốt.
  if (state.live[event.sessionId]?.committedChars !== undefined) return state;
  return patchLive(state, event.sessionId, { text: event.text });
```

Cách này làm **thứ tự trở nên không quan trọng**, và **vô hình với extension**:
extension không bao giờ nhận `delta` nên `committedChars` không bao giờ có giá
trị, và case chạy đúng như hôm nay.

**Việc này động vào case `partial`, thứ mà task 3.2 bước 3 cấm.** Lý do của lệnh
cấm đó là bảo vệ extension và mobile — lý do ấy vẫn được giữ nguyên ở đây. Nên
**sửa lệnh cấm**, đừng tuân theo nó một cách mù quáng.

Và **giữ nguyên** việc phát `partial` phía server như bất biến của phase đã ghi:
chính chốt chặn ở reducer mới là thứ làm việc phát đó an toàn.

### `appendCapped` cắt từ đầu — chết với web, giữ cho client khác

`LIVE_LINE_MAX = 600` và `appendCapped` cắt từ **đầu** khi vượt
(`turn-keyed-transcript.ts:377-382`). Nếu nó cắt thật thì span đã chốt dịch đi và
6.3 xếp là vi phạm.

Với tới được không? `live` khoá theo `sessionId`, tức **theo lượt**, và một lượt
web tối đa 8,32 giây. Ở trần 14 ký tự/giây đo được thì đó là ~120 ký tự; kể cả
một tràng tiếng Anh 20 ký tự/giây cũng chỉ ~170. **600 không với tới được trong
một lượt web.** Ghi câu đó vào comment ở task 3.2, và giữ ca test biên như một
phép kiểm chặn thuần tuý.

## Task 3.4 — Nối committer, và chỉ phát cho client đã xin

- **Target files:**
  - `apps/api/src/modules/translate/session/turn-session.ts` — thêm field cạnh
    `readonly partials` và `readonly liveTranslation` (dòng ~34-36).
  - `apps/api/src/modules/translate/session/live-preview.ts` — hàm `onAudio`.
  - `apps/web/src/hooks/use-streaming-translate.ts` — đặt cờ khi mở phiên.

- **Steps:**
  1. Trong `TurnSession`:
     ```ts
     /** Chốt phần transcript đã ổn định của lượt này. */
     readonly committer = new StreamingCommitter();
     /** Client này có xin luồng chữ đã chốt không. */
     readonly streamCommitted: boolean;
     ```
     `streamCommitted = options.streamCommitted ?? false` — **mặc định tắt**,
     đúng khuôn `repairDisplay` (`turn-session.ts` dòng ~118).
  2. Trong `live-preview.ts`, bên trong `.then((text) => {...})`, sau các guard
     hiện có và sau `session.partials.markEmitted(atBytes)`:
     - **chốt chặn cửa sổ (bất biến neo):**

       ```ts
       const windowBytes = session.partials.windowSeconds * audio.bytesPerSecond;
       if (atBytes > windowBytes) {
         // Buffer đã vượt cửa sổ, nên cửa sổ đang trượt và mốc neo dịch chuyển.
         // Phép so tiền tố mất nghĩa. Bỏ đường chốt cho vòng này; `partial` vẫn
         // đi như cũ, tức thoái lui về đúng hành vi hôm nay.
       }
       ```

       Khi buffer vượt cửa sổ thì **không** gọi `push`, và phát `delta` với
       `committed: ''`, `pending: text` mỗi vòng. Đó là hành vi ghi-đè-cả-dòng
       của hôm nay, diễn đạt qua sự kiện mới.

       **Đừng chờ lối thoái lui cũ "để `partial` lo".** Sau chốt chặn reducer ở
       task 3.2, client đã nhận `delta` sẽ **bỏ qua** `partial`, nên lối đó
       không còn tới được màn hình. Nhánh này vốn **không với tới được** với web
       (8000 + 320 < 9000); nó tồn tại cho một client không tự cắt ở 8 giây, và
       Phase 6 không kiểm nó.

     - chỉ khi `session.streamCommitted`, phát:

       ```ts
       session.committer.push(text);
       channel.emit({
         type: 'server.transcript.delta',
         sessionId: session.sessionId,
         committed: session.committer.committed,
         pending: session.committer.pending,
         reanchors: session.committer.reanchors,
         speaker: session.speakerRole,
         direction: session.direction,
       });
       ```

       **Không đọc giá trị trả về của `push()` như "chữ đã dài ra".** Nó trả
       `true` cho cả nối thêm lẫn neo lại, và neo lại có thể làm `committed`
       **ngắn đi** (đo được: 2 trên 13 lần).

       **Không còn điều kiện `diverged`.** Bản trước bỏ qua vòng phân kỳ; cổng
       đo Phase 1 cho thấy chính việc bỏ qua đó làm committer chết trên 14% số
       lượt. Giờ vòng bất đồng được phát bình thường, và nếu bất đồng được xác
       nhận thì `committed` bị thay và `reanchors` tăng. `StreamingCommitter`
       không còn xuất `diverged`.

     - **giữ nguyên** lệnh phát `server.transcript.partial`. Không xoá.
  3. Gọi `session.committer.reset()` khi lượt kết thúc.

### Đã kiểm: biên cắt 8 giây KHÔNG làm chết luật đếm ký tự

Counsel nêu nghi vấn sau: `LiveTranslationTrigger` giữ `lastCommittedLength`, và
nếu nó **không** được reset cùng chỗ với `committer.reset()` thì sau mỗi lần cắt
cưỡng bức 8 giây, `committed.length` (0) trừ `lastCommittedLength` của đoạn trước
(hàng chục ký tự) ra **số âm**, luật đếm ký tự không bao giờ chạm `commitChars`,
và đoạn thứ hai của mọi lượt dài **không có bản dịch giữa chừng nào**. Với 28%
lời nói thật đi qua đường này, đó sẽ là lỗi nặng.

**Kiểm rồi, và nó không xảy ra.** Cả hai đối tượng đều là field của `TurnSession`:

```ts
// turn-session.ts
readonly liveTranslation = new LiveTranslationTrigger();
// task 3.4 bước 1 thêm vào cùng class đó
readonly committer = new StreamingCommitter();
```

`new TurnSession(...)` chỉ có **một** nơi khởi tạo ngoài test
(`translation-session.service.ts:139`), và nó chạy **mỗi lượt một lần**. Cắt
cưỡng bức kết thúc lượt, nên cả committer lẫn trigger đều được dựng mới —
`lastCommittedLength` bắt đầu từ 0 đúng lúc `committed` bắt đầu từ `''`. Không có
mốc cũ nào sống sót.

Hệ quả phụ: `committer.reset()` ở bước 3 là **thừa** với vòng đời hiện tại, vì cả
`TurnSession` bị bỏ đi. Giữ lại như một lớp phòng hờ nếu sau này có ai tái dùng
session, nhưng đừng ai tưởng nó đang gánh việc gì. 4. Trong `use-streaming-translate.ts`, đặt `streamCommitted: true` trong
`SessionOptions` mà web gửi khi mở phiên.

### Vì sao phải opt-in

`packages/realtime-client/src/transport/translate-socket.ts:108-112`:

```ts
const parsed = serverEventSchema.safeParse(body);
if (!parsed.success) {
  this.handlers.onError?.('Unexpected event shape from the server');
  return;
}
```

`serverEventSchema` là `z.discriminatedUnion('type', ...)`. Một client build với
`@chatofy/types` cũ không biết `server.transcript.delta`, nên safeParse trượt và
nó **báo lỗi ra người dùng** — không phải bỏ qua im lặng. Và
`apps/extension/src/direction-session.ts:133` khởi tạo đúng `TranslateSocket` này.
Extension là bản cài trên máy, cập nhật theo lịch riêng, nên sẽ có giai đoạn
server mới gặp extension cũ, và mỗi vòng ~300ms hiện một lỗi.

`apps/mobile` không phụ thuộc `@chatofy/realtime-client` nên nằm ngoài vùng ảnh
hưởng. Chỉ extension.

Opt-in đóng hẳn đường này: client cũ không đặt cờ, nên không bao giờ nhận sự kiện
nó không hiểu.

- **Success criteria:** typecheck sạch, test API xanh.

- **Verify:**
  ```
  pnpm --filter api typecheck && pnpm --filter api test
  ```
  Cả hai thoát mã 0, **0 failed**.

---

## Task 3.5 — Cửa sổ lên 9 giây, divisor xuống 2

- **Goal:** khôi phục bất biến neo, và tăng nhịp.

- **Target files:**
  `apps/api/src/modules/translate/audio/partial-transcript-scheduler.ts`,
  hằng `DEFAULT_WINDOW_SECONDS` (dòng ~44) và `PARTIAL_DUTY_DIVISOR` (dòng ~32).
  Thêm một getter `windowSeconds` công khai để Task 3.4 đọc được.

### Bất biến neo cửa sổ — phát biểu đúng lần này

LocalAgreement-2 so tiền tố chung của hai lần giải mã, và phép so đó chỉ có nghĩa
khi hai lần **neo vào cùng một điểm gốc**. Cửa sổ chỉ đứng yên khi nó phủ hết
buffer.

Bản đầu phát biểu bất biến là `DEFAULT_WINDOW_SECONDS × 1000 >= MAX_UTTERANCE_MS`
và giữ cửa sổ 8 giây. **Sai số học:** lượt mở ra đã mang sẵn 320ms pre-roll
(`packages/realtime-client/src/audio/capture-pump.ts:22,63` —
`onTurnOpen(preRoll)`), rồi mới cộng tới 8000ms lời nói. Buffer thật chạm
~8320ms trên cửa sổ 8000ms, nên mốc neo **vẫn trượt** ở đúng những lượt dài nhất.

Phát biểu đúng:

```
DEFAULT_WINDOW_SECONDS × 1000  >=  MAX_UTTERANCE_MS + PRE_ROLL_MS
                    9000       >=       8000 + 320                ✓
```

Và bất biến này **do client giữ**, không phải server: `MAX_TURN_SECONDS = 60`
(`turn-audio.ts:12`) là trần duy nhất server cưỡng chế. Một client không cắt ở 8
giây sẽ phá bất biến mà server không biết. Vì thế Task 3.4 có chốt chặn
`atBytes > windowBytes` — bất biến tự bảo vệ, và một client lạ thoái lui về hành
vi hôm nay thay vì âm thầm sinh chữ lặp.

- **Steps:**
  1. `DEFAULT_WINDOW_SECONDS = 9`.
  2. `PARTIAL_DUTY_DIVISOR = 2`.
  3. Thêm getter `get windowSeconds(): number`.
  4. Cập nhật comment **cả hai hằng**. Ví dụ hiện tại tính theo cửa sổ 8s và
     divisor 3 ("refreshes roughly every 750ms") sẽ thành sai. Ghi vào comment
     của `DEFAULT_WINDOW_SECONDS` cả bất biến ở trên lẫn phép cộng pre-roll, để
     lần sau ai định hạ nó sẽ đọc được lý do ngay tại chỗ.
  5. **Divisor 2 là thay đổi có điều kiện.** Nó nâng tần suất decode ~50% trên
     sidecar có `LOCAL_STT_CONCURRENCY=4` và **từ chối bằng 503** khi bão hoà
     (`services/local-stt/app.py:82-88`), mà API nuốt lỗi partial im lặng. Phase
     6 Task 6.6 đo số 503 dưới tải hai người nói; **khác 0 thì trả divisor về 3**.
     Ghi điều kiện này vào comment.

- **Success criteria:** hai hằng đúng giá trị, comment không còn số cũ mâu thuẫn.

- **Verify:**
  ```
  pnpm --filter api test -- partial-transcript-scheduler
  ```
  Thoát mã 0. Test nào khẳng định giá trị hằng cũ thì **sửa cho khớp giá trị
  mới** — thay đổi có chủ đích, không phải hồi quy.

---

## Task 3.6 — Hiển thị hai lớp trên web

- **Target files:**
  `apps/web/src/components/translate/conversation-transcript.tsx`, chỗ render
  `live.text` (dòng ~334-335).

- **Steps:**
  1. Thay `{live.text}` bằng hai `<span>`: phần
     `live.text.slice(0, live.committedChars ?? live.text.length)` và phần còn
     lại. Mặc định `?? live.text.length` giữ nguyên hiển thị cũ khi sự kiện mới
     chưa tới.
  2. Phần đã chốt dùng màu chữ hiện tại. Phần chưa chốt dùng **token màu có sẵn**
     của hệ thiết kế cho chữ phụ.
  3. **KHÔNG dùng `opacity` để làm mờ phần chưa chốt.** Xem
     `.claude/rules/development-rules.md`: các spec kiểm token đọc token, nên
     `opacity` composited lọt qua spec trong khi phá đúng luật spec sinh ra —
     lỗi này đã xảy ra trên `/history` và đẩy dòng đang đọc xuống 4,07:1.
  4. Không thêm `bg-primary`, không thêm surface nổi. Đây là chữ trên nền trang.

- **Verify:**
  ```
  pnpm --filter web test && pnpm --filter web typecheck
  ```
  Cả hai thoát mã 0, **0 failed**. `apps/web/src/design/accent-budget-app.spec.tsx`
  phải nằm trong số test xanh.

---

### Phải build lại dist trước khi typecheck hạ nguồn

`@chatofy/types` và `@chatofy/realtime-client` đều được hạ nguồn tiêu thụ qua
`dist`, không qua source. Thêm sự kiện vào `ws-events.ts` mà không chạy
`pnpm --filter @chatofy/types build` thì `realtime-client` báo
`Property 'sessionId' does not exist on type 'never'` — union hạ nguồn chưa thấy
thành viên mới. Tương tự, `apps/web` không thấy `committedChars` cho tới khi
`@chatofy/realtime-client` được build lại.

Thứ tự đúng: sửa types → build types → sửa realtime-client → build
realtime-client → sửa web. Triệu chứng trông như lỗi kiểu thật, nên dễ mất thời
gian đi tìm nhầm chỗ.

## Task 3.7 — Kiểm toàn repo

- **Verify:**
  ```
  pnpm typecheck && pnpm lint
  ```
  Cả hai thoát mã 0.

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
