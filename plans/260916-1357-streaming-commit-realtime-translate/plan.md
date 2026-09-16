---
title: Streaming theo mốc chốt — chữ hiện từng chữ, dịch không đợi hết câu
date: 2026-09-16
branch: main
status: complete
mode: advice-handover
phases: 8 (6 thi công + 1 chỉ đo + 1 bỏ sau khi đo)
revision: 2 (sau red team, 2026-09-16)
supervisor: kongming
scope: web /translate only
---

# Streaming theo mốc chốt cho `/translate`

## Outcome

Trên web `/translate`: chữ hiện ra từng chữ trong lúc người ta đang nói và
**không nhấp nháy**; bản dịch chạy theo mốc chốt của lời nói chứ không chờ hết
câu.

Độ mịn nhắm tới là **theo cụm từ, `N ≈ 15` ký tự (~3 âm tiết)** — người dùng chốt
ở phiên validation 2026-09-16, chấp nhận đánh đổi ~42 phút hội thoại mỗi ngày.
Mức **từng chữ** vẫn vượt trần khoảng 2,4 lần kể cả với 6 project; đường tới đó là
nâng quota, không phải sửa code. `N` là biến môi trường với sàn cứng 12.

**Tiếng nói sớm không thuộc đợt này.** Nó là Phase 7 và đang hoãn.

## Constraints

| Ràng buộc      | Giá trị                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Model STT      | Giữ `zipformer-vi` và `moonshine-en`. Không thay.                                                     |
| Suy luận       | CPU-first. Không GPU.                                                                                 |
| MT             | Gemini text API. Không dùng model Gemini Live.                                                        |
| Quyền riêng tư | Audio không rời máy chủ.                                                                              |
| Phạm vi        | Chỉ `apps/web` + đường `/translate` phía API. **Không** đụng `apps/extension`, **không** đụng mobile. |
| Chất lượng     | WER cuối lượt không được đổi.                                                                         |

## Non-goals

Thay model STT (đã benchmark, đã loại — xem
`plans/260916-1054-streaming-asr-diarization-benchmark/reports/results.md`).
Fine-tune ChunkFormer. Deepgram hay bất kỳ ASR cloud nào. Diarization streaming.
Dịch đồng thời mức từ _bên trong_ một mệnh đề chưa nói xong.

## Acceptance criteria

| Tiêu chí                                               | Ngưỡng                                                                       | Đo bằng                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------- |
| Phần chốt bị viết lại **trên DOM, không phải neo lại** | **0** vi phạm                                                                | Phase 6 task 6.3, `MutationObserver`  |
| Neo lại mỗi lượt                                       | **≤ 2**, tỉ lệ **≤ 0,5**/lượt                                                | Phase 6 task 6.3                      |
| Nhịp partial **vi→en**                                 | `refresh_ms_p95` của Phase 1 × 1,25                                          | Phase 6 task 6.2                      |
| Nhịp partial **en→vi**                                 | suy từ `decode_ms_p95` × tỉ lệ RTF                                           | Phase 6 task 6.2                      |
| Cập nhật bản dịch trên câu 2,5s **có đủ lời nói**      | **≥ 1**, trên ≥ 70% số lượt mỗi chiều; lượt chốt được < `N` ký tự không tính | Phase 6 task 6.4                      |
| WER cuối lượt                                          | **= 5,38% / 2,90%**, sai khác 0,00                                           | Phase 6 task 6.7                      |
| `quotaCooldowns` cộng dồn                              | **0**                                                                        | `TURN_METRICS_PATH`, Phase 6 task 6.5 |
| 503 của sidecar ở divisor 2                            | **0**                                                                        | Phase 6 task 6.6                      |
| Chi phí giải mã **phẳng** theo buffer 1→9s             | chênh **≤ 25%**, cả hai engine                                               | Phase 8 task 8.4                      |
| Nhịp partial khi TTS chạy cùng                         | **≥ 3 cập nhật/giây**, cả hai chiều                                          | Phase 8 task 8.4                      |
| Đóng mệnh đề → âm thanh đầu                            | _không áp dụng — Phase 7 hoãn_                                               | —                                     |

**Không tiêu chí nào ở đây là con số tự đặt.** Bản đầu có hai cổng chứng minh
được là không thể trượt và một tiêu chí mâu thuẫn với mặc định của chính nó; xem
`## Red Team Review`.

---

## Vì sao kế hoạch này tồn tại — chẩn đoán đã xác minh

Hệ thống hôm nay **không phải** turn-based hoàn toàn. STT partial đã chạy mỗi
~500–750ms và đã lên tới UI. Thứ khiến người dùng thấy "phải đợi nói hết câu" là
ba chốt chặn khác, tất cả đều đã đọc và xác minh trong code:

| Chốt chặn                                    | Vị trí                              | Hệ quả                                                                   |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `MIN_SPEECH_SECONDS = 3`                     | `live-translation-trigger.ts:25`    | Câu 2,5 giây — rất phổ biến — nhận **không một** bản dịch nào giữa chừng |
| `MAX_PER_TURN = 3`, `MIN_INTERVAL_MS = 2500` | `live-translation-trigger.ts:28,43` | Lượt 8 giây chỉ được 3 lần cập nhật                                      |
| Tiếng chờ `SPEECH_HANGOVER_MS = 500`         | `speech-gate.ts:29`                 | Không âm thanh nào phát ra trước khi người ta ngừng nói                  |

Nguyên nhân gốc của nhóm 1–2 **không phải kỹ thuật mà là quota**:
`translation-model-policy.ts:62` ghi số đo thật — _"the ceiling was 15/min in
total"_ trên một key, định danh `GenerateRequestsPerMinutePerProjectPerModel`.

### Hai bức tường quota

`docs/development-journey.md:874-880` chép bảng hạn mức thật từ dashboard: mỗi
`flash-lite` có **15 RPM** và **500 RPD** — **mỗi project**.

**Xoay key nhân được cả hai trần.** Comment đầu `gemini-translation-provider.ts:11-16`:
_"Keys issued from DIFFERENT projects therefore draw on separate buckets, and
rotating across them multiplies the ceiling."_ Và cặp (key, model) bị throttle
được ghi nhớ rồi bỏ qua (`recordFailure` → `keys.cool`), nên chỉ tốn một lần 429
cho mỗi key khi nó bão hoà, không phải mỗi request. Walk là model-major nên cả
sáu key đều được dùng trên `gemini-3.5-flash-lite` — đúng model của luồng live.

Người dùng khai (2026-09-16) `.env` có **6 key thuộc 6 project khác nhau**:

```
6 × 15 RPM  =   90 request/phút   cho luồng dịch giữa chừng
6 × 500 RPD = 3000 request/ngày
```

Ước tính độ mịn đạt được, với ~27 ký tự chốt mỗi giây khi đang nói và mật độ lời
nói 60%:

| `N`          | Cảm giác        | req/phút | Vừa 90?          | Phút/ngày trong 3000 RPD |
| ------------ | --------------- | -------- | ---------------- | ------------------------ |
| 40 ký tự     | theo mệnh đề    | ~27      | thoải mái        | ~110                     |
| **15 ký tự** | **theo cụm từ** | ~72      | **vừa, sát mép** | **~42**                  |
| 5 ký tự      | theo từng chữ   | ~216     | **không**        | ~14                      |

Ở mức cụm từ, **RPD mới là tường, không phải RPM**: ~42 phút hội thoại thật mỗi
ngày. Một ngày vừa tập duyệt vừa bảo vệ có thể chạm.

**Điều code không kiểm được:** `apps/api/.env.example:130-131` —
_"Same-project keys cannot be detected from here — that one is on you."_ Nếu hai
key chung project thì chúng chia một bucket và số nhân tụt. Phase 1 Task 1.4
Phần B bước 7 có một phép kiểm gián tiếp.

Và nhu cầu **hiện tại đã cao**: `:680` ghi `22,6 / 33,5 req/min` mỗi model — nhất
quán với việc pool nhiều project đang hoạt động. Ngân sách Phase 4 phải trừ nền
này, không đặt trên số 0.

Nguyên nhân của nhóm 3 là một quy tắc an toàn cố ý ở `live-preview.ts:97` —
_"a guess spoken aloud cannot be taken back"_.

## Bốn phát hiện làm kế hoạch này rẻ hơn dự kiến

1. **`clause-splitter.ts` đã chạy trong production.** Máy móc bẻ bản dịch theo
   mệnh đề rồi cho TTS phát gapless đã có, đã đo (TTFA 0,648s → 0,340s). Việc
   còn lại chỉ là cho nó bắt đầu chảy sớm hơn.

2. **Reducer client đã có ngữ nghĩa append-only** — _lịch sử, xem ghi chú cuối
   mục._ `transcript.liveDelta`
   (`turn-keyed-transcript.ts:290`) nhận `{sessionId, channel: 'source'|'target',
delta}` và **nối thêm** thay vì ghi đè — với chú thích _"the text already
   delivered is final and only grows"_. Nó được xây cho extension, đã có test ở
   `turn-keyed-transcript.spec.ts:270`, và web chưa dùng. Không phải xây mới.

   **Phát hiện này đã hết hiệu lực.** Phase 3 **không** dùng `transcript.liveDelta`.
   Nó dùng sự kiện mới `server.transcript.delta` mang **chuỗi tuyệt đối**, và
   reducer dựng lại cả dòng từ rỗng. Đổi vì red-team finding 4, rồi thành điều
   kiện sống còn khi cổng đo Phase 1 buộc phải cho phép neo lại — mà ngữ nghĩa
   chỉ-nối-thêm thì không thể neo lại. Giữ mục này làm lịch sử; **đừng ai nối dây
   `liveDelta` cho web.**

3. **Gemini đã stream sẵn.** `gemini-translation-provider.ts:289` gọi
   `generateContentStream` và lặp chunk, nhưng gom vào một chuỗi rồi trả một
   lần. Forward chunk ra ngoài **không tốn thêm request nào**.
   _Giới hạn đã đo, phải tôn trọng:_ comment ngay trên hàm ghi `chunks p50 = 1`
   — câu ngắn về trọn gói một chunk, nên cơ chế này giúp ở câu dài, không đủ
   một mình tạo cảm giác từng chữ.

4. **`zipformer-vi` là transducer**, chỉ đang bị gọi ở chế độ offline
   (`zipformer_vi.py:23` — `OfflineRecognizer.from_transducer`). Kiến trúc vốn
   đơn điệu; thứ tạo ra hiện tượng sửa chữ là **cách gọi** vứt trạng thái đi mỗi
   lần re-decode, không phải bản thân model.

---

## Kiến trúc đích

```
Âm thanh ──► [P3] STT partial ~300ms ──► [P2] LocalAgreement-2 chốt chữ
                                                │
                                      ┌─────────┴──────────┐
                                      ▼                    ▼
                       [P3] server.transcript.delta  [P4] MT theo mốc chốt
                          (chuỗi tuyệt đối, thay được)   │  token bucket + N
                                                          ▼
                                       [P5] forward chunk Gemini ──► màn hình

                                    [P7] clause-splitter ──► TTS   (HOÃN)
```

Phần chốt đi ra dây dưới dạng **chuỗi tuyệt đối**, không phải phần thêm, và chỉ
tới client đã bật `streamCommitted`. Cả hai là kết quả của red team.

## Phases

| #   | Tên                                                | Loại       | Chặn bởi | File                                                                                                                   |
| --- | -------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Đo cổng — ổn định tiền tố và quota thật            | **chỉ đo** | —        | [phase-01](phase-01-measurement-gate.md) — **XONG**                                                                    |
| 2   | `StreamingCommitter` (chốt + neo lại)              | code thuần | P1       | [phase-02](phase-02-streaming-committer.md) — **XONG**                                                                 |
| 3   | Nhịp STT + đẩy chữ đã chốt lên client              | tích hợp   | P2       | [phase-03](phase-03-commit-to-wire.md) — **XONG**                                                                      |
| 4   | Viết lại MT trigger — token bucket + `N`           | tích hợp   | P3       | [phase-04](phase-04-mt-commit-trigger.md) — **XONG**                                                                   |
| 8   | Chi phí giải mã phẳng — bỏ phép nhân của cổng duty | đo + code  | P2       | [phase-08](phase-08-flat-decode-cost.md) — **XONG**                                                                    |
| 6   | Nghiệm thu đầu-cuối                                | đo + gate  | **P8**   | [phase-06](phase-06-acceptance.md) — **XONG**, 10/10 ([reports/acceptance.md](reports/acceptance.md))                  |
| 5   | Forward chunk Gemini (P3, bỏ được)                 | tích hợp   | **P6**   | [phase-05](phase-05-delta-and-voice.md) — **XONG**, `chunks p50 = 2`                                                   |
| 7   | Nói theo mệnh đề đã chốt                           | đo + gate  | P6       | [phase-07](phase-07-speak-early.md) — **BỎ**, cổng đo bác ([reports/speak-early-gate.md](reports/speak-early-gate.md)) |

**Thứ tự thi công: `P1 → P2 → P3 → P4 → P8 → P6 → P5`.** Phase 5 chuyển xuống sau
nghiệm thu ở phiên validation — nó là phần đánh bóng có đường lui, nên nghiệm thu
phải chạy trên P3/P4 trước.

## Cổng hủy kế hoạch — ĐÃ NỔ, VÀ ĐÃ GIẢI (2026-09-16)

Phase 1 đã chạy và ghi **`PHÁN QUYẾT: DỪNG`** cho thiết kế Phase 2 **như đã
viết**. Cổng G2 chạm ở cả hai mức hold-back: `stall_p95_s` = 2,7s so với ngưỡng
2,0s — hơn 5% số lượt có một lần đứng im quá 2 giây (thực đo 14% ở hold-back 0,
10% ở hold-back 2). G1 không chạm.

Giả định chịu lực **không** bị bác bỏ: 86% số lượt tiền tố tiến đều. Cơ chế hỏng
hẹp và xác định được — bộ nhận dạng phát một âm tiết đầu sai nhưng ổn định qua
hai vòng, đủ để LocalAgreement-2 chốt, rồi mới sửa.

Chấm lại ngoại tuyến 8 biến thể trên cùng 598 snapshot cho thấy **không tham số
nào cứu được** (LA-3 còn 5/50; chờ 1,0s còn 6/50) và **neo lại cứu triệt để**:
0/50, p95 1,2s, WER phần chốt từ 0,1918 xuống 0,0717.

**Người dùng chốt (2026-09-16): cho neo lại, đổi tiêu chí nghiệm thu.** Phase 2
được thiết kế lại; kế hoạch đi tiếp. Chi tiết số: `reports/measurement.md`.

**Phase 1 có quyền dừng toàn bộ kế hoạch.** Giả định chịu lực của Phase 2–6 là
tiền tố của `zipformer-vi` tiến đều giữa hai lần re-decode. Điều đó **chưa từng
được đo**. Nếu nó sai — tiền tố đứng yên ở biên cửa sổ — thì phần chốt dồn cục và
trải nghiệm **tệ hơn hiện tại**: im lâu rồi chữ nhảy ra một cục.

Ngưỡng hủy ghi trong `phase-01`. Khi chạm, dừng và báo người dùng; không đi tiếp
vào Phase 2.

## Rủi ro đã biết

| #   | Rủi ro                                                                  | Giảm thiểu                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Tiền tố zipformer không ổn định                                         | Phase 1 là cổng hủy, đo trước khi viết code                                                                                                                                                                                                                                                                                 |
| R6  | Bộ nhận dạng sửa **dấu thanh** của từ đã chốt — **ĐÃ XÁC NHẬN LÀ THẬT** | P1 đo được: sửa dấu ở vị trí **đã chốt** xảy ra 8 lần trên 6 clip, và chính 6 clip đó gánh 32/71 ký tự chốt sai. Ngược lại `duplications` trong vùng chốt = **0** — ca `nguyên`/`nguyễn` đúng là lặp cụm trong một decode và **không** lọt vào vùng chốt. Hold-back **không** cứu được (5/50 vẫn hỏng); **neo lại** mới cứu |
| R2  | Nói ra chữ chốt sai thì không rút lại được                              | **Tách hẳn sang Phase 7 và hoãn.** Không thi công đợt này                                                                                                                                                                                                                                                                   |
| R3  | Phần chốt mâu thuẫn với bản decode cuối đọc cả lượt                     | **Không cần giảm thiểu ở đợt này.** Reducer đã xoá dòng live khi lượt kết thúc (`withoutLive`), nên bản cuối luôn thắng. `flush()` đã bị gỡ. Rủi ro này quay lại ở Phase 7                                                                                                                                                  |
| R4  | `N` quá nhỏ làm nổ quota                                                | Governor hai tầng per-user/global, khoá theo model — P4 task 4.2. **Không có trần ngày**: RPD được đo ở P6 task 6.5, không cưỡng chế                                                                                                                                                                                        |
| R7  | Một người nói liên tục khoá bản dịch của mọi người                      | Tầng per-user của governor — P4 task 4.2, ca test 2                                                                                                                                                                                                                                                                         |
| R8  | Sự kiện mới làm client bản cũ báo lỗi                                   | Opt-in `streamCommitted`, mặc định tắt — P3 task 3.4                                                                                                                                                                                                                                                                        |
| R9  | **Divisor 1** làm sidecar từ chối bằng 503 im lặng                      | Đo ở P8: hai người nói cùng lúc + lượt cuối + TTS liên tục, 388 request, **503 = 0**. Trần duty đã bỏ hẳn ở divisor 1 nên thứ chặn giờ là số lane, không phải hằng số. Cổng 503 = 0 ở P6 task 6.6 vẫn giữ; trượt thì trả divisor về 2                                                                                       |
| R5  | Cửa sổ trượt làm sụp cơ chế chốt                                        | Cửa sổ **9 giây** (phủ `MAX_UTTERANCE_MS` + `PRE_ROLL_MS`) nên nó không bao giờ trượt — P3 task 3.4, 3.5. **Giữ nguyên.** Phase 8 đã thử cho nó trượt có chủ ý kèm khâu theo chồng lấp chữ và cổng đo bác: khâu sai 15% chiều vi, không nối 37% chiều en. R5 đúng, và nay có số đo đứng sau                                 |

## Bất biến áp cho mọi phase

- **Không đụng `apps/extension` và mobile.** Kế hoạch này chỉ chạm `apps/web`,
  `apps/api`, `packages/types`, `packages/realtime-client`.
- **Không đổi model STT, không đổi weight, không tải model mới.**
- Mỗi phase kết thúc phải để `pnpm typecheck` và `pnpm lint` sạch.
- Không commit secret, không commit file `.env`.
- Commit theo conventional commit, **không** thêm dòng attribution AI nào.

## Counsel đã áp

Kế hoạch chạy dưới giám sát `kongming`. Counsel tìm ra ba defect trong bản nháp
đầu; cả ba đã được **kiểm chứng lại từ nguồn** trước khi sửa, và cả ba đều đúng.

| #   | Defect                                                                                                                                                                                                                         | Nguồn xác minh                                                                                 | Đã sửa ở                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Thu cửa sổ 8s→4s làm sụp neo của LocalAgreement. Web cắt lượt ở `MAX_UTTERANCE_MS = 8000` nên cửa sổ 8s **không bao giờ trượt** — đó là điều kiện khiến phép so tiền tố có nghĩa. Không vá được vì sidecar không trả timestamp | `use-streaming-translate.ts:50`; `services/local-stt/app.py:90` trả đúng `{"text","language"}` | P3 task 3.5 — cấm đổi cửa sổ, ghi bất biến vào comment                                                                                |
| D2  | Chỉ tính RPM, bỏ sót **RPD 500/model**. Và mặc định 12 req/phút nằm **dưới** nhu cầu hiện tại 22,6–33,5                                                                                                                        | `development-journey.md:874-880` và `:680`                                                     | P4 task 4.1 — mặc định suy từ chi tiêu nền đo được. _Cách sửa ban đầu (thêm trần ngày + dự trữ) đã bị red team bác; xem finding 2, 3_ |
| D3  | Luật kích hoạt theo mệnh đề **không chạy được với tiếng Việt** vì nguồn không có dấu câu                                                                                                                                       | `zipformer_vi.py:34-47`; `clause-splitter.ts` `BOUNDARY`                                       | P4 task 4.4 — đảo thứ tự luật, ghi rõ lý do                                                                                           |

Thêm một điều chỉnh về kiến trúc: counsel chỉ ra tầng TTS **không phải phần đi
kèm** của Phase 5 mà là thay đổi riêng — nói mệnh đề giữa chừng buộc bản dịch
cuối lượt phải là bản **đuôi**, làm hỏng tính khớp byte mà `TurnSpeculation` dựa
vào để tái dùng 3 trên 4 lượt. Mất tái dùng là **tăng** request, đúng thứ D2
đang phải bóp. Đã tách sang Phase 7 và hoãn.

### Chỗ kế hoạch KHÔNG theo counsel, và lý do

**Counsel đề nghị cắt hẳn Phase 5** (forward chunk Gemini) vì `chunks p50 = 1`.
Kế hoạch giữ lại nhưng hạ xuống **P3 và ghi rõ là bỏ được**. Lý do: con số p50=1
được đo trên lượt một câu ở chính sách cũ, mà Phase 4 đặt trần RPD nên mỗi
request phải gánh nhiều chữ hơn, và output dài hơn thì Gemini chia nhiều mẩu
hơn. Đó là **suy luận chứ không phải số đo**, nên Task 5.5 bắt **đo lại**
`chunks p50` dưới chính sách mới và đề xuất revert nếu vẫn ra 1.

**Counsel đề nghị bỏ `N` cấu hình tới mức từng chữ.** Người dùng đã nêu yêu cầu
mức từng chữ hai lần, nên kế hoạch **không tự bỏ**. Thay vào đó `N` giữ là config
với **sàn cứng 12 ký tự**, và comment tại chỗ ghi rằng đường tới mức từng chữ là
nâng quota chứ không phải hạ sàn. Quyết định cuối thuộc về người dùng, có số
RPD trên bàn.

### Vị trí so với hai brainstorm trước

Counsel hỏi kế hoạch này đứng ở đâu so với `brainstorm-260916-0948` và bản phụ
lục của nó. Trả lời, để người sau không phải suy:

**S-A so với S-B.** Phụ lục của brainstorm 0948 chuyển v1 sang **S-B** và ghi rõ
là _"chỉ cho làn tiếng"_. Kế hoạch này làm **S-A** (stable-prefix commit) cho làn
**chữ**, và hoãn làn **tiếng** sang Phase 7. Nên hai lựa chọn **không đụng nhau
trong đợt này** — câu hỏi S-A/S-B chỉ sống lại nếu Phase 7 được mở. Ghi ra đây
để việc chọn S-A là **có chủ đích**, không phải quên mất phụ lục.

**Must-fix #4 được khôi phục.** Brainstorm 0948 mục must-fix #4 yêu cầu _"thêm
spike phủ định giả định chịu lực"_ vì A6 chỉ đo **sau** khi build; phụ lục sau đó
vô hiệu mục này. **Phase 1 chính là spike đó** — nó phủ định giả định trước khi
một dòng code sản phẩm nào được viết, và có quyền hủy cả kế hoạch. Must-fix #4
coi như đã khôi phục bằng cấu trúc, không phải bằng lời hứa.

**Hướng C của brainstorm 1033 (đẩy `windowStart` qua phần đã chốt) không nằm
trong đợt này.** Nó hứa hẹn giảm chi phí mỗi tick vì chỉ decode phần đuôi chưa
chốt, nhưng nó cũng vứt đi audio cần thiết nếu chốt sai. Kế hoạch này giữ cửa sổ
8 giây cố định — bảo thủ hơn, và là điều kiện của bất biến neo cửa sổ ở P3 task
3.5. Hướng C là tối ưu hoá cho sau, sau khi Phase 6 có số thật.

## Red Team Review

### Session — 2026-09-16

**Findings:** 20 (20 accepted, 0 rejected)
**Severity breakdown:** 11 Critical, 7 High, 2 Medium
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic (Full tier — 7 phases)
**Báo cáo đầy đủ:** `redteam-{security,scope,failure,assumption}.md` trong scratchpad của phiên, 110.760 bytes.

| #   | Finding                                                                                    | Severity | Disposition | Applied To |
| --- | ------------------------------------------------------------------------------------------ | -------- | ----------- | ---------- |
| 1   | Bucket global không phân vùng; xoá tầng per-client, trái khuôn `turn-concurrency.ts:27,45` | Critical | Accept      | Phase 4    |
| 2   | Budget chỉ đếm live; speculation ×4, final, REST không đếm; reset khi restart              | Critical | Accept      | Phase 4    |
| 3   | `LIVE_TRANSLATION_MODELS[0]` ≡ `FINAL_MODELS[0]` → "dự trữ" không dự trữ gì                | Critical | Accept      | Phase 4    |
| 4   | `partial` ghi đè `text` không động `committedChars` → phần chốt biến đổi trên màn hình     | Critical | Accept      | Phase 3    |
| 5   | `markStarted(transcript)` lệch đơn vị → luật đếm ký tự chết sau một lần                    | Critical | Accept      | Phase 4    |
| 6   | Payload vẫn gửi hypothesis thô, không phải phần chốt                                       | Critical | Accept      | Phase 4    |
| 7   | Hold-back dựng trên bằng chứng đọc sai                                                     | Critical | Accept      | Phase 2    |
| 8   | Ngưỡng 350ms bất khả thi cho en→vi; P6 chỉ đo tiếng Việt                                   | Critical | Accept      | Phase 3, 6 |
| 9   | Cổng 429 grep chuỗi không tồn tại → không thể trượt                                        | Critical | Accept      | Phase 4, 6 |
| 10  | Cổng "0% viết lại" kiểm sự kiện server, không kiểm DOM → không thể trượt                   | Critical | Accept      | Phase 6    |
| 11  | Harness Phase 1 lệch 4 chỗ so với production, tất cả thiên lạc quan                        | Critical | Accept      | Phase 1    |
| 12  | Cổng hủy chạy trên corpus không chứa được hiểm hoạ (VIVOS max 6,44s)                       | Critical | Accept      | Phase 1    |
| 13  | Bất biến neo cửa sổ sai số học: bỏ sót `PRE_ROLL_MS = 320`                                 | High     | Accept      | Phase 3    |
| 14  | Bất biến do client giữ; server nhận `MAX_TURN_SECONDS = 60`                                | High     | Accept      | Phase 3    |
| 15  | Sự kiện mới làm extension bản cũ báo lỗi qua `safeParse`                                   | High     | Accept      | Phase 3    |
| 16  | Xoá `spentCount` phá `turn-timeline.ts:107` — đúng hàng metric P6 cần                      | High     | Accept      | Phase 4    |
| 17  | `onQuotaCooldown`→`penalize()` không có đường nối; provider dùng chung với REST            | High     | Accept      | Phase 4    |
| 18  | `TurnSession` có 5 nơi khởi tạo, plan kể 1                                                 | High     | Accept      | Phase 4    |
| 19  | Phase 5 delta nối vào bản dịch trước → `"HelloHello there"`                                | High     | Accept      | Phase 5    |
| 20  | Divisor 3→2 nâng áp lực lane 50% trên semaphore 4 lane với 503 im lặng                     | Medium   | Accept      | Phase 3, 6 |
| —   | `pnpm dev:stop` không dừng `turbo run dev`, và giết container đã chạy sẵn                  | Medium   | Accept      | Phase 6    |
| —   | `flush()` là máy móc chết — reducer đã gọi `withoutLive` khi lượt kết thúc                 | Medium   | Accept      | Phase 2    |
| —   | Nhánh đối chứng cửa sổ 4s không đổi được quyết định nào                                    | Medium   | Accept      | Phase 1    |

### Ba lỗi nghiêm trọng nhất đều cùng một loại

Cả ba đều là **plan nói sai về codebase mà người viết đã đọc**, và không lỗi nào
lộ ra ở typecheck, lint, hay test:

1. Trích `translation-model-policy.ts` để biện minh cho một sự cô lập model mà
   file đó không nói. File nói về speculation-so-với-final; plan đọc thành
   live-so-với-final.
2. Viết một cổng nghiệm thu grep một trường không tồn tại trong `TurnMetrics`,
   rồi tự thêm câu "chấp nhận 0 là đạt".
3. Đếm 1 nơi khởi tạo `TurnSession` khi có 5.

### Hai đề nghị của reviewer KHÔNG được áp, kèm lý do

**"Cắt hẳn Phase 5"** (vì `chunks p50 = 1`). Giữ lại ở P3, đánh dấu bỏ được, và
Task 5.5 bắt **đo lại** `chunks p50` dưới chính sách mới rồi đề xuất revert nếu
vẫn ra 1. Lý do: p50=1 đo trên lượt một câu ở chính sách cũ, mà `N` mới làm mỗi
request gánh nhiều chữ hơn. Đó là suy luận, nên phải đo chứ không kết luận.

**"Bỏ `N` cấu hình tới mức từng chữ"**. Người dùng đã nêu yêu cầu mức từng chữ
hai lần. `N` giữ là config với sàn cứng 12 ký tự, và comment ghi rõ đường tới mức
từng chữ là nâng quota chứ không phải hạ sàn. Quyết định cuối thuộc về người dùng.

### Whole-Plan Consistency Sweep — 2026-09-16

Chạy sau khi áp 20 finding. Quét mọi file plan tìm thuật ngữ cũ, giả định đã bị
bác, tên field đã đổi, và chi tiết thi công đã bị thay.

| Kiểm                                         | Kết quả                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `committedDelta` (tên field cũ)              | 3 lần, **đều trong phần giải thích "bản đầu làm gì"** — giữ               |
| `350ms`                                      | 4 lần, đều là dẫn chiếu lịch sử hoặc dòng finding — giữ                   |
| `spendFinal` / `penalize` / `requestsPerDay` | chỉ trong bảng "đã bỏ" và trong lệnh `grep -c ... = 0` của Task 4.2 — giữ |
| "cửa sổ 4 giây"                              | chỉ trong mục "vì sao đã bỏ nhánh này" của Phase 1 — giữ                  |
| "nơi duy nhất"                               | chỉ trong mục sửa sai của Phase 4 — giữ                                   |
| `holdBackSyllables: 2`                       | chỉ trong ca test 11 (bật tường minh) và mục bằng chứng bị đọc sai — giữ  |
| `LIVE_TRANSLATION_RPD`                       | **0 lần** — đã gỡ sạch                                                    |
| Bảng "Counsel đã áp" dòng D2                 | **SỬA** — còn ghi cách sửa cũ đã bị red team bác                          |
| Liên kết `plan.md` → `phase-*.md`            | 7/7 phân giải được                                                        |
| Frontmatter + Failure Protocol               | 7/7 phase có đủ                                                           |
| Tiêu chí nghiệm thu ↔ mặc định `N`           | nhất quán: cả hai giờ suy từ `commit_rate` của Phase 1                    |
| Cổng có thể trượt                            | 3/3 cổng từng không thể trượt nay đã có nguồn số thật                     |

**Không còn mâu thuẫn chưa giải quyết.**

## Validation Log

### Session 1 — 2026-09-16

**Câu hỏi:** 4 (bước xác minh bỏ qua theo guard — `## Red Team Review` đã có bằng
chứng `file:line` đầy đủ; quét `[UNVERIFIED]` ra 0).

| #   | Quyết định                 | Chọn                                                                                                   | Áp vào                         |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | Độ mịn `N`                 | **Cụm từ, `N ≈ 15`** — ~72 req/phút, ~42 phút/ngày. Chấp nhận RPD sát mép để đổi lấy cảm giác realtime | P4 task 4.1, plan.md Outcome   |
| 2   | `PARTIAL_DUTY_DIVISOR` 3→2 | **Giữ**, có cổng 503 = 0 ở P6 task 6.6; trượt thì tự trả về 3                                          | không đổi (đã đúng)            |
| 3   | Corpus Phase 1             | **Chỉ VIVOS**, ghi rõ ba thiên lệch. Từ chối ghi thêm lời nói thật để đổi lấy tốc độ                   | P1, mục "Corpus"               |
| 4   | Phase 5                    | **Giữ nhưng chạy sau P6**, Task 5.5 đo lại rồi quyết giữ hay revert                                    | P5/P6 frontmatter, bảng Phases |

**Hệ quả của #1 phải ghi rõ:** `N = 15` cho ~42 phút hội thoại mỗi ngày trên 3000
RPD. Một ngày vừa tập duyệt vừa bảo vệ có thể chạm trần. `N` là biến môi trường
nên đổi được giữa hai buổi mà không cần build lại — đó là đường lui nếu cần.

**Hệ quả của #3:** cổng hủy Phase 1 đo trên giọng đọc, clip tối đa 6,44 giây. Nó
**không** chứng minh được hành vi trên lượt dài chạm trần 8 giây hay trên lời nói
có ngập ngừng. Hiểm hoạ lượt dài được xử bằng thiết kế (cửa sổ 9s + chốt chặn
server), và Phase 6 là nơi đầu tiên gặp lời nói thật.

### Whole-Plan Consistency Sweep — sau Session 1

| Kiểm                                                   | Kết quả                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Chuỗi phụ thuộc theo thứ tự `1→2→3→4→6→5`, `7` sau `6` | **Không vòng lặp, không phase nào bị chặn**                            |
| `dependencies: [5]` còn sót                            | 0 lần                                                                  |
| P6 đếm `server.translation.delta`                      | chỉ còn **một** dẫn chiếu, là câu giải thích _vì sao chưa đếm nó_      |
| `N` trong Outcome, P4 task 4.1, tiêu chí nghiệm thu    | ba chỗ đều là 15, nhất quán                                            |
| Ngưỡng cảnh báo RPD                                    | đã hạ từ 60 xuống **30 phút** để khớp việc người dùng đã chấp nhận ~42 |
| Corpus Phase 1                                         | quyết định "chỉ VIVOS" ghi tường minh kèm câu cấm tự ý đổi             |
| Liên kết `plan.md` → `phase-*.md`                      | 7/7 phân giải được                                                     |
| Frontmatter + Failure Protocol                         | 7/7 phase có đủ                                                        |
| `[UNVERIFIED]` / TODO / TBD                            | 0                                                                      |
| Placeholder `<giá trị tính ở bước 3>`                  | 2 lần, **có chủ đích** — điền từ số đo Phase 1                         |

**Không còn mâu thuẫn chưa giải quyết. Kế hoạch đủ điều kiện thi công.**

## Câu hỏi chưa giải quyết

1. **Đặt `N` ở mức nào** — phụ thuộc Phase 1 task 1.4 (số project thật). Kế
   hoạch để `N` là config với sàn cứng 12 ký tự và mặc định 40.
2. **Ở mức cụm từ, 3000 RPD cho ~42 phút hội thoại mỗi ngày.** Đủ hay không phụ
   thuộc ngày bảo vệ có kèm tập duyệt không. `N` là biến môi trường nên đổi được
   giữa hai buổi: `N` lớn khi tập, `N` nhỏ khi bảo vệ. Phase 4 Task 4.1 bước 4
   tính lại con số này từ số đo thật và cảnh báo nếu dưới 60 phút.
   _Không_ khuyến nghị cho luồng live dùng thêm `gemini-3.1-flash-lite` để nâng
   lên 180 RPM: đó là model speculation đang dùng, và repo đã đo hiện tượng dồn
   cục khi chúng chung model.
3. **Có mở Phase 7 (nói sớm) không** — hoãn cho tới khi nghiệm thu Phase 6 xong
   và người dùng nghe thử bản chỉ-hiển-thị.
4. Hai việc tồn đọng ngoài kế hoạch này: ghi kết quả benchmark âm tính vào
   `docs/development-journey.md`, và commit thư mục `benchmarks/stt/`.
