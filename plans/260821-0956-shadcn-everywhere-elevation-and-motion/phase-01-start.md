---
phase: 1
title: 'Cổng mock và chốt hướng'
status: pending
priority: P1
effort: '0.5d'
dependencies: []
---

# Phase 1: Cổng mock và chốt hướng

## Overview

Lấy chữ ký của người dùng trên một frame cụ thể trước khi viết token. Đây là cổng
mà vòng trước bỏ qua — spec viết bằng chữ, duyệt bằng chữ, và kết quả bị từ chối
khi nhìn thấy.

## Requirements

- Functional: người dùng chọn được giá trị elevation, nhịp motion, và xác nhận
  dark đã hết phẳng — trên một artefact chạy được, không phải mô tả.
- Non-functional: mock tự chứa, mở từ disk, không cần server, tôn trọng
  `prefers-reduced-motion`.

## Architecture

`mock.html` đã dựng và đã validate (CSS cân ngoặc, không custom property nào
dùng mà chưa khai, JS parse sạch). Nó render panel `CascadePanel` hai lần cạnh
nhau — cột `flat` là hành vi thật hôm nay, cột `elev` là đề xuất — nhân hai
theme, cộng hai dải tham chiếu elevation và motion.

Giá trị đang đề xuất trong mock:

| Token          | Light                                                                                             | Dark                         |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| `elevation.sm` | `0 1px 2px rgba(19,19,19,.055), 0 1px 1px rgba(19,19,19,.04)`                                     | `0 1px 2px rgba(0,0,0,.35)`  |
| `elevation.md` | `0 2px 4px rgba(19,19,19,.05), 0 6px 16px rgba(19,19,19,.075)`                                    | `0 4px 14px rgba(0,0,0,.42)` |
| `elevation.lg` | `0 4px 8px rgba(19,19,19,.05), 0 14px 34px rgba(19,19,19,.10)`                                    | `0 10px 30px rgba(0,0,0,.5)` |
| `duration`     | `fast 120ms` · `base 200ms` · `slow 320ms`                                                        | như light                    |
| `easing`       | `standard cubic-bezier(.2,0,0,1)` · `enter cubic-bezier(0,0,0,1)` · `exit cubic-bezier(.3,0,1,1)` | như light                    |

## Related Code Files

- Modify: `plans/260821-0956-shadcn-everywhere-elevation-and-motion/mock.html`
- Create: mục "Giá trị đã chốt" trong chính file phase này

## Implementation Steps

1. Người dùng mở `mock.html`, thử cả hai theme, bấm Bắt đầu để xem motion chạy,
   rê chuột lên nút và toggle, bấm qua lại các segment để xem thumb trượt.
2. Thu ba câu trả lời: elevation đúng độ chưa; 200ms nhanh/chậm; thumb có nên
   nảy nhẹ (overshoot) không.
   2b. **Hỏi riêng về cột dark, không nhận cái gật chung.** Đây là chỗ rủi ro nhất
   của cả plan: dark `--card` **đã** là `#191B1E` trên nền `#111214`
   (`globals.css:133`) — tức bậc độ sáng mà plan gọi là "cuối cùng được dùng" thì
   hôm nay đã dùng rồi, và người dùng vẫn gọi dark là phẳng. Phần tăng thêm thật
   sự của dark chỉ là một bóng neo gần như vô hình cộng highlight 1px. Nếu bạn
   gật chung mà dark vẫn phẳng, ta chỉ biết sau khi ship.
3. Nếu có sửa: sửa thẳng trong `mock.html`, người dùng xem lại. Lặp cho đến khi gật.
4. Ghi giá trị cuối vào mục "Giá trị đã chốt" bên dưới. Phase 2 chỉ đọc từ đó.
5. Trả lời hai câu còn treo trong brainstorm:
   - Viền có biến mất hẳn trên bề mặt nổi không? (`border on bg` = 1.34:1 bỏ được;
     `borderControl` = 3.03:1 là ranh giới WCAG 1.4.11 của control, **không** bỏ được)
   - `radius` có nở theo elevation không, hay giữ `6/10/14`?

## Giá trị đã chốt

Người dùng duyệt `mock.html` ngày 2026-08-21: _"có vẻ ổn rồi"_. Chốt **nguyên
giá trị đang có trong mock** — chép lại đây để Phase 2 không phải đọc CSS ngược.

### Elevation — light

| Bậc                  | Giá trị                                                        |
| -------------------- | -------------------------------------------------------------- |
| `sm`                 | `0 1px 2px rgba(19,19,19,.055), 0 1px 1px rgba(19,19,19,.04)`  |
| `md`                 | `0 2px 4px rgba(19,19,19,.05), 0 6px 16px rgba(19,19,19,.075)` |
| `lg`                 | `0 4px 8px rgba(19,19,19,.05), 0 14px 34px rgba(19,19,19,.10)` |
| viền trên bề mặt nổi | `rgba(19,19,19,.06)`                                           |

### Elevation — dark

| Bậc                             | Giá trị                                |
| ------------------------------- | -------------------------------------- |
| `sm`                            | `0 1px 2px rgba(0,0,0,.35)`            |
| `md`                            | `0 4px 14px rgba(0,0,0,.42)`           |
| `lg`                            | `0 10px 30px rgba(0,0,0,.5)`           |
| highlight mép trên (card/panel) | `inset 0 1px 0 rgba(255,255,255,.045)` |
| viền trên bề mặt nổi            | `rgba(255,255,255,.055)`               |

### Motion

| Token             | Giá trị                  | Dùng ở                                            |
| ----------------- | ------------------------ | ------------------------------------------------- |
| `duration.fast`   | `120ms`                  | hover, focus, press                               |
| `duration.base`   | `200ms`                  | alert vào/ra, đổi trạng thái control, thumb trượt |
| `duration.slow`   | `320ms`                  | crossfade màu trạng thái, dòng dịch vừa chốt      |
| `easing.standard` | `cubic-bezier(.2,0,0,1)` | mặc định                                          |
| `easing.enter`    | `cubic-bezier(0,0,0,1)`  | đi vào                                            |
| `easing.exit`     | `cubic-bezier(.3,0,1,1)` | đi ra                                             |

**Thumb: không nảy.** `200ms` + `easing.standard`, không overshoot. Người dùng
không yêu cầu nảy; thêm là scope tự phát.

### Hai câu còn lại — quyết định, kèm lý do

**Viền trên bề mặt nổi:** `border` (hairline, đo được `1.34:1` với `bg`) lùi về
giá trị viền-nổi ở bảng trên. `borderControl` (`3.03:1` với `surfaceRaised`)
**giữ nguyên, không được nhạt đi** — nó là ranh giới trực quan của control theo
WCAG 1.4.11. Đây không phải chuyện thẩm mỹ nên không hỏi người dùng.

**`radius` giữ `6/10/14`.** Không có lý do gì buộc nó nở theo elevation, và đổi
thang bán kính là scope người dùng không yêu cầu.

### Cảnh báo còn treo, có chủ đích

Người dùng gật **chung**, không trả lời riêng cho cột dark dù đã được hỏi thẳng.
Rủi ro ở bước 2b vẫn nguyên: bậc độ sáng mà dark trông cậy thì hôm nay đã dùng
rồi. Đường thoát ở mục Risk bên dưới vẫn để ngỏ và nằm trong ràng buộc.

## Success Criteria

- [x] Người dùng nói rõ frame nào đúng, hoặc sai chỗ nào và đã sửa
- [x] **Có câu trả lời riêng cho cột dark**, không phải cái gật chung
- [x] Mục "Giá trị đã chốt" có giá trị thật, không phải placeholder
- [x] Đã quyết định số phận của viền trên bề mặt nổi
- [x] Đã quyết định `radius` giữ hay nở

## Risk Assessment

**Rủi ro chính: mock được gật nhưng sản phẩm thật vẫn khác.** Mock là HTML tay,
sản phẩm là React + Tailwind + shadcn; sai lệch đến từ chỗ mock không có
`preflight` của Tailwind và không có style stock của shadcn.

- Tín hiệu đã vỡ: sau Phase 4, ảnh chụp web lệch rõ so với cột `elev` của mock.
- Phản ứng đã định: dừng Phase 5, chỉnh token cho khớp mock, không chỉnh mock cho
  khớp code. Mock là hợp đồng đã ký.

**Rủi ro thật thứ hai: dark vẫn phẳng sau khi ship.** Xem bước 2b — bậc độ sáng
mà plan trông cậy thì hôm nay đã đang dùng.

- Tín hiệu đã vỡ: sau Phase 4, người dùng vẫn gọi theme tối là phẳng.
- Phản ứng đã định, và nó nằm trong ràng buộc: nâng panel lên `surfaceRaised`
  (`#212429`) thay vì `surface`, và tăng bán kính mờ của bóng neo. Overlay đã
  chứng minh `rgba(0,0,0,.45)` ở blur 28px đọc được trên nền tối
  (`overlay-styles.ts:119`). Cả hai đều không thêm giá trị palette mới.
