# CHƯƠNG 1. TỔNG QUAN VÀ CƠ SỞ LÝ THUYẾT

<!--
Ghi chú biên soạn (xoá khi chuyển sang Word):
- Mục 1.2 dựa trên tìm kiếm web ngày 19/11/2026; tính năng sản phẩm thương mại thay đổi nhanh, cần kiểm lại
  trước khi nộp. Nguồn ghi ở cuối file.
- Trích dẫn đã đánh số theo IEEE, khớp với 06-tai-lieu-tham-khao.md.
-->

Chương này giới thiệu bài toán dịch thoại thời gian thực, khảo sát một số sản phẩm hiện có, trình bày cơ sở
lý thuyết về xử lý tiếng nói, dịch máy, truyền thông thời gian thực, và các công nghệ được dùng để xây dựng
hệ thống Chatofy.

## 1.1 Bài toán dịch thoại thời gian thực

### 1.1.1 Phát biểu bài toán

Dịch thoại thời gian thực (_real-time speech translation_) là bài toán nhận lời nói ở ngôn ngữ nguồn và tạo
ra bản dịch ở ngôn ngữ đích, dưới dạng chữ, giọng nói hoặc cả hai, trong khi cuộc hội thoại đang diễn ra.
Khác với dịch văn bản, đầu vào là một luồng âm thanh liên tục: hệ thống phải tự quyết định khi nào một câu đã
kết thúc, câu đó thuộc ngôn ngữ nào và do ai nói, rồi mới dịch.

Với hội thoại, chất lượng trải nghiệm phụ thuộc vào ba yếu tố:

1. **Độ trễ**: thời gian từ khi người nói dừng đến khi người nghe nhận được bản dịch. Nếu độ trễ quá lớn, hai
   người sẽ nói chồng lên nhau hoặc phải chờ lâu sau mỗi câu.
2. **Độ chính xác**: lỗi có thể đến từ việc nghe sai, dịch sai hoặc cắt câu sai chỗ.
3. **Phản hồi liên tục**: người dùng cần thấy hệ thống đang "nghe" mình, ví dụ chữ hiện ra trong lúc đang nói.

### 1.1.2 Hai hướng tiếp cận

**Hướng tầng (_cascade_)** ghép ba thành phần độc lập: nhận dạng tiếng nói (ASR hoặc STT) chuyển âm thanh thành
văn bản, dịch máy (MT) chuyển văn bản sang ngôn ngữ đích, và tổng hợp tiếng nói (TTS) đọc bản dịch. Ưu điểm là
mỗi thành phần có thể thay thế và đánh giá riêng, văn bản trung gian dùng được cho phụ đề và lưu trữ. Nhược điểm
là độ trễ cộng dồn qua ba bước và lỗi của bước trước lan sang bước sau.

**Hướng đầu-cuối (_end-to-end_)** dùng một mô hình duy nhất nhận âm thanh và sinh trực tiếp bản dịch, thường là
giọng nói. Hướng này có thể giảm độ trễ và giữ được ngữ điệu, nhưng khó kiểm soát từng bước, khó thêm thuật ngữ
riêng, thường chỉ có dưới dạng dịch vụ đám mây, và không nhất thiết hỗ trợ mọi cặp ngôn ngữ.

Chatofy chọn hướng tầng. Nhóm đã thử một mô hình đầu-cuối (Gemini Live [1]) làm mốc so sánh; lý do lựa chọn và kết
quả đo được trình bày ở Chương 3.

### 1.1.3 Các thách thức kỹ thuật

- **Phát hiện điểm kết thúc câu** (_endpointing_): chờ im lặng lâu thì chậm, chờ ngắn thì cắt giữa câu.
- **Phân lượt** (_turn-taking_): khi hai người dùng chung một micro, hệ thống phải biết ai đang nói.
- **Nhận diện ngôn ngữ**: ở chế độ hai chiều, mỗi lượt có thể là một trong hai ngôn ngữ.
- **Tiếng vọng**: khi bản dịch phát ra loa, micro có thể thu lại và dịch tiếp chính bản dịch đó.
- **Tài nguyên**: các mô hình lớn cho chất lượng tốt nhưng cần GPU; chạy trên CPU đòi hỏi chọn mô hình cẩn thận.
- **Tiếng Việt**: là ngôn ngữ có thanh điệu, nhiều từ đồng âm, và còn ít mô hình mã nguồn mở chất lượng cao so
  với tiếng Anh.

## 1.2 Khảo sát các sản phẩm hiện có

### 1.2.1 Google Translate – chế độ hội thoại

Ứng dụng Google Translate trên điện thoại có chế độ hội thoại: hai người dùng chung một thiết bị, ứng dụng nghe
và dịch qua lại giữa hai ngôn ngữ đã chọn, đọc bản dịch thành tiếng. Đây là công cụ phổ biến nhất cho hội thoại
mặt đối mặt. Hạn chế là không lưu lịch sử hội thoại có cấu trúc, không hỗ trợ bảng thuật ngữ riêng, và không dùng
được bên trong một cuộc họp trực tuyến.

### 1.2.2 Microsoft Translator – hội thoại nhiều thiết bị

Microsoft Translator từng cung cấp tính năng hội thoại nhiều thiết bị: mỗi người tham gia từ thiết bị riêng, nói
bằng ngôn ngữ của mình và đọc bản dịch sang ngôn ngữ của mình [2]. Năm 2022, Microsoft chuyển ứng dụng web
sang giao diện rút gọn và bỏ khả năng tạo hội thoại trên web [3]; tính năng này nay chỉ còn trên ứng dụng
di động và không dùng được bên trong các nền tảng họp trực tuyến.

### 1.2.3 Google Meet – dịch giọng nói và phụ đề dịch

Google Meet có hai tính năng: phụ đề dịch (_translated captions_) và dịch giọng nói bằng Gemini. Tháng 10/2026,
Google công bố dịch giọng nói hỗ trợ 63 ngôn ngữ trên web, Android và iOS, có tự nhận diện ngôn ngữ, thay cho phiên
bản trước chỉ hỗ trợ tiếng Anh với năm ngôn ngữ châu Âu [4]. Các tính năng này gắn với
gói Google Workspace trả phí và chỉ dùng được bên trong Google Meet.

### 1.2.4 Zoom – phụ đề dịch

Zoom cung cấp phụ đề dịch dưới dạng tiện ích trả phí, hỗ trợ khoảng 35–36 ngôn ngữ, trong đó có tiếng Việt [5]. Tính năng chỉ cung cấp phụ đề, không đọc bản dịch thành tiếng.

### 1.2.5 Thiết bị phiên dịch cầm tay

Các thiết bị như máy phiên dịch cầm tay hoạt động tương tự chế độ hội thoại của Google Translate trên một phần cứng
riêng. Chúng tiện cho du lịch nhưng tốn chi phí thiết bị và không phục vụ họp trực tuyến.

### 1.2.6 So sánh và định hướng

**Bảng 1.1. So sánh tính năng các sản phẩm**

| Tiêu chí                              | Google Translate | Google Meet           | Zoom                  | Chatofy                   |
| ------------------------------------- | ---------------- | --------------------- | --------------------- | ------------------------- |
| Hội thoại mặt đối mặt                 | Có               | Không                 | Không                 | Có                        |
| Họp video có dịch                     | Không            | Có (gói trả phí)      | Phụ đề (gói trả phí)  | Có                        |
| Dịch trong cuộc gọi của nền tảng khác | Không            | Không                 | Không                 | Có (tiện ích Chrome)      |
| Đọc bản dịch thành tiếng              | Có               | Có                    | Không                 | Có                        |
| Lưu và tìm kiếm lịch sử hội thoại     | Hạn chế          | Theo bản ghi cuộc họp | Theo bản ghi cuộc họp | Có                        |
| Bảng thuật ngữ, ngữ cảnh dịch riêng   | Không            | Không                 | Không                 | Có, dùng chung trong nhóm |
| Biên bản tự động                      | Không            | Có (gói trả phí)      | Có (gói trả phí)      | Có                        |
| Nhận dạng tiếng nói chạy cục bộ       | Không            | Không                 | Không                 | Có                        |

Bảng 1.1 cho thấy các sản phẩm lớn hoặc chỉ phục vụ hội thoại mặt đối mặt, hoặc chỉ phục vụ cuộc họp trên chính
nền tảng của mình, và đều dựa hoàn toàn vào đám mây. Chatofy hướng tới việc dùng chung một luồng dịch cho cả ba
tình huống (mặt đối mặt, họp video, cuộc gọi trên nền tảng khác), hỗ trợ thuật ngữ riêng của người dùng và của
nhóm, và chạy phần xử lý tiếng nói cục bộ để giảm chi phí và tăng quyền riêng tư.

### 1.2.7 Đối tượng người dùng

Dựa trên khảo sát, Chatofy xác định hai nhóm người dùng chính và hai nhóm phụ:

- **Người đi làm Việt Nam trao đổi với đối tác nói tiếng Anh hoặc tiếng Trung** (nhóm chính): cần dịch trong các
  buổi gặp trực tiếp và các cuộc gọi trên Google Meet hoặc Zoom.
- **Nhóm làm việc đa quốc gia quy mô nhỏ, từ 2 đến 6 người** (nhóm chính): cần một phòng họp mà mỗi người nói tiếng
  của mình.
- **Khách du lịch và người Việt ra nước ngoài** (nhóm phụ): cần hội thoại ngắn mặt đối mặt.
- **Doanh nghiệp nhỏ có thuật ngữ chuyên ngành** (nhóm phụ): cần một bảng thuật ngữ dùng chung cho cả nhóm.

<!-- TODO nhóm: bổ sung 1–2 số liệu bối cảnh có nguồn chính thức (lượng khách quốc tế đến Việt Nam,
xếp hạng EF EPI của Việt Nam, số doanh nghiệp FDI). Không dùng số tự ước tính. -->

## 1.3 Cơ sở lý thuyết xử lý tiếng nói

### 1.3.1 Nhận dạng tiếng nói

Nhận dạng tiếng nói tự động (_Automatic Speech Recognition_, ASR) chuyển tín hiệu âm thanh thành chuỗi ký tự hoặc
từ. Âm thanh thường được biến đổi thành đặc trưng phổ Mel (_log-Mel filterbank_), mỗi khung khoảng 10 ms, rồi đưa
qua một bộ mã hoá (_encoder_) mạng nơ-ron. Có ba họ kiến trúc giải mã phổ biến:

**Mô hình transducer (RNN-T).** Đề xuất bởi Graves [6], gồm bộ mã hoá âm thanh, mạng dự đoán (_prediction
network_) mô hình hoá chuỗi token đã sinh, và mạng nối (_joint network_) kết hợp hai nguồn để dự đoán token tiếp
theo hoặc ký hiệu rỗng. Transducer phù hợp với nhận dạng streaming và có độ trễ thấp. Zipformer [7] là
một bộ mã hoá cho transducer, xử lý chuỗi ở nhiều tốc độ khung khác nhau theo cấu trúc giống U-Net để giảm chi phí
tính toán. Chatofy dùng mô hình Zipformer 30 triệu tham số cho tiếng Việt.

**Token-and-Duration Transducer (TDT).** Mở rộng của transducer: ngoài token, mô hình dự đoán thêm số khung cần bỏ
qua, giúp giải mã nhanh hơn. Parakeet-TDT-0.6B-v2, mô hình Chatofy dùng cho tiếng Anh, kết hợp bộ mã hoá
FastConformer [8] với bộ giải mã TDT [9], và tự sinh dấu câu, chữ hoa.

**Mô hình mã hoá–giải mã (encoder–decoder).** Whisper [10] là mô hình Transformer mã hoá–giải mã được
huấn luyện trên khoảng 680.000 giờ dữ liệu đa ngôn ngữ có giám sát yếu, đồng thời thực hiện nhiều tác vụ: nhận dạng,
dịch sang tiếng Anh và nhận diện ngôn ngữ. Giải mã tự hồi quy của Whisper chậm trên CPU, nên Chatofy chỉ dùng phần
xác suất ngôn ngữ của Whisper base để nhận diện ngôn ngữ. PhoWhisper [11] là Whisper được tinh chỉnh
cho tiếng Việt.

**Mô hình không tự hồi quy.** Paraformer [12] dự đoán số token và sinh toàn bộ chuỗi trong một bước,
nhanh hơn giải mã tự hồi quy. Chatofy dùng Paraformer cho tiếng Trung.

**Giải mã và danh sách từ ưu tiên.** Giải mã tham lam (_greedy search_) chọn token có xác suất cao nhất ở mỗi bước;
giải mã chùm (_beam search_) giữ nhiều giả thuyết song song. Danh sách từ ưu tiên (_hotwords_ hoặc _contextual
biasing_) cộng điểm cho các cụm từ biết trước như tên riêng.

**Chỉ số đánh giá.** Tỷ lệ lỗi từ được tính:

$$\text{WER} = \frac{S + D + I}{N}$$

trong đó $S$, $D$, $I$ là số từ bị thay thế, xoá, chèn, và $N$ là số từ của câu tham chiếu. Với tiếng Trung, không
có khoảng trắng giữa các từ, nên dùng tỷ lệ lỗi ký tự (CER). Tốc độ được đo bằng hệ số thời gian thực
$\text{RTF} = t_{\text{xử lý}} / t_{\text{âm thanh}}$.

### 1.3.2 Phát hiện giọng nói và phân lượt

Bộ phát hiện giọng nói (_Voice Activity Detection_, VAD) phân loại mỗi khung âm thanh là có tiếng nói hay không.
Cách đơn giản nhất so năng lượng (RMS) với một ngưỡng; các mô hình học sâu như Silero VAD [13] phân biệt
tốt hơn tiếng nói với nhạc và tiếng ồn.

Từ đầu ra VAD, hệ thống xác định điểm kết thúc lượt: một lượt kết thúc khi im lặng kéo dài quá một khoảng chờ
(_hangover_). Khoảng chờ dài làm tăng độ trễ, khoảng chờ ngắn làm cắt câu khi người nói ngập ngừng. Một kỹ thuật bù
trừ là **dịch suy đoán**: bắt đầu xử lý ngay khi có im lặng ngắn, và chỉ dùng kết quả nếu sau đó người nói thực sự
dừng.

### 1.3.3 Nhận diện ngôn ngữ và nhận diện người nói

**Nhận diện ngôn ngữ** (_Language Identification_, LID) xác định ngôn ngữ của một đoạn âm thanh. Có thể dùng mô hình
chuyên dụng (như MMS-LID [14], AmberNet [15]), dùng xác suất ngôn ngữ của một mô hình ASR đa ngôn ngữ (như Whisper),
hoặc cho nhiều bộ nhận dạng cùng chạy rồi so sánh độ tin cậy. Độ chính xác giảm mạnh với đoạn âm thanh ngắn, nên
hệ thống thời gian thực phải cân bằng giữa hiển thị nhãn sớm và hiển thị nhãn đúng.

**Nhận diện người nói** dựa trên vector đặc trưng giọng nói (_speaker embedding_): một mạng nơ-ron ánh xạ đoạn âm
thanh thành một vector có số chiều cố định, sao cho các đoạn của cùng một người gần nhau. Độ tương đồng giữa hai vector
$a$ và $b$ được đo bằng cosine:

$$\cos(a, b) = \frac{a \cdot b}{\lVert a \rVert \, \lVert b \rVert}$$

Chatofy dùng CAM++ [16], một mạng xác minh người nói dựa trên TDNN với cơ chế che theo ngữ cảnh, sinh vector
192 chiều.

### 1.3.4 Tổng hợp tiếng nói

Tổng hợp tiếng nói (_Text-to-Speech_, TTS) hiện đại gồm hai phần: mô hình âm học sinh biểu diễn trung gian (như phổ
Mel) từ văn bản, và bộ tạo sóng âm (_vocoder_) chuyển biểu diễn đó thành tín hiệu. Nhiều mô hình mới gộp hai phần
thành một. Kokoro-82M là mô hình 82 triệu tham số, giấy phép Apache-2.0, được Chatofy dùng cho tiếng Anh và tiếng
Trung. VieNeu [17] là mô hình TTS tiếng Việt mã nguồn mở có API sinh âm thanh dạng luồng.

Ba chỉ số chính để đánh giá TTS:

- **MOS** (_Mean Opinion Score_): người nghe chấm điểm từ 1 đến 5, lấy trung bình, theo khuyến nghị ITU-T P.800
  [18].
- **Độ dễ hiểu**: đưa âm thanh tổng hợp qua một mô hình ASR rồi đo WER so với văn bản gốc (_round-trip WER_).
- **TTFA** (_time to first audio_): thời gian tới mẫu âm thanh đầu tiên. Với dạng luồng, cần xét thêm việc âm thanh
  có bị ngắt quãng không (_underrun_), tức tốc độ sinh có theo kịp tốc độ phát không.

### 1.3.5 Dịch máy bằng mô hình ngôn ngữ lớn

Các mô hình ngôn ngữ lớn (LLM) hiện nay dịch tốt nhiều cặp ngôn ngữ mà không cần huấn luyện riêng. Chất lượng có thể
cải thiện bằng lời nhắc (_prompt_) chứa ngữ cảnh hội thoại trước đó, chủ đề và bảng thuật ngữ. Gọi API ở chế độ luồng
(_streaming_) giúp nhận token đầu tiên sớm hơn. Hai rủi ro cần xử lý: hạn mức yêu cầu của nhà cung cấp, và **tấn công
chèn lệnh** (_prompt injection_): vì văn bản cần dịch là lời người dùng, nó có thể chứa câu lệnh khiến mô hình làm
theo thay vì dịch.

**Đánh giá chất lượng dịch.** Các thước đo tự động truyền thống so bản dịch với bản tham chiếu: BLEU [19] dựa
trên n-gram từ, chrF [20] dựa trên n-gram ký tự. COMET [21] dùng mô hình nơ-ron học từ điểm do người
chấm; biến thể CometKiwi [22] không cần bản tham chiếu. Khung MQM (_Multidimensional Quality Metrics_)
[23] phân loại từng lỗi theo loại và mức độ nghiêm trọng. Gần đây, nhiều nghiên cứu dùng chính LLM làm giám khảo
(_LLM-as-a-judge_) [24]; cách này cần được hiệu chuẩn trên các lỗi biết trước để đảm bảo đáng tin.

## 1.4 Truyền thông thời gian thực

### 1.4.1 WebSocket

WebSocket [25] cung cấp kênh truyền hai chiều, liên tục giữa trình duyệt và máy chủ trên một kết nối TCP,
được thiết lập bằng cách nâng cấp (_upgrade_) một yêu cầu HTTP. Chatofy dùng WebSocket để gửi khung âm thanh lên máy
chủ và nhận văn bản, bản dịch, âm thanh về.

### 1.4.2 WebRTC

WebRTC [26] là tập chuẩn cho phép trình duyệt truyền âm thanh, video và dữ liệu trực tiếp với độ trễ thấp
qua UDP. Hai bên trao đổi mô tả phiên (SDP) theo mô hình offer/answer qua một kênh báo hiệu riêng. Giao thức ICE
[27] tìm đường kết nối qua NAT: thử địa chỉ cục bộ, địa chỉ công khai do máy chủ STUN cho biết, và cuối
cùng là chuyển tiếp qua máy chủ TURN.

### 1.4.3 Mô hình kết nối cho cuộc họp nhiều người

**Bảng 1.2. So sánh các mô hình kết nối cuộc họp**

| Mô hình       | Cách hoạt động                                           | Ưu điểm                                   | Nhược điểm                                                   |
| ------------- | -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Lưới (_mesh_) | Mỗi người gửi trực tiếp tới mọi người khác               | Không cần máy chủ media                   | Băng thông tải lên tăng theo số người; chỉ hợp với 2–4 người |
| MCU           | Máy chủ giải mã, trộn tất cả thành một luồng rồi gửi lại | Mỗi người chỉ nhận một luồng              | Máy chủ tốn CPU; tăng độ trễ                                 |
| SFU           | Máy chủ chuyển tiếp chọn lọc các luồng, không giải mã    | Nhẹ cho máy chủ, độ trễ thấp, mở rộng tốt | Mỗi người nhận nhiều luồng                                   |

Chatofy dùng SFU do Cloudflare Realtime cung cấp. API giữ khoá bí mật và điều khiển SFU qua HTTPS; trình duyệt chỉ
trao đổi media với SFU qua WebRTC.

## 1.5 Công nghệ phát triển

Bảng 1.3 tóm tắt các công nghệ được dùng và lý do lựa chọn; chi tiết kỹ thuật tham khảo từ tài liệu chính thức
của từng công nghệ [28]–[35].

**Bảng 1.3. Các công nghệ sử dụng**

| Thành phần                       | Công nghệ                                            | Lý do lựa chọn                                                                 |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Quản lý mã nguồn                 | Turborepo + pnpm (monorepo)                          | Dùng chung mã giữa web, extension, mobile; cache build                         |
| Ngôn ngữ                         | TypeScript (ứng dụng), Python (sidecar tiếng nói)    | Kiểu tĩnh xuyên suốt; hệ sinh thái mô hình tiếng nói của Python                |
| Hợp đồng dữ liệu                 | zod                                                  | Một schema vừa kiểm tra lúc chạy, vừa sinh kiểu TypeScript và tài liệu OpenAPI |
| Máy chủ                          | NestJS (Express)                                     | Hỗ trợ WebSocket, tiêm phụ thuộc, tổ chức theo module                          |
| Web                              | Next.js, React, Tailwind CSS, shadcn/ui              | Kết xuất phía máy chủ cho trang công khai; bộ component truy cập được          |
| Tiện ích trình duyệt             | Chrome Manifest V3 (WXT)                             | Thu âm thanh tab cuộc gọi trên Meet, Zoom, Facebook                            |
| Di động                          | Expo (React Native), react-native-webrtc             | Dùng lại mã TypeScript và package chung                                        |
| Cơ sở dữ liệu                    | PostgreSQL + Prisma ORM                              | Dữ liệu quan hệ; migration có kiểm soát; chỉ mục trigram cho tìm kiếm          |
| Bộ nhớ đệm phiên                 | Redis                                                | Lưu refresh token xoay vòng, thao tác nguyên tử bằng Lua                       |
| Lưu trữ tệp                      | Cloudflare R2                                        | Ảnh đại diện, bản ghi âm hội thoại                                             |
| Media họp video                  | Cloudflare Realtime SFU                              | Không cần tự vận hành máy chủ media; máy chủ không cần nhận kết nối từ ngoài   |
| Suy luận mô hình tiếng nói       | sherpa-onnx, ONNX Runtime                            | Chạy mô hình STT, TTS, speaker embedding trên CPU                              |
| Dịch máy, hậu biên tập, biên bản | DeepSeek và các LLM qua giao thức tương thích OpenAI | Chất lượng tốt, chi phí thấp, dễ đổi nhà cung cấp                              |
| Thanh toán                       | Polar, SePay                                         | Thanh toán quốc tế và chuyển khoản ngân hàng Việt Nam (VietQR)                 |
| Triển khai                       | Docker Compose, GitHub Actions                       | Tự triển khai trên một máy chủ; CI kiểm tra mọi thay đổi                       |
| Kiểm thử                         | Vitest, Playwright                                   | Kiểm thử đơn vị, tích hợp, e2e và trình duyệt thật                             |

## 1.6 Kết luận

Chương 1 đã phát biểu bài toán dịch thoại thời gian thực và các thách thức của nó, khảo sát các sản phẩm hiện có,
và trình bày cơ sở lý thuyết về nhận dạng, tổng hợp tiếng nói, nhận diện ngôn ngữ và người nói, dịch máy bằng mô hình
ngôn ngữ lớn, truyền thông thời gian thực. Từ khảo sát, đồ án xác định hướng đi: một luồng dịch dạng tầng, phần tiếng
nói chạy cục bộ trên CPU, dùng chung cho hội thoại trực tiếp, họp video và cuộc gọi trên nền tảng khác. Chương 2 trình
bày phân tích yêu cầu và thiết kế hệ thống theo hướng đi đó.

<!--
Nguồn tra cứu cho mục 1.2 (19/11/2026):
- https://workspaceupdates.googleblog.com/2026/10/real-time-speech-translation-in-google-Meet-expands-to-63-languages-with-automatic-language-detection.html
- https://workspaceupdates.googleblog.com/2026/04/speech-translation-in-google-meet-is-now-rolling-out-to-mobile-devices.html
- https://www.microsoft.com/en-us/translator/help/live-feature/
- https://www.microsoft.com/en-us/translator/blog/2022/08/03/transitioning-the-microsoft-translator-web-app-to-a-simplified-experience
- https://techcommunity.microsoft.com/discussions/microsoft-365/microsoft-translator-conversation-feature-stopped-working-%E2%80%9Cunable-to-create-new-/4460628
- https://www.whistleout.com/CellPhones/Apps/is-microsoft-translator-worth-downloading (nguồn thứ cấp, mốc 06/2026)
- https://www.zoom.com/en/blog/translated-captions
- https://news.zoom.com/bridge-the-language-gap-and-connect-people-with-zoom-translated-captions/
-->
