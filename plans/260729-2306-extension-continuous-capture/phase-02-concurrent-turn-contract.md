---
phase: 2
title: 'Concurrent turn contract'
status: done
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 2: Concurrent turn contract

## Overview

Hợp đồng WS hiện giả định "một socket có đúng một lượt", nên phần lớn event
không mang `sessionId`. Phase này thêm định danh lượt vào cả hai chiều để nhiều
lượt chạy song song trên một socket mà client vẫn phân biệt được.

## Requirements

- Functional: mọi event thuộc về một lượt cụ thể đều mang định danh lượt — **kể
  cả lỗi từ chối mở lượt**, vốn xảy ra trước khi lượt tồn tại.
- Non-functional: `apps/web` cập nhật trong cùng phase, hành vi một-lượt giữ nguyên.

## Architecture

Hiện trạng, đọc từ `packages/types/src/events/ws-events.ts`:

| Event                        | Mang sessionId?            |
| ---------------------------- | -------------------------- |
| `client.session.start`       | Không                      |
| `client.audio.frame`         | **Có** — `frame.sessionId` |
| `client.turn.speculate`      | Không                      |
| `client.session.end`         | Không                      |
| `server.session.ready`       | **Có**                     |
| `server.transcript.partial`  | Không                      |
| `server.translation.partial` | Không                      |
| `server.transcript.final`    | Không                      |
| `server.audio.frame`         | **Có** — `frame.sessionId` |
| `server.session.ended`       | Không                      |
| `server.error`               | Không                      |

Audio đã định tuyến được sẵn cả hai chiều. Phần thiếu là điều khiển và văn bản.

### `turnId` là bắt buộc, không phải tiện ích

Với hai `client.session.start` bay cùng lúc, client không biết
`server.session.ready` nào ứng với start nào. Nhưng lý do nặng hơn nằm ở đường
lỗi: phase 3 từ chối lượt thứ N+1 **trong `start()`, trước khi `TurnSession` được
tạo** (`translation-session.service.ts:56-76`), nên không có `sessionId` nào để
gắn. Nếu `server.error` chỉ mang `code` + `message`, client nhận
`too_many_turns` mà không biết lượt nào bị từ chối — và lớp sắp thứ tự ở phase 5
đã cấp số cho lượt đó rồi, nên nó sẽ chờ một lượt không bao giờ tới và **hàng đợi
phát kẹt vĩnh viễn**.

```ts
// client.session.start
{ type: 'client.session.start', direction, voiceGender,
  turnId: string }            // client sinh; z.string().max(64)

// server.session.ready
{ type: 'server.session.ready', sessionId, turnId }

// server.error — turnId cho lỗi thuộc lượt chưa có sessionId,
// sessionId cho lỗi thuộc lượt đã mở, cả hai optional cho lỗi cấp kết nối
{ type: 'server.error', code, message, sessionId?, turnId? }

// server.session.ended — mang cả hai, để client đóng được lượt
// dù nó chưa kịp biết sessionId
{ type: 'server.session.ended', reason, sessionId, turnId }
```

`turnId` phải bị chặn độ dài. Mọi số client gửi lên đã bị chặn
(`audio-frame.ts:14-17`, `turn-audio.ts:19-22` — "the socket is unauthenticated");
một chuỗi không chặn được server dội lại là ngoại lệ duy nhất.

### `EventChannel` là chỗ khó nhất

`EventChannel` cố ý **không giữ state lượt nào** — `ended(reason)` dựng
`server.session.ended` mà không có id trong tay (`event-channel.ts:44-46`). Thêm
`sessionId` bắt buộc buộc phải truyền id qua 14 chỗ gọi `channelFor(socket)`.
Hai lựa chọn, chọn một và ghi lý do vào code: cho `channelFor(socket, session)`
trả về một channel đã gắn lượt, hoặc thêm tham số vào từng method. Cách đầu ít
chỗ gọi phải sửa hơn và giữ được ý "channel không tự bịa id".

### Tách phase 2 / phase 3 là để làm gì

Không phải để rollback độc lập — lý do đó **sai** và đã bị bỏ:
`translation-session.service.ts` và `live-preview.ts` **phát** chính các event
được thêm field bắt buộc, nên chúng phải sửa ngay ở phase 2 mới typecheck được.
Tách ra vì phạm vi khác nhau: phase 2 là hợp đồng và các chỗ phát; phase 3 là ngữ
nghĩa registry. Cả hai cùng nằm trên một nhánh và ship cùng nhau.

## Related Code Files

12 consumer, không phải 4:

- `packages/types/src/events/ws-events.ts` — định nghĩa
- `packages/types/src/events/index.ts` — barrel re-export
- `apps/api/src/modules/translate/translate.gateway.ts` — `safeParse`, chuyển id xuống
- `apps/api/src/modules/translate/session/event-channel.ts` — `emit` / `fail` / `ended`
- `apps/api/src/modules/translate/session/event-channel.spec.ts`
- `apps/api/src/modules/translate/session/live-preview.ts:68,132` — hai chỗ `emit`
- `apps/api/src/modules/translate/session/outbound-audio-framer.ts:59`
- `apps/api/src/modules/translate/services/translation-session.service.ts:75,184,312`
- `apps/api/test/translate-ws-stream.e2e-spec.ts:151-217` — **CI chạy `turbo run test`, không chạy `test:e2e`, nên file này vỡ im lặng**
- `packages/realtime-client/src/transport/translate-socket.ts`
- `packages/realtime-client/src/conversation/conversation-session.ts` + `.spec.ts`
- `packages/realtime-client/src/conversation/fake-audio-context.ts:138-150`
- `packages/realtime-client/src/audio/pipeline-latency.measure.spec.ts:154,172,178`
- `apps/web/src/state/conversation-state.ts:52,62-84` + `.spec.ts`

`SessionOptions` **không** được nới rộng: `turnId` đi cạnh nó, không nằm trong
nó. Gateway destructure `{ direction, voiceGender }` rồi dựng lại object
(`translate.gateway.ts:40-44`), nên `TurnSession`'s constructor giữ nguyên. Nếu
nhét `turnId` vào `sessionOptionsSchema` thì thêm 6 chỗ nữa phải sửa.

## Implementation Steps

1. `turnId: z.string().max(64)` vào `clientSessionStartSchema`.
2. `sessionId: z.string()` vào `clientTurnSpeculateSchema`, `clientSessionEndSchema`.
3. `turnId` vào `serverSessionReadySchema` (bắt buộc).
4. `sessionId` bắt buộc vào `serverTranscriptPartialSchema`,
   `serverTranslationPartialSchema`, `serverTranscriptFinalSchema`;
   `sessionId` + `turnId` vào `serverSessionEndedSchema`; cả hai optional vào
   `serverErrorSchema`.
5. `EventChannel` gắn lượt (xem Architecture); sửa 14 chỗ `channelFor`.
6. `live-preview.ts`, `outbound-audio-framer.ts`, `translation-session.service.ts`
   truyền id vào mọi `emit`.
7. `TranslateSocket`: `startSession` sinh và trả `turnId`; `speculate(sessionId)`,
   `endSession(sessionId)`.
8. `ConversationSession` giữ hành vi một-lượt, chỉ chuyền id.
9. Sửa `fake-audio-context.ts`, `conversation-state.ts` (bỏ qua id ở bản
   một-dòng), và 4 file spec/e2e.
10. Chạy `pnpm test`, `pnpm typecheck`, và **`pnpm --filter @chatofy/api test:e2e`
    bằng tay** — CI không chạy nó.

## Success Criteria

- [ ] `pnpm typecheck` xanh toàn workspace
- [ ] `pnpm test` xanh; `test:e2e` chạy tay xanh
- [ ] `apps/web` dịch một lượt thành công bằng tay, hành vi không đổi
- [ ] Mọi `server.*` thuộc lượt đều mang id; `server.error` mang `turnId` khi lỗi xảy ra trước khi lượt tồn tại
- [ ] `SessionOptions` không đổi hình dạng

## Risk Assessment

- **`event-channel.ts` mâu thuẫn với thiết kế cũ của chính nó.** Class cố ý không
  giữ state lượt; giờ phải giữ. Ghi lý do mới vào file, đừng để lại comment cũ
  nói ngược.
- **e2e vỡ im lặng** vì CI không chạy `test:e2e`. Chạy tay là bước bắt buộc, không
  phải khuyến nghị.
- **Client cũ.** `serverEventSchema.safeParse` thất bại thì client **bỏ cả event**
  (`translate-socket.ts:65-70`), gồm `server.session.ended` — tab cũ sẽ treo ở
  trạng thái "translating" chứ không báo lỗi. Không có deploy nguyên tử giữa
  `apps/api` và `apps/web`. Giảm thiểu: giữ trường client→server ở dạng optional
  phía **server** (server suy ra lượt duy nhất của socket khi thiếu), và chỉ siết
  ở client. Không bao giờ siết một trường client→server thành bắt buộc phía server.
- **Rollback:** revert được cùng phase 3 trên một nhánh; revert riêng phase 2 sẽ
  làm phase 3 không typecheck.
