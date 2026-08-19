---
title: 'Web continuous capture and the measurements that decide clause-commit'
description: 'Gỡ rào chặn mic trên web cho đúng và an toàn, rồi chạy ba phép đo quyết định có làm cắt-theo-mệnh-đề hay không.'
status: done
priority: P1
effort: '3-5d'
tags: [realtime, cascade, measurement, web]
created: 2026-08-17
---

# Web continuous capture and the measurements that decide clause-commit

## Overview

Cascade hiện phát audio **sau** khi dứt lời, và trên web thì mic bị chặn trong lúc
phát. Phép đo head-to-head đã có trong repo cho thấy khoảng cách với Gemini Live
**giãn theo độ dài câu**: ở băng 7–10 s, cascade +2753 ms (vi→en) / +3012 ms
(en→vi) trong khi live **−4100 / −4402 ms** — tức live nói xong bản dịch trước cả
khi người nói dứt lời.

Kế hoạch này **không** đóng khoảng cách đó. Nó làm hai việc rẻ hơn và phải làm
trước: (1) gỡ rào chặn mic trên web cho đúng — hiện `continuous: true` một mình đã
bỏ mute **và** vô hiệu hoá máy đếm vọng âm, đi vòng qua rào production; (2) chạy ba
phép đo quyết định xem cắt-theo-mệnh-đề (A-lite) có đáng làm không, thay vì commit
vào nó bằng ngưỡng đặt tạm.

Nguồn: `docs/development-journey.md` §6, §9, §10 ·
`benchmarks/live-translate/results/2026-08-07T10-27-54-064Z/latency-table.txt`.

## Goals

| #   | Goal                                                             | Priority |
| --- | ---------------------------------------------------------------- | -------- |
| 1   | `continuous` / `fullDuplex` / đếm vọng âm tách hẳn nhau, có test | P1       |
| 2   | Rào production do phép đo cấp phép, không do `NODE_ENV`          | P1       |
| 3   | Web chạy capture liên tục, mic không chết giữa hội thoại         | P1       |
| 4   | Ba phép đo hoàn tất, có số, quyết định A-lite dựa trên số        | P1       |
| 5   | Không hồi quy băng 3–5 s và không tăng req/phút mỗi model        | P2       |

## Phases

| #   | Phase                                                                          | Status                           |
| --- | ------------------------------------------------------------------------------ | -------------------------------- |
| 1   | [Phase 1: Tách continuous, fullDuplex và đếm vọng âm](./phase-01-start.md)     | Done                             |
| 2   | [Phase 2: Web continuous capture](./phase-02-web-continuous-capture.md)        | Done                             |
| 3   | [Phase 3: Ba phép đo và cổng quyết định](./phase-03-the-three-measurements.md) | Done — trừ (b) và cổng, xem dưới |

Phase 2 phụ thuộc Phase 1 (không có Phase 1 thì bật continuous trên web là bỏ rào
an toàn). Phase 3 phụ thuộc Phase 2 (phép đo echo và histogram cần capture liên tục
đang chạy).

## Non-goals

Ghi rõ để không trượt phạm vi. Mỗi mục đều có lý do, không phải "để sau":

- **A-lite / cắt theo mệnh đề** — chỉ mở lại sau cổng quyết định ở Phase 3.
- **MT local** — trần quota giải bằng key pool nhiều project (đã hỗ trợ tách key ở
  `live-translate-session.service.ts`); MT local còn tranh core với STT+TTS trên
  chính máy demo và làm hỏng các số khác. Cũng là non-goal đã ghi ở §4.1.
- **Streaming STT** — sherpa-onnx không có model streaming tiếng Việt trong zoo
  online-transducer. Không có gì để bật.
- **AEC thật** (adaptive filter + double-talk detection) — đề tài DSP riêng.
- **Server rolling session** — trùng `live-session.ts`.
- **Bộ điều khiển tốc độ TTS** — VieNeu không có `speed`; trần lag + drop là đủ.

## Ràng buộc đo lường (bắt buộc)

- **Ghim SHA** của nhánh cascade trong `benchmarks/live-translate/results/2026-08-07T10-27-54-064Z/`
  vào luận văn. Nhánh cascade được đo _xuyên qua_ đúng những file kế hoạch này sửa
  (`capture-pump.ts`, `turn-pipeline.ts`, `translation-session.service.ts`), nên
  **không bao giờ chạy lại một nhánh trên code đã đổi** rồi so với nhánh kia.
- **Băng 3–5 s phải giữ nguyên** so với bộ số 2026-08-07.
- **req/phút mỗi model** không cao hơn hiện tại. Lưu ý: "rơi xuống gemma" **không
  phải** tín hiệu quan sát được — §6.4 đã bỏ gemma khỏi cả hai ladder của đường live,
  và dòng JSONL server không có trường model. Tín hiệu thật là **429 bị nuốt** (hôm
  nay không log) và **dòng `completed === false`**; xem Phase 2.
- Số đã biết cần ghi chú: `en_to_vi cascade max = 31106 ms` nằm trong chính bộ số đã
  ghi — cần một dòng giải thích trước khi hội đồng tìm ra.
- `data/manifest.json` ghi `referenceProvenance.post_edited: false` — mọi tuyên bố
  adequacy phải công bố đây là **pseudo-reference chưa post-edit**.

## Success Criteria

- [x] `continuous: true` không còn ngầm bỏ mute; `fullDuplex` là công tắc duy nhất
      quyết định có nghe xuyên playback, có test chứng minh (xoá tách biệt → test đỏ)
- [x] Đếm vọng âm chạy được ở **cả hai** chế độ, kể cả continuous
- [x] ~~Rào production đọc cờ do phép đo cấp phép~~ — `NODE_ENV` đã hết là rào, và
      **cờ thay nó cũng đã bỏ (19/08)**: kiểm chứng trên MacBook demo cấp phép
      thẳng, `fullDuplex: true` trong hook. Cái đứng thay cho rào là bộ đếm
      `echoHeard` hiện trên màn hình ngay khi khác 0
- [x] Web: capture không dừng giữa hội thoại; transcript không lẫn giữa các lượt
      chạy song song
- [x] ~~Phép đo echo: 40 lượt~~ — đóng bằng kiểm chứng một thiết bị thay vì quy
      trình 40 lượt. Journey §10 mục 1 ghi rõ phạm vi: một máy, không có nhánh đối
      chứng, không ghi n. Quy trình 40 lượt còn nguyên ở `benchmarks/realtime/README.md`
      cho thiết bị chưa kiểm
- [ ] Histogram độ dài lượt thật từ JSONL — **dụng cụ xong, số chưa có**: cần một
      phiên hội thoại thật (`TURN_METRICS_PATH` trên api là công tắc duy nhất còn lại)
- [x] Thí nghiệm adequacy: bảng segment-có-ngữ-cảnh vs cả-câu, báo cáo **khoảng** giữa
      nhát cắt lạc quan và bi quan — **−1,22 … −3,46 chrF++**, journey §10 mục 1b
- [ ] Cổng quyết định A-lite — **mở có chủ ý**: thiếu đúng đầu vào (b), và không đoán
      thay bằng con số đặt tạm. Ba lựa chọn giữ nguyên (A-lite / A-lite-zero / dừng)

## Open questions

0. **Đã trả lời (19/08):** rào full-duplex nên là cờ hay là kiểm chứng thiết bị?
   → Kiểm chứng thiết bị. Cờ build không biết gì về phòng, còn một cờ mặc định false
   thì chỉ đảm bảo tính năng không bao giờ được bật. Bộ đếm vọng âm trên màn hình
   làm được việc mà cờ định làm, và làm lúc nó có nghĩa.
1. Ngưỡng cổng 5 s là số đặt tạm. Phase 3(b) **thay nó bằng `t_commit` suy ra từ
   histogram**, và quyết định bằng số giây chờ cắt được mỗi lượt chứ không bằng vạch
   5 s.
   1b. Trần `maxUtteranceMs` cho web chưa chốt (Phase 2 bước 6) và nó right-censor
   chính histogram ở Phase 3(b) — hai việc này ràng buộc nhau.
2. Chưa đo RTF VieNeu/Kokoro ở segment ~3 s dưới tải continuous.
3. Trượt phép đo echo trên rig i7 + loa rời là **không kết luận được gì** (§10.1 tự
   đặt luật này) — không được viết thành "đóng hướng full-duplex".

<!-- slug: web-continuous-capture-and-the-measurements-that-decide-clause-commit -->
