# VieNeu-TTS spike — run notes

Throwaway spike. Weights/venv/wav are gitignored.

## Env (Windows native — no WSL, no build tools needed)

- `uv` at `C:\Users\Admin\.local\bin\uv.exe`
- Python 3.11 venv in `.venv/` (uv-managed)
- `vieneu==3.1.0` — CPU path is **v3 Turbo ONNX, torch-free** (no llama-cpp, no eSpeak).
  GGUF is only the `standard` mode (needs extras) — NOT used; ONNX default is simpler + torch-free.

## Setup (reproduce)

```powershell
irm https://astral.sh/uv/install.ps1 | iex          # once
cd plans\260710-1436-vieneu-tts-local-spike\spike
& "$env:USERPROFILE\.local\bin\uv.exe" venv --python 3.11
& "$env:USERPROFILE\.local\bin\uv.exe" pip install vieneu
```

## Run

```powershell
$env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"
.\.venv\Scripts\python.exe smoke_test.py
```

## API (v3.1.0)

```python
from vieneu import Vieneu
tts = Vieneu(mode="v3turbo")          # CPU auto -> ONNX; sample_rate = 48000
audio = tts.infer("…", voice="Phạm Tuyên")   # np.float32; also infer_stream / infer_batch
tts.save(audio, "out.wav")
```

- 14 preset voices; default `Phạm Tuyên`. `apply_watermark=True` by default (perth).
- `infer_stream()` yields chunks → use for first-audio latency in Phase 2.
- `mode="xpu"` exists for Intel iGPU (needs torch.xpu + Intel drivers) — possible later speedup lever.

## Smoke-test result (baseline)

- Cold-start load: **37.9s** (one-time, incl. HF download)
- 1 sentence, 74 chars → audio 3.92s, gen 3.89s → **RTF 0.993** (default threads, warm)
- backend=onnx confirmed. Runs entirely on CPU (AMD GPU unused).

Headline: RTF ≈ 1.0 out of the box → at the decision-gate boundary. Phase 2 tunes threads + full corpus.
