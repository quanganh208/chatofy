---
phase: 1
branch: quét ngang Hugging Face Hub theo khả năng (không theo nhà cung cấp)
date: 2026-09-16
status: hoàn tất
---

# Quét ngang Hugging Face Hub — streaming ASR + diarization cho tiếng Việt

## Kết luận trước

Quét ngang Hub tìm được **một ứng viên sống sót cả tám cổng mà ba nhánh nhà cung
cấp không phủ**: `moonshine-ai/moonshine-streaming-tiny-vi`. Nó là streaming ASR
tiếng Việt thật (causal, 80 ms lookahead), có gói int8 `.ort` chính thức 32,3 MB
đang phục vụ trên CDN, MIT, và runtime của nó **đóng gói ONNX Runtime riêng** nên
không đụng `onnxruntime==1.27.0` đang ghim. Quan trọng hơn: cùng thư viện đó làm
**diarization streaming** (streaming VBx trên pyannote community-1) với số người
nói không khai báo trước — tức là một ứng viên **joint ASR + speaker** chạy một
runtime duy nhất.

Tìm được thêm **một ứng viên gần trúng và đáng ghi vào luận văn**:
`khanhld/chunkformer-rnnt-large-vie` đạt **WER 2,49 % trên VIVOS** (mốc nền đang
là 5,38 % trên cùng bộ test), CC-BY-4.0, và repo có sẵn ONNX export streaming
cache-aware. Nó **trượt G2** vì lý do đo được: checkpoint tiếng Việt được huấn
luyện với right context tối thiểu 64 frame = **5,12 s lookahead**, và checkpoint
`streaming: true` duy nhất được phát hành là tiếng Anh LibriSpeech. Đây đúng là
cái bẫy VietASR lặp lại — nhưng lần này công thức huấn luyện, dữ liệu và runtime
đều công khai, nên nó là một lựa chọn fine-tune có thật chứ không phải ngõ cụt.

Ngoài hai cái trên, **không có gì khác**. Phần còn lại của Hub hoặc là bốn họ
model mà ba nhánh kia đang lo, hoặc trượt G1 (không có tiếng Việt).

---

## 1. Phạm vi đã quét

Tất cả qua HF Hub API (`https://huggingface.co/api/models?...`), phân trang bằng
`Link: rel="next"` header. Không tải weight nào; chỉ metadata, model card,
config, và mã nguồn trên GitHub.

| #   | Query                                                                                                                                                                                | Kết quả                                          | Ghi chú                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------- |
| A   | `pipeline_tag=automatic-speech-recognition&language=vi`                                                                                                                              | **36 191** (liệt kê hết, 37 trang × 1000)        | mẫu số đầy đủ                       |
| B   | `language=vi` (mọi pipeline)                                                                                                                                                         | 6 000+                                           |                                     |
| C   | `pipeline_tag=ASR&filter=streaming`                                                                                                                                                  | **246** (toàn bộ vũ trụ ASR gắn tag `streaming`) |                                     |
| D   | `filter=vi,streaming`                                                                                                                                                                | **25**                                           | giao điểm chính xác                 |
| E   | `filter=vi,speaker-diarization`                                                                                                                                                      | **4**                                            |                                     |
| F   | `pipeline_tag=audio-text-to-text&language=vi`                                                                                                                                        | 328                                              | speech-LLM                          |
| G   | `filter=speaker-diarization,streaming`                                                                                                                                               | 31                                               |                                     |
| H   | `filter=speaker-diarization`                                                                                                                                                         | 456                                              |                                     |
| I   | `search=sortformer` / `transcribe diarize` / `speaker-attributed`                                                                                                                    | 75 / 38 / 0                                      |                                     |
| J   | `author=` 15 nhà công bố vi (vinai, VietAI, zalo-ai, viettel, VinBigdata, FPTAI, nguyenvulebinh, khanhld, doof-ferb, erax-ai, namphungdn134, ura-hcmut, vilm, Viet-Mistral, phamson) | 29 model ASR                                     | **đây là query tìm ra ChunkFormer** |
| K   | `api/datasets?search=` vlsp / voxvietnam / vietspeech / vivos / vietnamese speech / vietnamese conversation / vietnamese diarization                                                 | 100/5/13/39/12/4/**0**                           |                                     |

Quét từ khoá trên **toàn bộ 36 191 model ở query A** (khớp trong `modelId` +
`tags`):

| Từ khoá              | Số model | Từ khoá       | Số model |
| -------------------- | -------: | ------------- | -------: |
| `streaming`          |      468 | `cache-aware` |       75 |
| `conformer`          |     1167 | `zipformer`   |       71 |
| `rnnt`               |      372 | `chunk`       |       62 |
| `transducer`         |      298 | `paraformer`  |       17 |
| `diariz`             |      176 | `simul`       |       16 |
| `realtime`           |      115 | `sortformer`  |       12 |
| `real-time`          |       20 | `multitalker` |        7 |
| `online`             |        7 | `causal`      |        6 |
| `speaker-attributed` |        1 | `emformer`    |        0 |

**Lưu ý phương pháp (đã kiểm chứng, không phải giả định):** filter `language=vi`
của HF **có** chuẩn hoá thẻ `vie` về `vi` — hai model ChunkFormer khai `language:
vie` vẫn nằm trong kết quả query A (kiểm bằng cách tra ID trong tập kết quả).
Ngược lại, `language=vie` trả về rác (model tiếng Nhật, Bồ Đào Nha) tức là filter
đó bị bỏ qua. Vậy **`language=vi` là filter đúng và đủ bao**; ai quét lại đừng
dùng `vie`.

### 468 model vi có nhắc "streaming" gom về họ

`nemotron` 147 · `conformer` 40 · `moonshine` 38 · `zipformer` 28 · `voxtral` 21 ·
`vibevoice` 19 · `parakeet` 16 · `whisper` 12 · `sortformer` 8 · `multitalker` 7 ·
`fun-asr` 5 — phần đuôi là ~110 repo lẻ, đã soát tay từng cái: **toàn bộ là ngôn
ngữ khác** (fa, de, es, zh, ru, ja, ko, hi, bn, id, et, fr, uz, tr). Không có
model tiếng Việt nào ngoài bốn họ ở mục 2.

---

## 2. Giao điểm `vi` + `streaming` = 25 repo, gom về **4 họ**

| Họ                                             | Số repo | Ai lo                       | Ghi chú               |
| ---------------------------------------------- | ------: | --------------------------- | --------------------- |
| `nemotron-3.5-asr-streaming-0.6b` + conversion |      17 | **nhánh NVIDIA**            | không mở lại          |
| `FunAudioLLM/Fun-ASR-*-Nano-2512`              |       5 | **nhánh FunASR**            | xem cảnh báo dưới     |
| `TheStageAI/thewhisper-large-v3-turbo`         |       1 | —                           | **loại, G2** (mục 5)  |
| `moonshine-ai/moonshine-streaming-tiny-vi`     |       1 | **không ai** → phần của tôi | **ứng viên sống sót** |

> **Chuyển cho `inv-funasr`:** `FunAudioLLM/Fun-ASR-Nano-2512` là repo **duy nhất
> trên Hub** đồng thời mang cả ba thẻ `vi` + `streaming` + `speaker-diarization`
> (apache-2.0, langs gồm `vi`, arXiv 2509.12508). Nếu nhánh FunASR mới chỉ nhìn
> Paraformer-streaming thì đây là thứ cần kiểm G7/G8, không phải Paraformer.

---

## 3. Ứng viên sống sót — `moonshine-ai/moonshine-streaming-tiny-vi`

Nguồn: model card `https://huggingface.co/moonshine-ai/moonshine-streaming-tiny-vi`
· `config.json` cùng repo · catalog biên dịch
`https://raw.githubusercontent.com/moonshine-ai/moonshine/main/core/moonshine-model-file-metadata.generated.cpp`
· docs repo `moonshine-ai/moonshine` · PyPI `moonshine-voice`.

### Thông số

| Mục              | Giá trị                                                                                                                                                      | Nguồn                                                            | Trạng thái |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------- |
| Tham số          | **27,0 M** (vocab vi 12 288)                                                                                                                                 | model card, bảng "Checkpoint identity"                           | VERIFIED   |
| Kiến trúc        | encoder 6 lớp × width 320 × 8 head; decoder 6 lớp; frontend 50 Hz, CMVN, asinh, 2 conv causal stride-2                                                       | model card "Architecture"                                        | VERIFIED   |
| Sliding windows  | `[[17,5],[17,5],[17,1],[17,1],[17,5],[17,5]]`                                                                                                                | `config.json` `encoder_config.sliding_windows`                   | VERIFIED   |
| Lookahead        | **~80 ms** (`total_lookahead: 16` frame × `frame_len: 80` sample = 5 ms/frame)                                                                               | `streaming_config.json` trên CDN                                 | VERIFIED   |
| Định dạng export | int8 `.ort` (ONNX Runtime flatbuffer, memory-mappable)                                                                                                       | catalog + HEAD 200 trên CDN                                      | VERIFIED   |
| Kích thước gói   | **32,3 MB** (encoder 7,77 + decoder_kv 19,72 + frontend.weights 2,09 + adapter 1,32 + cross_kv 1,29 + frontend.model 0,023 + tokenizer 0,095 + config 509 B) | catalog (kèm CRC32C từng file)                                   | VERIFIED   |
| Đường dẫn        | `https://download.moonshine.ai/model/tiny-streaming-vi/quantized_26_08_24/`                                                                                  | catalog; HEAD trả `HTTP/2 200` + `content-length` khớp từng byte | VERIFIED   |
| License          | **MIT**                                                                                                                                                      | model card frontmatter + `docs/models/available-models.md`       | VERIFIED   |
| Runtime          | `moonshine-voice` 0.1.5 (PyPI), wheel `manylinux_2_34_x86_64` 19,9 MB                                                                                        | PyPI JSON API                                                    | VERIFIED   |
| Chunk size       | do caller chọn; benchmark mặc định `--transcription-interval 0.5 s`                                                                                          | `docs/using/benchmarks.md`                                       | VERIFIED   |

### WER công bố — **kèm tên bộ test, không trộn**

| Bộ test                                      |       WER | Ghi chú                                  |
| -------------------------------------------- | --------: | ---------------------------------------- |
| `fleurs_vi` (FLEURS Vietnamese, read speech) | **10,98** | float32, mẫu seed 400 utterance, batch 1 |
| `lsvsc_vi` (LSVSC, spontaneous vi)           |  **7,63** | cùng điều kiện                           |
| **macro 2 panel**                            | **9,305** | float32                                  |
| macro, bản int8 `.ort` thực dùng             | **9,425** | +0,120 so với float                      |

Nguồn: model card mục "Evaluation". **Không so trực tiếp với 5,38 % của VIVOS** —
khác bộ test hoàn toàn. Phase 3 mới sinh ra số so được.

_Sai lệch đã ghi nhận:_ `docs/models/available-models.md` ghi Vietnamese Tiny
Streaming là "34 million / 9.4%", còn model card ghi 27,0 M / 9,305 (float) và
9,425 (int8). 9,4 % khớp bản int8. Con số 34 M là của bản tiếng Anh (vocab
32 768); bản vi nhỏ hơn do vocab 12 288. Tin model card.

### Tám cổng

| Cổng                                 | Kết quả  | Bằng chứng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** Có tiếng Việt                 | **PASS** | `language: [vi]`, có số riêng cho 2 panel tiếng Việt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **G2** Streaming thật                | **PASS** | `streaming_config.json` khai `frontend_state_shapes` = `sample_buffer[1,79]`, `conv1_buffer[1,320,4]`, `conv2_buffer[1,640,4]`, `frame_count[1]` → **state mang qua từng chunk**. Graph tách riêng `decoder_kv.ort` (KV cache) + `cross_kv.ort`. `total_lookahead` cố định 16 frame. Option `use_speculative_decoding`: "Streaming re-decode verifies the previous hypothesis instead of restarting from BOS". **Không phải cửa sổ trượt trên model offline** — kiến trúc `moonshine_streaming` là class riêng, khác hẳn `moonshine` offline |
| **G3** Chạy được CPU                 | **PASS** | int8 `.ort` sẵn trên CDN; wheel manylinux x86_64; `docs/using/benchmarks.md`: "sticking with the CPU, since most applications can't rely on GPU or NPU acceleration"                                                                                                                                                                                                                                                                                                                                                                         |
| **G4** License                       | **PASS** | MIT. _(Lưu ý: bản Vietnamese **Base** không-streaming là Moonshine Community License phi thương mại — đó là model khác, đã deprecated)_                                                                                                                                                                                                                                                                                                                                                                                                      |
| **G5** Runtime khả dụng              | **PASS** | `moonshine-voice` 0.1.5 dependency gốc chỉ có numpy/sounddevice/requests/tqdm/filelock/platformdirs/google-crc32c — **không có `onnxruntime`**; ORT được link tĩnh vào native lib trong wheel. Không đụng `sherpa-onnx==1.13.4` / `onnxruntime==1.27.0`. Wheel yêu cầu glibc ≥ 2.34; `services/local-stt/Dockerfile` dùng `python3.11-bookworm-slim` = Debian 12 = glibc 2.36 → **khớp**                                                                                                                                                     |
| **G6** Kích thước                    | **PASS** | 32,3 MB weight, thừa sức trong `mem_limit: 4g` kể cả nhiều stream                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **G7** Diarization streaming         | **PASS** | `c-api.md` §`speaker_span_t`: "**streaming diarization re-clusters a sliding window of recent speech** (`diarization_cluster_window_sec`, 120 s mặc định) **as more audio arrives**". Option `diarization_cluster_window_sec`: "Max recent history for **streaming VBx**; Batch/one-shot always uses full history" → phân biệt rõ chế độ streaming với batch. Option `diarization_analyze_cadence`: "Live `add_audio` / `transcribe()` runs at most one window per call"                                                                     |
| **G8** Số người nói không biết trước | **PASS** | Không có tham số `num_speakers`/`max_speakers`/`n_speakers` ở bất kỳ đâu trong toàn bộ bề mặt API công khai (grep sạch trên `docs/api/options.md`, `docs/api/classes.md`, `docs/api/c-api.md`). `speaker_index` định nghĩa là "Order the speaker **first appeared** in the transcript, starting at 0" → người nói được phát hiện tăng dần                                                                                                                                                                                                    |

### Ba điều phải biết trước khi đo (không phải cổng, nhưng ảnh hưởng thiết kế Phase 2–3)

1. **Speaker span là MUTABLE.** `c-api.md`: span "can move, merge, split, or change
   speaker on any transcription call — **even on lines that are already complete**";
   chỉ đóng băng sau `diarization_cluster_window_sec` (mặc định 120 s). Phase 3
   phải chọn dứt khoát chấm điểm **gán lần đầu** (thứ người dùng thấy realtime,
   đúng với bài toán dịch trực tiếp) hay **gán sau khi ổn định** — hai con số này
   sẽ khác nhau, và mốc 0,78/0,59 của repo là loại nào cần xác định lại. Có cờ
   `have_speakers_changed` để bắt revision.
2. **Dữ liệu huấn luyện là pseudo-label.** ~83 000 h crawl gán nhãn bằng model
   Whisper-family teacher, **không có người kiểm**; chỉ ~700 h read speech thật.
   Model card nói thẳng: kế thừa lỗi của teacher ở danh từ riêng, số, code-switching.
   Với app dịch vi↔en, **code-switching là rủi ro trực tiếp**.
3. **Chưa từng đo far-field/noisy.** Model card: "No evaluation of telephony,
   children's speech, heavy dialect, or **noisy far-field conditions**". Mốc
   far-field 0,59 → mục tiêu 0,85 của repo nằm đúng vào vùng chưa ai đo.

---

## 4. Ứng viên gần trúng — ChunkFormer tiếng Việt (loại ở G2, nhưng phải ghi lại)

`khanhld/chunkformer-{ctc,rnnt}-large-vie` — ICASSP 2025, arXiv 2502.14673,
GitHub `khanld/chunkformer`. Ba nhánh kia không chạm vào vì nó không thuộc
NVIDIA/FunASR/Whisper.

|                      | ctc-large-vie    | rnnt-large-vie |
| -------------------- | ---------------- | -------------- |
| Params               | 110 M            | **113 M**      |
| Dữ liệu vi           | ~3000 h          | **~5000 h**    |
| **VIVOS WER**        | 4,18             | **2,49**       |
| Common Voice vi WER  | 6,66             | **5,18**       |
| VLSP-2020 Task 1 WER | 14,09            | **12,75**      |
| License              | cc-by-**nc**-4.0 | **cc-by-4.0**  |

Nguồn: `model-index` trong frontmatter model card của từng repo + bảng benchmark
trong card (có ghi rõ "we manually apply Text Normalization").

**Vì sao đáng chú ý:** 2,49 % trên VIVOS so với mốc nền 5,38 % trên **cùng tên bộ
test** — chưa bằng một nửa lỗi. Và repo đã có sẵn thứ cần cho G3/G5: changelog
2026-06 ghi "ONNX export & runtime … (streaming **and** non-streaming), with a
self-contained ONNX Runtime inference host and a **true online streaming session
(incremental audio in → text out)**"; `examples/onnx/README.md` mô tả
`encoder_chunk.onnx` nhận `chunk, att_cache, cnn_cache, offset` → trả
`enc_out, r_att_cache, r_cnn_cache` (cache-aware thật), và
`OnnxAsrModel.stream()` mở `StreamingSession` giữ cache encoder + state LSTM của
RNN-T predictor. Runtime chỉ cần `onnxruntime` + `numpy` ("`transcribe(...)` /
`encode_*` need only onnxruntime + numpy") → **không đụng bản ghim**.

**Vì sao vẫn trượt G2 — số đo, không phải cảm tính:**

| Checkpoint                                             | `dynamic_chunk_sizes` | `dynamic_right_context_sizes`                                    | cờ `streaming`        |
| ------------------------------------------------------ | --------------------- | ---------------------------------------------------------------- | --------------------- |
| `chunkformer-rnnt-large-vie` (**vi**)                  | `[-1,-1,64,128,256]`  | **`[64,128,256]`**                                               | _không có_            |
| `chunkformer-ctc-large-vie` (**vi**)                   | `[64,128,256]`        | **`[128,128,128]`**, `causal: false`, `use_dynamic_chunk: false` | _không có_            |
| `chunkformer-ctc-small-libri-960h-stream-dct` (**en**) | `[4,6,8]`             | **`[0]`**                                                        | **`streaming: true`** |

`chunkformer/modules/encoder.py` đặt cứng `subsampling_rate=8`, `frame_shift: 10`
ms → **1 encoder frame = 80 ms**. Vậy right context nhỏ nhất của checkpoint tiếng
Việt là 64 × 80 ms = **5,12 s lookahead** (lớn nhất 256 → 20,5 s). Đó là chế độ
chunked long-form tiết kiệm bộ nhớ, **không phải low-latency streaming**.
Checkpoint `streaming: true` duy nhất được phát hành là **tiếng Anh LibriSpeech**.

`examples/onnx/README.md` còn dẫn ví dụ export streaming bằng
`--checkpoint khanhld/chunkformer-rnnt-small-vie-stream-dct` — **repo đó không tồn
tại**, API trả `401`. Danh sách đầy đủ của tác giả (10 repo) không có nó.

→ **Đúng cái bẫy VietASR**: kiến trúc streaming + runtime streaming + weight tiếng
Việt xuất sắc, nhưng **weight tiếng Việt không được huấn luyện streaming**.

**Khác VietASR ở một điểm quyết định:** ở đây công thức huấn luyện streaming đã
chạy thật và công khai (`stream-dct`, right context 0, chunk 4/6/8 frame =
320/480/640 ms), danh sách 5000 h dữ liệu vi công khai (`dataset.tsv` trong repo
ctc), và ONNX streaming runtime đã có. Fine-tune một `chunkformer-rnnt-vie-stream-dct`
là việc **có đường đi rõ**, không phải nghiên cứu mở. Đây là dữ kiện trực tiếp
cho quyết định thuê GPU ở bước 5 của Phase 1 — nhưng **đó là quyết định của
người dùng**, tôi chỉ đặt con số lên bàn.

---

## 5. Bảng bị loại — kèm lý do trích được

| Model                                                                                                                                                                                                                                                                                                                                                                               | Cổng trượt     | Trích dẫn / bằng chứng                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TheStageAI/thewhisper-large-v3-turbo`                                                                                                                                                                                                                                                                                                                                              | **G2** (và G3) | Card: "Long audio is split into the bundle's window size (**10 s**…)", `chunk_length_s=15`, có `overlap_seconds`. Cửa sổ trượt trên Whisper offline — đúng loại bị loại. Tối ưu cho NVIDIA GPU / Apple CoreML                                                                                                                                                                                             |
| `microsoft/VibeVoice-ASR-Streaming-7B` + `christopherthompson81/vibevoice-asr-streaming-{1.5b,7b}-onnx`                                                                                                                                                                                                                                                                             | **G1**         | `language: [en, zh, es, pt, de, ja, ko, fr, ru, it]` — **không có vi**. _Đáng tiếc nhất của cả đợt quét_: joint ASR + speaker-diarization + streaming + ONNX + MIT, đủ mọi thứ trừ tiếng Việt. Bản 7B còn trượt G6                                                                                                                                                                                        |
| `syvai/cohere-transcribe-diarize`                                                                                                                                                                                                                                                                                                                                                   | **G1, G2, G3** | Card: "the diarization + timestamp fine-tune was done **exclusively on English supervision**"; vi nằm trong nhóm "**Likely usable (untested by us)**" → không có số nào cho tiếng Việt. "Maximum supported clip length: 30 s — longer audio should be processed with **sliding windows**". 2 B params, chỉ safetensors, khuyến nghị vLLM trên RTX 3090. Thêm: chỉ có 8 speaker token `<\|spltoken0..7\|>` |
| `OpenMOSS-Team/MOSS-Transcribe-Diarize`                                                                                                                                                                                                                                                                                                                                             | **G1**         | `language: [en, zh]`                                                                                                                                                                                                                                                                                                                                                                                      |
| `giangndm/moss-transcribe-diarize-encoder`                                                                                                                                                                                                                                                                                                                                          | **G1, G2**     | Khai `vi` trong 9 ngôn ngữ nhưng không có số nào cho tiếng Việt (chỉ nói chung "50+ languages"). Là **encoder Whisper-Medium tách rời** (`pipeline_tag: feature-extraction`), "Max Audio Length: **30 seconds**" → không streaming, và không phải ASR hoàn chỉnh                                                                                                                                          |
| `GradientDescent2718/LS-EEND-ONNX`                                                                                                                                                                                                                                                                                                                                                  | không phải ASR | Streaming EEND diarizer, ONNX, MIT — **diarization-only**. Ghi lại như lựa chọn ghép nếu Moonshine G7 hỏng khi đo; không phải ứng viên độc lập                                                                                                                                                                                                                                                            |
| `FermionResearch/Phonon-1{,-Big,-Micro}`                                                                                                                                                                                                                                                                                                                                            | **G1, G3**     | `language: [en]`; đóng gói `.bps.tar.zst` cho MLX/Apple Silicon                                                                                                                                                                                                                                                                                                                                           |
| `lelegu/omni-router-speechcrawl-streaming-asr-0.6b-v1`                                                                                                                                                                                                                                                                                                                              | **G1, G3, G4** | `language: [en]`; chỉ `model.pth`; license `apple-amlr`                                                                                                                                                                                                                                                                                                                                                   |
| `audarai/Audar-ASR-V1-{Turbo,Flash}`                                                                                                                                                                                                                                                                                                                                                | **G1**         | `language: [ar, en]`                                                                                                                                                                                                                                                                                                                                                                                      |
| `zenlm/zen3-asr` · `x-square-robot/X2-ASR-4B-0812` · `GilgameshWind/X-ASR-zh-en`                                                                                                                                                                                                                                                                                                    | **G1**         | `[en,zh]` / `[zh,en]` / `[zh,en]`                                                                                                                                                                                                                                                                                                                                                                         |
| `sbintuitions/hikari-medium`                                                                                                                                                                                                                                                                                                                                                        | **G1**         | `[en, ja, ru, de]`                                                                                                                                                                                                                                                                                                                                                                                        |
| `VoxRT/streaming-medium-pc-vxrt` · `lowdown-labs/fela-streaming-asr` · `vikramlingam/meg-v1`                                                                                                                                                                                                                                                                                        | **G1**         | `[en]`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pluttodk/milo-asr` (da) · `SkunkWorkLabs/varuna-stt` (hi)                                                                                                                                                                                                                                                                                                                          | **G1**         |                                                                                                                                                                                                                                                                                                                                                                                                           |
| Họ `Shenava`/`PersianML` (≈20 repo), `speechcatcher` (de/es/en), `vosk-model-*-streaming` (ru/bn/uz), `icefall-*-streaming` (fr/ko/id/en), `bookbot/*-streaming-id`, `ken4869/lyr-asr-*-streaming` (ja/ko/pt), `mobilebytesensei/betterflow-*` (hi/bn/en), `Rekody/rekody-streaming-en-*`, `typhoon-asr-streaming-115m` (th), `AudenAI/auden-asr-zh-stream`, `nur-dev/*` (kk/ru/en) | **G1**         | Toàn bộ ~110 repo đuôi của tập 468 — không repo nào có tiếng Việt                                                                                                                                                                                                                                                                                                                                         |
| `khanhld/chunkformer-{ctc,rnnt}-large-vie`                                                                                                                                                                                                                                                                                                                                          | **G2**         | Xem mục 4 — right context tối thiểu 5,12 s, không có cờ `streaming`                                                                                                                                                                                                                                                                                                                                       |
| `moonshine-ai/moonshine-base-vi` (không streaming)                                                                                                                                                                                                                                                                                                                                  | **G2, G4**     | Kiến trúc `moonshine` offline; license Moonshine **Community** (phi thương mại), đã bị đánh dấu deprecated trong `available-models.md`                                                                                                                                                                                                                                                                    |
| sherpa-onnx online-transducer zipformer · VietASR (`zzasdf/viet_iter3_pseudo_label`) · `nvidia/nemotron-3.5-asr-streaming-0.6b`                                                                                                                                                                                                                                                     | —              | Đã đóng từ trước / thuộc nhánh khác. Không mở lại                                                                                                                                                                                                                                                                                                                                                         |

---

## 6. Những chỗ quét này **không** phủ

Ghi thẳng để người sau không tưởng là đã xong:

- **Không đo gì cả.** Mọi con số WER ở đây là **do nhà phát hành công bố**, trên
  bộ test họ chọn. Không có ô nào tôi tự đo. Ràng buộc "không tải weight" giữ
  nguyên từ đầu đến cuối.
- **Không kiểm được `.ort` có nạp bằng `onnxruntime==1.27.0` trần hay không.**
  Tôi xác minh `moonshine-voice` không kéo `onnxruntime` từ pip (nên không xung
  đột), nhưng **không** xác minh được graph `.ort` của Moonshine có nạp trực tiếp
  bằng ORT Python API đang ghim. Nếu Phase 2 muốn tự lái graph thay vì dùng SDK,
  đây là rủi ro chưa đóng.
- **Không có RTF nào cho CPU x86 4 thread.** `docs/using/benchmarks.md` nói bảng
  cột "Linux x86 và Raspberry Pi 5 … were last taken before the build-optimization
  fix … so they **read pessimistically**". Không lấy được số đáng tin. Trần RTF
  ≤ 0,30 **chưa được kiểm** cho ứng viên nào — kể cả Moonshine, và đặc biệt là khi
  **bật `identify_speakers`**, thứ mà chính docs mô tả là "costs a lot of compute".
- **Không kiểm chéo bằng tài liệu ngoài Hub/GitHub.** Không đọc paper VLSP,
  không tra leaderboard học thuật ngoài `paperswithcode` link trong model card.
  Query dataset (mục K) chỉ dùng để tìm nhà công bố, không để xếp hạng.
- **`search=vietnamese diarization` trả về 0 dataset.** Nghĩa là **không có bộ
  test diarization tiếng Việt công khai nào trên Hub**. Mốc speaker attribution
  0,78/0,59 của repo đang dựa trên dữ liệu gì, và Phase 3 sẽ đo trên gì, là câu
  hỏi chưa có đáp án từ phía Hub.
- **Không xác minh Moonshine chạy được `identify_speakers` cùng lúc với model
  tiếng Việt.** Hai model pyannote là language-agnostic nên về nguyên tắc là
  được (INFERRED, cơ sở mạnh), nhưng docs không có ví dụ nào ghép streaming
  không-phải-tiếng-Anh với diarization.

---

## Câu hỏi chưa giải quyết

1. **Chấm điểm speaker attribution theo lần gán đầu hay lần gán ổn định?**
   Moonshine sửa lại span trong cửa sổ 120 s, kể cả trên dòng đã đóng. Hai lựa
   chọn cho hai con số khác nhau, và mốc 0,78 / 0,59 hiện tại thuộc loại nào thì
   tôi không xác định được từ repo. Phải chốt trước khi Phase 3 chạy, nếu không
   kết quả không so được với mốc nền.
2. **Đo diarization tiếng Việt trên bộ test nào?** Hub không có bộ test
   diarization tiếng Việt công khai (0 kết quả). Nếu phải tự dựng, đó là công
   việc chưa nằm trong phase nào của plan.
3. **Có thuê GPU để fine-tune `chunkformer-rnnt-vie-stream-dct` không?**
   Dữ kiện đã đủ để hỏi: weight vi hiện có đạt 2,49 % VIVOS (mốc nền 5,38 %),
   công thức streaming đã chạy thật trên LibriSpeech, 5000 h dữ liệu vi công
   khai, ONNX streaming runtime đã có. Thiếu đúng một lần huấn luyện.
   **Đây là quyết định của người dùng, không phải của tôi** — tôi chỉ đặt con số
   lên bàn theo bước 5 của Phase 1.
4. **Phase 2 lái Moonshine qua SDK `moonshine-voice` hay tự chạy graph `.ort`?**
   Qua SDK thì G5 đã chứng minh sạch nhưng harness bị buộc vào API của SDK; tự
   lái graph thì linh hoạt hơn nhưng khả năng nạp `.ort` bằng ORT 1.27.0 trần
   chưa ai kiểm.
5. **`Fun-ASR-Nano-2512` có thật sự làm diarization streaming không?** Nó là repo
   duy nhất mang đủ ba thẻ `vi`+`streaming`+`speaker-diarization`. Thuộc nhánh
   `inv-funasr`; tôi dừng ở mức chuyển tiếp để không lặp việc.
