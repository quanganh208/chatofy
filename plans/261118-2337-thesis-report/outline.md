# Đề cương báo cáo ĐATN — Chatofy

Trạng thái: **bản nháp đề cương, chờ nhóm duyệt** · Tạo: 18/11/2026

## 0. Thông tin cố định

| Mục       | Giá trị                                                              |
| --------- | -------------------------------------------------------------------- |
| Đề tài    | Nghiên cứu và phát triển hệ thống dịch thoại thời gian thực Chatofy  |
| Sinh viên | Nguyễn Việt Tú — B22DCCN748; Nguyễn Mạc Quang Anh — B22DCCN029       |
| Lớp       | D22CNPM02                                                            |
| GVHD      | PGS. TS. Nguyễn Trọng Khánh                                          |
| Đơn vị    | Học viện Công nghệ Bưu chính Viễn thông — Khoa Công nghệ thông tin 1 |
| Thời điểm | Hà Nội, tháng 12 năm 2026                                            |
| Xưng hô   | "chúng em" (nhóm 2 người)                                            |
| Định dạng | Times New Roman 13, giãn dòng 1.5; ~70 trang phần thân               |
| Đánh số   | Chương 1, 1.1, 1.1.1; Hình 2.5, Bảng 2.1 (gắn theo chương)           |
| Trích dẫn | IEEE (số thứ tự trong ngoặc vuông `[1]`), như các mẫu                |
| Đầu ra    | Markdown, nhóm tự chuyển sang `.docx`                                |

Cấu trúc theo mẫu nha khoa (`E:\PTIT\DATN\Mẫu\DATN_04_01_2026.md`): 4 chương, có một chương riêng
về kỹ thuật AI kèm thực nghiệm. Bốn mẫu còn lại 3 chương; nếu GVHD muốn 3 chương thì gộp Chương 3 và 4.

## 1. Phạm vi báo cáo (scope)

**Trọng tâm** (viết sâu, có số đo):

1. Dịch thoại trực tiếp trên web (`/translate`): STT → MT → TTS, hai chiều vi↔en, tự nhận diện ngôn ngữ (LID).
2. Họp video có dịch (`/conference`): SFU, phụ đề và giọng dịch cho từng người nghe, chat dịch, biên bản.

**Trình bày ngắn** (1 mục hoặc 1 đoạn mỗi phần): extension Chrome cho Meet/Zoom/Facebook,
lịch sử hội thoại, AI Context + glossary, biên bản họp bằng LLM, teams, credits.

**Chỉ nhắc ở hướng phát triển**: ứng dụng mobile (mới chạy ở development build), bán công khai,
voice cloning, chế độ offline, LID cho tiếng Trung.

Lý do: hai luồng trọng tâm là nơi có bài toán kỹ thuật khó (độ trễ < 2 s, CPU-only) và nhiều số đo nhất
trong `benchmarks/` và `docs/development-journey.md`. Các tính năng còn lại là CRUD/nghiệp vụ, ít
giá trị học thuật, viết dài sẽ vượt 70 trang.

## 2. Người dùng mục tiêu (đề xuất, cần nhóm xác nhận)

Nguồn: `docs/project-overview-pdr.md` mục Target Users, cộng với ba bề mặt sản phẩm đang chạy.

| Nhóm                                                           | Nhu cầu                                 | Bề mặt dùng                           | Ưu tiên |
| -------------------------------------------------------------- | --------------------------------------- | ------------------------------------- | ------- |
| Người đi làm Việt Nam trao đổi với đối tác nói tiếng Anh/Trung | Họp, đàm phán, trao đổi trực tiếp       | Web `/translate`, extension           | Chính   |
| Nhóm làm việc đa quốc gia quy mô nhỏ (2–6 người)               | Họp trực tuyến mỗi người nói tiếng mình | `/conference`                         | Chính   |
| Khách du lịch, người Việt ra nước ngoài                        | Hội thoại mặt đối mặt ngắn              | Web trên điện thoại (sau này: mobile) | Phụ     |
| Doanh nghiệp nhỏ dùng thuật ngữ chuyên ngành                   | Glossary chung cho cả nhóm              | Teams + AI Context                    | Phụ     |

Số liệu bối cảnh nên dẫn trong Mở đầu/1.1 (nhóm phải **tự tra và kiểm chứng** từ nguồn chính thức):

- Lượng khách quốc tế đến Việt Nam năm gần nhất — Cục Thống kê / Cục Du lịch Quốc gia.
- Vốn FDI và số doanh nghiệp nước ngoài tại Việt Nam — Bộ Tài chính (Cục Đầu tư nước ngoài).
- Tỷ lệ người Việt dùng thành thạo tiếng Anh — EF EPI (xếp hạng Việt Nam).

Không đưa con số thị trường tự ước tính vào báo cáo nếu không có nguồn.

## 2b. Cách trình bày đóng góp (đã chốt)

Nguyên tắc: nói thẳng phần nào dùng sẵn, phần nào nhóm làm. Hội đồng đánh giá cao sự rõ ràng; nhận vơ
phần huấn luyện mô hình là rủi ro lớn nhất khi bảo vệ.

**Dùng sẵn (không tự huấn luyện):** các mô hình STT (Zipformer, Parakeet), TTS (Kokoro, VieNeu), VAD
(Silero), mô hình speaker embedding, LLM Gemini cho dịch và biên bản, hạ tầng SFU Cloudflare Realtime,
runtime sherpa-onnx.

**Nhóm thực hiện:**

1. Thiết kế kiến trúc và hợp đồng dùng chung (registry ngôn ngữ, zod contracts, provider interface).
2. Chọn mô hình bằng benchmark trên phần cứng đích, thay vì tin số công bố.
3. Kỹ thuật pipeline thời gian thực: phân lượt, commit streaming, head-start, tổng hợp theo mệnh đề,
   TTS streaming — nguồn chính của mức giảm độ trễ.
4. Tích hợp LID cho hội thoại hai chiều và tự nhận diện; quy tắc gán người nói theo lượt.
5. Lớp hiển thị tiếng Việt: ITN tất định và khôi phục dấu câu/viết hoa.
6. Dịch theo từng người nghe trong họp video, chat dịch theo người nhận.
7. Bộ benchmark tái lập được (~25 harness) và phương pháp đánh giá (chrF, CometKiwi, LLM-judge, MOS).
8. Sản phẩm hoàn chỉnh: web, extension, tài khoản, lịch sử, glossary, teams, credits, CI/CD.

Câu tóm tắt dùng trong Mở đầu/Kết luận: "Đóng góp của đồ án nằm ở kỹ thuật hệ thống và phương pháp
đánh giá, không ở huấn luyện mô hình."

## 3. Phân bổ trang (~70 trang thân)

| Phần                                                        | Trang |
| ----------------------------------------------------------- | ----- |
| Mở đầu                                                      | 3     |
| Chương 1. Tổng quan và cơ sở lý thuyết                      | 15    |
| Chương 2. Phân tích và thiết kế hệ thống                    | 20    |
| Chương 3. Kỹ thuật dịch thoại thời gian thực và thực nghiệm | 18    |
| Chương 4. Cài đặt, giao diện và kiểm thử                    | 12    |
| Kết luận                                                    | 2     |

Phần đầu (bìa, lời cảm ơn, nhận xét ×2, mục lục, danh mục hình/bảng/từ viết tắt) và tài liệu tham khảo
không tính vào 70 trang.

## 4. Đề cương chi tiết

Cột "Nguồn" là file để lấy nội dung; tất cả đường dẫn tính từ gốc repo.

### Phần đầu

- Trang bìa (theo mẫu Bùi Minh Hiếu: bảng GVHD / SV / MSSV / Lớp — **còn thiếu lớp**).
- Lời cảm ơn (Claude soạn nháp).
- Nhận xét của GVHD; nhận xét của GV phản biện (trang trống có dòng chấm).
- Mục lục; Danh mục hình; Danh mục bảng; Danh mục ký hiệu và từ viết tắt (STT, MT, TTS, LID, VAD,
  WER, CER, SFU, WebRTC, ITN, LLM, MOS, TTFA, p50/p95, JWT, MV3...).

### Mở đầu (3 tr)

- Lý do chọn đề tài: rào cản ngôn ngữ khi họp và trao đổi trực tiếp; giải pháp hiện có còn chậm, phụ thuộc cloud.
- Mục tiêu: độ trễ hết câu → âm thanh dịch đầu tiên < 2 s; chạy STT/TTS trên CPU không cần API key; 3 ngôn ngữ.
- Đối tượng và phạm vi (mục 1–2 ở trên).
- Phương pháp: nghiên cứu → benchmark trên phần cứng thật → quyết định → đo lại sau khi sửa.
- Đóng góp chính (4 ý): pipeline STT→MT→TTS streaming độ trễ thấp chạy CPU; nhận diện ngôn ngữ theo lượt
  cho hội thoại hai chiều; họp video dịch theo từng người nghe trên SFU; bộ benchmark tái lập được.
- Bố cục báo cáo.
- Nguồn: `docs/project-overview-pdr.md`, `docs/development-journey.md` §1.

### Chương 1. Tổng quan và cơ sở lý thuyết (15 tr)

- 1.1 Bài toán dịch thoại thời gian thực — định nghĩa, các chỉ số (độ trễ, độ chính xác), cascade vs
  speech-to-speech end-to-end.
- 1.2 Khảo sát sản phẩm tương tự (theo FINGENIUS 1.2): Google Translate chế độ hội thoại, Microsoft
  Translator, phụ đề dịch của Google Meet / Zoom, thiết bị phiên dịch cầm tay. Bảng so sánh tính năng.
  (Nhóm kiểm chứng tính năng hiện tại của từng sản phẩm.)
- 1.3 Cơ sở lý thuyết xử lý tiếng nói
  - 1.3.1 Nhận dạng tiếng nói (ASR): transducer, Zipformer, FastConformer/Parakeet, Whisper; WER/CER.
  - 1.3.2 Phát hiện hoạt động giọng nói (VAD) và phân lượt (turn-taking).
  - 1.3.3 Nhận diện ngôn ngữ (LID) và nhận diện người nói (speaker embedding).
  - 1.3.4 Tổng hợp tiếng nói (TTS): Kokoro, VieNeu; MOS, TTFA.
  - 1.3.5 Dịch máy bằng LLM: DeepSeek (hiện tại; Gemini giai đoạn đầu), prompt có ngữ cảnh/glossary,
    bước hậu biên tập; chrF, COMET/CometKiwi, MQM, LLM-as-judge.
- 1.4 Truyền thông thời gian thực: WebSocket, WebRTC, ICE/TURN, mô hình SFU vs MCU vs mesh; Cloudflare Realtime.
- 1.5 Công nghệ phát triển: Turborepo/pnpm monorepo, NestJS, Next.js, PostgreSQL + Prisma, Redis,
  Docker, Chrome MV3, Expo; sherpa-onnx cho sidecar giọng nói.
- 1.6 Kết chương.
- Nguồn: `docs/development-journey.md` §3.1–3.3, `docs/architecture/ai-providers.md`,
  `docs/architecture/video-network-path.md`, `docs/project-overview-pdr.md` (Tech Decisions).

### Chương 2. Phân tích và thiết kế hệ thống (20 tr)

- 2.1 Phân tích yêu cầu
  - 2.1.1 Tác nhân: Khách, Người dùng, Chủ phòng họp, Thành viên/Quản trị nhóm, Hệ thống AI (dịch vụ ngoài).
  - 2.1.2 Yêu cầu chức năng (bảng).
  - 2.1.3 Yêu cầu phi chức năng: độ trễ < 2 s, hội thoại 10 phút không rớt, ≥ 70% độ chính xác dịch,
    bảo mật, đa ngôn ngữ giao diện (vi/en), khả năng truy cập.
- 2.2 Biểu đồ use case tổng quát + chi tiết cho: Dịch hội thoại, Tham gia họp video, Quản lý lịch sử,
  Quản lý AI Context/glossary, Quản lý nhóm.
- 2.3 Kịch bản chuẩn và ngoại lệ (bảng) cho 4–5 use case chính.
- 2.4 Thiết kế kiến trúc
  - 2.4.1 Kiến trúc tổng thể: apps (api, web, extension, mobile), packages, sidecar STT/TTS, dịch vụ ngoài.
  - 2.4.2 Nguyên tắc: interface-first, hợp đồng zod dùng chung, phong bì `ApiResponse<T>`.
  - 2.4.3 Đường dữ liệu một lượt dịch (`/ws/translate`).
  - 2.4.4 Đường media họp video qua SFU và đường âm thanh dịch.
- 2.5 Biểu đồ tuần tự: một lượt dịch streaming; vào phòng họp; đăng nhập + làm mới token.
- 2.6 Thiết kế cơ sở dữ liệu: ERD + bảng mô tả các thực thể chính (User, Conversation, ConversationTurn,
  MeetingMinutes, TranslationContext, GlossaryTerm, 4 bảng Conference*, Team*, ledger credits).
- 2.7 Thiết kế API: danh sách endpoint REST chính, sự kiện WebSocket, mã lỗi.
- 2.8 Bảo mật: JWT, refresh token xoay vòng trên Redis, xác thực email, Google OAuth.
- 2.9 Kết chương.
- Nguồn: `docs/system-architecture.md`, `docs/architecture/data-flow.md`, `.../authentication.md`,
  `.../contracts-and-languages.md`, `.../video-network-path.md`, `.../video-translation-audio-path.md`,
  `docs/database-schema-conference.md`, `apps/api/prisma/schema.prisma`.

### Chương 3. Kỹ thuật dịch thoại thời gian thực và thực nghiệm (18 tr) — chương điểm nhấn

- 3.1 Phương pháp thực nghiệm: môi trường đo (i7-11700K 8 nhân, CPU), bộ dữ liệu, chỉ số, nguyên tắc
  "đo trên phần cứng đích, đo lại sau khi sửa".
- 3.2 Lựa chọn mô hình STT: bảng WER/độ trễ các ứng viên; kết luận Zipformer (vi), Parakeet (en);
  bộ giải mã và context biasing.
- 3.3 Lựa chọn và tối ưu TTS: Kokoro (en), VieNeu vs ZeroTTS (vi), streaming TTS, TTFA; MOS.
- 3.4 Hiển thị văn bản: ITN tiếng Việt và khôi phục dấu câu/viết hoa.
- 3.5 Luồng hội thoại thời gian thực: VAD, phân lượt, commit streaming, head-start, tổng hợp theo mệnh đề.
  Bảng trước/sau: p50 1663 → 907 ms, p95 1976 → 1582 ms, STT vi 1117 → 84 ms.
- 3.6 Nhận diện ngôn ngữ cho hội thoại hai chiều: nhãn ngôn ngữ ở 3,3 s p95 (ngưỡng 3,5 s).
- 3.7 Nhận diện người nói theo lượt: ngưỡng 0.50/0.45, cổng im lặng 300 ms.
- 3.8 Dịch máy: chọn model Gemini theo hạn mức, ngữ cảnh hội thoại, glossary, tiếng Trung; đánh giá bằng
  chrF/CometKiwi/LLM-judge.
- 3.9 Dịch trong họp video: tải nhiều người nói, giới hạn lượt; biên bản họp và chống prompt injection.
- 3.10 Bài học phương pháp luận (chọn 4–5 ý từ journey §8).
- 3.11 Kết chương.
- Nguồn: `benchmarks/{stt,tts,tts-vi,mos,punct,latency,realtime,lid,speaker-id,mt-zh,translation-judge,
conversation-context,conference,minutes-quality,prompt-injection}/README.md` (+ `results/`),
  `docs/development-journey.md` §3–8 và các mục ngày 14/09–13/10.

### Chương 4. Cài đặt, giao diện và kiểm thử (12 tr)

- 4.1 Môi trường phát triển và triển khai: Docker Compose, biến môi trường, triển khai self-host từ `main`, CI.
- 4.2 Cài đặt hệ thống (các bước chính, rút gọn từ README).
- 4.3 Giao diện: landing, dịch hội thoại, lịch sử, glossary, họp video (sảnh, phòng, màn hình kết thúc),
  extension, cài đặt. Mỗi màn hình 1 ảnh + 2–3 câu.
- 4.4 Kiểm thử
  - 4.4.1 Chiến lược: unit (vitest), e2e, spec thiết kế (accent budget, contrast), kiểm thử trên trình duyệt thật.
  - 4.4.2 Kết quả (bảng số test pass, gate CI).
  - 4.4.3 Đối chiếu tiêu chí thành công MVP (bảng: tiêu chí — kết quả — đạt/chưa).
- 4.5 Kết chương.
- Nguồn: `docs/deployment-guide.md`, `docs/code-standards.md`, `docs/development-journey.md` §7,
  `plans/reports/ui-ux-redesign-261109-after/shots/`.

### Kết luận (2 tr)

- Kết quả đạt được (đối chiếu mục tiêu ở Mở đầu).
- Hạn chế: dịch máy còn gọi cloud; giấy phép NC-ND của mô hình STT tiếng Việt cản thương mại; chưa
  nhận diện tiếng Trung; chạy hai mạng và tải nhiều người nói chưa đo xong; mobile chưa phát hành.
- Hướng phát triển: mobile, LID 3 ngôn ngữ, MT chạy local, thêm ngôn ngữ qua registry, bán công khai.
- Nguồn: `docs/project-roadmap.md`, `docs/technical-risks-mitigation.md`.

### Tài liệu tham khảo (gợi ý, nhóm kiểm chứng từng mục trước khi đưa vào)

- Radford et al., _Robust Speech Recognition via Large-Scale Weak Supervision_ (Whisper), ICML 2023.
- Yao et al., _Zipformer: A faster and better encoder for automatic speech recognition_, ICLR 2024.
- Rekesh et al., _Fast Conformer with Linearly Scalable Attention for Efficient Speech Recognition_, ASRU 2023.
- Le et al., _PhoWhisper: Automatic Speech Recognition for Vietnamese_, 2024.
- Graves, _Sequence Transduction with Recurrent Neural Networks_ (RNN-T), 2012.
- Wang et al., _CAM++: A Fast and Efficient Network for Speaker Verification_, Interspeech 2023 (arXiv:2303.00332).
- Gao et al., _Paraformer_, Interspeech 2022.
- Lommel et al., _Multidimensional Quality Metrics (MQM)_, 2014.
- Popović, _chrF: character n-gram F-score for automatic MT evaluation_, WMT 2015.
- Rei et al., _COMET_ (EMNLP 2020) và _CometKiwi_ (WMT 2022).
- Zheng et al., _Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena_, NeurIPS 2023.
- ITU-T P.800 (MOS).
- RFC 8825 (WebRTC overview), RFC 8445 (ICE), RFC 6455 (WebSocket).
- Tài liệu chính thức: NestJS, Next.js, Prisma, Cloudflare Realtime, Chrome Extensions MV3, sherpa-onnx, Gemini API.

## 5. Phân công nội dung theo đóng góp (đề xuất từ git log, cần nhóm xác nhận)

Thống kê file theo thư mục từ `git log` cho thấy:

- **Nguyễn Mạc Quang Anh**: api, pipeline AI (`packages/ai-providers`, `realtime-client`), extension,
  LID, speaker-id, MT tiếng Trung, mobile, phần lớn web.
- **Nguyễn Việt Tú**: thiết kế lại UI/UX web (landing, dịch, họp, lịch sử, glossary), i18n,
  một phần mobile và api, benchmark video và MOS, tham gia QR join, menu phụ đề trong họp.

Báo cáo nhóm của PTIT thường có bảng phân công ở Mở đầu. Nhóm tự điền bảng này; Claude không suy diễn
mức đóng góp từ số commit.

## 6. Thứ tự viết đề xuất

1. Chương 3 (có số liệu sẵn, dễ viết nhất, quyết định chất lượng báo cáo).
2. Chương 2 (kèm sơ đồ: use case, kiến trúc, tuần tự, ERD — vẽ bằng Mermaid, xuất PNG).
3. Chương 1.
4. Chương 4 (cần ảnh chụp màn hình).
5. Mở đầu, Kết luận, Lời cảm ơn, danh mục — viết cuối.

File đầu ra: mỗi chương một file trong thư mục này (`00-phan-dau.md`, `01-chuong-1.md`, …), để chuyển
sang `.docx` từng phần.

## 7. Quyết định đã chốt (18/11/2026)

- Lớp: D22CNPM02 (cả hai).
- Ảnh chụp màn hình: Claude tự chụp từ bản chạy local khi viết Chương 4.
- Đóng góp: theo mục 2b.

## 7b. Tiến độ

| Phần                                   | File                          | Trạng thái                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bìa, lời cảm ơn, nhận xét, từ viết tắt | `00a-phan-dau.md`             | Bản nháp 1 (19/11/2026)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mở đầu                                 | `00b-mo-dau.md`               | Bản nháp 1 — thiếu bảng phân công (nhóm điền)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Chương 1                               | `01-chuong-1.md`              | Bản nháp 1 — mục 1.2.7 thiếu số liệu bối cảnh có nguồn                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Chương 2                               | `02-chuong-2.md`              | Bản nháp 1 — 11 sơ đồ PNG trong `hinh/`: bốn biểu đồ use case (Hình 2.1–2.4) vẽ theo ký pháp UML bằng `node cong-cu/ve-use-case-uml.mjs <chrome.exe>`, bảy sơ đồ còn lại từ file `.mmd`                                                                                                                                                                                                                                                                                     |
| Chương 3                               | `03-chuong-3.md`              | Bản nháp 1 — Hình 3.1 đã vẽ                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Chương 4                               | `04-chuong-4.md`              | Bản nháp 1 — 9/13 ảnh đã chụp trong `anh/`; thiếu 4.5, 4.6, 4.10, 4.11 (cần tiếng nói thật hoặc tiện ích)                                                                                                                                                                                                                                                                                                                                                                   |
| Kết luận                               | `05-ket-luan.md`              | Bản nháp 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Tài liệu tham khảo                     | `06-tai-lieu-tham-khao.md`    | 31 mục, IEEE; nhóm kiểm lại các mục đánh dấu (*)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Bản ghép                               | `bao-cao-do-an-tot-nghiep.md` | Ghép 19/11/2026 từ 8 file trên theo thứ tự; sửa ở file phần rồi ghép lại                                                                                                                                                                                                                                                                                                                                                                                                    |
| Bản Word                               | `BCĐATN.docx`                 | 92 trang, số trang Ả Rập liên tục (bìa không số, lời cảm ơn là trang 1, MỞ ĐẦU trang 13); đoạn văn lùi đầu dòng 1 cm. Dựng lại: `node cong-cu/md-sang-word-html.mjs bao-cao-do-an-tot-nghiep.md <tạm>.html` rồi `cong-cu/word-hoan-thien-docx.ps1 -Html <tạm>.html -Docx <đích>.docx` (cần Word trên Windows). Trang bìa lấy từ `cong-cu/trang-bia.docx` (mẫu FINGENIUS, tạo lại bằng `cong-cu/tao-trang-bia.ps1`); đầu trang "ĐỒ ÁN TỐT NGHIỆP" có đường kẻ, trừ trang bìa |

Tự review (19/11/2026): đánh số bảng, hình liền mạch; tham chiếu chéo đều trỏ tới mục có thật; mọi số liệu đối chiếu
với `docs/development-journey.md`, `benchmarks/*/README.md`, mã nguồn và log CI run 43833150235. Ước tính 67–72 trang
phần thân kể cả hình.

Điều chỉnh sau khi đọc nguồn: dịch máy hiện chạy DeepSeek (Gemini chỉ giai đoạn đầu); STT tiếng Anh là
Parakeet (thay Moonshine từ 25/09/2026); Chương 3 bỏ mục "biên bản họp" riêng vì đã đủ 18 trang.

## 8. Câu hỏi còn mở

1. **Bảng phân công** ở mục 5 — nhóm điền sau.
2. **GV phản biện**: có cần trang nhận xét thứ hai như mẫu không? (mặc định: có).
3. **3 hay 4 chương**: mặc định 4 theo mẫu nha khoa; đổi sang 3 nếu GVHD muốn.
