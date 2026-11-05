# Phase 7: Deep link cho email verify và reset password

Status: done | Priority: P2 | Depends: 2 | Quyết định của chủ dự án: mail phải mở được vào app

## Context

`AuthMailer.link(path, token)` dựng link từ `WEB_BASE_URL` và cố ý KHÔNG bao giờ đọc origin từ request (chống host-header link poisoning: kẻ tấn công kích hoạt reset cho nạn nhân, mail thật dẫn tới origin của kẻ tấn công và trao token reset sống). Web có `app/(auth)/verify-email` và `reset-password`; API có `POST /auth/verify-email` `{token}` và `POST /auth/reset-password` `{token, password}`. `registerRequestSchema` và `forgotPasswordRequestSchema` chưa có trường chọn client.

## Thiết kế

Client gửi cờ enum `client: 'web' | 'mobile'` (mặc định `web`) trong body register và forgot-password. API chọn giữa HAI origin đã cấu hình: `WEB_BASE_URL` và `MOBILE_LINK_BASE_URL` (mặc định `chatofy://`). Không nhận URL hay host từ client, nên bề mặt tấn công không đổi: cờ chỉ chọn một trong hai giá trị do vận hành đặt.

Phương án đã cân nhắc, không chọn: universal/app links trên `https://<WEB_BASE_URL>`. Không cần đổi API nhưng cần serve `apple-app-site-association` + `assetlinks.json` từ web, khai báo `associatedDomains`/intentFilters, và KHÔNG chạy được ở dev (`WEB_BASE_URL` là localhost) nên không kiểm thử được trong luồng dev. Có thể bổ sung sau cùng cờ này.

## Requirements

- API: schema `clientSchema` ở `@chatofy/types`; `AuthMailer.link` nhận `client`; biến `MOBILE_LINK_BASE_URL` (mặc định `chatofy://`, do vận hành đặt; schema env kiểm là URL hợp lệ).
- Hành vi mặc định khi thiếu cờ giữ nguyên (web). Test: cờ lạ → 400; mobile → link bắt đầu bằng `chatofy://`; web → link như cũ; không trường nào của request đi vào origin.
- Mobile: `verify-email.tsx` và `reset-password.tsx` trong `app/(auth)/` nhận `token` từ deep link `chatofy://verify-email?token=` và `chatofy://reset-password?token=`; verify gọi API và hiện kết quả rồi nút sang sign-in; reset có form mật khẩu mới (+ xác nhận) rồi sang sign-in. Token không được ghi log và không lưu bền.
- Mobile register/forgot gửi `client: 'mobile'`.
- Token hết hạn/đã dùng: thông điệp riêng và đường quay lại forgot-password.

## Files

- Modify (types): `packages/types/src/**/auth*.ts` (thêm `client` vào `registerRequestSchema`, `forgotPasswordRequestSchema`)
- Modify (API): `apps/api/src/modules/auth/auth-mailer.ts` (+spec), `registration.service.ts`, `password-reset.service.ts` (+ specs), `apps/api/src/config/env.schema.ts`, `docs/environment-variables.md`, `docs/architecture/authentication.md`
- Modify (mobile): `src/clients/auth-client.interface.ts`, `http-auth-client.ts` (+test) (thêm `verifyEmail`, `resetPassword`, cờ `client`), `auth-provider.tsx`
- Create (mobile): `app/(auth)/verify-email.tsx`, `app/(auth)/reset-password.tsx`, `src/auth/deep-link-token.ts` (+ `.test.ts`: đọc và kiểm tra token từ URL)

## Steps

1. Spec API trước (cờ, mặc định, từ chối cờ lạ, không dùng dữ liệu request cho origin).
2. Cập nhật `@chatofy/types`, mailer, hai service, env schema.
3. Mobile client + hai màn; chỉ nút gửi là accent fill.
4. Thử với API dev: lấy link in ra console API, mở bằng `xcrun simctl openurl booted "chatofy://verify-email?token=…"` hoặc `adb shell am start -a android.intent.action.VIEW -d …`.

## Validation

`pnpm --filter api test -- auth-mailer registration password-reset`; `pnpm --filter mobile test`; chạy tay đủ vòng register → mở link → sign-in và forgot → mở link → đặt mật khẩu → sign-in.

## Risk / rollback

- Custom scheme có thể bị app khác đăng ký trùng trên Android (token lộ qua intent). Chấp nhận ở giai đoạn dev build; nếu phát hành store, chuyển sang app links (xem phương án đã cân nhắc). Ghi rủi ro này vào docs.
- Rollback: bỏ biến env và cờ; API mặc định web.
