// Fictional Vietnamese meetings with three or four speakers, committed on purpose.
//
// Every real conversation in `homophone-repair/data/conversations.json` has two
// people, so that corpus cannot say whether the minutes keep owners and
// who-said-what straight in a room of several. These can, and because nobody in
// them is real they are the only transcripts this benchmark may commit. Each one
// states its decisions and action items plainly, so a judge can tell an invented
// owner or date from one that was said.
//
// The lines are written clean, with names: the reference IS the transcript.

export const SYNTHETIC = [
  {
    id: 'syn-sprint-4p',
    speakers: ['Lan', 'Minh', 'Hải', 'Thảo'],
    language: 'vi',
    turns: [
      'Lan: Chào mọi người, hôm nay mình chốt kế hoạch phát hành bản 2.4 nhé.',
      'Minh: Bên backend còn hai lỗi đăng nhập chưa sửa xong.',
      'Hải: Lỗi thứ nhất là token hết hạn không được làm mới, lỗi thứ hai là đăng nhập Google bị treo trên Safari.',
      'Thảo: Phía thiết kế đã xong màn hình hồ sơ mới, chỉ chờ ghép vào.',
      'Lan: Vậy mình có kịp phát hành vào thứ Năm tuần sau không?',
      'Minh: Nếu Hải lo lỗi Safari thì em sửa lỗi token trước thứ Sáu tuần này được.',
      'Hải: Được, em nhận lỗi Safari, cuối sprint này em xong.',
      'Thảo: Em đề nghị bỏ tính năng xuất PDF ra khỏi bản này, vì chưa kiểm thử kỹ.',
      'Minh: Anh đồng ý, xuất PDF để sang bản 2.5.',
      'Lan: Ừ, chốt là bản 2.4 không có xuất PDF.',
      'Hải: Còn màn hình hồ sơ thì ai ghép?',
      'Thảo: Em ghép luôn, nhưng cần Minh mở API cập nhật ảnh đại diện.',
      'Minh: API đó có rồi, chiều nay anh gửi tài liệu cho Thảo.',
      'Lan: Thế còn kiểm thử hồi quy?',
      'Hải: Em đề xuất chạy kiểm thử hồi quy vào thứ Hai tuần sau, cả nhóm cùng làm.',
      'Lan: Được, chốt ngày phát hành là thứ Năm tuần sau, kiểm thử hồi quy thứ Hai.',
      'Thảo: Em sẽ viết ghi chú phát hành, nhưng chưa biết khi nào xong.',
      'Minh: Ghi chú thì không gấp, miễn có trước ngày phát hành.',
      'Lan: Có ai còn vướng gì không?',
      'Hải: Em cần quyền truy cập máy chủ staging.',
      'Lan: Để chị cấp quyền cho Hải ngay sau cuộc họp.',
      'Minh: Vậy thôi, mình kết thúc nhé.',
    ],
  },
  {
    id: 'syn-budget-3p',
    speakers: ['Quân', 'Ngọc', 'Tuấn'],
    language: 'vi',
    turns: [
      'Quân: Hôm nay mình bàn ngân sách quý tư cho phòng marketing.',
      'Ngọc: Quý trước mình chi vượt khoảng mười phần trăm, chủ yếu do quảng cáo mạng xã hội.',
      'Tuấn: Tôi nghĩ nên cắt quảng cáo hiển thị, hiệu quả rất thấp.',
      'Quân: Số liệu có cho thấy vậy không?',
      'Ngọc: Có, tỷ lệ chuyển đổi của quảng cáo hiển thị chỉ bằng một nửa mạng xã hội.',
      'Quân: Vậy chốt là quý tư dừng quảng cáo hiển thị.',
      'Tuấn: Còn khoản tổ chức sự kiện cuối năm thì sao?',
      'Ngọc: Tôi đề xuất tăng thêm năm mươi triệu cho sự kiện.',
      'Quân: Khoản đó lớn, để tuần sau quyết, khi có báo giá địa điểm.',
      'Tuấn: Tôi có thể hỏi thêm vài địa điểm nữa.',
      'Ngọc: Cũng cần ai đó tổng hợp lại chi phí quảng cáo từng tháng thành một bảng.',
      'Quân: Đúng, việc đó cần làm, nhưng giờ chưa ai rảnh.',
      'Tuấn: Để xem lại lịch rồi tính.',
      'Ngọc: Thôi mình dừng ở đây, tuần sau họp tiếp phần sự kiện.',
      'Quân: Ừ, cảm ơn mọi người.',
    ],
  },
  {
    id: 'syn-handoff-3p',
    speakers: ['Vy', 'Long', 'Phương'],
    language: 'vi',
    turns: [
      'Vy: Sáng nay khách báo đơn hàng không gửi được email xác nhận.',
      'Long: Tôi xem log rồi, dịch vụ email trả lỗi vì hết hạn mức gửi trong ngày.',
      'Phương: Hạn mức hiện tại là bao nhiêu?',
      'Long: Năm nghìn email một ngày, mà hôm qua có chương trình khuyến mãi nên vượt.',
      'Vy: Có cách nào xử lý ngay không?',
      'Long: Tôi đề xuất nâng gói dịch vụ email lên mức hai mươi nghìn, và xếp hàng các email bị lỗi để gửi lại.',
      'Phương: Nâng gói thì tôi duyệt được, chi phí không đáng kể.',
      'Vy: Vậy ai lo phần gửi lại các email bị lỗi?',
      'Phương: Tôi nhận phần đó, chiều nay tôi viết script gửi lại.',
      'Long: Tôi sẽ thêm cảnh báo khi dùng quá tám mươi phần trăm hạn mức.',
      'Vy: Tốt, tôi sẽ báo khách là email sẽ đến trong hôm nay.',
      'Phương: Chốt vậy nhé, nâng gói ngay và gửi lại trong chiều nay.',
      'Long: Ừ, tôi nâng gói luôn sau cuộc họp.',
    ],
  },
];
