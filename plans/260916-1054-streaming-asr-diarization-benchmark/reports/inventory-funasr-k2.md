# Inventory — hệ sinh thái FunASR / WeNet / k2-icefall / 3D-Speaker

**Nhánh:** ASR châu Á (Alibaba FunASR, WeNet, k2-fsa/icefall/sherpa, 3D-Speaker) + cộng đồng ASR Việt Nam
**Ngày khảo sát:** 2026-09-16 · **Người khảo sát:** inv-funasr
**Ràng buộc đã áp:** G1–G8 theo `phase-01-inventory-and-gate.md`, không tải weight

---

## Kết luận đầu

**Nhánh này không còn ứng viên nào sống sót qua G1–G8.** Toàn bộ 21 ứng viên đã kiểm
đều trượt ít nhất một cổng cứng, và lý do trượt tập trung vào đúng hai chỗ:

1. **Streaming ASR tiếng Việt không tồn tại trong hệ sinh thái này.** Mọi model streaming
   của FunASR/WeNet/k2 đều là zh, zh-en, zh-yue-en, en, hoặc ru. Không có checkpoint nào.
2. **Model có tiếng Việt và có streaming thì không chạy được CPU.** Ba model
   (Fun-ASR-MLT-Nano, Qwen3-ASR, UniASR-vi) qua được G1+G2 nhưng chết ở G3/G5: hai
   cái đầu chỉ streaming qua vLLM/GPU, cái thứ ba không có bất kỳ đường export nào.

Ứng viên gần nhất là **UniASR Vietnamese** — qua G1, G2, G4, G6, G7/G8 không áp dụng,
trượt duy nhất G3 (không có ONNX export) và G5. Chi tiết ở mục "Near-miss" bên dưới, vì
đây là chỗ duy nhất trong nhánh này có thể mở lại bằng công sức kỹ thuật thay vì chờ
upstream phát hành model mới.

Một phát hiện kiến trúc quan trọng, không phụ thuộc vào model nào: **sherpa-onnx không
hề có API streaming diarization.** Chi tiết ở mục cuối.

---

## Bảng ứng viên sống sót

Trống. Không có dòng nào.

---

## Bảng bị loại

Ký hiệu: **V** = VERIFIED (đã mở trang / đọc source), **I** = INFERRED (suy ra từ bằng chứng gián tiếp).

### A. Hệ sherpa-onnx / k2-fsa (runtime dự án đang chạy)

| #   | Ứng viên                                                                | G1 vi | G2 stream | Trượt     | Lý do trích được                                                                                                                                                                                                                                                                                       | Nguồn                                                                                                               | V/I |
| --- | ----------------------------------------------------------------------- | ----- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --- |
| A1  | sherpa-onnx **online-transducer** (zipformer / conformer / LSTM)        | ✗     | ✓         | **G1**    | Ngôn ngữ liệt kê trên trang: Bengali, Chinese, Korean, English, French, zh-en bilingual. Không có vi. Xác minh lại theo yêu cầu — vẫn không có gì mới so với phiên trước.                                                                                                                              | [online-transducer/index.html](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html) | V   |
| A2  | sherpa-onnx **online-ctc** (trang phiên trước chưa soi)                 | ✗     | ✓         | **G1**    | Toàn bộ danh sách: 5 model zipformer-CTC **zh** + `sherpa-onnx-streaming-t-one-russian-2025-09-08` (**ru**). Hết.                                                                                                                                                                                      | [online-ctc/index.html](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/index.html)               | V   |
| A3  | sherpa-onnx **online-paraformer** (trang phiên trước chưa soi)          | ✗     | ✓         | **G1**    | Đúng 2 model: `streaming-paraformer-bilingual-zh-en` và `streaming-paraformer-trilingual-zh-cantonese-en`.                                                                                                                                                                                             | [online-paraformer/index.html](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/index.html) | V   |
| A4  | Release `asr-models` — **toàn bộ 499 asset, đã phân trang hết 5 trang** | ✗     | —         | **G1+G2** | Grep `viet\|-vi-` trên toàn bộ 499 tên file cho đúng 6 kết quả: `sherpa-onnx-zipformer-vi-2025-04-20`, `-vi-int8-2025-04-20`, `-vi-30M-2026-02-09`, `-vi-30M-int8-2026-02-09`, `sherpa-onnx-moonshine-base-vi-quantized-2026-02-27`, `vi.wav`. **Tất cả đều offline.** Không một gói vi streaming nào. | `GET /repos/k2-fsa/sherpa-onnx/releases/130628817/assets?per_page=100&page=1..5`                                    | V   |
| A5  | **icefall** — recipe streaming zipformer tiếng Việt                     | ✗     | —         | **G1**    | `egs/` có 42 recipe: aidatatang_200zh … yesno. **Không có recipe vietnamese/vivos/vlsp nào.** Model `zipformer-vi-30M` không sinh ra từ egs công khai.                                                                                                                                                 | `GET /repos/k2-fsa/icefall/contents/egs`                                                                            | V   |
| A6  | HF org **k2-fsa** (25 repo) + **csukuangfj** (767 repo)                 | ✗     | —         | **G1**    | Lọc `-vi-\|viet` trên toàn bộ 792 repo: chỉ `viet_iter3_pseudo_label` (đã đóng), `sherpa-onnx-zipformer-vi-2025-04-20`, `-vi-int8-2025-04-20`. Không có bản streaming.                                                                                                                                 | `GET huggingface.co/api/models?author=…&limit=1000`                                                                 | V   |

**Hệ quả:** lợi thế "sherpa hỗ trợ sẵn nên tích hợp gần bằng 0" **không dùng được cho
nhánh này**. Không có model vi streaming nào để hưởng lợi thế đó.

### B. FunASR ASR

| #   | Ứng viên                                                                               | Params      | G1 vi | G2 stream | Trượt                                         | Lý do trích được                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Nguồn                                                                                                                                                                                                   | V/I |
| --- | -------------------------------------------------------------------------------------- | ----------- | ----- | --------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| B1  | **Paraformer-online**                                                                  | 68M         | ✗     | ✓         | **G1**                                        | Cột Language trong model zoo: `CN & EN`. 50.000h Alibaba Speech Data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [modelscope_models.md L36](https://github.com/modelscope/FunASR/blob/main/model_zoo/modelscope_models.md)                                                                                               | V   |
| B2  | **Paraformer-large-online**                                                            | 220M        | ✗     | ✓         | **G1**                                        | Cột Language: `CN & EN`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | modelscope_models.md L37                                                                                                                                                                                | V   |
| B3  | **`funasr/paraformer-zh-streaming`**                                                   | 220M        | ✗     | ✓         | **G1**                                        | Model zoo ghi rõ `zh/en`, Streaming. Đây là bản HF của B2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [README model zoo](https://github.com/modelscope/FunASR)                                                                                                                                                | V   |
| B4  | **SenseVoiceSmall**                                                                    | 234M        | ✗     | ✗         | **G1 + G2**                                   | G1: "The released SenseVoiceSmall checkpoint **supports Mandarin, Cantonese, English, Japanese, and Korean**" — con số ">50 languages" là phạm vi nghiên cứu, không phải checkpoint đã phát hành. Không có vi. G2: kiến trúc non-autoregressive offline; bản streaming duy nhất là third-party `streaming-sensevoice`, README gọi thẳng là "**To achieve pseudo-streaming, it employs a truncated attention mechanism, sacrificing some accuracy**" — đúng loại pseudo-streaming repo đang chạy.                                                                                                                   | [SenseVoice README L39, L488](https://github.com/FunAudioLLM/SenseVoice)                                                                                                                                | V   |
| B5  | **Fun-ASR-Nano-2512**                                                                  | 800M        | ✗     | vLLM      | **G1**                                        | "Fun-ASR-Nano supports Chinese, English, Japanese, and Chinese dialects and accents."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [Fun-ASR README L93](https://github.com/QwenAudio/Fun-ASR)                                                                                                                                              | V   |
| B6  | **Fun-ASR-MLT-Nano-2512**                                                              | 800M        | ✓     | ⚠         | **G3 + G5 + G6**                              | G1 **qua**: 31 ngôn ngữ, có "Vietnamese" trong danh sách (README L35). G2 mập mờ: streaming SDK là `FunASRNanoStreamingVLLM` (`inference_vllm_streaming`) — **chỉ chạy trên vLLM**. G3 **trượt**: GGUF chỉ có cho Nano (`download-funasr-model.sh nano`; HF org có `Fun-ASR-Nano-GGUF`, **không có** `Fun-ASR-MLT-Nano-GGUF`), không có ONNX. G5 trượt: vLLM không cài cạnh sherpa-onnx CPU-only. G6 trượt: `model.pt` = **1971 MB fp32**, cộng runtime vượt `mem_limit: 4g`. **Không có số WER per-language nào:** card ghi "MLT per-language results will be added when a reproducible evaluation is published." | [README L35/L43/L119/L338](https://github.com/QwenAudio/Fun-ASR), [HF card](https://huggingface.co/FunAudioLLM/Fun-ASR-MLT-Nano-2512), `GET hf/api/models/FunAudioLLM/Fun-ASR-MLT-Nano-2512?blobs=true` | V   |
| B7  | **Qwen3-ASR 0.6B / 1.7B** (Alibaba)                                                    | 0.6B / 1.7B | ✓     | ⚠         | **G3 + G5**                                   | G1 qua: danh sách 30 ngôn ngữ có `Vietnamese (vi)` (README L82), cột chế độ ghi `Offline / Streaming`. G2/G3/G5 trượt cùng một câu: "**Currently, streaming inference is only available with the vLLM backend**" (L291). Không có ONNX/GGUF/CT2 trong README. Yêu cầu RAM tham chiếu: "If your machine has less than 96GB of RAM…" (L140). License Apache-2.0.                                                                                                                                                                                                                                                     | [Qwen3-ASR README L82, L291, L140](https://github.com/QwenLM/Qwen3-ASR)                                                                                                                                 | V   |
| B8  | **GLM-ASR-Nano-2512** (Z.ai)                                                           | 1.5B        | ✗     | ✗         | **G1 + G3**                                   | Model card nhấn Mandarin/English/Cantonese + dialects; **không liệt kê Vietnamese**. Chỉ safetensors + transformers/vLLM, không ONNX/GGUF. License MIT.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [HF card](https://huggingface.co/zai-org/GLM-ASR-Nano-2512)                                                                                                                                             | V   |
| B9  | **UniASR Vietnamese**                                                                  | 95M         | ✓     | ✓         | **G3 + G5**                                   | Xem mục Near-miss.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | dưới                                                                                                                                                                                                    | V   |
| B10 | UniASR các ngôn ngữ khác (en, ru, ja, ko, yue, id, es, pt, fr, de, fa, my, he, ur, tr) | 95M         | ✗     | ✓         | **G1**                                        | Chỉ có đúng một dòng VI trong bảng UniASR; các dòng còn lại không phải tiếng Việt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | modelscope_models.md L46–63                                                                                                                                                                             | V   |
| B11 | **Fun-ASR-ML** (bản multilingual streaming cũ, zh/en/vi/th/id)                         | ?           | ✓     | ?         | **G4 (không nêu license vì không phát hành)** | Chỉ xuất hiện trong mô tả marketing. HF org `FunAudioLLM` liệt kê 21 repo — **không có repo nào tên Fun-ASR-ML**. Không có open weights để kiểm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `GET hf/api/models?author=FunAudioLLM&limit=100`                                                                                                                                                        | V   |

### C. WeNet

| #   | Ứng viên                                            | G1 vi | Trượt  | Lý do trích được                                                                                                                                                                                                                                                                                               | Nguồn                                                                                               | V/I |
| --- | --------------------------------------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --- |
| C1  | WeNet pretrained models (checkpoint + runtime .zip) | ✗     | **G1** | Bảng Model List đầy đủ: aishell (CN), aishell2 (CN), gigaspeech (EN), librispeech (EN), multi_cn (CN), wenetspeech (CN), paraformer (CN&EN), firered (CN&EN), whisper-large-v3 (multi-lingual). **Không có dòng Vietnamese.**                                                                                  | [docs/pretrained_models.md](https://github.com/wenet-e2e/wenet/blob/main/docs/pretrained_models.md) | V   |
| C2  | WeNet recipe cộng đồng tiếng Việt                   | ✗     | **G1** | `examples/` có 17 recipe: aishell, aishell2, aishell4, chime4, commonvoice, csj, gigaspeech, hkust, librispeech, multi_cn, openasr2021, swbd, tedlium3, timit, vkw2021, wenetspeech, wsj. **Không có recipe tiếng Việt.** (`vkw2021` là Vietnamese **keyword** spotting challenge, không phải ASR checkpoint.) | `GET /repos/wenet-e2e/wenet/contents/examples`                                                      | V   |

Ghi chú license WeNet, phòng khi sau này có checkpoint vi: "The pretrained model in WeNet
follows the license of it's corresponding dataset" — tức license phụ thuộc dataset, phải
kiểm từng model một, không có license thống nhất.

### D. Diarization (G7 / G8)

| #   | Ứng viên                                                                           | Max spk                     | Biết trước số spk?                                              | Streaming? | Trượt       | Lý do trích được                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Nguồn                                                                                                                                         | V/I |
| --- | ---------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| D1  | **FunASR `speech_campplus_speaker-diarization_common`** (cam++ cluster)            | không giới hạn cứng         | **Không cần** — "có thể tự động nhận diện số người trong audio" | ✗          | **G7**      | `ModelType: ["CAM++-cluster"]`; mô tả: "基于**分段-聚类**（segmentation-clustering）模块化的通用说话人日志框架, 可以自动的识别音频中的对话人数". Clustering chỉ chạy sau khi có toàn bộ segment → offline. License **Apache-2.0**. Cập nhật lần cuối 2024-12-23.                                                                                                                                                                                                                                                                                  | `GET modelscope.cn/api/v1/models/damo/speech_campplus_speaker-diarization_common`                                                             | V   |
| D2  | **FunASR SOND** (zh-alimeeting / en-callhome)                                      | n16k4                       | **Có, cần speaker profile**                                     | ✗          | **G7 + G8** | Model zoo mục "Speaker Diarization": ghi chú "Speaker diarization, **profiles and records**". SOND là kiến trúc so khớp với profile người nói cho trước. 40.5M (zh) / 12M (en).                                                                                                                                                                                                                                                                                                                                                                   | modelscope_models.md L110–115                                                                                                                 | V   |
| D3  | **FunASR EEND-OLA**                                                                | tự sinh qua attractor       | Không                                                           | ✗          | **G7**      | Source là `funasr/models/eend/e2e_diar_eend_ola.py` + `encoder_decoder_attractor.py`. Encoder-Decoder Attractor chạy trên toàn bộ chuỗi embedding của cả bản ghi → không streaming. Ngoài ra thư mục không có file `model.py` với `export`.                                                                                                                                                                                                                                                                                                       | `GET /repos/modelscope/FunASR/contents/funasr/models/eend`                                                                                    | V   |
| D4  | **FunASR Paraformer-large-Spk**                                                    | —                           | Không                                                           | ✗          | **G1 + G7** | Cột Language `CN & EN`; cột Offline/Online ghi `Offline`; ghi chú "Supporting speaker diarizatioin for ASR results based on paraformer-large-**long**".                                                                                                                                                                                                                                                                                                                                                                                           | modelscope_models.md L30                                                                                                                      | V   |
| D5  | **3D-Speaker speaker-diarization** (toolkit đang cấp campplus embedding cho dự án) | tự ước lượng qua clustering | Không                                                           | ✗          | **G7**      | README recipe: "comprises multiple modules, including overlap detection[optional], **voice activity detection, speech segmentation, speaker embedding extraction, and speaker clustering**" — pipeline offline hoàn chỉnh. **Không một chữ "online"/"streaming" nào** trong README recipe hay README repo. License Apache-2.0. **RTF = 0.03 trên CPU** (w/ overlap-detection; README không nêu số thread / loại CPU / fp32-int8 → điều kiện đo **không xác định**, không dùng để so). DER: VoxConverse 11.75%, AMI_SDM 21.76%, Alimeeting 19.73%. | [egs/3dspeaker/speaker-diarization/README.md](https://github.com/modelscope/3D-Speaker/blob/main/egs/3dspeaker/speaker-diarization/README.md) | V   |
| D6  | **MOSS-Transcribe-Diarize** (third-party trong FunASR)                             | —                           | —                                                               | ✗          | **G7**      | Model zoo: "**One offline request** returns transcription, timestamps, and speaker labels". Apache-2.0.                                                                                                                                                                                                                                                                                                                                                                                                                                           | modelscope_models.md L121                                                                                                                     | V   |

### E. Cộng đồng ASR Việt Nam

| #   | Ứng viên                                                    | G1 vi | G2 stream          | Trượt       | Lý do                                                                                                                                                                                                                                                                                                 | Nguồn                                                                                                                                                                                 | V/I                                                                                |
| --- | ----------------------------------------------------------- | ----- | ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| E1  | **VinAI PhoWhisper** (tiny→large, + bản CT2/ONNX cộng đồng) | ✓     | ✗                  | **G2**      | Whisper encoder-decoder non-causal. Có CT2 (`thoaibuiic/PhoWhisper-large-ct2`, 6.284 dl) và ONNX (`onnx-community/PhoWhisper-base-ONNX`) nên qua G3, nhưng streaming chỉ đạt được bằng cửa sổ trượt — **đúng loại pseudo-streaming stack hiện tại đang chạy**, không thay được gì.                    | `GET hf/api/models?search=phowhisper`                                                                                                                                                 | V                                                                                  |
| E2  | **PhoASR** (Qualcomm AI Research, Findings of EACL 2026)    | ✓     | ✗                  | **G2**      | Checkpoint phát hành là `PhoASR-whisper-small` fine-tune trên 3.000h — vẫn là Whisper, non-causal.                                                                                                                                                                                                    | [aclanthology.org/2026.findings-eacl.345](https://aclanthology.org/2026.findings-eacl.345/), [github.com/qualcomm-ai-research/PhoASR](https://github.com/qualcomm-ai-research/PhoASR) | I — đọc abstract + mô tả repo, chưa mở model card checkpoint                       |
| E3  | **Viettel / Zalo / FPT.AI / VietAI** streaming ASR          | ✓     | ✓ (API)            | **G4 + G5** | Đều là **API thương mại đóng**, không phát hành weight. Không có model card, không có license cho phép chạy local → G4 ("không nêu license" cho weight vì không có weight) và G5 (không có runtime local). Tìm HF theo `author` và theo search không ra repo weight streaming nào của các đơn vị này. | Tìm kiếm web 2026-09-16 + `hf/api/models?search=…`                                                                                                                                    | I — kết luận từ việc **không tìm thấy**, không phải từ một câu phủ định trích được |
| E4  | **VietASR** (arXiv 2505.21527)                              | ✓     | paper ✓ / weight ✗ | **Đã đóng** | Theo chỉ thị: chỉ phát hành `zzasdf/viet_iter3_pseudo_label` non-causal. Không mở lại. Có xác nhận gián tiếp: HF org `csukuangfj` mirror đúng repo này và không có bản causal.                                                                                                                        | chỉ thị + `hf/api/models?author=csukuangfj`                                                                                                                                           | V                                                                                  |

---

## Near-miss: UniASR Vietnamese — chỗ duy nhất đáng bàn tiếp

`damo/speech_UniASR_asr_2pass-vi-16k-common-vocab1001-pytorch-online`

| Thuộc tính        | Giá trị                                                                                                                                                                                                           | Nguồn                                                                                   | V/I |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --- |
| Tên tiếng Trung   | "UniASR语音识别-越南语-通用-16k-**实时**" (thời gian thực)                                                                                                                                                        | ModelScope API                                                                          | V   |
| Params            | 95M                                                                                                                                                                                                               | modelscope_models.md L54                                                                | V   |
| Kích thước weight | `model.pt` = **384.996.682 B ≈ 367 MiB** (fp32) + `seg_dict` 13,1 MiB                                                                                                                                             | `GET modelscope.cn/api/v1/models/…/repo/files`                                          | V   |
| Vocab             | 1001                                                                                                                                                                                                              | modelscope_models.md L54                                                                | V   |
| Training data     | Alibaba Speech Data, **1.000h** tiếng Việt                                                                                                                                                                        | modelscope_models.md L54                                                                | V   |
| Chế độ            | **Online**, two-pass (`ModelType: ["Two pass model"]`), dynamic latency training                                                                                                                                  | ModelScope API + [FunASR Wiki UniASR](https://github.com/modelscope/FunASR/wiki/UniASR) | V   |
| Backbone          | transformer/conformer                                                                                                                                                                                             | ModelScope API `Backbone`                                                               | V   |
| License           | **Apache License 2.0**                                                                                                                                                                                            | ModelScope API `License`                                                                | V   |
| Framework         | **pytorch only** (`Frameworks: ["pytorch"]`)                                                                                                                                                                      | ModelScope API                                                                          | V   |
| Downloads         | 11.424                                                                                                                                                                                                            | ModelScope API                                                                          | V   |
| Cập nhật lần cuối | timestamp 1706101356 = **2024-01-24**                                                                                                                                                                             | ModelScope API                                                                          | V   |
| Code còn sống?    | **Còn.** `funasr/models/uniasr/` tồn tại trong `main` hôm nay: `model.py` (1143 dòng), `beam_search.py`, `template.yaml`                                                                                          | `GET /repos/modelscope/FunASR/contents/funasr/models/uniasr`                            | V   |
| **WER công bố**   | **KHÔNG CÓ.** `Metrics: ["CER"]` nhưng trường `Datasets` của card ghi `train/test = "50,000 hour industrial Mandarin task"` — rõ ràng là template copy nhầm từ card tiếng Trung. Không một con số tiếng Việt nào. | ModelScope API `Datasets`, `Metrics`                                                    | V   |
| Chunk size        | Không nêu trên card; UniASR dùng dynamic latency training nên chunk cấu hình được, nhưng **không có con số công bố**                                                                                              | Wiki UniASR                                                                             | V   |

**Vì sao trượt:**

- **G3 (quyết định).** `funasr/models/uniasr/model.py` có **0 lần xuất hiện chuỗi `export`**
  (`grep -c export` = 0). Cơ chế export của FunASR là `export_utils.export()` gọi
  `model.export(**kwargs)` — một method **từng model tự khai**. So sánh:
  `funasr/models/paraformer_streaming/model.py` **có** `def export` ở dòng 765; UniASR
  **không có**. Không ONNX, không torchscript, không GGML, không CT2.
  Nguồn: [export_utils.py](https://github.com/modelscope/FunASR/blob/main/funasr/utils/export_utils.py), [uniasr/model.py](https://github.com/modelscope/FunASR/blob/main/funasr/models/uniasr/model.py), [paraformer_streaming/model.py#L765](https://github.com/modelscope/FunASR/blob/main/funasr/models/paraformer_streaming/model.py)
- **G5.** Chạy được thì phải kéo `funasr` + `torch` CPU vào sidecar đang ghim
  `sherpa-onnx==1.13.4 + onnxruntime==1.27.0`. Hai bộ không xung đột ABI với nhau, nhưng
  đó là một runtime thứ hai hoàn chỉnh trong cùng `mem_limit: 4g`.
- **G6 thì qua**: 367 MiB weight thừa chỗ trong 4g.

**Nếu muốn mở lại, chi phí thật là:** viết `def export` cho UniASR (hai pass, hai
encoder/decoder/predictor — xem `model.py` dòng 129–167), rồi viết runtime wrapper vì
sherpa-onnx **không có** model type nào đọc được UniASR 2-pass. Đây là một dự án kỹ
thuật riêng, không phải một bước tích hợp. Và kể cả làm xong: 1.000h dữ liệu tiếng Việt
từ 2023–2024, so với baseline hiện tại là 6.000h. **Khuyến nghị: không mở lại.**

---

## Phát hiện kiến trúc: sherpa-onnx không có streaming diarization

Không phụ thuộc vào việc chọn model ASR nào, và đáng để cả nhóm biết trước Phase 2:

- Python API của sherpa-onnx export đúng 4 symbol diarization, tất cả đều `Offline*`:
  `OfflineSpeakerDiarization`, `OfflineSpeakerDiarizationConfig`,
  `OfflineSpeakerDiarizationResult`, `OfflineSpeakerDiarizationSegment`.
  Không có `OnlineSpeakerDiarization`.
  Nguồn: [`sherpa-onnx/python/sherpa_onnx/__init__.py` L39–42](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/python/sherpa_onnx/__init__.py)
- Tầng C++ cũng vậy: `sherpa-onnx/csrc/` chỉ có `offline-speaker-diarization*.{h,cc}` và
  `offline-speaker-diarization-pyannote-impl.h`. Không có file `online-speaker-diarization*` nào.
  Nguồn: `GET /repos/k2-fsa/sherpa-onnx/contents/sherpa-onnx/csrc`

**Hệ quả:** nếu ứng viên thắng cuối cùng là một ASR streaming **không** kèm diarization,
thì tầng diarization streaming **không thể lấy từ sherpa-onnx**. Phải là runtime thứ hai
(pyannote/diart, hoặc model joint kiểu Sortformer), và nó phải tự chịu ngân sách CPU
riêng trong 4 thread / 4GB. Đây là ràng buộc nên đưa vào Phase 2 ngay, không để lộ ra ở
Phase 4.

---

## Quan sát chéo nhánh (không thuộc nhánh này, chuyển cho lead)

Trong lúc phân trang 499 asset của release `asr-models` có hai thứ nhánh khác nên biết,
ghi lại để khỏi phải quét lại:

- `sherpa-onnx-moonshine-base-vi-quantized-2026-02-27.tar.bz2` — **đã có** gói Moonshine
  base tiếng Việt pre-export trong sherpa-onnx. Offline. Liên quan đến nhánh Moonshine,
  không phải nhánh này.
- `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{160ms,1120ms,…}-int8-2026-06-11.tar.bz2`
  — xác nhận độc lập rằng gói Nemotron streaming int8 tồn tại thật trong release. Nhánh
  `inv-nvidia`.
- `sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-{240,560,1120}ms` — chỉ `en`.

---

## Câu hỏi chưa giải quyết

1. **Fun-ASR-MLT-Nano có streaming thật hay không, ở tầng model?** README chỉ chứng minh
   được rằng _đường streaming đã phát hành_ là vLLM. Không tìm thấy tài liệu nào nói
   encoder có causal/chunked attention. Câu hỏi này chỉ đáng trả lời nếu sau này có bản
   GGUF cho MLT — hiện tại G3/G5/G6 đã loại rồi nên không đào tiếp.
2. **E3 (Viettel/Zalo/FPT) là kết luận từ việc không tìm thấy**, không phải từ một tuyên
   bố phủ định trích được. Nếu lead biết một bản phát hành nội bộ/học thuật nào của các
   đơn vị này, nó chưa được kiểm ở đây.
3. **RTF 0.03 của 3D-Speaker diarization không có điều kiện đo** (số thread, CPU, độ
   chính xác số). Con số này không so được với trần 0,30 của đồ án và không nên trích vào
   luận văn ở dạng hiện tại. Dù sao nó cũng đã trượt G7.

---

# Bổ sung: Fun-ASR-Nano-2512

**Yêu cầu từ lead (2026-09-16):** chấm riêng `FunAudioLLM/Fun-ASR-Nano-2512` — repo duy
nhất trên HF Hub mang đủ ba thẻ `vi` + `streaming` + `speaker-diarization` — qua đúng bộ
G1–G8, và nói rõ nó có phải checkpoint khác với `Fun-ASR-MLT-Nano` ở dòng B6 không.

**Trả lời câu hỏi "có phải checkpoint khác không":** Đúng, đây là checkpoint khác
MLT-Nano, và nó chính là dòng **B5** trong bảng trên. Ở B5 tôi loại nó bằng README của
repo `QwenAudio/Fun-ASR`. Vòng này tôi chấm lại bằng **model card trên HF + config
checkpoint + source code**, và kết luận không đổi — nhưng lý do thì mạnh hơn nhiều, và
ba thẻ mà lead thấy đều là **metadata frontmatter mâu thuẫn với chính nội dung card**.

## Kết quả cổng

| Cổng                             | Kết quả           | Căn cứ                                                                                                                       |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| G1 Có tiếng Việt                 | **TRƯỢT**         | Bảng năng lực trên chính card ghi Nano = zh/en/ja. `model-index.results` = `[]`. Không một số nào cho vi.                    |
| G2 Streaming thật                | **TRƯỢT**         | Cả hai đường (vLLM và torch) đều **cumulative re-encoding**, không mang state qua chunk.                                     |
| G3 Chạy được CPU                 | **QUA**           | Có GGUF thật, chạy llama.cpp không cần GPU/Python.                                                                           |
| G4 License                       | **QUA**           | apache-2.0 trên card chính.                                                                                                  |
| G5 Runtime khả dụng              | **QUA một nửa**   | Binary llama.cpp độc lập, cài cạnh sherpa-onnx được. Nhưng đường GGUF là đường **offline**; streaming chỉ tồn tại trên vLLM. |
| G6 Kích thước                    | **QUA**           | GGUF encoder 469 MB f16 + qwen3-0.6b q8 805 MB ≈ 1,27 GB, vừa `mem_limit: 4g`.                                               |
| G7 Diarization streaming         | **TRƯỢT**         | Card tự ghi diarization là **việc chưa làm**.                                                                                |
| G8 Số người nói không biết trước | **Không áp dụng** | Không có tầng diarization nào của riêng model để mà chấm.                                                                    |

**Loại. G1 + G2 + G7.** Và G3/G5 qua được cũng vô nghĩa, vì cấu hình chạy được trên CPU
và cấu hình có streaming là **hai cấu hình khác nhau, không giao nhau**.

## 1. G1 — có số nào cho tiếng Việt không, trên bộ test nào?

**Không có số nào. Trên bất kỳ bộ test nào.**

Ba thẻ mà lead thấy nằm ở **YAML frontmatter** của card:

- `language: ['zh','en','ja','ko','yue','vi','id','th','ms','tl','ar','hi','multilingual']`
- `tags: [... 'streaming', 'speaker-diarization', 'vllm', 'real-time' ...]`

Nhưng **phần thân của đúng card đó** nói khác. Bảng năng lực, dòng Fun-ASR-Nano (L83):

> "Speech recognition supports **Chinese, English, and Japanese**. Chinese includes support
> for 7 dialects (Wu, Cantonese, Min, Hakka, Gan, Xiang, Jin) and 26 regional accents…"

Tiếng Việt nằm ở **dòng ngay dưới (L84), của MLT-Nano**, không phải dòng Nano. Câu "covers
31 languages" ở L58 và L90 là blurb giới thiệu **cả họ Fun-ASR**, bị copy nguyên si sang
card của từng checkpoint — chính bảng bên dưới nó phủ định nó.

Ba bằng chứng độc lập củng cố:

- **`model-index` rỗng:** `[{"name": "Fun-ASR-Nano-2512", "results": []}]`. Không một
  benchmark entry nào, nên không có cách nào để có số vi kèm tên bộ test.
- **File example đi kèm checkpoint:** `example/{zh,en,ja,ko,yue}.mp3`. **Không có `vi.mp3`.**
- **Card của bản GGUF cùng model** khai `language: ['zh','en']` — hẹp hơn cả card gốc.

Và repo upstream nói thẳng (`QwenAudio/Fun-ASR` README L93):

> "**Checkpoint-specific language coverage:** Fun-ASR-Nano supports Chinese, English,
> Japanese, and Chinese dialects and accents."

G1 loại theo **cả hai cách đọc cổng**: hoặc vi không phải năng lực của Nano, hoặc nếu
chấp nhận frontmatter thì đây đúng là trường hợp "liệt kê mà không có số nào cho tiếng Việt".

Nguồn: [HF card](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512) (L58, L83, L84, L90),
`GET hf/api/models/FunAudioLLM/Fun-ASR-Nano-2512?blobs=true` (tags, cardData, model-index, siblings),
[Fun-ASR README L93](https://github.com/QwenAudio/Fun-ASR) — **VERIFIED**

## 2. G2 — streaming thật hay cửa sổ trượt? (kiểm bằng source, không bằng card)

**Không phải streaming thật, và cũng không phải cửa sổ trượt — nó tệ hơn cả hai: cumulative
re-encoding.** Mỗi chunk encode lại **toàn bộ audio từ giây 0** đến hiện tại.

**Bằng chứng A — config của chính checkpoint.** `config.yaml` (146 dòng) **không có một
trường nào** tên `chunk`, `causal`, `cache`, `look_ahead`, hay `streaming`. Encoder là:

```yaml
audio_encoder: SenseVoiceEncoderSmall
audio_encoder_conf:
  num_blocks: 50
  selfattention_layer_type: sanm
  pos_enc_class: SinusoidalPositionEncoder
```

Đây đúng là **SenseVoice encoder** — cùng encoder non-autoregressive offline đã bị loại ở
dòng **B4** vì không streaming. Cảnh báo một cái bẫy đọc: trong file có
`task_type: CAUSAL_LM`, nhưng đó là cấu hình LoRA của **LLM decoder Qwen3-0.6B**, tức
"causal language model", **không liên quan gì** đến causal audio encoder. Đừng dùng dòng
đó làm bằng chứng streaming.

**Bằng chứng B — đường vLLM.** `funasr/models/fun_asr_nano/inference_vllm_streaming.py`,
docstring tự khai ngay dòng 10–15:

> "Audio split into 720ms chunks (**cumulative re-encoding**)"
> "**ALL chunks batched into single vLLM generate call** for correctness"
> "Note: vLLM processes all chunks in one batch for throughput.
> **For real-time streaming, use the torch-based inference in demo2.py.**"

Vòng lặp thật (L~262):

```python
for i in range(stage1_count):
    end_sample = min((i + 1) * chunk_samples, total_samples)
    adaptor_out, adaptor_out_lens = self._encode_audio(audio_data[:end_sample])
```

`audio_data[:end_sample]` — slice **từ 0**. Không cache, không state object. Ngoài ra hàm
cần `total_samples` của cả file trước khi bắt đầu và gom mọi chunk vào một `generate()`
duy nhất, nên nó **không online kể cả về mặt nguyên tắc**: chưa có đủ toàn bộ audio thì
chưa ra được output đầu tiên.

**Bằng chứng C — đường torch mà docstring chỉ sang.** Tôi truy `demo2.py` trong cả hai
repo (git tree recursive, `truncated: false`), tìm thấy
`examples/industrial_data_pretraining/fun_asr_nano/demo2.py` — 39 dòng, toàn bộ vòng lặp:

```python
chunk_size = 0.72
duration = sf.info(wav_path).duration
cum_durations = np.arange(chunk_size, duration + chunk_size, chunk_size)
prev_text = ""
for idx, cum_duration in enumerate(cum_durations):
    audio, rate = load_audio(wav_path, 16000, duration=round(cum_duration, 3))
    prev_text = m.inference([torch.tensor(audio)], prev_text=prev_text, **kwargs)[0][0]["text"]
```

`load_audio(..., duration=cum_duration)` = nạp lại từ 0 đến mốc hiện tại, rồi gọi **full
`m.inference()`**. Thứ duy nhất mang qua chunk là `prev_text` — một **chuỗi text** làm
prompt cho LLM, không phải encoder state. Và nó vẫn cần `sf.info(wav_path).duration`,
tức vẫn cần cả file trước.

**Kết luận G2:** không có chế độ causal / cache-aware / chunked ở bất kỳ đâu. Chi phí
encode là O(n²) theo độ dài audio, tức **kém hơn cả pseudo-streaming cửa sổ trượt stack
hiện tại đang chạy**. Áp đúng chuẩn đã dùng để bác UniASR (đọc source, không đọc card):
**trượt G2**.

Nguồn: [config.yaml](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512/raw/main/config.yaml),
[inference_vllm_streaming.py](https://github.com/modelscope/FunASR/blob/main/funasr/models/fun_asr_nano/inference_vllm_streaming.py),
[demo2.py](https://github.com/modelscope/FunASR/blob/main/examples/industrial_data_pretraining/fun_asr_nano/demo2.py),
`GET /repos/{modelscope/FunASR,QwenAudio/Fun-ASR}/git/trees/main?recursive=1` — **VERIFIED**

## 3. G3/G5 — có ONNX/GGUF không, hay lại chỉ vLLM?

**Khác với Qwen3-ASR và Fun-ASR-MLT-Nano: Nano CÓ GGUF thật, chạy CPU thật, không cần vLLM.**
Đây là điểm duy nhất Nano hơn hẳn hai ứng viên kia. Card L50:

> "⚡ **CPU / edge — no GPU, no Python:** run Fun-ASR-Nano as a single self-contained binary
> via **llama.cpp / GGUF** (like whisper.cpp), with built-in VAD."

| Repo GGUF                            | File                          | Kích thước | License                       |
| ------------------------------------ | ----------------------------- | ---------- | ----------------------------- |
| `FunAudioLLM/Fun-ASR-Nano-GGUF`      | `funasr-encoder-f16.gguf`     | 469,3 MB   | apache-2.0                    |
|                                      | `qwen3-0.6b-q8_0.gguf`        | 804,8 MB   | (`language: ['zh','en']`)     |
|                                      | `qwen3-0.6b-q5km.gguf`        | 551,4 MB   |                               |
|                                      | `qwen3-0.6b-q4km.gguf`        | 484,2 MB   |                               |
| `FunAudioLLM/Fun-ASR-Nano-2512-GGUF` | `fun-asr-nano-2512-q8_0.gguf` | 1045,3 MB  | **`other`** (khác apache-2.0) |
|                                      | `fun-asr-nano-2512-f16.gguf`  | 1675,7 MB  |                               |

Không có ONNX. Weight gốc `model.pt` = **1971,1 MB fp32** (giống hệt MLT-Nano).

**Nhưng đây mới là điểm quyết định, và nó khiến G3/G5 qua mà vô dụng:** GGUF là đường
**offline**. Toàn bộ code streaming của Nano nằm trong **một file duy nhất**
`inference_vllm_streaming.py`, và git tree xác nhận đó là file nano-streaming duy nhất
trong cả repo. Không có đường nào vừa CPU vừa streaming. **Chạy được thì không streaming;
streaming thì phải vLLM/GPU** — cùng bế tắc như Qwen3-ASR (B7) và MLT-Nano (B6), chỉ khác
là Nano ít nhất có một nửa hợp lệ.

Nguồn: `GET hf/api/models/FunAudioLLM/Fun-ASR-Nano{-2512,}-GGUF?blobs=true`,
[HF card L50](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512),
[runtime/llama.cpp](https://github.com/modelscope/FunASR/tree/main/runtime/llama.cpp) — **VERIFIED**

## 4. G7/G8 — diarization streaming hay offline clustering?

**Model này không có diarization. Thẻ `speaker-diarization` trên card là thẻ hệ sinh thái,
không phải năng lực checkpoint.**

Bằng chứng mạnh nhất nằm ngay trong roadmap của chính card (L117), dưới dạng một **checkbox
chưa tick**:

> `- [ ] Support speaker diarization`

Card vừa mang thẻ `speaker-diarization` ở frontmatter, vừa liệt kê diarization là **việc
chưa làm** ở phần thân. Hai chỗ còn lại nhắc "speaker diarization" trên card (L44, L91)
đều đang mô tả **bộ toolkit FunASR nói chung**, không phải checkpoint này.

Upstream nói dứt khoát (`QwenAudio/Fun-ASR` README L111):

> "Fun-ASR-Nano and Fun-ASR-MLT-Nano **do not emit speaker labels by themselves**. Compose
> them in FunASR with the separate `fsmn-vad` and `cam++` models."

Tức muốn có nhãn người nói thì phải ghép `cam++` — chính là **dòng D1** trong bảng trên,
đã trượt **G7** vì là segmentation-clustering chạy sau khi hết audio. Dùng Nano không đổi
được kết luận đó.

**G7: trượt.** **G8: không áp dụng** — không có tầng diarization của riêng model để chấm.
(Nếu ghép cam++ thì G8 qua, vì cam++ tự đoán số người nói; nhưng G7 đã loại cả tổ hợp rồi.)

Nguồn: [HF card L44, L91, L117](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512),
[Fun-ASR README L111](https://github.com/QwenAudio/Fun-ASR) — **VERIFIED**

## Hệ quả cho câu hỏi của lead

Fun-ASR-Nano-2512 **không phải** model joint ASR+diarization có tiếng Việt. Nó không có
tiếng Việt (ở mức có số đo), không có streaming thật, và không có diarization. Ba thẻ khiến
nó nổi lên trong lần quét HF Hub đều là **frontmatter mâu thuẫn với thân card** — `vi` bị
phủ định bởi bảng năng lực ngay dưới, `streaming` được implement bằng cumulative re-encode,
`speaker-diarization` bị chính card đánh dấu là chưa làm.

**Nhánh này vẫn 0 ứng viên sống sót.** Không có model joint ASR+diarization có tiếng Việt
trong hệ sinh thái FunASR. Kết hợp với phát hiện sherpa-onnx không có API streaming
diarization, hướng "một model làm cả hai việc" **không có đường ra từ phía châu Á**; tầng
diarization streaming buộc phải là một runtime riêng, tự chịu ngân sách CPU của nó.

## Câu hỏi chưa giải quyết (bổ sung)

4. **`Fun-ASR-Nano-2512-GGUF` khai `license: other`**, trong khi card gốc và
   `Fun-ASR-Nano-GGUF` khai apache-2.0. Tôi không mở được điều khoản cụ thể của "other".
   Không đào tiếp vì model đã trượt G1/G2/G7, nhưng nếu sau này có ai định dùng bản GGUF
   nào của FunASR thì phải kiểm lại license **của đúng artifact đó**, không suy từ card mẹ.
