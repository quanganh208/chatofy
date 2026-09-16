---
phase: 4
title: Chi phí CPU trên máy đích
depends-on: phase-03
gpu: KHÔNG — pha này bắt buộc chạy CPU
outputs: bảng RTF/RAM ở 4 và 8 thread, có và không có TTS chạy cùng
---

# Phase 4 — Chi phí CPU

## Bối cảnh

Đây là trục quyết định đường ship, và là trục GPU **không nói được gì**. Chỉ chạy
trên ứng viên sống sót Phase 3 — đo chi phí của một model đã trượt chất lượng là
lãng phí.

Phiên brainstorm trước đã xác lập: số quyết định là RTF ở **4 thread** (prod,
`docker-compose.prod.yml:278`), không phải 8 thread (dev). Đo ở 8 rồi deploy ở 4
là cách trượt ngưỡng trong im lặng.

## Yêu cầu

| Số                    | Điều kiện                                          | Ngưỡng                                              |
| --------------------- | -------------------------------------------------- | --------------------------------------------------- |
| RTF @ 8 thread        | rảnh                                               | ≤ 0,30 (R-trần luận văn)                            |
| **RTF @ 4 thread**    | rảnh                                               | **≤ 0,30 — đây là số phải qua**                     |
| RTF @ 4 thread        | có sidecar TTS đang synthesize                     | ≤ 0,30                                              |
| RAM đỉnh, 1 stream    | subprocess-isolated                                | ghi lại                                             |
| RAM thêm mỗi stream   | 1 / 4 / 8 stream song song                         | ≤ 25 MB/stream                                      |
| RAM tổng @ 4 stream   |                                                    | ≤ 2,5 GB, còn ≥1,5 GB dư trong `mem_limit: 4g` (R4) |
| Weight không nhân bản | RSS(4 stream) − RSS(1 stream) ≤ 4 × mức mỗi stream | phải đúng                                           |
| Không rò state        | mở/đóng 100 stream                                 | RSS về ±5% baseline                                 |
| Thời gian load model  |                                                    | ghi lại                                             |

**Đo có TTS chạy cùng là bắt buộc, không phải tuỳ chọn.** `services/local-tts/app.py:10-11`
ghi rõ mỗi engine TTS **serialize inference của chính nó**, và hai sidecar chia
nhau 16 core của host (`docker-compose.prod.yml` comment 234-236). Một RTF đo lúc
máy rảnh là con số của một hệ thống không tồn tại.

## Files

**Tạo:** `benchmarks/stt/results/r4-streaming/cpu-cost.csv`, mục tương ứng trong
`reports/`.

**Đọc, không sửa:** `docker-compose.prod.yml`, `services/local-tts/app.py`.

**Không đụng:** `apps/`, `packages/`, `services/`.

## Các bước

1. Đo baseline: incumbent ở cùng điều kiện. Không có baseline cùng điều kiện thì
   con số của ứng viên không có nghĩa.
2. Đo từng ứng viên ở 8 thread rồi 4 thread, máy rảnh.
3. Bật sidecar TTS, cho nó synthesize liên tục, đo lại ở 4 thread. Theo dõi và
   dừng tiến trình TTS khi xong — không để lại process mồ côi.
4. Đo RAM theo số stream bằng `PeakRssSampler` (`stt_bench/metrics.py`).
5. Chạy vòng mở/đóng 100 stream, đo rò.

## Xác minh

```bash
docker compose up -d --wait local-tts    # cho arm có tải
cd benchmarks/stt && uv run python run_benchmark.py --run-tag r4-streaming --arm cpu-cost
docker compose stop local-tts            # dọn ngay, không để process treo
ps aux | grep -c "[l]ocal-tts"           # phải về 0
```

Pass khi: mọi ứng viên có đủ số ở cả ba điều kiện; baseline incumbent tái lập
RTF 0,0158 vi và 0,040 en trong biên variance; không process nền nào còn sót.

## Rủi ro

**Đo trong lúc máy đang bận việc khác** cho ra RTF nhiễu. Giảm thiểu: ghi lại tải
hệ thống lúc đo, và chạy mỗi cấu hình ít nhất hai lần rồi báo cáo cả hai. Repo đã
có tiền lệ: variance giữa hai lần chạy được ghi ngay cạnh kết quả.

**Process TTS bị bỏ quên.** Bước 3 khởi động một sidecar. Nó phải được dừng trong
cùng phiên, kiểm bằng lệnh ở trên.

**Ứng viên chỉ đạt ngưỡng ở chunk lớn.** Chunk lớn giảm WER nhưng tăng độ trễ.
Nếu một ứng viên chỉ qua RTF ở chunk 1120ms thì bảng phải nói rõ độ trễ đi kèm,
vì lúc đó "qua ngưỡng" mua bằng đúng thứ mà streaming định cải thiện.

## Rollback

Xoá `cpu-cost.csv`. Dừng mọi container đã khởi động.
