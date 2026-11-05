# Phase 2: Auth email — register, forgot password

Status: done | Priority: P2 | Depends: 1

## Context

`AuthProvider.signUp` và `AuthClient.signUp` đã có, trả `AuthMessage` (không tạo session). Chưa có `forgotPassword` trong `AuthClient`. API: `POST /auth/register`, `/auth/forgot-password` (web: `register`, `forgotPassword` trong `apps/web/src/clients/api-client.ts`). Link trong mail được phase 7 chuyển thành deep link; phase này dựng màn gửi yêu cầu và notice.

## Requirements

- `sign-up.tsx`: tên, email, mật khẩu (+ xác nhận); sau khi gửi hiện notice "kiểm tra email" kèm nút về sign-in.
- `forgot-password.tsx`: email → notice trung tính (không lộ email có tồn tại hay không, theo phản hồi API).
- sign-in có link tới 2 màn trên; thay chuỗi `mobile.auth.noAccount` cũ.
- Ánh xạ lỗi: 409 (email đã dùng / tài khoản Google-first → gợi ý forgot-password), 400 validation, 429, mạng.

## Files

- Create: `app/(auth)/forgot-password.tsx`, `src/auth/auth-error-message.ts` + `.test.ts`, `src/auth/register-form-state.ts` + `.test.ts` (validate thuần, cùng luật mật khẩu với `@chatofy/types`)
- Modify: `app/(auth)/sign-up.tsx`, `app/(auth)/sign-in.tsx`, `src/clients/auth-client.interface.ts`, `src/clients/http-auth-client.ts` (+ `http-auth-client.test.ts`), `src/providers/auth-provider.tsx`

## Steps

1. Đọc `registerRequestSchema`, `forgotPasswordRequestSchema` trong `@chatofy/types` và `apps/web/src/components/auth/{register-form,forgot-password-form,auth-error-message}` để dùng cùng luật.
2. Thêm `forgotPassword(email)` vào `AuthClient` + `HttpAuthClient` (test bằng fetch giả như test hiện có).
3. Dựng 2 màn; chỉ nút gửi là accent fill.
4. Test: validate form, ánh xạ lỗi, client.

## Validation

- `pnpm --filter mobile test`.
- Thử tay với API dev: link verify in ra console API (README: không cần SMTP ở dev).

## Risk

Throttle 429 của register/forgot → hiển thị thông điệp chờ, khóa nút khi đang gửi.
