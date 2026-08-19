---
title: Giá của việc commit sớm — số đầu tiên
date: 2026-08-17
summary: 'Phase 3: dựng ba dụng cụ đo; chạy được (c): commit sớm tốn -1,2 đến -3,5 chrF++, vi->en thiệt nặng hơn'
---

# Giá của việc commit sớm — số đầu tiên

## Kết quả đo được

Thí nghiệm thuần văn bản, 12 utterance, 53 request, 0 rate limit:

| Nhánh                    | vi→en | en→vi | chung     |
| ------------------------ | ----- | ----- | --------- |
| cả câu                   | 71,85 | 53,91 | 62,71     |
| cắt dấu câu (lạc quan)   | −2,38 | −0,28 | **−1,22** |
| cắt tỉ lệ ~3 s (bi quan) | −4,35 | −2,71 | **−3,46** |

Đọc thành một **khoảng**, không phải một số: luật thật cắt theo im lặng, nằm giữa
hai nhát cắt. Cắt tại dấu câu **mù** với chính giả thuyết cần kiểm — tiểu từ cuối
câu tiếng Việt nằm ngay trước dấu câu nên không bao giờ bị tách khỏi mệnh đề.

**vi→en thiệt nặng hơn en→vi ở cả hai nhát cắt**, đúng hướng đã lo. Bắt được ca cụ
thể ở `vi-001`: _"security against attacks, **no** can be merged by tricks"_ — từ
"không" rơi vào ranh giới chunk, ra một phủ định què.

## Phát hiện quan trọng hơn con số

Hai trong ba phép đo **không chạy được** trước phase này, và không ai biết:

1. Quy trình đo AEC đếm `SpeechGate.onSpeechStart` lúc loa đang phát. Hook trả về
   con số đó và **không có chỗ nào render**. Phép đo cấp phép cho full-duplex không
   có mặt đồng hồ trên chính trang nó phải được đo.
2. Histogram độ dài lượt tính từ dòng client, mà web **chưa bao giờ gửi** dòng nào.
   JSONL có sẵn trong repo là của luồng live, không có mốc speech.

Bài học: một quy trình đo đã thiết kế kỹ vẫn có thể không chạy được, và cách duy
nhất để biết là thử chạy nó.

## Còn chặn

- (a) cần phòng + loa + người nói. Không tự động hoá được.
- (b) cần phiên hội thoại thật. Postgres chạy native OK, nhưng 3000/8002/8003 đang
  bị VS Code giữ (forward cũ, không có service thật phía sau) và docker daemon
  không chạy. Quan trọng hơn: dù dựng xong stack vẫn cần **người nói** — không có
  harness Playwright nào được commit để thay `getUserMedia` bằng fixture.

## Cảnh báo khi trích số

n=12 nhỏ; reference là pseudo-reference **chưa post-edit**; điểm tuyệt đối không so
được với số công bố. Chỉ hiệu số giữa các nhánh mới là kết quả.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
