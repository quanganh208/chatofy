---
phase: 3
title: Sàng chất lượng
depends-on: phase-02
gpu: chỉ khi trigger Phase 1 bật
outputs: bảng WER/CER và attribution đầy đủ
---

# Phase 3 — Sàng chất lượng

## Bối cảnh

Chất lượng không phụ thuộc phần cứng, nên pha này chạy được ở đâu cũng cho cùng
kết quả. Đây là pha duy nhất GPU có thể tham gia, và chỉ khi Phase 1 đã bật
trigger và người dùng đã đồng ý.

## Yêu cầu

Mỗi ứng viên sống sót Phase 1 phải có đủ sáu số, đo trên **cùng** bộ test với arm
đối chứng, **cùng** run-tag, **cùng** seed 42.

| Số                    | Bộ test                        | Ngưỡng của thanh chắn |
| --------------------- | ------------------------------ | --------------------- |
| WER vi                | VIVOS-50                       | **≤ 5,38%**           |
| CER vi                | VIVOS-50                       | ≤ 2,90%               |
| WER en                | bộ en của r1                   | ≤ 3,86%               |
| Attribution sạch      | cuộc họp mô phỏng              | **> 0,78**            |
| Attribution far-field | qua `speaker_bench/augment.py` | > 0,59                |
| Tỉ lệ lượt vùng chết  | cùng phiên                     | < 1/3                 |

Với model joint, đo **cả hai cấu hình** vì người dùng đã chấp nhận server-side:
nhãn người nói lấy thẳng từ model, và — nếu model cũng xuất embedding — nhãn lấy
từ đường browser hiện tại. Chênh lệch giữa hai cấu hình là con số trả lời "đổi
tính riêng tư lấy được bao nhiêu độ chính xác".

## Files

**Tạo:** `benchmarks/stt/results/r4-streaming/`,
`benchmarks/speaker-id/results/r4-streaming/`,
`plans/260916-1054-streaming-asr-diarization-benchmark/reports/quality.md`.

**Không đụng:** `results/r1`, `results/r2`, `results/r3-decoder-arms`, và mọi
`summary.json` cũ (R6).

## Các bước

1. Chạy arm đối chứng **lại**, trong cùng run-tag với các ứng viên. Đối chứng ở
   Phase 2 là để kiểm harness; đối chứng ở đây là để so.
2. Chạy từng ứng viên, một ngôn ngữ một lần, ghi log đầy đủ.
3. Với ứng viên có nhiều chunk size, đo **ít nhất hai** (nhỏ nhất và một cỡ
   trung). WER giảm đơn điệu theo chunk, nên chunk nhỏ là mua độ trễ bằng độ
   chính xác — bảng phải cho thấy đường đánh đổi đó chứ không chỉ một điểm.
4. Chạy arm diarization trên manifest dùng chung.
5. Ghi bảng. **Không** loại ai ở pha này ngoài ứng viên crash — việc loại thuộc
   Phase 5.

## Xác minh

```bash
cd benchmarks/stt && uv run python run_benchmark.py --run-tag r4-streaming \
  --report-out ../../plans/260916-1054-streaming-asr-diarization-benchmark/reports/quality-stt.md
cd benchmarks/speaker-id && uv run python run_joint_diarization.py --run-tag r4-streaming
git status --short benchmarks/*/results/r1 benchmarks/*/results/r2   # phải rỗng
```

Pass khi: mọi ứng viên có đủ sáu số hoặc một lý do crash ghi lại được; arm đối
chứng trong cùng run-tag tái lập mốc nền; không kết quả cũ nào bị đụng.

## Rủi ro

**So sai bộ test.** Số công bố của model card đo trên FLEURS, mốc của repo đo
trên VIVOS. Trộn hai cột là cách dễ nhất để ra kết luận sai. Giảm thiểu: bảng chỉ
chứa số **do pha này sinh ra**; số công bố nếu có mặt thì ở một bảng riêng, có
nhãn rõ, và không bao giờ nằm cùng cột.

**FLEURS nằm trong dữ liệu huấn luyện.** Không dùng FLEURS để hiệu chuẩn — nó có
mặt trong tập huấn luyện của cả incumbent lẫn nhiều ứng viên. VIVOS-50 là bộ so
duy nhất hợp lệ.

**Chạy smoke với `--limit` ghi đè kết quả đã lưu (R6).** Mọi smoke run phải trỏ
run-tag riêng, ví dụ `r4-smoke`.

## Rollback

Xoá thư mục `results/r4-*`. Kết quả cũ không bị đụng theo thiết kế.
