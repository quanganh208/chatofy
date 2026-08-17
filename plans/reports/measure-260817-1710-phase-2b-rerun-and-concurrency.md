---
title: 'Phase 2b đo lại sau khi sửa A/B, và trần đồng thời của phase 6'
date: 2026-08-17
plan: 260813-2239-cascade-streaming-clause-commit
phase: 2b, 6 (phần đo được không cần tai người)
status: done
verdict: 3/4 tiêu chí phase 2b đạt; chiều tiếng Anh bị rút khỏi đường commit
---

# Phase 2b đo lại, và trần đồng thời

Máy: 16 lõi, Linux. Sidecar STT + TTS thật, API thật (bản build từ nhánh này),
MT Gemini cloud thật. Fixture `vlsp-vi-01.wav` 41,5s, `vlsp-vi-02.wav` 33,75s,
`ami-en-ES2002a.wav` 100s. Ngày 2026-08-17, không phải ngày demo.

**Kết quả một dòng:** hai lỗi dây nối đã chết thật — contradictions **421 → 0**.
Tiêu chí CPU vẫn không đạt, nhưng nguyên nhân hoá ra không phải kiến trúc mà là
**OpenMP quay vòng chờ**. Và phép đo mở ra một thứ không nằm trong bốn tiêu chí:
**chiều tiếng Anh không được phép commit**, đo được, và đã bị gỡ.

## Bảng bốn tiêu chí phase 2b

| #   | Tiêu chí                                  | 2026-08-17 (cũ) | Bây giờ             | Kết |
| --- | ----------------------------------------- | --------------- | ------------------- | --- |
| 1   | prefix-violation = 0 trên lượt 45s        | 421             | **0**               | ✓   |
| 2   | transcript vi hiển thị về ~5,38% VIVOS-50 | 5,38%           | **5,38%**           | ✓   |
| 3   | CPU mỗi lượt giảm so với đường nền        | 382s vs 193s    | **221s vs 144s**    | ✗   |
| 4   | không lượt nào đứng im khi vượt 8s        | lặng nhất 7,59s | **lặng nhất 4,87s** | ✓   |

Tổng trên cả 6 lượt của cấu hình cuối: 34 vế đã phát, **0 vế bị lật**.

## 1 — Prefix violation: 421 → 0

Hai lỗi mà report trước chẩn đoán đã được sửa trong `6379c8b` (dấu cách đầu
delta) và `a11e2f0` (không nói từ decoder còn đang đánh vần). Report trước viết
lúc chưa có chúng, nên mục "câu hỏi chưa giải quyết" của nó về A và B đã hết
hiệu lực.

Đo lại: **0 contradictions** trên mọi lượt tiếng Việt, mọi cấu hình thử trong
ngày (5 lượt vi, 34 vế). Mệnh đề kiến trúc — decode causal cho prefix đơn điệu —
giờ đúng cả trên đường chạy, không chỉ trên binding.

## 3 — CPU: thủ phạm là OpenMP quay vòng, không phải hai đường decode

Report trước để ngỏ câu hỏi "đường hiển thị có nên bỏ re-decode cửa sổ không".
Đo thì giả thuyết đó **sai**: thu cửa sổ hiển thị từ 8s xuống 3s (đường causal
đã lo phần đã commit, nên bản đọc lại chỉ còn vẽ phần đuôi chưa ai thấy) chỉ hạ
CPU 410 → 357s. Không phải chỗ tốn chính.

Chỗ tốn chính là chính sách chờ của OpenMP. Mặc định nó **busy-wait** ở cuối mỗi
vùng song song, cược rằng vùng sau tới ngay. Đường streaming gọi rất nhiều lần
ngắn, nên pool sống phần lớn đời trong lúc quay vòng và tính tiền đủ lõi.

| Cấu hình sidecar (cùng fixture, cùng lệnh)    | CPU/lượt    | lõi liên tục | commit đầu | lặng dài nhất |
| --------------------------------------------- | ----------- | ------------ | ---------- | ------------- |
| cửa sổ 8s, OMP mặc định (spin)                | 410,35s     | 9,89         | 5752ms     | 5752ms        |
| cửa sổ 3s cho lượt chỉ-vẽ-màn-hình, OMP spin  | 356,68s     | 8,59         | 5307ms     | 5307ms        |
| + `OMP_WAIT_POLICY=PASSIVE`                   | **220,95s** | **5,32**     | **4628ms** | **4866ms**    |
| + `LOCAL_STT_THREADS=4`                       | 149,88s     | 3,61         | 4494ms     | 6741ms        |
| đường nền zipformer, PASSIVE (cùng điều kiện) | 144,02s     | 3,47         | 5757ms     | **31017ms**   |

`PASSIVE` là thay đổi **thắng cả hai chiều**: CPU giảm 38% mà lượt còn **nhanh
lên** (commit đầu 5307 → 4628ms, số commit 13 → 16), vì đám thread quay vòng vốn
đang tranh CPU với chính đám đang decode. Đã đặt làm mặc định trong
`services/local-stt/app.py`.

Vì sao tiêu chí 3 vẫn tính là **không đạt**: so cùng điều kiện, đường nền là
3,47 lõi còn cấu hình mới là 5,32 lõi — vẫn tăng 53%. Hạ xuống `LOCAL_STT_THREADS=4`
thì còn 3,61 lõi (chỉ hơn nền 4%) nhưng khoảng lặng xấu đi 4866 → 6741ms. Không
tự chọn giúp: đây là đánh đổi CPU ↔ độ liền tiếng, và nó là quyết định sản phẩm.

Cần đọc kèm một câu, nếu không con số nền sẽ bị đọc sai: **đường nền 3,47 lõi ấy
chỉ commit 3 vế và có lỗ 31 giây**. Nó rẻ vì nó gần như không làm gì. So CPU với
nó mà bỏ cột cuối là so một hệ đang chạy với một hệ đang chết.

## 4 — Khoảng lặng commit

`vlsp-vi-01` (41,5s): lặng dài nhất **4866ms**, commit đầu 4628ms, 16 commit.
`vlsp-vi-02` (33,75s): lặng dài nhất 7443ms, commit đầu 5265ms, 9 commit.

Biên so với ngưỡng 8s rộng hơn hẳn lần trước (7,59s → 4,87s). Triệu chứng "đứng
im sau 8s" không còn dấu vết.

## Ngoài bốn tiêu chí: chiều tiếng Anh đã bị gỡ khỏi đường commit

Đây là kết quả quan trọng nhất trong ngày và nó không thuộc tiêu chí nào.

Chạy `ami-en-ES2002a.wav` (100s họp thật, có tiếng phòng) qua đường commit:

| Số đo                         | Giá trị     |
| ----------------------------- | ----------- |
| commit trong suốt 100s        | **3**       |
| commit đầu                    | 7280ms      |
| lặng dài nhất giữa hai commit | **75822ms** |
| **vế đã phát bị lật**         | **2**       |
| lượt kết thúc                 | `abandoned` |

Hai điều cùng lúc: **đói commit** (76 giây không nói gì giữa lượt) và **lật vế đã
phát ra tiếng** — thứ mà cả plan này dựng lên để không bao giờ xảy ra. Agreement
được kỳ vọng làm cho bản đọc lại an toàn, và trên giọng họp thật nó không làm
được: Moonshine là seq2seq viết lại prefix của chính nó, còn độ sâu agreement thì
chọn trên giọng TTS sạch.

Plan đã định trước phản ứng cho đúng ca này (§Rủi ro: "nếu vẫn lật thì chiều en
lùi về phương án B... hai chiều không bắt buộc phải cùng cơ chế"), nên đã thi
hành: **chỉ chiều có causal decoder mới commit giữa lượt.** Chiều tiếng Anh giữ
nguyên lượt và trả lời ở endpoint như trước khi có tính năng này.

Đo lại sau khi gỡ: **0 commit**, không còn khả năng lật, audio về ở endpoint.
Live transcript của tiếng Anh **không** bị đụng — nó chạy local, không tốn quota,
và rút lại được.

Phần **chưa** làm của phương án B: cắt lượt tiếng Anh dài ở khoảng lặng. Nên một
lượt tiếng Anh dài vẫn chờ đúng như nó vẫn chờ. Ghi rõ ở đây và trong code.

## Trần đồng thời (phase 6)

Cùng fixture, chạy N lượt streaming song song, đo CPU sidecar quanh cả mẻ.

| Socket | CPU sidecar | lõi liên tục | commit/lượt | commit đầu    | lặng dài nhất   |
| ------ | ----------- | ------------ | ----------- | ------------- | --------------- |
| 1      | 220,95s     | 5,32         | 16          | 4628ms        | 4866ms          |
| 2      | 388,43s     | 6,88         | 8           | 4806 / 5837ms | 10324 / 10704ms |
| 3      | 504,67s     | 7,79         | 3–5         | 6737–10777ms  | 19877–23114ms   |

Kết luận thẳng: **máy này chịu được 1 lượt streaming.** Ở 2 lượt, khoảng lặng đã
vượt ngưỡng 8s của chính plan; ở 3 lượt tính năng coi như chết (20+ giây im
giữa câu). `MAX_CONCURRENT_TURNS_GLOBAL = 6` cao hơn nhiều so với thứ máy này
thật sự đỡ được, và con số đó **chưa được chỉnh** trong lần này — nó là quyết
định sản phẩm, kèm cả trần bộ nhớ, và cần bạn chốt.

## Độ trễ có phẳng theo độ dài không

Bằng chứng còn mỏng (2 fixture vi), nhưng đúng hướng: 41,5s → commit đầu 4628ms;
33,75s → 5265ms. Không tăng theo độ dài. Hằng số chặn ~**4,6–5,3s**, so với
đường nền ~9,2s và so với mục tiêu ~2s của plan. Tức **đã giảm một nửa, chưa tới
đích**, và chưa đủ fixture để gọi là "phẳng" một cách nghiêm túc.

## Sửa dụng cụ đo trước khi tin dụng cụ đo

`analyze-continuous.mjs` đọc ba field **không tồn tại**: `clauseCommittedAt`,
`server.startedAt`, `contradictedCommits`. Recorder ghi tên khác
(`commitContradictions`) hoặc không ghi gì. Chạy nó lên file thật sẽ in
"— not recorded", tức **im lặng báo pass**.

Đã sửa cả hai đầu:

- recorder ghi thêm `commitOffsetsMs` (mốc mỗi vế được chốt) và
  `clauseAudioOffsetsMs` (mốc audio thật sự đẩy đi — khác nhau đúng một lần tổng
  hợp tiếng, và vế nào tổng hợp hỏng thì **vắng mặt**, để cái lỗ hiện ra thay vì
  bị lấp);
- analyzer đọc đúng tên, và khi một lượt có commit mà field vắng thì in
  **BROKEN — do NOT read this run as a pass** thay vì một dấu gạch ngang trông
  như kết quả sạch.

Kiểm chứng trên dữ liệu thật: `commitOffsetsMs` 13 mốc, `clauseAudioOffsetsMs`
12 — đúng một vế dịch xong mà audio không bao giờ đi, thứ mà thiết kế cũ không
có cách nào thấy.

## Tag `</thought>` lọt vào đường nói

Đã bịt. `stripTranscriptTags` (chỉ lọc `<transcript>`) đổi thành
`stripEchoedTags`, lọc thêm `<thought|thinking|think|reasoning>` cả thẻ mở lẫn
thẻ đóng độc lập — rò lần trước là **một thẻ đóng không có thẻ mở**, nên luật
khớp cặp sẽ trượt đúng ca cần bắt. Không lọc bừa mọi ngoặc nhọn: bản dịch có
`5 < 7` vẫn nguyên vẹn (có test).

## Lệnh sinh lại

```bash
# sidecar (PASSIVE giờ là mặc định trong app.py, không cần đặt tay)
uv run --directory services/local-stt uvicorn app:app --port 8002
uv run --directory services/local-tts uvicorn app:app --port 8003
TURN_METRICS_PATH=<file.jsonl> pnpm --filter api run start:prod

# tiêu chí 2
uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py

# tiêu chí 1, 3, 4 — contradictions đọc từ dòng source=server của TURN_METRICS_PATH
node benchmarks/realtime/streaming-turn.mjs benchmarks/realtime/fixtures/vlsp-vi-01.wav \
  --lang vi --cpu-pid <api> --cpu-pid <stt>

# đường nền: khởi động sidecar với LOCAL_STT_VI_ENGINE=zipformer, chạy lại y hệt

# trần đồng thời: N tiến trình song song, đọc utime+stime của /proc/<stt>/stat quanh cả mẻ
for i in 1 2 3; do node benchmarks/realtime/streaming-turn.mjs \
  benchmarks/realtime/fixtures/vlsp-vi-01.wav --lang vi & done; wait
```

## Điều kiện đo

Máy 16 lõi; không có thiết bị âm thanh nào tham gia (mọi số đều từ fixture qua
WebSocket, không qua micro hay loa); MT là Gemini cloud, free tier; **0 lượt fail
vì quota** trong toàn bộ các lần chạy trên. Một lượt kết thúc `abandoned`: lượt
tiếng Anh 100s, do harness ngừng nghe sau `DRAIN_MS` trong khi lượt vẫn đang dịch
ở endpoint — thuộc tính của dụng cụ đo, không phải của server.

## Việc phase 6 còn nợ, và vì sao

Làm được không cần người: đã làm hết ở trên. Còn lại **cần tai người và micro
thật**, tôi không đo thay được:

- Phase 5: xác nhận bằng tai rằng extension phát tiếng trong lúc người nói chưa
  dứt câu.
- Phase 5b: `echoEvents/phút` cho ba cấu hình, và kiểm rằng không lượt outbound
  nào mang text của bản dịch — cần loa + micro thật trong một phòng thật.
- Phase 6: coverage ≥ 99% và số lượt `dropped` trên bản chạy liên tục 3 phút qua
  extension; req/phút tách theo model trên bản chạy đó.

## Câu hỏi chưa giải quyết

1. `LOCAL_STT_THREADS`: giữ 8 (5,32 lõi, lặng 4,87s) hay xuống 4 (3,61 lõi, lặng
   6,74s)? Tiêu chí 3 chỉ đạt ở phương án sau.
2. `MAX_CONCURRENT_TURNS_GLOBAL = 6` chỉnh xuống bao nhiêu? Đo nói máy này chịu
   1. Kèm theo là trần bộ nhớ (`MAX_TURN_BYTES` × trần).
3. Chiều tiếng Anh: dừng ở "giữ lượt như cũ", hay làm nốt nửa còn lại của phương
   án B (cắt lượt dài ở khoảng lặng)?
4. Hằng số chặn dừng ở ~4,6–5,3s có chấp nhận được không, khi plan đặt mục tiêu
   ~2s? Sàn độ trễ mà plan tự tính là ~1,9s p50, nên khoảng cách còn lại nằm ở
   chỗ khác chứ không ở sàn.
5. Bằng chứng "phẳng" mới có 2 fixture tiếng Việt. Có cần trả nợ bộ sinh fixture
   ElevenLabs của phase 1 trước khi chốt số không?
