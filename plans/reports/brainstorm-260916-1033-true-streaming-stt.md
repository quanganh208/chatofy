---
type: brainstorm
date: 2026-09-16
mode: ultra (best-of-5 verifier)
branch: main
scope: STT stage only — true streaming speech-to-text
status: accepted, gated on a one-day measurement
supersedes-partially: brainstorm-260916-0948-simultaneous-streaming-stt-mt-tts.md (STT stage)
---

# STT streaming thật — contract

## Provenance

`ak:brainstorm --ultra`: một evidence packet bất biến, năm candidate read-only song
song trên tier Opus, một verifier trên tier Fable chấm ẩn danh. Bản dưới đây là
candidate thắng cuộc, **giữ nguyên văn**.

**Packet do controller viết có ít nhất bốn lỗi.** Candidate được lệnh kiểm chứng
thay vì tin, và verifier được lệnh tự xác lập sự thật thay vì biểu quyết. Bốn
phán quyết dưới đây thay thế các mục tương ứng trong packet.

### F1 — sherpa-onnx 1.13.4 đã hỗ trợ Nemotron-3.5 streaming? **CÓ**

PR #3671 merge 2026-06-12, v1.13.4 phát hành 2026-07-07. File `.so` đang cài chứa
`OnlineRecognizerTransducerNeMoImpl` và `prompt_index`. Test của v1.13.4 nạp được
gói `560ms-int8-2026-06-11` với `set_option("language")`.

Khẳng định "phải nâng lên 1.13.5+" là **sai**, và 1.13.5+ **không cài được ở đây**:
nó cần onnxruntime 1.27.1, bản chưa từng lên PyPI. Ghi chú: 1.13.5 có kèm bản vá
greedy decoder (PR #3785) cho đúng lớp model này, nằm trong bản không cài được.

### F2 — đổi sang streaming là WIN hay LOSS CPU cho tiếng Việt? **UNKNOWN-TO-LOSS**

Không tồn tại con số RTF nào cho artifact int8 của k2-fsa trên x86. Con số
"int8 RTF 0,148" là một bản export dynamic-int8 mà chính nguồn của nó báo WER
divergence 0,189 — tức **hỏng**. Con số 0,26 trong packet không ghi phần cứng và
nằm dưới mục của một model khác.

Break-even suy ra từ `PARTIAL_DUTY_DIVISOR = 3` là **RTF ≈ 0,33**. Tiếng Anh thắng
nhẹ nếu RTF@4-thread < 0,33; tiếng Việt là **coin-flip trên lượt dài và thua trên
lượt ngắn**. **Không bao giờ là 2,25×.**

### F3 — cái thắng CPU có hết hạn khi commit segmenter ship không? **CHƯA XÁC LẬP**

Plan đã chốt vẫn **giữ** cửa sổ re-decode 8s
(`brainstorm-260916-0948-...md:371`), và phụ lục của nó chuyển v1 sang S-B chỉ cho
làn tiếng. Thu nhỏ cửa sổ partial là một thay đổi **chưa được chấp nhận**, và kể
cả khi thu nhỏ thì tiếng Anh vẫn đứng ở trần 33,3%.

### F4 — con số duty cycle "14% vi / 40% en" trong packet? **LỖI THỜI**

Dòng đó commit ngày 2026-07-26; `PARTIAL_DUTY_DIVISOR` mới vào ngày 2026-09-13.
Công thức đang chạy cho ra **16,3% / 33,3%** ở cửa sổ 3s, với trần cứng 33,3%.
Con số 40% **không thể** đến từ công thức này.

### Bảng điểm và thứ hạng

Faithfulness nhân hệ số 2.

| Candidate     | Faith | Evidence | Acceptance | Honesty | Thô | Có trọng số |
| ------------- | ----- | -------- | ---------- | ------- | --- | ----------- |
| **B (thắng)** | 16    | 18       | 17         | 17      | 68  | **84**      |
| C             | 15    | 13       | 16         | 14      | 58  | 73          |
| E             | 12    | 13       | 15         | 14      | 54  | 66          |
| D             | 12    | 13       | 14         | 13      | 52  | 64          |
| A             | 12    | 9        | 16         | 13      | 50  | 62          |

Cả năm qua H1–H5. Không reject-all. 27 citation được spot-check.

B thắng vì là bản duy nhất đúng hoặc gắn cờ đúng cả bốn dữ kiện tranh chấp: nó
kiểm chứng Nemotron ngay trong binding đã biên dịch (verifier tái lập được), tìm
ra chặn 1.13.5 trong chính `pyproject.toml` của repo, tính lại trần duty và gắn
cờ con số 40% là bất khả, và **không** khẳng định quá lời về F3 khi không có nguồn.

C là á quân đáng kể và kiến trúc ship của nó có lẽ tốt hơn (streaming cho làn
partial, giữ model đã đo cho bản final), nhưng tiêu đề "thắng 2,25× CPU" của nó
dựa trên con số int8 hỏng mà nó bỏ qua phần divergence, nó khẳng định F3 như một
thuộc tính của plan mà plan không chứa, và cổng WER ≤12% cho làn partial **không
thể fail** trước một model có model card ghi 12,29%.

## Must-fix trước khi planning dùng bản này

1. Siết cổng A1 từ WER ≤8,0% xuống **≤7,71%** (mốc chất lượng PhoWhisper của chính
   repo) hoặc biện minh rõ cho 8,0 — Hướng A thay **cả hai** engine nên cổng này
   quản bản final/đọc lên. Nêu ngân sách tiếng Anh tương tự (+2,14 pp).
2. Bỏ hoặc hạ cấp A5 (tái lập FLEURS-vi): FLEURS nằm trong dữ liệu huấn luyện của
   **cả** incumbent lẫn Nemotron, và harness không chuẩn bị bộ đó. Chỉ VIVOS-50
   (+`manifest-vi-display`) trong **một** run tag mới là phép so hợp lệ.
3. Tách ngữ nghĩa lane và stream slot: giữ `LOCAL_STT_CONCURRENCY` cho decode từng
   chunk, thêm `LOCAL_STT_STREAM_SLOTS` và đặt 503 lên cái sau — §5.5 hiện nói cả hai.
4. Ghi lại caveat decoder của 1.13.4: bản vá greedy PR #3785 nằm trong 1.13.5 không
   cài được, và các gói được re-export ngày 2026-07-08 dưới **cùng tên** `2026-06-11`.
   Kiểm token rơi ở biên chunk trước khi quy cho lỗi model.
5. Thay prior RTF "0,26–0,30" bằng: sherpa int8 ≈ 0,11–0,12 @1120ms (CPU không rõ),
   fp32-numpy 0,263 @320ms; dự kiến 0,2–0,3 @320ms/8 thread ở máy này, cao hơn ở 4.
   Giữ A8 (≤0,30 ở 4 thread) làm cổng.
6. Thêm chuỗi mã ngôn ngữ tiếng Việt vào A19 (`"vi"` hay `"vi-VN"` trong
   `prompt_dictionary`) — test của 1.13.4 chỉ dùng ja/en.
7. Tính cả đường decode của turn-speculation vào break-even, hoặc dán nhãn 0,35 là
   cận dưới (chính §5.1 của B đã ghi chú điều này).
8. Biến file GGUF 983MB mồ côi thành một bước xoá tường minh hoặc một câu hỏi cho
   người dùng, không phải một chỗ bỏ trống.

**Số quan trọng nhất cho quyết định này không tồn tại ở bất kỳ đâu**: RTF của gói
int8 320/560ms của k2-fsa, trên chính máy x86 này, ở 4 thread, trên 1.13.4. Phải đo
trước khi viết bất kỳ dòng service code nào.

---

# Contract thắng cuộc (nguyên văn)

Repo: `/home/quanganh208/Documents/QuangAnh/chatofy` · Linux x86_64, CPU-only.
Mọi claim về hành vi hiện tại đánh dấu **[V]** = tự đọc/tự chạy, **[I]** = suy luận.

---

## 0. Phát hiện lật ngược giả định của packet (đọc trước phần còn lại)

Packet §5(b) nói blocker lớn nhất của Nemotron là runtime: _"GGUF là llama.cpp-family,
NOT sherpa-onnx... wiring nó nghĩa là một runtime THỨ BA trong `services/local-stt`"_.

**Điều đó KHÔNG còn đúng.** Kiểm chứng tại chỗ, trên đúng wheel đang cài:

| Bằng chứng                                                                                                                                                                                                        | Nguồn                                                                         | Trạng thái    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| PR _"Add multilingual Nemotron-3.5 streaming ASR support"_ merged vào `master` **2026-06-12T06:52:47Z**                                                                                                           | `gh api repos/k2-fsa/sherpa-onnx/pulls/3671`                                  | **[V]**       |
| sherpa-onnx **v1.13.4** publish **2026-07-07T11:26:47Z** — tức SAU khi PR merge                                                                                                                                   | `gh api .../releases`                                                         | **[V]**       |
| Repo **đã pin đúng `sherpa-onnx==1.13.4`**                                                                                                                                                                        | `services/local-stt/pyproject.toml:15`                                        | **[V]**       |
| 5 asset int8 chính thức, mỗi chunk size một gói: `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{80,160,320,560,1120}ms-int8-2026-06-11.tar.bz2`, mỗi gói **≈475 MB nén**                                           | `gh api .../releases/tags/asr-models`                                         | **[V]**       |
| Binding đã compile chứa `prompt_index`, `set_option`, và nguyên văn chuỗi cảnh báo `"The encoder declares prompt_index, but usable prompt_dictionary metadata is missing; all languages will fall back to auto."` | `strings` trên `sherpa_onnx/lib/_sherpa_onnx.cpython-311-x86_64-linux-gnu.so` | **[V]**       |
| `OnlineStream` có `set_option` / `get_option` / `has_option`; `OnlineRecognizer` có `create_stream`, `decode_stream`, **`decode_streams`** (batched), `is_ready`, `is_endpoint`, `reset`, `timestamps`            | `import sherpa_onnx` trong venv của sidecar, `dir()`                          | **[V]**       |
| `OnlineRecognizer.from_transducer(tokens, encoder, decoder, joiner, ...)` có `model_type`, `num_threads`, `decoding_method`                                                                                       | `sherpa_onnx/online_recognizer.py:98`                                         | **[V]**       |
| Gói int8 giải nén: `encoder.int8.onnx` 658 MB + `decoder.int8.onnx` 15 MB + `joiner.int8.onnx` 9,5 MB + `tokens.txt` 131 kB ≈ **688 MB**                                                                          | HF mirror `apbaxel/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-int8`          | **[V]** (web) |

**Hệ quả:** không cần runtime thứ ba, không cần llama.cpp, **không cần nâng version**
(mà nâng cũng không được: `pyproject.toml:9-14` **[V]** ghi rõ 1.13.5/1.13.6 cần
onnxruntime 1.27.1 — PyPI chưa từng publish, nên 1.13.4 là trần cứng). File GGUF
983 MB trong `models/nemotron-streaming-0.6b/` là **sai format** cho đường này và nên
xoá, không phải nên wire.

Xác nhận thêm hai lead khác của §5:

- **§5(a) ĐÚNG [V]**: trang online-transducer của sherpa liệt kê đúng 12 model —
  bn/zh/ko/en/zh-en. **Không có model vi streaming nào.** Kết quả search gợi ý
  "sherpa-onnx-zipformer-vi-* hỗ trợ streaming" là summarizer nhầm trang
  _offline_-transducer với streaming; các model vi đó là offline + VAD.
- **§5(c) VietASR: KHÔNG dùng được [V]**. Repo `zzasdf/VietASR` (Apache-2.0) chỉ
  release **một** checkpoint `zzasdf/viet_iter3_pseudo_label` — **non-causal**.
  Không có causal/streaming checkpoint, không ONNX export, không tương thích sherpa.
  Paper có mô tả causal Zipformer; **weights thì không phát hành.** Đóng lead này.

Một chỗ nữa trong packet cần đính chính (§3, cuối):

> _"a 4GB container limit shared with a TTS sidecar that already holds ~2GB"_

`docker-compose.prod.yml:284` và `:314` **[V]**: `local-stt` và `local-tts` là **hai
container riêng, mỗi cái `mem_limit: 4g`**. Cái chúng chia nhau là **16 core của host**
(comment dòng 234-236 **[V]**), không phải 4 GB RAM. Docstring `base.py:55-56` **[V]**
viết theo giả định cũ. **Ngân sách RAM cho STT rộng hơn packet tưởng: 4 GB cho riêng nó.**

---

## 1. Outcome — "true streaming STT" nghĩa là gì, quan sát được

Không định nghĩa bằng tên kiến trúc ("OnlineRecognizer thay vì OfflineRecognizer") —
định nghĩa đó không falsifiable từ phía người dùng. Định nghĩa bằng **ba tính chất đo được**:

**O1 — Độ trễ hiển thị KHÔNG phụ thuộc độ dài lượt nói.** Đây là tính chất trung tâm,
và là thứ hệ thống hiện tại **hỏng**. Đo: `t_hiện_lên(w) − t_nói_xong(w)` cho từ `w`,
p95, **phân theo vị trí từ trong lượt** (giây thứ 1 / 3 / 8 / 15).

- Hiện tại **[V, tính từ công thức]**: `interval = max(300ms, 3 × d)`
  (`partial-transcript-scheduler.ts:109-112`), `d` tăng theo cửa sổ (§4 packet) ⇒
  en refresh giãn **354 ms → 831 ms** khi cửa sổ đi từ 1 s lên 8 s. Từ nói ở giây 15
  chờ lâu hơn từ nói ở giây 1. Đó là pseudo-streaming lộ mặt.
- Sau thay đổi: đường cong phải **phẳng** — p95 ở giây 15 không tệ hơn p95 ở giây 1
  quá 15%.

**O2 — Transcript append-mostly, không viết lại cả cửa sổ.** Đo `rewrite_rate` =
tỉ lệ ký tự đã emit rồi bị đổi ở tick sau.

- Hiện tại **[I, từ thiết kế]**: mỗi tick decode lại **toàn bộ** cửa sổ 8 s từ đầu
  (`live-preview.ts:52-58` **[V]** gửi `audio.toWav(windowStart(...))`), nên mọi ký tự
  trong cửa sổ đều có thể đổi. `shouldEmit` chỉ chặn _lùi_
  (`partial-transcript-scheduler.ts:137-139` **[V]**), không chặn _viết lại_.
- Sau thay đổi: transducer streaming emit token một lần ⇒ `rewrite_rate` gần 0 ngoài
  phần tail chưa chốt.

**O3 — Engine decode mỗi frame audio đúng MỘT lần.** Đây là phần "thật" trong
"streaming thật": kiểm chứng bằng `total_decode_seconds / total_audio_seconds` ≈ RTF
của model, thay vì ≈ RTF × (window/interval) như bây giờ.

**Cả ba phải đúng cho CẢ tiếng Việt lẫn tiếng Anh.** Một phương án chỉ làm được tiếng
Anh không giải quyết ngôn ngữ chính của đồ án.

---

## 2. Constraints — truy về bằng chứng

| #   | Ràng buộc                                                                                                                                                                                                            | Nguồn                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | CPU-only là đường ship; GPU chỉ là contingency khi một tiêu chí trượt trên CPU                                                                                                                                       | packet §2 (binding)                                                                                                                                                |
| C2  | Chỉ web `/translate`. Extension giữ Gemini Live, mobile không đụng                                                                                                                                                   | packet §2 (binding)                                                                                                                                                |
| C3  | MT ở lại Gemini text API — streaming STT không được kéo theo redesign MT                                                                                                                                             | packet §2 (binding)                                                                                                                                                |
| C4  | Runtime trần cứng **sherpa-onnx 1.13.4 + onnxruntime 1.27.0**, pin exact vì ABI `VERS_1.27.0`                                                                                                                        | `services/local-stt/pyproject.toml:9-16` **[V]**                                                                                                                   |
| C5  | Ngưỡng luận văn đã ghi: **RTF ≤ 0,3 · p95 ≤ 2 s** cho câu 5–10 s                                                                                                                                                     | `docs/development-journey.md:70` **[V]**                                                                                                                           |
| C6  | Incumbent vi: **WER 5,38 · CER 2,90 · RTF 0,0158 · p95 0,088 s · RAM 211–223 MB**, greedy, `num_threads=8`, VIVOS 50 câu seed 42                                                                                     | `development-journey.md:122-124, 224-228` **[V]**                                                                                                                  |
| C7  | Incumbent en: **WER 3,86 · RTF 0,040 · p95 0,34 s · RAM 418 MB**                                                                                                                                                     | `development-journey.md:129-131` **[V]**                                                                                                                           |
| C8  | vi Zipformer là **CC-BY-NC-ND-4.0**, README nêu đích danh là model phải thay nếu thương mại hoá                                                                                                                      | `README.md:343,348` **[V]**                                                                                                                                        |
| C9  | Sidecar hiện **stateless**: chỉ `POST /transcribe` (file → `{text, language}`), không timestamp, không session                                                                                                       | `services/local-stt/app.py:61-90` **[V]**                                                                                                                          |
| C10 | `result.timestamps` do transducer sinh ra đang **bị vứt** — `base.py:160` lấy đúng `stream.result.text`                                                                                                              | `services/local-stt/engines/base.py:156-163` **[V]**                                                                                                               |
| C11 | Concurrency = **semaphore 4 lane trên MỘT recognizer dùng chung**, quá hạn 2000 ms thì **từ chối 503**, không xếp hàng                                                                                               | `base.py:38-73, 137-163` **[V]**                                                                                                                                   |
| C12 | Lý do dùng chung recognizer là **RAM**; 120 decode đồng thời cho transcript byte-identical với serial; scale ~2,3× ở 6 worker                                                                                        | `base.py:44-57` **[V]**                                                                                                                                            |
| C13 | Prod chạy **`LOCAL_STT_THREADS=4`** (dev 8) và `LOCAL_STT_CONCURRENCY=4`; hai stack dùng chung 16 core                                                                                                               | `docker-compose.prod.yml:278,283` + comment 234-236 **[V]**                                                                                                        |
| C14 | `local-stt` có **`mem_limit: 4g` RIÊNG**; `local-tts` là container khác cũng `4g`                                                                                                                                    | `docker-compose.prod.yml:284,314` **[V]** — đính chính packet §3                                                                                                   |
| C15 | Scheduler: cadence floor 300 ms · duty divisor 3 · cửa sổ 8 s · min audio 200 ms (vi Zipformer HTTP-500 ở ≤82 ms)                                                                                                    | `partial-transcript-scheduler.ts:16,32,44,66` **[V]**                                                                                                              |
| C16 | **`SttProvider` ĐÃ có sẵn slot streaming chưa dùng**: `startStream?` / `pushAudio?` / `StreamHandle`, kèm `SttTranscriptEvent {text, isFinal, language}`. Comment đầu file: _"streaming is an optional future path"_ | `packages/ai-providers/src/interfaces/stt-provider.ts:1-3,17-22,32-38` **[V]**                                                                                     |
| C17 | Pattern handle→socket **đã tồn tại và đang chạy** cho Gemini Live (`pushAudio(handle, chunk)`), API đã có WS gateway                                                                                                 | `providers/gemini-live/gemini-live-translate-provider.ts:289`, `live-translate-session.service.ts:297`, `translate.gateway.ts`, `session/stream-socket.ts` **[V]** |
| C18 | Có **3** đường gọi `/transcribe` mỗi lượt: partial (`live-preview.ts`), speculation (`turn-speculation.ts`), final (`translation-session.service.ts`)                                                                | grep **[V]**                                                                                                                                                       |
| C19 | Model claim phải kèm harness + kết quả ghi lại; thêm arm = thêm adapter trong `stt_bench/engines/`, không dựng harness mới                                                                                           | packet §7, `benchmarks/stt/stt_bench/engines/base.py:40-60` **[V]**                                                                                                |
| C20 | Bẫy: chạy lại scorer với `--limit` **ghi đè** `summary.json` đã ghi nhận                                                                                                                                             | packet §7                                                                                                                                                          |
| C21 | "streaming STT" từng được ghi là **non-goal** có chủ đích của Giai đoạn 4                                                                                                                                            | `development-journey.md:703` **[V]**                                                                                                                               |
| C22 | Postprocess vi hiện **mất thông tin**: model emit ALL-CAPS không dấu câu, `postprocess` lowercase toàn bộ rồi hoa chữ đầu ⇒ danh từ riêng mất hoa (`"tôi đi hà nội"`)                                                | `engines/zipformer_vi.py:34-47` **[V]**                                                                                                                            |

---

## 3. Non-goals

1. **Không** redesign MT, TTS, commit segmenter, UI — trừ đúng chỗ streaming STT ép phải đổi.
2. **Không** đụng extension (Gemini Live) và mobile. `POST /transcribe` **phải giữ nguyên
   contract**, không deprecate: nó phục vụ final, speculation, và các client khác (C18).
3. **Không** tự train / fine-tune / export causal Zipformer cho tiếng Việt. Không khả thi
   trên máy CPU-only trong khung đồ án, và VietASR đã đóng lead weights (§0).
4. **Không** thuê GPU trong phạm vi brainstorm này. GPU chỉ mở ra nếu tiêu chí RTF
   trượt trên CPU (C1), và khi đó là một quyết định riêng.
5. **Không** làm echo cancellation, diarization mới, hay punctuation-restoration model
   riêng. (Nếu Nemotron tự có dấu câu thì đó là phần thưởng, không phải mục tiêu.)
6. **Không** giữ file GGUF. Nó sai runtime cho hướng này; hoặc xoá, hoặc ghi rõ là dead weight.
7. **Không** hứa "streaming đồng nghĩa rẻ CPU hơn". Xem §5.1 — số liệu không ủng hộ.

---

## 4. Acceptance criteria

Tất cả đo bằng `benchmarks/stt/` (C19), subprocess-isolated, seed 42, **cùng bộ 50 câu
VIVOS** và bộ en đã dùng cho C6/C7 — nếu không dùng lại đúng bộ cũ thì con số 5,38 không
so sánh được với gì cả.

### 4.1 Chất lượng — guard bắt buộc, đây là rủi ro lớn nhất

Thay đổi này **có thể làm nhận dạng tệ đi**, và tệ đi một chiều. Số công bố của
Nemotron trên FLEURS-vi là **13,41% @80 ms → 11,18% @1120 ms** **[V]** (model card).
Incumbent là **5,38% trên VIVOS**. Hai bộ test khác nhau nên **không được trừ trực tiếp** —
nhưng khoảng cách quá lớn để bỏ qua.

| Tiêu chí                    | Ngưỡng                                                                                              | Lý do                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** vi WER trên VIVOS-50 | **≤ 8,00 %**                                                                                        | incumbent 5,38 (C6). 8,0 ≈ 1,5× incumbent. Trên mức đó, streaming đang **bán độ chính xác để mua độ trễ** — một từ sai đến sớm hơn thì vô dụng cho simultaneous translation |
| **A2** vi CER trên VIVOS-50 | **≤ 4,50 %**                                                                                        | incumbent 2,90 (C6). CER đọc **cạnh** WER chứ không thay WER: tiếng Việt mang nghĩa ở dấu thanh, WER có thể đứng yên trong khi dấu sụp                                      |
| **A3** vi CER hard-fail     | **> 6,00 % ⇒ loại ngay**, bất kể WER                                                                | Dấu sụp là lỗi không chấp nhận được cho sản phẩm dịch vi↔en                                                                                                                 |
| **A4** en WER               | **≤ 6,00 %**                                                                                        | incumbent 3,86 (C7). Nới rộng hơn vi vì en không có rủi ro dấu                                                                                                              |
| **A5** FLEURS-vi reproduce  | Đo được **11–14 %** trên máy này ở chunk tương ứng                                                  | Nếu không tái lập được số công bố thì mọi ngoại suy VIVOS↔FLEURS đều vô nghĩa. **Đây là phép đo quyết định nhất và rẻ nhất**                                                |
| **A6** Display fidelity     | Chạy `stt_bench/display_fidelity.py` + `scripts/score_display_repair.py` **[V]** trên cả hai engine | Nemotron có punctuation + capitalization **native** **[V]**; incumbent mất danh từ riêng do postprocess (C22). WER chuẩn hoá **giấu** lợi thế này — phải đếm nó vào cán cân |

Nói thẳng: **A1–A3 là nơi phương án này nhiều khả năng chết nhất về mặt sản phẩm.**
Nếu vi WER ra 9–11 % thì câu trả lời trung thực là **không thay**, và đồ án ghi lại
đúng như đã ghi PhoWhisper: _"được ước là đạt RTF, đo thật thì trượt"_
(`development-journey.md:186` **[V]**).

### 4.2 CPU / RTF

| Tiêu chí                                               | Ngưỡng                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A7** RTF streaming @ `num_threads=8` (dev)           | ≤ 0,30 (C5)                                                                                                                                         |
| **A8** RTF streaming @ **`num_threads=4`** (prod, C13) | **≤ 0,30** — đây mới là số phải qua. Đo ở 8 thread rồi deploy ở 4 thread là cách trượt ngưỡng trong im lặng                                         |
| **A9** Net CPU                                         | occupancy/giây-audio **≤ 0,30** để còn là WIN so với break-even ~0,35 (tính ở §5.1)                                                                 |
| **A10** Chunk size                                     | Đo **320 ms và 560 ms**; chọn cái LỚN NHẤT vẫn đạt A11. WER giảm đơn điệu theo chunk (13,41 → 11,18) **[V]**, nên chunk nhỏ là mua latency bằng WER |
| **A11** Độ trễ hiển thị p95 (O1)                       | ≤ **800 ms**, và **chênh lệch p95(giây 15) vs p95(giây 1) ≤ 15 %**                                                                                  |
| **A12** p95 cho câu 5–10 s                             | ≤ 2 s (C5), giữ nguyên ngưỡng luận văn                                                                                                              |

### 4.3 State & RAM (trả lời §6)

| Tiêu chí                                | Ngưỡng                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **A13** RSS mỗi stream thêm vào         | **≤ 25 MB/stream**, đo bằng `PeakRssSampler` (`stt_bench/metrics.py` **[V]**) với 1 / 4 / 8 stream song song |
| **A14** RSS tổng của sidecar ở 4 stream | **≤ 2,5 GB**, còn ≥1,5 GB headroom trong `mem_limit: 4g` (C14)                                               |
| **A15** Weights KHÔNG nhân bản          | Một `OnlineRecognizer` dùng chung, N `OnlineStream`. Chứng minh: RSS(4 stream) − RSS(1 stream) ≤ 4 × A13     |
| **A16** Không rò state                  | Đóng 100 stream liên tiếp ⇒ RSS quay về ±5 % baseline. WS close = teardown, không cần reaper                 |

### 4.4 Tương thích

- **A17** `POST /transcribe` **không đổi contract**, test hiện có
  (`services/local-stt/test_app.py` **[V]**) pass nguyên.
- **A18** Rollback = **một biến môi trường**, không phải một revert. `/stream` thêm
  **bên cạnh** `/transcribe`, engine cũ vẫn load được.
- **A19** Ngôn ngữ **pin được**, không rơi về auto-detect. Kiểm chứng trực tiếp chuỗi
  cảnh báo `prompt_dictionary` đã tìm thấy trong binary (§0) — nếu gói int8 thiếu
  metadata đó thì **A19 FAIL** và phải export lại từ NeMo.

---

## 5. Recommended direction

### 5.1 Trước hết: đối mặt với RTF trade bằng số thật

Packet §4 nói _"a true streaming model decodes each frame once, at flat cost. This is
the strongest ENGINEERING argument for the change."_ **Lập luận đó đúng một nửa và cần
sửa.** Vì `PartialTranscriptScheduler` đã có **duty divisor 3** (C15), chi phí CPU của
pseudo-streaming **đã bị chặn trần rồi** — cái tăng theo cửa sổ là **refresh interval**,
không phải CPU.

Tính occupancy của một lane decode = `d / max(300, 3d)`:

| Cửa sổ | vi `d` | interval | occupancy vi | en `d` | interval | occupancy en |
| ------ | ------ | -------- | ------------ | ------ | -------- | ------------ |
| 1 s    | 22 ms  | 300 ms   | 7,3 %        | 118 ms | 354 ms   | **33,3 %**   |
| 3 s    | 49 ms  | 300 ms   | 16,3 %       | 159 ms | 477 ms   | **33,3 %**   |
| 5 s    | 88 ms  | 300 ms   | 29,3 %       | 236 ms | 708 ms   | **33,3 %**   |
| 8 s    | 114 ms | 342 ms   | **33,3 %**   | 277 ms | 831 ms   | **33,3 %**   |

Duty divisor ép occupancy **≤ 33,3 % theo toán học** ngay khi `d > 100 ms`. Cộng final
decode (vi RTF 0,0158 ⇒ 1,6 %; en 0,040 ⇒ 4,0 %):

**Chi phí hiện tại / giây audio, lượt dài:** vi ≈ **0,35** lane · en ≈ **0,37** lane.
**Lượt ngắn (≤3 s, floor 300 ms còn ăn):** vi ≈ **0,18** lane · en ≈ **0,37** lane.

Streaming tiêu tốn đúng **RTF**, liên tục, và **không còn final decode riêng** (final là
kết quả tích luỹ của stream). Vậy:

> **Break-even RTF ≈ 0,35 cho lượt dài; ≈ 0,18 cho lượt vi ngắn; ≈ 0,37 cho en mọi độ dài.**

**Kết luận về net CPU — trả lời thẳng câu hỏi của packet:**

- **Tiếng Anh: net WIN gần như chắc chắn.** Break-even 0,37, và en đang trả trần 33 %
  ngay từ cửa sổ 1 s. Bất kỳ RTF nào dưới ~0,35 đều rẻ hơn, và còn xoá luôn cái
  456 ms @12 s / 582 ms @15 s phá budget (§4 packet).
- **Tiếng Việt: WIN trên lượt dài, LOSS trên lượt ngắn.** Zipformer rẻ tới mức
  (RTF 0,0158) mà trên lượt ≤3 s tổng chi phí chỉ 0,18 lane — Nemotron ở RTF 0,25 sẽ
  **đắt hơn 39 %**. Vì mục tiêu là simultaneous trên lượt nói liên tục (lượt dài), cán
  cân nghiêng về WIN, nhưng **biên mỏng và phụ thuộc hoàn toàn vào A8**.
- **Nếu RTF@4-thread > 0,35: đây là net LOSS, không phải win.** Và số bên thứ ba duy
  nhất có được (RTF ≈ 0,26–0,30 trên CPU, packet §5b) nằm **ngay trên ngưỡng**. PR
  sherpa báo _"roughly RTF 0.12 for int8 on an M-series Mac"_ **[V]** — Apple silicon,
  không phải x86 4-thread trong container. **Không được coi là số của máy này.**

Một điều chỉnh nhỏ với packet §4: bảng duty ghi _"14 % vi / 40 % en @ cadence 3 s"_.
Tính lại từ đúng công thức ở `partial-transcript-scheduler.ts:109-112` ra **16,3 % /
33,3 %**, và 33,3 % là **trần toán học** nên 40 % không thể đến từ công thức này. Chênh
lệch nhỏ, không đổi kết luận, nhưng ghi lại ở §6.

**Một chi phí bị bỏ sót, có lợi cho streaming:** hiện mỗi lượt có **3** đường decode
(partial + speculation + final, C18). Streaming gộp cả ba thành một. Con số 0,35 ở trên
**chưa tính speculation**, nên chi phí thật của pseudo-streaming cao hơn 0,35. Cần đo.

### 5.2 Ba hướng

#### **Hướng A — Nemotron-3.5 streaming int8 qua `OnlineRecognizer`, MỘT model cho cả vi + en** ⭐

```
sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-{320|560}ms-int8
  → OnlineRecognizer.from_transducer(tokens, encoder, decoder, joiner, num_threads=N)
  → stream = rec.create_stream(); stream.set_option("language", "vi"|"en")
  → accept_waveform(chunk) → while rec.is_ready(stream): rec.decode_stream(stream)
  → rec.get_result(stream)  # emit partial
```

Thay **cả hai** engine hiện tại. Sidecar thêm `WS /stream` **bên cạnh** `/transcribe`.
(`set_option`/`create_stream`/`is_ready`/`get_result` đều **[V]** có trong 1.13.4 đang cài;
key `"language"` là **[I]** — suy từ PR #3671 và docstring đối xứng ở
`offline_recognizer.py:1438` **[V]**, cần xác nhận bằng A19.)

- **Giả định chịu lực nhất:** RTF ≤ 0,30 ở **4 thread x86 trong container** (A8) **VÀ**
  vi WER ≤ 8,0 / CER ≤ 4,5 trên VIVOS-50 (A1–A2).
- **Gãy TRƯỚC ở đâu:** **RTF@4-thread, không phải quality.** Model 600 M params so với
  30 M của incumbent — gấp **20×**. Số CPU bên thứ ba duy nhất (RTF 0,26–0,30) đo ở
  thread count không biết, trên CPU không biết. Prod chỉ có 4 thread và chia 16 core với
  stack dev (C13). Đây là biến duy nhất chưa có số nào của máy này.
- **Gãy thứ nhì, đã có bằng chứng cứng:** chuỗi trong binary **[V]** —
  _"encoder declares prompt_index, but usable prompt_dictionary metadata is missing;
  all languages will fall back to auto"_. Chuỗi đó tồn tại vì nó **đã xảy ra với ai đó**.
  Nếu gói int8 thiếu metadata, không pin được `vi`/`en`, model tự đoán ngôn ngữ trên
  chunk 320–560 ms. Với app dịch vi↔en có code-switching, đó là nguồn lỗi nghiêm trọng.
- **Worst plausible case:** RTF 0,45 @4 thread, vi WER ~10 %, CER ~6 %. Mất 1–2 tuần,
  và có thêm 688 MB weight nằm chết cạnh file GGUF 983 MB đang nằm chết. **Giảm thiểu:
  toàn bộ rủi ro này đo được trong ~1 ngày bằng một benchmark arm, trước khi viết một
  dòng service code.**
- **Được gì nếu qua:**
  1. Ngôn ngữ chính **được** streaming thật — hướng DUY NHẤT làm được điều đó (§0).
  2. **OpenMDW-1.1** **[V]** thay CC-BY-NC-ND-4.0 ⇒ **xoá đúng blocker mà `README.md:348`
     nêu đích danh**. Giá trị này độc lập với streaming và không nhỏ cho luận văn.
  3. Một model thay hai ⇒ DRY, `EngineRegistry` route bằng `set_option` thay vì bằng
     instance, và bỏ được hack postprocess ALL-CAPS (C22).
  4. Punctuation + capitalization native ⇒ transcript vi và en cùng một "giọng" hiển thị.
  5. `result.timestamps` đang bị vứt (C10) trở nên dùng được cho commit segmenter.

---

#### **Hướng B — Streaming chỉ cho tiếng Anh** (sherpa `sherpa-onnx-streaming-zipformer-en-2023-06-26`, **[V]** có thật), vi giữ offline + pseudo

- **Giả định chịu lực nhất:** chỗ đau nằm ở tiếng Anh. Và **giả định này có số ủng hộ**:
  en chạm trần duty 33 % ngay từ cửa sổ 1 s và refresh giãn tới 831 ms, còn vi chỉ chạm
  trần ở cửa sổ 8 s (bảng §5.1). en cũng là bên phá budget ở 12 s/15 s.
- **Gãy TRƯỚC ở đâu:** **ở chính yêu cầu.** Người dùng hỏi streaming STT cho một sản phẩm
  vi↔en mà tiếng Việt là ngôn ngữ chính. Ship English-only nghĩa là luận văn vẫn phải viết
  "STT tiếng Việt là pseudo-streaming". Ngoài ra vi phạm DRY: thành 3 engine trong một sidecar.
- **Worst plausible case:** thêm một engine, thêm một đường code, và câu hỏi gốc vẫn nguyên.
- **Phán quyết: KHÔNG phải câu trả lời.** Giữ lại chỉ như mảnh vá nếu A trượt hoàn toàn
  và vẫn muốn cải thiện chiều en — nhưng nếu A qua, A đã bao gồm en rồi, nên B thừa.
  **B chỉ tồn tại trong nhánh "A fail".**

---

#### **Hướng C — Không đổi model: làm phẳng re-decode bằng stable-prefix commit**

Mở rộng đúng một bước từ **S-A** đã đề xuất ở brainstorm trước
(`plans/reports/brainstorm-260916-0948-simultaneous-streaming-stt-mt-tts.md:371` **[V]**):
khi hai lần re-decode liên tiếp đồng ý về một prefix, **chốt prefix đó VÀ đẩy
`windowStart` qua luôn phần audio đã chốt**, thay vì tiếp tục trượt cửa sổ 8 s.

- **Giả định chịu lực nhất:** prefix hội tụ trong ~2 tick trên tiếng Việt có thanh điệu.
- **Hiệu ứng lên đúng những con số ở §5.1:** cost mỗi tick bị chặn bởi **tail chưa chốt**
  (1–3 s) thay vì cửa sổ 8 s ⇒ vi `d` 22–49 ms, en `d` 118–159 ms. Refresh interval của
  en cải thiện **831 ms → 477 ms**, của vi **342 ms → 300 ms**, và **ngừng suy giảm theo
  độ dài lượt**. Tức là **C đạt được O1 (độ trễ phẳng theo độ dài lượt)**.
- **Nhưng C KHÔNG đạt O2 và O3.** Engine vẫn decode lại tail mỗi tick (O3 fail), và vẫn
  viết lại được toàn bộ tail (O2 fail). Độ trễ sàn vẫn 300–477 ms, không xuống mức chunk.
  Và occupancy en **vẫn 33,3 %** vì divisor vẫn ăn — **C không tiết kiệm CPU cho tiếng Anh.**
- **Gãy TRƯỚC ở đâu:** ở sự trung thực. Luận văn vẫn không được phép viết "streaming STT".
  Và C **không** xoá blocker licence CC-BY-NC-ND (C8).
- **Worst case:** prefix không hội tụ trên tiếng Việt ⇒ commit chậm ⇒ chẳng cải thiện gì,
  nhưng cũng chẳng mất gì.
- **Chi phí:** ~1 file, 0 weight mới, 0 runtime mới, 0 đổi service contract. **Ngày, không phải tuần.**

---

### 5.3 Phương án NHỎ NHẤT thoả contract

**Không phải "triển khai A". Là: MỘT benchmark arm của A, không viết service code.**

Thêm `benchmarks/stt/stt_bench/engines/sherpa_nemotron_streaming.py` (adapter, đúng
convention C19) + một runner biến thể, vì arm streaming **không vừa shape hiện tại**
(`run_engine.py:53-68` **[V]** feed cả utterance một lần; `engines/base.py:54` **[V]**
nhận `wav_path`). Thay đổi tối thiểu, DRY:

- Giữ nguyên `SttEngine.transcribe(wav_path) -> str` cho **WER/CER** — arm streaming đọc
  file rồi **feed từng chunk `chunk_ms`** vào `OnlineStream` nội bộ, trả full text. Toàn
  bộ `text_normalize.py` / `metrics.py` / `report.py` dùng lại **nguyên xi**.
- Thêm **đúng một** method optional `transcribe_incremental(wav_path) -> list[(t_ms, text)]`
  để đo O1/O2 (độ trễ hiển thị, rewrite rate). Engine không có nó thì bỏ qua — offline
  engine vẫn chạy mọi metric cũ. Đây là toàn bộ "what changes" mà packet §7 hỏi.
- **Không đụng `summary.json` cũ** (C20): ghi ra thư mục results mới.

Arm này trả lời **tất cả**: A1–A5 (WER/CER vi+en, FLEURS), A7–A10 (RTF ở 4 và 8 thread,
2 chunk size), A13–A15 (RSS theo số stream), A19 (pin được ngôn ngữ không). **Một ngày.**

Chỉ khi arm PASS mới viết service code, theo thứ tự rẻ→đắt:

1. `engines/nemotron_streaming.py` + `create_stream()` trong sidecar.
2. `WS /stream` **bên cạnh** `/transcribe` (không thay).
3. `LocalSpeechSttProvider.startStream/pushAudio` — **lấp slot đã có sẵn** (C16), không
   tạo interface mới.
4. `LivePreview` chuyển từ "poll buffer" sang "consume events"; `PartialTranscriptScheduler`
   thành no-op cho đường streaming và **giữ nguyên** cho `/transcribe`.

### 5.4 Rẻ nhất để vứt bỏ

1. **Benchmark arm** — một file trong `benchmarks/stt/engines/`, xoá là xong, và kết quả
   đo vẫn là đóng góp hợp lệ cho luận văn kể cả khi kết luận là "không dùng" (đúng khuôn
   mẫu PhoWhisper, `development-journey.md:186` **[V]**).
2. **`WS /stream` thêm bên cạnh `/transcribe`** — rollback là **một env var** (A18), vì
   `/transcribe` và cả 3 caller (C18) chưa hề bị đụng.
3. **Hướng C** — nếu prefix không hội tụ, revert 1 file.

Đắt nhất để vứt bỏ, và vì thế phải làm **cuối cùng**: gỡ Zipformer/Moonshine. **Đừng gỡ.**
Giữ cả hai engine load được sau lưng một env flag ít nhất tới khi có số p95 thật từ prod.
Chi phí giữ chỉ là 641 MB trong ngân sách 4 GB riêng của `local-stt` (C14).

---

### 5.5 Trả lời §6 — per-stream state và hệ quả RAM

Câu hỏi của packet: _"what happens to the memory argument when N live streams each need
their own decoder state?"_

**Trả lời: lập luận RAM ở C12 KHÔNG bị phá, vì sherpa-onnx tách sẵn đúng theo đường đó.**

**[V]** `OnlineRecognizer` có `create_stream()`, `decode_stream()`, **`decode_streams()`**
(batched), `is_ready()`, `reset()`. Mô hình là **một recognizer giữ weights, N `OnlineStream`
mỗi cái chỉ giữ cache**. Đây **chính là** tính chất "zero-memory" mà `base.py:54-57` **[V]**
viện dẫn để biện minh cho semaphore — nó được **bảo toàn**, không bị bỏ.

Ba hệ quả cụ thể:

1. **Weights không nhân bản.** 688 MB nạp **một lần**. Thay cho 223 + 418 = 641 MB hiện
   tại ⇒ **on-disk gần như hoà**, RSS dự kiến +300–500 MB do ONNX arena. Trong
   `mem_limit: 4g` **riêng của local-stt** (C14, không chia với TTS như packet tưởng) —
   thoải mái. Gate: A14.

2. **State mỗi stream là cache-aware cache, nhỏ.** **[I, số học]** FastConformer 0,6 B,
   24 layer, `d_model` ~1024, left-context cache ~70 frame:
   `24 × 70 × 1024 × 4 B ≈ 6,9 MB` + conv cache (nhỏ) ⇒ **~7–15 MB/stream**. Ở 4 lane:
   **~30–60 MB**. Không phải vấn đề RAM. **Nhưng đây là ước tính, không phải đo** — nên
   nó là acceptance criterion A13 (≤25 MB/stream), không phải một tuyên bố.

3. **Semaphore 4 lane GIỮ NGUYÊN, chỉ đổi thứ nó canh.** Hiện lane canh _một request
   decode_. Sau đổi, lane canh _một lần `decode_stream()` trên một chunk_ — ngắn hơn
   nhiều. `OnlineStream` (state) **sống ngoài lane**. Nhờ vậy 4 lane vẫn phục vụ được
   nhiều hơn 4 người nói đồng thời, và `decode_streams([s1..sn])` batched còn **hiệu quả
   hơn** N lần gọi lẻ.

**Một hồi quy hành vi phải nói rõ, không giấu được:** C11 — hiện quá tải thì **từ chối
503**, và từ chối một partial tick là vô hại (lần sau đọc lại). Với streaming, **bỏ một
chunk giữa chừng làm hỏng decoder state**. Nên van 503 phải **dời lên lúc MỞ stream**:
hết lane ⇒ từ chối mở, client rơi về `/transcribe` pseudo-streaming. Fallback đó tự nhiên
và **miễn phí**, vì `/transcribe` không bị gỡ (Non-goal 2). Nhưng nó là thay đổi ngữ nghĩa
thật và phải ghi vào docs.

**Contract mới — khuyến nghị WebSocket, không phải session-id:**

`WS /stream?language=vi` — client gửi binary PCM chunk, server đẩy JSON `{text, isFinal}`.
Lý do là **lifecycle, không phải thẩm mỹ**: tuổi đời connection **bằng** tuổi đời
`OnlineStream`, nên socket close **chính là** teardown (A16). Phương án
`POST /stream/{sessionId}/chunk` cần thêm map, thêm TTL, thêm reaper, và **rò state khi
client biến mất giữa câu** — đúng lớp lỗi orphan mà rule process-management cảnh báo.
WS là KISS ở đây, không phải phức tạp hơn. Và nó DRY: API đã có gateway WS
(`translate.gateway.ts`, `session/stream-socket.ts`) và đã chạy đúng pattern handle→socket
cho Gemini Live (C17), còn `SttProvider` đã **đặt sẵn chỗ** `startStream`/`pushAudio`/
`StreamHandle` với comment tự nhận là _"an optional future path"_ (C16). Không phát minh
gì mới — lấp một chỗ trống đã được thiết kế từ trước.

---

### 5.6 PHÁN QUYẾT — thay model, hay có cách rẻ hơn?

**Có đáng làm streaming STT thật ở đây không? — CÓ, nhưng không vì lý do mà packet nêu,
và chỉ sau một phép đo.**

**Vì sao KHÔNG phải vì CPU.** Packet gọi chi phí re-decode tăng theo cửa sổ là _"the
strongest ENGINEERING argument"_. Số liệu không ủng hộ: duty divisor 3 đã chặn trần
occupancy ở **33,3 %** theo toán học (§5.1). Break-even nằm ở **RTF ≈ 0,35**, và ứng viên
duy nhất có RTF **0,26–0,30** — tốt nhất thì thắng sít sao, và **thua** trên lượt tiếng
Việt ngắn (break-even 0,18). **Bất kỳ ai bán phương án này như "tiết kiệm CPU" đều đang
bán sai.** Cái tăng theo cửa sổ là **độ trễ**, và đó mới là khuyết tật.

**Vì sao VẪN đáng làm.** Bốn lý do, không lý do nào là CPU:

1. **Đây là hướng duy nhất tồn tại cho tiếng Việt.** Đã kiểm chứng đóng cả hai lối khác:
   sherpa không có model vi streaming nào **[V]**; VietASR không phát hành causal
   checkpoint **[V]**. Không có phương án thứ hai để so.
2. **Giá đã sụp.** Blocker "runtime thứ ba" của packet **sai** — sherpa-onnx 1.13.4, đúng
   version repo đang pin, đã hỗ trợ **[V, kiểm chứng trong binary tại chỗ]**, và có sẵn
   gói int8 chính thức. Việc này từ "vài tuần dựng runtime C++" thành **"một benchmark arm"**.
3. **Xoá được blocker licence.** OpenMDW-1.1 thay CC-BY-NC-ND-4.0 — đúng cái
   `README.md:348` nêu tên. Giá trị này **có thật kể cả khi bỏ streaming đi**.
4. **Độ trễ phẳng theo độ dài lượt (O1)** là thứ simultaneous translation thực sự cần,
   và hiện đang hỏng đúng ở lượt dài — nơi live transcript đáng giá nhất.

**Nhưng đặt gate ở đúng chỗ.** Ba con số quyết định, **cả ba đo được trong một ngày,
trước khi viết service code**: **A8** (RTF ≤ 0,30 @ 4 thread), **A1/A2** (vi WER ≤ 8,0 /
CER ≤ 4,5), **A19** (pin được ngôn ngữ). Trượt bất kỳ cái nào ⇒ dừng.

**Nếu trượt, câu trả lời trung thực là:** giữ Zipformer, làm **Hướng C**, và ghi vào luận
văn rằng streaming STT đã được **đo và từ chối** — kèm số. Đó không phải thất bại; đó là
đúng khuôn mẫu repo này đã dùng cho PhoWhisper (`development-journey.md:186` **[V]**) và
cho streaming TTS callback (`:916-925` **[V]**: _"có API, nhưng vô dụng... tiết kiệm 0 ms"_).
Một phép đo phủ định, ghi lại tử tế, là đóng góp hợp lệ.

**Và nói rõ điều này với người dùng ngay từ đầu:** Hướng C cho bạn **O1** — độ trễ ngừng
xấu đi theo độ dài câu, tức **phần lớn lợi ích cảm nhận được** — với chi phí một file và
zero rủi ro chất lượng. Nó **không** cho bạn quyền gọi đó là streaming thật, và không xoá
blocker licence. Nếu điều quan trọng là _trải nghiệm_, C có thể đã đủ. Nếu điều quan trọng
là _tuyên bố trong luận văn_ + _licence_, thì phải là A. **Đó là hai mục tiêu khác nhau và
người dùng nên chọn một cách có ý thức, chứ không để lẫn.** Rẻ nhất: chạy arm A (1 ngày)
**song song** với ship C (1 ngày) — C không chặn A, và nếu A trượt thì C đã ở đó rồi.

---

## 6. Unresolved questions

1. **RTF của Nemotron int8 ở 4 thread, x86, trong container — bao nhiêu?** Chưa có bất kỳ
   số nào cho cấu hình này. Số duy nhất từ maintainer là ~0,12 trên M-series Mac **[V]**,
   kiến trúc khác hẳn. **Đây là biến quyết định và chưa ai đo.**
2. **Khoảng cách VIVOS ↔ FLEURS cho tiếng Việt là bao nhiêu?** Toàn bộ phép so 5,38 vs
   11,18–13,41 treo trên câu này. A5 giải quyết, nhưng cần dataset FLEURS-vi mà
   `benchmarks/stt/scripts/prepare_datasets.py` hiện chưa chuẩn bị — phải xem thêm bao nhiêu công.
3. **Gói int8 chính thức có `prompt_dictionary` metadata không?** Chuỗi cảnh báo trong
   binary **[V]** chứng tỏ trường hợp thiếu đã xảy ra thật. Nếu thiếu ⇒ không pin được
   `vi`, phải tự export lại từ NeMo — việc đó cần GPU/PyTorch và **phá vỡ constraint C1**.
4. **Chunk size nào?** 320 ms (WER 12,29) hay 560 ms (WER 11,78)? Chênh 0,5 điểm WER đổi
   lấy 240 ms độ trễ. Đây là trade-off sản phẩm, không phải kỹ thuật — cần người dùng quyết.
5. **Nemotron có tốt hơn Moonshine cho tiếng Anh không?** Incumbent en 3,86 % là rất tốt.
   Nếu Nemotron ra 6–7 % en, có chấp nhận **hồi quy tiếng Anh** để đổi lấy DRY một model?
   Hay giữ Moonshine cho en (offline) + Nemotron cho vi (streaming) — mất DRY, +418 MB,
   và vẫn chỉ một ngôn ngữ streaming?
6. **Chi phí CPU của `turn-speculation` là bao nhiêu?** Nó là đường decode thứ ba mỗi lượt
   (C18) và **chưa nằm trong** con số 0,35 ở §5.1. Chi phí thật của pseudo-streaming cao
   hơn đã tính, nghĩa là cán cân nghiêng về streaming nhiều hơn — nhưng chưa biết bao nhiêu.
7. **Bảng duty của packet §4 ghi "40 % en"**, tính lại từ công thức ra trần 33,3 %. Con số
   40 % đo bằng mẫu số nào? Không đổi kết luận, nhưng nếu nó là số đo thật trên máy đã tải
   thì có nghĩa `d` thực tế cao hơn bảng re-decode — đáng biết.
8. **File GGUF 983 MB xử lý thế nào?** Nó sai runtime cho hướng này. Xoá, hay giữ như
   chứng cứ của một nhánh nghiên cứu đã đóng? (Khuyến nghị: xoá, ghi một dòng vào journey.)
9. **`result.timestamps` (C10) có nên dùng luôn không?** Streaming transducer cho timestamp
   miễn phí và commit segmenter đang cần ranh giới audio. Nhưng đó là **MT/segmenter scope**
   mà packet §2 cấm redesign. Chỉ ghi nhận là cơ hội, không kéo vào.
