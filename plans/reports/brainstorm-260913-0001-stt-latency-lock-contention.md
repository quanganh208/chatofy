---
type: brainstorm
mode: --ultra (best-of-5 verifier, same-tier)
date: 2026-09-13
slug: stt-latency-lock-contention
status: contract accepted; ready for ak:plan -> ak:cook
branch: main
---

# STT "quá chậm, mất từ mất nội dung" — brainstorm contract (ultra best-of-5)

## Kết luận một dòng

STT **không** chậm. Sidecar STT **serialize mọi decode sau một `threading.Lock()` mỗi engine**
(`services/local-stt/engines/base.py:63`) trong khi api bơm rất nhiều decode mỗi lượt
(partial re-decode mỗi 300ms + tối đa 4 speculation không cancel + final). Request đơn lẻ
70–200ms nhưng xếp hàng FIFO trong sidecar, nên máy rảnh ~72% mà độ trễ vẫn leo và client
âm thầm bỏ audio → "mất từ, mất nội dung". Tunnel Cloudflare (~57ms steady-state) KHÔNG phải nút cổ chai.

## Bằng chứng đo trực tiếp trên prod (read-only)

- STT warm 1 request: vi 6.16s→70–80ms; en 5.57s→135–200ms; transcript đúng. RTF ~0.012–0.025.
- Serialize CHỨNG MINH: 6 request song song ≈ 6 tuần tự (en 0.788s vs 0.839s; vi 0.382s vs 0.457s).
  Latency dưới 6-way = bậc thang FIFO 0.18/0.31/0.44/0.57/0.71/0.84s (~131ms/bước); request thứ 6 trả giá 6×.
- Burst 12 sâu: CPU đỉnh 447% một core (~4.5/16), load 0.60, RAM ~0.7GiB/4GiB. Máy rảnh ~72% khi xếp hàng.
  CPU thấp + trễ cao = chữ ký của lock contention, không phải bằng chứng loại trừ.
- Cadence thật (cửa sổ 8s, mục tiêu 300ms): 1 và 2 luồng partial giữ ~296ms; 3 luồng thì en vỡ
  (cadence ~500ms, chỉ 16/27 update = mất 41%), vi vẫn giữ. Solo 8s: vi 89–102ms, en 177–202ms.
- Tunnel: reused-connection 55–64ms; loopback 0.4–1.3ms; edge RTT 21.8ms/0% loss.
  Con số 207/978ms đo lúc đầu là chi phí TLS/QUIC handshake mỗi kết nối mới, không phải steady-state.
- `capturing` là MỘT field mỗi socket (`turn-pipeline.ts:169,243,326`) → mỗi socket chỉ 1 lượt sinh partial.
  "3 luồng partial đồng thời" = 3 user, không phải 1 user với MAX_IN_FLIGHT=3.
- Không timeout ở BẤT KỲ call nào (STT/embed/TTS/Gemini). `TURN_METRICS_PATH` KHÔNG set trên prod
  → production không có bản ghi latency từng lượt nào.

## Provenance (ultra)

5 candidate độc lập (Opus) trong MỘT wave; verifier chấm theo rubric + ground-truth controller đã đo.

- **Verifier chạy same-tier (Opus), KHÔNG phải strongest-model:** `claude-fable-5-1` trả 503
  (gateway hết kênh) 2 lần, rồi thêm 1 lần lỗi gateway giữa chừng. Đây là best-of-5 same-tier
  (mẫu độc lập + chọn theo rubric), không có lợi thế "verifier mạnh hơn candidate".
  Reject-all và chấm theo bằng chứng vẫn bắt buộc và vẫn được áp dụng.
- Xếp hạng: **A > D > C > B > E** (74/71/70/69/48 trên 80). Reject-all KHÔNG kích hoạt.
  Winner = A, materialize NGUYÊN VẸN (không trộn).

---

# HỢP ĐỒNG GIAO VIỆC ĐÃ CHỌN (winner, nguyên văn)

## 1. Outcome

A conversation on prod keeps up with continuous speech: live transcript advances while talking, final translation arrives on the repo's measured dev budget, no captured audio discarded without a record. Operationally: STT sidecar decodes IN PARALLEL instead of one-at-a-time-per-engine; api stops spending most of the engine re-decoding the same audio; every outbound dependency call has a deadline; prod writes a per-turn latency record so the claim is checkable.

## 2. Constraints (verified)

- Models fixed. vi Zipformer CC-BY-NC-ND-4.0 (zipformer_vi.py:6). No model swap, no OnlineRecognizer.
- MEMORY is the binding limit on parallelism, not CPU. Docker VM total 7.553GiB (verified docker stats), not host 32GB. Current: local_tts 1.94GiB, local_stt 747MiB. STT mem_limit 4g. Per-engine weights 223MB(vi)+418MB(en); each extra decode lane ~641MB.
- 16 cores. LOCAL_STT_THREADS=4, LOCAL_TTS_THREADS=4. STT lanes x 4 threads must leave TTS its 4.
- Sidecar single-worker uvicorn (Dockerfile:50), no --workers.
- No timeout env convention exists. Deadlines go in constants beside their reasoning.
- Prod read-only for this task.
- OfflineRecognizer concurrency safety is an ASSUMPTION not a measurement (base.py:52-56). Fix must not bet on it.
- KISS/DRY, kebab-case, modularize >200 LOC, conventional commits, no AI trailers, docs in docs/.

## 3. Non-goals

Replacing/adding streaming recognizer; rewrite; reconnect/backoff/resend (translate-socket.ts:91-131); echo/fullDuplex trade (documented accepted, use-streaming-translate.ts:349-355); Gemini key/project audit and Gemini latency itself; retuning MAX_UTTERANCE_MS/MAX_IN_FLIGHT/MAX_CONCURRENT_TURNS_*/MAX_PENDING_MS/MAX_REFUSAL_RETRIES; enforcePendingCeiling excluding capturing turn (:545); refusing speculate() on waiting turn (:274); TTS sidecar and /embed lock.

## 4. Acceptance criteria

A. Parallelism exists. New services/local-stt/test_concurrency.py (skippable via LOCAL_STT_SKIP_MODEL_TESTS=1): 6 concurrent /transcribe same engine <= 0.45x serial wall (today en 0.94x, vi 0.84x).
B. FIFO staircase gone. Re-run 6-way en burst; p95 <= 2x solo (<=300ms), max spread <=2x.
C. Partial decodes duty-bounded. partial-transcript-scheduler.spec.ts: after decode d ms, next read refused until max(300, 3xd) since previous START. 277ms en -> >=831ms; 114ms vi -> 342ms.
D. Nothing on dependency path can hang. Unit test per provider: stub never responds -> ProviderConnectionError within constant. Every fetch( in providers/local-speech passes signal; Gemini client passes httpOptions.timeout (grep, 0 misses).
E. Prod has a latency record. TURN_METRICS_PATH set in compose w/ writable volume; JSONL rows exist; analyze-continuous.mjs runs.
F. On a real 3-min two-speaker prod session: capture-ratio (capturedMs/speechMs, speechMs from vad-reference.mjs) >= 0.98; heldMs <= 1% of capturedMs; give-ups after MAX_REFUSAL_RETRIES = 0; dropped_pending = 0.
NOTE: F only trustworthy after the sentMs fix (5.E): analyze-continuous.mjs reads client.capturedMs from turn.sentMs, which today advances even when the socket silently drops the frame.
G. Headline: stop->first audio p50<=1500ms, p95<=3500ms (dev 1163/2983 + ~57ms tunnel each way). STT stage p95<=300ms.
H. Memory holds. docker stats after session: local_stt <2.5GiB (limit 4g); VM total <6GiB of 7.553. No OOM in docker events.
I. pnpm -w test green; pytest in services/local-stt green.

## 5. Recommended direction (five changes; first two carry the fix)

A. Sidecar POOL of recognizers per engine, replacing the single lock. base.py: delete _lock/_recognizer (:62-63) and the with-block (:88); hold a queue.Queue of N recognizers; transcribe() get(timeout)/put() in finally. N from LOCAL_STT_POOL (default 2). On acquire timeout raise -> app.py maps HTTP 503 (overload visible, not an invisible queue). Abstract load()->build_recognizer() returning one; base load() calls N times. zipformer_vi.py:20-32 & moonshine_en.py:16-26 become one-line edits. compose: LOCAL_STT_POOL=${PROD_LOCAL_STT_POOL:-3}. Arithmetic: 3 lanes x 641MB ~1.9GB + ~110MB ~2.0GiB under 4g; 3x4 threads=12 cores leaving 4 for TTS.
B. API partial cadence stretches with decode cost. partial-transcript-scheduler.ts: markSettled() records now()-lastStartedAt as lastDecodeMs; shouldStart requires now()-lastStartedAt >= max(cadenceMs, DUTY_DIVISOR*lastDecodeMs), DUTY_DIVISOR=3. NO call-site change. This is the repo's own measured but unimplemented conclusion (development-journey.md:903 "nhip re-decode phai gian theo do dai buffer, khong co dinh"). Bounds each capturing turn to <=1/3 of one lane, self-tuning per machine & language.
C. One speculation in flight per turn. turn-speculation.ts: canRenew (:33-40) also false while current guess unsettled; start (:42-55) marks settled via its existing work promise. Caps uncancellable waste at one full-turn decode/turn instead of 4.
D. Deadlines on every outbound call. providers/local-speech/{stt,embedding,tts}: signal: AbortSignal.timeout(...), map AbortError->ProviderConnectionError. STT 10s, TTS 15s. gemini/key-rotation.ts:75 httpOptions.timeout 20s. Removes "hung dependency pins a global slot forever" -> NO idle-sweep change needed.
E. Make loss recorded not silent. compose TURN_METRICS_PATH+volume; translate-socket.ts:134-137 send() returns whether frame went out; turn-pipeline.ts:255-262 advance sentMs/sequence only on success else hold; :252-254 orphaned-block path adds to discardedMs; turn-keyed-transcript.ts:189,193 add 'dropped_pending' to UnheardReason+UNHEARD_REASONS.

### Three corrections to the packet (verified in source)

1. PARTIAL LOAD IS PER SOCKET, NOT PER IN-FLIGHT TURN. pushAudio and speculate() both read the single this.capturing (turn-pipeline.ts:252,271) -> exactly ONE turn per socket generates partials; the other <=2 in-flight are translating. Packet's "x3 => ~135%" overstates. Recomputed from the repo table: one en socket spends ~64% of one lane on partials, ~3% finals, ~10% speculations => ~78% of one lane per English speaker. Two speakers exceed the single lock; three overrun ~2x. Direction unchanged, numbers changed.
2. DEFAULT_WINDOW_SECONDS=8 never engages on web: MAX_UTTERANCE_MS=8000, so every partial decodes the whole turn so far. Shrinking window would truncate the displayed transcript; cadence is the right knob.
3. Docker VM is 7.553GiB not 32GB host RAM; caps the pool at 3.

## 6. Options considered

Option 1 (recommended) pool + cost-adaptive cadence. Depends on peak RSS/decode staying near 223/418MB so 3 lanes fit 4g. Fails first if concurrent decodes allocate materially more -> OOM-kill of the sidecar (total STT outage, worse than slow). Mitigated: LOCAL_STT_POOL env-tunable, criterion H; ship at 2, raise to 3 after measuring. Worst case: ORT thread pools oversubscribe, pool delivers ~2x not 3x -- even then cadence fix alone cuts partial load ~3x, so combo clears a 2-speaker load.
Rejected sub-variant: just delete the lock, rely on ORT session thread-safety. Cheapest, zero memory. base.py:52-56 records safety as an assumption; worst case silent transcript corruption or native abort. Garbage text worse than late text. Keep only behind a measurement, not as the fix.
Option 2: uvicorn --workers 3 + cadence. Zero Python change. Each worker keeps its OWN invisible FIFO, no place to bound/shed; hung request blocks that worker's threadpool. Worst case: same symptom returns at 2-3x load, still undiagnosable (no queue depth, no 503). Triples model-load on restart, duplicates embedder. Rejected.
Option 3: micro-batching decode_streams([...]). Fails first with ONE active speaker (the reported case): batch size 1, throughput unchanged, plus an added batch-wait latency floor. Rejected.

## 7. Unresolved risks / questions

1. No live traffic observed at diagnosis. Root cause proven structurally+arithmetically, NOT confirmed against a recording of the actual failing session. F/G require reproducing the complaint before the fix. If pre-fix capture-ratio already >=0.98, the loss has another source and this contract doesn't close the report.
2. How many speakers/sockets were live when the user complained? One en speaker ~78% of one lane = bad tails, not heavy loss. Two-three = saturation. If one, expect a second cause (unbounded Gemini tail, max 8943ms, leading candidate).
3. Peak RSS under concurrent decode unmeasured; must measure before raising LOCAL_STT_POOL past 2 in prod.
4. OfflineRecognizer thread-safety unknown; pool sidesteps it.
5. DUTY_DIVISOR=3 is a UX trade (en partials ~300ms->~831ms between updates). Worth the user's opinion.
6. Gemini becomes the bottleneck after this (p50 723 of 1163 total). Criterion G set against that reality.
7. TURN_METRICS_PATH writes user-derived rows to disk; confirm location & no transcript text.
8. 3 lanes x4 + 4 TTS = 16 exactly; a simultaneous STT+TTS burst has no slack. If contention, drop LOCAL_STT_THREADS to 3.

---

# Phụ lục xếp hạng ultra (lưu vết — KHÔNG phải chỉ thị trộn)

| Candidate      | Faithful | Evidence | Acceptance | Honesty | Total /80 |
| -------------- | -------- | -------- | ---------- | ------- | --------- |
| **A (winner)** | 19       | 17       | 19         | 19      | **74**    |
| D              | 19       | 16       | 17         | 19      | 71        |
| C              | 19       | 15       | 18         | 18      | 70        |
| B              | 18       | 17       | 17         | 17      | 69        |
| E              | 14       | 12       | 11         | 11      | 48        |

Vì sao A thắng: contract duy nhất tính đúng ĐƠN VỊ dung lượng (per-socket, không phải
per-in-flight-turn), và duy nhất có tiêu chí e2e nói rõ capture-ratio chỉ đáng tin sau khi sửa
`sentMs` over-report ở client — kèm bộ sửa chạm cả cung (pool) lẫn cầu (cadence) và để lại
bản ghi latency để kiểm chứng.

Ý tưởng mạnh nhất ở mỗi non-winner mà winner THIẾU (cân nhắc khi plan, không tự động trộn):

- **B:** đặt tên vòng lặp dương — cadence gate neo vào `lastStartedAt` + guard in-flight, nên khi
  decode >= cadence thì per-turn duty vọt lên 100% (decode chậm mua cho scheduler PHẦN LỚN HƠN của lane).
  Verifier xác nhận trong source; docstring của class nói ngược lại. A sửa cùng hàm nhưng không gọi tên
  vòng lặp và không sửa comment sai.
- **C:** invariant liên tầng `MAX_CONCURRENT_PARTIAL_DECODES < LOCAL_STT_POOL_SIZE`, assert lúc api
  khởi động → ĐẢM BẢO final luôn có recognizer rảnh, thay vì chỉ "xác suất cao".
- **D:** đo thread-safety bằng thí nghiệm ~20 dòng TRƯỚC khi trả giá — nếu một `OfflineRecognizer`
  an toàn concurrent thì pool thu về `Semaphore(N)` với 0 memory thêm, xoá toàn bộ rủi ro OOM.
  (Á quân từ D: bắt được `docker stats` 2.01GiB ban đầu là page cache, tụt về 744MiB.)
- **E:** dữ kiện oversubscription — pool8×threads2 đo CHẬM HƠN pool4×threads2 → lanes×threads có
  cực trị nội tại quanh (tổng software threads ≈ số core); và tiêu chí "transcript byte-identical
  trước/sau" mà không contract nào khác có.

---

# Ghi chú controller (đối chiếu — KHÔNG sửa contract)

1. **Số học của A cần hiệu chỉnh nhẹ.** A ước ~78% một lane / 1 speaker en ⇒ 2 speaker là vỡ.
   Nhưng đo thật: 1 VÀ 2 luồng partial vẫn giữ cadence ~296ms; chỉ 3 luồng mới vỡ en.
   Tức chi phí mỗi partial của A cao ~2×; ngưỡng thật là ~3 socket en đồng thời, không phải 2.
   Hướng đi của A không đổi; chỉ mục tiêu criterion G và câu "bao nhiêu speaker mới vỡ" phải đọc
   theo số đo này. A tự nêu đúng câu hỏi này ở risk #2.
2. **1 user vẫn có thể mất nội dung** dù chưa tới 3 socket: 1 lượt capturing (partials) + tối đa 4
   speculation không cancel + final của lượt vừa đóng cùng dồn lên 1 lock; cộng đuôi Gemini không
   timeout (max 8943ms) đẩy các lượt dồn lại → `too_many_turns` → client bỏ nguyên buffer.
   Nên "lúc tệ nhất có mấy người nói" quyết định STT-pool có đủ, hay phải ưu tiên timeout Gemini
   và fix loss phía client trước.
3. **Đòn rẻ nhất, chưa làm (chờ đồng ý):** prod đang `LOCAL_STT_THREADS=4` (dev 8) vì compose giả
   định dev+prod chia 16 core — nhưng hiện chỉ stack prod chạy. Vì lock mỗi lúc chỉ 1 decode, nâng
   lên 8 làm mỗi decode nhanh hơn và hàng đợi rút nhanh hơn. Cần restart container nên chưa đụng.

---

# Đo bổ sung sau brainstorm (2026-09-13, prod, đã revert)

## 1. `LOCAL_STT_THREADS` đã TỐI ƯU ở 4 — nâng lên 8 làm CHẬM HƠN

Giả thuyết "đòn rẻ nhất: nâng 4→8" **bị số đo phủ nhận**. Đã thử và revert; prod trở lại nguyên trạng.

| threads          | vi 8s solo | en 8s solo | en 3-concurrent wall |
| ---------------- | ---------- | ---------- | -------------------- |
| 1                | 124ms      | 276ms      | 820ms                |
| 2                | 94ms       | 203ms      | 605ms                |
| 3                | 89ms       | 189ms      | 568ms                |
| **4 (hiện tại)** | **83ms**   | **192ms**  | **581ms**            |
| 8                | 100–114ms  | 227–252ms  | —                    |

Ở threads=8, mọi chỉ số xấu đi: en solo 135–145ms → 195–228ms; 6-deep wall 0.788s → **1.190s**;
cadence 3 luồng en 500ms → **667ms** (update 16/27 → **12/27**, mất 56% thay vì 41%);
CPU đỉnh 447% → **1325%** (đốt nhiều CPU hơn để chạy chậm hơn), load 0.60 → 4.71.
→ Đây là oversubscription intra-op của ONNX Runtime trên model INT8 nhỏ: chi phí đồng bộ
vượt lợi ích song song hoá.

**Hệ quả cho thiết kế:** hướng đúng là **ÍT thread mỗi decode, NHIỀU decode đồng thời**
(đúng chiều pool trong contract), không phải nhiều thread hơn cho một decode.
`threads=3..4` là cực trị; 3 và 4 gần như bằng nhau nên **giữ 4** (đang là default, không cần đổi gì).
Ghi chú thêm: **dev đang dùng 8 — tức dev chậm hơn prod ~25% mỗi decode**, đáng sửa khi rảnh.
Điều này cũng chứng thực phụ lục từ E (cực trị nội tại quanh tổng software threads ≈ số core).

## 2. Tải thực tế: **1 người / 1 tab** (user xác nhận)

Bão hoà lock cần ~3 socket đồng thời (1 và 2 luồng partial vẫn giữ cadence 296ms).
Với 1 socket, **lock STT không đủ giải thích "mất nội dung rất nặng"**. Nghi phạm theo thứ tự:

1. **Gemini không timeout** — p50 723ms, p95 1947ms, **max 8943ms**. Đuôi dài đẩy lượt dồn lại →
   hết 3 slot `MAX_IN_FLIGHT` → `too_many_turns` → client thử 4×750ms rồi **bỏ nguyên buffer**, im lặng.
2. **Quota Gemini** — 1 người nói liên tục ≈ 7.5 lượt/phút × (tối đa 4 speculation + 1 final)
   → dễ chạm trần 15/phút/model. 4 key nhưng free tier đếm theo **project** (chưa xác minh khác project).
3. **Speculation fan-out** — 4 decode+dịch toàn lượt mỗi lượt, không cancel: đốt cả lock STT lẫn quota.
4. **Đường mất audio im lặng ở client** — `translate-socket.ts:135` no-op khi socket chưa OPEN nhưng
   `sentMs`/`sequence` vẫn tăng → metrics báo sai là đã gửi; `turn-pipeline.ts:253-254` không log gì.

**Thứ tự ưu tiên đảo lại so với contract** (contract vẫn đúng, chỉ đổi thứ tự):
timeout Gemini + cap speculation + fix loss client **TRƯỚC**, pool recognizer **SAU**
(pool là để chịu nhiều người, không phải để cứu 1 người).

## 3. Trạng thái prod sau khi đo

Đã revert hoàn toàn: `prod.env` restore từ backup `prod.env.bak.20260913-001020`,
`LOCAL_STT_THREADS=4`, `/healthz` 200, transcript vi/en đúng, 6/6 container healthy.
**`TURN_METRICS_PATH` CHƯA bật** — xem mục dưới.

## 4. `TURN_METRICS_PATH`: dừng lại, cần anh quyết

Dòng này **bị tắt có lý do ghi rõ** trong `prod.env:85-86`:
`# DISABLED 2026-09-01 (M1 complete; sink was logging prod sessionIds+epoch timestamps)`
→ Đây là **quyết định privacy của anh**, không phải sơ suất. Tôi không tự ý đảo.
Schema thực tế của 1 row (43 row cũ trong `~/chatofy-metrics/turn-metrics.jsonl`):
`sessionId` (UUID 36 ký tự, per-conversation, KHÔNG phải user id), `speechStartedAt`/`speechEndedAt` (epoch ms),
`capturedMs`, `heldMs`, `queuedAheadMs`, `outcome`, `source`, `cutForced`, `echoEvents`.
**Không có transcript, không có audio, không có user id.** Rủi ro hẹp: lộ _khi nào_ có người nói, không lộ _nói gì_.
Hạ tầng đã có sẵn: `~/.config/chatofy/turn-metrics.override.yml` (bind mount `/metrics`).
Lưu ý: **CD không truyền `-f override`** nên override chỉ sống đến lần deploy kế tiếp; còn biến trong
`prod.env` thì CD đọc nên sống lâu.
Ba field `queuedAheadMs` / `heldMs` / `outcome` chính là thước đo trực tiếp cho câu hỏi mất nội dung của 1 user.

## Câu hỏi chưa giải

1. Lúc thấy tệ nhất, có **mấy người nói cùng lúc / mấy tab**? (1 người → nghi thêm đuôi Gemini +
   loss client; 2–3 người → đúng bão hoà lock.)
2. Có cho **restart sidecar** để (a) nâng `LOCAL_STT_THREADS` 4→8 ngay, và (b) bật `TURN_METRICS_PATH`
   lấy bản ghi latency thật trước/sau không?
3. Pool mặc định 2 hay 3: cần đo **RSS mỗi instance khi decode đồng thời** trên prod trước khi vượt 2
   (VM chỉ 7.553GiB, local-tts đã giữ ~2GiB).
4. 4 key Gemini có khác **project** không (free tier đếm theo project/model)? Ảnh hưởng phần dư
   latency còn lại sau khi sửa STT.
