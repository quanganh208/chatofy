---
phase: 1
date: 2026-09-16
status: xong, đầy đủ
nhánh: 4 nhánh khảo sát song song, báo cáo chi tiết ở các file inventory-*.md
---

# Phase 1 — Kết quả khảo sát ứng viên

## Kết luận một dòng

Hai ứng viên qua đủ 8 cổng, **cả hai đều được dự đoán trượt trục WER**. Nhưng
cuộc khảo sát tìm được một thứ quan trọng hơn cả hai: **một model tiếng Việt đạt
2,49% WER trên đúng bộ test của chúng ta** — chưa bằng một nửa lỗi của incumbent —
với công thức streaming, dữ liệu và runtime đều công khai, chỉ thiếu đúng một
checkpoint streaming tiếng Việt.

## Ứng viên sống sót

|                        | `nvidia/nemotron-3.5-asr-streaming-0.6b`               | `moonshine-ai/moonshine-streaming-tiny-vi`                      |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Tham số                | 600M                                                   | **27,0M**                                                       |
| Kích thước             | 682 MB (int8; fp32 2594 MB trượt G6)                   | **32,3 MB** (int8 `.ort`)                                       |
| License                | OpenMDW-1.1                                            | **MIT**                                                         |
| Streaming              | Cache-aware FastConformer-RNNT, 5 chunk size 80–1120ms | Causal, lookahead 80ms, state qua chunk                         |
| Runtime                | **sherpa-onnx 1.13.4 đang ghim** — không cần nâng      | wheel `moonshine-voice`, link ORT tĩnh, không đụng bản ghim     |
| Diarization            | **Không**                                              | Có, nhưng từ **cpp-annote** đóng gói chung, không phải từ model |
| WER công bố            | 11,18–13,41% FLEURS-vi                                 | 10,98% FLEURS-vi · 7,62% LSVSC · macro 9,30 (int8 9,425)        |
| So với mốc 5,38% VIVOS | **khác bộ test, không trừ trực tiếp được**             | **khác bộ test, không trừ trực tiếp được**                      |

Cả hai đều **không có số nào trên VIVOS**, nên khoảng cách thật với incumbent chỉ
Phase 3 mới trả lời được.

### Ghi chú cần thiết về Moonshine

Diarization **không thuộc về model**. Model card không nhắc tới nó, và còn liệt kê
speaker identification vào mục _"Out-of-scope use"_. Khả năng đó đến từ
**cpp-annote** (port ONNX của pyannote community-1, 8,2 MB, **CC-BY-4.0**) — một
component riêng, license riêng, chỉ đóng gói chung wheel. G7 pass (streaming VBx
re-cluster khi audio đến) và G8 pass (không có tham số số người nói ở bất kỳ đâu
trong API công khai).

Mô tả _"sliding-window Transformer encoder"_ trong model card là cách nói dễ gây
nhầm với pseudo-streaming. Bằng chứng artifact nghiêng hẳn về streaming thật:
`streaming_config.json` khai `frontend_state_shapes` (`sample_buffer`,
`conv1_buffer`, `conv2_buffer`, `frame_count`) và `MoonshineStreamingState` có
decoder KV cache. Một model decode lại từ đầu sẽ không cần conv buffer để mang
qua. **Vẫn phải smoke test ở Phase 2** — đếm số lần gọi engine bằng số chunk.

## Phát hiện lớn nhất: `khanhld/chunkformer-rnnt-large-vie`

| Thuộc tính          | Giá trị                                                                        | Nguồn                                      |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| **WER VIVOS**       | **2,49%**                                                                      | model card, **cùng bộ test với mốc 5,38%** |
| WER Common Voice vi | 5,18%                                                                          | model card                                 |
| WER VLSP 2020 T1    | 12,75%                                                                         | model card                                 |
| License             | **CC-BY-4.0**                                                                  | model card                                 |
| Tham số / dữ liệu   | 113M / ~5.000 giờ tiếng Việt                                                   | model card                                 |
| ONNX                | Có export cache-aware + `StreamingSession` thật, chỉ cần `onnxruntime`+`numpy` | repo                                       |

**Trượt G2, có số đo.** Checkpoint tiếng Việt có
`dynamic_right_context_sizes: [64,128,256]`, không có cờ `streaming`; encoder
hardcode `subsampling_rate=8` với frame shift 10ms, nên lookahead tối thiểu là
`64 × 8 × 10ms =` **5,12 giây**. Với dịch simultaneous thì 5,12s lookahead còn tệ
hơn cả pipeline hiện tại (~1,13s).

**Nhưng đây không phải ngõ cụt như VietASR.** Khác biệt quyết định:

|                                 | VietASR    | ChunkFormer-vie                                                    |
| ------------------------------- | ---------- | ------------------------------------------------------------------ |
| Công thức streaming công khai?  | Có (paper) | **Có, và đã chạy**                                                 |
| Checkpoint streaming phát hành? | Không      | **Có — nhưng là tiếng Anh** (right context `[0]`, chunk 320–640ms) |
| Dữ liệu huấn luyện công khai?   | Không rõ   | **~5.000 giờ vi, công khai**                                       |
| Runtime công khai?              | Không      | **Có, ONNX**                                                       |
| Chất lượng đã chứng minh?       | —          | **2,49% VIVOS**                                                    |

Tức là: công thức có, dữ liệu có, runtime có, chất lượng đã chứng minh. Thiếu đúng
**một lần fine-tune** để sinh ra checkpoint streaming tiếng Việt.

Repo `chunkformer-rnnt-small-vie-stream-dct` mà README dẫn ví dụ **không tồn tại**
(API trả 401).

## Danh sách bị loại — trích dẫn đầy đủ trong các báo cáo nhánh

**Tiếc nhất:**

- **Sortformer v1/v2/v2.1** (NVIDIA): streaming diarization thật, latency 0,32s,
  4 sigmoid output nên **không cần biết trước số người nói**. Qua cả G7 lẫn G8.
  **Trượt G1: chỉ tiếng Anh.** Đúng thứ cần, sai ngôn ngữ.
- **VibeVoice-ASR-Streaming-{1.5B,7B}**: joint ASR + diarization + streaming +
  ONNX + MIT. **Trượt G1: 10 ngôn ngữ, không có tiếng Việt.**
- **UniASR Vietnamese**: two-pass online thật, 95M, Apache-2.0. **Trượt G3** —
  `funasr/models/uniasr/model.py` có **0 lần** xuất hiện chuỗi `export`, trong khi
  `paraformer_streaming/model.py` có `def export` ở dòng 765.
- **`nvidia/parakeet-ctc-0.6b-Vietnamese`**: model tiếng Việt duy nhất của cả org
  NVIDIA, công bố **VIVOS 5,96%** — **tệ hơn incumbent 5,38%**. Loại vì CTC
  offline, chỉ `.nemo`. Là bằng chứng độc lập rằng incumbent mạnh bất thường.

**Loại vì có streaming nhưng không chạy CPU:** Fun-ASR-MLT-Nano (800M, vi,
Apache-2.0) và Qwen3-ASR 0.6B/1.7B — chỉ streaming qua vLLM/GPU. README Qwen3:
_"streaming inference is only available with the vLLM backend"_.

**Toàn bộ họ Whisper loại ở G2**, trích từ chính README của chúng:
`whisper_streaming` — _"it is not designed for real-time transcription"_, _"each
audio fragment is processed multiple times"_. WhisperLive tự gọi mình là _"a
nearly-live implementation"_. **Kết quả này có giá trị riêng: nó chứng minh
pseudo-streaming là chuẩn mực ngành, không phải lựa chọn kém của dự án.**

**Cloud, chỉ làm mốc tham chiếu:** Deepgram Nova-3/Nova-2 có `vi` streaming,
AssemblyAI Universal-3.5 Pro có `vi`. **Không vendor nào công bố WER riêng cho
tiếng Việt**, nên không có số cloud nào đưa vào bảng quyết định được.

## Ràng buộc kiến trúc mới, chưa có trong kế hoạch

**sherpa-onnx không có API streaming diarization nào.** Python export đúng 4
symbol `Offline*`; csrc không có file `online-speaker-diarization*`. Hệ quả: nếu
model ASR thắng cuộc không kèm diarization, tầng speaker buộc phải là **runtime
thứ hai** với ngân sách CPU riêng — không phải thêm một lời gọi vào runtime đang
có. Điều này làm nặng cả G5 lẫn ngân sách RTF ở Phase 4.

## Phạm vi đã quét

Nhánh quét rộng liệt kê **hết 36.191** model `pipeline_tag=ASR & language=vi`
(37 trang × 1000, phân trang bằng `Link: rel=next`); 246 model ASR gắn tag
`streaming`; 25 ở giao `vi + streaming`, gom về đúng 4 họ; 4 ở `vi +
speaker-diarization`; 328 speech-LLM vi; 31 diarization streaming; 456
diarization; cộng author sweep 15 nhà công bố tiếng Việt và 7 query dataset. Quét
từ khoá trên cả 36k: 468 nhắc `streaming`, 176 `diariz`, 75 `cache-aware`, 6
`causal`. Soát tay ~110 repo đuôi.

Nhánh FunASR phân trang **toàn bộ 499 asset** của release `asr-models` (6 chứa
`vi`, tất cả offline), soi cả online-ctc và online-paraformer, đối chiếu 42 recipe
icefall và 17 recipe WeNet.

**`search=vietnamese diarization` trả 0 dataset** — không có bộ test diarization
tiếng Việt công khai nào trên Hub.

## Chi phí đo và quyết định GPU

Bộ test ASR: **199,2s tiếng Việt + 286,9s tiếng Anh = 486,1s ≈ 8,1 phút audio**
mỗi model (đếm từ `duration_s` trong `manifest-vi.jsonl` và `manifest-en.jsonl`).

| Kịch bản                                        | Thời gian |
| ----------------------------------------------- | --------- |
| 2 ứng viên × 2 ngôn ngữ, RTF 0,3                | ~8 phút   |
| Kịch bản bi quan NVIDIA (5 chunk size, RTF 3,0) | 2h55      |
| Nhánh Moonshine, gồm diarization 3 cấu hình     | < 1 giờ   |

**Không trigger nào bật.** Điều kiện (1) không thoả: mọi model chỉ-GPU đều đã
trượt G1 trước, không có cái nào "chỉ thiếu mỗi CPU". Điều kiện (2) không thoả:
tổng ước tính xa dưới ngưỡng 8 giờ.

**Nhưng một trường hợp GPU khác đã xuất hiện, nằm ngoài hai trigger của kế
hoạch** — xem phần ChunkFormer. Đó là GPU để **fine-tune**, không phải để đo, và
là quyết định của người dùng.

## Câu hỏi chưa giải quyết

1. ~~`FunAudioLLM/Fun-ASR-Nano-2512`~~ — **đã kiểm, trượt G1 + G2 + G7.** Xem
   mục dưới. Không còn ứng viên joint ASR+diarization có tiếng Việt nào.
2. **Không có bộ test diarization tiếng Việt công khai.** Chi phí thật của arm
   diarization là chi phí **gán nhãn**, không phải giờ CPU. Đây vẫn là rủi ro lịch
   trình lớn nhất của kế hoạch, và giờ đã được xác nhận bằng một lần quét trả 0.
3. **Chưa có RTF CPU x86 đáng tin cho ứng viên nào.** Docs Moonshine tự nói cột
   Linux x86 _"read pessimistically"_, và chi phí diarization chỉ có mô tả định
   tính _"costs a lot of compute"_. Trần RTF ≤ 0,30 **chưa được kiểm cho ai**.
4. **Speaker span của Moonshine có thể bị sửa hồi tố** trong cửa sổ 120s, kể cả
   trên dòng đã đóng. Phải chốt chấm điểm theo "gán lần đầu" hay "gán ổn định"
   trước khi đo, nếu không không so được với mốc 0,78/0,59.
5. **`.ort` của Moonshine có nạp được bằng `onnxruntime==1.27.0` trần không** —
   mới chứng minh được là SDK không xung đột, chưa chứng minh tự lái graph được.

## Bổ sung — `FunAudioLLM/Fun-ASR-Nano-2512` đã kiểm, trượt

Đây là repo duy nhất trên Hub mang đủ ba thẻ `vi` + `streaming` +
`speaker-diarization`, nên nó là ứng viên cuối cùng còn khả năng là model joint có
tiếng Việt. **Cả ba thẻ đều là metadata mâu thuẫn với chính thân model card.**

**G1 trượt — không có tiếng Việt.** `language:` frontmatter có `vi`, nhưng bảng
năng lực ngay trong thân card (L83) ghi Nano = _"Chinese, English, and Japanese"_;
tiếng Việt nằm ở dòng L84 ngay dưới, thuộc về **MLT-Nano** — một checkpoint khác.
Câu _"covers 31 languages"_ là blurb của cả họ Fun-ASR bị chép sang card từng
checkpoint. Ba xác nhận độc lập: `model-index.results` = `[]` rỗng hoàn toàn; file
example đi kèm là zh/en/ja/ko/yue, **không có `vi.mp3`**; card bản GGUF cùng model
khai `language: ['zh','en']`.

**G2 trượt — và tệ hơn cửa sổ trượt.** Cả hai đường inference đều là **cumulative
re-encoding**, không mang state qua chunk. Docstring đường vLLM tự khai: _"Audio
split into 720ms chunks (cumulative re-encoding)"_, và vòng lặp gọi
`self._encode_audio(audio_data[:end_sample])` — slice từ 0 mỗi lần. Đường
torch trong `demo2.py` cũng vậy: `load_audio(..., duration=cum_duration)` rồi gọi
full `m.inference()` mỗi vòng; thứ duy nhất mang qua chunk là `prev_text`, một
chuỗi text làm prompt cho LLM, **không phải encoder state**. `config.yaml` không có
trường `chunk`/`causal`/`cache`/`look_ahead` nào, và encoder là
`SenseVoiceEncoderSmall` — đúng encoder offline đã bị loại ở nhánh này trước đó.
Chi phí encode là O(n²), **kém hơn cả pseudo-streaming stack hiện tại**.

Bẫy đọc cần tránh: config có `task_type: CAUSAL_LM`, nhưng đó là LoRA của LLM
decoder Qwen3-0.6B, không phải causal audio encoder.

**G3/G5 qua, nhưng vô dụng.** Nano **có GGUF thật** (encoder f16 469 MB +
qwen3-0.6b q8 805 MB ≈ 1,27 GB, chạy llama.cpp, không cần GPU, vừa 4g). Nhưng GGUF
là đường **offline**, còn toàn bộ code streaming nằm trong đúng một file
`inference_vllm_streaming.py`. **Chạy được thì không streaming; streaming thì phải
vLLM/GPU.** Hai cấu hình không giao nhau.

**G7 trượt.** Card tự đánh dấu diarization là việc **chưa làm** — nguyên văn một
checkbox chưa tick ở L117: `- [ ] Support speaker diarization`. Upstream nói
thẳng: _"Fun-ASR-Nano and Fun-ASR-MLT-Nano do not emit speaker labels by
themselves. Compose them in FunASR with the separate `fsmn-vad` and `cam++`
models"_ — mà cam++ đã trượt G7 vì clustering chỉ chạy sau khi hết audio.

**Cảnh báo license:** `Fun-ASR-Nano-2512-GGUF` khai `license: other` trong khi
card mẹ và `Fun-ASR-Nano-GGUF` khai apache-2.0. Không đào tiếp vì model đã trượt,
nhưng **đừng suy license của artifact từ card mẹ.**
