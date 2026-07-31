---
phase: 3
title: 'Server concurrent turns'
status: done
priority: P1
effort: '1d'
dependencies: [2]
---

# Phase 3: Server concurrent turns

## Overview

Cho một socket mang nhiều `TurnSession` cùng lúc, có trần per-socket **và** trần
global. Bỏ guard `session_busy` **lúc start** — và chỉ nó.

## Requirements

- Functional: N lượt (mặc định 3) song song trên một socket; vượt trần bị từ chối
  bằng lỗi mang `turnId` để client biết lượt nào.
- Non-functional: một lượt hỏng không kéo lượt khác chết theo; socket đóng thì
  mọi lượt của nó được dọn; tổng lượt đang dịch trên toàn tiến trình có trần.

## Architecture

`SessionRegistry` hiện là `Map<StreamSocket, TurnSession>`
(`session-registry.ts:17`). Thành `Map<StreamSocket, Map<string, TurnSession>>`.

`holds(socket, session)` là câu hỏi _"đây có còn là lượt tôi đã bắt đầu không"_ —
mọi công việc fire-and-forget hỏi nó trước khi ghi
(`translation-session.service.ts:97-99,182,250`; `live-preview.ts:62,127`). Với
nhiều lượt, ngữ nghĩa đúng là "lượt **này** còn trong bản đồ của socket này
không", **không phải** "socket này có lượt nào không". Hiểu sai chỗ này thì kết
quả của lượt đã bỏ sẽ ghi vào socket còn sống. `session-registry.ts` hôm nay
**không có spec riêng** — viết spec cho ngữ nghĩa này trước khi sửa.

### Ba nơi phát `session_busy`, chỉ gỡ một

| Vị trí                               | Ý nghĩa                                      | Số phận                                              |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| `translation-session.service.ts:63`  | chặn thay một lượt đang dịch, lúc `start()`  | **Gỡ** — bản đồ theo id làm nó không xảy ra được nữa |
| `translation-session.service.ts:146` | chặn `end()` hai lần trên cùng lượt          | **Giữ**                                              |
| `turn-session.ts:94`                 | frame đến sau khi lượt đã sang `translating` | **Giữ**                                              |

Tiêu chí cũ "không còn tham chiếu `session_busy` nào trong `src/`" sẽ xoá cả ba.
Hai guard sau bảo vệ những thứ khác hẳn: bỏ guard `end()` hai lần cho phép hai
pipeline chạy song song trên một lượt — hai lần tốn quota, hai dòng metrics, và
người nghe nghe câu đó hai lần. Bỏ guard frame cho phép frame nối thêm vào buffer
đang bị `end()` đọc sau `await`, làm `usableSpeculation()` và mọi dòng metrics
của lượt đó thành bất định — chính những dòng phase 6 và 8 dùng cho luận văn.

### `frame.sessionId` đang được kiểm tra, không bị bỏ qua

Bản trước của phase này viết rằng `frame.sessionId` hiện bị bỏ qua và đó là lý do
duy nhất audio hai lượt không lẫn nhau. **Sai.** `TurnSession.acceptFrame()` so
`frame.sessionId !== this.sessionId` và trả `frame_rejected`
(`turn-session.ts:98-103`). Audio không lẫn nhau nhờ một guard tường minh, có
test.

Sau khi `pushFrame` tra lượt theo `frame.sessionId`, phép so đó **trông** như
lặp thừa. **Giữ nó** làm phòng thủ nhiều lớp và ghi lý do vào code, nếu không lần
dọn dẹp sau sẽ xoá.

### Trần: hai tầng

```ts
/** Lượt một socket được mở cùng lúc. Trần công bằng giữa các socket. */
const MAX_CONCURRENT_TURNS_PER_SOCKET = 3;

/** Lượt đang dịch trên toàn tiến trình.
 *
 * Đây mới là trần tài nguyên. Sidecar STT/TTS là MỘT tiến trình dùng chung
 * (`LOCAL_STT_URL`, `LOCAL_TTS_URL`), nên một trần chia theo socket không
 * chặn được nó: hai socket, mỗi socket 3 lượt, là 6 inference song song mà
 * không trần nào bị chạm. Endpoint không auth nên số socket không bị chặn
 * bởi bất cứ thứ gì.
 */
const MAX_CONCURRENT_TURNS_GLOBAL = 6;
```

Vượt trần nào cũng trả `too_many_turns` kèm `turnId` (phase 2). Client phase 5
giữ audio lại và thử lại, không bỏ.

`MAX_TURN_BYTES` = 5,76 MB/lượt (`turn-audio.ts:21-22`) và comment ở đó nói trần
này bảo vệ _một socket không auth_. Với 3 lượt/socket, con số per-socket thành
17,28 MB. Sửa comment ở cả `turn-audio.ts` và `audio-frame.ts:8-17` để nói "per
socket, cộng mọi lượt của nó", và ghi rõ rằng nâng trần đồng thời là **đồng thời**
nâng trần bộ nhớ — phase 8 hiệu chỉnh dựa trên RTF, một con số CPU không nói gì
về bộ nhớ.

## Related Code Files

- Modify: `apps/api/src/modules/translate/session/session-registry.ts`
- Create: `apps/api/src/modules/translate/session/session-registry.spec.ts` — chưa từng có
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` (11 chỗ gọi registry: `.get` :60,:79,:122,:139 · `.open` :70 · `.close` :225,:311 · `.holds` :98,:182,:250)
- Modify: `apps/api/src/modules/translate/session/turn-session.ts` — **giữ** hai guard, thêm comment
- Modify: `apps/api/src/modules/translate/session/turn-audio.ts`, `packages/types/src/events/audio-frame.ts` — sửa comment về trần bộ nhớ
- Modify: `apps/api/src/modules/translate/translate.gateway.ts`
- Create: hằng số trần — cùng chỗ với các hằng số quota, mang theo lý do
- Test: `translation-session.service.spec.ts`, `translate.gateway.spec.ts`, `turn-session.spec.ts`, `apps/api/test/translate-ws-stream.e2e-spec.ts`

## Implementation Steps

1. Viết `session-registry.spec.ts` cho ngữ nghĩa `holds` **trước**: "lượt A đã
   đóng, lượt B còn sống → `holds(socket, A)` false, `holds(socket, B)` true".
2. `SessionRegistry` → bản đồ hai tầng: `get(socket, sessionId)`, `open`,
   `close(socket, sessionId)`, `closeAll(socket)`, `holds`, `count(socket)`,
   `countGlobal()`.
3. `start()`: gỡ guard `session_busy`; kiểm cả hai trần; dội `turnId` trong
   `ready` và trong `too_many_turns`.
4. `pushFrame()`: tra theo `frame.sessionId`; **giữ** phép so trong `acceptFrame`.
5. `speculate(socket, sessionId)`, `end(socket, sessionId)`.
6. Mọi `emit` gắn id (phase 2 đã mở đường).
7. `disconnect()` → `closeAll`.
8. Test mới:
   - hai lượt song song, cả hai nhận `ready` với `turnId` đúng
   - frame của lượt A không vào buffer lượt B, **và** frame mang id A gửi khi
     đang mở lượt B bị `frame_rejected`
   - lượt A `end` trong khi B nhận frame → B không ảnh hưởng
   - lượt thứ 4 trên một socket → `too_many_turns` kèm `turnId`
   - lượt thứ 7 trên toàn tiến trình (3+3+1) → `too_many_turns`
   - `disconnect` dọn cả ba lượt
   - lượt A lỗi, lượt B vẫn hoàn tất
   - `end()` gọi hai lần trên một lượt vẫn bị chặn
   - frame đến sau khi lượt sang `translating` vẫn bị chặn

## Success Criteria

- [ ] `pnpm --filter @chatofy/api test` xanh, gồm 9 test trên
- [ ] `session_busy` chỉ còn được phát từ `translation-session.service.ts:146` và `turn-session.ts:94`; guard `start()` đã đi
- [ ] `too_many_turns` luôn mang `turnId`
- [ ] Trần global chặn được 2 socket × 3 lượt + 1
- [ ] `e2e` chạy tay xanh
- [ ] `apps/web` không đổi hành vi

## Risk Assessment

- **`holds()` hiểu sai là lỗi im lặng.** Không test nào hôm nay ép đúng ngữ nghĩa
  vì chỉ có một lượt, và registry chưa từng có spec. Bước 1 là bắt buộc.
- **Trần đặt theo phỏng đoán.** 3/6 chỉnh sau phase 8. Nâng trần đồng thời cũng
  là nâng trần bộ nhớ — phải suy lại cả hai cùng lúc.
- **Endpoint không auth là tình trạng có sẵn**, không do phase này tạo ra, nhưng
  phase này nhân nó lên. Trần global là biện pháp trong phạm vi; auth thì không.
- **`SessionRegistry` là điểm chạm của mọi công việc fire-and-forget.** Sửa sai
  lan rộng và im lặng. Phase nên soi kỹ nhất phía server.
- **Rollback:** đi cùng phase 2 trên một nhánh.
