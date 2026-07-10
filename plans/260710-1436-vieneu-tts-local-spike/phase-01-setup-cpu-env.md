---
phase: 1
title: Setup CPU env
status: completed
effort: ''
---

# Phase 1: Setup CPU env

## Overview

Dựng VieNeu-TTS standalone chạy CPU-only, sinh được 1 file .wav tiếng Việt "hello world"
để xác nhận môi trường chạy được trước khi benchmark.

## Actual Outcome (done)

Khác plan gốc theo hướng ĐƠN GIẢN HƠN — chi tiết trong `spike/README-spike.md`:

- **Không cần GGUF/llama-cpp/WSL.** Bản CPU mặc định của `vieneu==3.1.0` là **v3 Turbo ONNX,
  torch-free**. `uv pip install vieneu` cài sạch, chạy **native Windows**, không build tools.
- API: `Vieneu(mode="v3turbo").infer(text, voice=...)` → np.float32 @ 48kHz; có `infer_stream`.
- Smoke test: load 37.9s (1 lần) · 1 câu 74 ký tự → **RTF 0.993** (default threads, warm).
- GPU AMD không dùng. Lưu ý: có `mode="xpu"` cho Intel iGPU — lever tăng tốc tiềm năng sau.

## Key Constraints

- **CPU-only.** AMD RX 580 không có CUDA, ROCm không hỗ trợ trên Windows → không dùng GPU.
- **Standalone, ngoài monorepo.** Đặt trong `plans/260710-1436-vieneu-tts-local-spike/spike/`
  (thư mục throwaway, không thêm vào pnpm workspace, không commit model weights).
- Ưu tiên **GGUF Q4** cho tốc độ CPU: `pnnbao-ump/VieNeu-TTS-q4-gguf`.

## Implementation Steps

1. Đọc README chính chủ để lấy lệnh cài chính xác (bản đổi nhanh):
   `https://github.com/pnnbao97/VieNeu-TTS` và `https://pypi.org/project/vieneu/`.
2. Tạo thư mục spike: `plans/260710-1436-vieneu-tts-local-spike/spike/`.
3. Cài bằng `uv` (torch-free / ONNX default để nhẹ):
   - `uv venv && uv pip install vieneu` (hoặc theo README nếu khác).
   - GGUF backbone cần `llama-cpp-python`; nếu build lỗi trên Windows → sang **WSL2** (Ubuntu),
     cài `build-essential`, `espeak-ng`, rồi lặp lại.
4. Tải weights bản Q4 GGUF (`pnnbao-ump/VieNeu-TTS-q4-gguf`) qua `huggingface_hub`.
5. Chạy 1 câu tiếng Việt mẫu → xuất `smoke_test.wav`, mở nghe xác nhận ra tiếng.
6. Ghi lại: đường dẫn env, biến môi trường (threads/`OMP_NUM_THREADS`), lệnh chạy thành công.

## Success Criteria

- [ ] VieNeu-TTS cài xong, import/chạy không lỗi (Windows native HOẶC WSL2).
- [ ] Sinh được `smoke_test.wav` tiếng Việt nghe rõ.
- [ ] Đã chốt biến thể model dùng để benchmark (Q4 GGUF ưu tiên).
- [ ] Ghi lại lệnh chạy + env vào `spike/README-spike.md`.

## Risk Assessment

- **Rủi ro lớn nhất:** `llama-cpp-python`/`espeak-ng` kẹt build trên Windows.
  Mitigation: chuyển WSL2 ngay khi lỗi build lần đầu, đừng sa lầy fix toolchain Windows.
- Model tải chậm/nặng: chấp nhận, tải 1 lần, cache lại.
