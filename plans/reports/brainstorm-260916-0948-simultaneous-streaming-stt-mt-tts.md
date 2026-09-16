---
type: brainstorm
date: 2026-09-16
mode: ultra (best-of-5 verifier)
branch: main
scope: web /translate — simultaneous streaming STT/MT/TTS
status: accepted, pending must-fix before planning
---

# Simultaneous streaming STT/MT/TTS cho web `/translate`

## Provenance

Chạy `ak:brainstorm --ultra`: một evidence packet bất biến, năm candidate
read-only độc lập chạy song song trên tier Opus, một verifier trên tier Fable
chấm ẩn danh theo rubric bốn tiêu chí và bốn hard constraint. Bản dưới đây là
candidate thắng cuộc, **giữ nguyên văn** — verifier chọn một bản, không trộn.

### Bốn quyết định ràng buộc do người dùng chốt trước khi dispatch

| Câu hỏi                         | Trả lời                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| "Thực sự realtime" nghĩa là gì? | **Simultaneous thật** — nghe bản dịch trong khi người kia còn đang nói |
| MT nằm ở đâu?                   | **Giữ Gemini text API (streamed)**; chỉ cấm model Gemini Live          |
| Vai trò GPU thuê?               | **Dự phòng** — chỉ thuê nếu CPU không đạt                              |
| Phạm vi client?                 | **Chỉ web `/translate`**                                               |

### Ranking

| Candidate     | Faithfulness | Evidence | Acceptance | Honesty | Tổng   | Hard constraints          |
| ------------- | ------------ | -------- | ---------- | ------- | ------ | ------------------------- |
| **E (thắng)** | 18           | 15       | 16         | 16      | **65** | pass toàn bộ              |
| B             | 17           | 17       | 16         | 16      | 66     | pass toàn bộ              |
| A             | 18           | 15       | 15         | 17      | 65     | pass toàn bộ              |
| D             | 18           | 18       | 15         | 14      | 65     | pass, kèm khiếm khuyết H4 |
| C             | 13           | 14       | 17         | 14      | 58     | pass toàn bộ              |

Thứ hạng cuối: **E > A > B > D > C**. Không reject-all.

> **B có tổng điểm cao nhất (66) nhưng xếp thứ ba — đây không phải lỗi cộng.**
> Tổng của A/B/D/E nằm trong khoảng hai điểm, nên verifier không xếp hạng bằng
> tổng mà bằng câu hỏi: bản nào, khi được materialize nguyên văn, cho planning
> một định nghĩa "xong" ít gây hiểu lầm nhất. B bị hạ vì lập luận quota sai
> **theo chiều có hại** (tuyên bố quota giảm trong khi số học cho ra ~2,5× mức
> 1,84 request/lượt đã đo) và vì tiêu chí AEC của nó không thể kích hoạt trong
> một phiên có direction cố định — recognizer nguồn decode ngôn ngữ còn lại, và
> direction là enum cố định, không auto-detect.

Bốn trong năm candidate hội tụ độc lập vào cùng một kiến trúc, và điểm hội tụ
nằm sẵn trong repo: `live-preview.ts:93-97` ("a guess spoken aloud cannot be
taken back") cùng `development-journey.md:904-908`. E thắng nhờ bốn ràng buộc
mức mã nguồn mà planning sẽ đụng ngay ngày đầu (xung đột byte-identity của
speculation, slot context chỉ nạp được từ `hints`, VieNeu không có speed
control, playback queue chỉ thả head), nhờ tiêu chí AEC duy nhất kiểm được
double-talk trong cùng một lượt, và nhờ bộ tiêu chí chạy được trên harness đang
có. B có ý tưởng đơn lẻ tốt nhất — spike phủ định giả định trước khi viết code —
nhưng tính sai chiều tiêu hao quota và đóng khung simultaneous thành một toggle
có thể bỏ. Verifier tự nhận độ tin cậy **trung bình**: A là lựa chọn thay thế
chính đáng, tổng điểm cách nhau trong hai điểm.

Verdict đầy đủ kèm log spot-check 40+ citation: không commit (nằm ở scratchpad
phiên làm việc).

## Must-fix trước khi viết plan

Verifier giữ những mục này tách khỏi phần chọn lựa, vì bản thắng cuộc được
materialize nguyên văn nên khiếm khuyết phải đi kèm nó. Không mục nào đổi hướng
thiết kế.

1. **C5 bất khả thi như đang viết.** `benchmarks/tts-vi/results/report.md:266-269`
   nói đầu ra streaming của VieNeu **không** bit-identical dù cùng seed. Thay
   bằng max-abs-diff ≤ 1e-5 so với whole-utterance, hoặc bỏ C5 và giữ C6.
2. **C2 sai mốc nền:** "781–954 ms" phải là **781–1193 ms** (`report.md:35,170`).
   Ngưỡng giữ nguyên.
3. **Chưa chỉ định tầng cho segmenter.** S-A trộn agreement phía server với ranh
   giới năng lượng của `SpeechGate` phía client, trong khi `client.audio.frame`
   không mang dấu VAD nào. Plan phải chọn: kiểm tra năng lượng phía server trên
   PCM đã buffer (khuyến nghị, không đổi protocol) hoặc thêm field vào frame
   (đổi public contract của `packages/types`).
4. **Thiếu spike phủ định giả định chịu lực.** A6 đo _sau_ khi build. Thêm spike
   kiểu B trước: replay `benchmarks/realtime/fixtures/long-*.wav` qua
   `POST /transcribe` đúng cadence của scheduler, chạy LocalAgreement-2, gate ở
   ≥60% từ được commit trước khi dứt lời và ≤5% bị viết lại. Xuất ra tag mới —
   nhớ bẫy `--limit` ghi đè `summary.json`.
5. **A4 có thể không sản xuất được.** `analyze-continuous.mjs` chỉ đọc
   `capturedMs`; phải xác nhận JSONL có ghi thời lượng audio đã phát, hoặc thêm
   field trước. A3 cũng cần field này.
6. **C18 là thay đổi public contract.** Thêm field context vào `TranslationHints`
   kèm đổi prompt. Thêm một arm commit-segment vào
   `benchmarks/live-translate/segment-vs-whole.mjs` và lấy ngưỡng đã đo làm
   chuẩn: mất ≤ 1,22 chrF++ tổng thể, ≤ 2,38 cho vi→en.
7. **C1 trích `development-journey.md:910` như ràng buộc còn hiệu lực** — dòng đó
   đã bị §10 (`:1285-1329`) thay thế. Viết lại thành "đã kiểm trên một MacBook,
   rig i7 chưa đo". Với nhánh loa ngoài best-effort, feature-detect
   `echoCancellationMode: "all"` (Chrome 141+) trước khi đọc D2 như "browser AEC
   - loa ngoài".
8. **"Simultaneous là mặc định mới của `/translate`" là quyết định sản phẩm** mà
   người dùng chưa phát biểu. Mang sang plan như một decision point.
9. **D1 đếm cả barge-in và tiếng ồn phòng** theo docblock của chính counter. Giữ
   D3 làm gate, D1 chỉ là số ghi nhận.
10. Chỉnh citation: policy `:18`→`:17`; `turn-speculation` `:52-54`→`:50-51`.

---

# Contract thắng cuộc (nguyên văn)

> Ký hiệu: **[V]** = tôi đã đọc file và xác nhận · **[I]** = suy luận, chưa có bằng chứng trực tiếp.
> Mọi `path:line` dưới đây đọc trên branch `main` ngày 2026-09-16.

## Khung lại vấn đề trước khi vào contract

Yêu cầu "streaming ở cả 3 mốc" bị hiểu mặc định là _dựng 3 đường ống token-level_.
Số đo trong repo bác bỏ đúng cách hiểu đó ở 2/3 mốc — nhưng **không** bác bỏ
simultaneous. Cái repo đang thiếu không phải 3 đường ống, mà là **đơn vị commit**:
hôm nay đơn vị đó bằng cả một lượt nói (turn), nên người nghe phải đợi người kia
dứt lời. Simultaneous = **thu nhỏ đơn vị commit xuống dưới mức turn rồi pipeline
nó**, giữ nguyên pipeline batch-per-unit đã đo được 1,13 s p50.

Bằng chứng mạnh nhất cho hướng này nằm ngay trong repo, ở
`docs/development-journey.md:904-908` **[V]**: _"bản dịch live cũng là đòn giảm độ
trễ mạnh nhất còn lại, vì mỗi bản dịch tạm chính là một head start, và bản cuối
cùng có thể dùng thẳng làm bản chính thức khi không có audio mới sau nó — tức rút
hẳn ~550 ms dịch máy khỏi đường tới hạn."_ Repo đã tự đi tới ngưỡng cửa của
simultaneous và dừng lại ở một dòng chính sách, không phải ở một giới hạn kỹ thuật:
`live-preview.ts:93-96` **[V]** — _"Only the text is shown; no audio is ever
synthesized from it. … a guess can be quietly replaced on screen, while a guess
spoken aloud cannot be taken back."_

Contract này nhận đúng lời phản đối đó và trả lời bằng **commit rule**, không phải
bằng cách bỏ qua nó: chỉ nói ra những gì đã ổn định, không nói ra prefix mà audio
sau còn lật được.

---

## 1. Outcome — trạng thái người dùng thấy được trên web `/translate`

Trên `/translate`, người dùng bật **chế độ simultaneous** (mặc định mới của trang;
turn-based vẫn còn là một lựa chọn, không bị xoá).

Khi A nói liên tục 30–60 giây mà không dừng hẳn:

1. **Chữ nguồn** chạy như hôm nay (đã có: `server.transcript.partial`,
   `live-preview.ts:68-74` **[V]**).
2. **Chữ dịch** chạy theo từng **commit segment**, nối tiếp nhau, **không ghi đè
   toàn bộ dòng cũ** — khác hôm nay, nơi `server.translation.partial` dịch lại cả
   transcript đang lớn dần (`live-preview.ts:121-131` truyền `text: transcript`,
   tức toàn bộ **[V]**).
3. **Âm thanh dịch phát ra trong khi A vẫn đang nói.** Đây là thay đổi sản phẩm duy
   nhất thật sự mới. Segment N được đọc lên trong lúc A đang nói segment N+1.
4. Khi A dứt lời, **không có cú "đổ ập"** — phần còn lại chỉ là một segment cuối,
   không phải toàn bộ lượt.

### Target latency semantics của simultaneous mode

Chỉ số đúng **không phải** "end-of-speech → first audio" (số 1163 ms ở
`speech-gate.ts:6` **[V]**). Ở simultaneous mode nó vô nghĩa, vì không có
end-of-speech để đo. Chỉ số đúng là **EVS — ear-voice span**: từ lúc người nói _bắt
đầu_ một đoạn tới lúc người nghe nghe thấy đoạn đó.

Repo **đã có sẵn** metric này và tôi không phải phát minh: `analyze-continuous.mjs:181`
**[V]** tính `driftMs = client.firstAudioPlayedAt - client.speechStartedAt`. Đo từ
_speechStartedAt_, không phải từ lúc dứt. Đó chính là EVS.

Số học của target, dẫn thẳng từ đo đạc đã có:

```
commit unit  2,5 s   (đoạn audio được chốt)
+ STT final    ~50 ms  (Zipformer 3s buffer = 49ms — packet §4(e))
+ MT           ~553 ms (gemini-3.5-flash-lite streamed p50 — packet §4(c))
+ TTS 1st chunk ~240 ms (VieNeu infer_stream 221-257ms — packet §4(g))
──────────────────────────────────────────
EVS p50 ≈ 3,35 s tính từ đầu segment ≈ 0,85 s tính từ cuối segment
```

Mục tiêu: **EVS p50 ≤ 3,5 s · p95 ≤ 5,0 s**, và **khoảng lặng dài nhất trong audio
đầu ra ≤ 1,5 s** trên một đoạn độc thoại ≥ 30 s. Điều kiện thứ hai mới là thứ tạo
ra cảm giác "simultaneous"; EVS một mình có thể đẹp mà người nghe vẫn nghe giật cục.

**Ranh giới trung thực:** EVS ~3,5 s nằm trong dải một phiên dịch cabin người thật
vẫn làm việc **[I]** — nhưng đây _không_ phải "nghe tức thì". Nếu outcome mà user
hình dung là EVS < 1 s thì không kiến trúc nào trong contract này đạt được, vì chỉ
riêng MT đã 553 ms và commit unit không thể ngắn hơn một cụm có nghĩa.

---

## 2. Constraints — ràng buộc, mỗi cái truy về bằng chứng

### 2.1 Vật lý & phần cứng

| #   | Ràng buộc                                                                                       | Nguồn                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Một máy + loa ngoài, nghe bản dịch trong khi nói là **bất khả thi nếu không có AEC**            | `docs/development-journey.md:910` **[V]**                                                                                                                |
| C2  | Browser AEC **đã bật sẵn**: `echoCancellation/noiseSuppression/autoGainControl = true`          | `apps/web/src/lib/open-microphone.ts:59-63` **[V]**                                                                                                      |
| C3  | Web `/translate` **đã chạy full-duplex**: mic được tôn trọng xuyên suốt playback                | `apps/web/src/hooks/use-streaming-translate.ts:381` **[V]**, lý do ở `:372-380`                                                                          |
| C4  | Một loa chỉ phát một thứ một lúc. `OrderedPlayback` chỉ thả **head** vào queue, phần sau buffer | `packages/realtime-client/src/audio/ordered-playback.ts` (docblock "Only the oldest incomplete turn — the head — is allowed to reach the queue") **[V]** |
| C5  | CPU-only là đường ship. GPU chỉ dự phòng                                                        | Binding decision §2 của packet                                                                                                                           |
| C6  | Duty cycle re-decode: vi 14% / en 40% một core ở cadence 3 s                                    | packet §4(e)                                                                                                                                             |

**C4 là ràng buộc kiến trúc bị bỏ sót nhiều nhất.** Simultaneous **không phải** phát
song song — nó là **pipelining**: audio của segment N phát trong lúc người ta nói
segment N+1. Hệ quả hàng đợi: nếu Σ(thời lượng TTS) > Σ(thời lượng nguồn), queue
phình vô hạn và EVS leo dốc. Đây là một ràng buộc Little's-law, không phải một mối lo
trừu tượng, và harness đã biết phát hiện nó (`analyze-continuous.mjs:339` **[V]**:
`climbing = marks.at(-1).driftMs > marks[0].driftMs * 1.5`).

**C4b — cái van bị kẹt:** `VieNeuVi._infer` **không có speed control**
(`services/local-tts/engines/vieneu_vi.py:134-135` **[V]**: _"VieNeu has no speed
control; `speed` is accepted for contract symmetry … and ignored here"_). Nên ở chiều
**en→vi**, nếu tỉ lệ thời lượng đích/nguồn > 1,0 thì **không có cần gạt nào để nén
lại**. Kokoro (en, cho chiều vi→en) có `speed`. Đây là bất đối xứng thật giữa hai
chiều và phải được đo trước khi hứa simultaneous cho cả hai.

### 2.2 Quota — ràng buộc chặt nhất của thiết kế

| #   | Ràng buộc                                                                                                                           | Nguồn                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C7  | Free tier **15 request/PHÚT**, 429 sau đúng 15 req trong 10,7 s, `retryDelay: 52s`                                                  | packet §4(d)                                                                              |
| C8  | Meter tính theo **project**; nhiều key cùng project không nâng trần                                                                 | packet §4(d) + `translation-model-policy.ts:56-68` **[V]**                                |
| C9  | Meter tính **theo model** ⇒ 2 flash-lite ≈ 30 req/phút                                                                              | `translation-model-policy.ts:30-33` **[V]** ("the free tier meters per minute PER MODEL") |
| C10 | Ngân sách đang bị tiêu sẵn: speculation ≤ 4/turn (`MAX_SPECULATIONS_PER_TURN = 4`) + live translation ≤ 3/turn (`MAX_PER_TURN = 3`) | `translation-model-policy.ts:18` **[V]**, `audio/live-translation-trigger.ts:43` **[V]**  |

**Đây là chỗ contract này khác một đề xuất ngây thơ.** Commit unit 2,5 s trên một
đoạn độc thoại 60 s = 24 request/phút > 15. Nghe như simultaneous phá trần quota.
Nó không, vì **simultaneous không thêm request — nó tái phân bổ số request
speculation đang đốt**: mỗi commit segment _chính là_ một speculation, nhưng là một
speculation **được dùng** thay vì bị vứt. Hôm nay một turn dài tiêu tới 4 guess +
3 live translation = **7 request mà 6 trong số đó bị bỏ đi**
(`turn-speculation.ts:52-54` **[V]**: _"The superseded guess is dropped rather than
cancelled"_). Ở simultaneous mode, speculation và live-translation **bị tắt**, và
budget đó chuyển thành commit segment. Net: gần như hoà, và 30 req/phút (C9) là
trần thật.

### 2.3 Licensing & model

| #   | Ràng buộc                                                                                                           | Nguồn                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| C11 | Zipformer-30M vi là **CC-BY-NC-ND-4.0** — chỉ dùng cho đồ án                                                        | packet §3; nhất quán với memory "Chatofy is a non-commercial thesis" |
| C12 | Cả hai STT engine là **OfflineRecognizer**, sherpa-onnx **không** có streaming mode cho Moonshine (encoder-decoder) | packet §3                                                            |
| C13 | `nemotron-3.5-asr-streaming-0.6b-q8_0.gguf`, **939 MB**, format **GGUF**                                            | `ls services/local-stt/models/nemotron-streaming-0.6b` **[V]**       |
| C14 | sherpa-onnx `OfflineTts` callback chunk **chỉ ở ranh giới câu** ⇒ 0 ms lợi cho lượt 1 câu                           | packet §4(a); `clause-splitter.ts:3-6` **[V]**                       |
| C15 | VieNeu WER dao động **16,4% → 37,0%** trên cùng 41 câu vì RNG toàn cục không seed                                   | `benchmarks/tts-vi/results/report.md` bảng "Engine / voice" **[V]**  |

**C13 quan trọng hơn vẻ ngoài của nó.** GGUF ⇒ runtime họ llama.cpp, **không**
drop-in vào sidecar sherpa-onnx đang có. Wiring nó = thêm một runtime thứ ba vào
`services/local-stt`. Đây là lý do nó xếp cuối trong §5, không phải vì nó dở.

### 2.4 Ràng buộc từ mã hiện có (dễ bị bỏ sót nhất)

| #   | Ràng buộc                                                                                                                                             | Nguồn                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C16 | `CapturePump` **giữ lại** (`held`) các block im lặng giữa turn và **vứt** khi turn kết thúc, để byte count trên server đứng yên cho speculation check | `capture-pump.ts:428-435` **[V]** + `:191-204` **[V]**                                                                                                                                                         |
| C17 | `TurnSpeculation.usable()` kiểm tra **byte-identity** (`atBytes !== bufferedBytes` ⇒ vô hiệu)                                                         | `turn-speculation.ts:59-64` **[V]**                                                                                                                                                                            |
| C18 | `context` gửi cho Gemini **chỉ** được dựng từ `hints`, không có chỗ cho "segment trước"                                                               | `gemini-translation-provider.ts:129` **[V]** (`buildContextBlock(req.hints)`); `TranslationHints` chỉ có `topic/hotwords/style` — `packages/ai-providers/src/interfaces/translation-provider.ts:27-47` **[V]** |
| C19 | Trần đồng thời: 3 turn/socket, 6 toàn cục; stall watchdog 15 s                                                                                        | `session/turn-concurrency.ts:27,45` **[V]**; `ordered-playback.ts` `TURN_STALL_TIMEOUT_MS = 15_000` **[V]**                                                                                                    |
| C20 | `PartialTranscriptScheduler`: cadence 300 ms, duty divisor 3, cửa sổ trượt 8 s, tối thiểu 200 ms audio                                                | `audio/partial-transcript-scheduler.ts:16,32,44,66` **[V]**                                                                                                                                                    |

C16 + C17 là cặp ràng buộc phải hoà giải: một **mid-turn commit làm dịch chuyển byte
count**, tức phá đúng cái bất biến mà speculation dựa vào. Contract này giải bằng cách
**tắt hẳn speculation ở simultaneous mode** (xem §2.2) — không phải bằng cách vá thêm
điều kiện. Đó là câu trả lời KISS: hai cơ chế cùng giải một bài toán (bắt đầu sớm), giữ
cả hai là DRY violation.

---

## 3. Non-goals

1. **Không** đụng `apps/extension` (giữ Gemini Live) và mobile — binding decision §2.
2. **Không** dùng Gemini Live model dưới mọi hình thức trong đường web.
3. **Không** local MT. Vẫn Gemini text API streamed — binding decision §2.
4. **Không** thuê GPU trong đường ship. GPU chỉ được nhắc tới như escape hatch nếu
   một tiêu chí §4 fail trên CPU — binding decision §2.
5. **Không** đổi TTS engine. `benchmarks/tts-vi/results/report.md` đã kết luận
   "KEEP VieNeu — and stream it" **[V]**; ZeroTTS starve 164/164 stream.
6. **Không** viết AEC riêng (WebRTC AEC3 / speex). Browser AEC đã có (C2); tự dựng AEC
   là một dự án con và là scope creep.
7. **Không** chạy MOS panel, không đổi diarization/speaker-id, không đụng
   `POST /translate` REST path.
8. **Không** bỏ turn-based mode. Nó là fallback đo được và là baseline luận văn.
9. **Không** token-level MT streaming — §5.2 giải thích tại sao, dựa trên số đo.

---

## 4. Acceptance criteria — số, không phải tính từ

Mọi tiêu chí chạy trên **`benchmarks/realtime/`** đã có (fixtures `long-0*.wav`,
`pause-0*.wav`, `ami-en-ES2002a.wav` **[V]**) + JSONL sink qua `TURN_METRICS_PATH`,
và trên `benchmarks/tts-vi/` cho phần TTS. **Không dựng harness mới** trừ A6.

> Cảnh báo vận hành, từ memory đã ghi: một lần chạy lại scorer với `--limit` **ghi đè**
> `summary.json` đã lưu. Mọi smoke run phải trỏ ra thư mục output khác.

### Nhóm A — simultaneous thật sự hoạt động

| #   | Tiêu chí                                                                            | Ngưỡng                                               | Đo bằng                                                                                |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A1  | **EVS** (`firstAudioPlayedAt - speechStartedAt`)                                    | **p50 ≤ 3 500 ms, p95 ≤ 5 000 ms**                   | `analyze-continuous.mjs` (đã tính, `:181`)                                             |
| A2  | **EVS không leo dốc** trên run 5 phút liên tục                                      | drift p50 tại phút 5 ≤ **1,5×** drift p50 tại phút 1 | `analyze-continuous.mjs:339` (đã có sẵn điều kiện này)                                 |
| A3  | **Khoảng lặng dài nhất trong audio đầu ra** trên độc thoại ≥ 30 s                   | **≤ 1 500 ms**                                       | metric mới trên JSONL playback (mở rộng `analyze-continuous.mjs`)                      |
| A4  | **Tỉ lệ thời lượng** Σ TTS ms / Σ captured speech ms                                | **p50 ≤ 1,00 · p95 ≤ 1,15**, đo riêng vi→en và en→vi | JSONL sink                                                                             |
| A5  | **Coverage** (Σ capturedMs / speechMs) không tệ hơn turn-based baseline             | **≥ baseline − 2 pp**                                | `vad-reference.mjs` + `analyze-continuous.mjs`                                         |
| A6  | **Commit error rate**: % segment đã nói ra mà bản decode cuối của cả lượt mâu thuẫn | **≤ 10% (vi), ≤ 15% (en)**, n ≥ 100 segment          | harness offline mới, nhỏ, trên fixtures có sẵn — **đây là harness duy nhất phải viết** |

### Nhóm B — quota sống sót

| #   | Tiêu chí                                                                  | Ngưỡng       | Đo bằng                                         |
| --- | ------------------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| B1  | Request/phút **mỗi model** trên run 5 phút liên tục                       | **p95 ≤ 15** | `analyze-continuous.mjs` (đã báo cáo per-model) |
| B2  | Số 429 trong run 5 phút                                                   | **= 0**      | JSONL sink                                      |
| B3  | Tổng request/phút của simultaneous **không vượt** turn-based cùng fixture | **≤ 1,2×**   | so hai run                                      |

### Nhóm C — TTS streaming (độc lập, ship trước được)

| #   | Tiêu chí                                           | Ngưỡng                                                                         | Đo bằng             |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| C1  | VieNeu time-to-first-chunk qua endpoint stream mới | **p50 ≤ 300 ms** (đã đo 221–257 ms)                                            | `benchmarks/tts-vi` |
| C2  | VieNeu **gapless start**                           | **p50 ≤ 400 ms** (đã đo 221–257 ms; hôm nay 781–954 ms)                        | `benchmarks/tts-vi` |
| C3  | Underrun / starved stream trên tập conversational  | **≤ 20/164** (bằng số đã đo, không tệ hơn)                                     | `benchmarks/tts-vi` |
| C4  | Kokoro (en) giữ nguyên clause-split, TTFA          | **p50 ≤ 400 ms** (đã đo 340–393 ms)                                            | `benchmarks/tts`    |
| C5  | **Reproducibility**: hai lần chạy cùng seed        | **bit-identical** (report nói cả hai engine đạt được dưới seed **[V]**)        | `benchmarks/tts-vi` |
| C6  | WER streaming vs whole-utterance                   | **không tách** (bootstrap CI cắt 0) — tái xác nhận `vieneu-streaming-wer.json` | `benchmarks/tts-vi` |

### Nhóm D — AEC / echo (xem §5.4)

| #   | Tiêu chí                                                                                   | Ngưỡng                                                       | Đo bằng                                 |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------- |
| D1  | `echoHeard` mỗi phút-playback, **có tai nghe**, run 5 phút                                 | **≤ 2**                                                      | UI counter + JSONL                      |
| D2  | `echoHeard` mỗi phút-playback, **loa ngoài**, cùng máy dev                                 | **chỉ ghi lại, không gate** — con số này là dữ liệu luận văn | như trên                                |
| D3  | **False commit do echo**, offline: trộn audio TTS đã ghi vào fixture mic ở residual −20 dB | commit segment tăng thêm **≤ 5%** so với fixture sạch        | mở rộng harness A6, không cần phần cứng |
| D4  | Khi D1 bị vượt trong phiên thật, UI **nói ra** và mời chuyển turn-based                    | hành vi có test, **không** tự hạ cấp im lặng                 | spec ở `apps/web`                       |

### Nhóm E — không làm hỏng cái đang chạy

| #   | Tiêu chí                                                                                                                                                                                                        | Ngưỡng |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| E1  | Turn-based mode: EVS/latency không tệ hơn baseline hiện tại quá **5%**                                                                                                                                          |
| E2  | Toàn bộ spec hiện có của `packages/realtime-client` và `apps/api/.../translate` **pass**, không sửa test để qua                                                                                                 |
| E3  | `apps/web/src/design/accent-budget-app.spec.tsx` vẫn pass với `KNOWN_VIOLATIONS` **rỗng** — mode toggle mới **không** được tiêu accent thứ hai trên `/translate` (`.claude/rules/development-rules.md` **[V]**) |

E3 không phải nghi thức: `/translate` hiện chỉ có một control đổ accent, và một nút
"Simultaneous / Turn-based" vẽ thêm một cái nữa sẽ **làm đỏ gate**. Nó phải là
segmented control dạng ghost/outline, hoặc nằm trong `/preferences`.

---

## 5. Recommended direction

### 5.0 Thiết kế tích hợp: **Commit-segment simultaneous**

Một ý tưởng, ba mốc thừa hưởng nó:

```
audio ──► SpeechGate (đã có) ──► COMMIT SEGMENTER (mới, nhỏ)
                                      │  chốt 1 đoạn ~2,5 s tại điểm năng lượng thấp
                                      ▼
                       STT final trên đoạn đã chốt  (OfflineRecognizer, ~50 ms)
                                      ▼
                       MT 1 request / đoạn, streamed  (~553 ms)
                                      ▼
                       TTS streaming (vi) / clause-split (en)  (~240 ms tới chunk đầu)
                                      ▼
                       OrderedPlayback (đã có, head-only, C4)
```

Mấu chốt: **không có thành phần nào mới ngoài COMMIT SEGMENTER**. Mọi thứ khác là
code đang chạy, được gọi trên một đơn vị nhỏ hơn. Đó là câu trả lời KISS/DRY.

### 5.1 STT — 3 phương án

|            | Cách làm                                                                                                                                                                                            | Giả định lớn nhất                                           | Hỏng trước ở đâu                                                                                                                                       | Worst plausible case                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **S-A** ⭐ | **Stable-prefix commit** trên `PartialTranscriptScheduler` đang có (C20): chốt prefix mà **2 lần re-decode liên tiếp đồng ý**, ranh giới audio đặt tại block năng lượng thấp do `SpeechGate` chỉ ra | Re-decode cửa sổ trượt 8 s đủ ổn định để prefix hội tụ      | **en/Moonshine**: 456 ms @12 s buffer đã phá budget 300 ms (§4(e)); mà cửa sổ trượt của scheduler là 8 s (C20) nên vẫn trong ngưỡng 277 ms — biên mỏng | Prefix không hội tụ ở tiếng Việt thanh điệu ⇒ commit chậm ⇒ EVS trượt về ~4,5 s. **Vẫn simultaneous, chỉ chậm hơn.** |
| **S-B**    | **VAD-only commit**: chốt tại mọi khoảng lặng ≥ 200 ms, không cần re-decode đồng thuận                                                                                                              | Người nói có pause tự nhiên trong vòng ≤ 3 s                | Người nói liền mạch không pause ⇒ không có điểm chốt ⇒ rơi về `maxUtteranceMs` 8 s (`use-streaming-translate.ts:51` **[V]**) ⇒ EVS 9 s                 | Độc thoại trôi chảy = mất hẳn simultaneous. Nhưng **không bao giờ commit sai**, vì ranh giới là im lặng thật.        |
| **S-C**    | Wire `nemotron-streaming-0.6b` GGUF (C13)                                                                                                                                                           | Có runtime GGUF-ASR chạy được CPU, và model biết tiếng Việt | Ngay ở bước 1: runtime thứ ba trong sidecar, chưa benchmark, chưa biết license, chưa ai trong repo nhắc tới                                            | Đốt nhiều ngày trước khi biết nó có RTF ≤ 0,3 hay không. Không có số nào trong repo hậu thuẫn.                       |

**Chọn S-A, với S-B là chế độ suy biến của chính nó** (đặt ngưỡng đồng thuận = 0 ⇒
S-A trở thành S-B). Đó là lý do S-A rẻ để bỏ: nó **là** một hằng số.

### 5.2 MT — đối diện thẳng với `chunks p50 = 1`

Số đo nói gì, chính xác: `gemini-translation-provider.ts:276-279` **[V]** ghi ngay
trong code — _"Streaming is used for latency, not for incremental delivery: a
one-sentence turn comes back in a single chunk (measured chunks p50 = 1), so there is
nothing to forward early. What it buys is the round-trip itself — measured p50 553ms
streamed against 820ms blocking."_

Ba kết luận phải tách bạch, vì trộn chúng lại là chỗ mọi đề xuất "stream cái MT đi"
chết:

1. **Streaming MT vẫn đáng giá 267 ms** ngay cả khi chunks = 1 (820 → 553). Đang bật.
   Không đụng vào. **"Buys nothing" chỉ đúng với push-từng-cụm, không đúng với
   `generateContentStream`.**
2. **Push từng cụm trong MỘT request là chết thật.** chunks p50 = 1 ⇒ không có cụm
   nào để push. Journey chốt verbatim: _"không xây pipeline đẩy từng cụm từ MT sang
   TTS, không có cụm nào để đẩy"_. Contract này **tuân thủ**.
3. **Nhưng "streaming MT" ở tầng đúng không phải trong một request — mà là một
   _stream của các request_.** Đơn vị song song phải nằm **trên** MT, vì MT là
   nguyên tử. Mỗi commit segment = 1 request; các request gối lên nhau; `maxInFlight:
3` (`use-streaming-translate.ts:387` **[V]**) và `MAX_CONCURRENT_TURNS_PER_SOCKET
= 3` (**[V]**) đã sẵn sàng đỡ việc này.

Đây là chỗ "streaming ở mốc MT" được giao đủ mà không cãi lại số đo: **hạt streaming
là segment, không phải token — vì phép đo nói rằng token không tồn tại.**

|            | Cách làm                                                                                    | Giả định                                              | Hỏng trước ở đâu                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **M-A** ⭐ | 1 request/commit segment, streamed, **tắt speculation + live-translation** ở mode này (C10) | Budget tái phân bổ đủ: 30 req/phút (C9) ≥ nhịp commit | Người nói nhanh + commit unit ngắn ⇒ >30 req/phút ⇒ 429 với `retryDelay: 52s` (C7) — một sự cố **52 giây**, không phải một turn hỏng |
| **M-B**    | M-A + **adaptive commit length**: nới đơn vị khi budget 60 s gần đây căng                   | Nới được mà không phá A3 (khoảng lặng ≤1,5 s)         | Nới tới ~5 s ⇒ EVS ~6 s ⇒ A1 fail nhưng **không chết**                                                                               |
| **M-C**    | Giữ speculation + thêm commit segment                                                       | —                                                     | Vi phạm C16/C17 (byte-identity) và tiêu 2× quota. **Loại.**                                                                          |

**Chọn M-A, mang M-B theo như một governor.** M-B là ~30 dòng và nó là thứ biến một
sự cố 52 giây thành một sự suy giảm êm. Không tính là scope creep vì nó **thay thế**
`MAX_SPECULATIONS_PER_TURN` chứ không cộng thêm.

Điểm phải xử lý, không được lặng im: **C18 — context**. Dịch từng đoạn 2,5 s độc lập
sẽ mất mạch. Provider có sẵn slot `context` nhưng chỉ được nạp từ `hints`
(`gemini-translation-provider.ts:129` **[V]**). Việc cần làm là nhỏ và có thật: đưa
**cặp (nguồn, đích) của segment liền trước** vào slot đó. Không thêm component, chỉ
thêm một field. Rủi ro: chất lượng dịch theo segment có thể kém hơn dịch cả lượt —
phải **đo**, không được hứa. Đây là lý do A6 tồn tại.

### 5.3 TTS — việc đã đo xong, chưa làm

Không có phương án để cân nhắc, chỉ có một việc chưa làm:
`services/local-tts/engines/vieneu_vi.py:136` **[V]** gọi `self._engine.infer(...)`.
Package có `infer_stream`. Report đã kết luận **"KEEP VieNeu — and stream it"** **[V]**
với 221–257 ms so với 781–954 ms hôm nay.

|            | Cách làm                                                                                                                                                             | Giả định                                                                                               | Hỏng trước ở đâu                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-A** ⭐ | `POST /synthesize/stream` trên sidecar (chunked response), engine gọi `infer_stream`, **seed RNG** (C15); API forward từng chunk qua `outbound-audio-framer` đang có | `infer_stream` giữ được 20/164 starved khi chạy sau một FastAPI chunked response thay vì trong harness | Sidecar serialize mọi synthesis sau một engine lock (`local-tts/app.py` docstring **[V]**) ⇒ hai segment gối nhau **xếp hàng**; segment ngắn thì OK, nhưng đây là nút thắt thật |
| **T-B**    | Giữ clause-split cho cả hai ngôn ngữ                                                                                                                                 | Đơn giản, đã chạy                                                                                      | 781–954 ms gapless start × mỗi segment 2,5 s ⇒ **queue phình** (C4) ⇒ A2 fail                                                                                                   |
| **T-C**    | Đổi sang ZeroTTS                                                                                                                                                     | —                                                                                                      | Starve 164/164 stream **[V]**. Loại bởi số đo.                                                                                                                                  |

**Chọn T-A cho vi; giữ clause-split cho en** (Kokoro là sherpa `OfflineTts`, C14 nói
callback streaming của nó lợi 0 ms, còn clause-split đã đo 340–393 ms — đủ tốt cho
đơn vị 2,5 s). Đây là "streaming ở mốc TTS" được giao **thật**, và cũng là phần duy
nhất ship được độc lập ngay hôm nay.

### 5.4 AEC — trả lời thẳng, không né

**Điều gì đã đúng [V]:** browser AEC bật (C2), full-duplex bật (C3), có instrument
(`echoHeard`, `capture-pump.ts:366-380` **[V]** sửa đúng lỗi đếm sót echo — 4 cửa sổ
echo từng báo cáo là 1), và comment tại `use-streaming-translate.ts:376-380` **[V]**
ghi rõ: _"whether that loop closes is a property of the device, not of the code …
verified never to reopen the gate while someone was speaking"_ trên máy dev.

**Điều gì simultaneous mode làm thay đổi — và đây là phần chưa ai trong repo viết:**
hôm nay playback là **bursty** (im lặng giữa các lượt); ở simultaneous mode playback
gần như **liên tục**. Ba hệ quả:

1. AEC residual chuyển từ ngắt quãng sang thường trực ⇒ `echoHeard` sẽ tăng **do
   thiết kế**, không phải do lỗi. Không được đọc nó như trước.
2. Residual giờ chảy vào **COMMIT SEGMENTER**, tức nó không chỉ làm sai một con đếm
   mà có thể **chốt và nói ra một segment là tiếng của chính app**. Đây là failure
   mode mới, nghiêm trọng hơn echo-count, và là lý do D3 tồn tại.
3. `echoHeard` **không tách được** echo với barge-in — `use-streaming-translate.ts:112-125`
   **[V]** nói thẳng điều đó. Ở simultaneous mode nó càng mù hơn.

**Lập trường của contract, nói rõ:**

- **Tai nghe là cấu hình được hỗ trợ** cho simultaneous mode. Không phải một lời
  khuyên chôn trong docs — là một advisory một lần trên `/translate` khi bật mode.
  Lý do vật lý, không phải lý do kỹ thuật: ngay cả với AEC hoàn hảo, hai giọng vẫn
  cùng ở trong phòng, nên **người nghe** vẫn nghe chồng. Cabin phiên dịch thật giải
  bài này bằng headset, không bằng DSP.
- **Loa ngoài vẫn chạy được, best-effort, và được ĐO** (D2). Không chặn. Con số này
  là dữ liệu luận văn — nó định lượng đúng câu `development-journey.md:910`.
- **Hạ cấp phải nói ra** (D4). Vượt D1 ⇒ UI báo và **mời** chuyển turn-based. Tuyệt
  đối không tự chuyển im lặng: đó sẽ là "lặng lẽ bỏ simultaneous", tức vi phạm §2.
- **Không tự viết AEC** (non-goal 6).
- **Two-device split** (một máy nói, một máy nghe) là lối thoát trung thực và tốn 0
  dòng code phía audio. Nhưng nó **không phải** cái user hỏi cho `/translate`, nên nó
  chỉ là một ghi chú vận hành cho buổi demo, không phải một phần của delivery.

**Câu một dòng cho contract:** _AEC không làm simultaneous đúng — nó làm simultaneous
sống được. Cái làm nó đúng là tai nghe; cái làm nó đo được là D1–D3._

### 5.5 Approach nhỏ nhất thoả contract, và thứ tự bỏ

Chia 3 lát, lát 1 có giá trị độc lập:

| Lát    | Nội dung                                                               | Thoả tiêu chí | Bỏ được không?                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | **TTS streaming**: `infer_stream` + `/synthesize/stream` + seed VieNeu | Nhóm C        | **Không nên bỏ.** Thắng 550–700 ms đã đo, 0 quota, độc lập hoàn toàn với simultaneous. Nếu S2/S3 chết, S1 vẫn là cải thiện thật cho turn-based.                                                     |
| **S2** | **Commit segmenter + nói ra commit**: S-A + M-A + context field (C18)  | Nhóm A, E     | Phần đắt nhất. Bỏ dần được: ngưỡng đồng thuận → 0 biến S-A thành S-B; commit unit → ∞ biến toàn bộ về **turn-based hôm nay**. Tức đường lùi là **một giá trị config, không phải một lần rollback**. |
| **S3** | **Quota governor (M-B) + mode UI (E3) + echo guard (D1/D4)**           | Nhóm B, D     | M-B bỏ được nếu B1 pass sẵn ở commit unit cố định. Echo guard **không** bỏ được — nếu không có nó, mode này gửi tiếng của chính app đi dịch mà không ai biết.                                       |

**Thứ tự bỏ khi một giả định gãy:**

1. Gãy **quota** (B1/B2 fail) → nới commit unit qua M-B. Mất EVS, giữ simultaneous.
2. Gãy **stable prefix** (A6 > 10%) → hạ về S-B (VAD-only). Mất simultaneous trên
   độc thoại liền mạch, **không bao giờ nói sai**.
3. Gãy **queue stability** (A2/A4 fail, nhiều khả năng ở **en→vi** vì C4b) → giới hạn
   simultaneous cho **vi→en** trước (Kokoro có `speed`), en→vi ở lại turn-based, và
   nói rõ điều đó trên UI. Đây là lần duy nhất được thu hẹp, và nó là một sự thật vật
   lý của engine chứ không phải một lựa chọn phạm vi.
4. Gãy **CPU** (duty cycle đẩy re-decode quá budget khi 2 hướng chạy cùng lúc) → đây
   và **chỉ ở đây** là lúc escape hatch GPU của §2 được kích hoạt, và chỉ cho STT.

**Cái tuyệt đối không được bỏ:** nói bản dịch ra trong lúc người kia còn đang nói.
Đó là toàn bộ yêu cầu.

---

## 6. Unresolved questions

1. **Độ dài commit unit — 2,0 s / 2,5 s / 3,0 s?** Đây là đánh đổi _nghe sớm hơn
   nhưng sai nhiều hơn_ ↔ _chậm hơn nhưng chắc hơn_, và nó là **quyết định sản phẩm**,
   không phải phép đo. Harness A1/A6 cho được đường cong, nhưng điểm chọn trên đường
   cong là của user.
2. **en→vi, khi tỉ lệ thời lượng đo được > 1,0 (A4 fail):** VieNeu không có speed
   control (C4b **[V]**). Ba lối, cả ba đều có giá: (a) prompt Gemini dịch ngắn gọn —
   đổi chất lượng dịch; (b) bỏ bớt segment — người nghe mất câu; (c) thêm speed
   control vào VieNeu — chưa biết package có hỗ trợ. Cần user chọn.
3. **Tai nghe có chấp nhận được cho buổi bảo vệ đồ án không?** Câu trả lời quyết định
   D1 là **gate** hay chỉ là **ghi nhận**. Nếu demo bắt buộc chạy loa ngoài thì phải
   biết trước, vì nó đổi cả tiêu chí nghiệm thu lẫn kỳ vọng.
4. **`nemotron-streaming-0.6b` GGUF 939 MB [V]** — ai tải, cho việc gì, và một runtime
   GGUF-ASR thứ ba trong `services/local-stt` có được chấp nhận cho luận văn không?
   Contract này xếp nó cuối (S-C) vì không có số nào hậu thuẫn, nhưng nếu có lý do
   lịch sử tôi chưa biết thì thứ hạng đó nên đổi.
5. **Có sẵn GCP project thứ hai không?** C8/C9 **[V]** nói trần 30 req/phút chỉ đạt
   được khi hai model — hoặc nhiều key từ **project khác nhau**. Toàn bộ nhóm B dựa
   trên câu trả lời này.

---

# Phụ lục — sửa cách chia lát sau phản hồi của người dùng (2026-09-16)

Người dùng bổ sung ba thông tin sau khi contract được chốt. Chúng **không** đổi
hướng thiết kế nhưng đổi cách chia lát, nên phần này ghi đè §5.5 của contract
trên.

## Thông tin mới

1. **TTS người dùng tắt được**, và việc tắt là cách xử lý lặp âm được chấp nhận.
2. **Một khi TTS đã bật, coi như không có lặp âm** (người dùng tự bảo đảm điều
   kiện, ví dụ đeo tai nghe).
3. **Ưu tiên số một là: audio streaming vào, rồi dịch realtime.** TTS realtime là
   yêu cầu thật nhưng đứng sau, và chỉ áp dụng khi người dùng bật.

## Điều này đã đúng sẵn trong code

`voiceOutput: boolean` đã tồn tại (`apps/web/src/lib/translate-settings.ts:154`,
mặc định `true`) và đã **bỏ hẳn synthesis phía server**, không phải mute phía
client — `apps/api/src/modules/translate/services/translation-session.service.ts:620-629`
ghi lý do: _"the sidecars serialize inference on shared CPU, so synthesizing
audio nobody will play takes the resource every other turn in flight is waiting
for."_ Nên mô hình người dùng mô tả đã là mô hình đang chạy.

## Hệ quả: hai làn, không phải một đơn vị commit

Contract trên gộp chữ và tiếng vào **một** đơn vị commit. Đó là chỗ nó tự làm
khó mình. Hai làn có **luật commit khác nhau, và vốn đã khác nhau**:

|                       | Làn chữ                                                                                        | Làn tiếng                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Chạy khi nào          | Luôn luôn                                                                                      | Chỉ khi `voiceOutput = true`                                           |
| Luật                  | **Được phép sửa lại** — `live-preview.ts:93-96`: _"a guess can be quietly replaced on screen"_ | **Không được rút lại** — _"a guess spoken aloud cannot be taken back"_ |
| Cần commit segmenter? | **Không**                                                                                      | Có                                                                     |
| Cần xử lý lặp âm?     | Không — không có audio ra thì lặp âm bất khả thi về cấu trúc                                   | Người dùng tự bảo đảm                                                  |

Làn chữ **không cần commit**, nên nó không cần segmenter, nên nó rẻ hơn nhiều so
với mức contract trên ngụ ý.

## Hệ quả thứ hai: segmenter đơn giản trở nên đủ dùng

Contract trên chọn **S-A** (stable-prefix commit) và xếp **S-B** (VAD-only) là
phương án lùi, vì S-B mất simultaneity khi người ta nói liền mạch không nghỉ.

Khi hai làn tách ra, điểm yếu đó hết nghiêm trọng: **mất một điểm cắt chỉ làm
chậm tiếng, không làm chậm chữ.** Chữ vẫn chạy đều vì nó không chờ commit. Nên
v1 dùng **S-B**, và S-A trở thành nâng cấp về sau chứ không phải nền móng.

Điều này còn né được một ràng buộc mã nguồn mà cả năm candidate đều bỏ sót:
`services/local-stt/app.py:89` trả về `{"text", "language"}` — **không có
timestamp**. `SttEngine.transcribe` chỉ đọc `stream.result.text`
(`services/local-stt/engines/base.py`), vứt `result.timestamps` mà model
transducer vốn sinh ra. S-A cần ánh xạ _prefix chữ → offset audio_, tức cần
timestamp, tức phải mở rộng contract của sidecar. S-B cắt theo năng lượng trên
PCM đã buffer nên **không cần timestamp nào**.

## Thứ tự lát mới

| Lát    | Nội dung                                                                                                                                                                   | Giao được gì                                                               | Phụ thuộc |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| **S1** | **Làn chữ realtime**: bỏ trần `MAX_PER_TURN = 3` theo lượt, thay bằng ngân sách theo phút; UI render bản dịch dạng "đoạn ổn định + đuôi đang chạy" thay vì ghi đè một dòng | Đúng ưu tiên số một của người dùng: nói vào, chữ dịch chạy realtime        | Không     |
| **S2** | **VieNeu `infer_stream`** + seed + `/synthesize/stream`                                                                                                                    | 781–1193 ms → 221–257 ms gapless start, đã đo sẵn; cải thiện cả turn-based | Không     |
| **S3** | **Commit segmenter (S-B) + nói ra**, chỉ chạy khi `voiceOutput = true`                                                                                                     | TTS realtime                                                               | S2        |

S1 và S2 độc lập hoàn toàn, chạy song song được. S3 là phần đắt và giờ nó nằm
sau một feature flag đã tồn tại.

## Các mục must-fix bị vô hiệu bởi phụ lục này

Must-fix #3 (chưa chỉ định tầng cho segmenter) và #4 (thiếu spike phủ định giả
định prefix-convergence) **không còn áp dụng cho v1**, vì S-B không dùng
prefix-convergence và cắt phía server trên PCM đã buffer. Cả hai quay lại nếu
sau này nâng cấp lên S-A.

Nhóm tiêu chí **D (AEC/echo)** hạ từ gate xuống số liệu ghi nhận, theo quyết
định của người dùng. D3 (false commit do echo trộn ở −20 dB) **giữ lại**, vì nó
chạy offline, không cần phần cứng, và nó đo một failure mode khác với thứ mà
việc tắt TTS xử lý được — xem phần cảnh báo dưới.

## Cảnh báo duy nhất cần ghi lại

"Tắt TTS nếu bị lặp âm" xử lý được _lặp âm làm phiền người nghe_. Nó không xử lý
được _lặp âm trong lúc TTS còn đang bật_: residual vào mic → segmenter chốt nó →
dịch → đọc lên → vòng lặp tự nuôi. Người dùng đã tuyên bố điều kiện "bật lên là
chắc chắn không lặp âm", nên rủi ro này nằm ngoài phạm vi theo quyết định của
người dùng. D3 được giữ vì nó là bài kiểm tra offline rẻ cho đúng vòng lặp đó,
không phải vì nó phản đối quyết định.
