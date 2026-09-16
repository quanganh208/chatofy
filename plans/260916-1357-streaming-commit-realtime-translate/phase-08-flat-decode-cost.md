---
phase: 8
title: 'Chi phí giải mã phẳng — bỏ phép nhân của cổng duty'
status: done
priority: P1
effort: '4h'
dependencies: [2]
revision: 2 (viết lại sau khi cổng đo task 8.1 bác phương án cửa sổ trượt)
---

# Phase 8: Nhịp chữ không phụ thuộc độ dài câu

## Goal

Nhịp chữ hiện lên **không phụ thuộc độ dài câu**. Câu thứ tám dài bảy giây phải
chảy bằng câu đầu dài hai giây.

## Bản 1 của phase này đã bị chính cổng đo của nó bác

Bản 1 chọn **cửa sổ trượt cố định + khâu theo chồng lấp chữ**. Task 8.1 chạy và
trả `PHÁN QUYẾT: DỪNG` — trượt cả hai điều kiện đi tiếp. Số đầy đủ:
`reports/overlap-measurement.md`. Tóm tắt:

- **Thu nhỏ cửa sổ không cứu được tiếng Anh.** Moonshine có sàn chi phí cố định;
  từ cửa sổ 5,0s xuống 2,0s chỉ rẻ đi 30% và p95 vẫn 171ms, vẫn vượt ngân sách
  150ms. Đây là tính chất của model, không phải của tham số.
- **Khâu không đủ tin cậy.** Không ô nào trong 24 ô của lưới đạt cả hai ngưỡng.
  Cửa sổ sau mở giữa chừng một từ, và bộ nhận dạng không trả về từ cụt — nó trả
  về **từ khác** (`gõ cửa phòng ba lan` / `Ở phòng ba lan`).

Cùng phép đo đó chỉ ra nguyên nhân thật, và nó nhỏ hơn nhiều.

## Nguyên nhân: phép nhân, không phải chi phí giải mã

Chi phí giải mã p50 trên lời nói dày, máy rảnh:

| Buffer | vi     | en     | `divisor 2` | nhịp    | `divisor 1` | nhịp    |
| ------ | ------ | ------ | ----------- | ------- | ----------- | ------- |
| 1s     | 55 ms  | 102 ms | 300 ms      | 3,33 /s | 300 ms      | 3,33 /s |
| 3s     | 86 ms  | 147 ms | 300 ms      | 3,33 /s | 300 ms      | 3,33 /s |
| 5s     | 107 ms | 210 ms | 420 ms      | 2,38 /s | 300 ms      | 3,33 /s |
| 7s     | 116 ms | 241 ms | 481 ms      | 2,08 /s | 300 ms      | 3,33 /s |
| 9s     | 152 ms | 289 ms | 579 ms      | 1,73 /s | 300 ms      | 3,33 /s |

Tiếng Anh đạt đỉnh **289 ms** ở buffer 9 giây — lượt dài nhất client gửi — vẫn
**dưới** sàn 300 ms. Nên ở divisor 1 thì sàn quyết định nhịp suốt cả lượt, và
nhịp phẳng tuyệt đối.

## Thay đổi

`PARTIAL_DUTY_DIVISOR` 2 → **1** trong `partial-transcript-scheduler.ts`.

Một hằng số. Không stitcher, không đổi model, không đổi giao thức, không đụng
cửa sổ 9 giây và bất biến của nó.

## Điều phải nói thẳng, không được gói lại

Ở divisor 1 **trần duty biến mất**, chứ không phải "vẫn còn nhưng nhẹ hơn".
Khoảng cách được tính từ lúc lần đọc trước **bắt đầu**, nên khi một lần giải mã
kết thúc thì `d × 1` đã được trả xong — chỉ còn sàn làm việc. Phép nhân trong
`shouldStart` **không còn là một trần** ở mức này.

Hệ quả: khi giải mã đắt hơn sàn, đường preview chạy liền mạch và giữ trọn một
lane. Đó đúng là vòng lặp mà trần được viết ra để chặn. Nó được **chấp nhận**,
không phải được lý luận cho biến mất — vì cùng bảng số cho thấy trường hợp
thường không bao giờ chạm tới (đỉnh 289 ms so với sàn 300 ms), và vì cái giá của
trần chính là triệu chứng phase này sinh ra để xoá.

Hằng số được giữ lại ở giá trị vô hiệu của nó, vì nâng lên là cách sửa một dòng
nếu nghiệm thu cho thấy trần thật sự cần.

## Đo lại — đã chạy

**Áp lực lane, 90 giây, nặng hơn thực tế:** hai người nói cùng lúc đều giải mã
hết công suất ở nhịp mới, cộng giải mã cuối lượt mỗi 3 giây, cộng TTS tổng hợp
liên tục.

|           |                         |
| --------- | ----------------------- |
| Request   | 388                     |
| **503**   | **0**                   |
| Lỗi khác  | 0                       |
| Preview   | p50 415 ms, p95 1040 ms |
| Cuối lượt | p50 547 ms, p95 911 ms  |

Trần lane giữ được. Ở tải đó nhịp là ~2,4/giây (divisor 2 sẽ là 1,2/giây), và
thực tế nhẹ hơn vì hệ thống theo lượt — mỗi lúc chỉ một người nói.

**Test:** api 947/947 xanh (thêm 1 ca mới). `pnpm typecheck` 16/16 sạch.
`pnpm lint` 0 lỗi; 1 warning có sẵn trong `narrow-body-limits.spec.ts`, file
không đụng tới.

## Còn lại — không thuộc phase này

Tranh chấp CPU với TTS. Ở buffer 9 giây khi TTS tổng hợp liên tục, tiếng Anh lên
660 ms, vượt sàn, nên divisor 1 cũng không cứu. Nguyên nhân là 8 luồng STT × 4
lane cộng 8 luồng TTS trên 8 core vật lý. Chưa đo xem giảm số luồng có bớt không.

## Rollback

Một hằng số. Trả về 2 là xong.
