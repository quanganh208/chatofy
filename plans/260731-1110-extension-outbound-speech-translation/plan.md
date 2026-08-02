---
title: 'Extension outbound speech translation'
description: 'Dịch tiếng của chính người dùng và bơm vào cuộc họp qua một virtual microphone, để chiều nói ra cũng được dịch chứ không chỉ chiều nghe vào'
status: pending
priority: P1
effort: '1.5w'
tags: [extension, mv3, realtime, main-world, audio]
created: 2026-07-31
blockedBy: []
blocks: []
---

# Extension outbound speech translation

## Overview

Extension hiện dịch **một chiều**: `offscreen/main.ts` chạy đúng một
`ConversationSession` với đầu vào là audio của tab
(`openMicrophone: () => Promise.resolve(tab.stream)`), bản dịch phát ra loa của
người chạy extension. Tiếng của chính người dùng không đi qua pipeline nào cả —
mic duy nhất đang mở trong offscreen là của `EchoMonitor`, và nó chỉ **đếm**
echo chứ không dịch.

Kế hoạch này thêm chiều ngược lại: một session thứ hai lấy mic làm đầu vào, dịch
sang ngôn ngữ còn lại, và **bơm audio đó vào chính cuộc họp** qua một script chạy
ở `world: 'MAIN'` bọc `navigator.mediaDevices.getUserMedia`. Người bên kia nghe
bản dịch; giọng thật của người dùng vẫn truyền đi nhưng được duck xuống trong lúc
bản dịch phát.

Chọn đường virtual microphone chứ không phải phát ra loa, vì lý do y hệt lý do
extension tồn tại: phát ra loa thì mic đang mở nghe lại chính bản dịch, và vòng
lặp âm học mà kiến trúc offscreen vừa xoá đi ở chiều vào sẽ quay lại ở chiều ra.
Đường virtual mic cũng là đường duy nhất còn dùng được tai nghe.

Hợp đồng đã chốt: [`plans/reports/brainstorm-260731-1058-outbound-speech-translation.md`](../reports/brainstorm-260731-1058-outbound-speech-translation.md).

## Mô hình đe doạ

**Trang họp không được tin** — không vì Google hay Meta là kẻ tấn công, mà vì một
script bên thứ ba trên trang, một lỗ XSS, hay một extension khác đều chạy trong
cùng world. Hai bất biến:

1. Trang không làm cho người dùng "nói" điều họ không nói.
2. Trang không đọc được lời người dùng nói khi họ tin là mình đang tắt mic.

MAIN world là lãnh thổ của trang. Nó là **thiết bị ra không đáng tin**; mọi quyết
định phải đúng nằm ở offscreen, và mọi báo cáo từ trang là gợi ý chứ không phải
thẩm quyền. Chi tiết ở phase 4 (kênh) và phase 5 (thứ tự, mute).

## Ràng buộc đã kiểm chứng

| Ràng buộc                                                                | Bằng chứng                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session **không** chuyển vào trang được                                  | Trang `https://` không mở được `ws://localhost:3000` (mixed content). Đây là lý do đủ và duy nhất — lập luận "AudioWorklet cần `web_accessible_resources`" trong bản đầu là **sai**, script trong world của trang nạp worklet từ `blob:` URL được |
| `MediaStream` không vượt được từ offscreen sang trang                    | Không có API nào chuyển track qua context; chỉ dữ liệu serialize được mới đi qua `chrome.runtime`                                                                                                                                                 |
| Offscreen không tự gửi tới tab được                                      | Offscreen document chỉ dùng được `chrome.runtime`; đường đi phải là offscreen → worker → tab                                                                                                                                                      |
| WXT 0.21.2 phát ra được `world: 'MAIN'`                                  | Đã kiểm trong `node_modules`: `wxt/dist/types.d.mts:767-773`, `dist/core/utils/content-scripts.mjs:42`. Vẫn không dùng đường tĩnh — xem Quyết định                                                                                                |
| `chrome.scripting` **chưa** có trong manifest                            | `apps/extension/wxt.config.ts:31-45`; đăng ký động cần thêm quyền này                                                                                                                                                                             |
| Trần đồng thời của server là 6/tiến trình                                | `apps/api/src/modules/translate/session/turn-concurrency.ts:27-44`                                                                                                                                                                                |
| …nhưng trần đó **đếm turn, không đếm suy luận**                          | `services/local-stt/engines/base.py:51-56` — khoá per-engine _"so Vietnamese and English requests can overlap"_. Hai chiều ⇒ vi và en chạy đè nhau thật. Phase 3 đo, không đoán                                                                   |
| `direction` đi **theo từng turn**                                        | `TurnPipeline.startSession(options, turnId)`; hai chiều trên hai socket không cần đổi protocol                                                                                                                                                    |
| Seam playback đã có sẵn interface                                        | `packages/realtime-client/src/audio/ordered-playback.ts:12-18` khai báo `PlaybackSink`                                                                                                                                                            |
| …nhưng package **không export** thứ gì trong đó                          | `packages/realtime-client/src/index.ts:19-41`; `exports` map chỉ có `"."`. Phase 1 mở ba export                                                                                                                                                   |
| `OrderedPlayback.isBusy` đếm **turn đang mở**, không phải audio đang kêu | `ordered-playback.ts:262-265`, `:163-177`. Không dùng nó để lái mic gate                                                                                                                                                                          |
| Extension **không** có listener navigation nào                           | `background.ts:365-367` chỉ có `onRemoved`; grep `onUpdated`/`webNavigation` trên `apps/extension` ra rỗng                                                                                                                                        |
| `activeTabId` là biến module trong worker                                | `background.ts:31`, `:200`; worker bị Chrome giết bất cứ lúc nào (`:20-23`)                                                                                                                                                                       |

## Quyết định

| Câu hỏi                         | Chốt                                                                        | Lý do                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Bản dịch chiều ra đi đường nào  | Virtual microphone (`world: 'MAIN'` patch `getUserMedia`)                   | Không có vòng lặp âm học, dùng tai nghe được, người bên kia nghe bản dịch sạch                                                              |
| Cài patch kiểu gì               | **Đăng ký động** `chrome.scripting.registerContentScripts` khi chiều ra bật | Khai báo tĩnh thay mic của cả người không bật tính năng, và cho ba site fingerprint mọi người dùng Chatofy bằng một dòng JS                 |
| Kênh isolated ↔ MAIN            | `MessagePort` chuyển lúc bootstrap + nonce mỗi lần mở capture               | `event.source === window` không phân biệt được extension với trang; xây kênh điều khiển trên nó là giao quyền nói thay người dùng cho trang |
| `drained` / `progress` từ trang | Gợi ý, không phải thẩm quyền                                                | Trang quyết định được khi nào turn kết thúc ⇒ trang phá được thứ tự phát, đúng lớp defect đã hai lần lọt vào `main`                         |
| Giọng thật của người dùng       | Vẫn truyền, **duck** dưới bản dịch                                          | Quy ước phiên dịch; tái dùng `DuckController`                                                                                               |
| Duck lái bằng gì                | `inbound` only                                                              | Duck là hạ tiếng cuộc họp dưới bản dịch người dùng đang nghe; bản dịch chiều ra không dành cho họ                                           |
| Mic gate lái bằng gì            | Audio **đang thực sự kêu** + release ngắn                                   | `isBusy` true suốt cả quãng người kia nói ⇒ người dùng không mở nổi turn nào                                                                |
| Client mute thì sao             | Chiều ra **ngừng thu và ngừng gửi**                                         | Chỉ im ở đồ thị trang thì lời nói lúc mute vẫn được dịch và vẫn rời offscreen                                                               |
| Hướng dịch chiều ra             | Đảo của `settings.direction`                                                | Một setting cho cả hai chiều                                                                                                                |
| Giọng TTS chiều ra              | Dùng chung `voiceGender`                                                    | YAGNI cho v1                                                                                                                                |
| Bật/tắt                         | Toggle riêng, **mặc định tắt**                                              | Chiều ra đụng vào trang của người khác                                                                                                      |
| Turn chiều ra trên overlay      | Có, gắn nhãn của mình                                                       | Transcript hai chiều không phân biệt được thì không đọc nổi                                                                                 |
| `maxInFlight` chiều ra          | 2 tạm thời, **phase 3 chốt bằng số đo**                                     | Số turn không đo được song song chéo engine                                                                                                 |
| Khi trang chưa có patch         | Monitor tại chỗ + báo **reload và invoke lại**                              | Reload thu hồi grant `activeTab`, nên chỉ nói "reload" là dẫn người dùng vào ngõ cụt                                                        |

## Kiến trúc

```
[offscreen document]                              [meeting tab]
  mic ─► gain(gate) ─► MediaStreamDestination
                          │ stream
                          ▼
              ConversationSession (hướng đảo)
                          │  ws://localhost:3000/ws/translate
                          ▼
                   OrderedPlayback          ← thẩm quyền về thứ tự và stall
                          │ enqueue / stopTurn / stop
                          ▼
                  PagePlaybackSink ──► worker ──► content (isolated)
                          ◄── drained (gợi ý)             │ MessagePort + nonce
                                                          ▼
                                         MAIN world: patch getUserMedia
                                           mic thật ─► gain(duck) ─┐
                                           base64 PCM ─► scheduler ┴─► dest
                                                                      └─► track trả
                                                                          cho meeting
```

## Goals

| #   | Goal                                                              | Priority |
| --- | ----------------------------------------------------------------- | -------- |
| 1   | Tiếng người dùng được dịch và **người bên kia nghe được**         | P1       |
| 2   | Giọng thật vẫn truyền đi, duck dưới bản dịch                      | P1       |
| 3   | Không sinh vòng lặp tự dịch, kể cả khi dùng loa ngoài             | P1       |
| 4   | Chiều vào không đổi hành vi, và không chết theo chiều ra          | P1       |
| 5   | Trang không nói thay người dùng, không đọc được lời lúc mute      | P1       |
| 6   | Trạng thái hiển thị đúng sự thật: chưa patch, mute, chết, reload  | P2       |
| 7   | Tải thêm lên sidecar được **đo trước khi** phần bơm audio hạ cánh | P2       |

## Phases

| #   | Phase                                                                                        | Status                              |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | [Playback sink injection and package exports](./phase-01-playback-sink-injection.md)         | Done                                |
| 2   | [Outbound mic session and per-direction state](./phase-02-outbound-mic-session.md)           | Code complete, verification pending |
| 3   | [Two-way load measurement](./phase-03-two-way-load-measurement.md)                           | **Not run — needs a live call**     |
| 4   | [Main world microphone patch](./phase-04-main-world-microphone-patch.md)                     | Code complete, per-site pending     |
| 5   | [Route outbound audio into the meeting](./phase-05-route-outbound-audio-into-the-meeting.md) | Code complete, verification pending |
| 6   | [Hardening and docs](./phase-06-hardening-and-docs.md)                                       | Docs done; re-measure pending       |

Phase 3 was **waived by the user**, not forgotten: the instruction was to finish
everything and test at the end. The plan's own ordering put the measurement before
phase 5 so a bad result could still change its design; landing 5 first means
`MAX_IN_FLIGHT_OUTBOUND = 2` is still a guess, and if the measurement turns out
badly the fix lands on built code rather than on a plan.

Hai quyết định về thứ tự, cả hai do red team:

- **Phase 3 đứng trước phần bơm audio.** Nếu số đo nói hai chiều không cùng chạy
  nổi trên một máy, điều đó đổi thiết kế của phase 5. Biết sau khi đã bơm audio
  vào Meet thì đã muộn.
- **Phase 4 cố tình không bơm gì.** Nó chỉ thay track bằng đường passthrough và
  chứng minh cuộc họp vẫn chạy. Gộp với phase 5 thì lúc Zoom vỡ tiếng sẽ không
  biết vỡ vì track bị thay hay vì thứ được bơm vào.

## Success Criteria

- [ ] Nói tiếng Việt trong Meet → người bên kia nghe tiếng Anh, độ trễ cùng dải
      với chiều vào (turn-based, không phải đồng thời)
- [ ] Giọng thật vẫn nghe được, nhỏ lại trong lúc bản dịch phát
- [ ] Bật chiều ra không làm chiều vào chậm đi hay mất turn
- [ ] Chiều ra hỏng không làm cuộc họp câm và không xoá banner của chiều vào
- [ ] Bật loa ngoài: mic không đẩy bản dịch chiều vào trở lại pipeline
- [ ] Mute trong Meet ⇒ không byte audio nào rời offscreen
- [ ] Từ devtools của trang: giả `ready`/`drained` không đổi được sink lẫn thứ tự
- [ ] Worker bị giết giữa cuộc gọi ⇒ chiều ra vẫn tới nơi
- [ ] Reload tab ⇒ status đúng kèm thông báo hai bước, không kẹt `sending`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm knip` sạch

## Không làm

- Đổi hành vi pipeline chiều vào
- Đổi protocol; đổi server/sidecar chỉ khi số đo phase 3 bắt buộc, và phải hỏi trước
- Đụng vào `apps/web`, `apps/mobile`
- Dịch đồng thời (word-by-word). Chiều ra vẫn theo lượt như chiều vào
- Tự động phát hiện ngôn ngữ

## Rủi ro

| Rủi ro                                              | Ảnh hưởng                                      | Giảm thiểu                                                                        |
| --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Trang bơm audio giả vào mic người dùng              | Người dùng "nói" điều họ không nói             | Port + nonce; `window` không còn là kênh (phase 4)                                |
| Trang đọc PCM chiều ra                              | Lộ lời nói tưởng là riêng tư                   | Port thay broadcast; mute ⇒ ngừng gửi (phase 5)                                   |
| `AudioContext` của MAIN bị suspended                | Mic câm mà mọi chỉ báo đều xanh                | Tạo lười trong `getUserMedia`, resume, đường lui trả stream gốc (phase 4)         |
| Worker restart mất route                            | Chiều ra chết im lặng sau quãng im đầu tiên    | `storage.session` + offscreen nhắc lại tab; relay lỗi nổi lên (phase 5)           |
| Hai chiều ghi đè state của nhau                     | Un-duck giữa chừng, gate mở sai, banner bị xoá | Tách state theo chiều, bảng hợp đồng ở phase 2                                    |
| Mic gate đóng cả quãng người kia nói                | Tính năng vô dụng trong hội thoại thật         | Lái bằng audio đang kêu; đo tỉ lệ gate đóng ở phase 3                             |
| Sidecar chạy song song theo ngôn ngữ                | p95 cả hai chiều cùng xấu                      | Đo ở phase 3 trước khi phase 5 hạ cánh                                            |
| Rút thiết bị giữa cuộc họp                          | Nói vào đường chết, không ai thấy              | Re-dispatch `ended`/`mute`/`unmute` (phase 4)                                     |
| Zoom web / Facebook groupcall xử lý audio bằng WASM | Bản dịch méo, hoặc client vỡ                   | Phase 4 verify riêng từng site trước khi bơm                                      |
| Reload + invoke lại là UX xấu                       | Người dùng tưởng hỏng                          | Hệ quả trực tiếp của đăng ký động; thông báo phải nói cả hai bước                 |
| Quyền `scripting` đổi prompt lúc cài                | Người dùng cân nhắc lại                        | Đánh đổi đã chọn để không đụng mic của người không dùng tính năng; ghi trong docs |

## Ghi chú chồng lấn

`plans/260730-2327-facebook-call-window-activation` còn ghi `in-progress` nhưng
code của nó đã nằm trong `main`. Kế hoạch này sửa cùng `background.ts` và
`content/index.ts` nhưng xây tiếp lên trên, không có phụ thuộc chặn. Nên cập nhật
status của plan kia cho đúng thực tế, tách khỏi công việc ở đây.

## Red Team Review

### Session — 2026-07-31

**Findings:** 15 (15 accepted, 0 rejected) — 27 thô, dedupe còn 15, tất cả đều có
`file:line`
**Severity breakdown:** 9 Critical, 5 High, 1 Medium
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow
Tracer), Assumption Destroyer (Scope Auditor)

| #   | Finding                                                                                                                            | Severity    | Disposition | Applied To                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------- |
| 1   | Trang bơm được audio giả vào track mic; `event.source === window` không xác thực                                                   | Critical    | Accept      | Phase 4 (kênh port + nonce), Phase 5 (mô hình đe doạ) |
| 2   | `postMessage` là broadcast — trang đọc được mọi PCM chiều ra, gồm cả lúc client mute                                               | Critical    | Accept      | Phase 4, Phase 5 (mute ⇒ ngừng thu/gửi)               |
| 3   | Giả `ready` ⇒ extension chọn `PagePlaybackSink` và báo `sending` vào hư không                                                      | Critical    | Accept      | Phase 4 (handshake trên port), Phase 5                |
| 4   | Giả `drained`/`progress` ⇒ trang điều khiển thứ tự turn                                                                            | High        | Accept      | Phase 5 (sổ thời lượng là nguồn chính)                |
| 5   | `AudioContext` của MAIN không có chủ/vòng đời/resume ⇒ track live nhưng câm; nhiều `getUserMedia` ⇒ bơm nhầm graph                 | Critical    | Accept      | Phase 4                                               |
| 6   | Route bám `activeTabId`, biến module bị MV3 xoá khi worker restart                                                                 | Critical    | Accept      | Phase 5 (`storage.session`)                           |
| 7   | Một `playbackBusy`, hai writer ⇒ un-duck và mở gate giữa lúc chiều vào đang kêu                                                    | Critical    | Accept      | Phase 2 (bảng hợp đồng state)                         |
| 8   | Mic gate lái bằng `isBusy` (đếm turn mở) ⇒ người dùng bị câm suốt quãng người kia nói                                              | Critical    | Accept      | Phase 2, Phase 3 (đo tỉ lệ gate đóng)                 |
| 9   | `onStopped: () => void end()` ⇒ chiều ra rớt kéo sập cả capture, cuộc họp câm; một `error` chung bị `onStatus` xoá mỗi audio frame | Critical    | Accept      | Phase 2 (`end(direction)`, errors theo chiều)         |
| 10  | Không có listener navigation; lời khuyên "reload" dẫn vào ngõ cụt vì reload thu hồi `activeTab`                                    | High        | Accept      | Phase 5 (`onUpdated`), Phase 4 (thông báo hai bước)   |
| 11  | Patch tĩnh mâu thuẫn quyết định "mặc định tắt", fingerprint được, và `scripting` chưa có trong manifest                            | High        | Accept      | Phase 4 (đăng ký động + quyền), Phase 6 (docs)        |
| 12  | Sidecar khoá per-engine nên vi/en chạy đè — "3+2=5 ≤ 6" đếm sai thứ                                                                | High        | Accept      | Phase 3 (phase mới, đứng trước phần bơm)              |
| 13  | `PcmPlaybackQueue`/`pcm16ToBase64` không được export; `exports` map chỉ có `"."`                                                   | Medium      | Accept      | Phase 1                                               |
| 14  | `ended`/`mute`/`unmute`/`applyConstraints` không được forward ⇒ rút thiết bị là lỗi vô hình                                        | Medium→High | Accept      | Phase 4                                               |
| 15  | Tiền đề `EchoMonitor` của bản đầu sai — gate không có call path tới nó; nhiễm thật là monitor chiều ra                             | High        | Accept      | Phase 2 (chốt tại chỗ, không để sang cuối)            |

Hai khẳng định sai của bản đầu đã sửa ngoài bảng: WXT 0.21.2 **có** hỗ trợ
`world: 'MAIN'` (kiểm trong `node_modules`), và lập luận "AudioWorklet cần
`web_accessible_resources`" bị thổi phồng — `blob:` URL dùng được; kết luận
"không chuyển session vào trang" vẫn đứng nhờ mixed content.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, `phase-01`…`phase-06`
- Decision deltas checked: 8 (đăng ký động thay khai báo tĩnh; port+nonce thay
  `event.source`; `drained` thành gợi ý; `playbackBusy` tách hai; gate lái bằng
  audio đang kêu thay `isBusy`; phase đo chuyển lên vị trí 3; ba export gom vào
  phase 1; `EchoMonitor` chốt ở phase 2)
- Reconciled stale references: 6 (bảng phases, sơ đồ kiến trúc, bảng quyết định,
  bảng ràng buộc, dependencies của từng phase, success criteria)
- Unresolved contradictions: 0

## Câu hỏi còn treo

1. Nếu số đo phase 3 bắt phải dùng lever "semaphore suy luận trong sidecar", đó
   là sửa `services/local-stt` và đổi ngữ nghĩa `base.py:51-56` — ngoài phạm vi
   đã chốt. Phase 3 dừng và hỏi; câu trả lời chưa có.
2. Zoom web và Facebook groupcall gọi `getUserMedia` từ top frame hay iframe?
   Chưa kiểm; nếu iframe thì `allFrames` phải bật và phạm vi patch rộng ra. Phase
   4 bước 8 trả lời.
