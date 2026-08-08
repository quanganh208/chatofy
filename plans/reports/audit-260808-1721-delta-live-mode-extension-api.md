# Delta Audit — Live Mode (extension + api)

**Ngày:** 2026-08-08 · **Nhánh:** `feat/gemini-live-translate` · **Loại:** audit delta, read-only

## Phạm vi và lý do

Audit gốc `audit-260807-1605-code-cleanup-oop.md` quét toàn repo lúc 2026-08-07
16:05. Báo cáo này chỉ soi phần **viết sau mốc đó** trong `apps/extension` +
`apps/api` + package hai bên chạm tới — vùng duy nhất chưa lần audit nào nhìn.

Tiêu chí giữ nguyên 5 điều của lần trước, nhưng "chuẩn OOP" được định nghĩa lại
cho kiểm được, chứ không theo khẩu vị:

- **Free function sai chỗ** khi nó cần state riêng của một class, lặp lại logic
  class đã có, hoặc sửa state chung từ ngoài.
- **Free function đúng chỗ** khi nó là hàm thuần toàn phần trên tham số. Bọc
  `reverseDirection` / `transcriptKey` thành class là anemic object — ít OOP hơn,
  không nhiều hơn.
- **Class sai** khi có nhiều hơn một lý do để đổi.

## Vùng đã soi

| Nguồn                      | File                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chưa commit (working tree) | `extension/src/{live-direction-session,direction-session,meeting-capture,messages,settings}.ts`, `extension/entrypoints/{background,popup/main}.ts`, `realtime-client/src/{audio/microphone-graph,state/turn-keyed-transcript}.ts`, `types/src/domain/translate-mode.ts` |
| Commit sau audit           | `65e0d3a` (Phase 7), `27a8e7b`, `a7dc398`, `75d268a`, `87a054b`, `de7978c`, `a07dea9`, `7133290`                                                                                                                                                                         |

**`apps/api` không có delta chưa audit.** Mọi commit api sau mốc audit chính là
Phase 1/2 của plan, đã có phase record riêng. File api duy nhất đổi ngoài đó là
`tsconfig.json`.

## Nền xanh trước khi soi

`pnpm knip` exit 0, **0 phát hiện** · extension **98/98** · api **389/389**

## Phát hiện

### F1 — Dựng `SoundingSink` viết hai lần (P2 — HOÃN, xem lý do)

`direction-session.ts:121-140` (cascade) và `live-direction-session.ts:127-144`
(live) cùng dựng mẫu holder `{ current?: SoundingSink }` — leaf sinh trước
wrapper mà drain phải với ngược lại được.

**Nhưng hai bản phân kỳ về ngữ nghĩa, không chỉ về chữ** (xác minh khi rà lại):

- cascade nhánh `deps.createSink` **không dùng holder** — dựng thẳng
  `new SoundingSink(deps.createSink(onTurnDrained), deps.onSounding)`, wrapper
  poll, không có `sync()` với ngược. Chỉ nhánh queue nội bộ mới cần holder.
- live dùng holder ở **cả hai** nhánh, và `report` của nó fan-out sang
  `onSounding` **và** `onBusy` (cascade chỉ `onSounding`).
- cascade còn phải luồn `onTurnDrained` vào leaf cho lớp ordering; live không có
  lớp ordering.

Helper chung sẽ phải tham số hoá cả cách nối drain theo từng nhánh. Hai bản
phân kỳ ⇒ **rule of three: chờ**. Lo ngại "mẹo dễ viết sai" đã được bù rẻ hơn:
cả hai chỗ đều có comment mang tải, và docblock của live nói thẳng "Mirrors
`createDirectionSession`" (`live-direction-session.ts:121`) — chính cross-reference
đó là bảo hiểm.

**Rút helper khi và chỉ khi xuất hiện chỗ dựng sink thứ ba.**

### F2 — Luật nằm trong entrypoint không test được (P3 — HOÃN)

`entrypoints/popup/main.ts:66 refreshModeNote()` giữ luật "live ⇒ `voiceGender`
vô nghĩa ⇒ khoá selector". Đây là **luật**, không phải wiring — mà theo chính kết
luận Phase 5, luật phải nằm ở `src/` kèm spec, entrypoint chỉ giữ wiring `chrome.*`.

Cùng file, cùng loại, có từ trước delta: `normalisedApiBase():147` — validate URL
thuần, có luật, không test.

Khác quyết định Overlay ở chi phí, không ở luật: luật là một ("logic có state ra
`src/` kèm spec"), Overlay được giữ vì tách nó mất `readonly`, còn tách hai hàm
này **không** mất gì. Phán quyết theo chi phí dưới cùng một luật là nhất quán.

**Hoãn cả cụm, không tách lẻ.** `refreshModeNote` là luật một dòng, còn
`normalisedApiBase` là nợ có sẵn — chuyển một cái và bỏ cái kia mới đúng là tạo
ra bất nhất.

### F3 — Vị trí hàm lệch trong một file api (P3 — HOÃN)

`live-translate-session.service.ts` giữ 2 free function: `languagesFor():34` ở
đầu file, `message():484` ở **cuối**, sau class. Chỉ 2 nên không lọt lưới quét
"≥ 3 free function cạnh class", nhưng đặt một hàm sau class là bất nhất với phần
còn lại của repo.

## Đã kiểm, không có vấn đề

- **`@Injectable` đặt đúng chỗ.** Trong `modules/translate` chỉ còn `services/` +
  `providers/`. Ngoài đó: `common/interceptors`, `sessions/stores`,
  `users/repositories` — quy ước Nest.
- **0 file nào trong `apps/api/src` + `apps/extension` + `packages` còn ≥ 3 free
  function cạnh một class.** File duy nhất từng như vậy đã bị `65e0d3a` xử.
- **`translate-mode.ts` mới đặt đúng nhà** — cả web và extension đều chọn mode,
  nên hằng canonical thuộc `packages/types`, không thuộc app nào.
- **`MicrophoneGraph.ownsAudioResources`** trùng ngữ nghĩa với
  `ConversationSessionDeps.ownsAudioResources`, nhưng là hai class độc lập cùng
  cần cờ đó. Không phải trùng lặp logic.
- **`MeetingCapture.live`** khiến class biết mode dù mọi thứ khác đi qua
  `DirectionRunner`. Comment tại chỗ đã ghi lý do đo được: luật gate không nói về
  session, nó nói về việc playback có khoảng hở hay không, và chỉ mode trả lời
  được. Là quyết định, không phải sót.
- **`LiveDirectionSession`** một trách nhiệm, DI qua `LiveDirectionBrowser`, có
  spec. Không có gì để tách.

## Đã biết, cố ý giữ nguyên

`entrypoints/content/index.ts` — constructor `Overlay` 98 dòng. Phase 6 bỏ qua có
lý do: 11 field element đều `readonly`, tách builder buộc bỏ `readonly` hoặc dùng
`!` trong file **không có test**. Người dùng xác nhận giữ quyết định 2026-08-08.
Không có bằng chứng mới; file không nằm trong delta.

## Kết luận: HOÃN cả ba, vòng này dừng ở đây

Cùng logic đã cắt Phase 8, và F1-F3 nhỏ hơn Phase 8: cả ba đều là mã đang chạy
tốt, có spec phủ, không ảnh hưởng tính đúng, không ảnh hưởng câu chuyện benchmark.
Đụng vào sau khi dữ liệu cuối đã chốt là trả giá trên đúng chỗ rủi ro nhất để
lấy về thứ không ai đo được.

**Không làm nửa vời** — kể cả F3 dù chỉ 15 phút. Bất kỳ cú chạm nào cũng mở lại
mặt test api và mở lại câu hỏi "mã đo có phải mã ship không". Giá trị của vòng
này là dấu vết audit, và nó đã nằm ở đây.

Nếu sau đồ án live mode còn đổi tiếp: làm theo thứ tự F2 (cả cụm) → F3, và F1
chỉ khi có chỗ dựng sink thứ ba. Mỗi cái một commit `refactor:` riêng, sau khi
feature đã commit — trộn vào diff feature thì lịch sử không tách được refactor
khỏi tính năng và không bisect được nếu vỡ. Cổng nghiệm thu giữ nguyên:
`typecheck` / `lint` / `knip` + test hai app, spec cũ pass **không sửa assertion**.

## Câu hỏi chưa giải quyết

1. `docs/codebase-summary.md` và `docs/system-architecture.md` đang sửa dở trong
   working tree. Audit này kiểm **mã**, không kiểm hai file đó có mô tả đúng live
   mode đã ship hay không. Nên rà một lượt trước khi commit.
2. Kiểm thủ công overlay trong cuộc họp thật vẫn **chưa làm** — Phase 6 ghi nợ,
   audit read-only không trả được.
3. `wxt build` vẫn chưa chạy lần nào (Phase 5 ghi nợ: hook chặn lệnh chứa chữ
   `build`). `tsc --noEmit` xanh nhưng bước bundle chưa được chứng minh.
