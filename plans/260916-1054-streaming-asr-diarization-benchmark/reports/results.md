---
phase: 3-4
date: 2026-09-16
run-tags: r4 (thăm dò, một số arm chạy song song) · r5 (TUẦN TỰ, dùng làm số chính thức)
status: đo xong, phán quyết KHÔNG AI QUA
---

# Kết quả đo — Phase 3 & 4

## Phán quyết

**Không ứng viên nào qua thanh chắn** (WER ≤ 5,38% vi và ≤ 3,86% en). Ứng viên
tốt nhất trên tiếng Việt đạt 12,37%, gấp **2,3 lần** tỉ lệ lỗi của incumbent.

**Tốc độ không phải rào cản — độ chính xác mới là.** Cấu hình Nemotron tốt nhất
đạt RTF 0,0788 ở đúng 4 thread production, xa dưới trần 0,30.

## Điều kiện đo

`r5` chạy **tuần tự** 16 cấu hình trong 12 phút trên máy rảnh và là số chính thức.
`r4` chạy trước đó với vài arm song song; WER của nó vẫn hợp lệ (xem kiểm tính tất
định) nhưng **RTF của r4 bị nhiễu do tranh CPU** và không dùng.

Bộ test: VIVOS-50 (199,2s audio) và LibriSpeech-50 (286,9s), seed 42, greedy.

## Tiếng Việt — VIVOS-50

| Engine                                       | WER       | CER       | RTF    | p95    |
| -------------------------------------------- | --------- | --------- | ------ | ------ |
| **sherpa-zipformer-vi** (incumbent, offline) | **5,38%** | **2,90%** | 0,0215 | 0,161s |
| moonshine-vi — batch                         | 10,22%    | 6,21%     | 0,0247 | 0,142s |
| moonshine-vi — streaming 320ms               | 12,37%    | 8,23%     | 0,0459 | 0,275s |
| moonshine-vi — streaming + diarization       | 12,37%    | 8,23%     | 0,0717 | 0,414s |
| nemotron 1120ms                              | 15,77%    | 8,23%     | 0,0788 | 0,428s |
| nemotron 560ms                               | 15,95%    | 8,98%     | 0,1203 | 0,637s |
| nemotron 320ms                               | 22,22%    | 11,75%    | 0,1848 | 0,975s |
| nemotron 160ms                               | 29,39%    | 19,23%    | 0,3394 | 1,804s |
| nemotron 80ms                                | 41,76%    | 26,62%    | 0,6545 | 3,409s |

## Tiếng Anh — LibriSpeech-50

| Engine                                       | WER       | CER       | RTF    | p95    |
| -------------------------------------------- | --------- | --------- | ------ | ------ |
| **sherpa-moonshine-en** (incumbent, offline) | **3,86%** | **1,81%** | 0,0550 | 0,487s |
| moonshine medium-streaming-en                | 3,98%     | 2,32%     | 0,4905 | 5,371s |
| moonshine small-streaming-en                 | 5,43%     | 3,51%     | 0,3470 | 3,768s |
| nemotron 560ms                               | 7,36%     | 3,21%     | 0,1168 | 1,086s |
| moonshine tiny-streaming-en                  | 8,32%     | 4,46%     | 0,1950 | 2,066s |

## Năm phát hiện

### 1. Nemotron không bao giờ viết lại chữ — Moonshine thì có

Đây là phát hiện mà **WER che mất hoàn toàn**, và là lý do phép đo sâu đáng làm.

|                    | Chữ đầu xuất hiện | Viết lại p50 | Viết lại p95 | Số lần cập nhật |
| ------------------ | ----------------- | ------------ | ------------ | --------------- |
| moonshine-vi 320ms | **1,28s**         | 10,7%        | **88,9%**    | 5               |
| nemotron 560ms     | 1,68s             | **0,0%**     | **0,0%**     | 6               |

Nemotron thuần tuý nối thêm chữ — đúng tính chất `append-mostly` mà contract thiết
kế trước đặt ra. Moonshine sửa lại 10,7% ký tự ở trung vị và gần như toàn bộ ở 5%
câu tệ nhất, tức **màn hình nhấp nháy**.

Theo WER thì Moonshine thắng (12,37% so với 15,95%). Theo hành vi streaming thì
ngược lại hoàn toàn. Một bảng xếp hạng chỉ có WER sẽ chọn nhầm.

### 2. Giá của streaming, đo tách bạch: **+2,15 điểm WER**

Cùng model Moonshine, cùng audio, chỉ khác đường chạy:

|                                        | WER                 | CER          |
| -------------------------------------- | ------------------- | ------------ |
| batch (`transcribe_without_streaming`) | 10,22%              | 6,21%        |
| streaming (đút chunk)                  | 12,37%              | 8,23%        |
| **chênh lệch**                         | **+2,15 pp (+21%)** | **+2,02 pp** |

Cơ chế bắt được tận tay ở `VIVOSDEV13_089`: ba dòng, `line_id` khác nhau, khoảng
thời gian **không chồng lấn**, và dòng thứ hai phát lại phần đầu của dòng thứ nhất.

```
0,00–2,27s   "nhà văn nguyên ngọc sinh"
2,40–4,74s   "nhà văn nguyễn ngọc sinh viên có"   ← phát lại prefix
4,58–6,40s   "huề hoài nghi và tranh"
```

### 3. Chunk size: đòn bẩy của Nemotron, vô nghĩa với Moonshine

Nemotron trên VIVOS, quét đủ 5 bản export:

| chunk | 80ms   | 160ms  | 320ms  | 560ms  | 1120ms     |
| ----- | ------ | ------ | ------ | ------ | ---------- |
| WER   | 41,76% | 29,39% | 22,22% | 15,95% | **15,77%** |

Dốc hơn nhiều so với mức model card gợi ý trên FLEURS (13,41% → 11,18%), và **bão
hoà ở 560ms** — 1120ms chỉ mua thêm 0,18 điểm.

Moonshine ngược lại: feed 160 / 320 / 640ms cho ra **đúng cùng một con số**
12,37% / 8,23%. Lookahead của nó cố định 80ms bên trong, nên chunk chỉ là cách
client trao audio. Nemotron thì chunk là **thuộc tính của model** — 5 file export
khác nhau.

### 4. Tiếng Anh: incumbent nằm ngoài biên streaming ở cả hai trục

| Model                           | WER       | RTF        |
| ------------------------------- | --------- | ---------- |
| tiny-streaming-en               | 8,32%     | 0,1950     |
| small-streaming-en              | 5,43%     | 0,3470     |
| medium-streaming-en             | **3,98%** | **0,4905** |
| **base-en offline (incumbent)** | **3,86%** | **0,0550** |

Model streaming duy nhất gần bằng incumbent (+0,12 điểm) thì chậm gấp **9 lần** và
trượt trần RTF. Những model đủ nhanh thì kém gấp đôi. Không có điểm nào trên đường
cong vừa nhanh hơn vừa đúng hơn incumbent.

Bất đối xứng đáng chú ý: streaming **tiếng Anh** gần bằng offline (+0,12 điểm),
còn streaming **tiếng Việt** kém 2,3 lần. Đó là khoảng cách tài nguyên ngôn ngữ,
không phải khuyết tật của streaming.

### 5. Diarization: **+56% CPU**, không ảnh hưởng chữ

RTF 0,0459 → 0,0717 khi bật `identify_speakers`. WER không đổi (12,37%). Số người
nói phát hiện được là 1 mỗi câu — đúng, vì VIVOS là audio đơn thoại; nó không bịa
thêm người. Đây chỉ là kiểm tra vệ sinh, **không phải phép đo độ chính xác
diarization** — không có bộ test tiếng Việt có nhãn để làm việc đó.

## Kiểm tính tất định và độ biến thiên

| Config       | WER r4 → r5                  | RTF r4 → r5 |
| ------------ | ---------------------------- | ----------- |
| zipformer-vi | 5,38% → 5,38% (**Δ 0,00**)   | +71,6%      |
| moonshine-en | 3,86% → 3,86% (**Δ 0,00**)   | +69,0%      |
| nemo-320-vi  | 22,22% → 22,22% (**Δ 0,00**) | +0,1%       |
| nemo-560-vi  | 15,95% → 15,95% (**Δ 0,00**) | −9,1%       |
| ms-vi-stream | 12,37% → 12,37% (**Δ 0,00**) | −11,1%      |
| ms-en-a2     | 8,32% → 8,32% (**Δ 0,00**)   | −28,9%      |

**WER giống hệt nhau trên mọi cấu hình** — greedy tất định, harness lành.

**RTF dao động tới ±70% tuỳ trạng thái máy.** Hệ quả phải nói rõ: phán quyết RTF
**sát ngưỡng không đáng tin**. Cụ thể `nemotron-160ms` (0,3394) và
`moonshine-small-en` (0,3470) nằm trong vùng không kết luận được. Các cấu hình
cách xa ngưỡng thì an toàn.

## Đính chính Phase 1: license của Moonshine

Phase 1 ghi Moonshine là **MIT** và coi đó là lý do chính để đổi. **Sai.** MIT là
license của wheel/SDK, không phải của weight tiếng Việt. Source của chính package
(`moonshine_voice/download.py`):

```python
if wanted_language != "en":
    print("Using a model released under the non-commercial "
          "Moonshine Community License. ...", file=sys.stderr)
```

In ra cho **mọi ngôn ngữ trừ tiếng Anh**, và đã in ra thật khi tải
`tiny-streaming-vi`. Moonshine **không gỡ được chốt CC-BY-NC-ND** — nó đổi một
license phi thương mại lấy một license phi thương mại khác. Nemotron với
OpenMDW-1.1 là ứng viên duy nhất gỡ được, và nó trượt trục chất lượng.

## Xác minh cổng của kế hoạch

| Cổng                              | Kết quả                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **N3** đối chứng tái lập mốc nền  | **QUA** — vi 5,38 / CER 2,90 và en 3,86 khớp `development-journey.md:122-131`                              |
| **N4** không đụng kết quả cũ      | **QUA** — `r1`, `r2`, `r3-decoder-arms` nguyên vẹn                                                         |
| **N6** không sửa code sản phẩm    | **QUA** — `git status` sạch trên `apps/`, `packages/`, `services/`                                         |
| **A8** RTF ≤ 0,30 ở 4 thread      | **QUA với cả hai ứng viên** ở cấu hình tốt nhất                                                            |
| **A19** pin được ngôn ngữ         | **QUA** — `set_option("language", …)` nhận `"vi"`, `"vi-VN"`, `"auto"`; token là `<vi-VN>`, 39 mã ngôn ngữ |
| **A1/A2** WER ≤ 5,38 / CER ≤ 2,90 | **TRƯỢT với mọi ứng viên**, biên rất rộng                                                                  |

## Phần thưởng có thật nhưng không cứu được phương án

Nemotron xuất transcript có **dấu câu và viết hoa gốc** — _"Ngọn lửa bạo động ở
trung đông và phá vỡ lộ trình bình"_ — so với ALL-CAPS không dấu câu của incumbent.
Đây đúng là thứ gỡ được hack postprocess ở `zipformer_vi.py:34-47`. Cộng với tỉ lệ
viết lại 0%, nó là ứng viên **hành xử đúng chuẩn streaming nhất**. Nhưng WER 15,77%
thì không đánh đổi được với 5,38%.

## Câu hỏi chưa giải quyết

1. **Không đo được độ chính xác diarization** — không có bộ test tiếng Việt có
   nhãn thời gian. Chi phí thì đã đo (+56% CPU). Vì thanh chắn yêu cầu thắng cả
   hai trục và mọi ứng viên đã trượt trục WER, phán quyết không đổi.
2. **Chưa đo RTF khi sidecar TTS chạy cùng.** Không còn cần cho phán quyết —
   phương án chết ở chất lượng, không ở tốc độ.
3. **Hai phán quyết RTF nằm trong vùng nhiễu** (`nemotron-160ms`,
   `moonshine-small-en`). Cần chạy lặp trên máy tĩnh nếu con số đó quan trọng.
4. **Đường ChunkFormer vẫn mở và được củng cố.** Mọi model streaming có sẵn nằm
   trong khoảng 12–42% trên VIVOS, trong khi ChunkFormer offline công bố **2,49%**
   trên cùng bộ test. Khoảng cách giữa "streaming có sẵn" và "chất lượng đạt được"
   giờ đã được đo chứ không còn là suy đoán.
