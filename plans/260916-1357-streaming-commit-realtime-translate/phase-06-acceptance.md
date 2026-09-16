---
phase: 6
title: 'Nghiệm thu đầu-cuối'
status: done
priority: P1
effort: '6h'
dependencies: [4]
revision: 2 (viết lại sau red team)
---

# Phase 6: Nghiệm thu

## Goal

Chứng minh bằng số rằng các tiêu chí trong `plan.md` đã đạt, trên hệ thống chạy
thật, **bằng những cổng có thể trượt**.

## Vì sao bản này khác bản đầu

Red team chứng minh hai trong sáu cổng của bản đầu **không thể trượt**:

| Cổng bản đầu                                     | Vì sao luôn pass                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grep -c 'quotaCooldown' $TURN_METRICS_PATH` = 0 | Chuỗi đó chưa bao giờ được ghi vào file đó. `onQuotaCooldown` chỉ vào `quotaLogger.warn` (`register-default-providers.ts:104-107`), và `TurnMetrics` không có trường quota nào. Bản đầu còn tự viết "chấp nhận 0 là đạt" |
| "0% viết lại phần chốt"                          | Kiểm bằng cách so các sự kiện server liên tiếp — nhưng server chỉ phát delta nối thêm, nên bất biến đó đúng theo định nghĩa của schema. Thứ có thể hỏng là **state client**, và bản đầu không nhìn tới                   |

Bản này: Phase 4 Task 4.7 thêm `quotaCooldowns` vào `TurnMetrics` để cổng thứ
nhất có thứ thật để đếm; cổng thứ hai chuyển sang đo **DOM**, nơi lỗi thật sự
xảy ra.

Thêm hai sửa: tiêu chí nhịp lấy từ số đo của Phase 1 thay vì từ một con số mong
muốn, và **cả hai chiều đều được đo** — bản đầu chỉ nói tiếng Việt, đúng chiều
duy nhất có thể pass.

## Files to Create / Modify

- Create: `plans/260916-1357-streaming-commit-realtime-translate/reports/acceptance.md`
- Modify: `docs/system-architecture.md` (chỉ khi Task 6.8 xác định cần)

---

## Task 6.1 — Dựng stack, ghi lại đúng những gì mình khởi động

- **Goal:** môi trường chạy được, và không để lại tiến trình mồ côi.

### Cảnh báo về `pnpm dev:stop`

`pnpm dev:all` chạy `docker compose up -d --wait` **rồi** `turbo run dev`.
`pnpm dev:stop` chỉ chạy `docker compose down`. Nên nó **không dừng** `turbo run
dev` đang giữ cổng 3000/3001, **và** nó giết container kể cả khi những container
đó đã chạy sẵn từ trước phiên này. Bản đầu dùng đúng lệnh đó ở bước dọn dẹp.

- **Steps:**
  1. Ghi lại trạng thái **trước** khi khởi động:
     ```
     ss -ltnp 2>/dev/null | grep -E ':(3000|3001|8001|8002)' || echo NONE
     docker compose ps --services --filter status=running || true
     ```
     Lưu output. Cái gì đã chạy sẵn thì **dùng lại và không được tắt** ở Task 6.9.
  2. Chỉ khởi động phần còn thiếu. Nếu container đã chạy, chỉ cần `turbo run dev`.
  3. Chạy `turbo run dev` qua **background facility của harness** (`run_in_background`),
     không phải `&`, để thoát ra quan sát được. Ghi lại lệnh, PID, cổng.
  4. Đặt `TURN_METRICS_PATH` tới một file jsonl mới **trước** khi khởi động API.
  5. Sidecar STT phải ở `LOCAL_STT_THREADS=4` như production
     (`docker-compose.prod.yml:278`). Ghi giá trị thật vào báo cáo — dev mặc định
     có thể khác, và nó đổi mọi số nhịp.

- **Success criteria:** web và api trả lời; danh sách "đã chạy sẵn" được lưu.

- **Verify:**
  ```
  curl -sf -o /dev/null -w '%{http_code}' http://localhost:3000/ && echo
  ```
  In ra `200`.

---

## Task 6.2 — Nhịp partial, ĐO CẢ HAI CHIỀU

- **Goal:** tiêu chí nhịp, đối chiếu với số Phase 1 đo được chứ không với con số
  tự đặt.

### Vì sao không còn ngưỡng 350ms

Nhịp là `max(DEFAULT_CADENCE_MS, lastDecodeMs × PARTIAL_DUTY_DIVISOR)`
(`partial-transcript-scheduler.ts:109-113`). Với divisor 2 và RTF r5:

| Chiều | Engine       | RTF p50 | decode 9s | nhịp        |
| ----- | ------------ | ------- | --------- | ----------- |
| vi→en | zipformer-vi | 0,0199  | ~180ms    | ~360ms      |
| en→vi | moonshine-en | 0,0556  | ~500ms    | **~1000ms** |

Ngưỡng 350ms của bản đầu **không đạt được ở chiều nào**, và bất khả thi ở chiều
tiếng Anh — muốn đạt phải hạ divisor xuống dưới 0,8, tức gỡ bỏ cổng duty mà
comment của scheduler nói là để preview không chiếm trọn một lane.

- **Steps:**
  1. Mở `reports/measurement.md`, mục `## Số bàn giao cho Phase 3`, lấy
     `refresh_ms_p95` (vi) và `decode_ms_p95`.
  2. Ngưỡng cho chiều **vi→en**: `refresh_ms_p95 × 1,25` (biên 25% cho tải thật).
  3. Ngưỡng cho chiều **en→vi**: `decode_ms_p95 × (0,0556 / 0,0199) × 2 × 1,25`,
     làm tròn lên trăm mili-giây gần nhất. Ghi công thức và kết quả vào báo cáo.
  4. Nói tiếng Việt ~10 giây, ghi mốc thời gian các sự kiện
     `server.transcript.delta`, tính p95 khoảng cách.
  5. **Lặp lại với tiếng Anh**, hướng `en_to_vi`. Đây là bước bản đầu bỏ.
  6. Ghi cả hai số cạnh ngưỡng tương ứng.

- **Success criteria:** cả hai chiều dưới ngưỡng **của chiều đó**.

- **Verify:** hai cặp số ghi vào `reports/acceptance.md`, mục "Nhịp hai chiều", cả
  hai đạt. Trượt thì áp Failure Protocol.

---

## Task 6.3 — Phần chốt không đổi TRÊN MÀN HÌNH

- **Goal:** đo đúng chỗ có thể hỏng.

### Vì sao đo DOM chứ không đo sự kiện

Server chỉ phát delta nối thêm, nên "các delta liên tiếp nối nhau" đúng theo định
nghĩa schema — kiểm nó là kiểm một bất biến kiểu, không phải kiểm hệ thống.

Chỗ hỏng thật nằm ở client: `server.transcript.partial` ghi đè `text` mà **không**
động tới `committedChars` (`turn-keyed-transcript.ts:504-507`), và `patchLive`
spread `...current` nên `committedChars` cũ sống sót. Phase 3 đã sửa bằng cách
gửi chuỗi chốt tuyệt đối, nhưng **phép đo phải xác nhận điều đó ở DOM**.

- **Steps:**
  1. Mở DevTools, chọn node đang hiển thị phần đã chốt của dòng live.
  2. Nói tiếng Việt liên tục ~15 giây, chụp `textContent` của node đó sau mỗi lần
     đổi (dùng `MutationObserver`, ghi vào mảng).
  3. Với mọi cặp liên tiếp, phân loại:
     - chuỗi sau **bắt đầu bằng** chuỗi trước → nối thêm bình thường;
     - không, **và** `delta` vừa tới có `reanchors` **lớn hơn** `delta` liền
       trước của cùng `sessionId` → **neo lại**, đếm riêng;
     - không, và không có neo lại kèm theo → **vi phạm**.
  4. Lặp lại một lần nữa trong khi **chủ ý gây ra một `partial` xen giữa hai
     `delta`** — nói rồi ngừng ngắn để buộc một vòng decode trả kết quả khác.

- **Success criteria:** **0 vi phạm** ở cả hai lần chạy, và neo lại **≤ 2 mỗi
  lượt** với tỉ lệ **≤ 0,5 mỗi lượt** trên cả phiên. Ngưỡng "≤ 2 mỗi lượt" đọc
  thẳng từ `reanchors` của `delta` cuối cùng mỗi lượt, không phải cộng nhật ký.

  **Tách số theo kiểu mở lượt:** lượt mở sau một lần **cắt cưỡng bức** báo cáo
  riêng với lượt mở từ im lặng. VIVOS không có lượt nào thuộc loại đầu, nên đây
  là lần đầu tiên loại đó có số — và counsel dự đoán tỉ lệ hỏng ở đó **cao hơn**,
  vì lượt mới mở bằng 320ms pre-roll cộng một mẩu từ bị cắt dở.

- **Verify:** ghi vào `reports/acceptance.md` cả hai số: vi phạm bằng `0`, và
  neo lại trong ngưỡng trên.

  Từ 2026-09-16 `reanchors` cũng được ghi vào mỗi dòng `TURN_METRICS_PATH`, nên
  ngưỡng "≤ 2 mỗi lượt" và tỉ lệ toàn phiên đọc thẳng từ file thay vì phải nhặt
  `delta` cuối cùng của mỗi lượt trong DevTools. Phần **vi phạm** thì vẫn phải đo
  ở DOM — nó là sai lệch giữa màn hình và sự kiện, nên không sự kiện nào thấy
  được nó.

### Vì sao ngưỡng không còn là "0 lần viết lại"

Cổng đo Phase 1 chứng minh bằng số rằng bất biến "phần chốt không bao giờ đổi"
làm committer chết trên 14% số lượt, và **không tham số nào cứu được** — chỉ neo
lại cứu. Người dùng chốt đổi tiêu chí ngày 2026-09-16.

Ngưỡng mới vẫn giữ nguyên răng của ngưỡng cũ ở đúng chỗ nó được dựng lên để canh:
một lần viết lại **không** kèm neo lại vẫn là vi phạm, và vẫn phải bằng 0. Đó là
đường mà `server.transcript.partial` phá `committedChars`, thứ task này sinh ra
để bắt.

Số 2 và 0,5 lấy từ phân bố đo được trên 50 lượt VIVOS: 38 lượt 0 lần, 11 lượt 1
lần, 1 lượt 2 lần, tỉ lệ 0,26/lượt. Ngưỡng nới so với số đo để chừa chỗ cho lời
nói thật khó hơn giọng đọc.

---

## Task 6.4 — Cập nhật bản dịch trên câu ngắn

- **Goal:** chứng minh câu 2,5 giây không còn bị bỏ qua — khiếu nại gốc.

### Tiêu chí đã viết lại sau khi đo — 2026-09-16

Bản đầu đặt "≥ 2 lần cập nhật trên câu 2,5 giây" cùng `N = 40`, hai thứ loại trừ
nhau. Bản thứ hai sửa thành `floor(2.5 × commit_rate / N)` và **> 0**. Bản đó
cũng sai, và lần này sai vì một lý do đo được chứ không phải vì số học.

Phép tính giả định **tốc độ chốt đều**. Cơ chế này không thể đều: khoảng **một
giây đầu của mọi lượt chốt được 0 ký tự**, vì cần hai lần đọc đồng ý mới chốt và
giả thuyết đầu lượt lật liên tục (`Cơ`→`Cô`, `Đấy`→`Khiến`, `Bà`→`Bọn`). Trong
câu 2,2 giây thì đó là một nửa câu.

Chạy lại chuỗi đọc thật của sidecar qua đúng `StreamingCommitter` và
`LiveTranslationTrigger` của sản phẩm, 22 lượt:

| Lượt    | `N` | Có ≥1 lần dịch | Trung vị ký tự đã chốt |
| ------- | --- | -------------- | ---------------------- |
| en 2,5s | 15  | 9/12           | 28                     |
| en 2,5s | 12  | 10/12          | 28                     |
| vi 2,5s | 15  | 6/10           | 19                     |
| vi 2,5s | 12  | 7/10           | 19                     |
| vi 3,0s | 15  | 10/10          | 30                     |

Hạ `N` xuống 12 chỉ mua thêm **một** lượt mỗi chiều, nên ngưỡng không phải chỗ
thắt — và trung vị ký tự đã chốt (28 và 19) đều trên 15, nên lượt trung bình vẫn
bắn. Các ca trượt gần hết là lượt **nói rất ít**: `Horse`, `Husband`, `Bọn`,
`Bà quản`. Dịch giữa chừng 5–7 ký tự không có giá trị, và bản dịch cuối lượt vẫn
tới sau đó khoảng một giây.

Người dùng chốt 2026-09-16: viết lại tiêu chí theo số đo, giữ nguyên `N = 15`.

- **Steps:**
  1. Nói câu ~2,5 giây **có đủ lời nói cho một cụm từ hoàn chỉnh**, lặp 10 lần
     mỗi chiều.
  2. Với mỗi lượt, đọc `committedChars` từ `TURN_METRICS_PATH`. Lượt nào chốt
     được **ít hơn `N` ký tự** thì loại khỏi mẫu và ghi lại số bị loại — đó là
     lượt nói quá ít, không phải lượt hệ thống bỏ sót.
  3. Trong số còn lại, đếm sự kiện `server.translation.partial` nhận được
     **trước khi** lượt kết thúc.
     Chỉ đếm `partial`: Phase 5 chạy **sau** phase này, nên
     `server.translation.delta` chưa tồn tại lúc đo.

- **Success criteria:** **≥ 70%** số lượt còn lại có **≥ 1** lần cập nhật, ở cả
  hai chiều. Nền so sánh là **0** — chính sách cũ có `MIN_SPEECH_SECONDS = 3` nên
  câu 2,5 giây không nhận gì.

  Số lượt bị loại ở bước 2 **phải được ghi**. Nếu quá một phần ba mẫu bị loại thì
  mẫu sai chứ không phải hệ thống đạt: nói lại với câu dài hơn.

- **Verify:** năm số và trung vị ghi vào báo cáo, kèm con số kỳ vọng và `N` đã dùng.

---

## Task 6.5 — 429 và chi tiêu quota thật

- **Goal:** một cổng có thể trượt.

- **Steps:**
  1. Hội thoại liên tục **3 phút**, hai chiều, nói xen kẽ như hội thoại thật.
  2. Cộng trường `quotaCooldowns` trên mọi hàng của `TURN_METRICS_PATH` — trường
     này do Phase 4 Task 4.7 thêm vào. **Nếu trường không tồn tại, Phase 4 chưa
     xong; dừng lại**, đừng chuyển sang grep khác.
  3. Đối chiếu chéo với log API: đếm dòng `rate limited on`, chuỗi thật mà
     `register-default-providers.ts:105-107` ghi. Hai con số phải khớp; lệch
     nghĩa là bộ đếm nối sai.
  4. Cộng `liveTranslations` và `speculations` trên mọi hàng, chia 3 để ra
     req/phút. So với **chi tiêu nền** Phase 1 đã đo.
  5. **Quan sát RPD, không cưỡng chế:** ngoại suy `spentToday` từ req/phút đo
     được nhân với số phút hội thoại dự kiến trong ngày bảo vệ. Ghi vào báo cáo
     cạnh trần 500/model/ngày. Đây là dữ kiện cho quyết định còn treo của người
     dùng, không phải cổng chặn.

- **Success criteria:** tổng `quotaCooldowns` = **0**, và hai nguồn đếm khớp nhau.

- **Verify:**
  ```
  python3 -c "
  ```

import json,os,sys
p=os.environ['TURN_METRICS_PATH']
rows=[json.loads(l) for l in open(p) if l.strip()]
missing=[r for r in rows if 'quotaCooldowns' not in r]
if missing: sys.exit('FAIL: quotaCooldowns absent — Phase 4 Task 4.7 incomplete')
print(sum(r['quotaCooldowns'] for r in rows))
"

```
Thoát mã 0 và in ra `0`. Thoát khác 0 nghĩa là Phase 4 chưa xong.

---

## Task 6.6 — Áp lực lane của sidecar ở divisor 2

- **Goal:** chứng minh việc hạ divisor 3→2 không làm sidecar từ chối.

### Vì sao cần cổng này

Hạ divisor từ 3 xuống 2 nâng tần suất decode ~50%. Sidecar có số lane hữu hạn
(`LOCAL_STT_CONCURRENCY=4`, `docker-compose.prod.yml:283`) và khi bão hoà nó
**từ chối bằng 503** chứ không xếp hàng (`services/local-stt/app.py:82-88`). API
nuốt lỗi partial im lặng (`live-preview.ts` `.catch` chỉ `logger.debug`), nên
sự từ chối này **không hiện ra ở đâu người dùng thấy** — nó chỉ làm transcript
chậm lại một cách bí ẩn.

- **Steps:**
1. Mở hai tab `/translate`, hai người nói cùng lúc, mỗi người nói liên tục để
   giữ nhiều lượt song song (`MAX_IN_FLIGHT = 3` mỗi tab).
2. Chạy 2 phút.
3. Đếm số 503 trong log của container `local-stt`.

- **Success criteria:** **0** lần 503.

- **Verify:**
```

docker compose logs local-stt --since 3m 2>/dev/null | grep -c '503' || echo 0

```
In ra `0`. Khác 0 thì **trả `PARTIAL_DUTY_DIVISOR` về 3** và chạy lại Task 6.2
với ngưỡng nhịp tính lại — chậm hơn nhưng không mất transcript.

---

## Task 6.7 — WER cuối lượt không đổi

- **Goal:** chứng minh không đánh đổi độ chính xác lấy độ trễ.

- **Steps:**
1. Chạy lại đối chứng mốc nền tiếng Việt bằng harness trong `benchmarks/stt/`.
2. So với **5,38% WER / 2,90% CER** (`docs/development-journey.md:122-124`).
3. Bản decode cuối lượt đi qua `end()` và **không** dùng cửa sổ trượt, nên
   không được đổi. Nếu nó đổi thì có thứ ngoài ý muốn chạm vào đường cuối lượt
   — đó là lỗi, không phải đánh đổi.

- **Success criteria:** WER **= 5,38%**, CER **= 2,90%**, sai khác 0,00.

- **Verify:** hai số khớp chính xác. Lệch thì áp Failure Protocol.

---

## Task 6.8 — Viết báo cáo nghiệm thu

- **Target files:** tạo mới
`plans/260916-1357-streaming-commit-realtime-translate/reports/acceptance.md`.

- **Steps:**
1. Bảng: mỗi tiêu chí trong `plan.md`, cột ngưỡng, cột đo được, cột đạt/trượt.
   Ngưỡng nhịp phải ghi **hai dòng**, một cho mỗi chiều.
2. Cấu hình đã dùng: `DEFAULT_WINDOW_SECONDS`, `PARTIAL_DUTY_DIVISOR`,
   `LIVE_TRANSLATION_COMMIT_CHARS`, `LIVE_TRANSLATION_RPM`, `LOCAL_STT_THREADS`.
3. Tiêu chí "đóng mệnh đề → âm thanh đầu" thuộc Phase 7 đang hoãn: ghi **không
   áp dụng** kèm lý do, không ghi đạt hay trượt.
4. Mục "RPD ngoại suy" từ Task 6.5 bước 5, cạnh trần 500/model/ngày.
5. Phase 5 chạy sau phase này. Để trống mục của nó; Task 5.5 sẽ ghi bổ sung
   vào chính file báo cáo này khi chạy xong.
6. Câu hỏi chưa giải quyết ở cuối.

- **Success criteria:** báo cáo tồn tại, mọi dòng có số thật, không ô trống.

- **Verify:**
```

test -f plans/260916-1357-streaming-commit-realtime-translate/reports/acceptance.md && echo present

```
In ra `present`.

---

## Task 6.9 — Dọn tiến trình và chốt tài liệu

- **Goal:** không để lại tiến trình mồ côi, và **không giết thứ mình không bật**.

- **Steps:**
1. Dừng `turbo run dev` bằng **PID đã ghi ở Task 6.1 bước 3**. `SIGTERM` trước,
   `SIGKILL` chỉ khi nó lờ đi.
2. So danh sách container đang chạy với danh sách "đã chạy sẵn" lưu ở Task 6.1
   bước 1. **Chỉ dừng container do phiên này bật.** Không chạy
   `docker compose down` trống — nó giết cả những container đã chạy từ trước.
3. Đọc `docs/system-architecture.md`. Nếu nó mô tả đường STT/MT theo kiểu
   chờ-hết-lượt, cập nhật đoạn đó. Chỉ sửa đoạn mô tả sai.
4. **Không** tự sửa `docs/development-journey.md` — văn luận văn của người
   dùng. Đề xuất nội dung trong báo cáo và để người dùng quyết.

- **Success criteria:** cổng 3000/3001 nhả; container đã chạy sẵn vẫn chạy.

- **Verify:**
```

ss -ltnp 2>/dev/null | grep -cE ':(3000|3001)' || echo 0

```
In ra `0`.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
```
