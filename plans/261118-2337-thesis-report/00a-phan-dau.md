<!--
Ghi chú biên soạn (xoá khi chuyển sang Word):
- Trang bìa theo mẫu "BC - ĐATN - FINGENIUS" trong E:\PTIT\DATN\Mẫu (khung hoa văn, logo PTIT). Bản Word lấy trang
  bìa từ cong-cu/trang-bia.docx (tạo bằng cong-cu/tao-trang-bia.ps1); phần dưới đây chỉ để đọc trong Markdown.
- Mục lục, danh mục hình, danh mục bảng: tạo tự động trong Word (References → Table of Contents / Insert Table
  of Figures) sau khi đặt style Heading và Caption.
- Lời cảm ơn là bản nháp; nhóm nên sửa cho đúng giọng của mình.
-->

**BỘ KHOA HỌC VÀ CÔNG NGHỆ**

**HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG**

**KHOA CÔNG NGHỆ THÔNG TIN 1**

[LOGO PTIT]

**ĐỒ ÁN TỐT NGHIỆP**

**ĐỀ TÀI**

**NGHIÊN CỨU VÀ PHÁT TRIỂN HỆ THỐNG DỊCH THOẠI THỜI GIAN THỰC CHATOFY**

|                           |                                                  |
| ------------------------- | ------------------------------------------------ |
| Giảng viên hướng dẫn      | : PGS. TS. Nguyễn Trọng Khánh                    |
| Thông tin thành viên nhóm | : 1. Nguyễn Việt Tú - B22DCCN748 - D22CNPM02     |
|                           | 2. Nguyễn Mạc Quang Anh - B22DCCN029 - D22CNPM02 |
| Khoá                      | : 2022 - 2027                                    |
| Hệ                        | : Đại học chính quy                              |

**Hà Nội - 2026**

---

# LỜI CẢM ƠN

Trước hết, chúng em xin bày tỏ lòng biết ơn sâu sắc tới thầy PGS. TS. Nguyễn Trọng Khánh, giảng viên hướng dẫn, đã
tận tình định hướng, góp ý và tạo điều kiện để chúng em hoàn thành đồ án này. Những nhận xét của thầy giúp chúng em
nhìn ra điểm yếu trong cách tiếp cận và giữ được sự nghiêm túc trong từng phép đo.

Chúng em xin gửi lời cảm ơn tới Ban Giám đốc Học viện Công nghệ Bưu chính Viễn thông và các thầy cô trong Khoa Công
nghệ Thông tin I đã truyền đạt cho chúng em nền tảng kiến thức trong suốt những năm học tập tại Học viện.

Chúng em cũng cảm ơn gia đình và bạn bè đã luôn động viên, và cảm ơn những người đã dành thời gian dùng thử sản phẩm,
ghi âm hội thoại và góp ý để hệ thống ngày càng hoàn thiện.

Dù đã cố gắng, đồ án chắc chắn không tránh khỏi thiếu sót. Chúng em rất mong nhận được ý kiến đóng góp của quý thầy cô
để đề tài được hoàn thiện hơn.

Chúng em xin chân thành cảm ơn!

_Hà Nội, ngày ..... tháng 12 năm 2026_

**Nhóm sinh viên thực hiện**

Nguyễn Việt Tú

Nguyễn Mạc Quang Anh

---

# NHẬN XÉT, ĐÁNH GIÁ, CHO ĐIỂM

**(Của Giảng viên hướng dẫn)**

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

Điểm: .................................... (Bằng chữ: ....................................)

_Hà Nội, ngày ..... tháng ..... năm 20....._

**GIẢNG VIÊN HƯỚNG DẪN**

_(Ký và ghi rõ họ tên)_

---

# NHẬN XÉT, ĐÁNH GIÁ, CHO ĐIỂM

**(Của Giảng viên phản biện)**

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

.......................................................................................................................................

Điểm: .................................... (Bằng chữ: ....................................)

_Hà Nội, ngày ..... tháng ..... năm 20....._

**CÁN BỘ - GIẢNG VIÊN PHẢN BIỆN**

_(Ký và ghi rõ họ tên)_

---

# MỤC LỤC

[Tạo tự động trong Word]

# DANH MỤC HÌNH ẢNH

[Tạo tự động trong Word từ chú thích "Hình x.y"]

# DANH MỤC BẢNG BIỂU

[Tạo tự động trong Word từ chú thích "Bảng x.y"]

# DANH MỤC KÝ HIỆU VÀ TỪ VIẾT TẮT

| Từ viết tắt | Tiếng Anh                                      | Tiếng Việt                               |
| ----------- | ---------------------------------------------- | ---------------------------------------- |
| AI          | Artificial Intelligence                        | Trí tuệ nhân tạo                         |
| API         | Application Programming Interface              | Giao diện lập trình ứng dụng             |
| ASR         | Automatic Speech Recognition                   | Nhận dạng tiếng nói tự động              |
| CER         | Character Error Rate                           | Tỷ lệ lỗi ký tự                          |
| CI/CD       | Continuous Integration / Continuous Deployment | Tích hợp liên tục / Triển khai liên tục  |
| CPU         | Central Processing Unit                        | Bộ xử lý trung tâm                       |
| CSP         | Content Security Policy                        | Chính sách bảo mật nội dung              |
| e2e         | End-to-end                                     | Đầu-cuối                                 |
| GPU         | Graphics Processing Unit                       | Bộ xử lý đồ hoạ                          |
| ICE         | Interactive Connectivity Establishment         | Thiết lập kết nối tương tác              |
| ITN         | Inverse Text Normalization                     | Chuẩn hoá văn bản ngược                  |
| JWT         | JSON Web Token                                 | Token web dạng JSON                      |
| LID         | Language Identification                        | Nhận diện ngôn ngữ                       |
| LLM         | Large Language Model                           | Mô hình ngôn ngữ lớn                     |
| MCU         | Multipoint Control Unit                        | Bộ điều khiển đa điểm                    |
| MOS         | Mean Opinion Score                             | Điểm đánh giá trung bình                 |
| MQM         | Multidimensional Quality Metrics               | Thước đo chất lượng đa chiều             |
| MT          | Machine Translation                            | Dịch máy                                 |
| MV3         | Manifest Version 3                             | Phiên bản manifest 3 của tiện ích Chrome |
| ORM         | Object-Relational Mapping                      | Ánh xạ đối tượng – quan hệ               |
| p50 / p95   | 50th / 95th percentile                         | Trung vị / phân vị 95                    |
| PCM         | Pulse-Code Modulation                          | Điều chế xung mã                         |
| REST        | Representational State Transfer                | Kiến trúc truyền trạng thái đại diện     |
| RNN-T       | Recurrent Neural Network Transducer            | Bộ chuyển đổi mạng nơ-ron hồi quy        |
| RTF         | Real-Time Factor                               | Hệ số thời gian thực                     |
| RTT         | Round-Trip Time                                | Thời gian khứ hồi                        |
| SDP         | Session Description Protocol                   | Giao thức mô tả phiên                    |
| SFU         | Selective Forwarding Unit                      | Bộ chuyển tiếp chọn lọc                  |
| STT         | Speech-to-Text                                 | Chuyển tiếng nói thành văn bản           |
| STUN        | Session Traversal Utilities for NAT            | Tiện ích vượt NAT cho phiên              |
| TDT         | Token-and-Duration Transducer                  | Transducer dự đoán token và thời lượng   |
| TTFA        | Time to First Audio                            | Thời gian tới âm thanh đầu tiên          |
| TTS         | Text-to-Speech                                 | Tổng hợp tiếng nói                       |
| TURN        | Traversal Using Relays around NAT              | Vượt NAT bằng máy chủ chuyển tiếp        |
| UI          | User Interface                                 | Giao diện người dùng                     |
| VAD         | Voice Activity Detection                       | Phát hiện hoạt động giọng nói            |
| WebRTC      | Web Real-Time Communication                    | Truyền thông thời gian thực trên web     |
| WER         | Word Error Rate                                | Tỷ lệ lỗi từ                             |
