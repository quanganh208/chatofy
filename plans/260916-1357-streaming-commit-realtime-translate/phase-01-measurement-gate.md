---
phase: 1
title: 'Đo cổng — ổn định tiền tố và chi tiêu quota thật'
status: done
priority: P1
effort: '6h'
dependencies: []
revision: 2 (viết lại sau red team)
---

# Phase 1: Đo cổng

## Goal

Trả lời bằng số, trước khi viết một dòng code sản phẩm nào: tiền tố của
`zipformer-vi` có đủ ổn định để chốt chữ không, chốt được bao nhiêu ký tự mỗi
giây, và hệ thống hôm nay đang tiêu bao nhiêu request Gemini mỗi phút.

**Phase này có quyền hủy toàn bộ kế hoạch.** Xem `Cổng hủy`.

## Vì sao bản này khác bản đầu

Red team chỉ ra bản đầu **không thể trượt**: nó đo bằng một harness lệch bốn chỗ
so với production, tất cả đều thiên về lạc quan, trên một bộ dữ liệu không chứa
được chính hiểm hoạ nó canh. Bản này sửa cả hai.

1. **Đo qua sidecar HTTP thật**, không nạp model in-process. Chi phí decode mà
   cổng duty chia phải bao gồm transport và hàng chờ lane.
2. **Bỏ nhánh đối chứng cửa sổ 4 giây.** Bản đầu chạy nó rồi tự viết rằng kết quả
   của nó không được đổi quyết định theo cả hai chiều. Phép đo không đổi được
   quyết định nào thì không đáng chạy.
3. **Hiểm hoạ trượt cửa sổ được sửa bằng thiết kế, không bằng đo.** Xem Phase 3
   task 3.5. Vì thế Phase 1 chỉ còn phải đo **tốc độ chốt**, và VIVOS đủ cho việc
   đó.

## Bất biến của phase này

**KHÔNG sửa bất kỳ file nào trong `apps/`, `packages/`, `services/`.** Phase này
chỉ tạo file mới dưới `benchmarks/stt/`. Kiểm ở Task 1.6.

## Files to Create / Modify

- Create: `benchmarks/stt/scripts/streaming-arms/commit_probe.py`
- Create: `benchmarks/stt/results/r6-commit/vi-sidecar.jsonl`
- Create: `plans/260916-1357-streaming-commit-realtime-translate/reports/measurement.md`
- Modify: không có

---

## Task 1.1 — Viết harness đo tiền tố, chạy qua sidecar thật

- **Goal:** một script mô phỏng vòng re-decode của production **kể cả chi phí
  transport**, ghi lại từng snapshot hypothesis kèm mốc thời gian.

- **Target files:** tạo mới `benchmarks/stt/scripts/streaming-arms/commit_probe.py`.
  Dùng lại `lcp` từ `benchmarks/stt/scripts/streaming-arms/stream_metrics.py`
  (import, **không** chép lại).

- **Steps:**
  1. **Gửi audio tới sidecar đang chạy qua HTTP**, không nạp `sherpa_onnx`
     in-process. Endpoint `POST {LOCAL_STT_URL}/transcribe`, multipart như
     `services/local-stt/app.py:61-90` định nghĩa, trả `{"text","language"}`.
     Mặc định `LOCAL_STT_URL=http://localhost:8001`.
     Bắt buộc, vì cổng duty của production chia theo thời gian decode đo
     start-to-settle (`partial-transcript-scheduler.ts:markSettled`), và thời gian
     đó gồm cả HTTP lẫn chờ lane. Đo in-process cho nhịp đẹp hơn thực tế.
  2. Tham số: `--manifest` (mặc định `benchmarks/stt/data/manifest-vi.jsonl`),
     `--limit` (50), `--window-seconds` (**9.0**), `--divisor` (**2**, phải khớp
     giá trị Phase 3 ship), `--hold-back` (0), `--out`.
  3. Mô phỏng vòng lặp của `partial-transcript-scheduler.ts`:
     - **chèn 320ms im lặng vào đầu** mỗi clip, mô phỏng `PRE_ROLL_MS = 320`
       (`packages/realtime-client/src/audio/capture-pump.ts:22`). Lượt thật luôn
       mở kèm pre-roll nên buffer dài hơn lời nói;
     - bước nạp 300ms mỗi vòng;
     - bỏ qua vòng nếu audio tích luỹ `< 200ms` (`MIN_AUDIO_MS`);
     - cửa sổ là `--window-seconds` giây **cuối** của audio đã tích luỹ;
     - **bỏ qua vòng nếu sidecar trả chuỗi rỗng**, đúng như `live-preview.ts`
       (`if (!text.trim()) return;`). Không tính là snapshot, vì production không
       đẩy nó lên màn hình;
     - sau mỗi decode, chờ `max(300ms, divisor × thời_gian_decode)` tính từ lúc
       vòng đó **bắt đầu**.
  4. Ghi mỗi vòng thành snapshot `(audio_s, wall_s, hypothesis)`.
  5. Áp LocalAgreement-2 ngoại tuyến: tiền tố chung của hai hypothesis **liên
     tiếp**, lùi về ranh giới từ, giữ lại `--hold-back` âm tiết cuối. Phần chốt
     chỉ tăng.
  6. **Chạy bước 5 hai lần trên cùng chuỗi snapshot** — hold-back 0 và 2. Đây là
     chạy lại ngoại tuyến, không tốn thêm decode nào. Hậu tố `_hb0`, `_hb2`.
  7. Mỗi file ghi một dòng JSON: `id`, `audio_seconds`, `n_updates`,
     `n_blank_skipped`, `decode_ms_p50`, `decode_ms_p95`, `refresh_ms_p50`,
     `refresh_ms_p95`, `reference`, `final_hypothesis`; và với mỗi mức hold-back:
     `committed_final`, `committed_chars`, `commit_rate_chars_per_s`,
     `commit_lag_p50_s`, `commit_lag_p95_s`, `stall_max_s`, `stall_p95_s`,
     `committed_vs_final_mismatch_chars`, `tone_flips`, `duplications`.
     - `commit_lag`: khoảng giữa mốc audio lúc một ký tự được chốt và mốc audio
       lúc nó lần đầu xuất hiện.
     - `stall`: khoảng audio liên tiếp mà số ký tự chốt không tăng, **chỉ tính
       khi còn audio chưa nạp hết**.
     - `commit_rate_chars_per_s` = `committed_chars / audio_seconds`. **Đây là số
       Phase 4 dùng để chọn `N`.**
     - `tone_flips`: số lần một âm tiết đã xuất hiện rồi bị đổi ở hypothesis sau
       mà **chỉ khác dấu thanh** (so sau `unicodedata.normalize('NFD')` và bỏ ký
       tự combining), **và ở cùng vị trí tính từ đầu chuỗi**.
     - `duplications`: số lần hypothesis chứa một cụm ≥ 2 âm tiết lặp liền kề.
       Tách hẳn khỏi `tone_flips`: hai thứ này đã từng bị nhầm với nhau, và
       `VIVOSDEV13_089` là ca lặp cụm chứ không phải sửa dấu.

- **Success criteria:** chạy hết 50 file không exception, output có
  `decode_ms_p50 > 0`.

- **Verify:**
  ```
  cd benchmarks/stt && LOCAL_STT_URL=${LOCAL_STT_URL:-http://localhost:8001} \
    uv run python scripts/streaming-arms/commit_probe.py --limit 2 --out /tmp/probe-smoke.jsonl \
    && wc -l < /tmp/probe-smoke.jsonl
  ```
  Thoát mã 0 và in `2`. Sidecar phải đang chạy; nếu chưa,
  `docker compose up -d local-stt`.

---

## Task 1.2 — Chạy đo đầy đủ

- **Goal:** bộ số đầy đủ, tuần tự, ở đúng cấu hình sẽ ship.

- **Target files:** tạo `benchmarks/stt/results/r6-commit/vi-sidecar.jsonl`.

- **Steps:**
  1. Đóng mọi tiến trình nặng khác. **Chạy tuần tự** — r4/r5 cho thấy song song
     làm RTF lệch tới ±70%.
  2. Sidecar phải chạy ở đúng `LOCAL_STT_THREADS=4` của production
     (`docker-compose.prod.yml:278`). Nếu dev để 8 thread thì số đo lạc quan hơn
     production; kiểm trước khi chạy và ghi giá trị thật vào báo cáo.
  3. Chạy một lần với mặc định (cửa sổ 9s, divisor 2).

- **Success criteria:** file jsonl có 50 dòng.

- **Verify:**
  ```
  cd benchmarks/stt && mkdir -p results/r6-commit \
    && uv run python scripts/streaming-arms/commit_probe.py --out results/r6-commit/vi-sidecar.jsonl \
    && wc -l < results/r6-commit/vi-sidecar.jsonl
  ```
  Thoát mã 0 và in `50`.

---

## Task 1.3 — Tính WER của phần đã chốt

- **Goal:** biết nếu chỉ hiển thị phần đã chốt thì người dùng đọc được văn bản
  đúng tới đâu.

- **Steps:**
  1. Tính WER của `final_hypothesis` so với `reference`. Dùng lại scorer trong
     `benchmarks/stt/stt_bench/` — đọc `benchmarks/stt/run_benchmark.py` để tìm
     đúng tên hàm và gọi lại, **không** viết scorer mới.
  2. Tính WER của `committed_final` so với `reference` cho **cả hai** mức hold-back.
  3. Đối chiếu `final_hypothesis` WER với mốc **5,38%**
     (`docs/development-journey.md:122-124`). Lệch đáng kể nghĩa là **harness
     sai**, không phải model sai — dừng và kiểm lại harness.

- **Success criteria:** ba số WER ghi vào báo cáo Task 1.5.

- **Verify:** `no verification needed` — kiểm ở Task 1.5.

---

## Task 1.4 — Đếm key và đo chi tiêu Gemini hiện tại

- **Goal:** biết hệ thống **hôm nay** tiêu bao nhiêu request/phút, để Phase 4 đặt
  ngân sách trên nền thật thay vì trên số 0.

### Phần A — đếm key, không bao giờ render giá trị

- **Steps:**
  1. `apps/api/.env` có thể bị hook chặn quyền riêng tư. **Nếu bị chặn, dùng
     `AskUserQuestion` xin phép trước**, theo "Hook Response Protocol" trong
     `CLAUDE.md`. Không tìm đường vòng.
  2. Chỉ chạy lệnh **đếm**, không in giá trị:
     ```
     node -e "const v=(require('dotenv').config({path:'apps/api/.env'}).parsed?.GEMINI_API_KEY)||'';process.stdout.write(String(v.split(',').filter(Boolean).length))"
     ```
  3. Ghi `n_keys`, kèm nguyên văn: `apps/api/.env.example:130-131` nói _"Same-project
     keys cannot be detected from here — that one is on you."_ Nên `n_keys` là
     **cận trên** của số bucket quota, không phải số bucket.
  4. Người dùng đã khai (2026-09-16) rằng `.env` có **6 key thuộc 6 project khác
     nhau**. Nếu lệnh đếm ra khác 6, **dừng lại và hỏi** — chênh lệch nghĩa là
     `.env` đã đổi hoặc lời khai không còn đúng, và mọi trần của Phase 4 suy từ
     con số này.
  5. Ghi `n_project = n_keys` **kèm nhãn "do người dùng khai, không kiểm được từ
     code"**. Bước 6 của Phần B là phép kiểm gián tiếp duy nhất có sẵn.

### Phần B — đo chi tiêu nền

- **Steps:** 4. Dựng stack, mở `/translate`, hội thoại hai chiều liên tục **3 phút** với code
  **hiện tại** (chưa có thay đổi nào của kế hoạch này). 5. Đọc `TURN_METRICS_PATH`. Cộng `liveTranslations` và `speculations` trên mọi
  dòng, chia số phút. Đây là nhu cầu nền. 6. Đếm số dòng `rate limited on` trong log API cùng khoảng đó — đây là chuỗi
  thật mà `register-default-providers.ts:105-107` ghi ra. Nếu đã khác 0 trước
  khi kế hoạch chạm vào, mọi ngân sách phải trừ phần này. 7. Ghi vào báo cáo mục "Chi tiêu nền".

- **Success criteria:** báo cáo có `n_keys`, req/phút nền tách theo
  `liveTranslations` và `speculations`, và số 429 nền.

- **Verify:**
  ```
  grep -cE 'AIza[0-9A-Za-z_-]{10,}' plans/260916-1357-streaming-commit-realtime-translate/reports/measurement.md
  ```
  In ra `0`.

---

## Task 1.5 — Viết báo cáo và áp cổng hủy

- **Goal:** báo cáo có số, một phán quyết, và **hai con số Phase 3 và Phase 4 bắt
  buộc phải đọc**.

- **Target files:** tạo mới
  `plans/260916-1357-streaming-commit-realtime-translate/reports/measurement.md`.

- **Steps:**
  1. Bảng tổng hợp: trung vị và p95 của `commit_lag`, `stall`, `refresh_ms`,
     `decode_ms`; tổng `committed_vs_final_mismatch_chars / committed_chars`;
     `tone_flips` và `duplications`; cho cả hai mức hold-back.
  2. Ba số WER từ Task 1.3, mục "Chi tiêu nền" từ Task 1.4.
  3. Mục riêng, tiêu đề đúng chữ `## Số bàn giao cho Phase 3`:
     - `refresh_ms_p95` đo ở divisor 2. Phase 3 và Phase 6 dùng số này làm tiêu
       chí nhịp cho chiều vi→en, **thay cho con số 350ms tự đặt ở bản đầu**.
     - `decode_ms_p95`, để Phase 3 tính nhịp chiều en→vi theo tỉ lệ RTF.
  4. Mục riêng, tiêu đề đúng chữ `## Số bàn giao cho Phase 4`:
     - `commit_rate_chars_per_s` trung vị. Phase 4 chọn `N` từ số này theo công
       thức ở Phase 4 Task 4.1.
     - `liveTranslations`/phút nền và số 429 nền, để đặt trần.
     - `n_project`, kèm kết quả kiểm gián tiếp ở Phần B bước 7. Phase 4 nhân
       trần 15 RPM và 500 RPD với con số này.
  5. Áp hai ngưỡng ở `Cổng hủy`, ghi `PHÁN QUYẾT: ĐI TIẾP` hoặc
     `PHÁN QUYẾT: DỪNG` kèm số đã chạm ngưỡng.
  6. Mục `## Thiên lệch còn lại`: mọi chỗ harness vẫn khác production, kèm chiều
     thiên lệch. Biết trước: audio liền mạch không có khoảng lặng bị `SpeechGate`
     giữ; VIVOS là giọng đọc chứ không phải hội thoại; clip dài nhất 6,44 giây nên
     **không lượt nào chạm trần 8 giây**.
  7. Câu hỏi chưa giải quyết ở cuối.

- **Success criteria:** báo cáo tồn tại, đủ hai mục bàn giao, đúng một chuỗi phán quyết.

- **Verify:**
  ```
  cd plans/260916-1357-streaming-commit-realtime-translate/reports && \
  grep -cE 'PHÁN QUYẾT: (ĐI TIẾP|DỪNG)' measurement.md && \
  grep -c '## Số bàn giao cho Phase 3' measurement.md && \
  grep -c '## Số bàn giao cho Phase 4' measurement.md
  ```
  Ba lệnh lần lượt in `1`, `1`, `1`.

---

## Task 1.6 — Xác nhận không đụng code sản phẩm

- **Steps:** `git status --short`, kiểm không có dòng nào thuộc `apps/`,
  `packages/`, `services/`.

- **Verify:**
  ```
  git status --short | grep -cE '^.{0,3}(apps|packages|services)/'
  ```
  In ra `0`.

---

## Cổng hủy

Áp sau Task 1.5. Chạm bất kỳ ngưỡng nào thì ghi `PHÁN QUYẾT: DỪNG`, **không bắt
đầu Phase 2**, báo người dùng kèm số.

| #   | Ngưỡng hủy                                               | Vì sao                                                                                                     |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| G1  | `commit_lag_p95_s` > **2,0s** ở **cả hai** mức hold-back | Chữ chốt chậm hơn 2 giây thì không còn realtime, và tệ hơn hiện tại — hiện tại partial hiện ngay dù có sửa |
| G2  | `stall_p95_s` > **2,0s** ở cả hai mức                    | Tiền tố đứng yên nghĩa là màn hình đông cứng giữa câu rồi nhảy một cục                                     |

### Vì sao chỉ còn hai ngưỡng

Bản đầu có G3 về mâu thuẫn giữa phần chốt và bản decode đầy đủ. Đã bỏ, vì
`committer.flush()` đã được gỡ khỏi Phase 2: reducer client tự xoá dòng live khi
lượt kết thúc (`turn-keyed-transcript.ts:413,652,666,672` gọi `withoutLive`), nên
bản cuối **luôn** thay thế phần chốt trên màn hình dù ta làm gì. Không còn cơ chế
để mâu thuẫn đó gây hại ở đợt này.

Nó quay lại làm ngưỡng bắt buộc nếu Phase 7 mở, vì lúc đó phần chốt được **nói
ra**. Điều kiện tiên quyết của Phase 7 đã ghi mốc ≤ 2%.

`committed_vs_final_mismatch_chars` vẫn được **đo và ghi**, chỉ không còn là cổng
chặn. Nó là dữ kiện cho quyết định Phase 7.

### Corpus: VIVOS, và đó là quyết định đã chốt

Người dùng chốt ở phiên validation 2026-09-16: **chạy cổng trên VIVOS, không ghi
thêm lời nói thật**, và ghi rõ thiên lệch vào báo cáo.

Không phải bỏ sót. Phương án ghi 10–15 lượt hội thoại thật đã được đặt lên bàn và
bị từ chối để đổi lấy tốc độ. Task 1.5 bước 6 bắt buộc ghi ba thiên lệch đã biết
— giọng đọc chứ không phải hội thoại, không lượt nào chạm trần 8 giây, không có
ngập ngừng — nên người đọc báo cáo biết cổng này đo cái gì và không đo cái gì.

**Không tự ý "cải thiện" bằng cách ghi thêm audio.** Đó là quyết định đã chốt;
muốn đổi thì hỏi người dùng.

### Không có cổng nào cho hiểm hoạ trượt cửa sổ — có chủ đích

VIVOS không có clip nào quá **6,44 giây** (`manifest-vi.jsonl`, n=50, min 3,00 /
p50 3,84 / max 6,44), nên nó **không thể** tái hiện việc cửa sổ trượt, thứ chỉ
xảy ra khi buffer vượt cửa sổ. Bản đầu vẫn dùng bộ này làm cổng cho đúng hiểm hoạ
đó — tức một cổng không bao giờ trượt được.

Hiểm hoạ ấy giờ xử bằng **thiết kế**: Phase 3 task 3.5 nâng cửa sổ lên 9 giây
(phủ `MAX_UTTERANCE_MS` 8000ms cộng `PRE_ROLL_MS` 320ms) và thêm chốt chặn phía
server tắt đường chốt khi buffer vượt cửa sổ. Phase 6 kiểm nó trên lời nói thật.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
