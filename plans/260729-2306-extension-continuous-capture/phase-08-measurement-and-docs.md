---
phase: 8
title: 'Measurement and docs'
status: pending
priority: P1
effort: '1.5d'
dependencies: [6, 7]
---

# Phase 8: Measurement and docs

## Overview

Chạy các phép đo trong tiêu chí nghiệm thu, biến chúng thành số cho luận văn, và
sửa những chỗ tài liệu đã sai vì extension từ non-goal thành chức năng.

Phase này là nơi chức năng có bằng chứng. Không có nó thì extension chạy được
nhưng không bảo vệ được.

## Requirements

- Functional: đủ số cho cả 11 tiêu chí nghiệm thu trong `plan.md`.
- Non-functional: mọi số tái lập được từ script đã commit, theo thông lệ bảng
  "Nguồn dữ liệu gốc" ở `development-journey.md` mục 12.

## Architecture

Bốn phép đo, dùng chung JSONL từ phase 6.

**1. Coverage.** Mẫu số **phải** độc lập với gate của mình. Dùng bản ghi cố định:
phát một file 3 phút vào tab; thời lượng có speech lấy từ `vad-reference.mjs`
(phase 4) chạy offline trên chính file đó. Tử số cộng `capturedMs` của **mọi**
lượt kể cả `rejected`/`dropped`/`error` — nếu chỉ cộng lượt phát thành công thì
con số đo tỉ lệ phát, không phải độ phủ thu.

**2. Độ trôi tích luỹ.** `firstAudioPlayedAt − speechStartedAt` theo lượt, vẽ theo
thời gian, đọc ở mốc 1 / 3 / 5 phút. Câu hỏi: đường này phẳng hay dốc lên. Dốc
lên = hàng đợi nở; ghi nhận là hướng phát triển, không giải quyết ở đây.

**3. Req/phút — theo từng model, không cộng gộp.** Free tier đo per model.
`gemini-3.5-flash-lite` nhận live + final; `gemini-3.1-flash-lite` nhận
speculation. Mỗi model trần 15/phút. **Dự kiến cả hai vượt trần** (xem plan.md
§Rủi ro) cho tới khi có rotate key. Nên phép đo này sẽ ghi nhận lượt fail — đó là
**dữ liệu, không phải bug**, và report phải nói rõ để người đọc sau không truy
nhầm nguyên nhân.

**4. Vọng âm khi phát qua loa.** Đếm `onEchoHeard` trong 3 phút, chạy hai lần: một
lần tai nghe (đối chứng, kỳ vọng 0), một lần loa. Ghi âm lượng loa, khoảng cách
mic–loa, thiết bị — thiếu nó thì lần đo sau không so sánh được, đúng bài học đã
ghi ở mục 10 ý 1.

**5. Oversubscription — qua nhiều socket, không chỉ nhiều lượt.** Món nợ ở mục 10
ý 4 là "chưa đo hành vi đa **người dùng**". Đo RTF sidecar với 1 / 2 / 3 socket ×
3 lượt, để hiệu chỉnh `MAX_CONCURRENT_TURNS_GLOBAL`. Đo 3 lượt trên một socket trả
lời câu khác.

**Dùng bản ghi, không dùng họp thật, cho mọi phép đo** — mục 12 đòi mọi số phải
sinh lại được.

## Related Code Files

- Create: `benchmarks/realtime/analyze-continuous.mjs`
- Create: `benchmarks/realtime/README.md` nếu chưa có
- Modify: `docs/project-overview-pdr.md` — bỏ "Browser extension" khỏi _Out of MVP_ (đang ở dòng 20-22)
- Modify: `docs/system-architecture.md` — **thêm** đường extension và mô tả ràng buộc theo kịch bản. Lưu ý: file này (463 dòng) **không chứa** chữ "duplex" ở bất kỳ dạng nào, nên đây là viết mới, không phải sửa mô tả có sẵn. Mô tả half-duplex thật sự nằm ở `capture-pump.ts:28-37` và `development-journey.md`.
- Modify: `docs/codebase-summary.md` — package mới + app mới
- Modify: `docs/development-journey.md` — mục 10 ý 2 đã trả (kênh metrics client); ý 4 đã đo; ý 1 vẫn nợ **cho mobile**, nhưng phần đếm vọng âm đã có số từ extension
- Modify: `README.md` — cấu trúc repo, cách chạy extension
- Create: `plans/reports/measure-{date}-continuous-capture.md`

## Implementation Steps

1. Chuẩn bị bản ghi 3 phút và 5 phút: hội thoại tiếng Anh liên tục, ít khoảng
   nghỉ. Dùng lại `benchmarks/realtime/generate-fixtures.mjs` nếu hợp.
2. Chạy `vad-reference.mjs` lấy mẫu số coverage.
3. Chạy extension trên bản ghi, thu JSONL. **Đo req/phút ngay ở lần chạy đầu** để
   biết còn bao nhiêu lần chạy nữa trong ngày.
4. Đo RTF sidecar với 1/2/3 socket × 3 lượt.
5. Đo vọng âm: tai nghe (đối chứng) rồi loa.
6. Viết script phân tích, in bảng.
7. Viết report kèm **điều kiện đo**: máy, thiết bị ra, âm lượng, bản ghi nào, ngày,
   và số lượt fail vì quota.
8. Cập nhật docs theo danh sách trên.
9. Hiệu chỉnh `maxUtteranceMs`, `MAX_CONCURRENT_TURNS_PER_SOCKET`,
   `MAX_CONCURRENT_TURNS_GLOBAL` theo số đo, ghi lý do mới vào chính hằng số đó.
   **Nâng trần đồng thời là đồng thời nâng trần bộ nhớ** (`MAX_TURN_BYTES` ×
   trần) — suy lại cả hai, đừng chỉ nhìn RTF.

## Success Criteria

- [ ] Coverage ≥ 95%, mẫu số từ VAD offline, tử số gồm mọi `outcome`
- [ ] Đường độ trôi ở mốc 1 / 3 / 5 phút, kết luận rõ phẳng hay dốc
- [ ] Req/phút thực đo **tách theo model**, đối chiếu trần 15 của từng model
- [ ] Số lượt fail vì quota được ghi rõ là hệ quả đã biết trước, kèm điều kiện
- [ ] RTF sidecar ở 1/2/3 **socket**; hai trần đồng thời được xác nhận hoặc chỉnh
- [ ] Số `onEchoHeard` cho cả tai nghe lẫn loa, kèm điều kiện đo
- [ ] Report ghi đủ điều kiện đo
- [ ] Docs không còn chỗ nào nói extension là out-of-scope
- [ ] Mọi số tái lập được bằng lệnh đã commit

## Risk Assessment

- **Quota đủ cho bao nhiêu lần đo.** Ở req/phút hiện tại, mỗi lần chạy 3 phút ăn
  một phần lớn hạn mức ngày. Lên lịch đo **khác ngày** với demo bảo vệ, và đo
  req/phút ở lần chạy đầu.
- **Coverage tự khen mình** nếu mẫu số lấy từ gate của chính mình, hoặc nếu tử số
  chỉ cộng lượt phát thành công. Đã phòng cả hai.
- **Số xấu vẫn phải ghi.** Độ trôi dốc lên, hay lượt fail vì quota, là kết quả chứ
  không phải thất bại — repo đã có tiền lệ ghi cái giá bên cạnh cái lợi
  (`TurnMetrics.speculations` tồn tại chính vì thế). Đừng chỉnh phép đo cho số đẹp.
- **Docs dễ bị bỏ quên** vì phase cuối. Nhưng PDR đang nói sai về phạm vi sản phẩm
  và hội đồng có thể đọc nó.
- **Rollback:** phase này đốt quota không lấy lại được và sửa docs evergreen. Sửa
  docs revert được; quota thì không.
