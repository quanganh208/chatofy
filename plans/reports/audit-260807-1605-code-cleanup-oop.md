# Audit chất lượng mã nguồn — quét rộng toàn repo

Ngày: 2026-08-07 · Branch: `feat/gemini-live-translate` (PR #71 mở) · Phạm vi: toàn bộ workspace

Tiêu chí audit lấy nguyên văn từ yêu cầu: _clean lại code, chuẩn OOP nhất có thể,
cấu trúc rõ ràng, không code dư thừa, không đặt hàm sai vị trí._

## Baseline đo được

| Cổng             | Kết quả                                               |
| ---------------- | ----------------------------------------------------- |
| `pnpm typecheck` | 13/13 pass                                            |
| `pnpm lint`      | 0 error, 2 warning (đều trong 1 spec)                 |
| `pnpm knip`      | sạch — 0 file/export/dependency thừa                  |
| Spec files       | api 26 · packages 11 · extension 5 · web 1 · mobile 0 |

## Kết luận theo từng tiêu chí

| Tiêu chí                 | Verdict                   | Bằng chứng                                                                       |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------- |
| không code dư thừa       | đạt                       | `knip` sạch; ESLint + Prettier + commitlint + lint-staged + husky đã wired       |
| chuẩn OOP                | 2 lỗ hổng thật            | class + DI dùng xuyên suốt; thiếu ở `interface LiveSession` và ở gemini provider |
| cấu trúc rõ ràng         | 1 vi phạm chứng minh được | `@Injectable` duy nhất nằm ngoài `services/`/`providers/`                        |
| không đặt hàm sai vị trí | 2 ca                      | gemini provider 633 dòng; mic graph nằm trong React hook                         |
| clean lại code           | 7 god-method              | xem bảng dưới                                                                    |

## Vùng đã sạch — không hành động

Quét rộng xác nhận các vùng sau không có khuyết điểm nào đáng sửa:

- **`services/` (Python sidecars)** — file lớn nhất 100 dòng (`engines/base.py`); có `test_app.py` cho cả hai.
- **`apps/mobile`** — 537 dòng tổng cộng / 19 file, lớn nhất 96 dòng.
- **`packages/types`, `packages/api-client`, `packages/ui`** — trong ngưỡng, không trùng lặp.
- **`packages/realtime-client/src/conversation/live-session.ts`** — 199 dòng, DI qua `LiveSessionDeps`, có spec 253 dòng.

Dò trùng lặp toàn repo: **đúng 1 file** trộn nhiều free function quanh một class.

## Khuyết điểm — phân theo nguồn gốc

Phân loại theo **nguồn gốc**, vì đường cascade là nhánh đối chứng của đồ án và
đang bị đóng băng cho tới khi chạy lại benchmark.

### Nhóm A — code branch này vừa thêm (sửa được ngay, trước khi merge PR #71)

| #   | Vấn đề                                                                                                                                                                                                    | Vị trí                                                                                  | Số đo                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A1  | `@Injectable` đặt sai thư mục — file duy nhất trong repo vi phạm                                                                                                                                          | `apps/api/src/modules/translate/session/live-translate-session.service.ts:96`           | 1 file, 2 import site                          |
| A2  | `interface LiveSession` = 15 field mutable, hành vi rải rác thành `session.x += y` rồi ráp lại thành literal trong `finish()`                                                                             | cùng file `:43-79`, mutation tại `:268,:279,:288-290,:398`, ráp tại `:514-529`          | 15 field                                       |
| A3  | God method `start()`                                                                                                                                                                                      | cùng file `:171`                                                                        | 192 dòng (riêng khối callback `:262-316` = 55) |
| A4  | Mic graph nội tuyến trong React hook — `new AudioContext`, `getUserMedia`, `audioWorklet.addModule`, downsample, RMS. Hook anh em `use-streaming-translate.ts:101` thì inject deps vào package đã có test | `apps/web/src/hooks/use-live-translate.ts:107-167`                                      | hook 119 dòng                                  |
| A5  | God method `start()`                                                                                                                                                                                      | `packages/ai-providers/src/providers/gemini-live/gemini-live-translate-provider.ts:115` | 126 dòng                                       |

### Nhóm B — đường cascade (ĐÓNG BĂNG tới khi có dữ liệu benchmark cuối)

| #   | Vấn đề                                                                                                                                                                           | Vị trí                                                                                            | Số đo                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B1  | 4 trách nhiệm tách biệt sống chung 1 file: phân loại lỗi, dựng prompt / chống injection, xoay key-model, và provider. **File nguồn lớn nhất repo**, 3× ngưỡng 200 dòng của dự án | `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts`                       | 633 dòng · 12 free fn + 1 class · `translate()` 109 dòng · lưới an toàn: spec 773 dòng |
| B2  | God method `end()`                                                                                                                                                               | `apps/api/src/modules/translate/services/translation-session.service.ts:222`                      | file 556 · `end()` 121 dòng                                                            |
| B3  | God method `start()`                                                                                                                                                             | `packages/realtime-client/src/conversation/conversation-session.ts:228`                           | file 620 · `start()` 181 dòng                                                          |
| B4  | Trên ngưỡng 200 dòng nhưng gắn kết tốt — chỉ theo dõi                                                                                                                            | `turn-pipeline.ts` 568 · `ordered-playback.ts` 470 · `capture-pump.ts` 298 · `speech-gate.ts` 270 | —                                                                                      |

### Nhóm C — extension (độc lập với đóng băng; điểm mù test)

| #   | Vấn đề                                                                                                                                                      | Vị trí                                                 | Số đo    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| C1  | File thủ tục thật sự duy nhất: ~20 hàm module-level thao tác trên state module-level (`overlay:30`, `activeTabId:31`, `patchedTabs:61`). **Không có spec.** | `apps/extension/entrypoints/background.ts`             | 646 dòng |
| C2  | Constructor 98 dòng, `render()` 91 dòng                                                                                                                     | `apps/extension/entrypoints/content/index.ts:203,:301` | 432 dòng |
| C3  | God method `begin()`                                                                                                                                        | `apps/extension/src/meeting-capture.ts:215`            | 123 dòng |

`entrypoints/` có 0 spec trong khi `src/` có 5 spec và đã chứa class
(`MeetingCapture`, `DuckController`). Ranh giới cần dịch chuyển là **ranh giới
kiểm thử**, không phải "class hoá".

## Hai việc được khuyến nghị KHÔNG làm

**`background.ts` → một class: nghi thức rỗng.** MV3 service worker bị evict tùy
ý; nguồn state có thẩm quyền đã là `chrome.storage` (`PATCHED_TABS_KEY:111`,
`ACTIVE_TAB_KEY:122`, `restoreSessionState:132`), biến module chỉ là cache nóng.
Một class singleton có **đúng cùng vòng đời** với module — thay đổi hành vi bằng
0, diff lớn, không có test đỡ. Cách sửa đúng là tách collaborator sang `src/`
nơi có harness test; tính "class" là hệ quả, không phải mục đích.

**Hợp nhất turn + live sau base class chung: nguy hiểm cho đồ án.** Header của
chính `live-translate-session.service.ts:81-95` ghi nhận sự phân kỳ này là **kết
quả đo được** — silence gating cắt cụt clip 3s thành `"However, the graft"`;
`live-session.ts:12` nhắc lại điều đó. Một base class chung tạo đúng một áp lực:
sau này ai đó nâng silence gate lên base và âm thầm vô hiệu hoá nhánh live.
Hai giao thức, hai hiện thực — quyết định hiện tại đã đúng.

Ngoài ra, live path **không nên** tái dùng `SessionRegistry`/`EventChannel`:
`SessionRegistry` tồn tại để trả lời câu hỏi sở hữu đa-turn (`owns():108`,
`recentlyClosed:44`, `countGlobal():137`), còn live path chỉ có 1 session mỗi
socket và không nhận id từ client. `EventChannel` lại typed theo `ServerEvent`
trong khi live dùng union riêng có chủ đích (`packages/types/src/events/index.ts:23-26`).
Phần dùng chung thật sự chỉ khoảng 8 dòng try/catch gửi sự kiện.

## Ràng buộc chi phối thứ tự

Nhánh cascade của benchmark chạy xuyên qua mã ứng dụng thật
(`TranslationSessionService` → `GeminiTranslationProvider` → sidecar local).
`benchmarks/live-translate/results/` chỉ có một lần chạy `2026-08-06T10-45-33`,
trong khi `run-arms.mjs` bị sửa ngày 2026-08-07 bởi commit `57b33ac`. Đã xác nhận
**cần chạy lại**. Refactor đường cascade giữa hai lần đo sẽ khiến hai nhánh được
đo trên hai phiên bản mã khác nhau — một confound mà hội đồng có thể hỏi.

Do đó Nhóm B bị đóng băng cho tới khi lần chạy cuối nằm trong `results/`.

## Cổng nghiệm thu

- `pnpm typecheck`, `pnpm lint`, `pnpm knip` giữ nguyên trạng thái xanh.
- `live-translate-session.service.spec.ts` (524 dòng) pass **không sửa assertion nào**.
  Phải sửa assertion nghĩa là đã đổi hành vi — dừng và đánh giá lại.
- `gemini-translation-provider.spec.ts` (773 dòng) pass không sửa, khi làm B1.
- Di chuyển file thuần (move + cập nhật import) không cần test mới; `tsc` và spec
  sẵn có là cổng đủ.

## Câu hỏi chưa giải quyết

1. Lần chạy benchmark lại dự kiến khi nào? Nó chặn toàn bộ Nhóm B.
2. Nhóm C có cần xong trước hạn nộp không, hay cắt được nếu thiếu thời gian?
3. Quy tắc `services/` vs `session/` hiện là bất thành văn (không có
   `docs/code-standards.md`). Có muốn ghi một dòng vào `docs/codebase-summary.md`
   để nó không trôi lại không?
