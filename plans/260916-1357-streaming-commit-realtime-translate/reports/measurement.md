---
phase: 1
title: 'Báo cáo đo cổng — ổn định tiền tố và chi tiêu quota'
date: 2026-09-16
corpus: VIVOS vi, n=50
engine: zipformer-vi-30m qua sidecar HTTP
---

# Phase 1 — Báo cáo đo

## Cấu hình đã chạy

| Tham số                 | Giá trị                                                  | Nguồn                                        |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Sidecar                 | `http://localhost:8002`, container `chatofy-local-stt-1` | `env.schema.ts:175`, `docker-compose.yml:90` |
| `LOCAL_STT_THREADS`     | **4**                                                    | khớp `docker-compose.prod.yml:278`           |
| `LOCAL_STT_CONCURRENCY` | 4                                                        | mặc định dev = mặc định prod                 |
| Cửa sổ                  | 9,0 giây                                                 | Phase 3 task 3.5                             |
| Divisor                 | 2                                                        | giá trị Phase 3 sẽ ship                      |
| Nhịp nạp                | 300ms                                                    | `DEFAULT_CADENCE_MS`                         |
| Ngưỡng audio tối thiểu  | 200ms                                                    | `MIN_AUDIO_MS`                               |
| Pre-roll chèn đầu       | 320ms                                                    | `capture-pump.ts:22`                         |
| Corpus                  | `data/manifest-vi.jsonl`, 50 clip, 3,00–6,44s            | quyết định đã chốt, xem plan                 |
| Load máy lúc chạy       | load average 4,64                                        | có phiên khác chạy song song                 |

**Sai lệch so với kế hoạch, đã sửa trong lúc thi công:** phase-01 ghi mặc định
`LOCAL_STT_URL=http://localhost:8001`. Cổng thật của repo là **8002** ở cả
`apps/api/src/config/env.schema.ts:175` và `docker-compose.yml:90`; 8001 không
tồn tại ở đâu trong repo. Harness dùng 8002.

## Harness có đáng tin không — có, và đây là bằng chứng

`final_hypothesis` chấm bằng chính `stt_bench.metrics.corpus_wer`:

|                                                 | WER        | CER        |
| ----------------------------------------------- | ---------- | ---------- |
| **`final_hypothesis` (đo hôm nay)**             | **0,0538** | **0,0290** |
| Mốc ghi ở `docs/development-journey.md:122-124` | 0,0538     | 0,0290     |

Trùng tới từng chữ số. Task 1.3 bước 3 yêu cầu đúng phép kiểm này, và nó qua.
Nghĩa là mọi con số dưới đây là hành vi thật của đường giải mã production, không
phải hiện vật của harness.

## Bảng tổng hợp

### Nhịp và chi phí giải mã (n=50)

| Chỉ số            | Trung vị (theo clip) | p95 (toàn corpus) | Max   |
| ----------------- | -------------------- | ----------------- | ----- |
| `decode_ms_p50`   | 36,5                 | 76,7              | 93,1  |
| `decode_ms_p95`   | 62,4                 | 146,8             | 200,0 |
| `refresh_ms_p50`  | 303,0                | 307,9             | 315,8 |
| `refresh_ms_p95`  | 316,2                | 611,3             | 676,8 |
| `n_updates`       | 10,0                 | —                 | —     |
| `n_blank_skipped` | tổng 96              | —                 | —     |

Decode rẻ hơn nhiều so với lo ngại: p50 36,5ms trên cửa sổ tới 9 giây. Cổng duty
`max(300ms, 2 × decode)` hầu như luôn bị vế 300ms quyết định, nên **divisor 2
không phải là thứ giới hạn nhịp** — nhịp làm mới thực tế bám sát 300ms.

### Chỉ số chốt

| Chỉ số                                         | hold-back 0           | hold-back 2           |
| ---------------------------------------------- | --------------------- | --------------------- |
| `commit_lag_p50_s` (trung vị)                  | 0,300                 | 0,900                 |
| `commit_lag_p95_s` trung vị / p95-corpus / max | 0,600 / 1,2 / 1,5     | 1,200 / 2,1 / 2,1     |
| `stall_p95_s` trung vị / p95-corpus / max      | 0,600 / **2,7** / 3,0 | 1,200 / **2,7** / 3,0 |
| `stall_max_s` trung vị / max                   | 0,600 / 3,0           | 1,200 / 3,0           |
| `commit_rate_chars_per_s` trung vị             | **11,519**            | 9,418                 |
| `committed_chars` tổng                         | 2045                  | 1761                  |
| `committed_vs_final_mismatch_chars`            | 128 = **6,26%**       | 41 = **2,33%**        |
| `tone_flips` (ở vị trí ĐÃ chốt)                | 8, trên 6 clip        | 4, trên 2 clip        |
| `duplications` (trong phần đã chốt)            | **0**                 | **0**                 |
| Clip chốt được 0 ký tự                         | 0                     | 0                     |
| Clip có `stall_p95_s` > 2,0s                   | **7/50**              | **5/50**              |
| Clip có `commit_lag_p95_s` > 2,0s              | **0/50**              | 4/50                  |

### WER của phần đã chốt (Task 1.3)

| Văn bản                       | WER        | CER    |
| ----------------------------- | ---------- | ------ |
| `final_hypothesis`            | 0,0538     | 0,0290 |
| `committed_final` hold-back 0 | **0,1918** | 0,1604 |
| `committed_final` hold-back 2 | **0,2921** | 0,2712 |

Hold-back 2 có WER **cao hơn** không phải vì nó chốt sai nhiều hơn — tỉ lệ lệch
của nó thấp hơn (2,33% so với 6,26%). Nó cao hơn vì nó chốt **ít hơn**, và WER
tính phần thiếu là lỗi xoá.

## R6 đã có câu trả lời bằng số

Kế hoạch ghi R6 là _"chưa có bằng chứng"_ việc bộ nhận dạng sửa **dấu thanh** của
từ đã chốt, và để hold-back mặc định 0 chờ số của phase này.

**Bằng chứng đã có, và nó khẳng định R6 là thật.**

- `tone_flips_any` (sửa dấu ở bất kỳ đâu): **36 lần trên 23/50 clip**.
- `tone_flips` ở vị trí **đã chốt**, hold-back 0: **8 lần trên 6 clip**.
- 6 clip đó đóng góp **32 trên 71** ký tự đã chốt là sai, và có `stall_p95` trung
  vị **2,70s** — so với 0,60s ở 44 clip còn lại.

Và câu hỏi kia cũng có câu trả lời, ngược chiều: `duplications` trong phần đã
chốt = **0** ở cả hai mức. Hiện tượng lặp cụm kiểu `VIVOSDEV13_089` có thật trong
`final_hypothesis`, nhưng nó **không lọt vào vùng chốt**. Việc tách hai phép đếm
ra — đúng như R6 yêu cầu — cho thấy chúng là hai hiện tượng khác nhau và chỉ một
cái đe doạ cơ chế chốt.

**Lưu ý về độ chính xác của phép đếm:** `_fold_tone` bỏ mọi ký tự kết hợp sau
NFD, nên nó cũng gộp `ă/â/ê/ô/ơ/ư` về nguyên âm trần. Con số 8 là **cận trên**
của số lần sửa riêng dấu thanh, không phải con số chính xác. Phase 1 chọn phép
so này vì phase-01 Task 1.1 chỉ định đúng nó.

## Cơ chế hỏng — đọc từ dữ liệu thật

Hỏng không phải "chốt chậm". Chốt nhanh: `commit_lag_p95` vượt 2 giây ở **0/50**
clip tại hold-back 0. Hỏng là **đóng băng vĩnh viễn sau một lần lệch**.

LocalAgreement-2 chốt khi hai hypothesis **liên tiếp** đồng ý. Bộ nhận dạng này
đôi khi phát ra một âm tiết đầu sai **ổn định qua hai vòng** rồi mới sửa. Lúc đó
phần đã chốt không còn là tiền tố của hypothesis mới, và theo thiết kế Phase 2
(`committed` bất biến, phân kỳ thì `pending = ''` và bỏ qua vòng đó) màn hình
**đứng im tới hết lượt**:

| Clip              | Dài   | Đã chốt (hold-back 0)        | Bản cuối                                                              |
| ----------------- | ----- | ---------------------------- | --------------------------------------------------------------------- |
| `VIVOSDEV02_R045` | 3,62s | `Cơ`                         | `Cô cứ nhè cái nọc cá chê`                                            |
| `VIVOSDEV17_099`  | 4,59s | `Chỉ`                        | `Chị tìm nhà cho em ở trọ ngay cổng trường chị học`                   |
| `VIVOSDEV15_209`  | 3,19s | `Đây`                        | `Họ thích nghi với văn hóa công ty như thế nào`                       |
| `VIVOSDEV15_066`  | 4,37s | `Kém quá nhiều`              | `Kẽm có nhiều trong gan sò thịt đỏ cá óc trứng`                       |
| `VIVOSDEV19_257`  | 5,28s | `Nhưng nếu chị nói cái giỏi` | `Nhưng nếu chỉ nói cái giỏi không thôi thì thật sự chưa đủ về chú tư` |

`VIVOSDEV15_209` là ca xấu nhất: 3 ký tự đã chốt **không chia sẻ gì** với sự
thật, và chúng đứng đó 2,4 giây trong khi người ta nói hết câu.

Đây đúng là hiện tượng mà lý do của cổng G2 mô tả: _"màn hình đông cứng giữa câu
rồi nhảy một cục"_. Nó xảy ra trên **7/50 = 14%** số lượt.

## Số bàn giao cho Phase 3

| Số                                   | Giá trị     | Ghi chú                          |
| ------------------------------------ | ----------- | -------------------------------- |
| `refresh_ms_p95`, trung vị theo clip | **316,2ms** | nhịp của một lượt điển hình      |
| `refresh_ms_p95`, p95 toàn corpus    | **611,3ms** | đuôi                             |
| `decode_ms_p95`, trung vị theo clip  | **62,4ms**  | để suy nhịp en→vi theo tỉ lệ RTF |
| `decode_ms_p95`, p95 toàn corpus     | 146,8ms     |                                  |

**Cảnh báo phải chuyển tiếp:** tiêu chí nghiệm thu viết `refresh_ms_p95 của
Phase 1 × 1,25` mà **không nói lấy trung vị theo clip hay p95 toàn corpus**. Hai
cách cho hai ngưỡng rất khác nhau (395ms so với 764ms). Phase 6 phải chốt một
cách và ghi rõ, nếu không nó thừa hưởng đúng chỗ mơ hồ đã làm hỏng cổng G2 dưới
đây.

## Số bàn giao cho Phase 4

| Số                                                      | Giá trị                                                |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `commit_rate_chars_per_s` trung vị, VIVOS (hold-back 0) | **11,519**                                             |
| Tốc độ ký tự nguồn, **hội thoại thật liên tục**         | **12,46 / 14,64 / 14,80** ký tự/giây đồng hồ           |
| Tốc độ ký tự nguồn, trung bình cả 10 phiên thật         | 8,21 ký tự/giây đồng hồ                                |
| Số lượt mỗi phút, hội thoại thật                        | **5,74**                                               |
| `n_keys` trong `apps/api/.env`                          | **6**                                                  |
| `n_project`                                             | **6** — _do người dùng khai, code không kiểm được_     |
| Số 429 nền                                              | **0** trong log container, nhưng xem cảnh báo bên dưới |

### Chi tiêu nền — đo từ lịch sử sử dụng thật

Task 1.4 Phần B đề nghị dựng stack rồi hội thoại 3 phút. Không cần dựng: Postgres
của prod đã có **lịch sử thật, nhiều hơn hẳn 3 phút**.

```
10 hội thoại (2026-09-12 → 09-13)
21,78 phút đồng hồ · 125 lượt · 10.734 ký tự nguồn
  en_to_vi: 5 phiên · 16,14 phút · 111 lượt · 10.153 ký tự
  vi_to_en: 5 phiên · 5,64 phút ·  14 lượt ·    581 ký tự
```

Ba phiên hội thoại thật sự liên tục (282s, 214s, 187s — đều en→vi, 98 lượt,
9.420 ký tự) chạy ở **12,46 / 14,64 / 14,80 ký tự mỗi giây đồng hồ**. Các phiên
thưa còn lại chạy 0,88–3,26.

**Lưu ý phải đọc kèm:** ba phiên dày đặc đều là **en→vi**, tức nguồn tiếng Anh
qua `moonshine-en`, trong khi phép đo Phase 1 chỉ có **tiếng Việt** qua
`zipformer`. Các phiên vi→en thật quá thưa để rút ra tốc độ. Nên con số 14 ký
tự/giây có thể một phần là khác biệt **mật độ ký tự Anh–Việt** chứ không thuần
là mật độ lời nói. Cụ thể hơn: tiếng Anh gói nhiều ký tự hơn vào mỗi giây lời
nói so với âm tiết tiếng Việt, nên **14 ký tự/giây là trần quy hoạch cho làn vi,
không phải phép đo của nó**. Không gì trong repo suy được tốc độ vi→en hôm nay;
Phase 6 task 6.5 phải đo riêng.

### Sửa lại số học quota — chặt hơn ước tính từ VIVOS

| Ở `N = 15`                               | plan.md | Suy từ VIVOS + giả định mật độ 60% | **Đo từ hội thoại thật** |
| ---------------------------------------- | ------- | ---------------------------------- | ------------------------ |
| req/phút, làn live                       | ~72     | ~28                                | **~56**                  |
| req/phút, bucket `gemini-3.5-flash-lite` | —       | —                                  | **~62 / 90**             |
| Phút/ngày trong 3000 RPD                 | ~42     | ~109                               | **~48**                  |

**Vì sao là 62 chứ không phải 56:** bản dịch cuối lượt dùng **chung bucket** với
làn live. `LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite']`
(`translation-model-policy.ts:75`) và bậc đầu của `FINAL_MODELS` cũng là
`gemini-3.5-flash-lite` (`:40`) — đây chính là red-team finding 3. Cộng 5,74
lượt/phút × 1 bản dịch cuối vào 56 thì bucket đó gánh **~62 trên 90 RPM**, và
3000 RPD chia cho 62 ra **~48 phút hội thoại liên tục mỗi ngày**.

Speculation **không** cộng vào con số đó: `SPECULATION_MODELS` bắt đầu ở
`gemini-3.1-flash-lite` (`:44`), chỉ bậc dự phòng mới chạm 3.5. Chỉ khi ladder
phải đi tiếp thì nó mới đè lên bucket này.

Giả định _"mật độ lời nói 60%"_ của plan.md **không đúng với cách người dùng thật
nói**: hội thoại thật chạy ~14 ký tự/giây **đồng hồ**, cao hơn cả tốc độ chốt
11,5 ký tự/giây **lời nói** mà VIVOS cho.

Và làn live không phải khoản chi duy nhất. Cộng thêm: **5,74 lượt/phút** × 1 bản
dịch cuối mỗi lượt, cộng speculation tới `MAX_SPECULATIONS_PER_TURN = 4` mỗi lượt.
Tổng đỉnh áp sát trần 90 RPM chứ không thoải mái.

**Phase 4 phải dựng ngân sách trên 14 ký tự/giây, không phải 27 của plan.md và
cũng không phải 11,5 của VIVOS.**

### Chi tiêu nền — ĐO ĐƯỢC, từ `turn-metrics.jsonl` thật

Bản trước của báo cáo này ghi "chưa đo được". **Sai** — dữ liệu có thật, ở
`~/chatofy-metrics/turn-metrics.jsonl` (58 KB, sửa lần cuối 13/09, khớp đúng ngày
các hội thoại trong Postgres).

Vì sao container không có `/metrics`: `docs/development-journey.md:683-684` ghi
sẵn — _"CD không truyền `-f` override nên bind mount turn-metrics phải gắn lại
tay sau mỗi deploy"_. Lần deploy gần nhất chưa gắn lại, nên sink im lặng từ đó.
Tệp cũ vẫn còn trên máy.

```
104 lượt · 430,0 giây lời nói bắt được (7,17 phút) · toàn bộ en_to_vi
liveTranslations tổng =  93  ->  13,0 mỗi phút LỜI NÓI
speculations    tổng = 292  ->  40,7 mỗi phút LỜI NÓI
targetChars     tổng = 7626
```

**Tách theo bucket model.** `speculations` chủ yếu nằm ở
`gemini-3.1-flash-lite` (`SPECULATION_MODELS[0]`, `:44`), chỉ bậc dự phòng mới
chạm 3.5. Nên nền của bucket `gemini-3.5-flash-lite` — bucket mà làn live và bản
dịch cuối dùng chung — là **13,0 live/phút lời nói** cộng bản dịch cuối, chứ
không phải 53,7.

Đây là số đo **dưới chính sách CŨ** (`MIN_SPEECH_SECONDS = 3`,
`MAX_PER_TURN = 3`). Phase 4 thay chính sách đó, nên 13,0 là **nền để trừ đi**,
không phải dự báo.

### Biên cắt 8 giây — cũng đo được, và thấp hơn ước tính

| Số                                              | Giá trị             |
| ----------------------------------------------- | ------------------- |
| Lượt bị **cắt cưỡng bức** (`cutForced`)         | **22/104 = 21,2%**  |
| Lượt chạm sát trần 8 giây (`capturedMs ≥ 7900`) | **4/104 = 3,8%**    |
| `capturedMs` p50 / max                          | 3644ms / **8056ms** |

Hai điều rút ra.

**Ước tính 28% từ khối hiển thị là cận trên, số thật là 21,2%.** Và quan trọng
hơn: `cutForced` gộp cả trần cứng 8 giây lẫn cú cắt theo lookahead ở chỗ lặng
(`display-groups.ts:85-89`). Chỉ **3,8%** lượt thực sự chạm trần cứng — nên đa số
lần cắt rơi vào **chỗ đã lặng**, không phải giữa từ. Điều này làm hiểm hoạ
"committer bị `reset()` giữa câu" **nhẹ hơn** những gì counsel dự đoán.

**`capturedMs` max = 8056ms xác nhận bất biến cửa sổ bằng số đo thật.** Cộng
`PRE_ROLL_MS = 320` ra 8376ms, dưới cửa sổ 9000ms. Cửa sổ không trượt trên client
web, đúng như Phase 3 task 3.5 dựa vào.

### Số 429 nền

Log container không phủ giai đoạn có lưu lượng (container khởi động 15/09, hội
thoại ngày 12–13/09), nên "0 lần `rate limited on`" ở đó **không có giá trị làm
đường cơ sở**. `TurnMetrics` chưa có trường quota — đó chính là red-team finding
9, và Phase 4 task 4.7 thêm `quotaCooldowns` để Phase 6 đo được.

## Thiên lệch còn lại

1. **Giọng đọc, không phải hội thoại.** VIVOS là văn bản đọc trong phòng thu:
   không ngập ngừng, không "ừm", không nói chồng, không tiếng ồn. Thiên về **lạc
   quan** — lời nói thật khiến hypothesis bất ổn hơn, tức nhiều lần phân kỳ hơn.
2. **Không lượt nào chạm trần 8 giây — và lời nói thật thì chạm liên tục.**
   Clip dài nhất 6,44s + 320ms pre-roll = 6,76s, dưới cửa sổ 9s. Lịch sử prod
   cho con số thật của thiên lệch này: **35/125 = 28%** khối hiển thị dài hơn
   ~112 ký tự, tức hơn ~8 giây lời nói ở tốc độ đo được; khối dài nhất 312 ký
   tự. Vì `display-groups.ts` gộp các lượt phía client **trước khi** ghi, một
   khối dài như vậy chính là nhiều lượt đã bị `MAX_UTTERANCE_MS = 8000` cắt
   cưỡng bức.

   Hai hệ quả. Bất biến cửa sổ **giữ được bằng cấu trúc** — buffer tối đa 8,32s
   < cửa sổ 9s — nhưng đường cắt cưỡng bức bị đi qua **thường xuyên**, không
   phải hiếm. Và trên ~28% lời nói thật, committer sẽ bị `reset()` **giữa câu**,
   một tình huống mà 50 clip VIVOS không hề chạm tới.

3. **Audio liền mạch.** Harness nạp audio liên tục, không có khoảng lặng mà
   `SpeechGate` (`SPEECH_HANGOVER_MS = 500`) sẽ giữ lại. Thiên về **lạc quan**:
   ít vòng decode trên audio im lặng hơn thực tế.
4. **Đồng hồ mô phỏng.** Đồng hồ audio tiến theo bước 300ms và cộng thời gian
   decode đo thật, thay vì chạy real-time có sleep. Trung thực với cổng duty,
   nhưng không tái hiện tranh chấp lane khi nhiều phiên chạy cùng lúc.
5. **Máy có tải nền.** load average 4,64 lúc chạy (phiên khác của người dùng).
   Thiên về **bi quan** cho `decode_ms` — chiều an toàn cho một cổng.
6. **Một chiều.** Chỉ đo tiếng Việt. `moonshine-en` chưa đo; Phase 3 suy nhịp
   en→vi theo tỉ lệ RTF chứ không có số trực tiếp.

## Phán quyết

**PHÁN QUYẾT: DỪNG**

Chạm cổng **G2** ở **cả hai** mức hold-back: `stall_p95_s` = **2,7s** (hold-back 0)
và **2,7s** (hold-back 2), đều vượt ngưỡng 2,0s. Theo phase-01 mục `Cổng hủy`:
không bắt đầu Phase 2, báo người dùng kèm số.

G1 **không** chạm: `commit_lag_p95_s` vượt 2,0s ở 0/50 clip tại hold-back 0.

### Cách gộp corpus đã chọn, và vì sao — ghi ra để không ai nghi là chọn cho tiện

`stall_p95_s` là trường **theo từng clip**, và phase-01 không nói gộp toàn corpus
bằng cách nào. Hai cách cho hai phán quyết ngược nhau:

| Cách gộp                       | hold-back 0 | hold-back 2 | G2              |
| ------------------------------ | ----------- | ----------- | --------------- |
| Trung vị các giá trị theo clip | 0,60s       | 1,20s       | không nổ        |
| **p95 toàn corpus** (đã chọn)  | **2,70s**   | **2,70s**   | **nổ ở cả hai** |

Chọn p95 toàn corpus, vì ba lý do:

1. **`stall_p95_s` thực chất là `stall_max_s`.** Kiểm trên dữ liệu: hai trường
   bằng nhau ở **50/50** clip, vì nearest-rank p95 trên 3–6 khoảng chính là max.
   Nên trường này đọc là _"lần đứng im tệ nhất của lượt này"_, và p95 toàn corpus
   đọc thành một câu tiếng Việt rõ nghĩa: **hơn 5% số lượt có một lần đứng im quá
   2 giây**. Thực đo: 14% (hb0) và 10% (hb2).
2. **Lý do của cổng mô tả một sự kiện hỏng**, không phải hành vi điển hình. Một
   cổng hủy chỉ nổ khi lượt _trung vị_ cũng hỏng thì không phải cổng hủy.
3. Không dùng p95 gộp chung mọi khoảng của mọi clip: các khoảng thô không được
   lưu, và ~7 khoảng xấu trên ~250 sẽ bị pha loãng xuống dưới ngưỡng — tức một
   phán quyết ĐI TIẾP có được bằng cách lấy trung bình các lần hỏng.

### Lý do thứ hai để dừng, không phụ thuộc cách gộp

Kể cả khi đọc G2 theo trung vị và cho ĐI TIẾP, thiết kế hiện tại **vẫn trượt
nghiệm thu Phase 6 task 6.3 theo cấu trúc**.

Phase 3 vẫn phát `server.transcript.partial` mỗi vòng và chỉ chặn `delta` ở vòng
phân kỳ. Reducer client xử lý `partial` bằng `patchLive(state, sessionId, { text })`
— ghi đè `text` mà **không** động tới `committedChars`
(`turn-keyed-transcript.ts:504-508`). Chính comment tại chỗ đó đã ghi lý do:
_"the recogniser ... can revise a word it already offered"_.

Nên trên `VIVOSDEV02_R045`, vùng đang được tô là "đã chốt" đổi từ `Cơ` sang `Cô`
ngay trên màn hình. Task 6.3 đếm đúng hiện tượng này bằng `MutationObserver` và
đòi **0** vi phạm. Với 14% số lượt sinh ra ít nhất một vi phạm, tiêu chí đó không
thể đạt — và ta sẽ phát hiện ở Phase 6 sau khi đã viết xong 4 phase.

### Kết quả lặp lại được, không phải nhiễu đồng hồ

Chạy lại toàn bộ 50 clip lần thứ hai (cùng cấu hình, lần này lưu cả chuỗi
snapshot thô vào `results/r6-commit/vi-sidecar-snapshots.jsonl`, 598 snapshot):

|                                    | Lần 1     | Lần 2         |
| ---------------------------------- | --------- | ------------- |
| WER `final_hypothesis`             | 0,0538    | **0,0538**    |
| `stall_p95` toàn corpus, hb0 / hb2 | 2,7 / 2,7 | **2,7 / 2,7** |
| Clip vượt 2,0s, hb0 / hb2          | 7 / 5     | **7 / 5**     |

Trùng khớp. Phán quyết không phụ thuộc vào biến động thời gian decode của một
lần chạy.

Chuỗi snapshot giờ được lưu, nên **mọi phép chấm lại — LocalAgreement-n, mức
hold-back khác, luật chốt khác — chạy ngoại tuyến không tốn thêm một lần decode
nào**. Bản đầu của harness không lưu, nên thử một biến thể phải chạy lại cả 50
clip.

### Điều cổng KHÔNG chứng minh

Dừng ở đây **không** có nghĩa giả định chịu lực của kế hoạch sai. Trên **43/50
lượt (86%)** tiền tố tiến đều, đứng im tệ nhất ≤ 1,2 giây, và chốt nhanh —
`commit_lag_p95` vượt 2 giây ở 0/50. Cơ chế hỏng hẹp và xác định được:

> Bộ nhận dạng phát một âm tiết đầu **sai nhưng ổn định qua hai vòng**, đủ để
> LocalAgreement-2 chốt nó. Sau đó nó sửa, phần đã chốt hết là tiền tố, và vùng
> chốt hoặc bị viết lại trên màn hình hoặc mâu thuẫn với phần chờ.

Bằng chứng nó là **một** cơ chế chứ không phải nhiễu: **7/7** clip vượt ngưỡng ở
hold-back 0 đều có `committed_vs_final_mismatch_chars > 0`. Đứng im và chốt sai
là **cùng một sự kiện**, không phải hai.

Vì vậy phán quyết đúng là _"thiết kế Phase 2 như đang viết thì dừng"_, không phải
_"bỏ hướng chốt"_.

## Chấm lại các biến thể luật chốt — ngoại tuyến, trên cùng 598 snapshot

Không tốn thêm một lần decode nào. `>2s` là số clip có lần đứng im tệ nhất vượt
2 giây (cổng G2 đếm cái này); `ghi đè` là số lần vùng đã chốt bị thay.

| Biến thể                         | >2s      | p95     | ký tự/s   | lệch      | WER phần chốt | ghi đè |
| -------------------------------- | -------- | ------- | --------- | --------- | ------------- | ------ |
| **LA-2 hb0 — thiết kế hiện tại** | **7/50** | 2,7     | 11,52     | 6,26%     | 0,1918        | 0      |
| LA-2 hb2                         | 5/50     | 2,7     | 9,42      | 2,33%     | 0,2921        | 0      |
| LA-3 hb0                         | 5/50     | 2,4     | 10,77     | 3,79%     | 0,1918        | 0      |
| LA-2 hb0 + chờ 1,0s mới chốt     | 6/50     | 2,7     | 11,62     | 6,00%     | 0,1738        | 0      |
| LA-2 hb0 + chờ 1,5s mới chốt     | 6/50     | 2,7     | 11,62     | 6,00%     | 0,1738        | 0      |
| LA-3 hb0 + chờ 1,0s              | 5/50     | 2,4     | 10,77     | 3,79%     | 0,1918        | 0      |
| **LA-2 hb0 + neo lại**           | **0/50** | **1,2** | **11,92** | **1,37%** | **0,0717**    | **13** |
| LA-2 hb0 + chờ 1,0s + neo lại    | 0/50     | 1,2     | 11,92     | 1,37%     | 0,0717        | 12     |

**Không tham số nào cứu được thiết kế. Chỉ neo lại cứu, và nó cứu triệt để.**

- Tăng `n` của LocalAgreement lên 3: 7 → 5 clip. Vẫn trượt G2. Một mẩu sai có thể
  ổn định qua ba vòng cũng dễ như qua hai.
- Chờ 1,0s hay 1,5s trước khi chốt lần đầu: 7 → 6 clip, p95 **không đổi**. Trên
  corpus này nó gần như không làm gì.
- Neo lại: **0/50**, p95 xuống 1,2s, chốt được **nhiều hơn** (11,92 so với 11,52),
  lệch giảm từ 6,26% xuống 1,37%, và WER phần chốt rơi từ 0,1918 xuống **0,0717**
  — gần chạm 0,0538 của bản cuối.

Giá phải trả là **13 lần ghi đè trên 50 lượt**, tức 0,26 lần mỗi lượt. Và chúng
không phải nhấp nháy vô nghĩa — mỗi lần là một mẩu sai bị thay bằng chữ đúng:

| Clip              | Hiện tại chốt được           | Neo lại chốt được                                                     |
| ----------------- | ---------------------------- | --------------------------------------------------------------------- |
| `VIVOSDEV02_R045` | `Cơ`                         | `Cô cứ nhè cái nọc cá chê`                                            |
| `VIVOSDEV15_066`  | `Kém quá nhiều`              | `Kẽm có nhiều trong gan sò thịt đỏ cá óc trứng`                       |
| `VIVOSDEV17_099`  | `Chỉ`                        | `Chị tìm nhà cho em ở trọ ngay cổng trường chị học`                   |
| `VIVOSDEV19_257`  | `Nhưng nếu chị nói cái giỏi` | `Nhưng nếu chỉ nói cái giỏi không thôi thì thật sự chưa đủ về chú tư` |

### Dây điện đã chịu được neo lại — không cần đổi giao thức

Phase 3 task 3.4 **đã** gửi chuỗi chốt tuyệt đối (`committed: z.string()`), và
reducer dựng lại cả dòng từ rỗng:

```ts
const text = appendCapped('', event.committed + event.pending);
committedChars: Math.max(0, text.length - event.pending.length);
```

Client **không cộng gì**. Nên một `committed` không nối tiếp cái trước vẫn chạy
đúng về cơ khí: cả dòng được thay. Đây là hệ quả ngoài ý muốn của bản sửa
red-team finding 4 — nó được làm để chặn `partial` phá `committedChars`, và nhân
tiện làm neo lại thành khả thi mà không phải đổi giao thức.

Thứ **phải** đổi là ba chỗ:

1. **Phase 2** bỏ quy tắc "phần đã chốt là bất biến", thay bằng neo lại có cổng
   đồng thuận.
2. **Tiêu chí nghiệm thu** _"phần chốt bị viết lại trên DOM = 0"_ không còn đúng
   được nữa. Nó phải thành _"0 lần viết lại ngoài dự kiến, và ≤ k lần neo lại có
   cổng"_. Đây là ngưỡng người dùng đã chốt, nên **phải hỏi**.
3. **Phase 6 task 6.3** đổi theo.

### Một dự đoán của counsel mà số đo không xác nhận

Counsel xếp "chờ đủ lời nói rồi mới chốt lần đầu" là _"thứ phải làm trước tiên"_,
vì nó re-arm ở mỗi lần cắt cưỡng bức. Trên corpus này nó gần như vô dụng (7 → 6,
p95 không đổi). Nhưng lập luận của counsel nói về **biên cắt cưỡng bức**, mà VIVOS
không có clip nào chạm tới — nên đây là **chưa kiểm được**, không phải đã bác bỏ.
Dữ liệu prod cho thấy 28% khối thật đi qua biên đó.
