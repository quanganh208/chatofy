---
phase: 5
title: 'Phát và hiển thị theo commit'
status: in_progress
priority: P1
effort: '2d'
dependencies: [4]
---

# Phase 5: Phát và hiển thị theo commit

## Overview

Bật `streaming` cho extension, hiển thị bản dịch nối dần, và **xác minh** rằng
lớp phát hiện có chịu được lượt sống lâu — thay vì cho rằng nó chịu được.

Phase này nhỏ hơn vẻ ngoài của nó, và lý do đáng ghi lại: đường audio **không cần
sửa**. `conversation-session.ts:555` map `frame.sessionId` → turnKey rồi đẩy vào
`OrderedPlayback`, không hề giả định audio tới sau `transcript.final`. Audio giữa
lượt đi đúng đường đó ngay hôm nay.

## Requirements

- Functional: extension chạy chế độ commit; overlay hiện bản dịch nối dần; thứ tự
  phát vẫn đúng theo thứ tự nói.
- Non-functional: không đổi hành vi web; không đụng đường Live.

## Architecture

**Ba chỗ chạm, không hơn.**

1. `direction-session.ts` bật `streaming: true` cho nhánh cascade. Ở đây, không ở
   `CapturePump` — file này tồn tại đúng để hai chiều không lệch cấu hình
   (`direction-session.ts:25`).
2. `conversation-session.ts` xử lý `server.translation.commit`: **nối**, không
   thay. Khác hẳn `translation.partial`.
3. `meeting-transcript.ts` hiển thị dòng nối dần, phân biệt với dòng partial tạm.

**Chỗ phải xác minh, không phải sửa.** `OrderedPlayback` có
`TURN_STALL_TIMEOUT_MS = 15_000`, tính **từ lần có tiến triển gần nhất**, không
phải ngân sách cả lượt (`ordered-playback.ts:39-58`). Lượt commit dài vẫn ra tiếng
đều nên `noteHeadProgress` được đẩy liên tục và watchdog không đụng tới. **Nhưng
điều đó phải có test khoá lại**, vì nó là thứ đúng do tình cờ chứ không do thiết
kế cho ca này — và comment trong file nói rõ đây đúng là loại lỗi đã hai lần lọt
vào `main` với mọi cổng xanh.

**Nới trần độ dài lượt — đây mới là thứ làm lượt sống lâu.** Commit tự nó
**không** kéo dài lượt: `MAX_UTTERANCE_MS = 8000` vẫn cắt như cũ. Nên nếu không
nới, tiêu chí chính của plan không kiểm chứng được (xem `plan.md` §Đính chính),
và cái giá của vết cắt 8s — MT mất ngữ cảnh qua từng mối — vẫn còn nguyên.

Nới cho **lượt streaming** về phía trần server (`MAX_TURN_SECONDS = 60`,
`turn-audio.ts:12` — server đã cho phép sẵn), giữ 8s cho lượt không streaming.

**Và vì nới nên phải suy lại hai trần ngay tại đây, không đợi phase 6:** lượt
sống lâu chiếm slot lâu (`MAX_CONCURRENT_TURNS_GLOBAL = 6`) và giữ buffer lâu
(`MAX_TURN_BYTES` × trần). Nâng trần độ dài mà không suy lại trần bộ nhớ là nâng
trần bộ nhớ mà không biết.

**Lượt streaming bị drop giữa chừng là ca mới, và nó tệ hơn trước.**
`OrderedPlayback.drop()` xoá lượt và `push()` vứt mọi frame sau đó của key không
còn biết (`ordered-playback.ts:219-230, :184`). Trước đây mất tối đa 8s nội dung.
Với lượt 60s, **một** lần watchdog bắn là im hết phần còn lại của đoạn — và nó
plausible: hai commit liên tiếp cùng dính đuôi MT (xấu nhất 8943ms + TTS + chờ
vế) đã sát `TURN_STALL_TIMEOUT_MS = 15_000`. `MAX_BACKLOG_MS = 12_000` cũng có
thể drop một lượt streaming đang xếp sau. Phải có spec ghim hành vi này lại, và
phase 6 phải đếm `dropped`.

## Related Code Files

- Modify: `apps/extension/src/direction-session.ts` — bật `streaming` cho nhánh
  cascade; nới `maxUtteranceMs` cho lượt streaming
- Modify: `apps/extension/src/meeting-capture.ts` — `direction-session.ts` không
  chạm `SessionOptions`; options đi từ caller → `ConversationSession.start()`,
  nên chỗ bật thật sự nằm ở đây (không chỉ ở spec)
- Modify: `packages/realtime-client/src/conversation/conversation-session.ts` — xử lý sự kiện commit
- Modify: `apps/extension/src/meeting-transcript.ts` — dòng dịch nối dần
- Modify: `apps/api/src/modules/translate/session/turn-concurrency.ts` — suy lại
  hai trần cùng trần bộ nhớ, kèm lý do mới ghi tại chỗ khai báo
- Create/Modify: `packages/realtime-client/src/audio/ordered-playback.spec.ts` —
  test lượt sống lâu **và** ca bị drop giữa chừng
- Modify: `apps/extension/src/meeting-capture.spec.ts` — chế độ cascade có `streaming`

## Implementation Steps

1. Xử lý `server.translation.commit` trong `conversation-session.ts` (nối, không thay).
2. Test `OrderedPlayback`: lượt nhận commit rải rác trong 30s **không** bị
   watchdog cắt, và lượt sau vẫn đợi đúng thứ tự. Test phải fail nếu bỏ
   `noteHeadProgress` ở đường commit.
   2b. Spec ca lượt streaming **bị drop giữa chừng**: ghim lại chuyện gì xảy ra với
   phần còn lại, để hành vi đó là lựa chọn có ý thức chứ không phải phát hiện
   muộn.
3. Bật `streaming: true` cho cascade (ở `meeting-capture.ts`, xem trên) và nới
   `maxUtteranceMs` cho lượt streaming. Suy lại hai trần đồng thời + trần bộ nhớ,
   ghi lý do vào chính hằng số.
4. Overlay: dòng bản dịch nối dần, phân biệt rõ với partial tạm (partial bị thay,
   commit thì không).
5. Chạy `pnpm --filter extension test` và `test:e2e`.
6. Nghe thật một cuộc họp. Kiểm ba thứ, không chỉ một:
   - tiếng ra **trong lúc** người kia còn đang nói;
   - **ducking có bị phập phù không** — `onBusy`/`onSounding`
     (`direction-session.ts:69-71`) giờ bật tắt vài giây một lần thay vì một lần
     mỗi lượt, nghe ra là tiếng nền phập phồng, và **không chỉ số nào bắt được**;
   - **chiều outbound**: bật cascade là bật cả hai chiều, nên bản dịch giữa câu
     cũng đi vào cuộc họp cho người khác nghe. Nói rõ kỳ vọng cho chiều này chứ
     đừng chỉ nghiệm thu chiều vào.

## Trạng thái (2026-08-14)

**Code xong.** Reducer nối dòng commit (`spoken: true` phân biệt với partial bị
thay); `OrderedPlayback` có test khoá lượt sống lâu ở nhịp commit thật (4s/vế
trong 32s) **và** ca hai vế liên tiếp cùng dính đuôi MT 14s; hành vi khi lượt bị
drop đã ghim; `CASCADE_STREAMING` bật cho cả hai chiều, `maxUtteranceMs` nới
8s → 45s cho lượt streaming; overlay mang cờ `spoken`.

**Hai trần đã suy lại — và câu trả lời ngược trực giác, nên ghi lại tại chính
hằng số** (`turn-concurrency.ts`):

- Trần đồng thời **không cần hạ**. Lượt cũ _chồng nhau_ vì đuôi trả lời ~2s của
  lượt này chạy trong lúc lượt sau đã bắt đầu thu — đó là chỗ slot thứ 2 và 3 đi.
  Lượt streaming gần như không có đuôi, nên người nói liên tục giữ **một** lượt
  dài thay vì hai ba lượt ngắn chồng nhau. Dài hơn, nhưng **ít hơn**.
- Tải STT **giảm**, không tăng: đường cũ decode lại cửa sổ 8s mỗi 300ms
  (~0,43s CPU / giây tường), streaming đọc mỗi khung đúng một lần (~0,20s).
- Trần bộ nhớ **không đổi**: `MAX_TURN_BYTES` vốn đã tính cho lượt 60s. Cái đổi
  là lượt bình thường giờ dùng gần hết mức đó thay vì một phần tám — trường hợp
  xấu nhất vẫn thế, chỉ là hết còn giả định.

**Chưa làm được, cần bạn:** bước 6 — nghe thật một cuộc họp. Ba thứ không chỉ số
nào bắt được: tiếng có ra **trong lúc** người kia còn nói không; **ducking có
phập phù không** (`onBusy`/`onSounding` giờ bật tắt vài giây một lần thay vì một
lần mỗi lượt); và **chiều outbound** — bật cascade là bật cả hai chiều, nên bản
dịch giữa câu cũng đi vào cuộc họp cho người khác nghe.

## Success Criteria

- [ ] Extension cascade phát tiếng **trong lúc** người nói chưa dứt câu — xác nhận bằng tai, ghi lại
- [x] Test khoá: lượt sống lâu nhận commit rải rác không bị watchdog cắt
- [x] Spec ghim hành vi khi lượt streaming bị drop giữa chừng
- [x] `maxUtteranceMs` nới cho lượt streaming; hai trần đồng thời và trần bộ nhớ
      được suy lại **ở phase này**, kèm lý do ghi tại hằng số
- [x] Thứ tự phát vẫn đúng khi hai lượt liền nhau
- [ ] Ducking không phập phù; kỳ vọng cho chiều outbound được nêu rõ
- [x] Overlay phân biệt được dòng đã commit và dòng partial
- [x] Test extension + e2e xanh
- [x] Web không đổi hành vi

## Risk Assessment

- **Lượt sống lâu ăn slot.** Đã biết trước, đo ở phase 6. Nếu chạm trần sớm hơn dự
  kiến, tín hiệu là `too_many_turns` trong log; phản ứng là chỉnh trần **kèm** suy
  lại trần bộ nhớ, không chỉ nhìn RTF.
- **Rủi ro dựa trên giả định:** giả định "audio giữa lượt đi đúng đường sẵn có"
  đã được đọc từ code nhưng **chưa chạy thật**. **Tín hiệu:** bước 6 không nghe
  thấy tiếng, hoặc thứ tự sai. **Phản ứng đã định:** đó là lỗi ở lớp join
  `pipeline.turnIdFor`, sửa tại chỗ, không đổi thiết kế server.
- **Rollback:** đổi `streaming` về `false` ở `direction-session.ts` là về hành vi
  cũ ngay, không cần revert gì khác.
