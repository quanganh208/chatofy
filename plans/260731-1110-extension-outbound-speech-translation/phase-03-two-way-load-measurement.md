---
phase: 3
title: 'Two-way load measurement'
status: pending
priority: P1
effort: '4h'
dependencies: [2]
---

# Phase 3: Two-way load measurement

## Overview

Đo tải thật của hai chiều **trước** khi xây phần bơm audio vào trang, và chốt
`maxInFlight` chiều ra cùng ngưỡng của mic gate từ số đo đó.

Phase này nằm ở đây chứ không ở cuối vì red team chỉ ra lập luận công suất trong
bản kế hoạch đầu **đếm sai thứ**. Nếu số đo nói hai chiều không cùng chạy nổi
trên một máy, điều đó thay đổi thiết kế của phase 5 — biết sau khi đã bơm audio
vào Meet thì đã muộn.

## Lập luận cũ sai ở đâu

Bản đầu viết "3 + 2 = 5 ≤ trần toàn cục 6" và coi thế là đủ. Trần đó đếm **turn**,
và lời biện minh của nó (`turn-concurrency.ts:29-43`) dựa trên "các sidecar mỗi
cái là một tiến trình dùng chung". Đúng, nhưng nó ngụ ý các suy luận **nối tiếp**
nhau — và điều đó thôi đúng ngay khi có hai ngôn ngữ:

> `services/local-stt/engines/base.py:51-56` — khoá là **per-engine chứ không
> per-process**, _"so Vietnamese and English requests can overlap"_.

Một chiều: mọi turn rơi vào cùng một engine, xếp hàng sau nhau, CPU thấy một suy
luận tại một thời điểm. Hai chiều: turn vi vào `ZipformerVi`, turn en vào
`MoonshineEn`, TTS vào `KokoroEn` vs `VieNeuVi` — khác object, khác khoá, **cố
tình** chạy đè nhau. Cùng "5 turn" nhưng số suy luận song song thật đã gấp đôi,
trên một ORT pool (`OMP_NUM_THREADS` mặc định 8) đã được chỉnh cho một.

Hệ quả: hạ `maxInFlight` chiều ra xuống 1 **không** khử được song song chéo
engine — một turn chiều ra vẫn đè lên một turn chiều vào. Cần đo mới biết cần
cần cần lever nào.

## Requirements

- Functional: có số cho ba cấu hình, gồm cả **tỉ lệ turn `played`**, không chỉ p95.
- Functional: có tỉ lệ thời gian mic gate đóng trên tổng thời lượng — con số
  quyết định tính năng có dùng được trong hội thoại thật không.
- Non-functional: cùng một kịch bản thoại cho mọi cấu hình; ghi rõ điều kiện đo.

## Architecture

Bật `reportMetrics` và chạy cùng một kịch bản thoại hai chiều ở ba cấu hình:

| Cấu hình                             | Đo                                           |
| ------------------------------------ | -------------------------------------------- |
| Chỉ chiều vào (như hôm nay)          | p50/p95 mỗi turn, tỉ lệ turn `played`        |
| Hai chiều, chiều ra `maxInFlight: 2` | như trên, tách theo chiều, + tỉ lệ gate đóng |
| Hai chiều, chiều ra `maxInFlight: 1` | như trên                                     |

Cột đáng nhìn nhất là **tỉ lệ turn `played`**. Turn bị từ chối ở trần hay bị drop
ở backlog không hiện ra trong p95 của những turn sống sót — p95 đẹp nhất đúng lúc
pipeline tệ nhất. `outcomeFor` (`conversation-session.ts:578-586`) đã phân biệt
sẵn `played` / `dropped` / `rejected` / `no_audio`.

Đo với **cả hai engine đã nóng**. Engine lạnh sẽ ngụy trang chính hiện tượng
đang cần đo.

Các lever, theo thứ tự ưu tiên nếu số xấu:

1. Hạ `maxInFlight` chiều ra xuống 1. Rẻ nhất, nhưng không khử song song chéo.
2. Một semaphore suy luận trong sidecar, bao cả hai engine. Đúng ràng buộc thật,
   nhưng đổi ngữ nghĩa của `base.py:51-56` — chỗ đó cố tình cho hai ngôn ngữ đè
   nhau, nên phải sửa cả comment lẫn lý do.
3. Một luật ở API bao **concurrency trộn chiều**, chứ không chỉ số turn.

**Không** nâng `MAX_CONCURRENT_TURNS_GLOBAL`. Trần đó bảo vệ CPU của sidecar;
nâng nó chỉ làm mọi turn cùng chậm đi thay vì làm một số turn bị từ chối
(`turn-concurrency.ts:40-43`).

## Related Code Files

- Modify: `apps/extension/entrypoints/offscreen/main.ts` — hằng số kèm lý do
- Modify: `apps/extension/src/outbound-mic.ts` — ngưỡng release của gate
- Modify: `benchmarks/realtime/` — kịch bản hai chiều nếu đó là nơi đúng để
  chứa; đọc README của nó trước, đừng đoán
- Có thể: `apps/api/src/modules/translate/session/turn-concurrency.ts`,
  `services/local-stt/engines/base.py` — chỉ khi số đo bắt phải dùng lever 2/3

## Implementation Steps

1. Dựng kịch bản thoại lặp lại được (kịch bản cố định, cùng người nói, cùng
   phòng). Ghi điều kiện đo vào báo cáo.
2. Chạy ba cấu hình, thu metric từ sink JSONL của server.
3. Thêm đo tỉ lệ gate đóng — đếm ở `outbound-mic.ts`, báo lên status.
4. Chốt `maxInFlight` chiều ra và hằng số gate; viết lý do **bằng số** cạnh hằng
   số, theo lệ đã có ở `turn-concurrency.ts:11-15` và `offscreen/main.ts:40`.
5. Nếu phải chạm lever 2 hoặc 3: đó là thay đổi ở server/sidecar, ngoài phạm vi
   đã chốt — dừng và hỏi trước khi sửa.
6. Ghi báo cáo vào `plans/reports/`.

## Success Criteria

- [ ] Bảng số ba cấu hình trong `plans/reports/`, gồm tỉ lệ turn `played` tách
      theo chiều
- [ ] Có tỉ lệ thời gian mic gate đóng, và một kết luận nói thẳng tính năng có
      dùng được trong hội thoại thật không
- [ ] `maxInFlight` chiều ra và hằng số gate có lý do bằng số đứng cạnh
- [ ] Nếu cần lever 2/3: đã hỏi và có quyết định, không tự sửa server

## Risk Assessment

| Rủi ro                                    | Giảm thiểu                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Đo bằng tay nên nhiễu                     | Cùng kịch bản cho mọi cấu hình; ghi rõ điều kiện                                                                                            |
| Máy đo còn client khác dùng chung sidecar | `/ws/translate` không xác thực (`turn-concurrency.ts:36-39`) nên không có gì chặn — đóng mọi client khác trong lúc đo và ghi lại là đã đóng |
| Số xấu nhưng phát hiện muộn               | Chính lý do phase này đứng trước phần bơm audio                                                                                             |
| Bị cám dỗ nâng trần toàn cục cho số đẹp   | Cấm; lever đúng nằm ở danh sách trên                                                                                                        |
