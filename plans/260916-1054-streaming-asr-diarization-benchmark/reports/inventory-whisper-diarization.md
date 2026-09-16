---
phase: 1
branch: Whisper family + Western streaming + dedicated diarization
agent: inv-whisper-diar
date: 2026-09-16
status: done
---

# Inventory — họ Whisper, streaming phương Tây, diarization chuyên dụng

## Kết luận ngắn

Nhánh này có **đúng một ứng viên qua cả G1–G8**, và nó không thuộc họ Whisper:
**Moonshine Streaming Tiny Vietnamese** (`tiny-streaming-vi`), chạy qua thư viện
Moonshine Voice, ghép với **diarization streaming cpp-annote / pyannote
community-1** trong **cùng một tiến trình, cùng một wheel**.

Đây là ứng viên duy nhất trong toàn nhánh vừa là streaming thật, vừa có tiếng
Việt, vừa có bản int8 ONNX chạy CPU, vừa **tự làm luôn speaker attribution** —
tức là nó đánh vào cả hai trục thanh chắn cùng lúc.

Cảnh báo phải nói trước: WER công bố của nó là **9,4** trên FLEURS-vi + LSVSC,
trong khi mốc nền là **5,38** trên VIVOS-50. **Hai bộ test khác nhau, không so
trực tiếp được**, nhưng khoảng cách đủ lớn để dự đoán nó **nhiều khả năng trượt
trục WER** ở Phase 3 — đúng như `plan.md` đã cảnh báo. Giá trị của nó nằm ở trục
thứ hai: speaker attribution.

Toàn bộ họ Whisper — `whisper_streaming`, WhisperLive, faster-whisper + VAD,
distil-whisper — **bị loại ở G2**, và lý do trích được nằm trong chính README của
chúng. Đây là kết quả có giá trị: nó chứng minh pseudo-streaming là chuẩn mực của
hệ sinh thái phương Tây, và stack hiện tại của dự án không phải là một lựa chọn
kém mà là cách làm phổ biến.

---

## 1. Ứng viên sống sót

### 1.1 Moonshine Streaming Tiny — Vietnamese

| Trường                 | Giá trị                                                                                                                                                                    | Nguồn                                                                                                                                                                                                       | Mức                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Model ID (float)       | `moonshine-ai/moonshine-streaming-tiny-vi`                                                                                                                                 | [HF card](https://huggingface.co/moonshine-ai/moonshine-streaming-tiny-vi)                                                                                                                                  | VERIFIED                           |
| Gói deploy (int8)      | `https://download.moonshine.ai/model/tiny-streaming-vi/quantized_26_08_24`                                                                                                 | [`core/moonshine-model-catalog.cpp:197-205`](https://raw.githubusercontent.com/moonshine-ai/moonshine/main/core/moonshine-model-catalog.cpp)                                                                | VERIFIED (HTTP 200 trên từng file) |
| Tham số                | 27,0M                                                                                                                                                                      | HF card, bảng "Checkpoint identity"                                                                                                                                                                         | VERIFIED                           |
| Kiến trúc              | Encoder 6 layer × width 320 × 8 head, sliding window (16,4) ở 2 layer đầu/cuối và (16,0) ở giữa; decoder 6 layer RoPE; frontend 50 Hz time-domain + 2 causal conv stride-2 | HF card, mục "Architecture"                                                                                                                                                                                 | VERIFIED                           |
| Lookahead              | ~80 ms (`total_lookahead: 16` frame)                                                                                                                                       | [`streaming_config.json`](https://download.moonshine.ai/model/tiny-streaming-vi/quantized_26_08_24/streaming_config.json)                                                                                   | VERIFIED                           |
| Tokenizer              | `tokenizer_vi12k.json`, vocab 12 288 (riêng cho tiếng Việt)                                                                                                                | HF card + `streaming_config.json` (`vocab_size: 12288`)                                                                                                                                                     | VERIFIED                           |
| Định dạng export       | `.ort` int8 (ONNX Runtime optimized format), 6 file                                                                                                                        | Probe CDN                                                                                                                                                                                                   | VERIFIED                           |
| Kích thước weight int8 | **30,8 MB** tổng: encoder 7,77 · decoder_kv 19,72 · cross_kv 1,29 · adapter 1,32 · frontend.weights 2,09 · tokenizer 0,095 (MB)                                            | `curl -I` từng file trên CDN                                                                                                                                                                                | VERIFIED                           |
| Runtime                | `moonshine-voice` 0.1.5, wheel `manylinux_2_34_x86_64` 19,0 MB                                                                                                             | [PyPI](https://pypi.org/pypi/moonshine-voice/json)                                                                                                                                                          | VERIFIED                           |
| Dependency runtime     | `numpy, sounddevice, requests, tqdm, filelock, platformdirs, google-crc32c` — **không có `onnxruntime`**                                                                   | PyPI `requires_dist`                                                                                                                                                                                        | VERIFIED                           |
| License model          | **MIT**                                                                                                                                                                    | [`LICENSE`](https://raw.githubusercontent.com/moonshine-ai/moonshine/main/LICENSE): _"Moonshine models are released under the MIT License by default... This includes all streaming speech-to-text models"_ | VERIFIED                           |
| WER công bố            | **`fleurs_vi` 10,98 · `lsvsc_vi` 7,63 · macro 9,305** (float32, batch 1, mẫu seeded 400 câu). Gói int8 shipped: **macro 9,425**                                            | HF card, mục "Evaluation"                                                                                                                                                                                   | VERIFIED                           |
| Dữ liệu train          | ~83 000 h crawl **pseudo-label bằng teacher họ Whisper, không kiểm duyệt** + ~700 h read speech                                                                            | HF card, mục "Training data"                                                                                                                                                                                | VERIFIED                           |
| RTF trên CPU x86       | **Không công bố**                                                                                                                                                          | —                                                                                                                                                                                                           | Phải đo ở Phase 4                  |

#### G1–G6

| Cổng                  | Kết quả                        | Bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** tiếng Việt     | **PASS**                       | Model card `language: [vi]`, có số WER riêng cho tiếng Việt trên hai panel                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **G2** streaming thật | **PASS**                       | `streaming_config.json` khai báo `frontend_state_shapes: {sample_buffer, sample_len, conv1_buffer, conv2_buffer, frame_count}` — **state được mang qua chunk**. `core/moonshine-streaming-model.h` có `struct MoonshineStreamingState` với _"Decoder self-attention KV cache"_, _"Cross-attention KV cache (precomputed from memory)"_, và API `process_audio_chunk(state, audio_chunk, chunk_len)` + `encode(state, is_final)`. Đây là carry-state thật, **không phải** re-decode từ đầu mỗi chunk |
| **G3** chạy CPU       | **PASS**                       | Wheel `manylinux_2_34_x86_64` dựng sẵn, `.ort` nạp qua ONNX Runtime link tĩnh. Không có kernel CUDA-only                                                                                                                                                                                                                                                                                                                                                                                            |
| **G4** license        | **PASS, và tốt hơn incumbent** | MIT. Mốc nền hiện tại là CC-BY-NC-ND (`README.md:343`)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **G5** runtime        | **PASS**                       | `moonshine-voice` **không khai báo `onnxruntime`** làm dependency — nó link ORT tĩnh trong wheel. Không đụng vào cặp ABI `sherpa-onnx==1.13.4 + onnxruntime==1.27.0` (R2). Hai thư viện ORT sống song song, ở hai symbol namespace tách biệt                                                                                                                                                                                                                                                        |
| **G6** kích thước     | **PASS rất rộng**              | 30,8 MB weight + 8,2 MB diarization = **39 MB**, so với `mem_limit: 4g`. Incumbent Zipformer-vi đã ăn 223 MB RAM đỉnh (`development-journey.md:122`)                                                                                                                                                                                                                                                                                                                                                |

#### Ghi chú license — một mâu thuẫn đã giải quyết

`moonshine-voice-assets/README.md` nói _"Models for other languages are released
under the Moonshine Community License, which is non-commercial."_ Câu này **sai
với model streaming**. `LICENSE` trong repo chính liệt kê **exhaustive** danh sách
model KHÔNG phải MIT, và nó chỉ gồm _"legacy non-streaming models"_: Vietnamese
**Base, Tiny** (tức `base-vi`, `tiny-vi` — bản offline). `tiny-streaming-vi`
không nằm trong danh sách đó, và HF card của nó ghi `license: mit`. Ba nguồn
khớp nhau: **MIT**.

Dự án là đồ án phi thương mại nên G4 qua kiểu nào cũng được, nhưng đây là một
nâng cấp license thật so với mốc nền và đáng ghi vào luận văn.

---

### 1.2 Moonshine diarization — cpp-annote / pyannote community-1

Đây là tầng speaker đi kèm, **cùng thư viện, cùng process, bật bằng một option**.

| Trường              | Giá trị                                                                                   | Nguồn                                                                                                                                                              | Mức                         |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Model               | `segmentation.ort` + `embedding.ort`, port C++/ONNX của pipeline **pyannote community-1** | [`docs/diarization-models.md`](https://raw.githubusercontent.com/moonshine-ai/moonshine/main/docs/diarization-models.md)                                           | VERIFIED                    |
| Kích thước          | **8,2 MB** tổng (segmentation 1,52 MB + embedding 6,65 MB)                                | `FILES.tsv` của `moonshine-voice-assets` + doc xác nhận _"The two models are 8.2 MB together"_                                                                     | VERIFIED                    |
| Clustering          | **VBx** trên sliding window, PLDA + x-vector nhúng sẵn (261 KB)                           | `docs/diarization-models.md`                                                                                                                                       | VERIFIED                    |
| Số người nói tối đa | **Không giới hạn cứng**                                                                   | `clustering_vbx.h`: `forced_num_speakers = -1;  // optional forced count (num_speakers); -1 = unset`                                                               | VERIFIED                    |
| Cần khai báo trước? | **Không**                                                                                 | như trên — `-1 = unset` là mặc định                                                                                                                                | VERIFIED                    |
| License model       | **CC-BY 4.0** (pyannote.ai)                                                               | `core/cpp-annote/README.md`: _"The community-1 diarization models are released by pyannote.ai under the Creative Commons Attribution 4.0 License"_                 | VERIFIED                    |
| License code        | MIT (cpp-annote)                                                                          | như trên                                                                                                                                                           | VERIFIED                    |
| Gated?              | **Không, khi lấy qua Moonshine CDN**                                                      | File nằm ở `download.moonshine.ai/model/diarization-community1/`, tải không cần token. Bản gốc `pyannote/speaker-diarization-community-1` trên HF là `gated: auto` | VERIFIED                    |
| DER công bố         | **Không có trong tài liệu Moonshine**                                                     | —                                                                                                                                                                  | Phải tự đo (xem "Giới hạn") |

#### G7 — diarization streaming

**PASS, VERIFIED.** `core/speaker-diarizer.h` mô tả API stream đầy đủ:
`create_stream()` → `start_stream()` → `add_audio_to_stream()` → `get_turns()` →
`finish_stream()`. Comment của class nói thẳng cơ chế:

> _"Streaming sessions re-cluster a bounded sliding window of recent audio on a
> cadence; older turns are frozen. One-shot `diarize()` uses full-history
> clustering."_

`cpp-annote-streaming.h` cho thấy đây là incremental thật chứ không phải batch
giả trang: có cache theo chunk (`CachedChunk {seg, emb}`), có eviction
(`evict_chunk_cache_if_needed`), có turn đóng băng (`merge_frozen_and_active_turns`),
và có **relabel ổn định** — `relabel_active_turns()` được mô tả là _"Relabels the
raw per-window clustering labels... into a persistent namespace that is stable
across refreshes"_. Tham số mặc định: `analyze_cadence` 1 s, `cluster_cadence`
2 s, `cluster_window_sec` 120 s.

**Một đặc tính phải hiểu trước khi đo:** kết quả có thể **đổi ngược về quá khứ**.
`speaker-diarizer.h` nói rõ _"Turns from get_turns() can still move within the
active window as more audio arrives. Callers should treat every call's result as
the current best estimate for the whole stream."_ Python API phơi đúng điều này
qua event `on_line_speakers_changed`, với doc string: _"the transcriber refines
speaker assignments retroactively as more audio arrives."_

Đây vừa là ưu thế vừa là rủi ro. Ưu thế: nó sửa được chính lỗi mà tầng speaker
hiện tại không sửa được — lượt 1065 ms quá ngắn để nhận diện lần đầu, nhưng sau
10 giây hội thoại thì cụm đã đủ chắc để gán lại đúng. Rủi ro: UI phải chịu được
nhãn người nói thay đổi sau khi đã hiển thị, và harness Phase 3 phải quyết định
chấm **snapshot cuối** hay **snapshot tại thời điểm phát**. Hai con số đó khác
nhau và chỉ một trong hai so được với mốc 0,78.

#### G8 — số người nói không biết trước

**PASS, VERIFIED.** VBx suy ra số cụm; `forced_num_speakers` mặc định `-1`
(unset). Không có API nào bắt buộc khai báo. Đối lập trực tiếp với Sortformer
(`diar_sortformer_4spk`, thuộc nhánh khác) vốn cố định 4 người nói.

#### Tích hợp: ASR và diarization là một API

`language-bindings/python/src/moonshine_voice/transcriber.py` cho thấy hai thứ
này không phải hai hệ thống ghép tay. Option `identify_speakers=true` làm
transcript trả về kèm `speaker_spans` với `speaker_id` và `speaker_index` gắn
thẳng vào từng dòng. Các option điều khiển: `diarization_cluster_cadence`,
`diarization_analyze_cadence`, `diarization_cluster_window_sec`,
`diarization_model_dir` ([`core/moonshine-c-api.cpp:169-178`](https://raw.githubusercontent.com/moonshine-ai/moonshine/main/core/moonshine-c-api.cpp)).

Với dự án, ý nghĩa là: **một sidecar, một wheel, một stream audio** thay cho
"STT server-side + speaker-id trong browser". Đó là thứ mà không ứng viên nào
khác trong nhánh này cung cấp.

**Nhưng phải nói thẳng cái giá:** doc của Moonshine viết _"diarization is off by
default and costs a lot of compute"_. Không có con số. Trên 4 thread, cạnh một
sidecar TTS đang serialize inference, đây là biến rủi ro lớn nhất của ứng viên
này và chỉ Phase 4 trả lời được.

---

## 2. Bảng loại — họ Whisper (G2)

Tất cả đều là **cửa sổ trượt trên model offline**, đúng loại pseudo-streaming dự
án đang muốn thoát khỏi.

| Ứng viên                                                              | Cổng trượt | Câu trích được                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ufal/whisper_streaming`** (MIT, 3 672 sao, push cuối 2025-11-12)   | **G2**     | README: _"Whisper is one of the recent state-of-the-art multilingual speech recognition models, **however, it is not designed for real-time transcription**"_ và _"**since each audio fragment is processed multiple times**, the price will be higher"_. Cơ chế là **LocalAgreement-n**: _"if n consecutive updates, each with a newly available audio stream chunk, agree on a prefix transcript, it is [confirmed]"_, cộng với `--buffer_trimming {sentence,segment}`. Decode lại từ đầu trên buffer đang lớn dần, không carry state. [Nguồn](https://github.com/ufal/whisper_streaming) |
| **`collabora/WhisperLive`** (MIT, 4 282 sao, push 2026-09-10)         | **G2**     | README tự mô tả: _"**A nearly-live** implementation of OpenAI's Whisper."_ Backend là `faster_whisper`, `tensorrt`, `openvino` — cả ba đều là Whisper offline; streaming đến từ VAD chunking (`use_vad`) ở tầng server. [Nguồn](https://github.com/collabora/WhisperLive)                                                                                                                                                                                                                                                                                                                   |
| **`SYSTRAN/faster-whisper` + VAD** (MIT, 25 418 sao, push 2025-11-19) | **G2**     | Là runtime CTranslate2 cho **Whisper encoder-decoder 30 giây**. Không có chế độ causal/cache-aware. VAD chỉ cắt audio thành đoạn rồi decode lại từng đoạn. [Nguồn](https://github.com/SYSTRAN/faster-whisper)                                                                                                                                                                                                                                                                                                                                                                               |
| **distil-whisper**                                                    | **G2**     | Distill của Whisper — cùng kiến trúc encoder-decoder non-causal trên cửa sổ 30 s, chỉ ít layer decoder hơn. Không phát hành biến thể causal. Trượt G2 vì cùng lý do với faster-whisper                                                                                                                                                                                                                                                                                                                                                                                                      |
| **PhoWhisper** (`vinai/PhoWhisper-*`, BSD-3)                          | **G2**     | Fine-tune Whisper cho tiếng Việt — G1 qua, nhưng kiến trúc không đổi nên G2 trượt. Repo **đã đo rồi**: `fw-phowhisper-vi` WER 7,71 / RTF 0,332 (`development-journey.md:124`) — thua incumbent ở cả hai trục. Không mở lại                                                                                                                                                                                                                                                                                                                                                                  |

**Ghi nhận cho luận văn:** bốn dự án "whisper streaming" phổ biến nhất của
phương Tây, cộng lại hơn 33 000 sao GitHub, **không dự án nào là streaming
thật**. Stack pseudo-streaming hiện tại của Chatofy nằm đúng trong chuẩn mực
ngành.

---

## 3. Bảng loại — streaming phương Tây ngoài họ Whisper

| Ứng viên                                                     | Cổng trượt                                    | Bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kyutai STT** (`kyutai/stt-1b-en_fr`, `kyutai/stt-2.6b-en`) | **G1**                                        | **G2 thì qua rất đẹp** — model card: _"Unlike offline speech-to-text, where the model needs the entire audio... our model starts to output the transcript as soon as a few seconds of audio become available"_, kiến trúc decoder-only đa luồng Moshi, frame rate 12,5 Hz, delay cố định 0,5 s (1b) / 2,5 s (2,6b). Nhưng **chỉ có `en` và `en_fr`**. Liệt kê toàn bộ `author=kyutai` trên HF API: không checkpoint STT nào có `vi`. [Nguồn](https://huggingface.co/kyutai/stt-2.6b-en)                                                                                                                                                 |
| **Kyutai Moshi / Moshika**                                   | **G1**                                        | Tag ngôn ngữ `en` duy nhất trên mọi biến thể (`moshiko-*`, `moshika-*`). Hibiki là speech translation `fr↔en`. HF API `author=kyutai`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Mistral Voxtral Mini 3B** (Apache-2.0)                     | **G1**                                        | Tag ngôn ngữ: `en, fr, de, es, it, pt, nl, hi`. **Không có `vi`**. [HF API](https://huggingface.co/mistralai/Voxtral-Mini-3B-2507). Ngoài ra là audio-LLM offline nên cũng trượt G2                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **IBM Granite Speech 3.3-2b** (Apache-2.0)                   | **G1**                                        | Tag ngôn ngữ: `en, fr, de, es, pt`. Không có `vi`. [HF API](https://huggingface.co/ibm-granite/granite-speech-3.3-2b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **FireRedASR** (`FireRedTeam/FireRedASR-AED-L`, Apache-2.0)  | **G1**                                        | Tag ngôn ngữ: `en, zh`. Không có `vi`. [HF API](https://huggingface.co/FireRedTeam/FireRedASR-AED-L). (sherpa-onnx có `OfflineRecognizer.from_fire_red_asr` — offline, nên G2 cũng trượt)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Qwen3-ASR 0.6B / 1.7B** (Apache-2.0)                       | **G2 — chưa kết luận, để lại cho nhánh khác** | **G1 qua**: model card liệt kê `Vietnamese (vi)` trong bảng ngôn ngữ chính thức và tag HF có `vi`. Card cũng tuyên bố _"Both models support **streaming/offline unified inference** with a single model"_ và cột "Offline / Streaming". **Nhưng:** sherpa-onnx chỉ có `OfflineRecognizer.from_qwen3_asr`, **không** có factory nào trong `OnlineRecognizer`. Đường CPU sẵn có (`handy-computer/Qwen3-ASR-*-gguf`, transcribe.cpp) cũng là đường offline. Chưa tìm được số WER riêng cho tiếng Việt. → Không tuyên bố pass/fail; **thuộc nhánh Alibaba/FunASR**, đề nghị lead giao cho `inv-funasr` xác minh cơ chế streaming và số `vi` |
| **Moonshine base-en / tiny-en (offline)**                    | **G2**                                        | Chính là incumbent tiếng Anh: `services/local-stt/engines/moonshine_en.py:19` gọi `sherpa_onnx.OfflineRecognizer.from_moonshine(...)`. Offline theo định nghĩa                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Moonshine base-vi / tiny-vi (offline)**                    | **G2 + G4**                                   | G2: non-streaming. G4: nằm trong danh sách exhaustive của `LICENSE` là Moonshine Community License **non-commercial** — dùng được cho đồ án nhưng kém MIT của bản streaming, và không có lý do gì chọn bản offline khi bản streaming MIT tồn tại                                                                                                                                                                                                                                                                                                                                                                                        |
| **Moonshine Streaming Small/Medium (en)**                    | **G1**                                        | Chỉ có `en`. Đáng ghi làm tham chiếu chất lượng: OpenASR average **7,84** (small 123M) / **6,65** (medium 245M) / **12,01** (tiny 34M). Xem mục 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 4. Bảng loại — cloud (G3), giữ làm mốc tham chiếu

Cả ba đều trượt **G3** ("chỉ là API cloud, không chạy CPU local"). Giữ lại vì
saydi.ai dùng Deepgram và là đối thủ tham chiếu.

| Vendor           | Tiếng Việt streaming?                                                                                                                                                                          | Số công bố                                                                                                                                                             | Nguồn                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deepgram**     | **Có.** Nova-3 và Nova-2 đều liệt kê `vi`, cho cả real-time lẫn batch. Model **Flux** (bản voice-agent mới) **chưa có** tiếng Việt — chỉ en, es, fr, de, hi, ru, pt, ja, it, nl                | **Không có WER riêng cho tiếng Việt.** Chỉ có số tổng hợp đa ngôn ngữ: median WER **6,84%** trên real-time stream, và tuyên bố giảm 54,3% WER streaming so với đối thủ | [Models & Languages](https://developers.deepgram.com/docs/models-languages-overview), [Nova-3 launch](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api) |
| **AssemblyAI**   | **Có, nhưng chỉ ở bản flagship.** Universal-3.5 Pro Realtime hỗ trợ `vi` trong 18 ngôn ngữ. Universal-Streaming **Multilingual** (bản rẻ) **không có** tiếng Việt — chỉ en, es, fr, de, it, pt | Không có WER riêng cho tiếng Việt                                                                                                                                      | [Multilingual streaming docs](https://www.assemblyai.com/docs/streaming/universal-streaming/multilingual-transcription)                                                 |
| **Speechmatics** | **Không xác minh được trong phạm vi pha này**                                                                                                                                                  | —                                                                                                                                                                      | Xem "Giới hạn"                                                                                                                                                          |

**Đọc được gì từ đây:** ngay cả vendor cloud cũng **không công bố WER tiếng Việt
riêng**. Không có con số cloud nào đưa vào bảng quyết định được, chỉ có sự kiện
"có hỗ trợ". Điều này củng cố lập luận trong `plan.md` rằng mọi so sánh phải do
Phase 3 tự sinh ra.

---

## 5. Bảng loại — diarization chuyên dụng

| Ứng viên                                                                                 | G7 streaming | G8 số người nói | Kết luận                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pyannote community-1 qua Moonshine/cpp-annote**                                        | **PASS**     | **PASS**        | **Sống sót** — xem 1.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`pyannote/speaker-diarization-community-1`** (bản gốc, CC-BY-4.0, 5,0 M lượt tải)      | **FAIL**     | PASS            | Pipeline `pyannote.audio` gốc là **offline**: nhận một file, chạy segmentation toàn bộ rồi clustering toàn cục. Thêm G5: kéo theo `torch` + `pyannote.audio` vào cạnh sherpa-onnx. Thêm ma sát G4: HF `gated: auto`, phải chấp nhận điều khoản bằng token. Bản port ONNX của Moonshine **giải quyết cả ba vấn đề** nên không có lý do chọn bản gốc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`pyannote/speaker-diarization-3.1`** (MIT, 8,5 M lượt tải)                             | **FAIL**     | PASS            | Cùng lý do — pipeline offline. Đây là thế hệ trước của community-1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`pyannote/segmentation-3.0`** (MIT)                                                    | n/a          | n/a             | Là **building block**, không phải pipeline. Chỉ vào danh sách khi ghép trong diart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`juanmc2005/diart`** (MIT, 2 026 sao, push 2026-06-19)                                 | **PASS**     | **PASS**        | **Streaming thật**, và là implementation chính thức của paper _"Overlap-aware low-latency online speaker diarization based on end-to-end local segmentation"_: _"online speaker diarization as a combination of **incremental clustering** and local diarization applied to a **rolling buffer updated every 500ms**"_, latency chỉnh được **500 ms – 5 s**. **Trượt vì G5 + kiến trúc, không vì G7/G8**: yêu cầu `pyannote.audio` + `torch` full (model PyTorch `.ckpt`), Python 3.10–3.12 (sidecar ghim `>=3.11.4,<3.12` nên còn vừa), và ba model HF gated phải chấp nhận điều khoản thủ công. So với cpp-annote — cùng họ model, cùng tính chất streaming, nhưng đã là ONNX int8 8,2 MB không cần torch — diart là lựa chọn kém hơn nghiêm ngặt cho ràng buộc của dự án. **Đề xuất giữ làm fallback**, không làm arm chính. [Nguồn](https://github.com/juanmc2005/diart) |
| **DiariZen** (BUT Speech@FIT, code MIT / weights CC-BY-NC-4.0, 542 sao, push 2026-08-04) | **FAIL**     | PASS            | Pipeline batch: `DiariZenPipeline.from_pretrained(...)` chạy trên file hoàn chỉnh, backbone **WavLM-large**. Không có API stream. Thêm G3/G6: WavLM-large là ~300M tham số PyTorch, chưa có export ONNX chính thức. Chất lượng thì tốt (README: DER không collar, thắng pyannote v3.1 trên toàn bộ panel) nhưng không thay được tầng realtime                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`microsoft/VibeVoice-ASR`** (joint ASR + diarization, có `vi`)                         | **G2 + G7**  | —               | Audio-LLM **long-form offline**: nhận cả đoạn rồi sinh transcript có nhãn người nói. **Repo đã đo rồi**: RTF ~1,5 trên CPU máy này, và **chỉ 60% clip đoán đúng số người nói**. Vượt trần RTF 0,30 gấp 5 lần. Không mở lại                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **NVIDIA Sortformer / `diar_sortformer_4spk`**                                           | —            | —               | **Thuộc nhánh `inv-nvidia`**, không trùng lặp ở đây. Ghi nhận một điểm cho lead: tên gọi `4spk` gợi ý G8 là vấn đề, và cpp-annote **không** có giới hạn đó (`forced_num_speakers = -1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Joint ASR + diarization / SA-ASR

Ngoài VibeVoice-ASR (đã loại) và Sortformer (nhánh khác), **nhánh này không tìm
thấy model SA-ASR nào vừa streaming vừa có tiếng Việt**. Thứ gần nhất chính là
Moonshine Voice — nhưng nó không phải model joint thật: nó là **hai model chạy
song song trên cùng một stream**, hợp nhất ở tầng thư viện thành `speaker_spans`
gắn vào transcript line. Về mặt kiến trúc đó là late fusion, không phải SA-ASR.
Về mặt sản phẩm thì kết quả giống nhau, nhưng luận văn phải gọi đúng tên.

---

## 6. So sánh với mốc nền — và cảnh báo phải đọc kỹ

| Trục        | Mốc nền                                            | Moonshine Streaming Tiny vi                                                                      | Đọc thế nào                                                                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WER vi      | **5,38%** trên VIVOS-50, seed 42, greedy           | **9,425** (int8) / **9,305** (fp32) macro trên FLEURS-vi + LSVSC, mẫu seeded 400 câu, batch 1    | **BỘ TEST KHÁC NHAU — KHÔNG SO TRỰC TIẾP ĐƯỢC.** Chỉ Phase 3 chạy cả hai trên cùng VIVOS-50 mới sinh ra số so được. Nhưng khoảng cách ~4 điểm đủ lớn để dự đoán trượt                                                                                                               |
| WER en      | **3,86%** (`sherpa-moonshine-en`, 50 câu)          | Không có checkpoint streaming vi+en chung; bản `streaming-small-en` đạt **7,84** OpenASR average | Bộ test khác. Nếu chuyển sang streaming cho tiếng Anh thì cũng nhiều khả năng lùi                                                                                                                                                                                                   |
| RTF         | vi 0,017 · en 0,040 · trần 0,30                    | **Không công bố**                                                                                | Biến chưa biết lớn nhất. Encoder 27M int8 thì rẻ, nhưng decoder autoregressive + diarization VBx thì chưa rõ                                                                                                                                                                        |
| Attribution | **0,78** sạch / **0,59** far-field (mục tiêu 0,85) | Không công bố DER                                                                                | **Đây là trục đáng đánh cược.** Nguyên nhân gốc đã xác định: _"turn length, not language, is the dominant error term"_ — 1 s audio tốn 15,65% EER, lượt trung vị sản phẩm là 1065 ms. Diarizer đọc stream liên tục với cửa sổ 120 s và relabel hồi tố **không bị trói vào biến đó** |
| RAM         | Zipformer-vi 223 MB · Moonshine-en 418 MB đỉnh     | 39 MB weight                                                                                     | Dư địa rất rộng so với `mem_limit: 4g`                                                                                                                                                                                                                                              |
| License     | CC-BY-NC-ND (vi)                                   | **MIT**                                                                                          | Nâng cấp thật                                                                                                                                                                                                                                                                       |

**Nói thẳng:** nếu thanh chắn là "thắng cả hai trục" như người dùng đã chốt, ứng
viên này **nhiều khả năng trượt**, và trượt ở trục WER. Nhưng `plan.md` đã yêu
cầu ghi số đầy đủ chứ không chỉ pass/fail, và đây chính là trường hợp dữ liệu
đầy đủ trả lời được câu hỏi tiếp theo: **cấu hình lai** — Moonshine Streaming lo
bản partial + speaker attribution, Zipformer-vi lo bản final — có qua không. Ứng
viên này vừa khít cho cấu hình đó vì nó rẻ (30,8 MB, 27M tham số) đủ để chạy
**cạnh** incumbent chứ không cần thay thế incumbent.

---

## 7. Ước lượng chi phí screening cho nhánh này

Công thức theo `phase-01`, bước 4:

```
chi phí = (tổng giây audio test) × (RTF ước tính) × (số ứng viên) × (số ngôn ngữ)
```

**Arm ASR:**

| Biến            | Giá trị                                                      | Lấy từ đâu                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tổng giây audio | **~350 s/ngôn ngữ** (VIVOS-50: 50 câu, 3–10 s)               | `plan.md`, mục "Trả lời câu hỏi GPU"                                                                                                                                                                                                                                                                                                           |
| RTF ước tính    | **0,15** (dải 0,05–0,40)                                     | **INFERRED, không có số công bố.** Suy từ: incumbent Moonshine **base-en offline** (61M tham số) đo được RTF 0,040 trên đúng máy này (`development-journey.md:130`). Streaming tiny là **27M** — nhỏ hơn 2,3× — nhưng decode autoregressive theo chunk 80 ms nên số lần gọi decoder tăng mạnh. Lấy hệ số phạt ~4× so với offline làm điểm giữa |
| Số ứng viên     | **1** (`tiny-streaming-vi`)                                  | Mục 1                                                                                                                                                                                                                                                                                                                                          |
| Số ngôn ngữ     | **1** (chỉ `vi` — không có checkpoint streaming vi+en chung) | Catalog: `vi` chỉ có TINY_STREAMING                                                                                                                                                                                                                                                                                                            |

```
350 s × 0,15 × 1 × 1 ≈ 53 s thời gian máy thuần
```

Kể cả ở cận trên RTF 0,40 thì cũng chỉ **140 s**. Cộng overhead nạp model, warm-up,
và 3 lần lặp để có p50/p95: **dưới 15 phút**.

**Arm diarization** đắt hơn hẳn vì cần audio dạng hội thoại dài:

| Biến            | Giá trị                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio hội thoại | **~1 800 s** ước tính (30 phút, nhiều lượt, cả sạch lẫn far-field) — **chưa có manifest, Phase 2 phải dựng**                                                              |
| RTF ước tính    | **0,3** (dải 0,1–0,8), **INFERRED** từ _"diarization is off by default and **costs a lot of compute**"_ (`docs/diarization-models.md`) — một câu định tính, không phải số |
| Số cấu hình     | **3** (`cluster_window_sec` ∈ {60, 120, unlimited})                                                                                                                       |

```
1 800 s × 0,3 × 3 ≈ 27 phút
```

**Tổng nhánh này: dưới 1 giờ thời gian máy.** Rất xa ngưỡng 8 giờ.

### Quyết định GPU cho nhánh này: **KHÔNG CẦN THUÊ**

Cả hai trigger trong `plan.md` đều **không kích hoạt**:

1. _"Một ứng viên không chạy được trên CPU"_ — **không.** Ứng viên sống sót là
   int8 `.ort` với wheel `manylinux_2_34_x86_64` dựng sẵn. Nó **được thiết kế cho
   CPU edge**: model card ghi _"intended for on-device use on edge-class hardware"_
   và Moonshine đo kích thước cài đặt trên Android armeabi-v7a. GPU không giúp gì.
2. _"Tổng thời gian screening vượt 8 giờ"_ — **không.** Ước lượng dưới 1 giờ.

Đây là quyết định cho **riêng nhánh này**. Lead phải cộng với `inv-nvidia` và
`inv-funasr` trước khi báo người dùng.

---

## 8. Xếp hạng — có khuyến nghị, không phải danh sách

**Hạng 1 — `tiny-streaming-vi` + diarization community-1, chạy như MỘT arm ghép
đôi.** Đây là ứng viên duy nhất của nhánh qua G1–G8, và là ứng viên duy nhất
trong toàn bộ khảo sát của tôi đánh vào **cả hai trục thanh chắn bằng một lần
tích hợp**. Chi phí đo dưới một giờ. Rủi ro chính là WER, đã biết trước và đã
lượng hoá. Không đo nó là bỏ lỡ câu trả lời cho trục speaker — trục mà kiến trúc
hiện tại **đã được chứng minh là không thể sửa** (`system-architecture.md:347`).

**Hạng 2 — diart, chỉ khi cpp-annote thất bại ở Phase 4 vì chi phí CPU.** Cùng
họ model, cùng tính chất online, nhưng kéo theo `torch`. Chỉ có ý nghĩa nếu ta
cần chỉnh latency xuống 500 ms và cpp-annote không cho phép (cận dưới của
`analyze_cadence` chưa xác minh được).

**Hạng 3 — Qwen3-ASR 0.6B, sau khi `inv-funasr` xác minh G2.** Có `vi` thật, có
tuyên bố streaming thật, có đường CPU. Nếu G2 pass thì đây là ứng viên mạnh thứ
hai. Tôi **không** tuyên bố nó pass.

**Không đề xuất đo:** toàn bộ họ Whisper, Kyutai, Voxtral, Granite, FireRedASR,
DiariZen, pyannote offline. Lý do đã ghi, trích được, kiểm lại được.

---

## 9. Rủi ro áp dụng (adoption risk)

| Rủi ro                            | Mức                             | Chi tiết                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Độ chín của checkpoint vi**     | **Cao**                         | Snapshot **2026-08-24**, mới ~3 tuần tính đến hôm nay. Card tự cảnh báo: _"pin the revision of this repository rather than tracking `main`"_ vì _"the weights behind a language move as later stages win"_                                                                                                                                         |
| **Chất lượng dữ liệu train**      | **Cao**                         | _"The crawled transcripts are **pseudo-labels**... produced by running a **Whisper-family teacher model**... **No human-verified transcript was used for the bulk of training**"_ — 83 000 h trong tổng ~83 700 h. Model kế thừa lỗi của teacher với danh từ riêng, số, và code-switching. **Code-switching vi/en là đúng ca sử dụng của Chatofy** |
| **Hallucination loop**            | **Trung bình**                  | Card yêu cầu chặn bằng `max_new_tokens`: _"Like other seq2seq ASR models this one can fall into a repetition loop, and short or noisy clips are where it happens."_ Lượt trung vị của sản phẩm là **1065 ms** — đúng vùng nguy hiểm                                                                                                                |
| **Sức khoẻ dự án**                | **Thấp**                        | 11 084 sao, push cuối **2026-08-31**, wheel đa nền tảng đầy đủ, license MIT rõ ràng với LICENSE liệt kê exhaustive. Doanh nghiệp đứng sau (Useful Sensors / Moonshine AI)                                                                                                                                                                          |
| **Chi phí CPU của diarization**   | **Chưa biết — rủi ro lớn nhất** | Chỉ có câu định tính _"costs a lot of compute"_. Không số nào. Chạy cạnh sidecar TTS trên 4 thread                                                                                                                                                                                                                                                 |
| **Không kiểm soát được thread**   | **Trung bình**                  | `parse_transcriber_options` trong `core/moonshine-c-api.cpp` **không có option số thread**. ORT link tĩnh có thể mặc định dùng hết core. Trên `cpus: 4` của prod (R3) điều này ảnh hưởng trực tiếp tới RTF đo được                                                                                                                                 |
| **Hai bản ORT trong một process** | **Thấp–Trung bình**             | `moonshine-voice` link ORT tĩnh, `sherpa-onnx` link động `libonnxruntime.so.1.27.0`. Không xung đột pip, nhưng chưa ai xác minh hai bản sống chung trong một process Python. Memory của repo đã ghi nhận sidecar STT/TTS từng crash vì `libonnxruntime`                                                                                            |
| **Nhãn người nói đổi hồi tố**     | **Trung bình**                  | Đặc tính thiết kế, không phải bug. Cần quyết định UX và quyết định cách chấm điểm ở Phase 3                                                                                                                                                                                                                                                        |

---

## 10. Giới hạn của khảo sát này

Phải nói rõ những gì pha này **không** làm được:

1. **Không tải weight nào**, theo ràng buộc. Mọi con số WER là **tự công bố bởi
   nhà phát hành**, chưa ai kiểm chứng độc lập. Riêng Moonshine có ghi lại quy
   trình kiểm tra conversion bằng đo đạc (fp32 9,305 vs repo 9,300, 400/400 và
   397/400 transcript byte-identical) — trung thực hơn mức trung bình, nhưng vẫn
   là số của chính họ.
2. **Không có DER công bố cho cpp-annote / community-1 trong tài liệu Moonshine.**
   Tôi không lấy số DER của pyannote upstream gán cho bản port, vì port đã sửa
   đường dữ liệu (bỏ cnpy, đổi sang model tải về) và chạy ở chế độ sliding window
   bounded thay vì full-history. Số của bản batch **không áp cho bản streaming**.
3. **Speechmatics chưa xác minh.** Web search không trả về trang tài liệu ngôn
   ngữ chính thức của họ. Vì đằng nào cũng trượt G3 nên tôi không tiêu thêm thời
   gian; nếu lead cần mốc cloud đầy đủ thì đây là lỗ hổng.
4. **Không có RTF CPU x86 công bố** cho bất kỳ ứng viên nào trong nhánh. Mọi RTF
   trong mục 7 là **INFERRED** và ghi rõ dải.
5. **Qwen3-ASR để mở**, không kết luận. Nó nằm ở ranh giới giữa nhánh này và
   nhánh FunASR/Alibaba, và câu trả lời G2 cần đọc mã nguồn triển khai chứ không
   chỉ model card.
6. **Không kiểm tra hai bản ONNX Runtime có sống chung được không.** Đây là rủi
   ro G5 duy nhất còn lại và chỉ một smoke test import mới trả lời được — việc
   của Phase 2.
7. **Không khảo sát WeNet, SenseVoice, NVIDIA** — thuộc nhánh khác theo phân công.

---

## Câu hỏi chưa giải quyết

1. **Chấm attribution theo snapshot nào?** Diarizer sửa nhãn hồi tố. `finish_stream()`
   cho số đẹp nhất nhưng không phản ánh thứ người dùng thấy lúc đang nói.
   `get_turns()` tại thời điểm phát mới là số so được với mốc 0,78. Phase 3 phải
   chọn, hoặc đo cả hai. **Tôi đề nghị đo cả hai** — chênh lệch giữa chúng chính
   là phần mà kiến trúc hiện tại không bao giờ có được.
2. **Giới hạn số thread thế nào?** C API không có option. Có thử được qua biến môi
   trường ORT (`OMP_NUM_THREADS`) không, hay phải dựa vào `cpus: 4` của container?
   Nếu không giới hạn được thì RTF đo ở dev 8 thread sẽ nói dối về prod 4 thread —
   đúng cái bẫy R3 cảnh báo.
3. **`moonshine-voice` (ORT tĩnh) và `sherpa-onnx` (ORT động 1.27.0) có import
   chung một process được không?** Chưa xác minh. Nếu không, arm này cần process
   riêng và bài toán `mem_limit: 4g` phải tính lại.
4. **Có cần manifest audio hội thoại mới không?** `benchmarks/speaker-id` hiện
   chấm attribution theo lượt. Diarization streaming cần audio nhiều lượt liên
   tục có nhãn thời gian. Nếu manifest đó chưa có, chi phí thật của arm này là
   **chi phí gán nhãn**, không phải chi phí CPU — và con số 27 phút ở mục 7 sẽ
   thành sai lệch nghiêm trọng.
5. **Có nên đo thêm `fleurs_vi` để cầu nối hai bộ test không?** Nếu chạy incumbent
   Zipformer-vi trên FLEURS-vi, ta có điểm neo để đọc con số 10,98 của Moonshine.
   Rẻ, và biến "không so được" thành "so được". Đề nghị lead cân nhắc thêm vào
   Phase 3.
