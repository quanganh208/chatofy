# Hành trình thực hiện — Chatofy

Dự án: **Chatofy** — ứng dụng dịch giọng nói hai chiều vi↔en (đồ án tốt nghiệp).
Máy đích mọi phép đo: **i7-11700K, 8 nhân vật lý / 16 luồng, 32 GB RAM, Windows
11, CPU-only, không GPU**.

Tài liệu này là **bản ghi hợp nhất** của toàn bộ nghiên cứu, benchmark, quyết
định thiết kế và số đo — gộp từ 12 report rời (brainstorm, benchmark, advisory,
delivery, phase, báo cáo tuần) đã dọn sau khi gộp. Mọi con số dưới đây là **đo
thật**, không ước lượng, trừ chỗ ghi rõ là ước lượng.

Mục đích: nguồn duy nhất để viết báo cáo đồ án — chương phương pháp, chương thực
nghiệm, chương kết quả, và phần bài học.

---

## 1. Bài toán và kiến trúc

**Bài toán.** Dịch hội thoại nói vi↔en với độ trễ đủ thấp để cảm thấy tự nhiên,
chạy được trên máy phổ thông không GPU.

**Điểm xuất phát (trước 18/07/2026).** Dịch theo lượt qua REST: bấm nút ghi âm →
gửi file → chờ → nghe kết quả. STT và TTS đều gọi cloud ElevenLabs. Chỉ TTS tiếng
Việt là local (sidecar VieNeu).

**Điểm kết thúc (26/07/2026).** Hội thoại rảnh tay qua WebSocket: nói tự nhiên,
không nút; chữ nguồn chạy trong lúc nói; chữ dịch tạm chạy theo sau; audio dịch
phát ~0,9 s sau khi dứt lời. Toàn bộ nhận dạng + tổng hợp giọng nói chạy local
trên CPU, không API key.

```
apps/web (Next.js)  ──WebSocket /ws/translate──> apps/api (NestJS)
                                                    │
                             ┌──────────────────────┼───────────────────────┐
                             │                      │                       │
                    services/local-stt :8002   services/local-tts :8003   Gemini (cloud)
                    Zipformer-30M (vi)         Kokoro-82M (en)           dịch máy
                    Moonshine base (en)        VieNeu v3 (vi)
                    sherpa-onnx + PyAV         sherpa-onnx + VieNeu
```

`POST /translate` (REST, đồng bộ) **giữ nguyên hành vi** tại trang
`/translate/baseline` — là **đối chứng đo đạc cho luận văn**, không được sửa.

**Hệ thống chưa offline hoàn toàn:** dịch máy vẫn là Gemini cloud. Chỉ speech là
local.

---

## 2. Dòng thời gian

| Mốc | Ngày     | Nội dung                                          | Kết quả                                                       |
| --- | -------- | ------------------------------------------------- | ------------------------------------------------------------- |
| 1   | 18/07    | Nghiên cứu + benchmark model STT/TTS chạy CPU     | Chốt Zipformer-30M (vi), Moonshine base (en), Kokoro-82M (en) |
| 2   | 23–24/07 | Tích hợp speech local vào pipeline thật           | 2 sidecar, 2 provider, `local` thành mặc định                 |
| 3   | 24/07    | Chọn model Gemini theo quota thay vì theo "tier"  | Hết chết cả phiên demo khi 1 model cạn quota                  |
| 4   | 25/07    | Spike đo độ trễ + dựng luồng WebSocket realtime   | Ngân sách trễ đo thật ≈1,13 s                                 |
| 5   | 25–26/07 | Sửa bug head-start, chữ nguồn live, chữ dịch live | p50 907 ms · p95 1582 ms                                      |

---

## 3. Giai đoạn 1 — Chọn model speech bằng benchmark (18/07)

### 3.1 Ràng buộc đặt trước khi nghiên cứu

- Phần cứng: Windows, 8 nhân vật lý, 32 GB RAM, **CPU-only**.
- Độ trễ: ≤2 s cho câu 5–10 s ⇒ **RTF ≤ 0,3**; batch (turn-based), chưa cần streaming.
- 2 model chuyên biệt (vi riêng, en riêng) — registry đã route theo ngôn ngữ.
- Tích hợp theo pattern sidecar Python FastAPI + uv (như `services/vieneu-tts`).
- License dùng được cho đồ án học thuật; ghi rõ nếu non-commercial.

### 3.2 Phương pháp — research → benchmark → quyết định

Không chọn model theo số công bố. Quy trình 3 bước, lặp 2 vòng trong ngày
(một vòng cho STT, một vòng cho TTS):

1. Khảo sát ứng viên qua paper / model card / benchmark cộng đồng (2025–2026).
2. Xây benchmark harness **tái lập được**, đo trên **đúng máy đích**.
3. Quyết định theo ngưỡng định lượng đặt trước; TTS thêm bước nghe A/B chủ quan.

Harness: 2 project Python độc lập `benchmarks/stt/`, `benchmarks/tts/`. Mỗi engine
chạy trong **subprocess riêng** (cách ly RAM, không tranh CPU), 1 lượt warm-up
không tính giờ, chạy 2 lần để kiểm variance, tham số decode + số luồng ghi vào
kết quả để tái lập. Harness là measurement-only — README ghi rõ "never imported
by the app".

Bộ test: **VIVOS test** (vi, CC BY-NC-SA 4.0) và **LibriSpeech test-clean** (en,
CC BY 4.0), 50 câu mỗi ngôn ngữ, seed 42. Chuẩn hoá WER: NFC, hạ chữ thường, bỏ
dấu câu, **giữ dấu tiếng Việt**; số viết như đọc.

### 3.3 Ứng viên STT đã khảo sát (số công bố / ước lượng, trước khi đo)

| Model                           | Lang | Params  | WER công bố           | RTF                  | RAM        | License       | Engine                |
| ------------------------------- | ---- | ------- | --------------------- | -------------------- | ---------- | ------------- | --------------------- |
| Zipformer-30M-RNNT-6000h (hynt) | vi   | 30M     | 7,97% VLSP2025        | 0,025                | ~150MB     | CC-BY-NC-ND ✗ | sherpa-onnx           |
| PhoWhisper-small (VinAI)        | vi   | 244M    | 11,08% VIVOS          | ~0,15–0,3 (ước)      | ~600MB     | BSD-3 ✓       | faster-whisper INT8   |
| PhoWhisper-base                 | vi   | 74M     | 16,19%                | ~0,1–0,2 (ước)       | ~300MB     | BSD-3 ✓       | faster-whisper        |
| wav2vec2-base-vi-250h           | vi   | 95M     | 6,15% (cần 4-gram LM) | 0,165                | ~250MB     | CC-BY-NC ✗    | transformers/ONNX     |
| Whisper-small multilingual      | vi   | 244M    | kém PhoWhisper        | ~0,78 → **trượt**    | ~600MB     | MIT ✓         | faster-whisper        |
| Moonshine tiny/base             | en   | 27M/61M | ~7,8% avg             | ~0,07–0,27           | ~200–800MB | MIT ✓         | ONNX RT / sherpa-onnx |
| whisper.cpp small.en Q4/Q5      | en   | 244M    | 3,05% LibriSpeech     | ~0,1–0,2 (ngoại suy) | ~150–400MB | MIT ✓         | whisper.cpp           |
| Zipformer-en transducer         | en   | ~273M   | ~8%                   | ~0,167               | ~270MB     | Apache-2.0 ✓  | sherpa-onnx           |
| Parakeet TDT 0.6B               | en   | 600M    | top leaderboard       | ~1,38 → **trượt**    | —          | CC-BY-4.0     | NeMo/ONNX             |
| Vosk en                         | en   | nhỏ     | 12–14% — kém          | ~0,3                 | thấp       | Apache-2.0    | vosk                  |

**Model đa ngữ một-cho-tất-cả: không khả thi.** Whisper large-v3/turbo quá chậm
trên CPU; Parakeet v3 không có tiếng Việt; Moonshine chỉ có en. Quyết định "2
model chuyên biệt" được nghiên cứu xác nhận là đúng.

Ba phương án đã cân nhắc: **A** — sherpa-onnx 1 runtime 2 model (khuyến nghị);
**B** — faster-whisper 1 runtime, license sạch 100% nhưng RTF chưa chứng minh;
**C** — best-of-breed 2 runtime khác nhau (loại: vi phạm KISS khi A đã đủ).
User chốt: **benchmark cả A và B trước, chưa implement gì vào app.**

### 3.5 Kết quả benchmark STT (50 câu/ngôn ngữ)

Tiếng Việt:

| Engine                  | WER %    | RTF (pooled) | p50 s | p95 s | RAM đỉnh | Load s |
| ----------------------- | -------- | ------------ | ----- | ----- | -------- | ------ |
| **sherpa-zipformer-vi** | **5,38** | **0,017**    | 0,07  | 0,09  | 223 MB   | 0,95   |
| fw-phowhisper-vi        | 7,71     | 0,332        | 1,33  | 1,40  | 972 MB   | 1,35   |

Tiếng Anh:

| Engine                  | WER %    | RTF (pooled) | p50 s | p95 s | RAM đỉnh | Load s |
| ----------------------- | -------- | ------------ | ----- | ----- | -------- | ------ |
| **sherpa-moonshine-en** | 3,86     | **0,040**    | 0,22  | 0,34  | 418 MB   | 1,25   |
| fw-whisper-small-en     | **3,74** | 0,228        | 1,28  | 1,47  | 552 MB   | 0,85   |

Ma trận quyết định (ngưỡng: RTF ≤ 0,3 · p95 ≤ 2 s):

| Engine              | Lang | RTF      | p95  | License                         |
| ------------------- | ---- | -------- | ---- | ------------------------------- |
| sherpa-moonshine-en | en   | PASS     | PASS | MIT                             |
| fw-whisper-small-en | en   | PASS     | PASS | MIT                             |
| sherpa-zipformer-vi | vi   | PASS     | PASS | CC-BY-NC-ND-4.0 (academic only) |
| fw-phowhisper-vi    | vi   | **FAIL** | PASS | BSD-3-Clause                    |

Variance giữa 2 lần chạy (RTF pooled): zipformer-vi 5,0% · moonshine-en 0,6% ·
whisper-small-en 0,0% · phowhisper-vi 0,4%.

Tham số decode (để tái lập): tất cả `num_threads: 8`, `greedy_search`, INT8.
Zipformer = `hynt/Zipformer-30M-RNNT-6000h` (encoder/decoder/joiner
epoch-20-avg-10 int8). Moonshine = `sherpa-onnx-moonshine-base-en-int8`.
PhoWhisper = `diepho/PhoWhisper-small-ct2` (`beam_size: 1`). Whisper =
`Systran/faster-whisper-small.en`.

**Quyết định:** Stack A thắng dứt khoát. Tiếng Việt: Zipformer thắng PhoWhisper
**cả hai trục** — WER 5,38% vs 7,71% **và** RTF 0,017 vs 0,332 (nhanh ~20×, RAM
1/4). PhoWhisper-small INT8 **trượt** ngưỡng RTF trên máy này. Tiếng Anh:
Moonshine ngang whisper small.en về WER (chênh 0,12 điểm, trong nhiễu) nhưng
**nhanh 5,7×**; chọn Moonshine để có dư địa và để cùng một runtime với slot vi.

Cloud baseline (ElevenLabs Scribe v2) bỏ qua trong lần này vì thiếu API key trong
shell benchmark — không ảnh hưởng quyết định (ngưỡng là tuyệt đối). Số so sánh
cloud↔local được đo sau, ở giai đoạn 2 (mục 4.4).

### 3.6 Kết quả benchmark TTS tiếng Anh (30 câu, 5–20 từ)

| Engine               | mean s | p50 s | p95 s    | RTF   | audio TB | RAM đỉnh | Load s |
| -------------------- | ------ | ----- | -------- | ----- | -------- | -------- | ------ |
| sherpa-piper-en      | 0,45   | 0,45  | **0,57** | 0,154 | 2,9 s    | 323 MB   | 1,61   |
| **sherpa-kokoro-en** | 0,97   | 0,99  | 1,18     | 0,323 | 3,0 s    | 619 MB   | 1,07   |

Variance: kokoro 1,1% · piper 0,5%. Cả hai PASS ngưỡng p95 ≤ 2 s.
Kokoro = `kokoro-en-v0_19` (sid 0, speed 1.0, 8 luồng), Apache-2.0.
Piper = `vits-piper-en_US-lessac-high`, MIT.

**Phán quyết A/B chủ quan (user, 18/07):** nghe 4 cặp WAV (s001/s003/s015/s027)
và chọn **Kokoro-82M** — khoảng cách chất lượng đáng để đổi lấy thêm độ trễ.
Đây là phán quyết một người nghe; mini-MOS nhiều người là hướng nâng độ chặt chẽ
cho luận văn.

**Quyết định:** Kokoro-82M là model TTS tiếng Anh. Apache-2.0 (sạch cho cả
thương mại). Piper ghi nhận là **phương án dự phòng latency-first** (p95 0,57 s,
MIT) nếu sau này độ trễ quan trọng hơn chất lượng.

### 3.7 Phát hiện phương pháp luận (giá trị cho chương thực nghiệm)

**Số liệu công bố sai lệch ở cả hai chiều, trong cùng một ngày:**

- PhoWhisper-small được ước là đạt RTF, **đo thật thì trượt** (0,332 > 0,3).
- Zipformer đo được **0,017**, nhanh hơn cả con số 0,025 được trích dẫn.
- Kokoro đo trên máy 8 nhân **nhanh hơn hẳn** số công bố (đo trên 4 nhân EPYC) —
  vượt qua ngưỡng 2 s mà nghiên cứu ban đầu lo sẽ trượt.

Kết luận: với bài toán chọn model chạy CPU, **benchmark trên đúng phần cứng đích
là bắt buộc**; số ước lượng không dùng để quyết định được.

### 3.8 Sự cố kỹ thuật đã xử lý

- **Segfault không traceback trên Windows.** Wheel sherpa-onnx không kèm
  `onnxruntime.dll`; Windows load nhầm ORT 1.17.1 trong System32 (Windows ML) →
  abort cứng do lệch C-API, không có traceback Python. Truy nguyên bằng logging
  không đệm + rà DLL; **fix: preload DLL của venv qua ctypes trước mọi import
  onnxruntime**. Cơ chế này được port sang cả 2 sidecar sau đó.
- Repo HF của Zipformer thiếu `tokens.txt` → tự sinh từ `bpe.model`
  (sentencepiece).
- VIVOS đổi đường dẫn tarball trên HF (root 404), mirror gốc AILAB chết → cập
  nhật URL + fallback, cache local, URL ghim trong manifest.

### 3.9 Nghĩa vụ license (phải ghi trong luận văn + README)

| Model                       | License             | Ghi chú                                                                                                                                        |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Zipformer-30M-RNNT (vi STT) | **CC-BY-NC-ND-4.0** | **Chỉ học thuật**, cấm thương mại. Đường thay thế nếu thương mại hoá: PhoWhisper (BSD-3) qua cùng contract `SttProvider`, chấp nhận ~1,3 s/câu |
| Moonshine base (en STT)     | MIT                 | sạch                                                                                                                                           |
| Kokoro-82M (en TTS)         | Apache-2.0          | sạch                                                                                                                                           |
| Piper lessac-high           | MIT                 | dự phòng                                                                                                                                       |
| VIVOS (bộ test)             | CC BY-NC-SA 4.0     | chỉ dùng để đo                                                                                                                                 |
| LibriSpeech (bộ test)       | CC BY 4.0           | chỉ dùng để đo                                                                                                                                 |

### 3.10 So sánh decoder trên tiếng Việt (28/08)

Engine tiếng Việt đang ship giải mã `greedy_search`, không có biasing ngữ cảnh.
Câu hỏi để mở từ 18/07: beam search và hotword biasing mua được gì? Đo trên đúng
bộ 50 câu VIVOS cũ, cùng một phiên, chỉ thay decoder — model, INT8 và
`num_threads: 8` giữ nguyên.

| Nhánh                             | WER %    | CER %    | RTF (pooled) | p50 s | p95 s | RAM đỉnh |
| --------------------------------- | -------- | -------- | ------------ | ----- | ----- | -------- |
| `...-vi-greedy` (đối chứng)       | 5,38     | 2,90     | **0,0158**   | 0,065 | 0,088 | 211 MB   |
| `...-vi-beam`                     | 5,38     | 2,94     | 0,0207       | 0,079 | 0,117 | 212 MB   |
| `...-vi-beam-hotwords` (**trần**) | **4,66** | **2,73** | 0,0211       | 0,084 | 0,117 | 211 MB   |

**Beam search không mua được gì.** WER đứng yên đúng 5,38; CER **xấu đi** 0,04
điểm; giá phải trả là RTF 1,31×. Beam đổi 3/50 câu: 1 tốt lên, 1 xấu đi, 1 đổi lỗi
này lấy lỗi khác — đúng hình dạng của một kết quả rỗng, không phải một cải thiện nhỏ.

**Hotwords mua 0,72 điểm WER — nhưng không phải con số sẽ gặp khi chạy thật.** Đo
riêng so với nhánh beam (giữ nguyên decoder): 3 câu đổi, **3 tốt lên, 0 xấu đi**, và
mọi cải thiện đều truy được về một cụm có trong danh sách. Danh sách 48 cụm ấy
**sinh ra từ chính câu tham chiếu của bộ test** — nó mã hoá thứ kiến thức mà hội
thoại trực tiếp không có.

Nhưng nó cũng **không phải trần**, và nhánh này không đo được trần: có 81 cụm đủ
điều kiện, mức chặn 48 giữ lại 48 cụm đầu **theo thứ tự file**. Kết quả đo: 24/50
câu thực sự có cụm trong danh sách, 16/50 câu sẽ được bias nếu bỏ mức chặn, 10/50
câu không đủ điều kiện dù chặn hay không. Tức **16 câu nằm ngay trong nhánh "trần"
với tư cách đối chứng không bias**. Vậy −0,72 điểm là **cận dưới** của thứ một danh
sách oracle có thể mua, không phải cận trên. Chỉ được trích kèm đúng nhãn: "nhiều
nhất mà **danh sách 48 cụm này** mua được".

Mức chặn 48 vẫn là lựa chọn đúng cho một danh sách **có thể ship** — nó khớp
`MAX_HOTWORDS = 48` của khối context phía MT, nên một danh sách từ vựng có thể nuôi
cả hai đầu. Đo trần thật thì cần cả 81 cụm, và đó là một lần chạy khác.

Cả ba nhánh vẫn cách ngưỡng RTF 0,3 khoảng **14×**. Chi phí chưa bao giờ là lý do
để ở lại greedy — và giờ cũng không phải lý do để rời khỏi nó. **Không đổi mặc định
nào**: `services/local-stt/engines/zipformer_vi.py` vẫn greedy. Quyết định ở lại
greedy nay có số làm chứng thay vì là mặc định chưa ai hỏi tới.

Nhánh đối chứng dựng lại **số tổng hợp** của r1 (WER 5,38 · CER 2,90) nhưng **không**
dựng lại r1 theo từng câu: 2/50 giả thuyết khác nhau, lệch ngược chiều nhau nên WER
toàn tập rơi đúng vào cùng một số. Cùng `decode_params`, nhưng r1 ghi 0,952 s load /
223,3 MB so với 0,531 s / 211,4 MB lần này, và r1 với r2 giống nhau y hệt cả 50 câu —
nên đây là **trôi giữa hai phiên đo, không phải bất định từng lần chạy**, và 2 câu đổi
là cùng bậc với 3 câu mà nhánh beam làm đổi. RTF cũng trôi: 0,0158 so với 0,0169
(6,9%, so với mức 5,0% đã ghi giữa r1 và r2). Cả hai chính là lý do các nhánh được so
với một đối chứng **cùng phiên** thay vì so với r1. r1/r2 và engine id đang ship không
bị ghi đè.

Mục này đo ngày 28/08, đặt trong chương benchmark của giai đoạn 1 vì cùng một bộ
test và cùng một câu hỏi chọn model, không phải vì cùng ngày.

Cỡ mẫu: 50 câu / 558 từ tham chiếu. 0,72 điểm WER = **4 từ**. Hướng thì sạch (3/3
cải thiện, 0 hồi quy), nhưng độ lớn thì không chính xác — bộ này quá nhỏ để phân
biệt −0,7 với −0,4.

Chi tiết + từng câu đổi: `plans/reports/decoder-260828-1000-vi-decoder-comparison.md`.

### 3.11 Giọng thật: đường thu quyết định, không phải model (28/08)

Cùng một câu, cùng một người nói, cùng model và cùng cấu hình đang ship — chỉ
khác đường thu âm.

| Bản thu  | Đường thu           | WER (ref nói) % | CER % | WER (ref viết) % | chữ số | dấu câu | hoa danh từ riêng |
| -------- | ------------------- | --------------- | ----- | ---------------- | ------ | ------- | ----------------- |
| `take-a` | app nhắn tin (Opus) | 14,9            | 9,0   | 31,7             | 0      | 0       | 0                 |
| `take-b` | app nhắn tin (Opus) | 17,0            | 11,9  | 39,0             | 0      | 0       | 0                 |
| `take-c` | ghi âm iPhone       | **4,3**         | 2,4   | 26,8             | 0      | 0       | 0                 |

Ba kết luận, và cả ba đều đáng đưa vào chương thực nghiệm:

**1. Đường thu đáng giá gấp ~4 lần sai số của chính model.** 17,0% so với 4,3%
trên cùng một câu, model không đổi. Không đòn bẩy nào trong ngân sách decoder mua
được khoảng chênh 12,7 điểm đó — §3.10 đo đòn bẩy tốt nhất hiện có ở **0,72
điểm, mà còn phải dưới một danh sách hotword biết trước đáp án**. `take-c` ở
4,3% còn **thấp hơn cả số headline 5,38% của VIVOS**, trên giọng thật chưa từng
thấy và có danh từ riêng. Model không phải chỗ nghẽn.

**2. Lỗi rơi vào chỗ tín hiệu kém, không phải chỗ từ vựng khó.** `Hồ Chí Minh`,
`Ba Đình`, `Cộng hòa xã hội chủ nghĩa Việt Nam` đúng ở cả ba bản. Cái mất là hư
từ không trọng âm và động từ `đọc` (`đọc Tuyên ngôn` → `lập thành` / `độc quy
mô`). Đây đúng là kiểu lỗi mà hotword ít giúp được nhất, vì từ bị mất là từ phổ
thông, không danh sách thiên lệch nào chứa.

**3. Riêng dạng chữ số tốn 9 lỗi từ trong một câu.** `take-c` sai 2 từ so với ref
nói và 11 từ so với ref viết; toàn bộ 9 lỗi chênh là cái ngày tháng: `2 9 1945`
(3 token) so với `mùng hai tháng chín năm một chín bốn lăm` (9 token). Chấm điểm
ref nói **nguyên văn** so với ref viết — tức một bộ nhận dạng không sai gì cả —
tách được phần chi phí chữ số ra khỏi 2 lỗi của riêng `take-c`:

| giả thuyết, chấm với ref viết   | S   | D   | I   | tổng | WER       |
| ------------------------------- | --- | --- | --- | ---- | --------- |
| `take-c` (4,3% so với ref nói)  | 5   | 0   | 6   | 11   | **26,8%** |
| bộ nhận dạng hoàn hảo (ref nói) | 3   | 0   | 6   | 9    | **22,0%** |

Nói cách khác: **một bộ nhận dạng đạt 4,3% WER trên ref nói vẫn bị 26,8% trên
tiếng Việt viết, và một bộ hoàn hảo vẫn bị 22,0%** — 22 điểm đó là cái ngày
tháng, không phải gì khác.

Chữ số, dấu câu và chữ hoa danh từ riêng đều bằng **0 ở cả ba bản**, độc lập với
chất lượng audio. Lỗi hiển thị không phải lỗi âm thanh; micro tốt hơn không sửa
được nó. Đây là lý do phải có thước đo riêng
(`benchmarks/stt/stt_bench/display_fidelity.py`) thay vì tin vào bảng WER.

Cỡ mẫu: 1 câu, 3 bản thu, 1 người nói. 47 từ nên **1 từ sai ≈ 2,1 điểm WER**.
Hướng thì sạch; độ lớn thì không. Và hai đường thu khác nhau ở nhiều biến cùng
lúc (codec, bitrate, xử lý riêng của app) — đủ để xếp hạng đòn bẩy, không đủ để
chỉ ra nút nào.

**Chưa trả lời:** đường thu của trình duyệt — cái thực sự ship — nằm gần bản
iPhone hay gần bản app nhắn tin? Không bản thu nào ở đây đi qua trình duyệt.

Chi tiết: `plans/reports/capture-260828-1114-real-voice-capture-chain-vs-recognizer.md`.

### 3.12 Baseline hiển thị: nhận dạng hoàn hảo, hiển thị bằng 0 (28/08)

Bộ đo riêng cho thứ WER không nhìn thấy. 22 câu tiếng Việt, giọng người dùng, thu
qua **đúng đường thu của trình duyệt** mà sản phẩm dùng (cùng AGC / khử ồn /
khoảng cách micro), tham chiếu viết bằng chính tả thật. 115,2 giây, 311 từ.

Chấm với đầu ra **đang ship** (Zipformer INT8, greedy, `postprocess()` nguyên văn):

| Chỉ số               | Baseline   | Mẫu số                   |
| -------------------- | ---------- | ------------------------ |
| recall chữ số        | **0,0000** | 0 / 42 chữ số            |
| chữ số bịa ra        | **0**      | —                        |
| F1 dấu câu           | **0,0000** | ref 39 dấu, giả thuyết 0 |
| hoa danh từ riêng    | **0,0000** | 0 / 22 nhận ra           |
| độ phủ danh từ riêng | 0,8800     | 22 / 25 khai báo         |

Không một chữ số, dấu câu hay chữ hoa nào sống sót tới màn hình. Số 0 ở đây là
**cấu trúc**, không phải sát ngưỡng — không có điểm lẻ nào để bào mòn.

**Kết quả đáng giá nhất đến từ phép tách rất rẻ.** Chia bộ theo việc câu tham
chiếu có chữ số hay không thì tách được chi phí hiển thị khỏi lỗi nhận dạng, mà
không cần viết tay tham chiếu dạng nói:

| Tập con         | Số câu | WER so với tham chiếu viết |
| --------------- | ------ | -------------------------- |
| có chữ số       | 20     | 54,84%                     |
| không có chữ số | 2      | **0,00%**                  |

Hai câu không chữ số được nhận dạng **đúng từng từ** — và vẫn đạt **0 trên cả ba
chỉ số hiển thị**: `hà nội`, `đà nẵng`, `trường sa`, `hoàng sa`, `việt nam` đều
thường, không dấu phẩy, không dấu chấm cuối.

Đó là luận điểm của cả chương gói trong hai câu: **nhận dạng hoàn hảo, hiển thị
bằng không.** Hai thuộc tính trực giao nhau, nên không phần việc nào về bộ nhận
dạng — decoder, đổi model, hay micro tốt hơn — dịch chuyển được con số này.

Vì vậy con số 50,75% WER toàn tập gần như hoàn toàn là **dạng chữ số**, không
phải lỗi. Trích nó thì phải kèm phép tách ở trên; đứng một mình nó đọc như một
bộ nhận dạng hỏng, trong khi bộ nhận dạng không hỏng.

Hạn chế phải ghi kèm: 1 người nói, 22 câu — nêu cỡ mẫu cạnh mọi con số. Trang ghi
âm có hiển thị `track.getSettings()` nhưng **không ghi vào manifest**, nên sau
này không chứng minh lại được là trình duyệt có thật sự bật đủ ba ràng buộc hay
không; cái dữ liệu chứng minh được là audio tốt (hai câu 0,00% WER).

Tái lập: `benchmarks/stt/` — `uv run python scripts/run_display_baseline.py`.
Audio là dữ liệu cá nhân, **không commit**, nên số liệu không tái lập độc lập được.

### 3.13 Sửa hiển thị: ba số 0 đã dịch chuyển, và giá của phép đo (28/08)

Mỗi lượt nói xong phát **một** request riêng trên `gemma-4-31b-it`, hoàn toàn
ngoài đường audio. Nó viết lại **câu gốc** bằng chính ngôn ngữ đó — dấu câu, chữ
hoa, chữ số — **không đổi một từ nào**, và bị từ chối thẳng nếu đổi.

| Chỉ số            | Baseline | Sau sửa    | Ngưỡng |
| ----------------- | -------- | ---------- | ------ |
| recall chữ số     | 0,0000   | **0,8810** | ≥0,85  |
| F1 dấu câu        | 0,0000   | **0,7222** | ≥0,70  |
| hoa danh từ riêng | 0,0000   | **0,8636** | ≥0,80  |
| chữ số bịa ra     | 0        | **0**      | —      |

Chấm trên cái **người đọc thật sự thấy**: 2/22 bản sửa bị bộ chặn từ chối và rơi
về văn bản thô, nên hoa danh từ riêng là 0,8636 chứ không phải 1,0000 mà model
tự đạt được. Đó là cái giá của bộ chặn, ghi đúng giá.

#### Phát hiện đáng mang vào luận văn

Lần chấm **đầu tiên** ra recall 0,6429 với **26 chữ số bịa ra**. Nhưng toàn bộ 15
chỗ thiếu và 26 chỗ thừa đều là **quy ước định dạng**, không phải số bịa:

| tham chiếu | bản sửa đầu                    |
| ---------- | ------------------------------ |
| `17:00`    | `17 giờ`                       |
| `6:45`     | `6 giờ 45 phút`                |
| `2/9/1945` | `ngày mùng 2 tháng 9 năm 1945` |

Đều là tiếng Việt viết đúng. **Không một con số nào bị bịa.** Prompt bảo "viết số
như khi viết" mà không nói sản phẩm này dùng quy ước nào trong nhiều quy ước hợp
lệ — nên model chọn quy ước khác, và thước đo tính sai hai lần: một lần thiếu,
một lần thừa. Đúng cái bẫy `README` của benchmark đã cảnh báo, và ở đây nó là
toàn bộ tín hiệu.

Nói rõ quy ước trong prompt: recall **0,64 → 0,88**, số bịa **26 → 0**.

**Một quy ước mà chỉ một bên biết thì không phải quy ước.**

#### Bộ chặn diễn giải sai (`repair-divergence.ts`)

Ngưỡng là **0**, và đó là số đo chứ không phải lập trường: cả 22 bản sửa đều có
residual đúng bằng 0,0000 sau khi miễn trừ phần chuyển chữ-sang-số, nên không có
dung sai nào để mua. Ba lỗi câm phải sửa trước khi nó chạy đúng:

1. `[^\W\d_]` trong JavaScript **chỉ nhận ASCII** (khác Python). Nó loại mọi chữ
   cái có dấu, cắt `tôi` thành `t` + `i` — khiến `má` và `mà` **bằng nhau**, tức
   mù đúng loại lỗi mà bộ chặn sinh ra để bắt.
2. `không` vừa là "số 0" vừa là từ phủ định thông dụng nhất. Với một danh sách
   phẳng, `không phải` → `0 phải` — đúng ca hallucination mà README lấy làm ví dụ
   — chấm sạch **0,0000**.
3. Bản vá cho (2) lại từ chối 3 bản sửa hợp lệ. Sửa tiếp bằng cách cho một cụm
   được "bảo lãnh" bởi từ số nằm ngay cạnh nó.
4. **Chính phép bảo lãnh đó lại mở lại lỗ (2)** — code review tìm ra. Từ bảo lãnh
   được phép là từ "đệm", nên `tôi không đồng ý` → `Tôi 0 đồng ý.` được chấp nhận
   ở residual **đúng bằng 0**: phủ định biến thành chữ số, hiện trên màn hình như
   lời người nói, đảo ngược ý.

   **Test của tôi vẫn xanh suốt.** Tôi chỉ viết đúng một ca `không`, và ca đó
   tình cờ chọn từ đứng cạnh (`phải`) nằm ngoài từ điển — nó đậu nhờ may, không
   nhờ luật. Giờ chạy `it.each` qua bốn từ đứng cạnh khác nhau, vì chính từ đứng
   cạnh mới là thứ quyết định.

5. **Bản vá cho (4) vẫn chưa đủ** — tôi tự tìm ra bằng cách viết 27 ca tấn công
   rồi _chạy_, thay vì suy luận. Hai câu tiếng Việt bình thường vẫn lọt ở
   residual 0: `hai mươi không đủ` → `20 0 đủ.` và `lúc mười giờ không phải mười
một giờ` → `Lúc 10:00 0 phải 11:00.` Ở đây `không` không được từ bên cạnh bảo
   lãnh — nó bị _gộp vào_ một cụm đã có sẵn từ đếm (`mươi`) và đi ké.

   Luật thật sự phân biệt được là **từ đứng SAU**: số 0 nói ra chỉ bao giờ đứng
   đầu một số dài hơn (`không phẩy bốn`, `không tám tám ba`), nên sau nó là số
   nữa; còn phủ định thì theo sau là thứ bị phủ định (`đủ`, `phải`, `đúng`) hoặc
   không có gì.

6. **Và lỗ thứ ba giết luôn mọi luật dựa vào ngữ cảnh** — review tìm ra. `nó
không trăm phần trăm đúng` → `Nó 0 100 phần trăm đúng.` Thứ _bị phủ định_
   chính nó là một con số, nên `không` đứng sát một numeral mà bản sửa đang viết
   lại. Về mặt từ vựng, `không trăm` ("không phải một trăm") và một số 0 đứng đầu
   numeral là **giống hệt nhau**. Không luật ngữ cảnh nào tách được — mà tôi đã
   viết hai luật như vậy.

   Thứ tách được là **HÌNH DẠNG**: số 0 nói ra luôn _bị hút vào_ numeral của nó
   (`không phẩy bốn` → `0,4`) và không bao giờ đứng một mình; phủ định bị số hóa
   thì luôn đứng một mình, vì không có số nào để nhập vào. Một dòng, thay cả hai
   luật trước (xóa hẳn, không chồng lên), và áp được sang tiếng Anh.

Bài học: **một ca test cho một luật phụ thuộc ngữ cảnh thì không phải là test cho
luật đó** — nó là test cho một ngữ cảnh. Và **ba lần sửa cho một lớp lỗi, mỗi lần
bị ca tiếp theo đánh bại**: hai lần tôi _suy luận_ về bản vá thay vì _tấn công_
nó, cả hai lần suy luận đúng còn code thì sai.

Mutation test: 12 đột biến, giết cả 12.

#### Ba giả định của kế hoạch bị số đo bác bỏ

| Kế hoạch nói                | Đo được                                     |
| --------------------------- | ------------------------------------------- |
| ~6,9s, "vài giây sau"       | trung vị **25,1s**, tối đa **92,6s**        |
| không cần trần đồng thời    | phải có — bản sửa sống lâu hơn lượt ~25 lần |
| phải quyết version coupling | `embedSpeaker` đã giải xong trong cùng file |

Con số latency ảnh hưởng câu chữ luận văn: "hiển thị được đánh bóng N ms sau lượt
nói, không tốn gì cho audio đầu tiên" vẫn đúng, nhưng N là **hàng chục giây**, nên
nó cải thiện phần đọc lại chứ không phải phần nghe trực tiếp.

#### Hạn chế phải ghi kèm

- **Một phần là in-sample.** Prompt được sửa **hai lần** dựa trên chính 22 câu
  này. Đây là số khớp bộ dữ liệu, không phải số held-out — trích phải nói vậy.
- WER so tham chiếu **viết** giảm 50,75% → 12,54%. Chiều giảm này là **hệ quả của
  tham chiếu viết**, không phải bằng chứng nhận dạng tốt lên; so với tham chiếu
  **nói** thì cùng bản sửa đó đẩy WER theo chiều ngược lại — chính là lý do phải
  đo hiển thị riêng.

Tái lập: `benchmarks/stt/` — `dump_display_hypotheses.py` → `repair_display_hypotheses.mjs`
→ `score_display_repair.py`. Audio là dữ liệu cá nhân, **không commit**.

---

## 4. Giai đoạn 2 — Tích hợp speech local vào pipeline (23–24/07)

### 4.1 Hợp đồng công việc

**Outcome:** với `AI_STT_PROVIDER=local` + `AI_TTS_PROVIDER=local` (mặc định
mới), `POST /translate` chạy cả 2 chiều mà không gọi ElevenLabs, không cần
`ELEVENLABS_API_KEY`.

**Non-goals (ghi rõ để không trượt phạm vi):** dịch máy local · streaming STT ·
ghi âm mobile · toggle local/cloud trên UI · **xoá provider ElevenLabs** (giữ để
so sánh cloud↔local cho luận văn) · gộp VieNeu vào sidecar mới.

### 4.2 Quyết định thiết kế đã chốt

Chốt bởi user: **2 sidecar tách hẳn** (`local-stt` :8002, `local-tts` :8003) ·
decode audio **server-side bằng PyAV** (client không đổi một dòng) · chọn provider
**chỉ qua env**, đổi default trong `env.schema.ts` thành `local`.

Chốt tự quyết (user uỷ quyền), 9 quyết định kèm lý do:

| #   | Quyết định                                                                                        | Lý do                                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1  | Load model **eager** lúc startup; `/healthz` trả 503 `loading` cho tới khi sẵn sàng               | 1,3 GB / 32 GB không đáng kể; tránh vách latency ở request đầu                             |
| D2  | Sidecar chỉ nhận `vi`/`en`, còn lại 400                                                           | `languageCodeSchema` đã khoá ở tầng contract — đây là phòng vệ tầng sâu                    |
| D3  | Đo latency end-to-end **một lần** lúc nghiệm thu, không dựng harness mới                          | Harness benchmark là measurement-only, không kéo vào runtime                               |
| D4  | `LOCAL_*_THREADS` mặc định **8**; set `OMP_NUM_THREADS`/`MKL_NUM_THREADS` trước khi import engine | 8 nhân vật lý thắng 16 luồng hyperthread (spike cũ); pipeline tuần tự nên không tranh core |
| D5  | `POST /transcribe` multipart · `POST /synthesize` JSON → `audio/wav`                              | Multipart khiến provider mới gần như bản sao của ElevenLabs provider — nhất quán call-site |
| D6  | `audio/decode.py` resample **tường minh** về 16 kHz mono float32                                  | Mic web là 48 kHz, model train ở 16 kHz — không để resample ngầm quyết định chất lượng     |
| D7  | Mỗi sidecar tự có `models/` + `scripts/download_models.py`                                        | Giữ ranh giới harness↔app                                                                  |
| D8  | `LOCAL_TTS_VOICE_ID` mặc định 0; voice không hợp lệ → **fallback default**, không lỗi             | API là public nên phải chịu được input lạ                                                  |
| D9  | `pnpm dev:all` chạy đủ process                                                                    | Default đã là local ⇒ `pnpm dev` không còn đủ                                              |

Đánh đổi chấp nhận: 3 sidecar khi dev; lặp ~30 dòng helper giữa 2 service.
**Không** tạo package Python chung — YAGNI.

### 4.3 Kết quả đo end-to-end (6 lượt/chiều, qua `POST /translate`, 0 lỗi)

| Chiều | p50         | p95     | min     |
| ----- | ----------- | ------- | ------- |
| vi→en | **1663 ms** | 1976 ms | 1418 ms |
| en→vi | **2337 ms** | 2662 ms | 2059 ms |

Tách theo khâu (p50 cùng lần chạy):

| Khâu                    | vi→en             | en→vi              |
| ----------------------- | ----------------- | ------------------ |
| STT (local)             | 53 ms — Zipformer | 186 ms — Moonshine |
| **Dịch (cloud Gemini)** | **916 ms**        | **921 ms**         |
| TTS (local)             | 748 ms — Kokoro   | 1402 ms — VieNeu   |

**Kết luận định hướng cả phần còn lại của dự án:** sau khi speech về local,
**khâu dịch cloud trở thành thành phần tốn thời gian nhất** của một lượt vi→en
(~55%). Mọi tối ưu độ trễ tiếp theo phải nhắm vào đó, không phải vào speech.

Đối chiếu benchmark ↔ chạy thật:

| Thành phần   | Benchmark (cô lập)     | Trong service           |
| ------------ | ---------------------- | ----------------------- |
| Zipformer vi | p95 0,09 s             | ~53 ms p50              |
| Moonshine en | p95 0,34 s             | ~186 ms p50             |
| Kokoro en    | p95 1,18 s · RTF 0,323 | ~748 ms p50 · RTF ≈0,42 |

STT nằm trong dải benchmark. RTF của Kokoro tệ hơn ~28% khi chạy trong service —
đúng như kỳ vọng, vì benchmark đo engine trong subprocess riêng, không có tầng
HTTP. Vẫn thoải mái dưới ngưỡng p95 ≤ 2 s.

### 4.4 So sánh local ↔ cloud từng khâu

Đo qua **đúng các lớp provider thật**, 3 lần mỗi bên, cùng audio và cùng câu.
Cố ý **không** đi qua `POST /translate`: dịch máy không đổi bởi công việc này và
free tier chỉ 20 request/ngày, nên đi qua đó là đo sai thứ và chết vì quota.

| Khâu   | Local p50  | Cloud p50 (ElevenLabs) | Kết luận              |
| ------ | ---------- | ---------------------- | --------------------- |
| STT vi | **84 ms**  | 1117 ms                | local nhanh **13,3×** |
| STT en | **178 ms** | 1285 ms                | local nhanh **7,2×**  |
| TTS vi | 1235 ms    | **348 ms**             | cloud nhanh 3,5×      |
| TTS en | 1126 ms    | **255 ms**             | cloud nhanh 4,4×      |

Độ chính xác transcript trên cùng audio — **cùng từ ở cả hai bên**, cloud thêm
dấu câu:

```
vi/local  "Xin chào hôm nay trời rất đẹp"
vi/cloud  "Xin chào, hôm nay trời rất đẹp"
en/local  "The weather is beautiful today and I would like to walk in the park."
en/cloud  "The weather is beautiful today, and I would like to walk in the park"
```

**Bản nháp đầu của kết luận này đã sai và đã bị lật.** Nó so **một** lượt cloud
(5216 ms vi→en) với p50 local rồi kết luận local nhanh hơn ~3× toàn cục. Mẫu n=1
đó mang theo chi phí khởi động nguội của client cloud. Bức tranh trung thực là
**một sự đánh đổi, không phải một chiến thắng**: nhận dạng local nhanh hơn hẳn ở
cùng độ chính xác từ, nhưng **tổng hợp giọng nói local chậm hơn hẳn**. Lý do chọn
local là **chi phí, quyền riêng tư, khả năng chạy offline** — không phải tốc độ
thô.

(Lưu ý khi trích: TTS latency tỉ lệ với độ dài đầu ra, nên câu cố định 13 từ dùng
ở bảng này chạy lâu hơn các bản dịch ngắn ở bảng end-to-end.)

### 4.5 Phát hiện trong quá trình tích hợp

1. **Transcript tiếng Việt ra TOÀN CHỮ HOA, không dấu câu.** Zipformer emit
   `NGỌN LỬA BẠO ĐỘNG…`. Chuẩn hoá WER của benchmark **hạ chữ thường và bỏ dấu
   câu**, nên lỗi này **không hề xuất hiện trong bảng số** — chỉ lộ ra khi hiển
   thị cho người dùng. Xử lý bằng hook `postprocess()` trên `SttEngine`, override
   cho tiếng Việt để sentence-case. **Danh từ riêng vẫn viết thường** ("tôi đi hà
   nội"); sửa đúng cần mô hình khôi phục hoa/dấu câu.
2. **Lỗi Gemini "chập chờn" thực ra là hết quota ngày.** Provider bọc lỗi SDK
   nhưng **không bao giờ log `cause`**, nên nguyên nhân thật bị che. Thêm đúng
   một dòng log là ra ngay: `RESOURCE_EXHAUSTED`,
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **quotaValue 20**. Không
   phải bug, không phải lỗi mạng. Speech vẫn chạy sau khi cạn; chỉ `/translate` lỗi.
3. **Không giới hạn độ dài audio đầu vào cho STT.** Vài MB Opus ≈ gần một giờ
   tiếng nói, giữ lock engine suốt quá trình decode, không có supervisor restart
   sau OOM. Chặn bằng `LOCAL_STT_MAX_AUDIO_SECONDS` (mặc định 300) → 413.
4. **Dòng log STT ghi sai provider.** `PipelineTranslatorService` log
   `profile.sttModel` (hard-code `scribe_v2`), nên transcript local bị ghi là
   `stt(scribe_v2)`. Nếu không sửa, **mọi con số trong báo cáo này đã bị gán sai
   provider**.
5. **`.env` sẵn có âm thầm giữ đường cloud.** Đổi default chỉ ảnh hưởng biến chưa
   set. Lượt end-to-end đầu tiên vẫn đi ElevenLabs; chỉ phát hiện vì response trả
   `audio/mpeg` thay vì `audio/wav`.
6. **PyAV chạy tốt trên Windows/Python 3.11** — giả định chưa kiểm duy nhất của
   plan. `av` 18.0.0 cài từ wheel, decode webm/opus 48 kHz stereo → 16 kHz mono
   float32 chính xác. Không cần fallback ffmpeg subprocess.

### 4.6 Kết quả code review (24/07)

Phạm vi: 8 commit, 63 file, +4777/−2075. Kết luận: **không deadlock, không race,
không lỗi shared-state** giữa hai engine dùng chung tiến trình; **lock per-engine
đúng** (không lồng nhau, không giữ lock qua await); **PyAV decode đúng**
(resample, flush, thứ tự lỗi; input hỏng không treo, không 500).

Ba defect xác nhận, đã sửa:

1. **Suite e2e không còn biên dịch được** — một spec vẫn import
   `VieNeuTtsProvider` đã xoá. **Vô hình với `pnpm typecheck`** vì tsconfig của
   `apps/api` loại trừ `test/` và `rootDir` của jest là `src`. Chỉ `test:e2e`
   biên dịch nó, và suite không compile được thì hỏng cả lần chạy.
2. **Chuyển sang ElevenLabs làm hỏng en→vi** — web gửi tên preset tiếng Việt làm
   `voice`, provider nội suy thẳng vào request path → 404 → 503 mọi lượt tiếng
   Việt. Ngoại lệ routing per-language vừa gỡ đã che lỗi này. Sửa bằng đúng luật
   sidecar local đang dùng: voice không hiểu được thì fallback default.
3. **Không chặn độ dài input STT** (mục 4.5.3).

Hai phát hiện kèm theo: `translate` e2e có **hai assertion không bao giờ pass
được** (fake TTS provider không khai `outputMimeType`) — tồn tại sẵn trên `main`;
và **không có gì chứng minh sidecar STT nhận dạng được tiếng nói** — test cũ nạp
tone tổng hợp, mà với tone thì transcript rỗng là đáp án đúng. Bổ sung test
round-trip: tổng hợp một câu → nhận dạng lại → khẳng định từ ngữ sống sót, cả 2
ngôn ngữ.

### 4.7 Việc còn nợ từ giai đoạn này

- **TTS local giờ là khâu chậm nhất** (1,1–1,2 s vs 0,25–0,35 s của ElevenLabs).
  Piper là phương án latency-first đã đo cho tiếng Anh; **chưa có gì tương đương
  được benchmark cho tiếng Việt**.
- Khôi phục hoa/dấu câu tiếng Việt — cần model hoặc đổi contract Gemini.
- `GeminiTranslationProvider` phân loại 429 thành lỗi **transport** trong khi nó
  là lỗi **response**.
- **Không provider nào có request timeout** — sidecar treo sẽ treo cả lượt theo
  mặc định ~300 s của undici.
- **Oversubscription luồng ONNX khi có nhiều người dùng**: lock per-engine cố ý
  cho vi và en chạy chồng ⇒ 2×8 luồng trên 8 nhân. Mọi số trong tài liệu này là
  **single-concurrency**; hành vi đa người dùng chưa đo.

---

## 5. Giai đoạn 3 — Chọn model Gemini theo quota (24/07)

**Trước:** mỗi mức chất lượng ánh xạ cứng sang một model. Vì free tier tính quota
**theo từng model**, một model cạn hạn mức là chết cả phiên demo.

**Sau:** provider nhận **danh sách model có thứ tự**, chỉ tụt xuống model kế tiếp
khi bị từ chối vì quota, và trả về **tên model đã thực sự trả lời** để pipeline
ghi log. Đồng thời gỡ "núm chỉnh tốc độ/chất lượng" vốn đã mất tác dụng thật.

Hạn mức thật trên tài khoản (từ dashboard, 25/07):

| Model                 | RPM | TPM  | RPD             |
| --------------------- | --- | ---- | --------------- |
| Gemini 2.5 Flash      | 5   | 250K | **20 — đã cạn** |
| Gemini 3.5 Flash Lite | 15  | 250K | 500             |
| Gemini 3.1 Flash Lite | 15  | 250K | 500             |
| Gemma 4 31B           | 30  | 16K  | 14 400          |
| Gemma 4 26B           | 30  | 16K  | 14 400          |

Hai hệ quả quan trọng cho phần realtime: **hai flash-lite cộng lại = 30 lượt/phút**
trước khi phải chạm gemma; và gemma tuy RPM gấp đôi nhưng **6,4 s/câu** nên chỉ
là phao cứu sinh, không dùng cho hội thoại.

---

## 6. Giai đoạn 4 — Luồng hội thoại thời gian thực (25–26/07)

### 6.1 Chẩn đoán ban đầu — và cú lật quan trọng nhất của dự án

Yêu cầu ban đầu: "realtime như Gemini Live". Phân tích cho ra kết luận ngược với
trực giác:

> **"Đứt quãng" là bài toán phản hồi giao diện, không phải bài toán độ trễ.**

Audio của hệ thống lúc đó p50 ~1,5 s sau khi dứt lời — **nhanh hơn** Gemini Live
Translate. Gemini Live cảm thấy liền mạch vì **màn hình không bao giờ đứng yên**:
chữ chạy suốt trong lúc người dùng nói. Chatofy thì màn hình **chết hoàn toàn**
trong toàn bộ thời gian nói rồi mọi thứ đổ ra một lúc. Cùng một độ trễ vật lý,
hai cảm giác khác hẳn.

Hệ quả: chữ chạy live **không phải phần "làm cho đẹp"** — nó chính là thứ đang đi
tìm. Và có một hệ quả thứ hai bất ngờ hơn: **chữ dịch live cũng là đòn giảm độ
trễ mạnh nhất còn lại**, vì mỗi bản dịch tạm chính là một head start, và bản cuối
cùng có thể dùng thẳng làm bản chính thức khi không có audio mới sau nó — tức
rút hẳn ~550 ms dịch máy khỏi đường tới hạn.

Một giới hạn được nói thẳng từ đầu: **"nghe bản dịch trong khi đang nói" trên 1
máy + loa ngoài là bất khả thi về vật lý nếu không có AEC.** Không có mẹo phần
mềm nào vòng qua được.

### 6.2 Phase 0 — spike đo trước khi thiết kế

**(a) Callback streaming của sherpa-onnx `OfflineTts`: có API, nhưng vô dụng.**

| Văn bản          | TTFC    | Tổng    | Số chunk |
| ---------------- | ------- | ------- | -------- |
| 1 câu, 25 ký tự  | 0,469 s | 0,469 s | **1**    |
| 1 câu, 71 ký tự  | 1,104 s | 1,104 s | **1**    |
| 2 câu, 145 ký tự | 1,034 s | 2,076 s | 2        |

sherpa-onnx **chỉ cắt chunk ở ranh giới câu**. Lượt hội thoại điển hình là 1 câu
⇒ streaming TTS qua callback tiết kiệm **0 ms**.

**(b) Cắt theo mệnh đề ở tầng ứng dụng — đòn thật sự.** Tự tách ở dấu phẩy rồi
gọi `generate()` từng phần:

| Câu (Kokoro, en)                                                | 1 khối  | Cắt mệnh đề | Giảm |
| --------------------------------------------------------------- | ------- | ----------- | ---- |
| "Hello, how much does this cost?"                               | 0,648 s | **0,340 s** | −48% |
| "I would like to book a table for two people at seven tonight." | 0,931 s | **0,689 s** | −26% |
| "Excuse me, could you tell me where the train station is?"      | 0,907 s | **0,393 s** | −57% |

| Câu (VieNeu, vi — lần đầu được đo)                    | 1 khối  | Cắt mệnh đề | Giảm |
| ----------------------------------------------------- | ------- | ----------- | ---- |
| "Xin chào, cái này giá bao nhiêu?"                    | 0,899 s | **0,373 s** | −59% |
| "Tôi muốn đặt một bàn hai người lúc bảy giờ tối nay." | 1,061 s | **0,813 s** | −23% |
| "Xin lỗi, cho hỏi ga tàu ở đâu ạ?"                    | 0,856 s | **0,449 s** | −48% |

**Mọi lần cắt đều gapless** — audio phần 1 luôn dài hơn thời gian sinh phần 2 nên
phát liên tục không giật. Tổng thời gian tăng ~20–30% do overhead mỗi lần gọi,
nhưng không ảnh hưởng trải nghiệm vì người dùng đã nghe từ mốc TTFA. VieNeu
phương sai đáng kể (câu 3: median 0,449 s nhưng có lần 0,873 s) — cần mẫu lớn hơn
trước khi công bố p95.

**(c) Benchmark 3 model trong chuỗi fallback** (6 mẫu/model, API thật):

| Model                 | blocking p50 | streaming p50 | chunks p50 |
| --------------------- | ------------ | ------------- | ---------- |
| gemini-3.5-flash-lite | 820 ms       | 553 ms        | 2          |
| gemini-3.1-flash-lite | 612 ms       | 557 ms        | 1          |
| gemma-4-31b-it        | 6354 ms      | 6884 ms       | 1          |

Đọc theo cột: chênh lệch giữa 3.5 và 3.1 **chỉ tồn tại ở cột blocking**; ở cột
streaming hai model **hoà nhau (553 vs 557 ms)**. Tức 208 ms tưởng là "giá của
model" thực ra là **chi phí của lời gọi blocking**. ⇒ Dùng
`generateContentStream` (được ~270 ms); thứ tự hai model flash là quyết định về
**chất lượng**, không phải độ trễ. Nhưng **chunks p50 = 1** — cả bản dịch về
trong một chunk ⇒ **không xây pipeline đẩy từng cụm từ MT sang TTS**, không có
cụm nào để đẩy.

**(d) Rủi ro mới: free tier giới hạn 15 request/PHÚT**, không chỉ 500/ngày. Đo
trực tiếp: **429 sau đúng 15 request trong 10,7 s**, `retryDelay: 52s`. Hạn mức
phút mới là thứ bóp nghẹt hội thoại realtime — 15 lượt/phút = 1 lượt mỗi 4 giây.

Kèm theo, một defect trong code lúc đó: `isQuotaExhaustedError()` coi **mọi** 429
là "hết quota ngày" và tụt model, **bỏ qua hoàn toàn `retryDelay`** ⇒ đốt sạch
chuỗi fallback trong một phút rồi trả 503, trong khi chỉ cần đợi 4 giây. Càng
dùng realtime càng nhanh rơi xuống gemma 6,9 s — **đúng lúc cần nhanh nhất thì hệ
thống chậm nhất**. Đã thay bằng `quotaCooldownMs()` đọc `retryDelay`, nhớ cooldown
từng model và **bỏ qua không gọi** model đang bị chặn.

**(e) Partial transcript bằng re-decode — đúng cho vi, có trần cho en**
(median 3 lần, ngân sách nhịp 300 ms):

| Buffer          | vi (Zipformer-30M) | en (Moonshine base) |
| --------------- | ------------------ | ------------------- |
| 0,5 s           | 14 ms              | 15 ms               |
| 1 s             | 22 ms              | 118 ms              |
| 3 s             | 49 ms              | 159 ms              |
| 5 s             | 88 ms              | 236 ms              |
| 8 s             | 114 ms             | 277 ms              |
| 12 s            | 161 ms             | **456 ms — vỡ**     |
| 15 s            | 214 ms             | **582 ms — vỡ**     |
| duty cycle @3 s | **14%** một core   | **40%** một core    |

Moonshine đắt gấp ~3× Zipformer và vỡ ngân sách 300 ms từ buffer ~10 s ⇒ nhịp
re-decode phải **giãn theo độ dài buffer**, không cố định.

**(f) Ngân sách trễ sau khi đo (vi→en):**

```
t=0      dứt lời
t=150ms  VAD nghi hết câu → STT final (90ms)
t=240ms  bắn gemini-3.5-flash-lite (streamed)
t=793ms  Gemini trả cả bản dịch (553ms, một chunk)
t=1133ms Kokoro mệnh đề đầu ra loa (340ms)
```

**≈ 1,13 s p50.** Nhờ **VAD-overlap + cắt mệnh đề + gọi streaming**, không nhờ
pipeline cụm-từ hay callback TTS. Bỏ từng đòn: bỏ VAD-overlap +350 ms · quay lại
blocking +267 ms · bỏ cắt mệnh đề +300…500 ms.

### 6.3 Bug đáng giá nhất của dự án: cơ chế tăng tốc đã ship nhưng chưa từng chạy

Cơ chế `speculate()` — dịch trước phần đầu câu ở mốc im lặng — **đã ship, có test
xanh, và có hẳn một mục trong báo cáo bàn giao tuyên bố "tiết kiệm 350 ms"**.

Chuỗi nguyên nhân:

```
speech-gate.ts:119-129   silenceMs cộng dồn, speaking vẫn true
capture-pump.ts:110-112  if (state === 'in-turn') onAudio(block)   ← block im lặng VẪN gửi
                         state chỉ đổi ở onSpeechEnd = CUỐI hangover
translation-session.service.ts:197   bufferedBytes += audio.length
translation-session.service.ts:273   atBytes === bufferedBytes      ← không bao giờ khớp
```

Client gửi audio suốt 500 ms hangover ⇒ `bufferedBytes` luôn tăng sau mốc
speculate ⇒ phép so luôn sai ⇒ **bản dịch sớm luôn bị vứt**. Không gì "fail":
công việc chỉ đơn giản bị làm lại, và khoản độ trễ nó sinh ra để tiết kiệm thì
không bao giờ được tiết kiệm.

**Vì sao lọt qua mọi cổng.** Hai test "chứng minh" nó **dựng một chuỗi sự kiện mà
production không thể tạo ra**: gọi `speculate()` rồi `end()` không frame nào ở
giữa; e2e chỉ gửi đúng 1 frame. Typecheck, lint, build, unit, e2e — tất cả xanh.
Đây là **lần thứ hai** một lỗi thoát ra `main` theo đúng cách này (lần trước:
cờ half-duplex đặt ở đầu lời nói thay vì cuối).

**Cách sửa.** Client **giữ lại** block im lặng thay vì gửi; nói tiếp → flush
nguyên vẹn đúng thứ tự; hết lượt → bỏ. `SpeechGate.push()` trả về block có phải
speech không, để `CapturePump` không tự suy lại ngưỡng (hai bản sao sẽ trôi lệch).

**Code review bắt một lỗi trong chính bản sửa:** bản đầu vứt `held` ở
`onSpeechEnd`, nên **phần đuôi từ dưới ngưỡng RMS không bao giờ tới recognizer** —
phụ âm cuối vô thanh thấp hơn nguyên âm 10–20 dB, mà tiếng Việt có /t/, /k/, /p/
cuối không bật hơi. `SPEECH_MARGIN` bị biến từ nút chỉnh _thời điểm_ thành nút
chỉnh _nội dung nhận dạng_, và **không test nào thấy** vì chúng đếm callback chứ
không so transcript. Sửa: flush `held` ngay trước khi bắn `onProbableEnd`.

### 6.4 Số đo đầu tiên và hai vòng sửa dựa trên số

Sau khi sửa, lần đầu tiên dự án có số end-to-end đo thật (32 fixture, bỏ 3 lượt
làm nóng; i7-11700K, **STT+TTS+API+driver chạy cùng một máy** = cận trên của
tranh chấp CPU):

|                                     | p50         | p95     |
| ----------------------------------- | ----------- | ------- |
| Tổng, 32 lượt                       | **1163 ms** | 2983 ms |
| Khi speculation dùng được (19 lượt) | 870 ms      | 2171 ms |
| Khi speculation mất (13 lượt)       | 1760 ms     | 3727 ms |

Từng khâu (log API, n=45): STT p50 **58 ms** (p95 84, max 102) · Gemini translate
p50 **723 ms** (p95 1947, max 8943) · TTS mỗi mệnh đề p50 **527 ms** (p95 1125).
⇒ STT không phải nút cổ chai; **Gemini là khâu tốn nhất và biến động nhất**, và
là lý do p95 vỡ mục tiêu — nó phụ thuộc mạng, không phụ thuộc máy.

Tỉ lệ head-start dùng được hội tụ quanh **59%** qua 3 phương pháp độc lập (server
thật 19/32 · replay offline 7/12 · dự đoán). Chi phí: 45 request cho 35 lượt =
**22% overhead** vì speculation hỏng.

**"1,13 s hay 1,5 s" — đã trả lời.** Con số 1,13 s dự đoán ở Phase 0 **đúng**
(đo 1163 ms, lệch 3%), nhưng **hệ thống chưa từng đạt nó** cho tới khi bug
head-start được sửa. Con số 1,5 s là ước lượng cho trường hợp không overlap; đo
thật cho trường hợp đó là **1760 ms**, nên 1,5 s là lạc quan.

Hai thay đổi tiếp theo, **phải đi cùng nhau**:

1. **Đoán lại ở mỗi lần ngắt, thay vì đoán một lần.** Lý do one-shot tồn tại là
   quota, và lý do đó **sai chiều**: một guess chỉ sống khi không có audio theo
   sau, nên lượt có ngắt giữa chừng tiêu guess ở lần ngắt đầu rồi **vẫn** phải
   dịch lại ở cuối — tốn 2 request mà không được gì.
2. **Tách ladder model.** Đo sau khi chỉ đổi (1): p50 991 ms nhưng **p95 nhảy lên
   10112 ms** — request thêm đẩy `3.5-flash-lite` vượt trần 15/phút, ladder dùng
   chung rơi xuống gemma, 2 lượt mất 10081 ms và 18537 ms. Sửa: guess đi
   `[3.1, 3.5]`, final đi `[3.5, 3.1]`, **cả hai loại bỏ gemma** (model 6,9 s là
   dự phòng hợp lý cho REST nhưng với hội thoại thì người nói đã bỏ đi rồi). REST
   giữ nguyên ladder đầy đủ.

|                | One-shot, ladder chung | Đoán lại, ladder chung | **Đoán lại + tách ladder** |
| -------------- | ---------------------- | ---------------------- | -------------------------- |
| p50            | 1163 ms                | 991 ms                 | **859 ms**                 |
| p95            | 2983 ms                | 10112 ms               | **1849 ms**                |
| max            | 3727 ms                | 19003 ms               | **1911 ms**                |
| Tỉ lệ reuse    | 59%                    | 75%                    | **75%**                    |
| Gọi gemma      | 0                      | 2 (10 s, 18 s)         | **0**                      |
| Dịch chậm nhất | 8943 ms                | 18537 ms               | **1055 ms**                |

### 6.5 Chữ nguồn live và chữ dịch live

Chữ nguồn: server re-decode buffer đang lớn dần trong pha `listening` và phát
`server.transcript.partial`. Đo trên trình duyệt thật, câu 6,9 giây:

```
 633ms  Hôm qua
 970ms  Hôm qua tôi
1258ms  Hôm qua tôi có đặt
1861ms  Hôm qua tôi có đặt phòng qua mạng
3150ms  … nhưng chưa nhận được xác nhận
4450ms  … nên tôi muốn kiểm tra
5893ms  … không biết còn phòng không
```

**17 lần cập nhật** trong một lượt. Sau đó lượt chốt bình thường, dòng live biến
mất, bản dịch chính thức hiện.

Chữ dịch live, cùng câu:

```
4049ms  I booked a room online yesterday but have not received a confirmation yet.
        ← tiếng Anh hiện khi người nói VẪN đang nói
6406ms  … so I would like to check if there is still a room available.
        ← bản chính thức
```

Sớm hơn bản chính thức **2,4 giây**.

Hai quyết định thiết kế có chủ ý:

- **Chỉ lượt dài mới dịch tạm** — ngưỡng ≥3 s tiếng nói, cách nhau ≥2,5 s hoặc
  ≥12 từ mới, tối đa 3 lần/lượt. Câu 2 giây đã có bản dịch thật sau ~900 ms; đoán
  trước nó là tốn một request metered để đổi lấy không gì.
- **Không bao giờ phát bản đoán thành tiếng.** Câu chưa xong nên bản dịch là
  phỏng đoán mà lời nói sau có thể lật ngược — **chữ thì thay lặng lẽ được, tiếng
  đã nói thì không.**

**Suýt hỏng lần thứ hai vì quota — và lần này số bắt được ngay.** Bản đầu cho
bản dịch tạm dùng `3.1-flash-lite`, cùng model mà speculation dẫn đầu:

|                | Dịch tạm trên `3.1` | Dịch tạm trên `3.5` |
| -------------- | ------------------- | ------------------- |
| p95            | **2787 ms**         | **1582 ms**         |
| Rate limit     | **7**               | **0**               |
| Dịch chậm nhất | **15764 ms**        | 938 ms              |

Tổng request chỉ tăng 50→56 ⇒ **vấn đề không phải tổng mà là dồn cục**: bản dịch
tạm xảy ra _trong lúc_ lượt đang chạy, cùng thời điểm với speculation, trên cùng
một model. Trong khi đó `3.5` đang nhàn — vì 75% lượt dùng lại speculation nên
đường final hiếm khi gọi. Chuyển sang model đang rảnh là xong.

### 6.6 Một phase bị bỏ, có số làm chứng

Kế hoạch yêu cầu **cấp recognizer riêng cho vòng partial**, vì lo lock per-engine
chặn đường giải mã chính. Đã làm bản dùng chung engine trước rồi đo: **422 lần
đọc partial trên 32 lượt, STT p50 vẫn 58 ms** (nền: 58 ms), max 136 ms (nền
102 ms). Đường final **không chậm đi**. Vấn đề không tồn tại ⇒ bỏ cả phase, tránh
sửa sidecar Python và đổi `SttProvider` (interface có 2 implementer, 7+ consumer)
để chống một vấn đề chưa từng quan sát được.

### 6.7 Kiểm chứng trên trình duyệt thật — lần đầu của dự án

Playwright + Chromium, bản **production** (`next start`, không HMR). Thay đúng
một thứ: `navigator.mediaDevices.getUserMedia` trả `MediaStream` dựng từ fixture
WAV. Mọi thứ dưới nó là thật — AudioWorklet, đồng hồ Web Audio, resampler,
socket, UI.

| Lượt           | Ngắt giữa câu | Speculation | Audio đầu |
| -------------- | ------------- | ----------- | --------- |
| plain-01       | không         | USED        | 1021 ms   |
| plain-01 (lặp) | không         | USED        | 873 ms    |
| pause-03       | 2 lần         | lost        | 1749 ms   |

Harness offline dự đoán `plain-*` reuse được và `pause-03` mất — trình duyệt cho
đúng vậy; khoảng cách 873↔1749 ms khớp 870↔1760 ms đo qua driver. **Ba phương
pháp đo độc lập hội tụ.**

Sau khi áp dụng đoán-lại + tách ladder, chạy lại trên trình duyệt: `plain-01`
702 ms · **`pause-03` 949 ms** (trước là 1749 ms) — nhanh hơn **800 ms** đúng ở
loại lượt mà thiết kế cũ không bao giờ thắng được.

Đây cũng chính là chỗ 3 lỗi Critical của đợt trước nằm (mic treo sau 1 block,
half-duplex mở lại sai thời điểm) — giờ có bằng chứng chúng không tái diễn.

### 6.8 Số cuối cùng

Bảng đầy đủ ở mục 7. Tóm tắt: p50 **907 ms**, p95 **1582 ms**, max 1757 ms,
**0/32 lượt vượt 1800 ms**, reuse 75%, 0 rate limit.

Hai chỉ tiêu giao diện chưa đạt (chữ nguồn 633 ms, UI đứng yên 753 ms) trượt
133–253 ms, và phần lớn khoảng 753 ms là do **recognizer chưa nghe thêm từ mới**
chứ không phải hệ thống đứng — nhịp partial vẫn về đều 300 ms. Hạ nhịp xuống
200 ms sẽ tốn CPU mà không sửa được nguyên nhân.

---

## 7. Bảng tổng hợp trước / sau (dùng cho chương kết quả)

Điều kiện đo: 32 lượt, fixture giọng tiếng Việt sinh bằng VieNeu, i7-11700K
8 nhân, STT + TTS + API + driver **chạy cùng một máy** (cận trên của tranh chấp
CPU).

| Chỉ số                       | Đầu tuần (19/07) | Cuối tuần (26/07)  | Mục tiêu |
| ---------------------------- | ---------------- | ------------------ | -------- |
| Dứt lời → audio đầu, **p50** | 1663 ms (REST)   | **907 ms** ✅      | ≤1200 ms |
| **p95**                      | 1976 ms          | **1582 ms** ✅     | ≤1800 ms |
| Số lượt vượt 1800 ms         | —                | **0/32** ✅        | —        |
| Tỉ lệ tái dùng head-start    | 0% (cơ chế chết) | **75%** ✅         | ≥70%     |
| Số lần bị rate limit         | thường xuyên     | **0** ✅           | 0        |
| Chữ nguồn hiện lần đầu       | không có         | 633 ms ❌          | ≤500 ms  |
| Khoảng UI đứng yên dài nhất  | cả lượt          | 753 ms ❌          | ≤500 ms  |
| STT vi                       | 1117 ms (cloud)  | **84 ms** (local)  | —        |
| STT en                       | 1285 ms (cloud)  | **178 ms** (local) | —        |
| Phụ thuộc API key speech     | bắt buộc         | **không cần**      | —        |

Cổng chất lượng, cuối kỳ: `jest` api **173 pass** · e2e 26 pass / 7 skip ·
`vitest` web **32 pass** / 1 skip · `pnpm build` + `typecheck` xanh 10/10 ·
`pnpm lint` **6 workspace** 0 error · `knip` exit 0 · `turbo test` 6/6 ·
trình duyệt thật: chữ nguồn live, chữ dịch live, chốt lượt, mic mở lại, 0 lỗi.

Đầu kỳ: 82 test api, **không có test cho `apps/web`**, **không có lint cho
`apps/web`**, CI chỉ chạy lint/typecheck/build.

---

## 8. Bài học phương pháp (phần đáng đưa vào luận văn)

1. **Benchmark trên đúng phần cứng đích là bắt buộc.** Cùng một ngày, số công bố
   sai lệch ở **cả hai chiều**: PhoWhisper trượt ngưỡng dù được ước là đạt;
   Zipformer và Kokoro đều nhanh hơn công bố.

2. **Đo lại sau khi sửa, không tin vào lý lẽ.** Hai lần trong một tuần, thay đổi
   trông như cải thiện lại làm p95 tệ đi vì quota (10112 ms và 2787 ms), **cả hai
   lần chỉ lộ ra khi đo lại**. Nguyên nhân không phải tổng số request (50→56) mà
   là **dồn cục theo thời gian trên cùng một model**.

3. **Test có thể "chứng minh" thứ production không tạo ra được.** Bug head-start
   sống sót qua typecheck, lint, build, unit, e2e vì hai test dựng chuỗi sự kiện
   không thể xảy ra thật. Test đếm callback không bắt được lỗi về _nội dung_;
   test khẳng định cận dưới không bắt được trùng lặp/đảo thứ tự.

4. **Một assertion chết che được hai lỗi.** `expect(...).not.toHaveBeenCalled`
   thiếu `()` là truy cập thuộc tính, không kiểm gì; thêm `()` vào thì test hỏng
   thật vì bản thân test cũng sai (thiếu `mockClear()`).

5. **Chuẩn hoá của phép đo có thể giấu lỗi sản phẩm.** Chuẩn hoá WER hạ chữ
   thường + bỏ dấu câu ⇒ lỗi "transcript TOÀN CHỮ HOA" không xuất hiện trong bảng
   benchmark, chỉ lộ khi hiển thị cho người dùng.

6. **Lỗi bị bọc mà không log `cause` thì không chẩn đoán được.** "Gemini chập
   chờn" thực ra là quota ngày; một dòng log là ra ngay.

7. **Ba lỗi Critical của đợt trước đều nằm trong code client không có test**,
   trong khi typecheck/lint/build đều xanh ⇒ thêm vitest + eslint cho `apps/web`,
   tách chính sách turn-taking ra module thuần để test được thứ tự sự kiện.

8. **Nhiều phương pháp đo độc lập hội tụ mới đáng tin** — replay offline, harness
   qua driver, trình duyệt thật cho cùng kết luận (873↔1749 vs 870↔1760 ms).

9. **Chẩn đúng bài toán quan trọng hơn tối ưu đúng cách.** "Đứt quãng" là phản
   hồi giao diện, không phải độ trễ audio.

10. **Bỏ một phase cũng cần bằng chứng** — 422 lần đọc partial chứng minh đường
    final không chậm đi.

---

## 9. Ràng buộc và đánh đổi đã chấp nhận

- **License CC-BY-NC-ND của Zipformer-30M**: chỉ học thuật, phải ghi trong luận
  văn + README. Thay thế nếu thương mại hoá: PhoWhisper (BSD-3), ~1,3 s/câu.
- **Quota Gemini là ràng buộc chặt nhất.** 59 request cho 32 lượt trong ~190 s;
  0 rate limit ở lần đo cuối nhưng **biên rất mỏng**, phụ thuộc việc 75% lượt tái
  dùng speculation. ~1000 req/ngày ≈ 35–40 phút hội thoại — đủ demo, **không đủ
  sản phẩm**.
- **Bản dịch tạm sẽ sai và tự sửa trước mặt hội đồng** — chấp nhận có chủ ý, chỉ
  cho phần chữ. Chuẩn bị sẵn câu trả lời.
- **Lượt đầu qua stack nguội mất ~9 giây** (8995 ms, rồi 650, 829 ms) ⇒ phải chạy
  vài lượt làm nóng trước khi demo.
- **TTS local chậm hơn cloud** (mục 4.4) — đổi lấy chi phí, riêng tư, offline.
- **Fixture là giọng TTS** ngắt đúng chỗ có dấu câu ⇒ 75% là **trần**, không phải
  ước lượng cho giọng người thật.
- **Mọi số đều single-concurrency**, đo trên máy chạy chung client + server.

---

## 10. Việc còn nợ

1. **Full duplex đã bật trên web — cấp phép bằng kiểm chứng thiết bị, không bằng
   quy trình 40 lượt (19/08).** Mic giờ được honor xuyên suốt lúc bản dịch đang
   phát: `fullDuplex: true` đặt thẳng trong `apps/web/src/hooks/use-streaming-translate.ts`,
   không còn cờ env nào chắn trước nó.

   **Căn cứ, và đúng phạm vi của nó.** Máy demo là MacBook; đã kiểm trực tiếp rằng
   luồng loa không bao giờ đè vào mic đang thu — AEC phần cứng của máy cộng với
   `echoCancellation: true` mà `getUserMedia` đã bật sẵn là đủ. Phải nói thẳng đây
   **không phải** quy trình 40 lượt thiết kế bên dưới: không có nhánh đối chứng
   half-duplex, không có bảng số, không ghi n. Nó là kiểm chứng trên đúng một thiết
   bị, và kết luận chỉ áp cho thiết bị đó. Rig i7 (loa rời + mic desktop, chỉ AEC
   phần mềm) **chưa đo** — nếu bảo vệ trên máy đó thì dùng tai nghe, và phiên dịch
   song song chuyên nghiệp vốn làm bằng tai nghe.

   **Thứ thay cho cái rào.** Bộ đếm hiện lên cạnh vạch mức **ngay khi nó khác 0**
   (`cascade-panel.tsx`), và ở 0 thì không chiếm chỗ. Đó là dấu vết duy nhất một
   vòng âm học để lại. Đọc một con số khác 0 thì xác nhận bằng transcript — vòng
   lặp viết chính bản dịch của app vào đó, không thể nhầm.

   **Nhãn trên màn hình là `heard during playback`, cố ý không phải "echo".** Đây là
   chỗ dễ nói quá nhất trong cả mục này, nên nói cho đúng: full duplex bật lên
   **chính là để** người ta nói đè lên bản dịch và vẫn được nghe, mà mic được honor
   suốt cửa sổ đó — nên một cú barge-in xác nhận `SpeechGate` y hệt như loa dội về.
   Ở tầng này không có gì tách được hai thứ. Gọi nó là "echo" thì mỗi lần tính năng
   chạy đúng lại báo động một lần, và một cái báo động như thế thì người ta ngừng
   đọc — đúng cái giá phải trả khi nó là thứ duy nhất thay cho cái rào build-time.

   Ba điều phải ghi khi báo cáo con số đó: (a) ở nhánh single-turn, cửa sổ đếm bắt
   đầu từ lúc dứt lời chứ không phải lúc loa kêu, nên có lẫn ~900 ms tiếng phòng;
   (b) nó là "tiếng nghe được trong lúc audio của ta có thể tới mic", không phải
   "vọng âm" theo nghĩa hẹp — trên web giờ không còn nhánh đối chứng half-duplex để
   trừ đi số hạng đó; (c) trên web nó cộng cả **barge-in** lẫn tiếng phòng, nên khi
   chạy quy trình đo thì **không được nói đè lên lúc bản dịch đang phát** — nói đè
   một lượt là hỏng cả con số của lượt đó.

   **Quy trình 40 lượt vẫn còn giá trị, cho thiết bị khác.** Viết ở
   `benchmarks/realtime/README.md` (chỗ tracked). Tóm tắt: 20 lượt ở đúng âm lượng
   và khoảng cách sẽ dùng thật, câu khác nhau mỗi lượt vì tự kích hoạt phụ thuộc
   nội dung phát; ghi kèm âm lượng, khoảng cách mic–loa, thiết bị, và số
   `session_busy` quan sát được (guard phía server có thể tạo ra 0 **giả**). **Đọc
   một chiều**: trượt trên rig khó không kết luận được gì về máy dễ hơn, và không
   được viết thành "đóng hướng full-duplex".

   **Cờ đo đã bỏ theo.** `NEXT_PUBLIC_MEASUREMENT_MODE` không còn: client luôn gửi
   `client.turn.metrics`, và `TURN_METRICS_PATH` phía server là công tắc duy nhất
   quyết định dòng đó có được ghi xuống đĩa hay không.

   **Nhánh half-duplex vẫn còn trong thư viện** (`fullDuplex: false` là mặc định của
   `CapturePump`) — extension và đường single-turn vẫn dùng, và một client trên
   thiết bị chưa kiểm vẫn tắt được. Chỉ có web là bật cứng.

   **Cập nhật (extension):** phần _đếm_ vọng âm ở đó có công cụ riêng —
   `apps/extension/src/echo-monitor.ts` mở một luồng mic riêng và đếm số block vượt
   ngưỡng **trong lúc bản dịch đang phát**, ngưỡng cố định thay vì sàn thích nghi
   (sàn thích nghi sẽ học loa thành nền và ngừng đếm). Con số vào JSONL qua
   `client.turn.metrics` và in ra bởi `benchmarks/realtime/analyze-continuous.mjs`.
   Trong extension vòng vọng âm _digital_ không tồn tại theo cấu trúc nên
   `fullDuplex: true` bật sẵn từ đầu; cái còn lại là vòng **âm học** qua mic của
   chính người dùng, thứ extension không kiểm soát được và chỉ đo được.

2. **Giá của việc commit sớm — đã đo lần đầu (18/08).** Câu hỏi chặn hướng
   cắt-theo-mệnh-đề: dịch từng khúc _trong lúc người ta còn đang nói_ thì chất lượng
   tụt bao nhiêu? Thí nghiệm thuần văn bản, cùng model, cùng prompt, 12 utterance
   (6 mỗi chiều) từ `benchmarks/live-translate/data/manifest.json`, chấm chrF++:

   | Nhánh                                 | vi→en         | en→vi         | chung             |
   | ------------------------------------- | ------------- | ------------- | ----------------- |
   | cả câu (hôm nay)                      | 71,85         | 53,91         | 62,71             |
   | cắt tại dấu câu (**cận lạc quan**)    | 69,47 (−2,38) | 53,64 (−0,28) | 61,49 (**−1,22**) |
   | cắt theo tỉ lệ ~3 s (**cận bi quan**) | 67,50 (−4,35) | 51,20 (−2,71) | 59,25 (**−3,46**) |

   Đọc thành **một khoảng −1,2 … −3,5 điểm chrF++**, không phải một con số: luật
   thật sẽ cắt theo im lặng, nằm giữa hai nhát cắt này. Cắt tại dấu câu **mù** đúng
   với giả thuyết cần kiểm — tiểu từ cuối câu tiếng Việt nằm ngay _trước_ dấu câu
   nên không bao giờ bị tách khỏi mệnh đề — nên nó là cận dưới của thiệt hại.

   **vi→en thiệt gấp ~1,6–8× en→vi**, đúng hướng đã lo: transcript tiếng Việt không
   có dấu câu nên tiểu từ là tín hiệu phân cực duy nhất. Bắt được một ca cụ thể ở
   `vi-001`, nhát cắt tỉ lệ: _"security against attacks, **no** can be merged by
   tricks"_ — từ **"không"** rơi vào ranh giới chunk và ra một phủ định què.

   Cảnh báo khi trích: n=12 (nhỏ), reference là **pseudo-reference chưa post-edit**
   (`manifest.referenceProvenance`), và điểm tuyệt đối không so được với số công bố
   — chỉ **hiệu số** giữa các nhánh mới là kết quả. Sinh lại:
   `node benchmarks/live-translate/segment-vs-whole.mjs --limit 12 --run` rồi
   `uv run python benchmarks/live-translate/score-segments.py <rows>`.

3. ~~**Chưa có kênh metrics phía client**~~ — **đã trả.** `client.turn.metrics`
   (`packages/types/src/events/ws-events.ts`) gửi mốc bắt đầu/kết thúc nói, thời
   lượng thu, mốc phát, tồn đọng, `cutForced`, `outcome` và số vọng âm; server ghi
   cùng file JSONL với dòng của nó, phân biệt bằng `source`. Ghép theo `sessionId`,
   **không bao giờ theo timestamp** — hai bên giữ đồng hồ riêng. Dòng được gửi lúc
   lượt **đóng**, không lúc phát xong: lượt bị từ chối / bỏ / lỗi không bao giờ
   phát, nên chờ playback sẽ bỏ đúng những lượt đó và coverage biến thành "tỉ lệ
   phát thành công", đẹp lên đúng lúc pipeline hỏng.
4. **Chưa đo trên giọng người thật** (mục 9).
5. **Chưa đo hành vi đa người dùng** — oversubscription luồng ONNX. Công cụ đã có
   (trần global `MAX_CONCURRENT_TURNS_GLOBAL`, script phân tích đọc req/phút **theo
   từng model**); phép đo RTF với 1/2/3 **socket** vẫn chưa chạy.
6. `apps/api` lint vẫn chỉ quét `src/`, nên `test/` không được lint.
7. ~~**CI không chạy test nào**~~ — **đã trả.** CI hiện có bốn job: Lint, Type
   check, Build **và Test**.
8. Ngưỡng chữ dịch live (3 s / 2,5 s / 12 từ / 3 lần) suy từ ràng buộc quota,
   **chưa từ đo cảm nhận người dùng**.
9. Khôi phục hoa/dấu câu tiếng Việt; timeout cho provider; phân loại 429 thành
   lỗi response (mục 4.7).

---

## 11. Câu hỏi cần ý kiến giảng viên hướng dẫn

1. **Có nên tiếp tục theo đuổi phần p95 còn lại không?** Cách duy nhất còn lại là
   giảm phụ thuộc Gemini — dịch máy local, cache, hoặc chấp nhận con số hiện tại.
   Phần trễ còn lại là biến động mạng, không hằng số phía client nào chạm tới được.
2. **Luận văn có cần bảng A/B đầy đủ cloud vs local cho cả ba khâu không?** Hiện
   đã có cho STT và TTS; làm cho khâu dịch sẽ tốn quota đáng kể.
3. **Mức chấp nhận cho bản dịch tạm tự sửa trước mặt người dùng?** Có thể làm một
   khảo sát nhỏ nếu cần.
4. **Có cần khôi phục hoa/dấu câu cho tiếng Việt không?** Hiện danh từ riêng vẫn
   viết thường ("tôi đi hà nội"). Sửa đúng cần thêm một mô hình.
5. **License CC-BY-NC-ND cho model STT tiếng Việt** — cần xác nhận chính thức là
   chấp nhận được cho đồ án.
6. Chất lượng TTS chấm bằng **một người nghe A/B**; có cần mini-MOS nhiều người
   nghe để đủ chặt chẽ không?

---

## 12. Nguồn dữ liệu gốc (để tái lập số liệu)

| Số liệu                                 | Sinh lại bằng                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WER/RTF/RAM của STT                     | `benchmarks/stt/` — `uv run python run_benchmark.py --run-tag rN`; kết quả thô ở `benchmarks/stt/results/`                                                                              |
| So sánh decoder tiếng Việt (3 nhánh)    | `benchmarks/stt/` — `uv run python scripts/build_hotwords_vi.py` rồi `uv run python run_benchmark.py --decoder-arms --run-tag r3-decoder-arms`                                          |
| Thước đo hiển thị (chữ số/dấu câu/hoa)  | `benchmarks/stt/stt_bench/display_fidelity.py` — `uv run pytest tests/test_display_fidelity.py`; **không** đi qua `normalize_text`. Baseline: `scripts/run_display_baseline.py` (§3.12) |
| Giọng thật, 3 đường thu (§3.11)         | Audio là dữ liệu cá nhân, **không commit** — số liệu không tái lập độc lập được. Cách đo ghi trong `plans/reports/capture-260828-1114-*.md`                                             |
| Sửa hiển thị, trước/sau (§3.13)         | `benchmarks/stt/` — `dump_display_hypotheses.py` → `node scripts/repair_display_hypotheses.mjs` → `score_display_repair.py`; tốn quota Gemma thật, audio không commit                   |
| Bộ chặn diễn giải sai (ngưỡng = 0)      | `apps/api/.../providers/repair-divergence.spec.ts`; hiệu chuẩn nằm trong đầu ra của `repair_display_hypotheses.mjs` (22/22 = 0,0000)                                                    |
| Chống prompt injection cho bản sửa      | `benchmarks/prompt-injection/` — `node run.mjs`; nhánh `repair` chạy riêng trên model đang ship, **không** dùng lại corpus dịch                                                         |
| Latency/RTF của TTS + WAV để nghe A/B   | `benchmarks/tts/` — cùng cách; `benchmarks/tts/data/sentences-en.txt` đã commit                                                                                                         |
| Latency từng model Gemini               | `bench-gemini-models.mjs` (API thật, tốn quota)                                                                                                                                         |
| Fixture hội thoại tiếng Việt            | `benchmarks/realtime/generate-fixtures.mjs` (VieNeu; WAV không commit)                                                                                                                  |
| Tỉ lệ head-start dùng được (offline)    | `packages/realtime-client/src/audio/capture-pump.replay.spec.ts`                                                                                                                        |
| p50/p95 end-to-end                      | `packages/realtime-client/src/audio/pipeline-latency.measure.spec.ts`, opt-in `MEASURE_PIPELINE=1` (tốn quota thật)                                                                     |
| Metrics mỗi lượt                        | `services/turn-metrics.recorder.ts` — 1 dòng JSONL/lượt, opt-in qua `TURN_METRICS_PATH`; ghi **mọi** đường kết thúc kèm `reason`, và cả dòng client (`source: 'client'`)                |
| Thời lượng speech (mẫu số coverage)     | `benchmarks/realtime/vad-reference.mjs <wav>` — VAD offline, **không** dùng `SpeechGate`; xem ghi chú dưới                                                                              |
| Coverage / độ trôi / req-phút-mỗi-model | `benchmarks/realtime/analyze-continuous.mjs <turns.jsonl> --speech-ms N`                                                                                                                |
| Thứ tự phát khi lượt về sai thứ tự      | `packages/realtime-client/src/audio/ordered-playback.replay.spec.ts` (kèm test đối chứng phải **fail**)                                                                                 |
| Kiểm chứng trình duyệt                  | Playwright + Chromium trên bản `next start`, thay `getUserMedia` bằng `MediaStream` dựng từ WAV                                                                                         |
| Extension trên cuộc gọi thật            | `pnpm --filter extension build` → load unpacked `.output/chrome-mv3`                                                                                                                    |

**Mẫu số của coverage phải độc lập với gate.** `vad-reference.mjs` dùng ngưỡng suy
từ phân bố năng lượng của **cả file** cộng hysteresis và luật thời lượng tối thiểu —
không phải sàn thích nghi kiểu streaming của `SpeechGate`. Lấy mẫu số từ chính gate
sẽ khiến tiếng mà gate bỏ sót rời khỏi **cả** tử số lẫn mẫu số, và một gate không
nghe được gì sẽ đạt 100%.

Nhật ký kỹ thuật chi tiết của hai ngày benchmark: `docs/journals/`.
Kiến trúc hiện hành: `docs/system-architecture.md` · `docs/codebase-summary.md`.

**Lưu ý khi trích số vào luận văn:** mọi số benchmark cô lập (RTF 0,017 · Kokoro
p95 1,18 s) đo trên máy này lúc rảnh. Vòng partial chạy nền đã đổi điều kiện đo —
không trộn số benchmark cô lập với số của luồng realtime trong cùng một bảng mà
không ghi rõ điều kiện.
