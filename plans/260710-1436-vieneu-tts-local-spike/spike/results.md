# VieNeu-TTS spike — benchmark results

Machine: i7-11700K (8c/16t), 32GB RAM, Windows 11, **CPU-only** (AMD RX 580 unused).
Model: `vieneu==3.1.0`, v3 Turbo **ONNX (torch-free)**, 48 kHz, default voice `Phạm Tuyên`.
Corpus: 14 câu tiếng Việt kiểu bản dịch en→vi (`corpus_vi.txt`). Warm-up excluded.

## Speed (measured)

| Threads         | RTF min   | RTF median | RTF p90   | RTF max   | first-audio median | cold-start |
| --------------- | --------- | ---------- | --------- | --------- | ------------------ | ---------- |
| 16 (default)    | 0.502     | 0.530      | 0.635     | 0.812     | 0.31s              | 7.5s       |
| **8 (optimal)** | **0.491** | **0.511**  | **0.569** | **0.625** | **0.30s**          | 7.5s       |

- **8 threads (= physical cores) tối ưu** — bỏ hyperthreading giảm overhead, kéo cả outlier xuống.
- Ở 8 threads, **mọi câu RTF ≤ 0.625 < gate 0.7**.
- First-audio latency ~0.30s → streaming rất mượt, phản hồi nhanh.
- Outlier: câu chứa email (`an.nguyen@example.com`) chậm nhất — special chars tốn frames.
- Smoke-test RTF 0.99 là anomaly (thread pool nguội), KHÔNG đại diện.

## Speed verdict: PASS

RTF median 0.51 (≤ 0.7) + first-audio 0.30s. Trên CPU máy này VieNeu **thực sự cạnh tranh
về tốc độ** — bác bỏ giả định ban đầu "không thắng ElevenLabs". Với streaming, first-audio
0.30s không thua round-trip cloud (còn lợi vì không có network jitter).

## Latency đối chứng ElevenLabs (REST non-streaming — đúng cái backend đang dùng)

| Câu | ElevenLabs round-trip (full audio) | VieNeu first-audio (stream) |
| --- | ---------------------------------- | --------------------------- |
| 01  | 2.70s (call đầu)                   | ~0.30s                      |
| 03  | 1.06s                              | ~0.30s                      |
| 05  | 1.51s                              | ~0.30s                      |
| 08  | 1.05s                              | ~0.30s                      |
| 13  | 1.46s                              | ~0.30s                      |

- ElevenLabs `synthesize()` hiện tại: **1.0–2.7s/câu tới khi có audio** (gồm network VN→EL).
- VieNeu streaming: **~0.30s tới tiếng đầu** → local **ra tiếng nhanh hơn** rõ rệt.
  (ElevenLabs có stream API sẽ hạ first-audio, nhưng backend đang dùng REST batch.)

## Latency ElevenLabs theo model (đo được)

| Model                     | round-trip (full audio) | Nhận language_code?                      |
| ------------------------- | ----------------------- | ---------------------------------------- |
| `eleven_flash_v2_5` (+vi) | **0.35–0.65s**          | Có (ép đúng tiếng Việt)                  |
| `eleven_multilingual_v2`  | 1.0–2.7s                | KHÔNG → **gen nhầm tiếng** với text Việt |

⇒ Bản `multilingual_v2` nghe bị sai tiếng là do model không ép được language_code — loại khỏi A/B.
`flash_v2_5`+vi là đối chứng công bằng.

## A/B chất lượng — full matrix để nghe cạnh nhau

Mỗi câu X ∈ {01,03,05,08,13}:

| Nguồn                 | File                                      | Ghi chú                                   |
| --------------------- | ----------------------------------------- | ----------------------------------------- |
| VieNeu default        | `out/corpus_0X.wav`                       | temp 0.8 (params mặc định)                |
| **VieNeu HQ**         | `out_hq/corpus_0X_hq.wav`                 | temp 0.55, top_k 20 — ổn định số/tên hơn  |
| **ElevenLabs v3**     | `out_elevenlabs/corpus_0X_v3.mp3`         | model biểu cảm nhất, round-trip 1.5–2.6s  |
| ElevenLabs flash_v2_5 | `out_elevenlabs/corpus_0X_flash_v2_5.mp3` | tier nhanh 0.35–0.65s                     |
| ~~multilingual_v2~~   | `out_elevenlabs/corpus_0X.mp3`            | SAI tiếng (không nhận language_code) — bỏ |

- ElevenLabs v3 round-trip đo được: 01=1.52s, 03=2.12s, 05=1.83s, 08=1.74s, 13=2.59s.
- ElevenLabs vẫn voice Rachel (English-native) ép nói Việt. Muốn công bằng tối đa cần voice
  Việt bản xứ từ ElevenLabs voice library.
- Đánh giá chất lượng **chủ quan, thuộc về user**. Speed VieNeu đã đạt ⇒ go/no-go theo verdict này.

## Config để tái lập tốc độ tối ưu

```powershell
$env:SPIKE_THREADS="8"; $env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"
.\.venv\Scripts\python.exe benchmark_vieneu.py
```

Trong tích hợp thật: set ORT intra-op threads = 8 (số nhân vật lý), không để mặc định 16.
