---
report: overlap-measurement
phase: 8
task: 8.1
date: 2026-09-16
verdict: 'PHÁN QUYẾT: DỪNG'
---

# Cổng đo Phase 8 — cửa sổ và chồng lấp

Harness: `benchmarks/stt/scripts/streaming-arms/overlap_probe.py`, sidecar thật
ở `:8002`, corpus VIVOS (vi) và LibriSpeech (en) — cùng corpus Phase 1, nên số ở
đây so trực tiếp được với `measurement.md`.

## PHÁN QUYẾT: DỪNG

Phương án B trượt **cả hai** điều kiện đi tiếp. Không đi vào task 8.2.

Nhưng cùng phép đo đó cho thấy **phương án A đạt trọn mục tiêu của phase**, trái
với đánh giá tôi đưa ở phiên brainstorm. Chi tiết ở mục cuối.

## (a) Chi phí giải mã theo kích thước cửa sổ — trượt

Ngân sách 150 ms (ngưỡng lật của cổng duty ở divisor 2), p95, máy rảnh:

| Cửa sổ | vi p95 |     | en p95 |          |
| ------ | ------ | --- | ------ | -------- |
| 2,0s   | 83 ms  | ĐẠT | 171 ms | **VƯỢT** |
| 3,0s   | 86 ms  | ĐẠT | 175 ms | **VƯỢT** |
| 4,0s   | 102 ms | ĐẠT | 221 ms | **VƯỢT** |
| 5,0s   | 89 ms  | ĐẠT | 245 ms | **VƯỢT** |

**Moonshine có sàn chi phí cố định.** Từ 5,0s xuống 2,0s chỉ rẻ đi 30%, và vẫn
vượt ngân sách. Thu nhỏ cửa sổ **không** đưa tiếng Anh vào ngân sách được — đây
là tính chất của model, không phải của tham số.

## (b) Khâu theo chồng lấp — trượt

Cửa sổ 3,0s, hai chiều, sau khi đã sửa bộ khâu **hai lần**: chuẩn hoá hoa/thường
và dấu câu, rồi cắt cụt **cả hai đầu** (từ cuối `anchor` và từ đầu `tail` đều là
từ cụt, vì cửa sổ đóng và mở giữa chừng một từ).

Ô tốt nhất mỗi chiều:

| Chiều | Chồng lấp | min_tok | clip | đúng | SAI         | không nối   |
| ----- | --------- | ------- | ---- | ---- | ----------- | ----------- |
| vi    | 2,0s      | 2       | 13   | 11   | **2 (15%)** | 0           |
| en    | 2,0s      | 3       | 16   | 9    | 1 (6%)      | **6 (37%)** |

Điều kiện đi tiếp: khâu sai ≤ 2%, không nối ≤ 10%. **Không ô nào trong 24 ô của
lưới đạt được cả hai**, ở cả hai chiều.

Và ô "tốt nhất" đó tự mâu thuẫn với mục đích: chồng lấp 2,0s trên cửa sổ 3,0s
nghĩa là mỗi lần tiến chỉ thu được **1 giây audio mới** trong khi vẫn giải mã đủ
3 giây. Ba phần công cho một phần lợi.

### Vì sao khâu hỏng — và vì sao không sửa được bằng tham số

Vùng chồng lấp **được phiên âm khác nhau** giữa hai cửa sổ, vì cửa sổ sau bắt
đầu giữa chừng một từ và bộ nhận dạng không trả về từ cụt — nó trả về **từ
khác**:

```
anchor: ... chạy chọt bày ra          tail: Bị chọt bày ra cái dự án
anchor: ... gõ cửa phòng ba lan       tail: Ở phòng ba lan hai giấm dúi
anchor: ... these three men took down the lectures
tail  : And took down the lectures which Luther addressed
```

Cắt hai đầu cứu được 6 trên 11 ca. Năm ca còn lại là **hai lần đọc không có
chung đoạn chữ nào** — cửa sổ ngắn làm bộ nhận dạng đọc ra nội dung khác hẳn.
Không có ngưỡng nào phân biệt được ca đó với một mối nối thật, nên nới ngưỡng
chỉ đổi "không nối" thành "nối sai", mà nối sai là hỏng nặng hơn: một cụm chữ
đã lên màn hình bị nối thêm sai chỗ.

## Điều làm phép đo này đáng giá hơn cái nó bác bỏ

Chi phí giải mã trên **lời nói dày** (nối clip, vì clip lẻ chỉ tới 6,6s nên không
nói được gì về buffer 8–9s — chỗ đau duy nhất), p50, máy rảnh:

| Buffer | vi     | en     | `divisor 2` | nhịp    | `divisor 1` | nhịp    |
| ------ | ------ | ------ | ----------- | ------- | ----------- | ------- |
| 1s     | 55 ms  | 102 ms | 300 ms      | 3,33 /s | 300 ms      | 3,33 /s |
| 3s     | 86 ms  | 147 ms | 300 ms      | 3,33 /s | 300 ms      | 3,33 /s |
| 5s     | 107 ms | 210 ms | 420 ms      | 2,38 /s | 300 ms      | 3,33 /s |
| 7s     | 116 ms | 241 ms | 481 ms      | 2,08 /s | 300 ms      | 3,33 /s |
| 9s     | 152 ms | 289 ms | 579 ms      | 1,73 /s | 300 ms      | 3,33 /s |

**Ở divisor 1, cả hai engine giữ 3,33 nhịp/giây ở mọi độ dài buffer từ 1 đến 9
giây.** Phẳng tuyệt đối, chênh 0%. Vì chi phí giải mã tiếng Anh đạt đỉnh 289 ms ở
buffer 9 giây — vẫn **dưới** sàn 300 ms, nên sàn quyết định nhịp suốt.

Cái tạo ra sự chậm dần là **phép nhân đôi**, không phải chi phí giải mã.

### Tôi đã đánh giá sai phương án A

Ở phiên brainstorm tôi viết A _"không làm phẳng — câu dài vẫn chậm dần, chỉ chậm
bằng nửa"_. Sai. Tôi ước từ số đo trên một clip họp có đoạn đầu gần im lặng, ra
307 ms ở buffer 9 giây — vừa **trên** sàn. Trên lời nói dày thật thì là 289 ms,
vừa **dưới** sàn. Ở cả hai con số thì gate đều nằm ở sàn, và nhịp phẳng.

## Còn lại: tranh chấp CPU với TTS

Khi TTS tổng hợp cùng lúc, tiếng Anh ở buffer 9 giây lên 660 ms — vượt sàn, nên
divisor 1 cũng không cứu được (nhịp 1,5/s). Đây là **vấn đề riêng**, nguyên nhân
là 8 luồng STT × 4 lane cộng 8 luồng TTS trên 8 core vật lý.

Phép đo trên là tải TTS **liên tục**, tức trường hợp xấu nhất. Trong ứng dụng
thật TTS chỉ chạy từng đợt ngắn (~550 ms mỗi mệnh đề). Mức độ thật phải đo trên
phiên thật, không đo bằng bộ tạo tải.

## Câu hỏi chưa giải được

Giảm `LOCAL_STT_THREADS` có bớt tranh chấp không, và bớt bao nhiêu. Chưa đo —
phải khởi động lại container với từng giá trị.
