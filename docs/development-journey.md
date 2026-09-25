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

`POST /translate` (REST, đồng bộ) **giữ nguyên hành vi** — là **đối chứng đo đạc
cho luận văn**, không được sửa. Trang `/translate/baseline` từng là chỗ bấm tay
để chạy đối chứng đó; trang đã bị xoá cùng `/translate/live` khi dọn web, còn
endpoint thì không đụng tới. Số liệu độ trễ trong tài liệu này đo bằng
`benchmarks/realtime`, không đo qua trình duyệt.

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

Bản ghi từng câu đổi đã gỡ khỏi repo cùng cây `plans/`. Chạy lại được:
`benchmarks/stt/` — `uv run python run_benchmark.py --decoder-arms`.

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

Bản ghi chi tiết đã gỡ khỏi repo cùng cây `plans/`. Audio là dữ liệu cá nhân nên
không commit, vì vậy phép đo này không tái lập độc lập được — con số ở trên là
tất cả những gì còn lại của nó.

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

### 3.14 Bỏ model khỏi đường hiển thị: ITN tất định trong tiến trình (29/08)

§3.13 đo được một bản sửa **chạy đúng** nhưng bị bác bỏ, và lý do không phải
độ chính xác mà là **thời điểm**: trên 22 câu, trung vị **25,1 s**, tối đa
**92,6 s**, và **tối thiểu 10,0 s** — không một lần nào kịp trong 10 giây. Người
đọc đã đi qua dòng đó từ lâu. Câu hỏi đặt ra ban đầu là _"Không thể nào nói phát
text hiển thị đúng luôn mà không cần phải sửa sao?"_, và câu trả lời hóa ra là:
**bộ nhận dạng thì không bao giờ, nhưng phần hiển thị thì được — mà không cần
model nào cả.**

Chữ số được sinh **tất định, trong tiến trình, trước khi dòng chữ được vẽ ra**.
Không mạng, không API key, không sự kiện thứ hai.

| Chỉ số            | Baseline | LLM (§3.13)         | **ITN**            |
| ----------------- | -------- | ------------------- | ------------------ |
| recall chữ số     | 0,0000   | 0,8810              | **1,0000** (42/42) |
| chữ số bịa ra     | 0        | 0                   | **0**              |
| F1 dấu câu        | 0,0000   | 0,7222              | **0,0000**         |
| hoa danh từ riêng | 0,0000   | 0,8636              | **0,0000**         |
| độ trễ mỗi lượt   | —        | 25,1 s (max 92,6 s) | **0,21 ms** p95    |

**Hai chỉ số tệ đi, và chúng nằm trong bảng vì đúng là chúng tệ đi.** Dấu câu và
hoa danh từ riêng về 0: `Phạm Văn Bạch` hiển thị thành `phạm văn bạch`. ITN chỉ
sắp chữ số và không đụng gì khác. Đó là cái giá đã chấp nhận trước khi làm, không
phải sơ suất phát hiện sau.

**Ba tầng bằng chứng, không được gộp** — viết "đã kiểm chứng trên dữ liệu
held-out" là nói quá tầng yếu nhất:

| tầng                                         | chứng minh được gì            | giới hạn                                                      |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| in-sample (22 câu)                           | recall đạt được               | một giọng; ITN được viết khi đang đọc chính bộ này            |
| held-out âm tính (50 VIVOS + 50 LibriSpeech) | **không bịa chữ số**          | cả hai tham chiếu 0 chữ số ⇒ không chấm được recall           |
| held-out round-trip (59 vi + 26 en, văn bản) | recall trên dữ liệu chưa thấy | **không chứa lỗi nhận dạng** — đo ngữ pháp, không đo pipeline |

Held-out recall: **vi 1,0000 (59/59), en 1,0000 (23/23), 0 chữ số bịa.**

Chín câu trong đó cố ý không mang chữ số nào. Một dòng có tham chiếu 0 chữ số thì
không chấm được recall và chỉ có thể trượt — đúng là thứ cần để canh một cách đọc
đã từng sai: `mười năm` thành 15, `open twenty four seven` thành 2047, `no one
came` thành `no 1 came`, `a hundred and twenty` thành `a hundred and 20`, `năm hai`
thành 52.

**Tiếng Anh không có số in-sample nào cả.** Không tồn tại bộ tham chiếu hiển thị
tiếng Anh, và 50 câu moonshine held-out chứa 0 chữ số — chấm được hallucination
nhưng không chấm được recall. Recall tiếng Anh chỉ dựa trên bộ round-trip văn
bản. Đây là chỗ yếu nhất của toàn bộ phần này; trích phải nói rõ.

WER VIVOS **không đổi: 5,38%** (CER 2,90%), chạy lại sau khi sửa. Bắt buộc phải
vậy — ITN không bao giờ chạm vào `sourceText`, thứ duy nhất WER đọc.

#### Ba tầng đo bắt được ba loại lỗi khác nhau

Đây là lập luận cho việc xây cả ba, chứ không phải một:

- **In-sample** bắt lỗi ngữ pháp: `tháng chín năm một chín bốn năm` bị đọc thành
  tháng 951945, và `mười` đứng một mình không phân tích được nên mọi `mười giờ`
  mất đồng hồ.
- **Held-out âm tính** bắt **4 lỗi bịa số**, không lỗi nào với tới được từ 22 câu
  in-sample: `MƯỜI MỘT MƯỜI HAI MƯỜI BA` → `43` (ba số nhập thành một số thứ tư
  không ai nói), `PHÒNG BA LE HAI` → `PHÒNG 3 LE 2` (tên riêng), `CHỊ HAI` →
  `CHỊ 2` (cách xưng hô theo thứ tự sinh), `HAI CHA CON` → `2 CHA CON` (thành ngữ).
- **Held-out round-trip** bắt thêm **4 lỗi nữa** mà hai tầng kia không thấy:
  `850.000 đồng một đêm` → `đồng 1 đêm` (đơn vị của số TRƯỚC lại bảo lãnh cho số
  SAU), `hai nghìn không trăm hai mươi sáu` → `2000` cụt đuôi (hai lần: trong năm
  và trong ngày tháng), và `nineteen ninety eight` không bao giờ ra 1998.

Mỗi luật sửa đều phát biểu được bằng một sự thật về ngôn ngữ, không phải bằng một
dòng dữ liệu: `mười` không nhận số nhân (`hai mười` không phải tiếng Việt);
một số đơn độc cần bằng chứng bên cạnh, và số **nhập nhằng** cần loại từ thật chứ
không phải danh từ vị trí (`phòng`, `tầng`) — vì tiếng Việt đặt tên phòng và tên
người theo thứ tự sinh; bằng chứng đọc từ **bên phải** vì loại từ đứng sau số;
`không` chỉ nằm trong số khi có từ bậc theo sau (`không trăm` là hàng trăm rỗng
của mọi năm 2001–2099, còn `không đủ` là phủ định).

#### Cái đắt nhất không phải là recall

`không` vừa là **số 0** vừa là **phủ định** thông dụng nhất. Số hóa nó không làm
sai một câu — nó **đảo ngược** câu đó, trên màn hình, bằng chính lời người nói,
và không có gì đánh dấu. Vì vậy toàn bộ thiết kế chạy theo một luật:

> **Một vùng ứng viên sinh ra đúng một chữ số, hoặc không sinh gì. Không bao giờ
> sinh một mảnh.**

Nhập nhằng biến thành **mất recall**, không bao giờ thành chữ số sai. Bản mẫu
trước đó ra `2.000 500` cho `hai nghìn năm trăm` chính vì đã in ra phần nó hiểu
được khi phần còn lại không ghép vào.

#### Hệ quả kèm theo

- **`gemma-4-31b-it` rời khỏi hệ thống hoàn toàn** — mọi danh sách model, prompt,
  benchmark và tài liệu. Đường hội thoại vốn đã không có nó; nó chỉ còn tồn tại
  để đỡ request sửa hiển thị. `POST /translate` nay chỉ còn hai model flash và
  **báo lỗi rõ ràng** khi hết quota, thay vì trả lời chậm bằng model 6,9 s trong
  khi bảng số giả định 553 ms.
- **Bỏ đi một bề mặt tấn công, không phải giảm độ phủ.** 9 case prompt-injection
  "viết lại cùng ngôn ngữ" bị xóa vì bề mặt đó không còn: không còn prompt nào
  trên đường hiển thị. Câu trả lời bị tiêm vào một bản _dịch_ lộ ra vì sai ngôn
  ngữ; bị tiêm vào một bản _sửa_ thì không — nó là câu trôi chảy, đúng ngôn ngữ,
  nằm đúng chỗ lời người nói. Đặt model trở lại đường đó thì phải đặt lại 9 case.
- **Phép đo hiển thị lần đầu chạy được trong CI.** Bước 2 cũ tốn quota thật nên
  không bao giờ chạy tự động được; bước 2 mới tốn 0,21 ms và không cần key, nên
  các cổng held-out nay chạy mỗi lần push.

Tái lập: `benchmarks/stt/` — `dump_display_hypotheses.py` →
`node scripts/itn_display_hypotheses.mjs` →
`score_display_repair.py --input data/display-itn.jsonl --field itn --no-guard`;
cổng held-out: `itn_holdout_check.mjs`, `itn_roundtrip_recall.mjs`. Không cần API
key. Audio là dữ liệu cá nhân, **không commit**; hai bộ held-out **có commit**.

### 3.15 Sửa mất nội dung trên đường lượt: chẩn đoán bằng số đo prod (12–13/09)

**Triệu chứng.** Trên bản deploy prod (`ssh.quanganh208.dev`), người dùng một
mình / một tab báo STT "quá chậm, mất từ mất nội dung rất nặng" trong khi CPU
và RAM gần như rảnh.

**Chẩn đoán — mọi con số đo read-only trên prod.** STT đơn lượt không chậm: clip
6–8 s decode trong 70–200 ms (RTF ≈ 0,012–0,025). Cái chậm là **chuỗi nhân quả
của lượt đơn người dùng**, không phải lock:

1. Gemini không có timeout nào (p50 723 ms, **max 8943 ms** đo trong repo).
2. Lượt chậm giữ slot; `MAX_IN_FLIGHT = 3` đầy; server từ chối `too_many_turns`.
3. Client retry 4 × 750 ms rồi **vứt cả buffer đang chờ** — một `console.warn`,
   màn hình không có gì.
4. Đến 4 speculation không hủy được mỗi lượt, mỗi cái một decode full-turn cộng
   một request Gemini đúng hạn mức — vừa đẩy queue vừa đốt quota làm bước 1 tệ
   thêm.

Bên cạnh đó, sidecar **tuần tự hóa mọi decode sau một `threading.Lock` mỗi
engine** — 6 request đồng thời mất đúng wall time của 6 lượt nối tiếp (bậc thang
FIFO 6×), máy 72% rảnh, CPU đỉnh 447% một nhân. Đây là trần cho đa người dùng,
không phải nguyên nhân triệu chứng một người. Cloudflare tunnel được miễn tội:
steady-state trên connection tái dùng là 55–64 ms; con số 207/978 ms ban đầu là
bắt tay TLS/QUIC mỗi connection.

**Vật mang theo (PR #132, 5 commit).**

- **Deadline cho mọi call outbound**: 6 fetch provider qua `fetchWithDeadline`
  (STT/embed/voices 5 s, TTS 15 s, ElevenLabs 30 s) + Gemini
  `httpOptions.timeout` 20 s. Một dependency kẹt hỏng một lượt thay vì ghim 1/6
  slot toàn cục.
- **Kế toán trung thực phía client**: `sentMs`/`sequence` chỉ tăng khi frame
  thật rời socket; frame bị từ chối giữ lại và gửi lại đúng thứ tự; audio mồ côi
  có counter + log; lượt rơi ở pending ceiling hiện marker "unheard".
- **Lane semaphore cho sidecar**: lock → `Semaphore(4)` qua **một** recognizer
  duy nhất. Thí nghiệm 120 decode đồng thời qua một recognizer cho transcript
  **giống hệt byte** ở cả hai engine — pool bản sao recognizer (223/418 MB mỗi
  bản) không cần, rủi ro OOM triệt tiêu. Bão hòa trả 503 sau 2 s chờ, không
  xếp hàng vô hình.
- **Cadence partial giãn theo chi phí decode**: `max(300 ms, 3 × lastDecodeMs)`
  — kết luận repo tự đo từ trước nhưng chưa từng implement.

**Hai giả định bị số đo bác bỏ.** Cap speculation 1-in-flight làm 4 spec hỏng —
blocking renewal giết đúng guess tái dùng được (đo 870 ms head start); revert.
Nâng `LOCAL_STT_THREADS` 4→8: chậm hơn ~25%, đốt 3× CPU (1325%) —
oversubscription intra-op ONNX; sweep 1/2/3/4/8 xác nhận 4 tối ưu, revert.

**Trước / sau — cùng điều kiện** (en→vi, một người / một tab, đầu ra tắt tiếng,
session thật trên prod; baseline 29 lượt 13/09 09:35, sau fix 104 lượt 13/09
10:06, cùng sink `TURN_METRICS_PATH`):

| Chỉ số                          | Trước              | Sau                                 | Mục tiêu |
| ------------------------------- | ------------------ | ----------------------------------- | -------- |
| Dứt lời → chữ dịch đầu, **p50** | 1180 ms            | **953 ms**                          | —        |
| **p95**                         | 4264 ms            | **1448 ms** ✅                      | ≤3500 ms |
| max                             | 4702 ms            | **3969 ms**                         | —        |
| Lượt `rejected` + `dropped`     | 0 + 0              | **0 + 0** ✅                        | 0        |
| `heldMs`                        | 0                  | **0** ✅                            | ≤2%      |
| Lượt bị cắt ở ceiling           | 48% (14/29)        | **21%** (22/104)                    | —        |
| Probe sidecar 6-deep, CPU đỉnh  | 1,03× serial, 447% | 0,66–0,90× serial, **940–1513%** ✅ | ≥550%    |

Lưu ý đọc bảng: (1) ratio probe 6-deep chưa đạt mục ≤0,60× — một session ONNX
duy nhất có pool 4 thread intra-op, 4 decode đồng thời chia sẻ đúng pool đó;
sweep threads 1/2 cho ratio 0,61–0,70× nhưng wall tuyệt đối tệ hơn, nên **giữ
threads=4**: đúng tải thật (một người ≤2 decode chồng lấn) thì gain là thật, tường
thứ 5+ là tranh chấp pool intra-op, không phải lock. (2) 5 lượt `error` sau fix
đều là "No speech detected" (gate mở do tiếng ồn, captured ~500 ms) — lành tính,
cùng loại 2 lượt lỗi của baseline. (3) Capture ratio không tính được vì không có
bản ghi âm session làm mẫu số; mọi kênh mất có đo được đều = 0. (4) Rate mỗi
model sau fix 22,6 / 33,5 req/min so với trước 21,7 / 28,8 — nhu cầu Gemini
**không bị cắt ngầm**, đúng chiều mong muốn.

Ghi chú vận hành: CD không truyền `-f` override nên bind mount turn-metrics phải
gắn lại tay sau mỗi deploy (`~/.config/chatofy/turn-metrics.override.yml` từ
checkout runner `~/actions-runner/_work/chatofy/chatofy`).

Tái lập: `benchmarks/realtime/analyze-continuous.mjs` trên hai file
`~/chatofy-metrics/turn-metrics-prefix-baseline-20260913.jsonl` và
`turn-metrics.jsonl` trên prod; probe concurrency:
`python3 /tmp/stt-concurrency-probe.py clip.wav en 6 3` trên prod (script đọc
`cpu.stat` cgroup v2 lấy mẫu CPU trong lúc burst).

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

**Kết luận trên đã bị thay — 2026-09-16.** Nó đúng với thiết kế lúc đó, và cổng
duty (`interval = max(300ms, decode × 2)`) là hiện thực của nó. Một phiên nói
thật cho thấy cái giá: nhịp chữ rơi từ 3,3 xuống 1,7 lần/giây **trong lòng một
câu** khi người ta nói dài, vì mỗi lần đọc partial giải mã lại toàn bộ cửa sổ nên
chi phí tăng theo độ dài câu, rồi phép nhân đôi nó lên.

Đo lại trên lời nói **dày** — bảng cũ dùng clip lẻ, không chạm tới buffer 8–9 s:

| Buffer | vi p50 | en p50 | gate ×2 | nhịp | gate ×1 | nhịp |
| ------ | ------ | ------ | ------- | ---- | ------- | ---- |
| 1 s    | 55 ms  | 102 ms | 300 ms  | 3,33 | 300 ms  | 3,33 |
| 5 s    | 107 ms | 210 ms | 420 ms  | 2,38 | 300 ms  | 3,33 |
| 9 s    | 152 ms | 289 ms | 579 ms  | 1,73 | 300 ms  | 3,33 |

Tiếng Anh đạt đỉnh **289 ms ở buffer 9 s** — lượt dài nhất client gửi — vẫn dưới
sàn 300 ms. Thứ tạo ra sự chậm dần là **phép nhân**, không phải chi phí giải mã.
`PARTIAL_DUTY_DIVISOR` về **1**; nhịp phẳng ở mọi độ dài câu.

Đánh đổi, nói thẳng: ở divisor 1 trần duty **biến mất** (khoảng cách tính từ lúc
bắt đầu, nên `d × 1` đã trả xong khi lần đọc kết thúc). Đo áp lực lane với hai
người nói cùng lúc + lượt cuối + TTS liên tục: 388 request, **503 = 0**.

Một thiết kế **cửa sổ trượt + khâu theo chồng lấp chữ** đã được cân nhắc và bị
cổng đo bác trước khi viết dòng code sản phẩm nào: Moonshine có sàn chi phí cố
định nên thu nhỏ cửa sổ không cứu được, và khâu sai 15% (vi) / không nối 37%
(en), vì cửa sổ mở giữa chừng một từ thì bộ nhận dạng trả về một từ **khác** chứ
không phải một từ cụt. Bản ghi chi tiết đã gỡ khỏi repo cùng cây `plans/`;
probe sinh ra các số này vẫn còn ở
`benchmarks/stt/scripts/streaming-arms/overlap_probe.py`, kết quả thô ở
`benchmarks/stt/results/r8-overlap/`.

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
| Giọng thật, 3 đường thu (§3.11)         | Audio là dữ liệu cá nhân, **không commit** — số liệu không tái lập độc lập được. Bản ghi cách đo đã gỡ cùng cây `plans/`; §3.11 giữ lại con số và kết luận                              |
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

---

## ZeroTTS vs VieNeu v3 Turbo — benchmark TTS tiếng Việt (14/09/2026)

> **Phần này đã bị phần 15/09 bên dưới thay thế ở các mục tốc độ, TTFA và độ tái
> lập.** Lần đo 14/09 so hai engine trên điều kiện không cân: ZeroTTS có seed và
> đo streaming, VieNeu không seed và bị đo TTFA bằng cách cắt mệnh đề trong khi
> engine có sẵn API streaming. Giữ lại nguyên văn vì đó là lịch sử của phép đo.

**Điều kiện đo khác mọi số ở trên: máy này giờ chạy Ubuntu**, không còn Windows 11
như phần đầu tài liệu ghi. Cùng CPU i7-11700K, 8 luồng, `onnxruntime` 1.27.0 ghim
cứng cho cả hai engine. Đừng trộn số dưới đây vào bảng cũ mà không ghi rõ điều này.

Harness: `benchmarks/tts-vi/`. Báo cáo đầy đủ: `benchmarks/tts-vi/results/report.md`.

### Phát hiện quan trọng nhất không nằm trong bảng so sánh

**Cả hai engine đều dao động rất mạnh giữa các lần chạy với cùng đầu vào.** Việc
này không nằm trong kế hoạch và có ý nghĩa sản phẩm lớn hơn cả câu hỏi ban đầu.

| Engine / giọng      |   n | trung vị | trung bình | thấp nhất | cao nhất | **dao động** |
| ------------------- | --: | -------: | ---------: | --------: | -------: | -----------: |
| zerotts / baotrang  |   8 |     9,55 |      14,12 |      6,98 |    36,34 |   **29,4pp** |
| zerotts / quangminh |   8 |     7,19 |       8,24 |      4,31 |    17,04 |   **12,7pp** |
| vieneu / Mai Anh    |   6 |    20,02 |      22,28 |     16,43 |    36,96 |   **20,5pp** |
| vieneu / Thanh Bình |   6 |    16,32 |      17,93 |     12,73 |    30,39 |   **17,7pp** |

WER corpus %, bộ hội thoại 41 câu, thước đo PhoWhisper-small. Các lần của ZeroTTS
khác nhau ở seed; các lần của VieNeu chỉ là lặp lại, vì nó không có seed để chỉnh
mà vẫn khác nhau.

**VieNeu là engine đang chạy production**, và WER của nó trượt từ 16,4% tới 37,0%
trên cùng 41 câu mà đầu vào không đổi. Đây là thuộc tính độ tin cậy của hệ thống
đang chạy, chưa từng được ghi lại ở đâu trong repo này.

Nguyên nhân hai bên khác nhau. ZeroTTS lấy mẫu từ `np.random` toàn cục mỗi frame,
nên biến thiên đến từ bộ lấy mẫu; seed ghim lại được hoàn toàn (41/41 byte giống
hệt). VieNeu không có bộ lấy mẫu nào mà vẫn cho output khác nhau từng byte (0/41).
Chưa giải thích được.

### Độ rõ tiếng — ZeroTTS thắng, xét theo phân phối

| So sánh                       | lệch trung vị |          95% CI | tách bạch | P(một lần ZeroTTS thắng một lần VieNeu) |
| ----------------------------- | ------------: | --------------: | --------- | --------------------------------------: |
| nữ — baotrang vs Mai Anh      |  **−10,47pp** | [−20,33; −0,21] | có        |                               **83,3%** |
| nam — quangminh vs Thanh Bình |   **−9,14pp** | [−16,94; −4,83] | có        |                               **90,6%** |

Số âm nghĩa là ZeroTTS tốt hơn. Cả hai khoảng tin cậy đều không chứa 0.

**Nhưng hai phân phối chồng lên nhau:** lần tệ nhất của ZeroTTS (36,34%) còn tệ
hơn lần tốt nhất của VieNeu (16,43%). "ZeroTTS dễ nghe hơn" là phát biểu về trung
vị, không phải bảo đảm cho từng câu.

**Bài học phương pháp.** Lần chạy chính chỉ đo mỗi arm một lần, ra −9,03pp và
−8,42pp — chênh chưa tới một điểm so với −10,47 và −9,14 của phân phối đầy đủ.
Con số tình cờ đúng, nhưng **không có cơ sở để tin nó**: seed đã dùng cho ra 6,98%
và 6,78% trong khi trung vị là 9,55% và 7,19%, tức rơi vào phía thuận lợi của cả
hai phân phối. Seed làm phép đo _tái lập được_, không làm nó _đại diện_.

### Tốc độ — VieNeu thắng, hai dải không giao nhau

|                       |           VieNeu |           ZeroTTS |
| --------------------- | ---------------: | ----------------: |
| RTF                   |  **0,507–0,726** |       0,782–0,799 |
| p50 mỗi câu           |  **1,42–1,84 s** |       1,94–2,11 s |
| Thời gian nạp         |  **1,73–1,98 s** |       3,98–4,14 s |
| RAM đỉnh              | **1425–1542 MB** |      1670–1690 MB |
| Tốc độ nói (audio/từ) |    0,231–0,255 s | **0,207–0,222 s** |

ZeroTTS nói nhanh hơn, mà RTF thì chuẩn hóa theo thời lượng, nên sinh audio ngắn
hơn cho cùng số từ lại bị tính là bất lợi.

### TTFA — chỗ dễ kết luận sai nhất

| Arm                                     |      chunk đầu |                    hụt tiếng | **tới âm liền mạch** |
| --------------------------------------- | -------------: | ---------------------------: | -------------------: |
| ZeroTTS streaming                       | **138–140 ms** | +766…+798 ms (tệ nhất +1235) |       **910–938 ms** |
| **VieNeu cắt mệnh đề** (đang chạy thật) |              — |                            — |      **842–1256 ms** |
| VieNeu cả câu (chỉ tham chiếu)          |   1423–1842 ms |                            — |                    — |

ZeroTTS ra âm đầu sau ~140 ms — quảng cáo 70 ms đúng về hướng. Nhưng chunk đầu chỉ
dài 80 ms audio, engine chưa sinh kịp thời gian thực ở đầu luồng, nên người nghe
hụt tiếng. Tới lúc phát liền mạch là **~911 ms**, nằm trong dải VieNeu cắt mệnh đề
— **không tách bạch**. **9/164 luồng** có tổng thời gian sinh vượt thời lượng audio.

Nếu chỉ báo cáo chunk đầu, kết luận sẽ là "nhanh gấp 7 lần". Sai.

**Phải so với arm cắt mệnh đề**, vì app đã cắt mệnh đề trước khi đưa vào engine;
lấy số cả câu làm mốc sẽ thổi phồng incumbent khoảng 1,7 lần.

### Đối chiếu số nhà cung cấp

| Công bố           | Đo được                                        | Kết luận                                                                  |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| 70 ms tới mẫu đầu | 138–140 ms chunk đầu; **911 ms tới liền mạch** | Đúng một nửa                                                              |
| RTF 0,50×         | **0,78–0,80**                                  | Không tái lập được                                                        |
| WER 1,03%         | trung vị 7,2–9,6%                              | **Không so được** (họ dùng PhoWhisper-large + whisper-large-v3 lấy `min`) |
| UTMOSv2 2,91      | cố ý không đo                                  | —                                                                         |

### Giấy phép — đã tra ra, và **không** phân định được ai hơn

VieNeu v3 Turbo là **Apache-2.0** cả code lẫn weights, model card cho phép dùng
thương mại audio từ giọng preset. ZeroTTS là MIT. Dòng "see upstream" trong
`README.md` chỉ lỗi thời, không phải rủi ro — đã sửa.

### Kết luận: **HOÃN** — chưa thay, chờ panel MOS

ZeroTTS dễ nghe hơn (trung vị thấp hơn 9–10pp, thắng 83–91% số cặp so ngẫu nhiên)
nhưng chậm hơn rõ. Thứ còn thiếu là **độ tự nhiên**, chưa từng đo cho engine nào.
Câu hỏi quyết định: trong panel mù của `benchmarks/mos` trên chính các WAV đã giữ,
ZeroTTS có nghe tự nhiên ít nhất bằng VieNeu không?

Câu hỏi đáng theo đuổi hơn cả việc thay engine: **vì sao VieNeu dao động 16,4–37,0%
WER giữa các lần chạy** dù không có bộ lấy mẫu nào? Đó là hệ thống đang chạy thật.

---

## Đo lại trên điều kiện cân bằng — cả hai engine cùng seed, cùng streaming (15/09/2026)

Lần đo 14/09 có hai lỗi harness, cả hai đều bất lợi cho engine đang chạy. Bản
`vieneu` 3.3.0 **có bộ lấy mẫu** (`temperature=0.8, top_k=25, top_p=0.95,
repetition_penalty=1.2` — đúng mặc định ZeroTTS dùng) và **có `infer_stream`**.
Adapter cũ ghi `"seed": None, "stochastic": False`, `supports_streaming = False`.

Đã sửa harness rồi chạy lại toàn bộ: seed chung `measure.SEED` cho cả hai engine,
cả hai cùng đo streaming, và hâm nóng luôn đường streaming trước khi bấm giờ
(trước đây chỉ hâm `synthesize`, nên chi phí gọi lần đầu của bộ giải mã streaming
rơi vào chính con số `stream_ttfa_s`). Số cũ giữ ở
`benchmarks/tts-vi/results/unseeded-baseline/`.

### TTFA — chỗ đảo ngược kết luận

Bộ hội thoại 41 câu, trung vị, ms. "Liền mạch" = chunk đầu cộng mức tụt hậu tệ
nhất sau đó, tức thời gian player phải đệm trước khi chạy hết câu mà không khựng.

| Arm                                 |   chunk đầu | tụt hậu trung vị | **tới âm liền mạch** | số luồng bị hụt tiếng |
| ----------------------------------- | ----------: | ---------------: | -------------------: | --------------------: |
| **VieNeu streaming**                |     221–257 |         −119…−92 |          **221–257** |                20/164 |
| VieNeu cắt mệnh đề (đang chạy thật) |           — |                — |             781–1193 |                     — |
| ZeroTTS streaming                   | **144–153** |   **+796…+1134** |             937–1281 |           **164/164** |
| ZeroTTS cắt mệnh đề                 |           — |                — |            1232–1476 |                     — |

ZeroTTS ra mẫu đầu sớm hơn ~100 ms rồi **hụt tiếng ở cả 164/164 luồng**, trung vị
tụt 0,8–1,1 giây. VieNeu chạy _trước_ người nghe khoảng 100 ms và tới âm liền mạch
nhanh hơn 4–5 lần.

**Con số đáng giá nhất cho sản phẩm không phải chuyện đổi engine:** chính VieNeu
đang chạy, nếu gọi `infer_stream` thay vì cắt mệnh đề, rút thời gian chờ từ
781–1193 ms xuống 221–257 ms — nhanh gấp 3–5 lần, không đổi engine.

### Tốc độ và độ tái lập

|               |           VieNeu |      ZeroTTS |
| ------------- | ---------------: | -----------: |
| RTF           |  **0,497–0,641** |  0,865–0,977 |
| p50 mỗi câu   |  **1,26–1,86 s** |  2,09–2,41 s |
| Thời gian nạp |  **1,72–1,83 s** |  4,09–4,54 s |
| RAM đỉnh      | **1544–1622 MB** | 1647–1702 MB |

**Độ tái lập giờ là hòa.** Cùng seed, r1 và r2 giống nhau từng byte: 41/41 bộ hội
thoại, 50/50 bộ VIVOS, chạy ở hai tiến trình khác nhau. Kết luận cũ "ZeroTTS
41/41, VieNeu 0/41" là thuộc tính của harness, không phải của engine.

Hai chi tiết giữ lại: đầu ra streaming của VieNeu không giống nhau từng byte dù
cùng seed, nhưng lệch tối đa **1,5e-06** (dưới 1 LSB của 16-bit) vì `infer_stream`
chia chunk theo `time.perf_counter()`; và với WAV giống hệt nhau, WER vẫn xê dịch
**0,2pp** giữa hai lần chấm — đó là nhiễu của chính bộ chấm ASR.

### Độ rõ tiếng — ZeroTTS vẫn thắng, nhưng đừng trích số của một seed

| Arm                 | WER seeded r1 | WER seeded r2 | trung vị theo phân phối seed |
| ------------------- | ------------: | ------------: | ---------------------------: |
| ZeroTTS / baotrang  |         6,78% |         6,98% |                       10,27% |
| ZeroTTS / quangminh |         6,78% |         6,78% |                        7,60% |
| VieNeu / Mai Anh    |        29,16% |        29,16% |                       21,97% |
| VieNeu / Thanh Bình |        14,78% |        14,99% |                       16,63% |

Seed chung 20260914 rơi đúng vào lần rút **tốt nhất trong 8** của `baotrang` và
vào đuôi xấu của `Mai Anh`. Vì vậy khoảng cách 22pp ở giọng nữ trong bảng trên là
ảo; **khoảng cách theo trung vị vẫn là ~10pp (nữ) và ~9pp (nam)** như báo cáo cũ.
Seed làm phép đo _tái lập được_, không làm nó _đại diện_.

### Kết luận: **GIỮ VieNeu, và chuyển sang streaming**

Với mục tiêu realtime không độ trễ, chiều quyết định là thời gian tới âm liền
mạch, và chiều đó không ủng hộ ZeroTTS: trên CPU này nó không stream tiếng Việt
được mà không khựng, không phải thỉnh thoảng mà là mọi luồng. ZeroTTS chỉ còn
thắng ở độ rõ tiếng.

Việc nên làm tiếp trong sản phẩm, không phụ thuộc chuyện đổi engine: cho
`services/local-tts` gọi `infer_stream`, seed lời gọi đó, và xem lại bộ cắt mệnh
đề ở `apps/api/src/modules/translate/audio/clause-splitter.ts` — nó sinh ra để né
đúng cái API streaming mà engine vốn có.

Báo cáo đầy đủ đã gỡ khỏi repo cùng cây `plans/`. Kết luận và các con số
quyết định nằm ngay trên đây; harness và kết quả thô chạy lại được ở
`benchmarks/tts-vi/`.

## Biasing ngữ cảnh: mở lại câu hỏi decoder bằng một cuộc hội thoại thật (18/09/2026)

Mục 3.10 đã đóng câu hỏi decoder ngày 28/08 với kết luận **ở lại greedy**, đo trên
50 câu VIVOS. Mục này không lật kết luận đó — nó chỉ ra thứ bộ test ấy **không thể**
nhìn thấy, và thêm một nhánh chỉ chạy khi người dùng tự khai từ.

### Lỗi không nằm trong bộ test nào

Phân tích một cuộc hội thoại production có đủ file ghi âm (`f35c2816`, 4:30, 53
lượt, vi→en) bằng một bản transcript đối chứng độc lập: **mọi lỗi nghiêm trọng đều
là chuyển ngữ**. Engine tiếng Việt không có đường ra cho từ tiếng Anh, nên nó sinh
âm tiết Việt nghe gần nhất, rồi khâu dịch coi đó là tiếng Việt thật và "sửa" thành
tiếng Anh trôi chảy nhưng sai nghĩa:

| Nói thật                         | Ghi được                                    | Người đọc thấy                  |
| -------------------------------- | ------------------------------------------- | ------------------------------- |
| "một cái giải **poker**"         | "một cái giải **quốc cơ**"                  | "a national championship"       |
| "thực tập ở siêu thị **Target**" | "siêu thị **ta ghép** … search **ta ghét**" | recovered by chance             |
| "tôi đi học ngành **retail**"    | "tôi đi học ngành **vì theo**"              | "I studied this major because…" |
| "Yo what's up baby"              | "Dấu sắp bệnh tật"                          | "Signs of impending illness"    |

VIVOS là giọng đọc, không chuyển ngữ — 0/50 câu có thể chứa lỗi này. Đó là lý do
nhánh beam-hotwords ngày 28/08 chỉ mua được 0,72 điểm WER: nó đang đo sai loại lỗi.
WER cũng gần như không thấy lớp lỗi này: "poker" là **một** từ trong 867, nhưng mất
nó thì cả câu đổi nghĩa.

### Đo lại, hai harness, cùng một hướng

Trên 53 cửa sổ lượt của chính cuộc hội thoại đó, so với transcript đối chứng. Hai
harness không so chéo được với nhau (một bên nạp mẫu float trực tiếp, một bên đi qua
HTTP + PyAV), nên mỗi bảng chỉ so trong nội bộ nó.

Harness trong tiến trình:

| Nhánh                                 | WER   | RTF    |
| ------------------------------------- | ----- | ------ |
| greedy (đang ship)                    | 0,150 | 0,0171 |
| beam, không hotword                   | 0,137 | 0,0248 |
| beam + 13 cụm hợp với cuộc này @1,5   | 0,136 | 0,0233 |
| beam + **28 từ tiếng Anh thông dụng** | 0,148 | —      |
| beam + **20 từ dài, dễ phân biệt**    | 0,150 | —      |

Harness qua endpoint, đúng đường code sẽ ship:

| Nhánh                        | WER   | RTF            |
| ---------------------------- | ----- | -------------- |
| không bias (greedy)          | 0,159 | 0,0225         |
| bias bằng 4 cụm của cuộc này | 0,142 | 0,0306 (1,36×) |

**Danh sách nền cố định là lỗ.** Đây là kết quả đáng ghi nhất: bias về phía một từ
không ai nói thì phải trả bằng tiếng Việt thật — "giải quốc cơ" thành "giải ok", "nó
là" thành "đó là", "tai nghe nào" thành "tai nghe là". 10/53 câu bị đổi, phần lớn xấu
đi, và không cứu được gì vì tiếng Anh người này dùng là vốn từ riêng của anh ta chứ
không phải từ thông dụng của ai.

**Danh sách do người dùng khai thì lãi.** Cùng 4 cụm: "giải poker" và "siêu thị
target … search target" về đúng, và WER toàn tập giảm 1,7 điểm trong cùng harness.

### Quyết định

`greedy_search` **vẫn là mặc định** — một lượt không khai cụm nào giải mã y hệt hôm
qua, nên mọi con số đã công bố cho engine này vẫn mô tả đúng nó. Cạnh nó dựng thêm
một recognizer `modified_beam_search` có `hotwords_score=1,5`, **chỉ** được chọn khi
lượt đó mang theo cụm. Giá: **+59 MB RSS** (đo riêng: recognizer thứ nhất +91 MB,
thứ hai +59 MB) và RTF 1,36× cho riêng lượt có bias.

Nguồn cụm là `TranslationHints.hotwords` — trường đã tồn tại, client đã thu thập, và
xưa nay chỉ đi tới prompt dịch. Chính doc comment của nó viết "một hotword có chỗ
đứng chính vì recognizer nghe sai từ đó", trong khi recognizer chưa bao giờ nhận
được. Nay nó tới recognizer trước, rồi vẫn tới khâu dịch như cũ.

Ngưỡng 1,5 là dải đo được: ở 3,0 lực kéo làm hỏng chữ bên cạnh (cụm nhiều từ "FIRST
IN FIRST OUT" cắt cụt mệnh đề chứa nó). Lực kéo cũng lan sang chữ kề: danh sách có
"TARGET" mà thiếu "SEARCH" đứng cạnh thì chữ sau vỡ thành "SH" — nên một glossary tốt
nên phủ cả vùng tiếng Anh quanh cụm, chứ không chỉ riêng cụm.

Bản ghi chi tiết đã gỡ khỏi repo cùng cây `plans/`. Dải 1,5–2,0 và cả hai cảnh báo
trên nằm trong `services/local-stt/engines/zipformer_vi.py` (`HOTWORDS_SCORE`).
Arm hotword chạy lại được bằng `benchmarks/stt/` — `uv run python run_benchmark.py
--decoder-arms --run-tag r3-decoder-arms` — nhưng nó là trần lấy từ chính test set,
không phải phép sweep theo glossary đã cho ra dải này.

## Hai đầu cuộc hội thoại: chỗ lời nói lọt ra ngoài phiên (18/09/2026)

Cùng cuộc hội thoại production ở mục trên, nhưng lần này so **bản ghi âm với
transcript** thay vì so transcript với tai người. Hai đầu băng đều có tiếng nói
không nằm trong một lượt nào, và hai đầu có hai nguyên nhân hoàn toàn khác nhau.

### Đầu băng — thứ tự khởi động

`ConversationSession.start()` chạy `openMicrophone()` trước, rồi mới nạp worklet
và kết nối socket. `apps/web` gắn `MediaRecorder` ngay trong `openMicrophone`, nên
**ghi âm** bắt đầu ở await đầu tiên còn **thu để dịch** bắt đầu sau await cuối
cùng. Đo được trên cuộc này: `audioOffsetMs = 171`, cụm tiếng nói đầu ở media
0,00–1,70 s (RMS đỉnh 0,17, "Alo anh em"), lượt đầu tiên được lưu ở media 2,672 s.
Ít nhất 1,70 giây lời nói nằm trong file mà không nằm trong transcript.

Không phải lỗi speech gate: gate khởi tạo `noiseFloor = MIN_NOISE_FLOOR` (0,004) và
chỉ thích nghi khi im lặng, nên một cụm 0,17 RMS đã mở lượt ngay nếu có mẫu chảy tới.

Sửa hai nhịp, vì nhịp đầu đóng một khe thì mở ra một khe nhỏ hơn. Nhịp đầu dời
micro xuống cuối: hết cảnh ghi-mà-không-thu, nhưng lời nói trong lúc bắt tay socket
thì mất ở **cả hai** nơi. Nhịp hai nối worklet vào micro ngay khi micro mở — trước
cả khi socket tồn tại — và đệm các block vào một bộ đệm có trần (`MAX_PREBUFFER_MS`
20 s, bỏ cũ trước, cùng cỡ và cùng lý lẽ với `MAX_PENDING_MS` của pipeline). Khi
pipeline dựng xong thì phát lại bộ đệm theo đúng thứ tự rồi mới đổi sang handler
live, cả hai trong một mạch đồng bộ để không block nào lọt vào giữa.

### Đuôi băng — một lý do đóng lượt bị đọc nhầm là của server

`TurnPipeline` thử lại `too_many_turns` rồi tự bịa lý do đóng `'too_many_turns'`
cho một lượt chưa bao giờ có session id. `isServerReason()` chỉ loại trừ ba lý do
tự bịa — `never_started`, `dropped_pending`, `stopped` — nên lý do thứ tư bị đọc là
server xác nhận, `abandonTurn()` không chạy, và lượt biến mất không để lại dấu vết
nào: không dòng live, không nhãn abandoned, không hàng lưu. Trong khi recorder,
vốn trích micro độc lập, vẫn giữ nguyên tiếng nói đó.

Bằng chứng thời gian loại trừ giả thuyết drain 20 giây: `endedAt - startedAt` =
270,807 s so với `audioOffsetMs + audioDurationMs` = 270,817 s, lệch ~10 ms, tức
`stop()` chạy cùng nhịp với `finish()`.

Sửa hai phần. Một, thêm lý do đó vào danh sách loại trừ. Hai — vì báo cáo mất mát
không phải là không mất — nới hạn thử lại: trước đây `MAX_PENDING_MS` giữ audio 20
giây trong khi `MAX_REFUSAL_RETRIES` (4 lần × 750 ms) ngừng gửi ở giây thứ 3, tức
17 giây ôm thứ đã bỏ cuộc. Nay chỉ còn một hạn, đọc từ chính hằng số đang quản thời
gian sống của audio.

Điều **không** chứng minh được: vì sao có refusal ngay từ đầu. API giữ phiên trong
bộ nhớ và container đã restart, nên log đêm 16/09 không còn. Cơ chế mất thì không
phụ thuộc vào câu trả lời đó — bất kỳ lần cạn ngân sách nào cũng mất lượt lặng lẽ —
nhưng nguyên nhân kích hoạt vẫn để ngỏ.

### Vá lại hàng dữ liệu

Mọi bản sửa trên chỉ có tác dụng từ sau. Hai lượt thiếu của cuộc `f35c2816` được
cắt từ chính file ghi âm rồi cho chạy qua đúng pipeline của sản phẩm — sidecar
tiếng Việt cho `sourceText`, `gemini-3.5-flash-lite` cho `targetText` — và chèn vào
vị trí 0 và 54. Có `pg_dump` trước khi ghi, chèn trong một transaction, dịch vị trí
qua số âm vì unique index `(conversationId, position)`.

## TTS stream thật: VieNeu `infer_stream` vào đường live (21/09/2026)

Kết luận ngày 15/09 ("giữ VieNeu, và chuyển sang streaming") nay đã được làm. Trước
đây, API cắt bản dịch thành từng mệnh đề và chờ WAV nguyên của mỗi mệnh đề rồi mới
gửi byte đầu tiên. Giờ cả lượt được gửi một lần tới `POST /synthesize/stream`, và
PCM được đẩy ra WebSocket ngay khi engine sinh ra.

Mỗi model được xử lý như sau:

- **VieNeu:** stream theo frame qua `infer_stream`, có seed theo từng giọng.
- **Kokoro:** vẫn cắt mệnh đề, nhưng việc cắt nay nằm trong sidecar.
  sherpa-onnx chỉ ra audio ở ranh giới câu. Callback của nó trên 1.13.4 cũng
  ngược với docstring: trả về 0 là DỪNG. Vì vậy không dùng callback.
- **STT local:** không stream được. Cả hai bản export đều là non-streaming
  (`'non-streaming zipformer2'`, Moonshine encode cả đoạn).
- **Gemini dịch và Gemini Live:** đã stream sẵn.
- **Tóm tắt:** không cần stream.
- **ElevenLabs:** để ngoài phạm vi vì sắp bị gỡ.

### Seed theo giọng

Mỗi giọng quét 8 seed trên bộ 41 câu hội thoại (vieneu 3.8.1, PhoWhisper-small).
Seed được chọn chỉ giữ lại nếu thắng seed trung vị trên VIVOS, là tập giữ riêng.

| Giọng      | WER hội thoại (8 seed) |   Seed chọn | VIVOS: seed chọn / seed trung vị |
| ---------- | ---------------------: | ----------: | -------------------------------: |
| Mai Anh    |            6,37–13,35% |  11 (6,37%) |                  13,08% / 15,59% |
| Thanh Bình |           13,76–24,85% | 44 (14,78%) |                  13,44% / 18,82% |

Seed tốt nhất của Thanh Bình trên tập hội thoại là 11. Seed này thua seed trung vị
trên VIVOS 0,18 điểm (19,00% so với 18,82%). Theo đúng quy tắc đã đặt, lấy seed
xếp thứ hai là 44, và seed này thắng seed trung vị 5 điểm.

### Đo trên sidecar đang chạy, qua HTTP

Chạy `benchmarks/tts-vi/scripts/measure_sidecar_stream.py`, lấy trung vị (ms):

| Giọng          | chunk đầu | tới âm liền mạch | luồng hụt tiếng | mệnh đề đầu (đường cũ) |
| -------------- | --------: | ---------------: | --------------: | ---------------------: |
| Mai Anh        |       192 |          **192** |            0/41 |                    616 |
| Thanh Bình     |       179 |          **179** |            0/41 |                    584 |
| Kokoro (en, 9) |       660 |              660 |            0/30 |                    674 |

Với tiếng Việt, stream nhanh hơn đường cũ 3,2 lần và không có luồng nào hụt tiếng.
Tiếng Anh không nhanh hơn, đúng như dự đoán, và cũng không chậm đi.

Sau khi client ngắt giữa chừng, request kế tiếp nhận byte đầu sau 0,42 s. Hai request
tiếng Việt gửi đồng thời thì request sau xếp hàng khoảng 4,5 s rồi vẫn trả 200.

### Đo trên lượt thật, cùng fixture, `main` so với branch

Chạy 15 câu LibriSpeech tiếng Anh, dịch ra tiếng Việt, chỉ nhánh cascade. Chỉ số là
đoạn TTS, `firstAudioAt − translatedAt` lấy từ turn metrics, để loại độ trễ dịch
máy khỏi phép so.

|                      | trung vị |  tệ nhất | lỗi |
| -------------------- | -------: | -------: | --: |
| `main` (cắt mệnh đề) |   586 ms | 1 634 ms |   0 |
| branch (stream)      |   231 ms |   443 ms |   0 |

**Mục tiêu "giảm ≥ 400 ms" không đạt: chỉ giảm 355 ms.** Mốc của `main` đo trên máy
này là 586 ms, thấp hơn 781–1193 ms của benchmark mà mục tiêu dựa vào. Đuôi phân
phối giảm mạnh nhất (1,6 s còn 0,44 s), vì lượt nhiều mệnh đề trước đây phải chờ
trọn mệnh đề đầu tiên.

### Hai điều red-team và test bắt được

- **Lock giữ cả lượt là lựa chọn có chủ đích.** Nhờ vậy seed tái lập được và ngữ
  điệu liền mạch. Cái giá là lượt thứ hai cùng ngôn ngữ phải chờ, tối đa 15 s.
- **"Client ngừng đọc thì nhả lock sau 5 s" không đúng qua TCP.** Buffer socket của
  kernel nuốt vài MB, nên sidecar không bao giờ thấy backpressure. Trên localhost,
  một client đứng im giữ lock tới hết lượt 50 s. Giới hạn thực tế là trần 60 s mỗi
  stream, cùng deadline tổng của API. Test tích hợp cũ đã "pass" vì nó vô tình ngắt
  kết nối: `next(res.iter_raw())` bỏ generator, và httpx đóng response khi
  generator bị thu hồi.

## STT trên audio thật: streaming không phải lời giải, Parakeet cho câu chốt tiếng Anh (25/09/2026)

Bối cảnh: người dùng thấy STT "chưa thực sự làm tốt" và đề nghị chuyển sang một model
streaming. Trước khi chọn model, tôi đo trên **cả 6 cuộc hội thoại prod có ghi âm**
(4 vi, khoảng 9,2 phút; 2 en, khoảng 3,1 phút), thay vì trên VIVOS/LibriSpeech. Báo cáo
đầy đủ nằm ở `plans/reports/brainstorm-260925-1152-streaming-stt-prod-audio-evaluation.md`,
script ở `benchmarks/stt/scripts/prod-audio-arms/`.

### Đáp án cũng phải được kiểm

Whisper large-v3 **không dùng được làm đáp án tiếng Việt**: nó nghe "fan cứng" thành
"vang cứng", "anh Hoa Lang Thang" thành "tính hoài liên thang". Đáp án tiếng Việt vì
thế là ElevenLabs Scribe v2 (được maintainer duyệt), có PhoWhisper-large đối chiếu. Hai
đáp án này lệch nhau **20,4% WER**, nên chênh lệch tiếng Việt dưới khoảng 3 điểm là nhiễu.

### Hai bảng xếp hạng ngược nhau

Trên VIVOS, Zipformer-30M đang chạy đạt 5,4% còn pcs (Zipformer streaming đa ngữ
PengChengStarling) 13,4%. Trên audio prod thì ngược lại: pcs 19,0% còn prod 22,1%.
**Bộ test sạch không đại diện cho sản phẩm này.**

### Streaming chỉ thắng khi được nuôi liên tục

Kết quả pcs 19,0% là khi đút cả bản ghi liên tục. Khi phát lại qua đúng
`CapturePump` của client, cùng option như prod (khớp log prod: 17 lượt, 8 lần cắt
cưỡng bức cho bcf4d748), mỗi lượt lại mở một stream mới:

| vi, so với ElevenLabs         |   liên tục | theo lượt | theo lượt, mồi 6 s |
| ----------------------------- | ---------: | --------: | -----------------: |
| Zipformer-30M (đang chạy)     |          — |      22,3 |                  — |
| pcs (streaming, đa ngữ)       |       19,0 |  **35,8** |               31,6 |
| hyntS (bản streaming của 30M) |       22,3 |    28,4\* |                  — |
| Zipformer 70k giờ (offline)   |          — |      21,9 |                  — |
| Nemotron-3.5 / Moonshine-vi   | 44–47 / 37 |         — |                  — |

\* hyntS và cột mồi được đo trên đoạn cắt lý tưởng (khoảng lặng ≥ 0,3 s trong đáp án), không phải lượt phát lại.

Bootstrap ghép cặp theo lượt (mỗi từ đáp án gán vào lượt chứa trung điểm của nó, nên số tuyệt đối cao hơn cách chấm cả bài): pcs kém hơn đang chạy **+13,7 điểm, 95% CI [+8,9; +18,8]**;
Zipformer 70k giờ chênh −0,3 [−1,9; +1,3], không có ý nghĩa. Muốn pcs thắng thì phải đổi
kiến trúc sang một bộ nhận dạng liên tục cho mỗi chiều. Việc đó đụng tới gán người nói
và ranh giới lượt, để đổi lấy 3 điểm nằm trong vùng nhiễu. **Tiếng Việt giữ nguyên.**
Cũng thấy rằng cắt lượt không phải lỗi chính của tiếng Việt: prod 22,1 so với cắt lý
tưởng 23,4.

### Tiếng Anh: model batch, không phải streaming

Trên lượt phát lại thật, Parakeet-TDT-0.6b-v2 int8 đạt **3,4 so với 7,4** WER của
Moonshine-base. Bootstrap theo lượt: −4,0 điểm, 95% CI [−7,3; −0,9]. Model có dấu câu
và viết hoa, license CC-BY-4.0. Nó sửa đúng những lỗi đã thấy trong prod, như "English
learners" (prod ghi "Star Nuggets") và "walking to school or washing". Parakeet-unified
streaming bị loại vì RTF 1,7 trên CPU này.

Parakeet thay hẳn Moonshine, cho cả live partial (đọc lại cửa sổ mỗi 300 ms) lẫn câu
chốt. Lúc đầu định chia hai model theo lượt, vì Parakeet tốn khoảng 1,5× Moonshine mỗi
lần decode. Đo thật thì không cần: một model duy nhất vẫn nằm trong nhịp 300 ms. Đo tải
trên sidecar thật (4 thread, 4 lane như prod), hai chiều cùng lúc, bắn partial mỗi 300 ms
không chờ lượt trước xong (nặng hơn scheduler thật):

|                | Moonshine | Parakeet |
| -------------- | --------: | -------: |
| en final p95   |    215 ms |   327 ms |
| en partial p95 |    191 ms |   284 ms |
| 503            |         0 |        0 |
| RSS đỉnh       |    721 MB | 1 363 MB |

Parakeet nhận cả đoạn audio 10 ms, nên `MIN_AUDIO_MS` vẫn chỉ vì Zipformer. Không có cờ
rollback: muốn quay lại Moonshine thì revert commit.

Còn mở: tiếng Anh mới chỉ có một đáp án (Whisper). Đáp án thứ hai, ElevenLabs cho 2 bản
ghi en, chưa được duyệt.
