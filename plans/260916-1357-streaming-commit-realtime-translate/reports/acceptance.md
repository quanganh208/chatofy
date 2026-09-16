---
report: acceptance
phase: 6
date: 2026-09-16
status: 'một phần — 7/10 tiêu chí có số, 3 chờ một phiên nói'
---

# Nghiệm thu Phase 6 — phần đã đo

## Bảng tiêu chí

| Tiêu chí                  | Ngưỡng               | Đo được                                   |     |
| ------------------------- | -------------------- | ----------------------------------------- | --- |
| `quotaCooldowns` cộng dồn | 0                    | **0** trên 16 lượt                        | ĐẠT |
| 503 của sidecar           | 0                    | **0** trên 2454 request `/transcribe`     | ĐẠT |
| Nhịp partial en→vi        | ≤ P1 × 1,25          | p50 **310 ms**, p95 586 ms                | ĐẠT |
| Nhịp khi TTS chạy cùng    | ≥ 3 /s               | **3,2 /s** (p50, cùng phiên, TTS có chạy) | ĐẠT |
| Chi phí giải mã phẳng     | chênh ≤ 25%          | 300 ms ở mọi buffer 1→9s                  | ĐẠT |
| WER cuối lượt (vi)        | = 5,38%              | **0,0538**                                | ĐẠT |
| CER cuối lượt (vi)        | = 2,90%              | **0,0290**                                | ĐẠT |
| Nhịp partial vi→en        | ≤ P1 × 1,25          | chỉ có số TRƯỚC bản sửa                   | chờ |
| Câu 2,5s có đủ lời nói    | ≥ 1, trên ≥ 70% lượt | chỉ có replay ngoại tuyến                 | chờ |
| Vi phạm DOM               | 0                    | —                                         | chờ |

## Nhịp partial — trước và sau, trên phiên thật

Rút từ log sidecar có timestamp. Bản sửa Phase 8 vào lúc 08:51 UTC, nên hai phiên
đầu là "trước" và phiên cuối là "sau".

| Phiên | Chiều | n   | p50        | p90    | p95         |
| ----- | ----- | --- | ---------- | ------ | ----------- |
| 08:33 | vi→en | 86  | 295 ms     | 529 ms | 604 ms      |
| 08:34 | en→vi | 62  | 345 ms     | 606 ms | **1096 ms** |
| 08:56 | en→vi | 132 | **310 ms** | 508 ms | **586 ms**  |

p95 chiều en→vi giảm gần một nửa. Tiếng Việt vốn đã nằm ở sàn ngay cả trước khi
sửa, đúng như phép đo chi phí giải mã dự đoán — nên chiều vi→en sau bản sửa chỉ
có thể bằng hoặc tốt hơn 295 ms, nhưng **đó là suy luận, không phải số đo**, và
dòng tương ứng ở bảng trên vẫn để là chờ.

## WER — cách kiểm và vì sao nó đủ

`run_benchmark.py --run-tag r9-post-phase8`, 50 clip mỗi engine, cùng bộ chuẩn
hoá đã dùng ở r1/r2.

| Run                  | vi WER     | vi CER     | en WER     |
| -------------------- | ---------- | ---------- | ---------- |
| r1                   | 0,0538     | —          | 0,0386     |
| r2                   | 0,0538     | —          | 0,0386     |
| **r9 (sau Phase 8)** | **0,0538** | **0,0290** | **0,0386** |

Trùng khít. Điều này đúng như mong đợi chứ không phải may: Phase 8 chỉ đổi nhịp
**đọc lại giữa chừng**, còn giải mã cuối lượt đọc toàn bộ buffer qua đúng đường
cũ. Phép đo là để xác nhận điều đó thật, không phải để hy vọng.

## Một cách đếm sai đã bị bắt trong lúc đo

`grep -c "503"` trên log sidecar trả 4 và tôi suýt ghi là bốn lần từ chối. Bốn
dòng đó đều là `200 OK` — chuỗi `503` khớp vào **số cổng** (65030, 65038, 65036).
Đếm đúng phải neo vào vị trí mã trạng thái: `'POST /transcribe HTTP/1.1" 503'`.

Cùng loại lỗi, lần thứ hai: sidecar TTS không ghi log `/synthesize` chút nào, nên
`grep` trả 0 và tôi kết luận TTS chưa từng chạy. Gọi thử trực tiếp: HTTP 200,
130KB audio, 656 ms — và vẫn không có dòng log nào. TTS **đã** chạy suốt phiên
của người dùng, nên dòng "nhịp khi TTS chạy cùng" ở bảng trên là số thật chứ
không phải điều kiện chưa kiểm.

Cả hai lần đều là `grep` trả lời một câu hỏi khác với câu được hỏi.

## Phiên nghiệm thu — 2026-09-16, 17 lượt (16 vi→en)

### Nhịp partial vi→en

|     |            |
| --- | ---------- |
| n   | 203 khoảng |
| p50 | **313 ms** |
| p90 | 443 ms     |
| p95 | **579 ms** |

Phase 1 bàn giao đúng một chỗ mơ hồ ở tiêu chí này và yêu cầu Phase 6 phải chốt
một cách: `refresh_ms_p95 × 1,25` không nói lấy **trung vị theo clip** (316,2ms →
ngưỡng 395ms) hay **p95 toàn corpus** (611,3ms → ngưỡng 764ms).

**Phase 6 chốt: p95 toàn corpus, ngưỡng 764ms.** Lý do là đơn vị, không phải kết
quả — số đo ở đây là p95 của _mọi_ khoảng đọc trong một phiên liên tục, cùng hình
dạng thống kê với p95 toàn corpus của Phase 1. **ĐẠT: 579 < 764.**

Cách đọc kia **không đánh giá được từ phiên này**, và điều đó phải nói ra: người
dùng nói liền mạch nên log chỉ tách được **3 cụm từ 16 lượt**. Trung vị p95 của
ba cụm đó là 413ms, tức **trên** ngưỡng 395ms — nhưng ba cụm không phải mười sáu
lượt, nên con số đó không đo được thứ nó định đo. Muốn đánh giá cách đọc nghiêm
hơn thì cần một phiên có khoảng lặng rõ giữa các lượt.

### Câu ngắn có đủ lời nói

Lọc theo đúng tiêu chí: lượt chốt được dưới `N = 15` ký tự bị loại.

|                            |                                      |
| -------------------------- | ------------------------------------ |
| Tổng lượt                  | 17                                   |
| Bị loại (chốt < 15 ký tự)  | **3** — 18%, dưới ngưỡng một phần ba |
| Còn lại                    | 14                                   |
| Có ≥ 1 bản dịch giữa chừng | **14/14 = 100%**                     |

Ngưỡng là 70%. **ĐẠT.** Các lượt trong khoảng 1,8–2,8 giây đều có ít nhất một
lần cập nhật.

### Neo lại

Tối đa **2** mỗi lượt (hai lượt chạm), tổng 5 trên 17 lượt, tỉ lệ **0,29**.
Ngưỡng là ≤ 2 mỗi lượt và ≤ 0,5 tỉ lệ. **ĐẠT.**

Đây là lần đầu con số này đọc được: `reanchors` mới được ghi vào turn-metrics
trong chính phiên làm việc này.

### Vi phạm DOM — 0, sau khi sửa phép đếm

Probe báo **16 vi phạm** trên phiên 16 lượt vi→en. Cả 16 đều có dạng
`"vài chữ đầu" → ""`. Trùng khít số lượt là dấu hiệu, và nguyên nhân đã được xác
minh bằng test chứ không phải bằng lập luận
(`packages/realtime-client/src/state/turn-keyed-transcript.spec.ts`):

Server phát `partial` rồi `delta` cho **cùng một lần đọc**, thành hai khung
riêng. Khung đầu chưa mang `committedChars`, và view đọc `undefined` là "cả dòng
đã chốt" — đúng như thiết kế dành cho client chưa hỗ trợ sự kiện mới. Khung sau
sửa lại thành `committedChars = 0`, tức chưa chốt gì. Trên DOM đó là một lần đổi
từ vài chữ về rỗng, **đúng một lần mỗi lượt**.

Không có chữ đã chốt nào bị ghi đè, vì ở lần đọc đầu của một lượt thì **chưa có
chữ nào chốt** — hai lần đọc phải đồng ý mới có. **Vi phạm thật: 0.**

Cái giá thật của cặp sự kiện này là **một khung hình sai màu ở đầu mỗi lượt**:
chữ chưa chốt được vẽ bằng màu của chữ đã chốt. Nhỏ, có thật, và giờ có test giữ.

Probe đã được sửa để không đếm nó nữa.

## Tổng kết

| Tiêu chí                   | Kết quả                       |
| -------------------------- | ----------------------------- |
| `quotaCooldowns` = 0       | ĐẠT — 0 trên 17 lượt          |
| 503 sidecar = 0            | ĐẠT — 0                       |
| Nhịp partial en→vi         | ĐẠT — p50 310 ms              |
| **Nhịp partial vi→en**     | **ĐẠT — p95 579 ms < 764 ms** |
| Nhịp khi TTS chạy cùng     | ĐẠT — 3,2 /s                  |
| Chi phí giải mã phẳng      | ĐẠT                           |
| WER / CER cuối lượt (vi)   | ĐẠT — 0,0538 / 0,0290         |
| **Câu 2,5s có đủ lời nói** | **ĐẠT — 14/14**               |
| **Neo lại mỗi lượt**       | **ĐẠT — max 2, tỉ lệ 0,29**   |
| **Vi phạm DOM**            | **ĐẠT — 0**                   |

Mười trên mười.

## Phase 5 — `chunks p50`, số quyết định giữ hay revert

Task 5.5 đặt điều kiện: trung vị = 1 thì phase không mua được gì và phải revert.

Đo thẳng trên `gemini-3.5-flash-lite` với các chuỗi đã chốt ở đúng dải mà chính
sách `N = 15` tạo ra — 27 đến 131 ký tự, lấy từ chính phiên nghiệm thu:

| Vào (ký tự) | Mẩu | Ra (ký tự) |
| ----------- | --- | ---------- |
| 14          | 2   | 15         |
| 30          | 1   | 28         |
| 48          | 1   | 43         |
| 70          | 2   | 69         |
| 102         | 3   | 114        |
| 146         | 3   | 139        |

**`chunks p50` = 2**, phân bố 1, 1, 2, 2, 3, 3. Trên ngưỡng, nên phase được giữ.

Nhưng đọc cho đúng: **một nửa số bản dịch vẫn về trong một mẩu duy nhất**. Suy
luận ở đầu `phase-05` — rằng chính sách mới bắt mỗi request gánh nhiều chữ hơn
nên Gemini chia nhỏ hơn — được số đo xác nhận theo hướng đúng, và biên độ khiêm
tốn. Đây không phải cơ chế làm chữ chảy ra từng từ; cảm giác đó đến từ `N`.

Phép đo dùng prompt rút gọn thay vì toàn bộ chỉ dẫn hệ thống của sản phẩm. Thứ
quyết định số mẩu là **độ dài output**, và output đo được (15–139 ký tự) nằm đúng
dải sản phẩm sinh ra, nên chênh lệch prompt không đổi kết luận.

## Hai chỗ Phase 5 phải xử lý mà kế hoạch không nêu

**Thẻ bao bị rò ra màn hình.** Model đôi khi lặp lại `<transcript>` trong câu trả
lời, và provider vẫn luôn cắt nó khỏi chuỗi _đã gộp_ ở cuối. Chuyển tiếp chunk
thô như kế hoạch viết sẽ đẩy thẻ đó lên màn hình trên đường đi. Nặng hơn: một thẻ
có thể bị cắt ngang hai chunk, nên `</transcr` chưa khớp mẫu cắt nào — mà sự kiện
này chỉ **nối thêm**, không rút lại được. `StreamForwarder` cắt thẻ trên chuỗi đã
gộp và **giữ lại phần từ dấu `<` chưa đóng trở đi**.

**Một lần dịch có thể bị bỏ dở giữa chừng.** Provider đi qua nhiều cặp (khoá,
model); nếu lần thử đầu đã phát vài mẩu rồi hỏng, lần thử sau sẽ nối tiếp vào chữ
của lần hỏng. `onChunk` vì vậy mang thêm cờ `restart`, và server cấp nhãn
`generation` mới khi nhận được nó — client xoá rồi vẽ lại thay vì nối.

**Sự kiện mới khoá sau `streamCommitted`.** Rủi ro R8 mà kế hoạch đã ghi cho
Phase 3 áp y nguyên ở đây: client parse sự kiện theo union chặt, gặp type lạ thì
báo lỗi cho người dùng — một lần cho mỗi mẩu của mỗi bản dịch. Extension và
mobile không gửi cờ đó, nên chúng không nhận sự kiện mới, đúng bất biến "không
đụng extension".

## Câu hỏi chưa giải được

Cách đọc nghiêm của tiêu chí nhịp (trung vị p95 theo lượt, ngưỡng 395ms) chưa
được đánh giá, vì phiên này không tách được thành lượt. Nếu muốn đóng cả cách đọc
đó thì cần một phiên có khoảng lặng rõ giữa các câu.
