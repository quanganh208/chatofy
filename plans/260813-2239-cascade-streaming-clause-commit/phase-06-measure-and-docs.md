---
phase: 6
title: 'Đo lại, chốt hằng số, docs'
status: pending
priority: P1
effort: '3d'
dependencies: [5]
---

# Phase 6: Đo lại, chốt hằng số, docs

## Overview

Chạy lại ma trận của phase 1 trên đường mới, đối chiếu với đường nền, chốt các
hằng số bằng số đo, và trả lời câu hỏi còn treo về MT local bằng dữ liệu thay vì
bằng phỏng đoán.

Đây là nơi chức năng có bằng chứng. Không có nó thì chức năng chạy được nhưng
không bảo vệ được.

## Requirements

- Functional: đủ số cho mọi tiêu chí nghiệm thu trong `plan.md`.
- Non-functional: mọi số tái lập bằng lệnh đã commit; report ghi đủ điều kiện đo.

## Architecture

**Chỉ số quyết định là hằng số chặn, không phải p50.** Vẽ độ trễ tới tiếng dịch
đầu tiên theo **độ dài đoạn nói lấy từ `vad-reference.mjs`** (không phải độ dài
lượt — trần 8s ép nó phẳng sẵn), đường nền và đường mới trên cùng một trục.
Đường nền **chững ở ~9,2s**; đường mới phải phẳng **và thấp hơn hẳn** — hằng số
chặn ~2s. Một con số p50 gộp che mất đúng cái đang cần chứng minh, nên report
phải có bảng theo nhóm độ dài, không chỉ một số.

**Ba câu hỏi phải trả lời bằng số**, không bằng cảm nhận:

1. **Đuôi MT có làm nghẹn dòng không?** Đếm và tổng thời lượng lỗ im lặng trong
   lúc còn text đã commit chưa phát. Đây là con số quyết định câu hỏi treo số 1
   trong `plan.md`. Nếu lỗ nhiều tới mức nghe thấy, mở lại phương án MT local cho
   _phần phát ra tiếng_, giữ Gemini cho transcript hiển thị.
2. **Free tier có sống nổi không?** Req/phút **tách theo model**, cộng số req/ngày
   thực đo, suy ra một phiên nói liên tục chạy được bao lâu.
3. **Trần đồng thời đã suy lại ở phase 5 có đúng không?** Phase 5 đã nới
   `maxUtteranceMs` và suy lại hai trần trên giấy; ở đây là **xác nhận bằng số**.
   Đo RTF sidecar với 1/2/3 socket. **Nâng trần đồng thời là nâng cả trần bộ nhớ**
   (`MAX_TURN_BYTES` × trần) — kiểm cả hai, đừng chỉ nhìn RTF.

Và một câu hỏi về chất lượng, đo được nhưng không sửa được: **so bản đã nói ra
với bản dịch offline cả lượt** của cùng đoạn audio. Chênh lệch chính là cái giá
của việc commit sớm. Ghi số, đừng giấu.

**Dùng bản ghi, không dùng họp thật**, cho mọi phép đo — mọi số phải sinh lại được.

## Related Code Files

- Modify: `benchmarks/realtime/analyze-continuous.mjs` — so đường nền với đường mới
- Modify: hằng số theo số đo, **ghi lý do mới vào chính hằng số đó** theo thông lệ repo:
  - `apps/api/src/modules/translate/session/turn-concurrency.ts`
  - `apps/extension/src/direction-session.ts` (`MAX_UTTERANCE_MS` — xác nhận lại giá trị đã nới ở phase 5)
  - ngưỡng agreement ở `apps/api/src/modules/translate/audio/stable-prefix-commit.ts`
- Modify: `docs/system-architecture.md` — §Streaming Turn hiện mô tả đường cũ
  (dòng ~316-360: "does not make the translation arrive any sooner", "No audio is
  ever synthesized from it"). Cả hai câu **sẽ sai** sau plan này. Phải viết lại,
  không phải thêm vào.
- Modify: `docs/codebase-summary.md` — module mới
- Modify: `docs/development-journey.md` — ghi lại phép đo và cái giá đã chọn trả
- Modify: `README.md` — nếu mô tả cascade đổi
- Create: `plans/reports/measure-{date}-cascade-streaming-commit.md`

## Implementation Steps

1. Chạy lại toàn ma trận phase 1 trên đường mới. Đo req/phút ngay lần chạy đầu.
2. Vẽ hằng số chặn + độ dốc theo độ dài đoạn nói (trục x từ `vad-reference.mjs`), đường nền vs đường mới.
3. Đếm lỗ liên tục và vế bị lật.
4. Đo RTF sidecar 1/2/3 socket; chốt hoặc chỉnh hai trần đồng thời.
5. So bản đã nói với bản dịch offline cả lượt; ghi chênh lệch.
6. Chốt hằng số, ghi lý do và số đo vào chính chỗ khai báo.
7. Trả lời hai câu hỏi treo còn lại trong `plan.md` bằng số (câu 3 đã chốt ở phase 5). Nếu câu 1 nghiêng về MT
   local, **viết thành plan riêng**, đừng nhét vào plan này.
8. Sửa docs, **ưu tiên §Streaming Turn** vì nó sẽ sai chứ không chỉ thiếu.

## Success Criteria

- [ ] Hằng số chặn + độ dốc theo **độ dài đoạn nói**: đường nền (chững ~9,2s) và
      đường mới (~2s), kết luận rõ ràng
- [ ] Từ → tiếng nói p50 **và p95**, kèm bảng theo nhóm độ dài
- [ ] **Khoảng cách dài nhất giữa hai lần commit khi vẫn còn speech**, theo từng
      fixture — chỉ số bắt "commit chết đói"
- [ ] Số vế bị lật trên toàn ma trận (kỳ vọng 0; nếu > 0 thì ghi rõ ca nào)
- [ ] Lỗ liên tục: số lần + tổng thời lượng
- [ ] Số lượt `dropped` ≈ 0; nếu > 0 thì ghi rõ mất bao nhiêu giây nội dung
- [ ] Coverage ≥ 99%, mẫu số từ `vad-reference.mjs`, tử số gồm mọi outcome
- [ ] Req/phút tách theo model + số req/ngày + thời lượng phiên chạy được
- [ ] RTF 1/2/3 socket; hai trần đồng thời được xác nhận hoặc chỉnh, kèm trần bộ nhớ
- [ ] Chênh lệch giữa bản đã nói và bản dịch offline được ghi
- [ ] Hai câu hỏi treo còn lại có câu trả lời bằng số
- [ ] `docs/system-architecture.md` §Streaming Turn không còn câu nào sai
- [ ] Report ghi đủ điều kiện đo: máy, thiết bị, âm lượng, fixture, ngày, số lượt fail vì quota

## Risk Assessment

- **Quota đủ cho bao nhiêu lần đo.** Mỗi lần chạy ăn phần lớn hạn mức ngày. Đo
  req/phút ở lần chạy đầu; xếp lịch khác ngày với hôm demo.
- **Số xấu vẫn phải ghi.** Lỗ im lặng, vế bị lật, chênh lệch chất lượng — đều là
  kết quả. Repo đã có tiền lệ ghi cái giá bên cạnh cái lợi
  (`TurnMetrics.speculations` tồn tại chính vì thế). **Đừng chỉnh phép đo cho số đẹp.**
- **Docs dễ bị bỏ quên** vì là phase cuối. Nhưng lần này docs không chỉ thiếu mà
  **sai**: §Streaming Turn đang khẳng định những điều plan này lật ngược.
- **Rollback:** phase này sửa hằng số và docs evergreen. Docs revert được; hằng số
  revert được; quota thì không.
