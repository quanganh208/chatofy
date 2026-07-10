---
phase: 2
title: Benchmark RTF and quality
status: completed
effort: ''
---

# Phase 2: Benchmark RTF and quality

## Overview

Đo số liệu khách quan (RTF, latency, throughput) + tạo mẫu audio để đánh giá chủ quan
chất lượng giọng Việt, trên chính dev box.

## Actual Outcome (speed done — PASS)

Số liệu đầy đủ: `spike/results.md`. Tóm tắt:

- **8 threads tối ưu** (bỏ hyperthreading): **RTF median 0.511**, p90 0.569, max 0.625 — mọi câu < gate 0.7.
- **First-audio latency ~0.30s** (streaming) — phản hồi nhanh, không thua round-trip cloud.
- Smoke-test RTF 0.99 là anomaly (thread pool nguội); benchmark warm-up cho số đúng.
- **Đính chính:** giả định ban đầu "CPU không thắng ElevenLabs về tốc độ" bị dữ liệu bác bỏ.
- **Còn lại:** A/B chất lượng vs giọng Việt ElevenLabs — cần API key + đánh giá chủ quan của user.

## Test Corpus

- 10–15 câu tiếng Việt kiểu **bản dịch en→vi thực tế** (không phải câu văn học).
- Đa dạng độ dài: ngắn (~5 từ), trung (~15 từ), dài (~30+ từ).
- Gồm số, tên riêng, dấu câu để lộ điểm yếu phonemizer.
- Lưu ở `spike/corpus_vi.txt` (1 câu/dòng).

## Metrics

- **RTF** = thời gian sinh ÷ độ dài audio output. (Thấp = nhanh; đích ≤ 0.7.)
- **First-audio latency** = thời gian tới byte audio đầu tiên (nếu API hỗ trợ stream;
  nếu chỉ batch thì đo tổng thời gian tới khi có .wav).
- **Throughput tuần tự**: tổng thời gian sinh hết corpus, chạy tuần tự (đúng kiểu request/turn).
- Đo cả **cold-start** (lần chạy đầu, load model) vs **warm** (đã load) — tách riêng.

## Implementation Steps

1. Viết `spike/benchmark_vieneu.py`:
   - Load model 1 lần (đo cold-start riêng).
   - Loop corpus: đo wall-clock mỗi câu, tính độ dài audio (frames/sample_rate), suy ra RTF.
   - Xuất bảng: câu | chars | audio_sec | gen_sec | RTF.
   - In min/median/p90 RTF + tổng throughput.
   - Ghi .wav mỗi câu vào `spike/out/`.
2. Chạy với các cấu hình thread khác nhau (vd `OMP_NUM_THREADS` 4/8/16) để tìm điểm tối ưu
   trên i7-11700K; ghi lại config tốt nhất.
3. (Đối chứng chất lượng) Tổng hợp giọng Việt ElevenLabs cho **cùng 3–5 câu** để so sánh
   A/B chủ quan. Dùng `eleven_multilingual_v2`. KHÔNG cần script hoá — có thể gọi tay,
   miễn ra .wav để nghe cạnh nhau.
4. Ghi kết quả số vào `spike/results.md` (bảng RTF + config threads).

## Success Criteria

- [ ] `benchmark_vieneu.py` chạy hết corpus, ra bảng RTF (min/median/p90) + throughput.
- [ ] Có config threads tối ưu ghi lại.
- [ ] Có .wav VieNeu cho toàn corpus + .wav ElevenLabs cho 3–5 câu đối chứng.
- [ ] `spike/results.md` có đủ số liệu để phán quyết ở Phase 3.

## Risk Assessment

- Không có stream API → không đo được first-audio latency thật; fallback: dùng tổng thời
  gian batch làm proxy, ghi rõ đây là proxy.
- RTF dao động theo tải máy: chạy khi máy rảnh, lấy median không lấy mean.
