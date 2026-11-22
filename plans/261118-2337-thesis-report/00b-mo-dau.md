# MỞ ĐẦU

## 1. Lý do chọn đề tài

Rào cản ngôn ngữ vẫn là một trong những trở ngại lớn khi người Việt Nam làm việc với đối tác nước ngoài, đi du lịch,
hay tham gia các nhóm làm việc đa quốc gia. Các công cụ dịch phổ biến hiện nay phần lớn chỉ phục vụ một tình huống:
ứng dụng dịch trên điện thoại cho hội thoại mặt đối mặt, hoặc tính năng phụ đề dịch gắn với một nền tảng họp trực tuyến
cụ thể và thường thuộc gói trả phí. Các công cụ này đều xử lý hoàn toàn trên đám mây, nên phát sinh chi phí theo lượt
dùng và đưa giọng nói của người dùng ra ngoài.

Mặt khác, trong vài năm gần đây, các mô hình nhận dạng và tổng hợp tiếng nói mã nguồn mở đã đủ nhỏ để chạy trên CPU
thông thường, và các mô hình ngôn ngữ lớn dịch tốt nhiều cặp ngôn ngữ. Câu hỏi đặt ra là: có thể ghép các thành phần
này thành một hệ thống dịch hội thoại đủ nhanh để trò chuyện tự nhiên, chạy trên một máy tính không có GPU, và dùng
chung cho cả hội thoại trực tiếp lẫn họp trực tuyến hay không. Đó là lý do nhóm chọn đề tài "Nghiên cứu và phát triển
hệ thống dịch thoại thời gian thực Chatofy".

## 2. Mục tiêu của đề tài

- Xây dựng hệ thống dịch hội thoại giữa tiếng Việt, tiếng Anh và tiếng Trung, với độ trễ từ lúc người nói dừng đến lúc
  nghe bản dịch dưới 2 giây.
- Chạy nhận dạng và tổng hợp tiếng nói cục bộ trên CPU, không cần khoá API cho phần tiếng nói.
- Hỗ trợ hội thoại hai chiều Việt–Anh trên một thiết bị, tự nhận diện ngôn ngữ và người nói của từng lượt.
- Dùng chung một luồng dịch cho ba tình huống: hội thoại trực tiếp trên web, họp video có dịch, và cuộc gọi trên Google
  Meet, Zoom, Facebook qua tiện ích Chrome.
- Đánh giá từng lựa chọn kỹ thuật bằng thực nghiệm có thể tái lập.

## 3. Đối tượng và phạm vi nghiên cứu

**Đối tượng nghiên cứu:** các kỹ thuật nhận dạng tiếng nói, tổng hợp tiếng nói, nhận diện ngôn ngữ và người nói, dịch máy
bằng mô hình ngôn ngữ lớn, truyền thông thời gian thực qua WebSocket và WebRTC.

**Phạm vi:**

- Trọng tâm là luồng dịch hội thoại trên web và họp video có dịch.
- Các chức năng hỗ trợ (tài khoản, lịch sử, bảng thuật ngữ, nhóm, credit, tiện ích Chrome) được trình bày ở mức thiết kế
  và giao diện.
- Ứng dụng di động mới chạy ở bản phát triển nên chỉ được nhắc tới ở hướng phát triển.
- Đồ án không huấn luyện mô hình mới. Các mô hình nhận dạng, tổng hợp tiếng nói và dịch máy là mô hình tiền huấn luyện
  hoặc dịch vụ có sẵn; đóng góp của đồ án nằm ở kỹ thuật hệ thống và phương pháp đánh giá.

## 4. Phương pháp nghiên cứu

Nhóm áp dụng quy trình "khảo sát → đo đạc → quyết định": khảo sát các mô hình và giải pháp ứng viên; xây dựng bộ đo có thể
tái lập và đo trên chính phần cứng sẽ chạy; quyết định dựa trên ngưỡng đặt trước; và đo lại sau mỗi thay đổi. Kết quả được
kiểm chứng bằng nhiều phương pháp độc lập (phát lại offline, công cụ điều khiển phiên, trình duyệt thật, phát lại trên
production). Kho mã có khoảng 25 bộ đo trong thư mục `benchmarks/`, mỗi bộ trả lời một câu hỏi cụ thể.

## 5. Đóng góp chính của đồ án

1. Một luồng dịch dạng tầng chạy phần tiếng nói trên CPU, đạt độ trễ 907 ms (p50) và 1.582 ms (p95) trong điều kiện phòng
   thí nghiệm, nhờ kết hợp chồng thời gian phát hiện kết thúc câu, tách mệnh đề, gọi API dạng luồng và dịch suy đoán.
2. Cơ chế nhận diện ngôn ngữ theo từng lượt cho hội thoại hai chiều Việt–Anh, được chọn qua một bộ đo so sánh năm phương án
   và đưa vào production.
3. Họp video dịch theo từng người nghe trên SFU, dùng chung luồng dịch với hội thoại trực tiếp.
4. Lớp hiển thị tiếng Việt bằng chuẩn hoá văn bản ngược tất định, đưa tỷ lệ chữ số đúng từ 0 lên 100% với chi phí dưới
   1 ms mỗi lượt.
5. Phương pháp đánh giá chất lượng dịch bằng mô hình ngôn ngữ lớn đã hiệu chuẩn, chỉ ra và khắc phục nguồn lỗi chính:
   bổ sung ngữ cảnh hội thoại giảm lỗi dịch nghiêm trọng chiều Việt → Anh từ 23,7% xuống 1,3%.

<!-- TODO nhóm: chèn bảng phân công công việc giữa hai thành viên tại đây (nhóm tự điền). -->

## 6. Bố cục của báo cáo

Ngoài phần Mở đầu, Kết luận và Tài liệu tham khảo, báo cáo gồm bốn chương:

- **Chương 1. Tổng quan và cơ sở lý thuyết:** bài toán dịch thoại thời gian thực, khảo sát sản phẩm hiện có, cơ sở lý
  thuyết về xử lý tiếng nói, dịch máy và truyền thông thời gian thực, các công nghệ sử dụng.
- **Chương 2. Phân tích và thiết kế hệ thống:** yêu cầu, biểu đồ use case, kịch bản, kiến trúc, biểu đồ tuần tự, cơ sở
  dữ liệu, giao diện lập trình và bảo mật.
- **Chương 3. Kỹ thuật dịch thoại thời gian thực và thực nghiệm:** lựa chọn mô hình, các kỹ thuật giảm độ trễ, nhận diện
  ngôn ngữ và người nói, đánh giá chất lượng dịch, dịch trong họp video.
- **Chương 4. Cài đặt, giao diện và kiểm thử:** môi trường triển khai, quy trình CI/CD, giao diện, kết quả kiểm thử và
  đối chiếu tiêu chí thành công.
