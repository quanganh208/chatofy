---
report: speak-early-gate
phase: 7
date: 2026-09-16
verdict: 'PHÁN QUYẾT: DỪNG — cơ chế không kích hoạt được ở chiều chính'
---

# Cổng đo Phase 7 — nói theo mệnh đề đã chốt

Người dùng yêu cầu mở lại Phase 7 sau khi nghiệm thu Phase 6. Ba trong bốn điều
kiện tiên quyết đã đạt, điều kiện thứ tư là chính yêu cầu đó. Trước khi thi công,
hai câu hỏi được đo. Cả hai trả lời âm tính.

## (a) Bản dịch giữa câu có dùng lại được để nói sớm không? — KHÔNG

Ý tưởng: bản dịch giữa câu **đã được trả tiền** ở Phase 4. Nếu hai bản dịch liên
tiếp giữ nguyên các mệnh đề đầu thì nói sớm không tốn thêm request nào, và toàn
bộ chi phí mà `phase-07` cảnh báo — mất tái dùng speculation, thêm request — biến
mất.

Đo trên `gemini-3.5-flash-lite`, 3 lượt, 8 cặp bản dịch liên tiếp của các tiền tố
đã chốt:

|                                        |         |
| -------------------------------------- | ------- |
| Cặp giữ nguyên **toàn bộ** mệnh đề đầu | **1/8** |
| Tổng mệnh đề nói sớm được an toàn      | **0**   |

Nguyên nhân nhìn thấy được trong chính chữ: model **viết lại câu từ đầu** mỗi khi
có thêm ngữ cảnh.

```
I am looking for a restaurant that serves vegetarian food
I'm looking for a restaurant that serves vegetarian food near the city center.
I am looking for a vegetarian restaurant near the city center that is open late.
```

Và nó không chỉ đổi cách diễn đạt. `hôm qua tôi có đặt` được dịch thành
**"Yesterday I placed an order"** — sai nghĩa, vì từ `phòng` chưa tới. Nói câu đó
ra loa rồi mới sửa là đúng thứ `live-preview.ts` viết ra để cấm: _"một phỏng đoán
có thể bị thay lặng lẽ trên màn hình, còn một phỏng đoán đã nói ra thì không rút
lại được."_

Kết luận: lối rẻ không tồn tại. Phân tích gốc của `phase-07` đúng — nói sớm bắt
buộc phải dịch **từng mệnh đề một, có ngữ cảnh**, mỗi mệnh đề một request.

## (b) Chiều vi→en có mệnh đề nào để đóng không? — KHÔNG

Đây là phát hiện quyết định, và `phase-07` không nêu.

Phase 7 kích hoạt khi một mệnh đề **đóng** trong chuỗi nguồn đã chốt.
`clause-splitter` tách trên `[,;:.!?…]`. Bộ nhận dạng tiếng Việt **không phát dấu
câu nào** — `zipformer_vi.py` ghi rõ output dạng `XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP`,
và `live-translation-trigger.ts` đã ghi lại đúng hệ quả này cho luật mệnh đề.

Kiểm trên chuỗi thật từ phiên nghiệm thu:

| Nguồn                                                                                          | Số mệnh đề |
| ---------------------------------------------------------------------------------------------- | ---------- |
| `Ngọn lửa bạo động ở trung đông và phá vỡ lộ trình hòa bình`                                   | 1          |
| `Bọn buôn dự án chạy chọt bày ra cái dự án để kiếm chác`                                       | 1          |
| `Chị hai chủ quán nghe bàn tán rôm rả cũng ra góp chuyện`                                      | 1          |
| `It has no beauty whatsoever, no specialty of picturesqueness, and all its lines are cramped.` | 3          |

**Chiều vi→en không bao giờ có mệnh đề đóng giữa lượt.** Cơ chế của Phase 7 không
kích hoạt được lần nào ở chiều chính của sản phẩm.

## Phán quyết

Thi công Phase 7 như thiết kế sẽ:

- **không làm gì** ở chiều vi→en,
- chạy đôi khi ở chiều en→vi,
- tốn một request dịch cho **mỗi mệnh đề**,
- và làm mất tái dùng speculation ở **3/4 số lượt**.

Đây là phase duy nhất trong kế hoạch **làm tăng** số request, và phép đo cho thấy
nó tăng để đổi lấy một tính năng không chạy ở chiều chính.

## Nếu vẫn muốn có tiếng sớm

| Hướng                                       | Cái giá                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Chỉ làm chiều en→vi                         | Thành thật, nhưng chỉ phục vụ một nửa hội thoại                   |
| Thêm model khôi phục dấu câu cho tiếng Việt | Một model nữa trên CPU; `zipformer_vi.py` đã ghi là ngoài phạm vi |
| Cắt theo số ký tự thay vì theo dấu câu      | Biên cắt rơi giữa cụm từ; trật tự từ tiếng Việt cần cả cụm        |
| Bỏ Phase 7                                  | Giữ nguyên tái dùng speculation và trần RPD                       |

## Câu hỏi chưa giải được

Phép đo (a) chạy trên prompt rút gọn thay vì toàn bộ chỉ dẫn hệ thống của sản
phẩm. Chỉ dẫn thật yêu cầu bám sát bản gốc hơn, nên tỉ lệ giữ mệnh đề có thể cao
hơn 1/8 — nhưng không cứu được (b), và (b) một mình đã đủ để dừng.
