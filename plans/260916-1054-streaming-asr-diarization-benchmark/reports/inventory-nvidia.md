---
title: Inventory nhánh NVIDIA / NeMo — streaming ASR + diarization
phase: 1
branch-of-survey: NVIDIA / NeMo
date: 2026-09-16
agent: inv-nvidia
status: done
weights-downloaded: none
---

# Inventory — nhánh NVIDIA / NeMo

Khảo sát metadata, model card, release page và mã nguồn upstream. **Không tải
weight nào.** Mọi ô có nguồn; `[V]` = đã mở trang và đọc, `[I]` = suy luận, ghi rõ
cơ sở suy luận.

## 0. Kết luận một dòng

Trong toàn bộ hệ sinh thái NVIDIA chỉ còn **một** ứng viên qua cả 8 cổng:
**`nvidia/nemotron-3.5-asr-streaming-0.6b`**, dùng qua gói int8 ONNX do sherpa-onnx
export. Không ứng viên diarization nào của NVIDIA qua cổng — cả họ Sortformer lẫn
Multitalker Parakeet đều chết ở G1 (không có tiếng Việt) và G3/G5 (chỉ NeMo/PyTorch,
GPU). **Nhánh NVIDIA không đề xuất được model joint "who spoke what".**

---

## 1. Bảng gate tổng hợp

| Model                                               | G1 vi    | G2 stream | G3 CPU   | G4 license | G5 runtime | G6 size  | G7 diar-stream | G8 spk unknown | Phán quyết                    |
| --------------------------------------------------- | -------- | --------- | -------- | ---------- | ---------- | -------- | -------------- | -------------- | ----------------------------- |
| `nemotron-3.5-asr-streaming-0.6b` (int8, sherpa)    | PASS     | PASS      | PASS     | PASS       | PASS       | PASS     | n/a            | n/a            | **SỐNG SÓT**                  |
| `nemotron-3.5-asr-streaming-0.6b` (fp32, sherpa)    | PASS     | PASS      | PASS     | PASS       | PASS       | **FAIL** | n/a            | n/a            | loại — G6                     |
| `nemotron-speech-streaming-en-0.6b`                 | **FAIL** | PASS      | PASS     | PASS       | PASS       | PASS     | n/a            | n/a            | loại — G1                     |
| `parakeet-ctc-0.6b-Vietnamese`                      | PASS     | **FAIL**  | **FAIL** | PASS       | **FAIL**   | ?        | n/a            | n/a            | loại — G2, G3, G5             |
| `parakeet-tdt-0.6b-v3`                              | **FAIL** | **FAIL**  | PASS     | PASS       | PASS       | PASS     | n/a            | n/a            | loại — G1, G2                 |
| `parakeet-tdt-0.6b-v2`                              | **FAIL** | **FAIL**  | PASS     | PASS       | PASS       | PASS     | n/a            | n/a            | loại — G1, G2                 |
| `parakeet-unified-en-0.6b` (streaming)              | **FAIL** | PASS      | PASS     | PASS       | PASS       | PASS     | n/a            | n/a            | loại — G1                     |
| `canary-1b-v2`                                      | **FAIL** | **FAIL**  | ?        | PASS       | ?          | ?        | n/a            | n/a            | loại — G1, G2                 |
| `stt_en_fastconformer_hybrid_large_streaming_multi` | **FAIL** | PASS      | **FAIL** | PASS       | **FAIL**   | PASS     | n/a            | n/a            | loại — G1, G3, G5             |
| `stt_ka_fastconformer_..._streaming_80ms_pc`        | **FAIL** | PASS      | **FAIL** | PASS       | **FAIL**   | PASS     | n/a            | n/a            | loại — G1                     |
| `diar_sortformer_4spk-v1`                           | **FAIL** | —         | **FAIL** | PASS       | **FAIL**   | PASS     | **FAIL**       | PASS           | loại — G1, G3, G5, G7         |
| `diar_streaming_sortformer_4spk-v2`                 | **FAIL** | PASS      | **FAIL** | PASS       | **FAIL**   | PASS     | PASS           | PASS           | loại — G1, G3, G5             |
| `diar_streaming_sortformer_4spk-v2.1`               | **FAIL** | PASS      | **FAIL** | PASS       | **FAIL**   | PASS     | PASS           | PASS           | loại — G1, G3, G5             |
| `multitalker-parakeet-streaming-0.6b-v1`            | **FAIL** | PASS      | **FAIL** | PASS       | **FAIL**   | **FAIL** | PASS           | PASS           | loại — G1, G3, G5, G6         |
| `Nemotron-3-Diarization-preview`                    | **FAIL** | ?         | **FAIL** | **FAIL**   | **FAIL**   | ?        | ?              | ?              | loại — G4 (eval-only), G1, G3 |

---

## 2. Ứng viên sống sót — `nvidia/nemotron-3.5-asr-streaming-0.6b`

### 2.1 Thông số

| Mục                          | Giá trị                                                                                                                                                                                                                          | Nguồn                                                                   | V/I |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --- |
| Tham số                      | 600M                                                                                                                                                                                                                             | model card §Model Overview, HF `nvidia/nemotron-3.5-asr-streaming-0.6b` | [V] |
| Kiến trúc                    | Cache-aware FastConformer encoder (24 layer, `hidden_size` 1024, 8 head, `conv_kernel_size` 9, `subsampling_factor` 8, 128 mel) + RNNT decoder 2 layer (`decoder_hidden_size` 640), vocab 13088, 128 prompt slot cho language-ID | `config.json` raw trên HF                                               | [V] |
| Ngôn ngữ khai báo            | 35 mã trong YAML frontmatter, **có `vi`**; model card xếp Vietnamese (vi-VN) vào tier _Transcription-ready (19 locales)_                                                                                                         | `README.md` raw, dòng 1–40 và dòng 270                                  | [V] |
| License                      | **OpenMDW-1.1**, `license_link: https://openmdw.ai/license/1-1/`                                                                                                                                                                 | YAML frontmatter `license_name: openmdw-1.1`                            | [V] |
| Chunk size hỗ trợ            | 80 / 160 / 320 / 560 / 1120 ms, đổi được lúc inference, `att_context_size = [56, {0,1,3,6,13}]` (đơn vị frame 80ms)                                                                                                              | model card dòng 236 và 423                                              | [V] |
| Punctuation + Capitalization | **có native**, không cần post-process                                                                                                                                                                                            | model card dòng 254, 584                                                | [V] |
| Language-ID tự động          | `target_lang=auto` → model tự phát hiện và gắn tag `<xx-XX>` sau dấu câu cuối                                                                                                                                                    | model card dòng 279                                                     | [V] |
| Diarization                  | **không có.** Model card không nhắc speaker/diarization ở bất kỳ đâu                                                                                                                                                             | grep `diariz\|speaker` trên README raw → 0 hit                          | [V] |

### 2.2 WER công bố — **bộ test FLEURS**, không phải VIVOS

Model card chỉ đo trên **FLEURS**, có normalization (casing, punctuation, numerals).
Con số này **không so trực tiếp được** với 5,38% VIVOS-50 của incumbent.

`WER (%) — FLEURS test, chế độ Language Input (LangID)`

| Locale                 | 80ms  | 160ms | 320ms | 560ms | 1120ms    |
| ---------------------- | ----- | ----- | ----- | ----- | --------- |
| **Vietnamese (vi-VN)** | 13,41 | 12,87 | 12,29 | 11,78 | **11,18** |
| English (en-US, en-GB) | 9,43  | 8,88  | 8,27  | 7,99  | **7,91**  |

`WER (%) — FLEURS test, chế độ Auto-detect`

| Locale                 | 80ms  | 160ms | 320ms | 560ms | 1120ms    |
| ---------------------- | ----- | ----- | ----- | ----- | --------- |
| **Vietnamese (vi-VN)** | 13,59 | 13,02 | 12,40 | 12,02 | **11,22** |

Nguồn: README raw dòng 691 (hàng vi) và bảng _Transcription-ready (19 locales)_. [V]

Hai điểm phải ghi vào luận văn:

1. **Tiếng Việt là locale tệ thứ ba trong tier "Transcription-ready"**, chỉ hơn
   Turkish và Arabic. Spanish 4,11%, Italian 4,25% — tức 11,18% không phải trần
   của model, mà là trần của phần dữ liệu tiếng Việt trong Granary.
2. **Tiếng Anh 7,91% trên FLEURS** là con số đáng lo cho ý tưởng "một model cho cả
   hai ngôn ngữ". Incumbent Moonshine base đạt 3,86% trên bộ test của dự án. Hai
   bộ test khác nhau nên chưa kết luận được, nhưng khoảng cách đủ lớn để Phase 3
   **bắt buộc** phải chạy arm tiếng Anh, không được giả định.

Cảnh báo của chính model card, phải trích nguyên văn khi dùng số: _"Normalization is
not perfect across all 40 language-locales, and residual mismatches between
normalized text can inflate the reported error rates."_ (README dòng 669) [V]

### 2.3 Đường chạy CPU — gói int8 ONNX của sherpa-onnx

Model card HF **không** có export ONNX. File trên repo HF chỉ có `.nemo` (2,37 GB),
`model.safetensors` (2,55 GB), và `.q8_0.gguf` (742 MB — GGUF là llama.cpp-family,
không nạp được bằng onnxruntime). [V] qua HF tree API.

Đường sống nằm ở sherpa-onnx, **đã xác minh đến cấp commit**:

| Bằng chứng                                                                                                                                                                                                              | Nguồn                                                      | V/I |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --- |
| PR _"Add multilingual Nemotron-3.5 streaming ASR support"_ merge `2026-06-12T06:52:47Z`, sha `b74c4df`                                                                                                                  | `gh api repos/k2-fsa/sherpa-onnx/pulls/3671`               | [V] |
| PR này nằm trong **CHANGELOG mục `## 1.13.3`**                                                                                                                                                                          | `CHANGELOG.md` trên tag `v1.13.4`                          | [V] |
| `v1.13.3` publish `2026-06-15`, `v1.13.4` publish `2026-07-07` → **bản ghim 1.13.4 chắc chắn có**                                                                                                                       | `gh api .../releases`                                      | [V] |
| `v1.13.4` cũng là bản _"Update onnxruntime to 1.27.0 (#3718)"_ → **khớp đúng pin của dự án**                                                                                                                            | `CHANGELOG.md` v1.13.4                                     | [V] |
| Test `test_nemotron_multilingual_streaming` tồn tại trong `sherpa-onnx/python/tests/test_online_recognizer.py` **trên tag v1.13.4**, dùng đúng tên gói `...-560ms-int8-2026-06-11`                                      | raw.githubusercontent tag `v1.13.4`                        | [V] |
| Python binding `OnlineStream` trên tag `v1.13.4` có `.def("set_option", ...)`, `has_option`, `get_option`                                                                                                               | `sherpa-onnx/python/csrc/online-stream.cc` tag `v1.13.4`   | [V] |
| **Wheel 1.13.4 đã có sẵn trong uv cache của máy này**; `strings` trên `_sherpa_onnx.cpython-311-x86_64-linux-gnu.so` trả về `set_option`, `get_option`, `has_option`, `language`, `prompt_dictionary`, `auto_prompt_id` | `/home/quanganh208/.cache/uv/archive-v0/ZaoqSGkNM0lvBXUB/` | [V] |

**API Python đúng cho harness** (từ test v1.13.4, không phải suy đoán):

```python
recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    encoder=..., decoder=..., joiner=..., tokens=...,
    num_threads=1, provider="cpu",
)
s = recognizer.create_stream()
s.set_option("language", "vi")   # bỏ qua hoặc "auto" → auto-detect
```

Không cần `model_type`, không cần cờ riêng. Language pin **theo từng stream**, đổi
được giữa chừng — hữu ích cho sản phẩm vi↔en. Nguồn: `test_online_recognizer.py`
v1.13.4 dòng 181–225 và `nodejs-addon-examples/test_asr_streaming_nemotron.js`. [V]

### 2.4 Asset và kích thước trên đĩa

Release `asr-models` của k2-fsa có **đủ 5 chunk size ở int8**, mỗi gói ~475 MB nén,
tất cả đề ngày `2026-06-11`: [V] qua `gh api .../releases/tags/asr-models`

```
sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{80,160,320,560,1120}ms-int8-2026-06-11.tar.bz2
```

Mirror HF chính thức `csukuangfj2/...` cho kích thước giải nén: [V] qua HF tree API

| Gói (560ms) | encoder                                               | decoder | joiner  | tokens  | **Tổng đĩa**  | G6       |
| ----------- | ----------------------------------------------------- | ------- | ------- | ------- | ------------- | -------- |
| **int8**    | `encoder.int8.onnx` 657,6 MB                          | 15,0 MB | 9,5 MB  | 0,13 MB | **≈ 682 MB**  | **PASS** |
| fp32        | `encoder.onnx` 42,2 MB + `encoder.data` **2454,4 MB** | 59,8 MB | 37,8 MB | 0,13 MB | **≈ 2594 MB** | **FAIL** |

Bản fp32 chiếm 2,59 GB weight trong `mem_limit: 4g`, chưa kể onnxruntime arena và
sidecar TTS chạy cạnh → loại ở G6. **Chỉ int8 vào Phase 3.**

Cả hai mirror đều có `test_wavs/vi.wav` trong gói — bằng chứng trực tiếp rằng
đường sherpa-onnx phục vụ tiếng Việt, không chỉ model gốc. [V]

**Cache mỗi stream:** `24 layer × 56 frame × 1024 dim × 4 B ≈ 5,5 MB`
(`cache_last_channel`) + `24 × 8 × 1024 × 4 B ≈ 0,8 MB` (`cache_last_time`)
≈ **6,3 MB/stream fp32**. [I] — số học từ `config.json` đã đọc; chưa đo thực tế.
Kết luận: cache không phải ràng buộc RAM, weight mới là.

### 2.5 RTF trên CPU x86 — **không có số đáng tin nào**

Model card **không công bố bất kỳ số CPU nào**. Toàn bộ phần _Throughput &
Efficiency_ đo trên **một NVIDIA H100** (240 stream @80ms, 2400 stream @1120ms so
với Parakeet RNNT 1.1B) — vô dụng cho quyết định ship của dự án. [V] README dòng
325–337.

**Cảnh báo về con số lan truyền trên mạng — XÁC NHẬN ĐÚNG NHƯ ĐÃ DẶN.**
Repo `github.com/codavidgarcia/nemotron-3.5-asr-streaming-onnx` báo, ở chunk 320ms,
môi trường _"torch 2.13 CPU + onnxruntime 1.27"_, **không nêu số thread, không nêu
CPU gì**:

| Biến thể       | RTF       | WER (self-reported) |
| -------------- | --------- | ------------------- |
| fp16 (shipped) | 0,315     | 0,0137              |
| fp32           | 0,263     | —                   |
| int8 (dynamic) | **0,148** | **0,189**           |

Chính repo đó ghi _"int8 dynamic quant measurably degrades WER"_ và để
_"int8 static quantization with calibration"_ trong roadmap. **RTF 0,148 là của một
export hỏng: WER 0,189 so với 0,0137 tức tệ gấp ~14 lần.** Không được dùng con số
này ở bất kỳ đâu trong luận văn ngoài mục cảnh báo. Đây **không phải** gói int8 của
sherpa-onnx (gói sherpa là export riêng, `scripts/nemo/nemotron-3.5-asr-streaming-0.6b/export_onnx.py`).
[V] — đã mở và đọc trang repo.

Hệ quả: **RTF của Nemotron int8 ở 4 thread trong container vẫn là ẩn số hoàn toàn.**
Đó đúng là việc của Phase 4.

### 2.6 Rủi ro đã phát hiện với ứng viên này

1. **`config.json` liệt kê `supported_num_lookahead_tokens: [3, 0, 6, 13]` — chỉ 4
   giá trị, thiếu `1` (tức 160ms)**, trong khi model card và sherpa-onnx đều phát
   hành 160ms. [V] Nếu arm 160ms cho kết quả lạ, đây là nghi phạm đầu tiên.
2. **Tiếng Việt trong training set đến từ pseudo-label**: nhãn synthetic sinh bởi
   ensemble Canary / Parakeet Multilingual 1.1B / Whisper-large-v3 / FunASR, với
   PnC sinh bởi Qwen3-32B. [V] README dòng 640. Tức chất lượng tiếng Việt kế thừa
   lỗi của các model đó, không phải từ nhãn người.
3. **OpenMDW-1.1 là license mới, ít tiền lệ.** Không cấm nghiên cứu nên qua G4,
   nhưng luận văn nên trích link gốc thay vì tóm tắt.

---

## 3. Bảng bị loại, kèm lý do trích được

### 3.1 `nvidia/parakeet-ctc-0.6b-Vietnamese` — **loại, nhưng là dữ liệu quan trọng nhất của báo cáo này**

Model tiếng Việt **duy nhất** trong toàn bộ org `nvidia` trên HF (đã kiểm bằng
`?author=nvidia&search=Vietnamese` và `&language=vi`). [V]

| Mục            | Giá trị                                                                                    | Nguồn                                          |
| -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Tên đầy đủ     | Parakeet-CTC-0.6B Unified Vietnamese–English Code-Switching                                | model card §Overview                           |
| Tham số        | 600M                                                                                       | model card                                     |
| Kiến trúc      | **Parakeet-CTC (FastConformer-CTC)**, 8x depthwise-separable conv subsampling, CTC loss    | README dòng 57                                 |
| Training       | ~2.000 giờ, 10 dataset (Common Voice, VietMed, LSVSC, FLEURS, VLSP, FOSD, ViMD…)           | README §Training Dataset                       |
| License        | NVIDIA Open Model License                                                                  | YAML `license_name: nvidia-open-model-license` |
| File phát hành | `parakeet-ctc-0.6b-vi.nemo` + KenLM 4-gram + lexicon. **Không có ONNX, không safetensors** | HF API siblings                                |
| Runtime        | NVIDIA NeMo (PyTorch)                                                                      | README dòng 85                                 |
| lastModified   | 2026-02-07                                                                                 | HF API                                         |

**WER công bố — blind testset:**

| AVG  | Gigaspeech2 | VLSP 2021 Task 2 | ViMD  | **VIVOS** |
| ---- | ----------- | ---------------- | ----- | --------- |
| 9,30 | 11,23       | 8,99             | 11,02 | **5,96**  |

**WER công bố — in-domain testset:** MCV-Vi-20 9,73 · FLEURS 5,15 · VietMed 14,52.

**Lý do loại:**

- **G2 FAIL** — CTC offline. Grep `stream\|att_context\|cache` trên README raw: 0 hit
  về streaming. Đây là FastConformer full-context, không phải cache-aware.
- **G3 FAIL** — chỉ `.nemo`. Không có export ONNX chính thức.
- **G5 FAIL** — cần NeMo 2.6+ / PyTorch trong container đang ghim sherpa-onnx.

**Vì sao phải ghi vào luận văn dù bị loại:** đây là con số **VIVOS công bố** duy nhất
tìm được từ một lab lớn: **5,96%**. Incumbent Zipformer-30M của dự án đạt **5,38%**
trên VIVOS-50 — **tốt hơn model 600M của NVIDIA** (hai subset khác nhau, không phải
so trực tiếp, nhưng cùng bộ test gốc). Điều này củng cố cảnh báo trong `plan.md`:
state of the art tiếng Việt công khai không vượt được incumbent, và incumbent còn là
model nhỏ hơn 20 lần. Nó cũng là bằng chứng gián tiếp rằng **11,18% của Nemotron trên
FLEURS-vi khó mà thành <5,38% trên VIVOS**, vì cùng NVIDIA, model offline chuyên
tiếng Việt, chỉ đạt 5,15% trên FLEURS-vi in-domain.

### 3.2 Họ Sortformer — toàn bộ loại ở G1

| Model                                 | Param | License                       | Max spk | Cần biết trước số spk? | Streaming                                                                 | Export                         | Nguồn         |
| ------------------------------------- | ----- | ----------------------------- | ------- | ---------------------- | ------------------------------------------------------------------------- | ------------------------------ | ------------- |
| `diar_sortformer_4spk-v1`             | 123M  | **CC-BY-NC-4.0**              | 4       | Không                  | **Không** — _"The model operates in a non-streaming mode (offline mode)"_ | safetensors + `.nemo`          | HF model card |
| `diar_streaming_sortformer_4spk-v2`   | 117M  | **CC-BY-4.0**                 | 4       | Không                  | Có — AOSC, 4 preset latency 0,32s / 1,04s / 10,0s / 30,4s                 | `.nemo` + **GGUF Q8_0 147 MB** | HF model card |
| `diar_streaming_sortformer_4spk-v2.1` | 117M  | **NVIDIA Open Model License** | 4       | Không                  | Có — 2 preset: 30,4s và 1,04s                                             | `.nemo`                        | HF model card |

**G8 — số người nói không biết trước: PASS.** Kiến trúc là _"two feedforward layers
with 4 sigmoid outputs for each frame input at the top layer"_ (README v2.1 dòng 316)
[V] — model xuất xác suất hoạt động cho 4 slot, không nhận tham số `num_speakers`.
Code dùng trong model card chỉ set `chunk_len`, `chunk_right_context`, `fifo_len`,
`spkcache_update_period`. **Đây là tính chất tốt và nên ghi nhận** — nếu dự án sau này
đổi được ràng buộc runtime, Sortformer streaming là kiến trúc đúng cho bài toán.

**G7 — diarization streaming:** v1 FAIL (offline), v2/v2.1 PASS.

**G1 — tiếng Việt: FAIL, đây là cổng giết cả họ.** Model card cả ba bản đều ghi
_"Performance may degrade on non-English speech"_, không locale nào được liệt kê,
không một số DER nào cho tiếng Việt. DER công bố chỉ trên DIHARD III, CALLHOME,
CH109, AMI — toàn bộ tiếng Anh.

DER v2.1 @1,04s latency: DIHARD III (1-4spk) 15,09 · CALLHOME-2spk 6,65 ·
CALLHOME-3spk 11,25 · CALLHOME-4spk 13,35 · AMI Test IHM 16,67. [V]
DER v2 @1,04s: DIHARD III 13,24 · CALLHOME-2spk 6,57 · 3spk 10,05 · 4spk 12,44. [V]

**G3/G5 — FAIL.** Cả ba chỉ chạy qua `SortformerEncLabelModel.from_pretrained(...)`
của NeMo (PyTorch). Release `speaker-segmentation-models` của sherpa-onnx **không có
Sortformer** — chỉ `sherpa-onnx-pyannote-segmentation-3-0` (6,9 MB),
`sherpa-onnx-reverb-diarization-v1` (10,9 MB), `-v2` (254 MB). [V] qua `gh api`.
GGUF Q8_0 của v2 là llama.cpp-family, không nạp được bằng onnxruntime → không cứu
được G5. Mọi số RTF công bố đo trên RTX 6000 Ada.

### 3.3 `nvidia/multitalker-parakeet-streaming-0.6b-v1` — model joint "who spoke what", loại

Đây **đúng là** thứ nhiệm vụ yêu cầu tìm: speaker-tagged ASR streaming của NeMo.
Nó ghép `diar_streaming_sortformer_4spk-v2.1` với một ASR Parakeet streaming 0,6B.

| Mục                   | Giá trị                                                                                                                   | Nguồn                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Param                 | 600M (phần ASR)                                                                                                           | model card                      |
| License               | NVIDIA Open Model License                                                                                                 | YAML frontmatter                |
| Ngôn ngữ              | **chỉ English**, badge `multilingual` bị comment-out trong README (`<!--                                                  | ![Language](...multilingual...) | -->`, dòng 197) | README raw |
| Chunk size            | 80 / 160 / 560 / 1120 ms, `att_context_size` [70,0]…[70,13]                                                               | model card                      |
| Max spk               | 4, kế thừa từ Sortformer v2.1                                                                                             | model card §Usage               |
| Cần biết trước số spk | Không                                                                                                                     | kế thừa Sortformer              |
| Export                | chỉ `.nemo`. Không ONNX, không GGUF                                                                                       | model card                      |
| Hardware              | `SortformerEncLabelModel.from_pretrained(...).eval().to(torch.device("cuda"))` — **CUDA hardcode trong ví dụ chính thức** | README dòng 282                 |

cpWER công bố: AMI IHM 21,26 · AMI SDM 37,44 · CH109 15,81 · Mixer 6 23,81.
Single-speaker mode AVG WER 7,44. [V]

**Lý do loại, trích nguyên văn (README dòng 203):**

> _"The model architecture requires deploying **one model instance per speaker**,
> meaning the number of model instances matches the number of speakers in the
> conversation. While this necessitates additional computational resources..."_

- **G1 FAIL** — English only.
- **G6 FAIL** — 4 speaker × 0,6B ASR instance đồng thời + Sortformer 117M, trong
  `mem_limit: 4g`. Không khả thi kể cả khi có int8.
- **G3/G5 FAIL** — NeMo/PyTorch/CUDA, không có đường ONNX.

Tutorial liên quan: `NVIDIA-NeMo/Speech/tutorials/asr/Streaming_Multitalker_ASR.ipynb`
(đã xác nhận file tồn tại; nội dung notebook không render qua web fetch nên chỉ ghi
làm tham chiếu, không trích số). Paper: _Streaming Sortformer_ arXiv 2507.18446.

### 3.4 Họ Parakeet / Canary — loại ở G1, hầu hết thêm G2

Kiểm bằng HF API (`cardData.language`), không qua trí nhớ: [V]

| Model                      | `language` trong cardData                                                                                            | License   | Streaming?                                      | Loại vì |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------- | ------- |
| `parakeet-tdt-0.6b-v3`     | 25 mã **châu Âu** (`en,es,fr,de,bg,hr,cs,da,nl,et,fi,el,hu,it,lv,lt,mt,pl,pt,ro,sk,sl,sv,ru,uk`) — **không có `vi`** | CC-BY-4.0 | Không (TDT offline)                             | G1, G2  |
| `parakeet-tdt-0.6b-v2`     | `['en']`                                                                                                             | CC-BY-4.0 | Không                                           | G1, G2  |
| `canary-1b-v2`             | 25 mã châu Âu, **không có `vi`**                                                                                     | CC-BY-4.0 | Không (AED offline)                             | G1, G2  |
| `parakeet-unified-en-0.6b` | en                                                                                                                   | —         | **Có** (sherpa có gói streaming 240/560/1120ms) | G1      |

Xác nhận dứt điểm cho seed-list: **"Parakeet v3 không có tiếng Việt" là ĐÚNG.**
Danh sách 25 ngôn ngữ là toàn bộ EU-24 + ru/uk, không hề mở sang châu Á.

Ghi chú: sherpa-onnx **có** đủ gói ONNX cho `parakeet-unified-en-0.6b` ở 3 chunk size
streaming (`...int8-streaming-{240,560,1120}ms`, ~501 MB nén mỗi gói) [V]. Nếu Phase 5
kết luận nên **giữ Moonshine cho en và chỉ thay vi**, thì đây là ứng viên thay thế
Moonshine — nhưng nằm ngoài phạm vi benchmark hiện tại vì nó không giải bài toán
tiếng Việt.

### 3.5 Cache-aware FastConformer — các checkpoint khác

| Model                                                                | Ngôn ngữ | Streaming                           | Export                                   | Loại vì    |
| -------------------------------------------------------------------- | -------- | ----------------------------------- | ---------------------------------------- | ---------- |
| `stt_en_fastconformer_hybrid_large_streaming_multi`                  | `['en']` | Có, multi-latency (0/80/480/1040ms) | chỉ `.nemo` (1 file duy nhất trong repo) | G1, G3, G5 |
| `stt_en_fastconformer_hybrid_medium_streaming_80ms` / `_pc`          | en       | Có                                  | `.nemo`                                  | G1         |
| `stt_ka_fastconformer_hybrid_transducer_ctc_large_streaming_80ms_pc` | Georgian | Có                                  | `.nemo`                                  | G1         |

**Không tồn tại checkpoint cache-aware FastConformer tiếng Việt nào trong org
`nvidia`.** Đã quét toàn bộ 40 model ASR của org sắp theo download, và quét riêng
`?language=vi` — chỉ ra duy nhất `parakeet-ctc-0.6b-Vietnamese` (offline) và
`nemotron-3.5-asr-streaming-0.6b`. [V]

### 3.6 `nvidia/Nemotron-3-Diarization-preview` — loại ở G4

License là **`nvidia-software-and-model-evaluation-license`**: giới hạn _"internal
test and evaluation, not in production"_, và yêu cầu chạy trên **hệ thống có GPU
NVIDIA**. Trang cần đăng nhập + chấp nhận điều khoản mới xem đầy đủ, nên các ô
param/DER/max-spk **không xác minh được** — nhưng G4 đã đủ để loại: một luận văn mô
tả hệ thống sản phẩm không dùng được license eval-only. [V] ở mức metadata trang
công khai.

---

## 4. Ước lượng chi phí screening (nhánh NVIDIA)

Công thức: `chi phí = (tổng giây audio) × RTF_ước_lượng × (số arm) × (số ngôn ngữ)`

**Đầu vào:**

- Tổng giây audio: ~350 s/ngôn ngữ (VIVOS-50, `plan.md` dòng 109–112).
- Số ngôn ngữ: 2 (vi, en).
- Số arm sống sót từ nhánh này: **1 model**, nhưng chunk size là siêu tham số →
  đề nghị 3 arm (320 / 560 / 1120 ms). Chạy cả 5 nếu rẻ.
- `RTF_ước_lượng`: **không có nguồn đáng tin.** Nguồn gần nhất là 0,263 (fp32,
  320ms) từ repo third-party ở §2.5 — CPU và số thread không nêu, nên chỉ dùng như
  bậc độ lớn, **không** đưa vào luận văn. Ước lượng dùng dải 0,3 → 1,0.

**Kết quả:**

| Kịch bản                            | RTF | Arm | Thời gian                         |
| ----------------------------------- | --- | --- | --------------------------------- |
| 3 chunk size, RTF 0,3               | 0,3 | 3   | 350 × 0,3 × 3 × 2 = **10,5 phút** |
| 5 chunk size, RTF 0,3               | 0,3 | 5   | **17,5 phút**                     |
| 5 chunk size, RTF 1,0 (bi quan)     | 1,0 | 5   | **58 phút**                       |
| 5 chunk size, RTF 3,0 (rất bi quan) | 3,0 | 5   | **2 giờ 55 phút**                 |

Arm diarization: **0 giờ** — nhánh NVIDIA không đóng góp ứng viên diarization nào.

## 5. Trigger GPU — **KHÔNG BẬT** từ nhánh này

| Điều kiện (`plan.md` dòng 114–120)                            | Đánh giá                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Một ứng viên không chạy được CPU **và** qua mọi cổng khác | **Không thoả.** Mọi model NVIDIA chỉ-GPU (Sortformer ×3, Multitalker Parakeet, FastConformer streaming en/ka, Nemotron-3-Diarization) đều **đã trượt G1 trước** — không có tiếng Việt. Không model nào "chỉ thiếu mỗi CPU". |
| (2) Tổng screening chất lượng > 8 giờ                         | **Không thoả.** Kịch bản bi quan nhất 2h55.                                                                                                                                                                                 |

Khuyến nghị cho lead: **không thuê GPU vì nhánh NVIDIA.** Nếu nhánh khác bật trigger
thì đó là lý do của nhánh đó, không phải của nhánh này.

---

## 6. Điều báo cáo này KHÔNG phủ

1. **Không đo gì.** Mọi số là số công bố. Không weight nào được tải (ràng buộc pha 1).
2. **Không kiểm tra chất lượng thực của gói int8 sherpa-onnx.** Biết int8 dynamic
   quant _có thể_ phá WER (§2.5 là bằng chứng sống). Gói của k2-fsa là export khác,
   nhưng **chưa ai công bố WER của nó**. Phase 3 phải chạy **cả** int8 **và**
   kiểm chéo ít nhất một mẫu với fp32 để phát hiện divergence, dù fp32 trượt G6 cho
   sản phẩm — trượt G6 là chuyện triển khai, không cản việc dùng nó làm mốc đối chứng
   chất lượng trên máy dev.
3. **Không đọc được nội dung notebook `Streaming_Multitalker_ASR.ipynb`** (GitHub trả
   trang landing, không render JSON notebook). Ảnh hưởng: nhỏ — model card của
   multitalker-parakeet đã đủ để loại ở G1.
4. **Không xác minh được chi tiết `Nemotron-3-Diarization-preview`** (gated). Ảnh
   hưởng: nhỏ — đã loại ở G4.
5. **Không đánh giá nhánh ngoài NVIDIA** (FunASR, WeNet, pyannote/diart, Whisper-
   streaming) — thuộc các agent khác.

---

## 7. Câu hỏi chưa giải quyết

1. **Gói int8 của k2-fsa có giữ được WER không?** Không nguồn nào công bố. Đây là
   rủi ro lớn nhất của ứng viên duy nhất sống sót — và là rủi ro có tiền lệ
   (§2.5: một export int8 khác của đúng model này bị hỏng ở WER 0,189). Phase 3
   phải trả lời trước khi tiêu giờ máy cho Phase 4.
2. **Tiếng Anh có bị hồi quy không?** Nemotron FLEURS-en 7,91% so với Moonshine
   3,86% trên bộ test dự án. Nếu Phase 3 xác nhận hồi quy lớn, câu hỏi thành: giữ
   Moonshine cho en (mất DRY, +418 MB) hay chấp nhận? Đây là **quyết định của người
   dùng**, không phải của benchmark.
3. **Không có diarization NVIDIA nào dùng được — tầng speaker giải quyết thế nào?**
   Nhánh này không trả lời được. Sortformer streaming là kiến trúc đúng (G7, G8 đều
   PASS, latency 0,32s, không cần biết trước số người nói) nhưng chết ở G1 + G5. Ba
   đường còn lại, cần lead quyết: (a) chờ nhánh khác tìm ra ứng viên; (b) chấp nhận
   Sortformer chưa từng thấy tiếng Việt và đo DER thực tế xem có dùng được không —
   nhưng vẫn phải giải G5/G3 trước; (c) giữ tầng speaker hiện tại và benchmark này
   chỉ thay STT.
4. **Arm 160ms có hợp lệ không?** `config.json` không liệt kê `lookahead=1` trong
   `supported_num_lookahead_tokens` dù model card và sherpa-onnx đều phát hành 160ms
   (§2.6). Cần một smoke test trước khi tính arm này vào kết quả.
