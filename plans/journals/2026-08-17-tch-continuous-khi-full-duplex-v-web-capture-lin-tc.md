---
title: 'Tách continuous khỏi full-duplex, và web capture liên tục'
date: 2026-08-17
summary: 'Phase 1+2: gỡ ba quan tâm dính nhau trong CapturePump, web chạy continuous capture; ba defect im lặng bị bắt bởi review'
---

# Tách continuous khỏi full-duplex, và web capture liên tục

## Bối cảnh

User: cascade không realtime thật — nhận hết câu rồi mới phát, phát thì chặn mic.
Muốn mượt như luồng Gemini Live.

Bằng chứng đã có sẵn trong repo lại nói ngược với chẩn đoán cũ (§6.1 "đứt quãng là
bài toán giao diện"): `benchmarks/live-translate/results/2026-08-07T10-27-54-064Z/`
n=100/nhánh cho thấy ở băng 7–10s cascade +2753/+3012 ms còn live **−4100/−4402 ms**
— tức live nói xong bản dịch trước khi người ta dứt lời. Khoảng cách giãn theo độ dài
câu, đúng hình dạng mà kiến trúc theo-lượt bắt buộc phải có. Tôi đã trích nhầm §7
(p50 907 ms) và kết luận cascade nhanh hơn; hai đại lượng khác nhau.

"Streaming thật từ model" thì không tồn tại để bật: TTS callback của sherpa-onnx chỉ
cắt ở ranh giới câu (0 ms tiết kiệm cho lượt 1 câu), MT đã stream sẵn và trả 1 chunk,
và sherpa-onnx **không có** model streaming tiếng Việt. Đòn bẩy nằm ở **đơn vị
commit**, không ở streaming.

## Đã làm

Phase 1 — `continuous`, `fullDuplex`, đếm vọng âm từng dính chung một biến state.
Phase 2 — web chạy continuous, maxInFlight 3, transcript turn-keyed.

## Ba defect im lặng, mỗi cái đều pass mọi cổng

1. **Nối nhầm tín hiệu (suýt).** `onPlaybackBusy` mang `isBusy` = true từ lúc turn
   _mở_ (lúc người ta bắt đầu nói), không phải lúc loa kêu. Nuôi vào cổng mic thì
   mic tắt gần như vĩnh viễn ở maxInFlight 3 — và **pass mọi test trong phòng yên
   tĩnh**. Extension đã ghi lại đúng cái bẫy này ở `sounding-sink.ts`.
2. **Turn leak do chính tôi tạo ra.** Mute giữa câu làm nhánh drop tới được khi
   `state === 'in-turn'`, mà `gate.reset()` không phát sự kiện nào ⇒ turn cũ không
   bao giờ đóng, giữ slot in-flight, audio không bao giờ được dịch. Không thể xảy ra
   trước đó vì `awaiting-result` và `in-turn` loại trừ nhau.
3. **Bộ đếm vọng âm bão hoà ở 1.** Gate chỉ được nuôi trong cửa sổ playback và không
   bao giờ reset giữa hai cửa sổ ⇒ 4 cửa sổ có vọng âm rõ ràng báo về **1**. Cổng
   cấp phép pass ở 0/20, nên máy vọng âm mọi lượt sẽ đọc thành gần-như-sạch — con số
   **fail về phía không an toàn**.

## Bài học

- Tín hiệu cảnh báo tôi viết trong plan ("thấy dòng gemma trong JSONL") **không quan
  sát được**: §6.4 đã bỏ gemma khỏi cả hai ladder live, và dòng metrics không có
  trường model. Viết tín hiệu giám sát mà không kiểm nó có tồn tại hay không là cách
  tạo ra cảm giác an toàn giả.
- `maxInFlight` **không** giảm req/phút — request = lượt × (final + live + speculation).
  Hạ nó chỉ từ chối lượt, mà lượt bị từ chối rơi vào chính con số coverage của luận
  văn. Key pool nhiều project mới là đòn bẩy đúng.
- Test không đỏ được trên code cũ thì không chứng minh gì. Mỗi defect trên đều được
  khôi phục tạm để xác nhận test đỏ trước khi giữ lại.
- `ak plan check` tick **toàn bộ** tiêu chí, kể cả cái tôi chưa xác minh (grep bundle
  — hook `scout-block` chặn `.next`). Đã bỏ tick lại. Plan là hồ sơ, không phải bảng
  điểm.

## Còn nợ

- Kiểm chứng trình duyệt: repo **không commit** harness Playwright nào; §6.7 chạy ad
  hoc. Cần Postgres + hai sidecar Python kèm model.
- req/phút mỗi model và `quotaFailures` trong phiên 5 phút — gộp vào lúc thu JSONL
  cho histogram Phase 3.
- Phase 3 quyết định A-lite bằng **số giây chờ cắt được mỗi lượt**, không phải đếm
  đầu lượt qua vạch 5s (ngưỡng cũ là số đặt tạm).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
