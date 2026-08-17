---
title: 'Phase 2b: bốn phép đo còn nợ'
date: 2026-08-17
plan: 260813-2239-cascade-streaming-clause-commit
phase: 2b
status: done
verdict: 2 đạt / 2 không đạt
---

# Phase 2b: bốn phép đo còn nợ

Chạy trên máy thật (16 lõi), sidecar + api thật, fixture `vlsp-vi-01.wav` 41,5s
(VLSP 2020, ghép, có ngập ngừng thật). MT là Gemini cloud thật.

**Kết quả một dòng:** transcript hiển thị **đạt đúng con số hứa**; đường phát
tiếng **không đạt** — và nguyên nhân không phải model, mà là hai lỗi ở dây nối
streaming. Số CPU đi **ngược** hướng phase này tuyên bố.

## Bảng kết quả

| #   | Tiêu chí                                  | Số đo                          | Kết     |
| --- | ----------------------------------------- | ------------------------------ | ------- |
| 1   | prefix-violation = 0 trên lượt 45s        | **421**                        | ✗       |
| 2   | transcript vi hiển thị về ~5,38% VIVOS-50 | **5,38%**                      | ✓       |
| 3   | CPU mỗi lượt giảm so với hôm nay          | **382s vs 193s — tăng 2×**     | ✗       |
| 4   | không lượt nào đứng im khi vượt 8s        | khoảng lặng dài nhất **7,59s** | ✓ (sát) |

## Lệnh sinh lại

```bash
# 2 — WER qua đúng đường HTTP app gọi, không gọi thẳng binding
uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py
uv run --directory benchmarks/stt python scripts/measure_sidecar_wer.py --engine nemotron

# 1, 3, 4 — một lượt streaming thật; cùng một lệnh cho cả hai cấu hình
node benchmarks/realtime/streaming-turn.mjs benchmarks/realtime/fixtures/vlsp-vi-01.wav \
  --lang vi --cpu-pid <api> --cpu-pid <stt>
# đường nền: khởi động sidecar với LOCAL_STT_VI_ENGINE=zipformer, chạy lại y hệt

# chẩn đoán #1
node benchmarks/realtime/stream-prefix-stability.mjs benchmarks/realtime/fixtures/vlsp-vi-01.wav --lang vi
```

`commitContradictions` đọc từ dòng `source=server` trong `TURN_METRICS_PATH`.

## 2 — Transcript hiển thị: đạt

| Engine                      | WER       | RTF   | p50   |
| --------------------------- | --------- | ----- | ----- |
| mặc định của sidecar cho vi | **5,38%** | 0,022 | 0,08s |
| `--engine nemotron`         | 11,29%    | 0,070 | 0,27s |

5,38% khớp đúng số zipformer đã ghi. Vì phép đo **không gửi trường `engine`**,
nó chứng minh luôn cái mà một phép đo in-process không chứng minh được: mặc định
vi của sidecar thật sự là engine hiển thị. Việc tách hai model có thật.

Nemotron ở đây 11,29% so với 10,93% ghi trước đó — cùng cỡ, chênh vì đường đo là
`/transcribe` cả cụm chứ không phải binding.

## 1 — Prefix violation: 421, không phải 0

Trên **một** lượt 41,5s. Giá trị phải là 0; 421 nghĩa là mệnh đề kiến trúc sai
**trên đường chạy**.

Đường nền (rollback zipformer, cùng lệnh) cho **16**. Tức cấu hình mới tệ hơn
đường nó thay thế **26 lần** ở đúng con số soundness.

Điều tra tiếp, và đây là phần quan trọng nhất của báo cáo: **model không sai.
Decoder không hề đọc lại audio cũ.** Lỗi nằm ở hai chỗ trên dây nối.

### Lỗi A — `.strip()` ăn mất dấu cách giữa hai delta

`strip_language_tags` (`parakeet_runtime.py:53`) kết thúc bằng `.strip()`, và
`streaming_sessions.py:156` áp nó lên **từng delta**. Người gọi nối thẳng
(`causal-transcriber.ts`: `this.running += delta`) đúng như hợp đồng bảo. Kết
quả là chữ dính nhau:

```
Ờ, nó làmngười dân, mặc dùnhìnthấy rấtlà bình thường, nhưngmàrất rất làphụnrằngtừtừtừtrêncác đườngphố
```

Đó là text **đang được dịch và phát ra tiếng** giữa lượt. Hàm này viết cho output
cả cụm, ở đó `.strip()` đúng; trên dòng delta nó phá ranh giới từ.

### Lỗi B — delta cắt giữa từ, mà chính sách vẫn commit ngay

```
feed 13: "n"   -> "nó là"      delta="ó là"
feed 16: "là"  -> "làm"        delta="m"
feed 22: "d"   -> "dân"        delta="ân"
```

Decoder phát ra **mảnh dưới-từ**. Từ cuối của mọi lần tích luỹ vì thế luôn là
tạm. `AGREEMENT_DEPTH_VI = 1` commit nó ngay lần thấy đầu — nên `"n"` được nói ra
trước khi thành `"nó"`.

Đây đúng là hình dạng lỗi mà phase 2b sinh ra để chống: tính chất chứng minh trên
binding, hỏng khi qua dây. Lần trước hỏng ở transport; lần này hỏng ở **đơn vị**
— binding trả mảnh, chính sách tưởng nhận từ.

Probe: 416 feed, 74 từ, **94 lần** token đã phát bị viết lại.

## 3 — CPU: tăng gấp đôi, không giảm

Cùng lệnh, cùng fixture, đo `utime+stime` từ `/proc` quanh đúng một lượt.

|                                             | sidecar STT                     | api   | routes sidecar                              |
| ------------------------------------------- | ------------------------------- | ----- | ------------------------------------------- |
| mới (nemotron causal + zipformer hiển thị)  | **382,17s** = 9,21 lõi liên tục | 1,72s | 218 `/transcribe`, 1 `/stream`, 160 `/feed` |
| đường nền (`LOCAL_STT_VI_ENGINE=zipformer`) | **192,76s** = 4,64 lõi          | 1,38s | 126 `/transcribe`, 1 `/stream` (409)        |

Phase 2b viết "ròng là nhẹ đi, nhưng phải đo chứ không được tuyên bố". Đã đo:
**nặng gấp đôi**. Lý do là cả hai đường cùng chạy — cửa sổ re-decode cho màn hình
**không** biến mất khi thêm dòng causal, nó vẫn nổ 218 lần decode cả cửa sổ.

Trần RTF ≤ 0,3 của dự án nói về một lõi cho một lượt. 9,21 lõi/lượt ở
`MAX_CONCURRENT_TURNS_GLOBAL = 6` là quá 16 lõi của máy này từ **lượt thứ hai**.

Đường nền cũng cho thấy rollback hoạt động: `/stream` trả 409, `CausalTranscriber`
trơ.

**Nhiễu chưa giải thích:** run mới gọi `/transcribe` 218 lần, đường nền 126 lần,
cùng độ dài audio. Nên phần "gấp đôi" không thuần tuý là chi phí dòng causal. Ghi
lại thay vì làm tròn cho gọn.

## 4 — Khoảng lặng commit: đạt, nhưng sát

|           | khoảng lặng dài nhất | commit đầu | số commit |
| --------- | -------------------- | ---------- | --------- |
| mới       | **7 588ms**          | 5 019ms    | 11        |
| đường nền | 5 337ms              | 5 337ms    | 13        |

Triệu chứng "transcript đứng im sau 8s" **hết**: lượt 41,5s commit đều suốt chiều
dài, không có mốc nào chững ở 8s. Đó là thứ tiêu chí này hỏi, nên tính là đạt.

Nhưng biên chỉ còn 0,4s, và **đường nền tốt hơn ở cả hai cột**. Số này không nên
được đọc như một thắng lợi.

Commit đầu 5,0s sau khi lượt mở, so với mục tiêu "hằng số chặn ~2s" của plan. Một
fixture chưa đủ để nói phẳng hay không phẳng — cần cả bộ, và đó là việc của
phase 6.

## Ba thứ khác đo được, không nằm trong tiêu chí

1. **`analyze-continuous.mjs` không dùng được cho đường này.** Nó đọc
   `server.clauseCommittedAt`, `server.startedAt`, `server.contradictedCommits`
   — recorder không ghi field nào trong ba. Tên thật là `commitContradictions`,
   và **không có mảng mốc commit nào tồn tại**. `git log -S clauseCommittedAt`:
   tên đó chỉ có trong chính commit thêm analyzer (`e63480d`), viết theo một row
   shape chưa bao giờ được cài. Chạy nó lên file này sẽ in "— not recorded", tức
   **im lặng báo pass**. Đúng kiểu số nịnh mà README của harness cảnh báo. Vì
   vậy phép đo 1 và 4 ở đây lấy từ dòng server thô và từ phía nhận.
2. **Tag `</thought>` lọt ra output nói.** Commit seq 3: `"...two-year green card
until</thought>"`. Rác của model MT đi thẳng tới TTS.
3. **Bản dịch vẫn tốt bất chấp lỗi A.** Các commit đọc trôi chảy và khớp
   reference. Gemini nuốt được chữ dính. Nên lỗi A **không** tự lộ ra khi nghe —
   nó chỉ lộ khi đo.

## Câu hỏi chưa giải quyết

1. Sửa lỗi A ở đâu: bỏ `.strip()` khỏi đường delta (giữ cho `/transcribe`), hay
   để người gọi tự chèn dấu cách? Cái đầu đúng chỗ hơn nhưng đụng hàm dùng chung
   với harness benchmark.
2. Lỗi B chọn gì: giữ lại từ cuối chưa hoàn tất cho tới khi có ranh giới, hay
   nâng `AGREEMENT_DEPTH_VI` lên 2? Cái sau mâu thuẫn với chính lý do đổi engine.
3. CPU: đường hiển thị có nên bỏ re-decode cửa sổ khi dòng causal đang chạy
   không? Nếu có thì transcript hiển thị mất độ chính xác zipformer — tức đánh đổi
   ngược lại chính quyết định của phase 2b.
4. Sau khi sửa A và B, đo lại **toàn bộ** bảng này trước khi tick bất kỳ ô nào.
   Bốn số trên chỉ mô tả cấu hình hôm nay.
5. `analyze-continuous.mjs` sửa theo hướng nào: đổi tên field cho khớp recorder,
   hay để recorder ghi thêm mốc commit như analyzer vẫn giả định?
