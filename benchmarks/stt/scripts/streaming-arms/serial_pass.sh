#!/usr/bin/env bash
# Chạy TUẦN TỰ mọi cấu hình cuối cùng vào run-tag r5.
# Tuần tự là điều kiện của phép đo: r4 có vài arm chạy song song nên RTF bị nhiễu.
set -u
BDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(cd "$BDIR/../.." && pwd)"
# Env riêng cho Moonshine: nó link ONNX Runtime tĩnh, không cài chung với sherpa.
PROBE="${MOONSHINE_ENV:?đặt MOONSHINE_ENV trỏ tới uv project đã cài moonshine-voice}"
OUT=$BENCH/results/r5
mkdir -p "$OUT"

step() { echo "[$(date +%H:%M:%S)] $*"; }

# 1120ms package chưa giải nén
cd "$BENCH/models"
if [ ! -d sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-1120ms-int8-2026-06-11 ]; then
  step "giải nén 1120ms"
  tar xjf sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-1120ms-int8-2026-06-11.tar.bz2 \
    && rm sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-1120ms-int8-2026-06-11.tar.bz2
fi

# ---- đối chứng: stack hiện tại, cùng run-tag ----
cd "$BENCH"
step "đối chứng incumbent vi+en"
uv run python run_benchmark.py --run-tag r5 --engines sherpa-zipformer-vi,sherpa-moonshine-en >/dev/null 2>&1

# ---- Nemotron: quét chunk ở 4 thread (cấu hình prod) ----
for MS in 80 160 320 560 1120; do
  step "nemotron ${MS}ms vi t4"
  uv run python "$BDIR/nemotron_arm.py" --pkg-ms $MS --lang vi --threads 4 \
    --mode accuracy --out "$OUT/nemo-${MS}ms-vi-t4.jsonl" >/dev/null 2>&1
done
step "nemotron 560ms en t4"
uv run python "$BDIR/nemotron_arm.py" --pkg-ms 560 --lang en --threads 4 \
  --manifest data/manifest-en.jsonl --mode accuracy --out "$OUT/nemo-560ms-en-t4.jsonl" >/dev/null 2>&1
step "nemotron 560ms vi t4 LATENCY"
uv run python "$BDIR/nemotron_arm.py" --pkg-ms 560 --lang vi --threads 4 \
  --mode latency --out "$OUT/nemo-560ms-vi-t4-lat.jsonl" >/dev/null 2>&1

# ---- Moonshine ----
cd "$PROBE"
step "moonshine vi streaming 320"
uv run python "$BDIR/moonshine_arm.py" --lang vi --mode accuracy --feed-ms 320 \
  --out "$OUT/ms-vi-stream.jsonl" >/dev/null 2>&1
step "moonshine vi batch"
uv run python "$BDIR/moonshine_arm.py" --lang vi --mode batch \
  --out "$OUT/ms-vi-batch.jsonl" >/dev/null 2>&1
step "moonshine vi streaming + speakers"
uv run python "$BDIR/moonshine_arm.py" --lang vi --mode accuracy --feed-ms 320 --speakers \
  --out "$OUT/ms-vi-stream-spk.jsonl" >/dev/null 2>&1
step "moonshine vi LATENCY"
uv run python "$BDIR/moonshine_arm.py" --lang vi --mode latency --feed-ms 320 \
  --out "$OUT/ms-vi-lat.jsonl" >/dev/null 2>&1
for A in 2 4 5; do
  step "moonshine en arch $A"
  uv run python "$BDIR/moonshine_arm.py" --lang en --manifest data/manifest-en.jsonl \
    --mode accuracy --feed-ms 320 --arch $A --out "$OUT/ms-en-a${A}.jsonl" >/dev/null 2>&1
done
step "XONG"
