---
phase: 5
title: Ma trận quyết định và ghi kết quả
depends-on: phase-04
gpu: không
outputs: phán quyết, báo cáo, cập nhật docs nếu có thay đổi
---

# Phase 5 — Quyết định

## Bối cảnh

Mọi số đã có. Pha này chỉ đọc chúng, áp thanh chắn đã chốt, và ghi lại — kể cả
khi câu trả lời là không ai qua.

## Yêu cầu

Áp đúng thanh chắn người dùng đã chốt: **thắng cả hai trục**.

```
PASS  ⟺  WER_vi ≤ 5,38%  ∧  attribution_sạch > 0,78  ∧  RTF@4t ≤ 0,30
```

Ba bảng, theo thứ tự này:

1. **Bảng phán quyết** — mỗi ứng viên một dòng, pass/fail từng cổng, kết luận.
2. **Bảng đầy đủ** — mọi số đo được, kể cả của ứng viên đã trượt. Đây là bảng có
   giá trị lâu dài; bảng 1 chỉ là cách đọc nó.
3. **Bảng bị loại ở Phase 1** kèm lý do, để người sau không khảo sát lại.

Nếu **không ai qua**, báo cáo phải trả lời thêm hai câu bằng dữ liệu đã có, không
cần chạy lại:

- Ứng viên nào **gần nhất**, và thiếu ở trục nào bao nhiêu.
- Cấu hình **lai** có qua không: model streaming lo bản partial, incumbent
  Zipformer/Moonshine lo bản final. Trục WER lúc đó thuộc về incumbent, nên câu
  hỏi rút về "attribution có > 0,78 không" và "tổng RTF hai model có ≤ 0,30
  không". Cả hai số đều đã đo ở Phase 3 và 4.

## Files

**Tạo:**

- `plans/260916-1054-streaming-asr-diarization-benchmark/reports/decision.md`

**Sửa, chỉ khi phán quyết dẫn tới thay đổi thật:**

- `docs/development-journey.md` — thêm mục ghi phép đo, **kể cả khi âm tính**.
  Repo đã có đúng khuôn mẫu này cho PhoWhisper (`:186`) và cho streaming TTS
  callback (`:916-925`).
- `docs/system-architecture.md` — **chỉ** khi model thắng và sẽ thay tầng speaker,
  vì mục "automatic audio diarization remains out of scope" (`:659-660`) sẽ không
  còn đúng.

**Không sửa** nếu phán quyết là "giữ nguyên": khi đó `development-journey.md` là
nơi duy nhất cần ghi.

## Các bước

1. Dựng ba bảng.
2. Áp thanh chắn. Không nới, không làm tròn có lợi.
3. Nếu không ai qua, trả lời hai câu hỏi phụ ở trên.
4. Ghi vào `development-journey.md` theo văn phong sẵn có: số, điều kiện đo, và
   kết luận — không tô hồng kết quả âm tính.
5. Báo cáo cho người dùng: phán quyết, ứng viên gần nhất, và bước tiếp theo đề
   xuất.

## Xác minh

```bash
git diff --name-only   # chỉ plans/, docs/ — KHÔNG apps/ packages/ services/
```

Pass khi: ba bảng đầy đủ; mỗi số truy được về một lệnh chạy lại được; N1–N6 trong
`plan.md` đều thoả; không file sản phẩm nào bị sửa.

## Rủi ro

**Nới thanh chắn cho có người thắng.** Thanh chắn do người dùng chốt sau khi đã
được cho xem số. Nếu dữ liệu cho thấy nó quá chặt, cách xử lý là **trình bày
trade-off và hỏi**, không phải tự hạ ngưỡng — đúng theo
`.claude/rules/review-audit-self-decision.md`.

**Kết quả âm tính bị coi là thất bại.** Không phải. Một phép đo phủ định ghi lại
tử tế là chương so sánh hợp lệ của luận văn, và repo đã hai lần làm đúng như vậy.

## Rollback

Revert thay đổi docs. Báo cáo trong `plans/` giữ lại — nó là bản ghi trạng thái,
không phải tài liệu sản phẩm.
