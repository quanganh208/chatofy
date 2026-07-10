---
phase: 1
title: Python sidecar
status: completed
priority: P1
dependencies: []
---

# Phase 1: Python sidecar

## Overview

Dựng service HTTP `services/vieneu-tts/` (FastAPI + uvicorn) wrap `vieneu`, giữ model load
sẵn, expose `/synthesize` → wav 48kHz và `/healthz`. Nền tảng cho provider TS ở Phase 2.

## Outcome (DONE)

Đã tạo `services/vieneu-tts/`: `pyproject.toml` (uv, package=false), `app.py` (lifespan load
model, `/healthz` 200/503, `/voices` 14 giọng, `/synthesize`→wav PCM16 48kHz, infer trong
lock serialize, threads=8), `test_app.py`, README, .gitignore.

- `uv run pytest`: **4/4 pass** (9.46s, load model thật).
- HTTP thật (uvicorn): healthz ok ~2s, `/synthesize`→200 audio/wav 169KB RIFF, `/voices`→14 giọng.
- Thêm `/voices` (ngoài plan) để Phase 4 fetch danh sách giọng thay vì hardcode.
- Lưu ý Phase 2: gửi JSON body **UTF-8** (fetch mặc định OK); text tiếng Việt sai encoding → 400.

## Requirements

- Functional: `POST /synthesize {text, voice?}` → `audio/wav` (48kHz, mono). `GET /healthz`
  → 200 khi model đã load. Model load 1 lần lúc startup (né cold-start 7.5s/req).
- Non-functional: ORT threads = 8 (nhân vật lý); watermark perth giữ mặc định; xử lý text rỗng
  → 400. Tách khỏi pnpm workspace (uv project riêng).

## Architecture

- `Vieneu(mode="v3turbo")` load lúc lifespan startup, giữ trong app state. `sample_rate=48000`.
- `/synthesize`: gọi `tts.infer(text, voice=voice or DEFAULT_VOICE)` → np.float32 → encode wav
  (soundfile, PCM16) → trả bytes. Voice mặc định `Phạm Tuyên` (env `VIENEU_VOICE`).
- **Concurrency (Validation S1):** model CPU sync → chạy `infer` trong threadpool
  (`run_in_executor` / `anyio.to_thread`), serialize khi nhiều request (dev 1 user, chấp nhận).
  Ghi rõ giới hạn trong README.
- Threads set qua env trước import (`OMP_NUM_THREADS`/`MKL_NUM_THREADS`=8) như spike.
- Port mặc định 8001 (env `PORT`).

<!-- Updated: Validation Session 1 - infer chạy threadpool, serialize cho dev -->

Ghi chú: có thể thêm `GET /voices` (14 preset) sau; round này FE hardcode danh sách (KISS).

## Related Code Files

- Create: `services/vieneu-tts/pyproject.toml` (uv, deps: vieneu, fastapi, uvicorn, soundfile, numpy)
- Create: `services/vieneu-tts/app.py` (FastAPI app + endpoints, <200 dòng)
- Create: `services/vieneu-tts/test_app.py` (pytest + FastAPI TestClient)
- Create: `services/vieneu-tts/README.md` (setup uv, run, tải model lần đầu)
- Create: `services/vieneu-tts/.gitignore` (.venv, **pycache**, model cache)

## Implementation Steps

1. (Test-first) Viết `test_app.py`: `/healthz` trả 200; `/synthesize` với 1 câu Việt trả
   `audio/wav` >0 bytes, header WAV hợp lệ; text rỗng → 400. Dùng TestClient (chấp nhận
   load model thật — test tích hợp; đánh dấu slow nếu cần).
2. `pyproject.toml` + `uv sync` (tái dùng kiến thức spike: bản CPU ONNX torch-free).
3. `app.py`: lifespan load model; endpoints; encode wav bằng soundfile vào BytesIO.
4. Chạy `uv run pytest`; sửa tới khi xanh.
5. Chạy thủ công `uv run uvicorn app:app --port 8001`, curl `/synthesize` nghe thử.
6. README: lệnh setup + lưu ý tải model lần đầu + threads.

## Success Criteria

- [ ] `uv run pytest` xanh (healthz + synthesize + empty-text 400).
- [ ] `curl POST /synthesize` trả wav phát được, tiếng Việt đúng.
- [ ] Model load 1 lần lúc startup; request sau không chịu cold-start.
- [ ] Service không thêm vào pnpm/turbo build.

## Risk Assessment

- Model download lần đầu chậm → README cảnh báo; CI không chạy test này (đánh dấu slow/skip khi
  không có model). Local dev là môi trường chạy chính.
- `soundfile` cần libsndfile — thường kèm wheel; nếu thiếu, dùng `wave` stdlib encode PCM16.
