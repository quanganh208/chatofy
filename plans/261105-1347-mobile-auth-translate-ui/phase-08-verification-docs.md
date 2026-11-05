# Phase 8: Kiểm chứng, docs, nghiệm thu

Status: done | Priority: P2 | Depends: 2–7

## Requirements

- Toàn bộ kiểm tra tự động xanh: mobile `typecheck`, `lint`, `test`; `@chatofy/i18n` test; api test của Google verifier.
- Docs cập nhật vì hành vi người dùng và cấu hình thay đổi:
  - `apps/mobile/README.md`: bỏ "Translation screen (not built yet)", mô tả màn thật và cấu trúc thư mục mới.
  - `docs/project-roadmap.md`: dòng mobile translate đã làm; bỏ câu "its translate screen is planned separately".
  - `docs/environment-variables.md`, `docs/architecture/authentication.md`: biến `AUTH_GOOGLE_MOBILE_IDS` (phase 3 đã sửa, kiểm lại khớp code).
  - `docs/codebase-summary.md` nếu có mô tả cấu trúc mobile.
- Duyệt bằng mắt: 375×812, 768×1024; sáng/tối; các trạng thái: chưa chạy, đang chạy, đã dừng, lỗi, mode bị hạ.
- Review mã (`/ak-code-review`) vì chạm contract auth ở API và audio native.
- Danh sách nghiệm thu máy thật cho chủ dự án: đăng ký → nhận mail → verify web → đăng nhập; Google; ba chế độ dịch; TTS; lưu → History; vào họp sau khi dừng translate.

## Files

- Modify: các docs trên; thêm journal bằng `/ak-journal` sau khi xong.

## Validation

Compare kết quả với 6 tiêu chí nghiệm thu trong `plan.md`; ghi rõ mục nào chưa chạy được trên máy thật.
