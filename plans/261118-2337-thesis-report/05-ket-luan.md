# KẾT LUẬN

## 1. Kết quả đạt được

Đồ án đã xây dựng hệ thống Chatofy, cho phép những người không cùng ngôn ngữ trò chuyện với nhau bằng tiếng Việt, tiếng
Anh và tiếng Trung. Hệ thống đang chạy trên production và phục vụ ba tình huống: hội thoại trực tiếp trên web, họp video
có dịch, và cuộc gọi trên Google Meet, Zoom, Facebook qua tiện ích Chrome.

Đối chiếu với các mục tiêu đặt ra ở phần Mở đầu:

- **Độ trễ dưới 2 giây:** đạt trong điều kiện phòng thí nghiệm (907 ms p50, 1.582 ms p95). Trên production với giọng nói
  thật, độ trễ trung vị là 1,54 s khi bản dịch suy đoán được dùng lại và 2,16 s khi không.
- **Tiếng nói chạy cục bộ trên CPU:** đạt. Nhận dạng tiếng Việt cục bộ nhanh hơn dịch vụ đám mây 13,3 lần với cùng độ chính
  xác từ; tổng hợp tiếng Việt dạng luồng phát âm thanh đầu tiên sau khoảng 0,2 s.
- **Hội thoại hai chiều Việt–Anh:** đạt. Lượt nói từ 1,5 giây trở lên được nhận đúng ngôn ngữ trong toàn bộ 85 lượt phát lại;
  nhãn ngôn ngữ hiện ra trong 3,3 s (p95) trên production.
- **Dùng chung luồng dịch cho ba tình huống:** đạt; họp video và tiện ích Chrome dùng lại cùng luồng xử lý và cùng package
  client với trang dịch.
- **Đánh giá bằng thực nghiệm tái lập được:** đạt, với khoảng 25 bộ đo và 7.159 test tự động.

Về chất lượng dịch, 77,8% lượt trong 162 lượt hội thoại thật không có lỗi nghiêm trọng, vượt mức 70% đặt ra; sau khi bổ
sung ngữ cảnh cho bước hậu biên tập, lỗi nghiêm trọng chiều Việt → Anh giảm từ 23,7% xuống 1,3% trên cùng tập lượt.

Qua quá trình thực hiện, nhóm rút ra rằng trong một hệ thống thời gian thực, quyết định đúng thường đến từ việc đo đúng
chỗ hơn là từ việc chọn mô hình mạnh hơn: cảm giác "giật" hoá ra là vấn đề phản hồi giao diện; thứ hạng mô hình đảo ngược
khi chuyển từ tập kiểm tra sạch sang âm thanh thật; và một cơ chế tăng tốc đã qua mọi kiểm thử nhưng chưa bao giờ có hiệu lực.

## 2. Hạn chế

- **Dịch máy vẫn phụ thuộc đám mây**, nên hệ thống chưa chạy được hoàn toàn ngoại tuyến và độ trễ chịu ảnh hưởng của nhà
  cung cấp (khoảng 500 ms tới token đầu tiên).
- **Giấy phép mô hình nhận dạng tiếng Việt** (CC-BY-NC-ND-4.0) chỉ cho phép dùng phi thương mại; hệ thống chưa thể bán công
  khai nếu chưa thay mô hình.
- **Chưa tự nhận diện được tiếng Trung**: các cặp có tiếng Trung chỉ chạy một chiều.
- **Chất lượng dịch trong họp video** còn kém trang dịch trực tiếp 2,5–4,2 điểm phần trăm lỗi nghiêm trọng; khi nhiều người
  nói liên tục, nhánh dịch của cuộc họp bị bỏ bớt lượt.
- **Chưa kiểm chứng đầy đủ** cuộc họp giữa hai mạng thực khác nhau (Wi-Fi và 4G), tiếng vọng trên loa ngoài của máy tính, và
  thử nghiệm với người dùng thật.
- **Ứng dụng di động** mới chạy ở bản phát triển, chưa phát hành.

## 3. Hướng phát triển

- Chạy dịch máy cục bộ hoặc dùng mô hình dịch nhỏ cho các cặp phổ biến, tiến tới chế độ ngoại tuyến hoàn toàn.
- Thay mô hình nhận dạng tiếng Việt bằng mô hình có giấy phép thương mại và đo lại chất lượng trên âm thanh thật.
- Nhận diện tự động tiếng Trung khi có mô hình chạy CPU đạt ngưỡng chính xác, hoặc khi có GPU.
- Rút ngắn mệnh đề đầu tiên đưa vào tổng hợp tiếng nói tiếng Anh, hướng tới độ trễ âm thanh khoảng 0,5 s cho khâu này.
- Hoàn thiện và phát hành ứng dụng di động; tổ chức thử nghiệm với người dùng thật.
- Mở rộng thêm ngôn ngữ thông qua registry ngôn ngữ, và đưa hệ thống credit sang bán công khai sau khi hoàn tất danh sách
  kiểm tra trước khi ra mắt.
