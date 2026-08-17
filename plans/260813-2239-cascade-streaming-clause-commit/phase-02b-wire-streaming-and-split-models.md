---
phase: 2b
title: 'Nối đường streaming thật, và tách hai model tiếng Việt'
status: in_progress
priority: P0
effort: '2-3d'
dependencies: [2, 3, 4]
---

# Phase 2b: Nối đường streaming thật, và tách hai model tiếng Việt

## Vì sao phase này tồn tại

Phase 2 đổi recognizer tiếng Việt để lấy **một** tính chất: prefix đơn điệu do
decode causal. **Tính chất đó chưa bao giờ tới được production.**

`services/local-stt/app.py` có đúng hai route — `/healthz` và `/transcribe` — và
`/transcribe` gọi `engine.transcribe(samples)`, tức decode **cả cụm một lần**.
Không có transport streaming nào. `NemotronVi.stream()` (`nemotron_vi.py:71`) chỉ
được gọi từ test.

Đường thật thì `partial-transcript-scheduler.ts:19` nói rõ: _"Every tick re-reads
the whole window from scratch"_ — decode lại cửa sổ 8 giây, mỗi 300ms.

Nên câu nền của phase 3 (`stable-prefix-commit.ts:15-17`) — _"decodes causally
and never revisits audio it has consumed... measured at 0 violations across 139
consecutive 300ms feeds"_ — **đúng về model, sai về hệ thống**. Con số 0 đó đo
trên `engine.stream()` (`test_nemotron_vi.py:97`), không phải trên đường chạy.

Hiện trạng vì thế là tệ nhất của cả hai phía: recognizer **kém gấp đôi**, chạy ở
chế độ **không đơn điệu**, mà `AGREEMENT_DEPTH_VI = 1` lại **bỏ luôn vòng
agreement** vì tin vào tính chất không có. Chiều tiếng Anh dùng đúng recognizer cũ
thì vẫn chờ 2 lần đọc đồng ý.

## Ba triệu chứng người dùng báo, và chúng nối vào đâu

| Triệu chứng                   | Nguồn                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript vi sai nhiều       | Trả giá WER nemotron (10,93% đọc sạch / 20–26% nói tự nhiên vs zipformer 5,38% / 11,7–19,3%) mà không nhận lợi ích                                    |
| Transcript đứng im giữa chừng | Cửa sổ partial cap 8s (`DEFAULT_WINDOW_SECONDS`) trong khi trần lượt đã nới lên 45s; qua 8s mỗi lần đọc chỉ thấy 8 giây cuối                          |
| Chậm / máy nặng               | Decode lại 8s mỗi 300ms ở RTF offline 0,069 ≈ **>1,8 lõi liên tục mỗi lượt**; thêm ~9MB/giây audio cho mỗi lần decode cả cụm (`nemotron_vi.py:19-21`) |

Kèm theo: ghi chú trạng thái phase 5 trong `plan.md` — _"Tải STT giảm... streaming
đọc mỗi khung đúng một lần (~0,20s)"_ — **sai**, vì nó giả định đường streaming
đang chạy. Quyết định giữ nguyên trần đồng thời đứng trên chính giả định đó và
phải suy lại.

## Outcome

Chiều tiếng Việt decode **causal thật**: mỗi khung audio đọc đúng một lần, text
đã phát không bao giờ bị lật, và transcript **hiển thị** quay về độ chính xác của
zipformer.

## Constraints

- `apps/web` không đổi hành vi. Chiều tiếng Anh không đổi (Moonshine + agreement 2).
- Rollback phải còn nguyên một đòn bẩy: `LOCAL_STT_VI_ENGINE=zipformer` vẫn phải
  đưa hệ thống về hành vi cũ.
- Không tự viết decoder; chỉ nối cái binding đã có.
- RTF mỗi lượt ≤ 0,3 (trần dự án).

## Non-goals

- Đổi recognizer chiều tiếng Anh (câu hỏi treo ở `measure-260814-0944` §6, chưa chốt).
- GPU / Vulkan.
- Đổi `AGREEMENT_DEPTH_EN`.

## Acceptance

- [x] `engine.stream()` nằm trên đường chạy thật — chứng minh bằng test đi qua
      HTTP, không phải gọi thẳng binding (`test_a_streaming_session_decodes_causally_over_http`)
- [ ] **KHÔNG ĐẠT — 421.** Bộ đếm vi-prefix-violation của `StablePrefixCommitter`
      = 0 trên một lượt 45s thật. Đo được 421 trên lượt 41,5s; đường nền rollback
      cho 16. Nguyên nhân **không phải model** — xem `measure-260817-1618`
- [x] Transcript hiển thị chiều vi đo lại bằng zipformer: về ~5,38% trên VIVOS-50
      — **đạt, đúng 5,38%**, đo qua HTTP không gửi trường `engine`
- [ ] **KHÔNG ĐẠT — ngược hướng.** CPU mỗi lượt giảm đo được so với hôm nay. Đo
      được 382s so với 193s của đường nền: **tăng 2×**, vì cửa sổ re-decode cho
      màn hình không mất đi khi thêm dòng causal
- [x] Không lượt nào đứng im khi vượt 8s — **đạt nhưng sát**: khoảng lặng dài
      nhất 7,59s (đường nền 5,34s). Triệu chứng chững ở 8s đã hết
- [x] `LOCAL_STT_VI_ENGINE=zipformer` vẫn khôi phục hành vi cũ, có test — xem
      cảnh báo ở §Rollback về việc đó không phải cấu hình an toàn để chạy lâu

## Thiết kế

### 1. Sidecar: streaming theo phiên, REST

Bốn route, giữ đúng hình dạng FastAPI đang có, không thêm transport mới:

```
POST   /stream                {language}          -> {stream_id}
POST   /stream/{id}/feed      PCM16 chunk         -> {text}   # DELTA, không phải toàn văn
POST   /stream/{id}/finalize                      -> {text}   # đuôi
DELETE /stream/{id}
```

`feed` trả **phần mới**, đúng hợp đồng của `ParakeetStream.feed`
(`parakeet_runtime.py:199-213` — _"callers append, they never replace"_). Người
gọi cộng dồn.

REST theo phiên chứ không phải WebSocket: sidecar chưa có ws nào, mà mỗi feed là
một chunk 300ms (~9,6KB PCM16) trên localhost — HTTP overhead không phải chỗ
nghẽn, và một route POST thì test được bằng chính `test_app.py` đang có.

**Bắt buộc có bộ thu hồi theo TTL.** Mỗi phiên giữ ~60MB và một client chết không
được phép rò vĩnh viễn. Phiên không được feed quá N giây thì đóng và **ghi log**,
không nuốt.

**Engine không có `.stream()` thì trả lỗi rõ ràng**, không giả vờ. `ZipformerVi`
không có, và đó là sự thật cần nói ra ở tầng HTTP chứ không phải che đi.

### 2. Hai model tiếng Việt cùng lúc

`/transcribe` nhận thêm trường tuỳ chọn `engine`. Người gọi nói nó cần gì:

- **Đường phát ra tiếng** → `/stream/*` (nemotron, causal, append-only)
- **Transcript hiển thị + bản chốt cuối lượt** → `/transcribe?engine=zipformer`

Đây đúng là kết luận mà `measure-260814-0944` §Kết luận đã ghi và chưa ai cài:
_"Transcript hiển thị, chiều vi → zipformer-30M (giữ nguyên) — 5,38%, không model
nào đo được ở đây thắng nổi."_

Lý do việc này hợp lệ, và nó là cả lập luận: **audio đã phát không rút lại được,
chữ thì được.** `server.translation.partial` được ghi rõ trong hợp đồng là "thay
nguyên cụm, không nối" — nó sinh ra để bị thay. Bắt transcript hiển thị trả giá
đơn điệu là thu tiền trên một đường không hưởng lợi.

Giá: nạp cả hai vi engine, +223MB. Đổi lại bỏ được việc decode lại 8s mỗi 300ms
bằng model 1GB. **Ròng là nhẹ đi**, nhưng phải đo chứ không được tuyên bố.

### 3. Phía API

- `SttProvider` thêm các phương thức streaming **tuỳ chọn**; `LocalSpeechSttProvider`
  cài, ElevenLabs không. Interface dùng chung nên không được bắt buộc.
- `StreamingCommitDriver` mở phiên lúc lượt bắt đầu (chỉ chiều nguồn vi), feed
  từng khung khi tới, cộng dồn delta thành transcript đang chạy, `finalize` ở
  endpoint. Đóng phiên trên **mọi** đường thoát, kể cả lượt bị bỏ.
- `LivePreview` (hiển thị) giữ nguyên nhịp re-decode, nhưng gọi zipformer.
- `StablePrefixCommitter` chiều vi giờ nhận **text cộng dồn append-only thật**.
  `AGREEMENT_DEPTH_VI = 1` từ chỗ là niềm tin thành có căn cứ. Giữ nguyên bộ đếm
  vi phạm — nó là thứ sẽ báo nếu điều này lại sai lần nữa.
- `coversTurnStart` ở `streaming-commit-driver.ts:106` là để đối phó cửa sổ trượt.
  Trên đường streaming, cửa sổ **không** trượt. Phải suy lại chứ đừng để nguyên.

## Rủi ro

- **Nhiều phiên streaming đồng thời trên một context.** Mỗi phiên có handle riêng
  nhưng dùng chung `ParakeetModel._ctx`; parakeet.cpp có an toàn luồng hay không
  thì **chưa biết**. Mặc định an toàn: serialize feed dưới lock sẵn có. Feed 300ms
  tốn ~60ms ở RTF 0,202, nên ~5 lượt đồng thời là chạm trần lock, mà
  `MAX_CONCURRENT_TURNS_GLOBAL = 6`. **Sát.** Phải đo, và nếu nghẽn thì hạ trần
  đồng thời chứ đừng bỏ lock.
- **Rò phiên.** ~60MB mỗi phiên bị bỏ quên. TTL reaper là bắt buộc, không phải
  phòng xa.
- **Decoder câm ở đứt gãy âm học.** Đã có test hồi quy
  (`test_nemotron_vi.py:123`) nhưng nó chạy trên đường `transcribe`, không phải
  đường stream. Cần một test tương đương cho stream, và một watchdog ở lớp trên:
  transcript đứng im trong khi VAD vẫn báo có tiếng thì reset phiên **và ghi
  log**. `plan.md` §Rủi ro đã yêu cầu watchdog này và nó chưa được cài.
- **Cửa sổ 8s vs trần lượt 45s** vẫn còn nguyên cho **chiều tiếng Anh**, vốn vẫn
  re-decode. Phase này không chạm tới đó; phải nói rõ chứ đừng để người đọc tưởng
  đã chữa cả hai chiều.

## Trạng thái (2026-08-16)

**Code xong cả ba tầng.**

Sidecar: bốn route phiên (`/stream`, `/feed`, `/finalize`, `DELETE`), `feed` trả
delta đúng hợp đồng của binding. `streaming_sessions.py` giữ phiên với lock riêng
từng phiên (lock của store **không** giữ qua một lần decode) và reaper theo TTL
30s — thu hồi lười, chạy ở đầu mỗi request, giới hạn thành thật là service đứng
im hoàn toàn thì giữ phiên cuối tới khi có traffic. Registry nạp **cả hai** engine
vi; `LOCAL_STT_VI_ENGINE=zipformer` chỉ nạp một.

Provider: `SttProvider.openStream()` tuỳ chọn trả `SttStreamSession`
(feed→delta, finalize, close); `transcribe` thêm tham số tuỳ chọn `engine`.

API: `CausalTranscriber` giữ transcript đang chạy của một lượt, feed mỗi byte
đúng một lần, không cho hai feed chồng nhau, và **không đẩy offset khi feed
lỗi** — với decoder causal, một khoảng audio bị bỏ là khoảng nó sẽ không bao giờ
biết tới. Chiều vi commit từ dòng causal; chiều **en giữ nguyên** đường re-read +
agreement 2. Phiên được giải phóng ở `SessionRegistry.close`/`closeAll` — hai
đường duy nhất một lượt biến mất.

**Một lỗi chặn đã tìm ra khi chạy test thật, không phải do code phase này:**
`libparakeet.so` trong `runtime/` mang RUNPATH trỏ vào một thư mục scratch build
đã bị xoá, nên **engine tiếng Việt không nạp được** — `OSError: libggml.so.0`
ngay lúc import, trên máy có sẵn đủ file nằm cạnh nó. Đã vá bằng cách preload các
lib ggml anh em theo đường tuyệt đối trong `_load_library`, cùng khuôn
`preload_onnxruntime_dll` đã dùng. Sau đó test model thật chạy được.

**Bằng chứng:** sidecar pytest **46 xanh với weights thật**, gồm một phiên
streaming chạy **qua HTTP** khẳng định transcript đang chạy là append-only, và
test hồi quy decoder câm ở đứt gãy âm học. api jest 461, ai-providers 11,
realtime-client 174, web 62, extension 166. `tsc` sạch, lint 0 lỗi.

**Đã sửa sau code review (thật):**

- Nguồn commit **chốt theo lượt**. Phiên causal chết giữa chừng thì lượt đó
  **ngừng commit hẳn**, không rơi ngược về đường re-read — vì committer đang giữ
  token của nemotron, và commit chữ của zipformer lên trên đó chính là ca "hai
  transcript của một lượt" mà nó không sống nổi.
- **Tuần tự hoá feed ↔ finalize/close.** `end()` thường tới sau lần feed cuối một
  khung; sidecar serialize hai cái đó nhưng **không giữ thứ tự gửi**, nên đuôi có
  thể vượt lên trước chính đoạn audio nó là đuôi. Chỗ chiếm slot phải **đồng bộ**
  trước mọi `await` — test bắt được đúng lỗ này khi đặt hai lời gọi trong cùng
  một tick.
- **Feed lỗi vẫn phải đóng phiên.** Trước đó handle bị bỏ, phiên sống tiếp trên
  sidecar tới khi reaper dọn và ghi log như "client biến mất" — đúng cái tín hiệu
  đó được dựng ra để mang nghĩa khác.
- Mặc định `/transcribe` cho vi đổi sang **engine hiển thị**; `/stream` xin engine
  nói **tường minh**. Không đổi thì `apps/web` (`streaming: false`) vẫn đọc
  transcript cuối bằng nemotron trong khi partial đã là zipformer — lượt trông
  như tự gõ lại bằng từ khác đúng lúc nó kết thúc.
- Chốt tần số lấy mẫu (route feed nhận PCM trần, không có header mang rate; hợp
  đồng cho 8000–48000, và 48k giải mã như 16k là **phát ra tiếng nhanh gấp ba**).
- Không gọi `/stream` cho ngôn ngữ không có engine causal; trần số phiên (429) và
  trần kích thước chunk (413); `pcmFrom` dùng con trỏ chunk thay vì nối cả buffer
  mỗi lần feed; giải phóng phiên khi module tắt; TTL 30s → 90s (dài hơn trần lượt
  60s, vì hết hạn một phiên **đang sống** là hỏng, giữ một phiên chết chỉ là 60MB).

**Một finding của review là báo động giả, ghi lại để khỏi ai sửa nhầm lần nữa.**
Review kết luận `coversTurnStart` sai làm chiều vi **ngừng commit sau 8s**. Không
đúng: `tailOverlap` (`stable-prefix-commit.ts:146-159`) dò từ
`min(committed, tokens)` **đi xuống**, mà read causal thì tích luỹ nên `committed`
**chính là tiền tố** của nó — overlap ra **cực đại**, `base` = 0, đúng bằng
`coversTurnStart: true`. Kiểm thực nghiệm: ép `coversTurnStart: false` thì commit
ở frame 28 và 32 **vẫn xảy ra**. Việc truyền anchor tường minh vẫn giữ, nhưng vì
lý do khác: để tính đúng đó là **do phát biểu** chứ không do một sự suy biến mà
hỏng thì không ai nhận ra.

**Chưa làm:** watchdog cho ca decoder câm ở lớp trên.

## Đã đo (2026-08-17) — và hai kết quả lật lại phần trên

`plans/reports/measure-260817-1618-phase-2b-streaming-acceptance.md`. Bốn phép đo
đã chạy trên máy thật với fixture 41,5s có ngập ngừng thật. Hai đạt, hai không.

Phần "Bằng chứng" ở trên vẫn đúng như đã viết — 46 test xanh, streaming đi qua
HTTP thật. Nhưng test khẳng định transcript đang chạy là **append-only**, và đó
là câu hỏi sai một mức: chuỗi có append thật, **từ thì không**.

Hai lỗi, cả hai nằm ở dây nối chứ không ở model:

- **`.strip()` trên từng delta.** `strip_language_tags` (`parakeet_runtime.py:53`)
  kết thúc bằng `.strip()`; `streaming_sessions.py:156` áp nó lên mỗi delta. Người
  gọi nối thẳng theo đúng hợp đồng, nên chữ dính vào nhau: _"nó làmngười dân, mặc
  dùnhìnthấy rấtlà bình thường"_. Đó là text đang được dịch và phát ra tiếng.
- **Delta cắt giữa từ.** `"n"` → `"nó"`, `"là"` → `"làm"`. Binding trả **mảnh
  dưới-từ**, chính sách tưởng nhận **từ**, và `AGREEMENT_DEPTH_VI = 1` commit ngay
  lần thấy đầu — nên một mảnh được nói ra trước khi nó thành từ.

Cùng một hình dạng lỗi với lần trước, dịch sang một tầng khác: lần trước tính chất
chứng minh trên binding hỏng ở **transport**; lần này hỏng ở **đơn vị**.

CPU thì đi ngược tuyên bố "ròng là nhẹ đi" ở §2: nặng gấp đôi, vì đường hiển thị
vẫn decode lại cửa sổ 218 lần trong khi dòng causal chạy song song.

## Rollback

`LOCAL_STT_VI_ENGINE=zipformer` đưa sidecar về một engine và làm `/stream` trả
409, nên `CausalTranscriber` thành trơ và chiều vi quay về re-decode. Có test.

**Nhưng đòn bẩy rollback thật của tính năng vẫn là `CASCADE_STREAMING=false` ở
client**, và cần nói rõ vì sao: quay engine về zipformer _mà vẫn để lượt
streaming chạy_ thì chiều vi commit từ text re-read với `AGREEMENT_DEPTH_VI = 1`
— tức không chờ xác nhận trên một recognizer có sửa lại chính nó. Đó đúng là
hành vi trước phase này, nên gọi là "khôi phục" thì đúng, nhưng nó không phải một
cấu hình an toàn để chạy lâu.
