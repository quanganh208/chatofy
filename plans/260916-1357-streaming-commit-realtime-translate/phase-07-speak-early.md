---
phase: 7
title: 'Nói theo mệnh đề đã chốt — HOÃN'
status: dropped
gate: 'reports/speak-early-gate.md — PHÁN QUYẾT: DỪNG'
priority: P3
effort: '2d'
dependencies: [6]
---

# Phase 7: Nói sớm — **hoãn, không thi công trong đợt này**

## Trạng thái

**BỎ — 2026-09-16, sau khi đo.** Người dùng đã yêu cầu mở lại phase này sau khi
nghiệm thu Phase 6 đạt, tức cả bốn điều kiện tiên quyết dưới đây đều thoả. Cổng
đo chạy trước khi thi công và trả `PHÁN QUYẾT: DỪNG`:
`reports/speak-early-gate.md`.

Lý do quyết định, và nó không nằm trong ba lý do đã ghi bên dưới:
**chiều vi→en không bao giờ có mệnh đề đóng giữa lượt.** Bộ nhận dạng tiếng Việt
không phát dấu câu, `clause-splitter` tách trên `[,;:.!?…]`, nên cơ chế kích hoạt
của phase này không chạy được lần nào ở chiều chính của sản phẩm.
`live-translation-trigger.ts` đã ghi đúng sự thật đó cho luật mệnh đề ở Phase 4;
phase file này thì không, và đó là chỗ nó sai.

Một lối rẻ cũng đã được thử và bác: dùng lại bản dịch giữa câu mà Phase 4 đã trả
tiền, thay vì dịch riêng từng mệnh đề. Đo 8 cặp bản dịch liên tiếp — 1/8 giữ được
mệnh đề đầu, **0** mệnh đề nói sớm được an toàn, vì model viết lại câu từ đầu mỗi
khi có thêm ngữ cảnh. Một bản còn dịch `hôm qua tôi có đặt` thành _"Yesterday I
placed an order"_, sai nghĩa vì từ `phòng` chưa tới.

Mở lại phase này cần một trong bốn hướng ở cuối `reports/speak-early-gate.md`,
không phải chỉ cần người dùng đồng ý.

Phase này từng là Task 5.5–5.6 trong bản nháp đầu. Counsel giám sát chỉ ra rằng
nó **không phải phần đi kèm** của Phase 5 mà là một thay đổi kiến trúc riêng, và
kiểm chứng cho thấy đúng vậy. Lý do ở ngay dưới.

## Vì sao không thể gắn kèm Phase 5

### 1. Nó phá tính tái dùng của `TurnSpeculation`

`apps/api/src/modules/translate/session/turn-speculation.ts` đoán trước bản dịch
khi nghi lượt sắp kết thúc, và `usable(bufferedBytes)` chỉ cho tái dùng khi
**không có audio nào tới thêm** kể từ lúc đoán. Comment trong
`translation-model-policy.ts` ghi rằng **ba trong bốn lượt hiện đang tái dùng
được một lần đoán**, nên endpoint hiếm khi phải tự gọi.

Nếu mệnh đề đã được nói ra giữa chừng thì bản dịch cuối lượt không còn được phép
là bản dịch **cả lượt** — nó phải là bản dịch **phần đuôi chưa nói**. Nhưng bản
đoán trước lại là bản dịch cả lượt. Hai thứ không còn khớp byte, và tỉ lệ tái
dùng 3/4 sụp. Mất tái dùng nghĩa là **tăng số request** — đúng thứ Phase 4 đang
phải bóp vì trần RPD 500/model/ngày.

### 2. Dịch phần đuôi cần ngữ cảnh, nên không rẻ

Dịch riêng phần đuôi mà không cho model thấy phần đầu sẽ ra bản dịch sai mạch —
đại từ, thì, và chủ ngữ ẩn của tiếng Việt đều phụ thuộc phần trước. Nên request
đuôi vẫn phải mang ngữ cảnh, tức vẫn tốn token gần như bản đầy đủ, mà lại thêm
một request nữa.

### 3. Nó nới một quy tắc an toàn có chủ đích

`live-preview.ts:93-97`: _"a guess can be quietly replaced on screen, while a
guess spoken aloud cannot be taken back."_ Nới quy tắc này cần bằng chứng riêng
rằng phần chốt đủ chắc — tức ngưỡng G3 của Phase 1 phải đạt với biên rộng, không
phải vừa đủ.

## Điều kiện tiên quyết để mở lại phase này

Cả bốn phải đúng:

1. Phase 6 nghiệm thu xong và đạt.
2. `reports/measurement.md` ghi tỉ lệ mâu thuẫn chốt-so-với-bản-cuối **≤ 2%** —
   chặt hơn hẳn ngưỡng hủy 5% của Phase 1, vì ở đây sai thì phát ra loa.
3. `reports/acceptance.md` cho thấy còn dư địa RPD sau khi đo hội thoại thật.
4. Người dùng nghe thử bản chỉ-hiển-thị rồi nói rõ là vẫn muốn có tiếng sớm.

## Phác thảo việc phải làm, nếu mở lại

Không phải hướng dẫn thi công — chỉ đủ để ước lượng.

1. Thêm `speakEarly: boolean` vào `apps/web/src/lib/translate-settings.ts`, mặc
   định `false`, tách hẳn khỏi `voiceOutput`.
2. Đổi hợp đồng bản dịch cuối lượt thành **đuôi-có-ngữ-cảnh**: gửi cả lượt làm
   ngữ cảnh nhưng chỉ yêu cầu dịch phần chưa nói.
3. Xử lý `TurnSpeculation`: hoặc tắt hẳn speculation khi `speakEarly` bật, hoặc
   cho nó đoán đúng dạng đuôi. Tắt là lựa chọn đơn giản hơn và phải đo lại chi
   phí request.
4. Sổ theo dõi mệnh đề đã phát, đặt trong `TurnSession` cạnh `committer`.
5. Cập nhật comment `live-preview.ts:93-97` cho khớp hành vi mới.
6. Đo lại toàn bộ Phase 6 — đặc biệt là RPD, vì mục 3 có thể làm tăng request.

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
