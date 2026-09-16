# Arm streaming — Nemotron-3.5 và Moonshine

Các runner đã sinh ra `results/r5/`. Đứng riêng, không nằm trong `run_benchmark.py`,
vì model streaming không vừa contract `SttEngine.transcribe(wav_path) -> str` —
nó phải được đút audio theo từng chunk.

Chúng được chép vào repo **có chủ đích**. Bản chạy đầu tiên để trong scratchpad, và
một spike tháng 8/2026 đã mất sạch artifact đúng vì lý do đó — dấu vết còn lại là
năm symlink chết trong `models/nemotron-streaming-0.6b/`, đã dọn.

## Chạy lại

```bash
bash scripts/streaming-arms/serial_pass.sh     # tuần tự, run-tag r5
```

**Tuần tự là điều kiện của phép đo, không phải sở thích.** Đo song song làm RTF
sai lệch tới ±70% (xem mục độ biến thiên trong báo cáo). WER thì tất định, không
bị ảnh hưởng.

## Weight

Không commit. Tải lại:

```bash
cd benchmarks/stt/models
for ms in 80 160 320 560 1120; do
  N="sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-${ms}ms-int8-2026-06-11"
  curl -sL -o "$N.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$N.tar.bz2" \
  && tar xjf "$N.tar.bz2" && rm "$N.tar.bz2"
done
```

Moonshine tự tải về `~/.cache/moonshine_voice` khi gọi `get_model_for_language()`.
Cần env riêng (`uv add moonshine-voice soundfile`) vì nó link ONNX Runtime tĩnh
của riêng nó; **không** cài chung vào env của `benchmarks/stt`.

## Chỉ số

`stream_metrics.py` đo thứ WER không thấy: thời điểm chữ đầu xuất hiện, độ trễ so
với thời gian thực, và **tỉ lệ ký tự đã hiện rồi bị viết lại**. Chính chỉ số cuối
phân biệt streaming thật (Nemotron: 0,0%) với streaming có sửa lại (Moonshine:
10,7% trung vị, 88,9% ở p95).

Kết quả đầy đủ: `plans/260916-1054-streaming-asr-diarization-benchmark/reports/`.
