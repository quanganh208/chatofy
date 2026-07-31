# Brainstorm — Extension dịch realtime, thu âm liên tục

Ngày: 2026-07-29 · Branch: `main` · Trạng thái: contract đã chốt, chờ lập plan

## Câu hỏi gốc

Chức năng dịch realtime hiện dừng thu âm để phát ra loa. Có bỏ được việc dừng đó
không, để làm extension dịch voice trực tiếp trên Google Meet / Zoom web /
Messenger call?

## Trả lời: có — trong extension thì dễ hơn trên điện thoại

Half-duplex hôm nay là ràng buộc **âm học**, không phải kiến trúc:
`apps/web/src/audio/capture-pump.ts:26-37` — hai người chung một điện thoại, loa
nuôi mic, app tự dịch chính nó. Cờ `fullDuplex` đã tồn tại
(`capture-pump.ts:104`), mặc định tắt, rào khỏi bundle production tại
`apps/web/src/hooks/use-streaming-translate.ts:19` vì phép đo AEC chưa từng chạy
(`docs/development-journey.md` §10.1).

Trong extension đường vòng đó biến mất **theo cấu trúc**, không cần đo AEC:

- nguồn vào = audio của tab (`chrome.tabCapture`), tức giọng người bên kia — mic
  không tham gia;
- TTS phát ở offscreen document, không nằm trong đồ thị audio của tab bị capture;
- không có đường nào để tiếng dịch quay lại đầu vào.

Phép đo AEC còn nợ ở §10.1 vẫn cần cho **mobile**, không cần cho extension.

## Chốt chặn thật không phải cờ `fullDuplex`

Pipeline đang tuần tự hoá theo lượt. Mở `fullDuplex` mà không đụng bốn chỗ dưới
đây thì extension thu liên tục rồi vứt phần lớn nội dung.

| Chốt chặn                                          | Vị trí                                                    | Hệ quả trong cuộc họp                            |
| -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| 1 turn / 1 socket                                  | `session-registry.ts:17` `Map<StreamSocket, TurnSession>` | Lượt N+1 không mở được khi N đang dịch           |
| Guard `session_busy`                               | `translation-session.service.ts:60-67`                    | Server từ chối thẳng                             |
| Re-arm chờ **cả** server-end **và** playback drain | `conversation-session.ts:256-263`                         | Client tự câm trong lúc phát                     |
| Kết lượt = 500ms im lặng                           | `speech-gate.ts:29`                                       | Nói 30s không nghỉ → không có endpoint           |
| `MAX_TURN_SECONDS = 60`                            | `turn-audio.ts:12`                                        | Chạm trần thì đóng lượt + báo lỗi, không cắt mềm |

**Phát hiện đáng giá:** `SessionRegistry` khoá theo _object socket_, nên mở 2–3
WebSocket song song cho ra 2–3 lượt đồng thời **không sửa một dòng server nào**.
Đường rẻ nhất tới pipelining.

## Contract

**Outcome.** Extension Chrome MV3 dịch một chiều realtime giọng người khác trên
web call (Meet / Zoom web / Messenger). Thu âm **không bao giờ dừng**. Người dùng
nghe bản dịch tiếng Việt trong tai nghe, tiếng gốc bị duck. Nói liên tục không
mất câu nào.

**Constraints.**

- **Là một chức năng của đồ án**, không phải mở rộng sau bảo vệ. Phải demo được
  và phải có số đo bảo vệ được trước hội đồng. Kéo theo hai hệ quả ở §Rủi ro:
  kênh metrics client chuyển từ nợ kỹ thuật thành hạng mục chặn, và quota trở
  thành rủi ro của chính buổi demo.
- Chiều vào trước; chiều ra (chèn giọng dịch vào mic) để sau, thiết kế chừa chỗ.
- Không được mất câu → bắt buộc pipeline đồng thời, không phải tuần tự.
- Giữ free tier Gemini, giữ nguyên live partial + speculate như hiện tại.
- Không đụng hành vi mobile/web hiện có: mọi knob mới mặc định giữ nguyên số cũ.
- Ràng buộc thư viện dùng chung: core audio/conversation hiện nằm trong
  `apps/web/src`, chưa phải package.

**Non-goals.**

- Chèn giọng dịch vào luồng mic gửi đi (patch `getUserMedia` ở MAIN world).
- Zoom desktop app — extension không capture được; chỉ Zoom web.
- Diarization / tách nhiều người nói.
- Ngôn ngữ ngoài vi↔en. Firefox / Safari. Đo AEC âm học.
- Dịch máy local (giữ Gemini).

**Acceptance criteria.**

1. 3 phút audio Meet liên tục: tổng thời lượng block đã gửi ≥ 95% thời lượng có
   speech. Không khoảng nào capture bị tắt.
2. Đoạn nói 60s không nghỉ quá 500ms: 0 lượt `session_busy`, 0 lượt chạm
   `MAX_TURN_SECONDS`.
3. Thứ tự phát khớp thứ tự nói, kể cả khi lượt sau dịch xong trước lượt trước —
   chứng minh bằng replay test offline, không bằng nghe thủ công.
4. Tiếng gốc giảm khi bản dịch phát, trả lại khi im.
5. Đo được req/phút thực tế trong 3 phút họp, đối chiếu trần 15/phút/model.
6. `apps/web` và `apps/mobile` không đổi hành vi: test hiện có xanh nguyên.
7. **Độ trôi tích luỹ** đo được: bản dịch tụt sau người nói bao nhiêu giây sau 1
   / 3 / 5 phút nói liên tục. Đây là số headline của chức năng này trong luận
   văn — p50/p95 của mobile không mô tả được chế độ liên tục.

## Hướng đã chọn

Pipeline đồng thời qua **socket pool N=3**, không sửa server.

Hạng mục:

1. **Tách package** — `speech-gate` · `capture-pump` · `pcm-resampler` ·
   `pcm-playback-queue` · `translate-socket` · `conversation-state` từ
   `apps/web/src` sang package dùng chung. Không đổi hành vi, test đi theo.
   Khớp nguyên tắc #3 trong PDR.
2. **Cắt lượt cưỡng bức** — `SpeechGate` thêm trần độ dài utterance (~8s), cắt
   tại block RMS thấp nhất trong ~500ms cuối. Mặc định tắt / đặt cao để mobile
   không đổi hành vi.
3. **Đồng thời** — `ConversationSession` hiện giữ một `sessionId` + `turnEnded`
   toàn cục; tách thành object per-turn, socket pool N=3.
4. **Playback xếp theo thứ tự nói** — lượt ngắn về sau có thể xong trước lượt dài
   về trước. Cần buffer per-turn + giải phóng đúng thứ tự. **Rủi ro cao nhất.**
5. **Chính sách trôi** — bản dịch tụt sau người nói; khi hàng đợi vượt ngưỡng thì
   bỏ lượt cũ hay phát nhanh 1,15x. Quyết ở phase sau, cần số đo.
6. **Ducking** — GainNode trên tiếng gốc. `tabCapture` vốn tắt tiếng tab và buộc
   offscreen doc phát lại, nên điểm duck có sẵn miễn phí.
7. **Đóng gói** — `apps/extension`: manifest MV3, offscreen document
   (`USER_MEDIA` + `AUDIO_PLAYBACK`), quyền `tabCapture`/`offscreen`/host, build
   trong turbo.

Luồng runtime: content script (UI overlay) → service worker
(`getMediaStreamId`) → offscreen doc (`getUserMedia` chromeMediaSource tab →
AudioWorklet → `CapturePump(fullDuplex: true)` → socket pool → playback + duck).

### Phương án đã cân nhắc và loại

- **Giữ tuần tự, chấp nhận bỏ sót** — gần như không sửa gì, nhưng mất nội dung
  trong họp thật. Người dùng đã loại.
- **Registry khoá theo `sessionId`** — sạch hơn socket pool nhưng sửa server
  (`session-registry`, `translation-session.service`, cả hai spec). Để dành nếu
  socket pool lộ giới hạn.
- **TTS tăng dần từ partial (đồng thời thật)** — mâu thuẫn quyết định đã có:
  "a guess spoken aloud cannot be taken back" (`live-preview.ts:90-97`). Non-goal.

## Rủi ro

- **Quota.** Lượt dài 8s làm `LiveTranslationTrigger` (ngưỡng ≥3s,
  `live-translation-trigger.ts:23`) bắn mỗi lượt, khác hẳn hội thoại demo lượt
  2–3s. Ước tính ~4–5 req/lượt × ~7,5 lượt/phút ≈ 30–37 req/phút so với trần
  30/phút (15 × 2 model). Ngày: ~1000 req nhanh ≈ **25–35 phút họp**. Hết quota
  thì lượt **fail hẳn** vì `FINAL_MODELS` cố ý không có model chậm
  (`translation-model-policy.ts:39`, lý do ghi ở dòng 20-26). Người dùng đã chấp
  nhận giữ free tier; tiêu chí #5 biến con số này thành dữ liệu đo được.
- **Playback đúng thứ tự là đúng lớp lỗi đã thoát ra `main` hai lần** — test dựng
  chuỗi sự kiện production không tạo ra được, mọi cổng vẫn xanh
  (`development-journey.md` §6.3). Bắt buộc replay test với fixture nhiều người
  nói, dùng lại `benchmarks/realtime/generate-fixtures.mjs`.
- **Oversubscription ONNX** — 3 lượt đồng thời = 3 inference song song trên
  sidecar STT/TTS CPU. Đã nợ đo ở §10.4.
- **Kênh metrics client giờ là hạng mục chặn, không còn là nợ.**
  `development-journey.md` §10.2 ghi nhận chưa có kênh metrics phía client;
  `TurnMetricsRecorder` là server-side và mọi trường tính từ endpoint, nên nó
  **không thấy được** coverage (#1) lẫn độ trôi (#7) — hai số headline của chức
  năng này. Ở chế độ mobile ba chỉ tiêu giao diện còn lấy mẫu DOM thủ công được;
  ở đây không, vì phải đo suốt nhiều phút liên tục. Phải làm kênh metrics client
  trước khi đo, nếu không luận văn không có số nào cho extension.
- **Quota là rủi ro của buổi demo, không chỉ của sản phẩm.** ~25–35 phút họp/ngày
  và các buổi chạy thử **cùng ngày** ăn chung hạn mức đó; hết thì lượt fail hẳn
  chứ không chậm. Cần đếm request còn lại và giữ dự trữ cho lượt demo thật.
- **Bề mặt site** — Meet/Messenger web ổn; Zoom desktop không capture được.
- **Đồng thuận ghi âm.** Extension thu giọng người khác trong cuộc họp. Hội đồng
  nhiều khả năng hỏi; cần một đoạn trả lời sẵn trong luận văn, và nếu có ý định
  publish lên Chrome Web Store thì còn là ràng buộc chính sách.

## Doc phải sửa

- `docs/project-overview-pdr.md` — mục _Out of MVP (Descoped)_ đang liệt kê
  "Browser extension". Không còn đúng.

## Câu hỏi chưa giải quyết

1. Cắt lượt cưỡng bức ở 8s hay để tự hiệu chỉnh theo độ trôi? Chưa có số đo trên
   giọng người thật để chọn.
2. Khi bản dịch tụt quá xa: bỏ lượt cũ hay phát nhanh 1,15x? Cần đo cảm nhận.
3. Package tách ra đặt tên gì — `@chatofy/realtime-client` hay tách đôi
   audio/conversation?
4. ~~Extension có nằm trong phạm vi luận văn?~~ **Đã chốt: có, là một chức năng
   của đồ án.** Kéo theo: hạng mục 5 hạ xuống "đo và ghi nhận", kênh metrics
   client thành hạng mục chặn, PDR phải sửa.
5. Overlay UI hiển thị transcript trong trang, hay chỉ popup extension?
6. Demo trước hội đồng chạy trên cuộc họp thật hay trên bản ghi phát lại? Bản ghi
   khử được rủi ro mạng và rủi ro người nói, nhưng hội đồng có thể coi là yếu hơn.
