---
title: 'Extension continuous capture'
description: 'Chrome MV3 extension dịch một chiều realtime giọng người khác trên web call, thu âm không bao giờ dừng'
status: pending
priority: P1
effort: '3w'
tags: [extension, realtime, concurrency, metrics, mv3]
created: 2026-07-29
---

# Extension continuous capture

## Overview

Chức năng dịch realtime hiện dừng thu âm trong lúc phát bản dịch. Ràng buộc đó
là **âm học** — một điện thoại, một loa, mic nghe lại chính nó
(`apps/web/src/audio/capture-pump.ts:26-37`) — chứ không phải kiến trúc.

Extension đổi kịch bản: nguồn vào là audio của tab (`chrome.tabCapture`), TTS
phát ở offscreen document nằm ngoài đồ thị audio của tab bị capture. **Đường
vòng qua capture biến mất theo cấu trúc.** Nhưng đường vòng âm học thì không —
mic của người dùng vẫn mở và Meet/Zoom vẫn truyền nó đi, nên khi phát qua loa,
bản dịch vẫn tới tai người khác. Xem §Ràng buộc và phase 7.

Cờ `fullDuplex` không phải thứ đang chặn. Pipeline tuần tự hoá theo lượt ở năm
chỗ, nên nếu chỉ bật cờ thì extension thu liên tục rồi **vứt** phần lớn nội
dung. Plan này gỡ cả năm, thêm kênh metrics để chức năng có số bảo vệ được, rồi
mới dựng extension.

## Context links

- **Brainstorm + bằng chứng:** `plans/reports/brainstorm-260729-2232-extension-continuous-capture.md`
- **Docs tham chiếu:** `docs/system-architecture.md`, `docs/development-journey.md` (mục 6.3; mục 10 các ý 1, 2, 4 — đây là các **mục danh sách**, không phải heading, nên không tìm được bằng `§10.1`), `docs/project-overview-pdr.md`
- **Plan liên quan:** `plans/260729-1032-tts-output-voice-gender-field` — metadata ghi `pending` nhưng công việc đã merge (`3b7f876`, PR #64). Không phải blocker; nên đóng metadata.

## Quyết định đã chốt

| Câu hỏi               | Chốt                                                  | Ghi chú                                                      |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Hướng dịch            | Chiều vào trước                                       | Chiều ra (chèn mic) là non-goal, thiết kế chừa chỗ           |
| Nói liên tục          | Không được mất câu                                    | Bắt buộc pipeline đồng thời                                  |
| Quota                 | **Giữ free tier, rotate key sau**                     | Vượt trần đã biết trước, xem §Rủi ro                         |
| Cơ chế đồng thời      | Sửa server, registry khoá theo `sessionId`            | Người dùng chọn sau khi được trình bày phương án socket pool |
| Metrics               | Gửi về server, cùng sink với `TurnMetricsRecorder`    | Sink là JSONL theo `TURN_METRICS_PATH`, không phải DB        |
| UI                    | Overlay chèn vào trang, Shadow DOM                    | Popup MV3 tự đóng giữa cuộc họp                              |
| Thiết bị ra           | **Phải chạy được trên loa, không chỉ tai nghe**       | Kéo phép đo vọng âm trở lại trong phạm vi                    |
| Là gì với đồ án       | Một chức năng của đồ án                               | Phải demo được, phải có số                                   |
| Khi trôi quá xa       | **Bỏ lượt cũ nhất chưa phát**                         | Ưu tiên bám thời gian thực; mọi lần bỏ đều đếm được          |
| Thứ tự rotate key     | **Đo trước, rotate sau**                              | Chấp nhận số phase 8 có lượt fail vì quota                   |
| `apps/web /translate` | **Là hạng mục được chấm**                             | Giữ nhánh `maxInFlight: 1`, hai vòng đời tồn tại lâu dài     |
| Đồng thuận ghi âm     | **Chỉ báo đang thu trong overlay + cảnh báo lần đầu** | Thêm việc vào phase 7                                        |

## Ràng buộc: mic của người dùng vẫn mở

Extension chỉ kiểm soát được đầu vào (tab) và đầu ra (offscreen). Nó **không**
kiểm soát mic — mic thuộc về Meet/Zoom và vẫn đang truyền đi. Bộ khử vọng âm của
Meet lấy tham chiếu từ đầu ra của chính Meet trong tab; `AudioContext` của
offscreen doc là một đường ra khác và **không** nằm trong tham chiếu đó.

Hệ quả khi phát qua loa: bản dịch tiếng Việt đi ra mic người dùng và tới mọi
người trong cuộc họp, và có đường vòng bậc hai — loa của người bên kia phát nó,
mic của họ thu lại, nó quay về tab của mình và bị dịch lần nữa.

Vì người dùng yêu cầu chạy được trên loa, `onEchoHeard` (`capture-pump.ts:96-104`,
`:141-143`) **không bị bỏ** — nó được nối vào một luồng mic riêng trong offscreen
doc và trở thành một phép đo của phase 8. Đây là phần duy nhất của món nợ đo AEC
(`development-journey.md` mục 10 ý 1) quay lại trong phạm vi; việc chỉnh AEC âm
học vẫn là non-goal.

## Năm chốt chặn cần gỡ

| Chốt chặn                                   | Vị trí                                 | Gỡ ở phase |
| ------------------------------------------- | -------------------------------------- | ---------- |
| 1 turn / 1 socket                           | `session-registry.ts:17`               | 03         |
| Guard `session_busy` **lúc start**          | `translation-session.service.ts:60-67` | 03         |
| Re-arm chờ cả server-end lẫn playback drain | `conversation-session.ts:256-263`      | 05         |
| Kết lượt = 500ms im lặng                    | `speech-gate.ts:29`                    | 04         |
| `MAX_TURN_SECONDS = 60` đóng lượt kèm lỗi   | `turn-audio.ts:12`                     | 04         |

`session_busy` có **ba** nơi phát (`translation-session.service.ts:63,146` và
`turn-session.ts:94`). Chỉ nơi đầu bị gỡ; hai nơi kia là guard hợp lệ và phải giữ.

## Goals

| #   | Goal                                                                                                        | Priority |
| --- | ----------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Thu âm không bao giờ dừng; coverage ≥ 95% đo với mẫu số độc lập                                             | P1       |
| 2   | Nói liên tục 60s không nghỉ: không lượt nào bị bỏ **dưới trần hàng đợi**, không lượt nào lỗi vì tuần tự hoá | P1       |
| 3   | Thứ tự phát khớp thứ tự nói kể cả khi lượt sau dịch xong trước                                              | P1       |
| 4   | Có số coverage + độ trôi tích luỹ, đo được, ghi ra JSONL                                                    | P1       |
| 5   | Extension chạy trên Meet / Zoom web / Messenger web                                                         | P1       |
| 6   | `apps/web` không đổi hành vi người dùng                                                                     | P1       |
| 7   | Tiếng gốc duck khi bản dịch phát                                                                            | P2       |
| 8   | Đo được lượng vọng âm khi phát qua loa                                                                      | P2       |
| 9   | Overlay luôn cho thấy đang thu; popup cảnh báo lần đầu bật                                                  | P2       |

Goal 6 chỉ nói `apps/web`: `apps/mobile` không có đường WS nào
(`apps/mobile/src/audio` chỉ chứa hai file interface, cả hai nằm trong `ignore`
của `knip.json`), nên nó không có hành vi để đổi.

## Phases

| #   | Phase                                                                                                | Status        | Depends | Effort |
| --- | ---------------------------------------------------------------------------------------------------- | ------------- | ------- | ------ |
| 1   | [Shared realtime package](./phase-01-shared-realtime-package.md)                                     | Done          | —       | 1d     |
| 2   | [Concurrent turn contract](./phase-02-concurrent-turn-contract.md)                                   | Done          | 1       | 1d     |
| 3   | [Server concurrent turns](./phase-03-server-concurrent-turns.md)                                     | Done          | 2       | 1d     |
| 4   | [Continuous segmentation](./phase-04-continuous-segmentation.md)                                     | Done          | 1       | 1d     |
| 5   | [Client turn pipeline and ordered playback](./phase-05-client-turn-pipeline-and-ordered-playback.md) | Done          | 2, 3, 4 | 2d     |
| 6   | [Client metrics channel](./phase-06-client-metrics-channel.md)                                       | Done          | 2, 5    | 1d     |
| 7   | [Extension app](./phase-07-extension-app.md)                                                         | Code-complete | 5       | 4-5d   |
| 8   | [Measurement and docs](./phase-08-measurement-and-docs.md)                                           | Code-complete | 6, 7    | 1.5d   |

Phase 4 chạy song song được với 2–3 (khác file hoàn toàn). Mọi phase khác tuần tự.
Phase 7 chia đôi trong nội bộ: 7a là spike capture-và-phát-lại có cổng nghiệm thu
riêng, 7b mới nối pipeline.

**Code-complete nghĩa là gì ở đây.** Phase 7 và 8 đã viết xong mã, docs và script
phân tích; phần còn lại của cả hai cần **trình duyệt thật, loa thật và quota thật**,
nên không thể chạy trong phiên implement. Danh sách việc đó nằm ở
[`plans/reports/measure-260730-continuous-capture-runbook.md`](../reports/measure-260730-continuous-capture-runbook.md).
Cổng 7a (load unpacked, nghe lại tiếng tab, overlay tồn tại trên cả ba site) thuộc
danh sách đó.

## Success Criteria

Đánh dấu `[x]` khi đã xác minh trong phiên implement; `[ ]` khi còn chờ runbook.

- [ ] 3 phút audio họp liên tục: coverage ≥ 95%, **mẫu số lấy từ VAD offline chạy trên chính file bản ghi**, không lấy từ gate của mình — công cụ đã có (`vad-reference.mjs`, `analyze-continuous.mjs`), phép đo chờ runbook
- [x] Đoạn nói 60s không nghỉ quá 500ms: cắt thành 7–8 lượt, mọi đường bỏ lượt đều ghi log — `capture-pump.spec.ts`, `speech-gate.spec.ts`, `turn-pipeline.spec.ts`, `ordered-playback.spec.ts`
- [ ] Độ dài lượt trung bình nằm trong 15% của `maxUtteranceMs` — `analyze-continuous.mjs` in mean/p95; số thật chờ runbook
- [x] Replay test chứng minh thứ tự phát đúng khi lượt ngắn về sau xong trước lượt dài về trước, **và test đó fail được khi gỡ lớp sắp thứ tự** — `ordered-playback.replay.spec.ts` có test đối chứng bypass lớp sắp xếp và **phải** khác; gỡ lớp sắp xếp làm fail 6 test, gỡ token lượt làm fail 10
- [x] Không block nào xuất hiện trong hai lượt (kiểm tra định danh từng block) — `capture-pump.spec.ts` "never delivers one block into two turns"
- [x] Tiếng gốc giảm khi bản dịch phát, trả lại khi im — `DuckController` theo `OrderedPlayback.isBusy` (không theo `isPlaying`, thứ sẽ kẹt duck khi backlog nở); nghe bằng tai thuộc runbook
- [ ] Đo được req/phút thực tế **theo từng model**, đối chiếu trần 15/phút — script in đúng dạng đó; **dự kiến cả hai model vượt trần**, xem §Rủi ro
- [ ] Đo được độ trôi tích luỹ ở mốc 1 / 3 / 5 phút — script in median theo cửa sổ 1 phút cuối mỗi mốc kèm kết luận phẳng/dốc
- [ ] Đo được số sự kiện vọng âm trong 3 phút khi phát qua loa — `EchoMonitor` đếm và đẩy vào JSONL; hai lần chạy (tai nghe đối chứng + loa) thuộc runbook
- [x] Overlay hiện chỉ báo đang thu suốt phiên; popup cảnh báo ở lần bật đầu tiên — chỉ báo không có đường tắt trong lúc capture chạy; cờ đã-hiện vào `chrome.storage`
- [x] `pnpm test` + `pnpm typecheck` + `pnpm lint` + `pnpm build` + `pnpm knip` xanh — cộng `pnpm --filter api test:e2e` chạy tay (CI không chạy)
- [ ] Extension load unpacked chạy được trên Meet, Zoom web, Messenger web — build xanh và manifest sinh ra có đủ quyền/match pattern; load thật thuộc runbook

Tiêu chí cũ "test `apps/web` hiện có không sửa một dòng nào" đã bị bỏ: phase 2
đổi chữ ký `speculate()`/`endSession()` và phase 5 đổi `conversation-session.spec.ts`,
nên tiêu chí đó tự mâu thuẫn với chính plan.

## Rủi ro

| Rủi ro                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Mức                | Giảm thiểu                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quota vượt trần trên cả hai model** — free tier đo **theo từng model**, không cộng gộp. `LIVE_TRANSLATION_MODELS` (`translation-model-policy.ts:64`) chỉ có `gemini-3.5-flash-lite`, và đó cũng là `FINAL_MODELS[0]`. Ở 7,5 lượt/phút: model đó nhận 3 live + 1 final = 4/lượt ≈ **30/phút so với trần 15**; `gemini-3.1-flash-lite` nhận tới 4 speculation ≈ **30/phút so với trần 15**. `development-journey.md:597` ghi lại rằng chỉ **một** request thêm mỗi lượt đã từng đẩy model này vượt trần. | Chấp nhận có chủ ý | Người dùng chọn giữ free tier và **tích hợp rotate nhiều key free sau**. Rotation cần ≥2 key chỉ để chạm trần, ≥3 mới có biên. Cho tới khi có rotation, phép đo phase 8 **sẽ** ghi nhận lượt fail — đó là dữ liệu, không phải bug, và report phải nói rõ. |
| **Bản dịch qua loa tới tai người khác qua mic người dùng** — extension không kiểm soát mic                                                                                                                                                                                                                                                                                                                                                                                                               | Cao                | Không sửa được từ phía extension. Đo bằng `onEchoHeard` (phase 7 nối, phase 8 đo) và ghi vào luận văn như ràng buộc của kịch bản.                                                                                                                         |
| **Thứ tự phát sai** — đúng lớp lỗi đã hai lần thoát ra `main` với mọi cổng xanh (mục 6.3)                                                                                                                                                                                                                                                                                                                                                                                                                | Cao                | Phase 5 bắt buộc replay test có răng: phải chứng minh test fail khi gỡ lớp sắp xếp                                                                                                                                                                        |
| **Cắt cưỡng bức triệt tiêu speculation** — `onProbableEnd` cần 150ms im lặng, cắt thì không có                                                                                                                                                                                                                                                                                                                                                                                                           | Cao                | Phase 4 bắn `speculate()` lúc **arm** điểm cắt, không phải lúc cắt                                                                                                                                                                                        |
| **Trần per-socket không chặn được tài nguyên process-global** — sidecar STT/TTS là một tiến trình dùng chung, endpoint không auth                                                                                                                                                                                                                                                                                                                                                                        | Cao                | Phase 3 thêm trần **global** song song với trần per-socket; phase 8 đo RTF qua nhiều socket, không chỉ nhiều lượt trên một socket                                                                                                                         |
| **Contract đổi chạm 12 file, không phải 4**                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Trung bình         | Phase 2 liệt kê đủ; `event-channel.ts` là chỗ khó nhất vì `ended()` cố ý không giữ state lượt nào                                                                                                                                                         |
| **`conversation-state.ts` vỡ với nhiều lượt** — một `liveText` cho cả hội thoại                                                                                                                                                                                                                                                                                                                                                                                                                          | Trung bình         | Không đưa vào package dùng chung; extension có reducer khoá theo lượt riêng (phase 5)                                                                                                                                                                     |
| **Oversubscription ONNX**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Trung bình         | Trần global ở phase 3, đo ở phase 8                                                                                                                                                                                                                       |
| **Meet/Zoom đổi layout làm vỡ overlay**                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Thấp               | Shadow DOM chèn vào `document.body`, không bám selector nội bộ                                                                                                                                                                                            |
| **Bản dịch trôi xa dần người nói**                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Chấp nhận          | Không giải quyết. Đo và ghi nhận (phase 8).                                                                                                                                                                                                               |

## Non-goals

- Chèn giọng dịch vào luồng mic gửi đi (patch `getUserMedia` ở MAIN world)
- Zoom desktop app — extension không capture được, chỉ Zoom web
- Diarization / tách nhiều người nói
- Ngôn ngữ ngoài vi↔en; Firefox; Safari
- **Chỉnh** AEC âm học — chỉ **đo** vọng âm, không khử
- Rotate API key (đã quyết làm sau, ngoài plan này)
- Xây auth cho `/ws/translate` — endpoint vốn không auth từ trước, không do plan này tạo ra
- Dịch máy local; giải quyết độ trôi

## Red Team Review

### Session — 2026-07-29

**Findings:** 36 thô → 15 sau khi lọc bằng chứng và gộp trùng (15 accept, 4 reject)
**Severity:** 7 Critical, 6 High, 2 Medium
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier)

| #   | Finding                                                                                | Severity | Disposition | Applied To                                                                                                                                |
| --- | -------------------------------------------------------------------------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Quota tính gộp hai model là sai; live + final dùng chung `gemini-3.5-flash-lite`       | Critical | Accept      | plan.md, phase 8                                                                                                                          |
| 2   | Cắt cưỡng bức không thể gán lại audio đã gửi; `preRoll` bị xoá trước khi đọc           | Critical | Accept      | phase 4                                                                                                                                   |
| 3   | Không có đường về `idle` ở chế độ liên tục; mất ~440ms mỗi lượt sau hangover           | Critical | Accept      | phase 4, 5                                                                                                                                |
| 4   | Phase 1 làm `apps/web` không còn spec nào → vitest + knip vỡ                           | Critical | Accept      | phase 1                                                                                                                                   |
| 5   | `too_many_turns` không gắn được vào lượt → hàng đợi phát kẹt vĩnh viễn                 | Critical | Accept      | phase 2, 3, 5                                                                                                                             |
| 6   | Khẳng định sai rằng `frame.sessionId` đang bị bỏ qua                                   | Critical | Accept      | phase 3                                                                                                                                   |
| 7   | Tiêu chí "không còn `session_busy`" xoá 2 guard hợp lệ                                 | Critical | Accept      | phase 3                                                                                                                                   |
| 8   | Cắt cưỡng bức triệt tiêu speculation                                                   | High     | Accept      | phase 4                                                                                                                                   |
| 9   | Mic người dùng vẫn truyền bản dịch đi khi phát qua loa                                 | High     | Accept      | plan.md, phase 7, 8                                                                                                                       |
| 10  | `conversation-state.ts` một `liveText` — vỡ với nhiều lượt, không phase nào nhận       | High     | Accept      | phase 1, 5                                                                                                                                |
| 11  | `sequence` và `pending` chưa được liệt kê là state per-turn                            | High     | Accept      | phase 5                                                                                                                                   |
| 12  | Phase 2 thiếu 8 trong 12 consumer của hợp đồng                                         | High     | Accept      | phase 2, 3, 4                                                                                                                             |
| 13  | Trần per-socket không chặn sidecar process-global; metrics event không kiểm chủ sở hữu | High     | Accept      | phase 3, 6                                                                                                                                |
| 14  | Tiêu chí nghiệm thu rỗng; coverage phụ thuộc playback; metrics bỏ sót lượt hỏng        | Medium   | Accept      | plan.md, phase 6, 8                                                                                                                       |
| 15  | Ước lượng công thấp; manifest thiếu; 3 trích dẫn sai                                   | Medium   | Accept      | phase 1, 7, 8                                                                                                                             |
| —   | Xoá phase 2+3, dùng socket pool                                                        | High     | **Reject**  | Quyết định của người dùng trong phiên này, đã được trình bày đúng phương án đó trước khi chọn                                             |
| —   | Cắt phase 6 xuống JSONL local                                                          | High     | **Reject**  | Như trên                                                                                                                                  |
| —   | Dựng auth `/ws/translate` làm cổng chặn phase 3                                        | Critical | **Reject**  | Tình trạng có sẵn, không do plan tạo ra; ngoài phạm vi. Nhận phần có giới hạn: trần global + trần byte + validate `sessionId` của metrics |
| —   | Xoá nhánh `maxInFlight: 1`                                                             | Medium   | **Reject**  | `apps/web` vẫn cần                                                                                                                        |

### Whole-Plan Consistency Sweep

- Files reread: plan.md, phase-01 … phase-08 (9 files)
- Decision deltas checked: 17 (quota số học, thiết bị ra = loa, đo vọng âm quay lại phạm vi, `session_busy` 3 nơi phát, `frame.sessionId` được kiểm tra, thiết kế điểm cắt, chuyển trạng thái `idle`, `conversation-state` không dùng chung, `sequence`/`pending` per-turn, `turnId` trên error/ended, trần global, knip/vitest ownership, coverage mẫu số, ghi metrics mọi đường kết thúc, effort, chia đôi phase 7, 3 trích dẫn sai)
- Reconciled stale references: 15
- Unresolved contradictions: 0

## Validation Log

### Session 1 — 2026-07-30

Vòng verification bỏ qua theo guard: `## Red Team Review` đã có bằng chứng
xác minh đầy đủ. Quét `[UNVERIFIED]` / `TBD` / `TODO` trên 9 file: **0 kết quả**.
4 câu hỏi, tất cả đều là điểm đổi mã nguồn nếu trả lời khác.

| #   | Câu hỏi                                           | Quyết định                                                 | Ảnh hưởng                                                                     |
| --- | ------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Bỏ gì khi hàng đợi chạm trần                      | **Bỏ lượt cũ nhất chưa phát** — ưu tiên bám thời gian thực | Xác nhận giả định phase 5; Goal 2 nới thành "dưới trần hàng đợi"              |
| 2   | Rotate key trước hay sau phase 8                  | **Đo trước, rotate sau**                                   | Xác nhận thứ tự phase hiện tại; report phase 8 phải ghi số lượt fail vì quota |
| 3   | `apps/web /translate` được chấm hay là bề mặt dev | **Được chấm, giữ nguyên hành vi**                          | Nhánh `maxInFlight: 1` tồn tại lâu dài; Goal 6 giữ nguyên độ chặt             |
| 4   | Đồng thuận ghi âm                                 | **Chỉ báo đang thu trong overlay + cảnh báo lần đầu bật**  | **Thêm việc vào phase 7**; Goal 9 mới                                         |

Chỉ quyết định #4 sinh việc mới. Ba cái còn lại xác nhận plan như đang viết —
nhưng #1 và #3 trước đó là **giả định chưa hỏi**, giờ là quyết định của người dùng
và không được tự đảo ở các vòng review sau.

### Whole-Plan Consistency Sweep

- Files reread: plan.md, phase-01 … phase-08 (9 files)
- Decision deltas checked: 4
- Reconciled stale references: 3 (Goal 2 nới trần, Goal 9 mới, phase 7 thêm chỉ báo)
- Unresolved contradictions: 0

## Implementation Log

### Session 1 — 2026-07-30 (phases 1–8)

Sáu phase đầu xong và xác minh đầy đủ; phase 7–8 code-complete (xem §Phases). Mỗi
phase một commit trên nhánh `feat/extension-continuous-capture`.

**Chỗ hiện thực khác plan, và vì sao.** Mọi mục dưới đây là quyết định lúc viết mã
sau khi đọc mã thật, không phải bỏ sót.

| #   | Plan nói                                                               | Đã làm                                   | Lý do                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `turnId` bắt buộc trên `server.session.ready` / `server.session.ended` | Optional                                 | Nó _dội lại_ một trường optional (mục giảm thiểu ở §Rủi ro: không bao giờ siết trường client→server thành bắt buộc phía server). Một trường dẫn xuất chặt hơn nguồn của nó là hình dạng không gì thoả mãn được. Client luôn gửi, nên thực tế luôn có. |
| 2   | Hằng số trần đặt cùng chỗ hằng số quota                                | File riêng `session/turn-concurrency.ts` | `translation-model-policy.ts` phạm vi rõ ràng là "model nào một lượt được tiêu". Trần đồng thời là giới hạn RAM/CPU, không phải quota. Kèm spec ghim con số RAM để nâng trần là fail test.                                                            |
| 3   | Flush `held` khi cắt cưỡng bức                                         | Bỏ, ghi lý do tại chỗ                    | Không test nào phân biệt được nó với no-op: `armIfDue` bắn `onProbableEnd` (đã flush), và điểm cắt chỉ xảy ra tại hoặc sau arm. Nhánh không tới được.                                                                                                 |
| 4   | Lượt bị trần in-flight giữ lại → `never_started` rồi bỏ                | Giữ lại, gửi khi có slot                 | Mic không chờ slot, nên lượt đó **đã thu đủ** — bỏ đi là mất cả câu chỉ vì client đang bận lúc người ta nói xong. Trần `pending` mới là chỗ chặn.                                                                                                     |
| 5   | Phase 1 phá `fake-audio-context.ts` do đổi chữ ký `TranslateSocket`    | Không phá                                | Spec cast `as unknown as TranslateSocket`, nên constructor không bị kiểm. Chỗ phá thật là phase 2 (`startSession`/`speculate`/`endSession`).                                                                                                          |
| 6   | `outbound-audio-framer.ts` và `use-audio-recorder.ts` cần sửa          | Không cần                                | Frame audio vốn đã mang `sessionId`; `use-audio-recorder` không import gì từ phần chuyển đi.                                                                                                                                                          |
| 7   | WXT + React 19.2 + Tailwind 4                                          | WXT + TS thuần + CSS viết tay            | Đúng đường lui plan đã cho phép. Tailwind không với được vào shadow root `closed` mà không inject dạng string; toàn bộ bề mặt là một dòng trạng thái + một danh sách.                                                                                 |

**Thêm ngoài plan, do đọc mã mới thấy:**

- Frame mang `sessionId` không thuộc socket khi socket **có** lượt khác mở giờ trả
  `frame_rejected` thay vì `no_active_session`. Câu "gửi start trước đi" là sai —
  client đã gửi rồi.
- `SessionRegistry` xoá hẳn entry của socket khi lượt cuối đóng. Để lại map rỗng là
  rò một entry mỗi kết nối, trên endpoint không auth.
- `client.session.end` **không** gửi khi lượt chưa có `sessionId`. Gửi thiếu id khiến
  server rơi về "lượt duy nhất của socket" — sai lượt ngay khi có nhiều hơn một.
- Bỏ 8 tham chiếu file cũ trỏ vào `apps/web/src/audio/...` sau khi chuyển package.
- `argsIgnorePattern: '^_'` vào eslint của package: quy ước `_` vốn đã load-bearing
  (`_sampleRate` trong test double) nhưng chỉ tình cờ đúng vì có tham số dùng sau nó.

**Mutation testing.** Plan đòi test phải chứng minh được là fail. Đã kiểm bằng cách
phá mã rồi chạy lại: bỏ `continuous`→`idle` (3 fail), bỏ speculate lúc arm (3), bỏ
flush ở `onProbableEnd` (1), đổi lý do cắt (4), bỏ trần cứng (8), bỏ lớp sắp thứ tự
(6), bỏ token lượt khỏi điều kiện drain (10), đảo chính sách bỏ lượt (1).

## Câu hỏi chưa giải quyết

1. Cắt lượt cưỡng bức ở 8s là suy từ ràng buộc, chưa từ đo giọng người thật. Phase 8 cho số để hiệu chỉnh.
2. Demo trước hội đồng chạy trên cuộc họp thật hay bản ghi phát lại? Không chặn — chỉ đổi khâu chuẩn bị fixture ở phase 8.
3. Trần lượt đồng thời (per-socket và global) đặt bao nhiêu — phụ thuộc số oversubscription đo ở phase 8.

<!-- slug: extension-continuous-capture -->
