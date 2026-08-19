---
title: 'Bỏ rào full-duplex, bật mic xuyên playback, đóng Phase 3'
date: 2026-08-19
summary: 'Cờ NEXT_PUBLIC_FULL_DUPLEX_CLEARED và NEXT_PUBLIC_MEASUREMENT_MODE bỏ hẳn; fullDuplex bật cứng trên web dựa trên kiểm chứng thiết bị; plan đóng trừ (b) và cổng A-lite'
---

# Bỏ rào full-duplex, bật mic xuyên playback, đóng Phase 3

## Quyết định

User kiểm trực tiếp trên MacBook demo: luồng loa **không bao giờ** đè vào mic đang
thu. Đó là câu trả lời cho đúng câu hỏi mà cờ `NEXT_PUBLIC_FULL_DUPLEX_CLEARED` được
dựng để chờ. Nên bỏ cờ, `fullDuplex: true` đặt thẳng trong hook.

Lý do bỏ chứ không phải đặt `=true`: cờ mặc định false đảm bảo đúng một thứ — tính
năng không bao giờ được bật. Nó không biết gì về căn phòng, và người duy nhất có thể
lật nó cũng là người đã kiểm bằng tai.

## Cái đứng thay cho rào

Bộ đếm `echoHeard` — trước đây hook trả về mà **không render ở đâu cả**, rồi được cho
vào sau một cờ đo. Giờ nó hiện cạnh vạch mức **ngay khi khác 0** và ẩn ở 0. Ở 0 nó là
con số không ai cần nhìn; khác 0 nó là lý do transcript sắp đầy giọng của chính app.
Một cờ chỉ để xem một số lẽ ra luôn bằng 0 là cái không ai bật đúng lúc cần.

`NEXT_PUBLIC_MEASUREMENT_MODE` bỏ theo: `reportMetrics` luôn true, và
`TURN_METRICS_PATH` phía server là công tắc duy nhất quyết định dòng metrics có được
ghi xuống đĩa hay không — hai đầu gác cùng một kênh thì đầu ngoài là thừa.

## Dọn theo

`muted` chết theo cấu trúc khi full duplex bật: `isMuted = !fullDuplex && …`. Nên bỏ
state, bỏ chỉ báo "mic paused while playing" khỏi panel, `onMuted` thành no-op có ghi
lý do (session vẫn cần listener cho đường single-turn và extension). `fullDuplex` cũng
hết là option của hook nên `StreamingTranslateOptions` xoá luôn — không caller nào
truyền.

Nhánh half-duplex **vẫn còn** trong `CapturePump` (mặc định `false`) cho extension và
đường single-turn. Chỉ web bật cứng.

## Phải nói thẳng trong luận văn

Kiểm chứng này **không phải** quy trình 40 lượt ở §10.1: một thiết bị, không có nhánh
đối chứng half-duplex, không ghi n, không ghi âm lượng/khoảng cách. Journey §10 mục 1
ghi đúng như vậy. Quy trình 40 lượt giữ nguyên ở `benchmarks/realtime/README.md` cho
thiết bị khác — rig i7 loa rời vẫn chưa đo, bảo vệ trên máy đó thì dùng tai nghe.

## Còn lại

Phép đo (b) — histogram độ dài lượt thật — dụng cụ xong, **số chưa có**: cần một phiên
hội thoại thật qua full stack. JSONL trong repo là của luồng live, không mang
`speechStartedAt/EndedAt`. Cổng quyết định A-lite vì thế vẫn mở, và mở có chủ ý: (c)
đã cho khoảng −1,2 … −3,5 chrF++, thiếu đúng vế "cắt được bao nhiêu giây chờ".

Xanh: `web typecheck/lint/test/build`, `realtime-client test` (186 pass).
