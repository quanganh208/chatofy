---
phase: 2
title: 'StreamingCommitter — LocalAgreement-2'
status: done
priority: P1
effort: '4h'
dependencies: [1]
revision: 3 (thiết kế lại sau cổng đo Phase 1)
---

# Phase 2: `StreamingCommitter`

## Goal

Một class thuần, không phụ thuộc mạng hay đồng hồ, biến chuỗi hypothesis hay-sửa
của bộ nhận dạng thành hai phần: phần **đã chốt** chỉ được nối thêm, và phần
**chờ** có thể đổi tuỳ ý.

Phase này **không nối dây vào đâu**. Chỉ class và test. Nối dây là Phase 3.

## Thay đổi lớn nhất: phần đã chốt KHÔNG còn bất biến

Bản 2 của phase này quy định `committed` chỉ được nối thêm, không bao giờ đổi.
**Cổng đo Phase 1 đã bác quy tắc đó bằng số.** Xem "Vì sao bỏ tính bất biến".

Tóm tắt luật mới: `committed` vẫn chỉ lớn lên trong trường hợp thường, nhưng khi
hai vòng mới **đồng ý với nhau** về một tiền tố **mâu thuẫn** với phần đã chốt
thì phần đã chốt **bị thay**, và lần thay đó được **đếm**.

Hai thay đổi giữ nguyên từ bản 2: `holdBackSyllables` mặc định **0**, và **không
có `flush()`**.

## Điều kiện tiên quyết

Đọc `reports/measurement.md` từ Phase 1. Nếu nó chứa `PHÁN QUYẾT: DỪNG` thì
**không bắt đầu phase này** — báo người dùng và dừng.

## Files to Create / Modify

- Create: `apps/api/src/modules/translate/audio/streaming-committer.ts`
- Create: `apps/api/src/modules/translate/audio/streaming-committer.spec.ts`
- Modify: không có

---

## Task 2.1 — Viết class `StreamingCommitter`

- **Goal:** class chạy đúng LocalAgreement-2 với biên từ.

- **Target files:** tạo mới
  `apps/api/src/modules/translate/audio/streaming-committer.ts`, cạnh
  `partial-transcript-scheduler.ts` và `live-translation-trigger.ts` vì cùng là
  lớp chính sách thuần.

- **Steps:**
  1. API công khai:
     ```ts
     export class StreamingCommitter {
       constructor(options?: { holdBackSyllables?: number });
       /** Nạp một hypothesis mới. Trả về true nếu `committed` vừa đổi. */
       push(hypothesis: string): boolean;
       /** Toàn bộ phần đã chốt. Lớn lên, hoặc bị THAY khi neo lại. */
       get committed(): string;
       /** Phần của hypothesis mới nhất nằm sau phần đã chốt. */
       get pending(): string;
       /** Số lần `committed` bị thay thay vì nối thêm, trong lượt này. */
       get reanchors(): number;
       /** Xoá trạng thái cho lượt sau. */
       reset(): void;
     }
     ```
  2. Quy tắc chốt trong `push`, theo thứ tự:
     - tính tiền tố chung của `hypothesis` và hypothesis **liền trước**;
     - lùi về **ranh giới từ gần nhất** — không bao giờ chốt nửa từ;
     - giữ lại `holdBackSyllables` âm tiết cuối (mặc định **0**, tức không giữ);
     - gọi kết quả là `cand`;
     - **nối thêm** nếu `cand` dài hơn `committed` và bắt đầu bằng `committed`;
     - **neo lại** nếu `cand` không rỗng, không bắt đầu bằng `committed`, **và**
       `committed` cũng không bắt đầu bằng `cand`. Thay `committed` bằng `cand`
       và tăng `reanchors`;
     - ngược lại giữ nguyên. Riêng trường hợp `cand` là tiền tố ngắn hơn của
       `committed` thì **không** rút ngắn — đó là hold-back dao động, không phải
       một bất đồng thật;
     - lưu `hypothesis` làm "liền trước".
  3. **Quy tắc `pending`.** Nếu `hypothesis` bắt đầu bằng `committed` thì
     `pending` là phần còn lại. Nếu không — chỉ xảy ra khi vòng này không đủ điều
     kiện neo lại — đặt `pending = ''`.
     Lý do giữ quy tắc này dù đã có neo lại: suy `pending` từ một mốc neo còn lệch
     sẽ render **chữ lặp**, tức người dùng thấy văn bản nhân đôi. Một vòng không
     có `pending` thì tệ hơn nhiều một vòng có `pending` sai.
  4. Tiếng Việt viết rời từng âm tiết, nên "âm tiết" ở đây là token ngăn cách bởi
     khoảng trắng — cùng phép cắt với ranh giới từ.
  5. Comment giải thích _vì sao_, theo mật độ của `partial-transcript-scheduler.ts`
     bên cạnh. Không nhắc tên plan, số phase, hay mã finding trong comment.

### Vì sao bỏ tính bất biến — số đo của Phase 1

Bản 2 coi "phần đã chốt là bất biến" là bất biến cứng. Cổng G2 của Phase 1 nổ
**chính vì** quy tắc đó: khi bộ nhận dạng chốt nhầm rồi tự sửa, `committed` hết
là tiền tố của hypothesis và committer chết tới hết lượt.

Chấm lại ngoại tuyến 8 biến thể trên cùng 598 snapshot, `reports/measurement.md`:

| Biến thể               | >2s      | p95     | WER phần chốt | ghi đè |
| ---------------------- | -------- | ------- | ------------- | ------ |
| LA-2 hb0 (bản 2)       | 7/50     | 2,7     | 0,1918        | 0      |
| LA-3 hb0               | 5/50     | 2,4     | 0,1918        | 0      |
| LA-2 hb0 + chờ 1,0s    | 6/50     | 2,7     | 0,1738        | 0      |
| **LA-2 hb0 + neo lại** | **0/50** | **1,2** | **0,0717**    | **13** |

Không tham số nào hạ được 7/50 xuống 0. Neo lại hạ xuống 0 **và** chốt được
nhiều hơn **và** đưa WER phần chốt từ 0,1918 về 0,0717 — gần chạm 0,0538 của bản
cuối lượt.

Giá: 13 lần thay trên 50 lượt. Phân bố: 38 lượt 0 lần, 11 lượt 1 lần, 1 lượt 2
lần. Vì thế tiêu chí nghiệm thu mới là **≤ 2 mỗi lượt, tỉ lệ ≤ 0,5/lượt**.

Điều làm việc này rẻ: **giao thức không phải đổi**. Phase 3 task 3.4 đã gửi chuỗi
chốt tuyệt đối và reducer dựng lại cả dòng từ rỗng
(`appendCapped('', event.committed + event.pending)`), nên client không cộng gì
và một `committed` không nối tiếp cái trước vẫn render đúng.

### Bằng chứng đã bị đọc sai — vì sao mặc định là 0

Một bản trước của phase này đặt mặc định 2 âm tiết, viện dẫn r5 cho thấy bộ nhận
dạng **sửa** `nguyên` → `nguyễn` giữa hai lần giải mã. Đọc lại bản ghi thật:

```
utt_id   VIVOSDEV13_089
ref_text NHÀ VĂN NGUYÊN NGỌC SINH VIÊN CÓ QUYỀN HOÀI NGHI VÀ TRANH CÃI
hyp_text NHÀ VĂN NGUYÊN NGỌC NHÀ VĂN NGUYỄN NGỌC SINH VIÊN CÓ QUYỀN HOÀI NGHI VÀ TRANH CÃI
engine   sherpa-zipformer-vi
```

Hai cách viết nằm **trong cùng một chuỗi, từ một lần giải mã offline duy nhất**.
Đó là **lặp cụm trong một decode**, không phải sửa giữa hai decode. Và nó có trên
zipformer — engine mà bản trước bảo là "chưa đo được".

Hold-back **không thể** cứu ca này: cụm lặp đến _sau_ vùng đã chốt dưới dạng nối
thêm, không ghi đè lên nó. Giữ 2 âm tiết không mua được gì mà bắt mọi lần chốt
trả thêm độ trễ.

Giữ lại tuỳ chọn constructor vì nó rẻ và Phase 1 cần cả hai chế độ để so. Mặc
định **0**, và Phase 1 đã xác nhận giữ 0: hold-back 2 cho `>2s` = 5/50 (vẫn
trượt cổng), chốt chậm hơn, và WER phần chốt **xấu hơn** (0,2921 so với 0,1918)
vì nó chốt ít hơn. Neo lại xử đúng thứ hold-back định xử, mà không phải trả độ
trễ.

### Vì sao không có `flush()`

Bản trước có `flush(finalText)` để bản decode cuối ghi đè phần chốt. Là máy móc
chết: reducer client **đã** xoá dòng live khi lượt kết thúc — `withoutLive` được
gọi ở `turn-keyed-transcript.ts:413,652,666,672`. Bản cuối luôn thay thế phần
chốt trên màn hình dù server có gửi gì.

`reset()` thì vẫn cần, để dùng lại committer cho lượt sau.

`flush()` trở thành load-bearing nếu Phase 7 mở, vì lúc đó phần chốt được nói ra
và cần một cách rút lại. Đã ghi vào phác thảo Phase 7.

- **Success criteria:** file tồn tại, xuất `StreamingCommitter` với
  `holdBackSyllables` mặc định 0, có `reanchors`, **không có** `flush`,
  typecheck sạch.

- **Verify:**
  ```
  pnpm --filter api typecheck && \
  grep -c 'flush' apps/api/src/modules/translate/audio/streaming-committer.ts
  ```
  Lệnh đầu thoát mã 0; lệnh sau in ra `0`.

---

## Task 2.2 — Test cho class

- **Goal:** khoá bất biến "phần đã chốt không bao giờ đổi".

- **Target files:** tạo mới
  `apps/api/src/modules/translate/audio/streaming-committer.spec.ts`, theo phong
  cách của `partial-transcript-scheduler.spec.ts`.

- **Steps:** mỗi ca một `it`:
  1. Hai hypothesis giống hệt nhau thì chốt toàn bộ.
  2. Một hypothesis đơn lẻ chưa chốt gì: `committed === ''`, `pending` là cả chuỗi.
  3. Chốt dừng ở ranh giới từ: `push('xin chào các')` rồi `push('xin chào cách')`
     → chốt `'xin chào'`, không phải `'xin chào các'`.
  4. Phần đã chốt không bao giờ ngắn lại.
  5. `pending` phản ánh hypothesis mới nhất.
  6. `push` trả về đúng phần vừa chốt thêm; tổng mọi giá trị trả về bằng
     `committed` cuối cùng.
  7. `reset` xoá sạch trạng thái.
  8. Chuỗi rỗng và khoảng trắng không làm hỏng gì.
  9. **Neo lại khi hai vòng mới đồng ý khác đi.** Chốt `'cơ'`, rồi
     `push('cô cứ nhè')` hai lần → `committed` thành `'cô cứ'` hoặc dài hơn,
     `reanchors === 1`. Đây là ca Phase 1 đo được trên `VIVOSDEV02_R045`.
  10. **Một vòng bất đồng đơn lẻ KHÔNG neo lại.** Chốt `'xin chào'`, rồi
      `push('chào bạn ơi')` **một lần** → `committed` giữ nguyên `'xin chào'`,
      `pending === ''`, `reanchors === 0`. Neo lại cần hai vòng đồng ý, đúng như
      chốt cần hai vòng đồng ý.
  11. **Mốc neo lệch không sinh chữ lặp.** Chốt `'một hai ba'`, rồi nạp hai
      hypothesis bắt đầu từ giữa (`'hai ba bốn'`) → `committed + pending`
      **không** chứa `'hai ba'` hai lần.
  12. **`cand` là tiền tố ngắn hơn thì không rút ngắn.** Chốt `'một hai ba'`,
      rồi hai vòng cho `'một hai'` → `committed` vẫn là `'một hai ba'`,
      `reanchors === 0`.
  13. `reset()` xoá cả `reanchors` về 0.
  14. Hold-back giữ đúng số âm tiết khi được bật: với `holdBackSyllables: 2`,
      `push('a b c d')` hai lần → chốt `'a b'`, `'c d'` ở `pending`.
  15. `holdBackSyllables: 0` (mặc định) không giữ lại gì.

  **Ghi chú cho người viết test:** một bản trước có một ca dựng chuỗi ba lần push
  `'nhà văn nguyên'` → `'nhà văn nguyên'` → `'nhà văn nguyễn ngọc'` và gọi nó là
  bằng chứng hold-back cứu được lỗi đo được. Chuỗi đó **không tồn tại trong dữ
  liệu**; nó được bịa cho vừa với cơ chế. Không viết lại ca đó.

- **Success criteria:** **13** `it` phủ đủ 15 hành vi trên, tất cả xanh. Hai cặp
  gộp lại vì chúng là cùng một hành vi: "phần chốt không ngắn lại" với "`cand` là
  tiền tố ngắn hơn thì không rút ngắn", và "`reset` xoá trạng thái" với "`reset`
  xoá `reanchors`". Viết tách chỉ để đủ 15 con số là test trùng, không phải test
  thêm.

- **Verify:**
  ```
  pnpm --filter api test -- streaming-committer
  ```
  Thoát mã 0, **0 failed**. Lưu ý: cờ lọc của `pnpm --filter` không truyền qua
  được, nên muốn chạy riêng thì dùng `cd apps/api && pnpm exec vitest run
streaming-committer`.

---

## Task 2.3 — Chạy lại test và lint toàn API

- **Verify:**
  ```
  pnpm --filter api test && pnpm --filter api lint
  ```
  Cả hai thoát mã 0.

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
