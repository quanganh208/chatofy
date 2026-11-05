# Phase 3: Google sign-in

Status: done | Priority: P2 | Depends: 2 (cùng sửa sign-in + auth-provider) | Cần: Google client ID do chủ dự án tạo

## Context

`POST /auth/google` nhận `{idToken}`; `GoogleTokenVerifier.audience()` chỉ trả `AUTH_GOOGLE_ID` (một chuỗi). `docs/environment-variables.md` (mục "Google sign-in") báo trước mobile sẽ cần biến mới. Web client ID không là audience của id_token cấp cho client mobile.

## Requirements

- API: audience là danh sách = `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_MOBILE_IDS` (phân tách phẩy, mặc định rỗng). Hành vi cũ giữ nguyên khi biến mới trống. Đây là thay đổi API duy nhất được phép.
- Mobile: nút "Tiếp tục với Google" ở sign-in và sign-up; lấy id_token qua `expo-auth-session` (PKCE, redirect `chatofy://`); gọi `POST /auth/google`; session đi qua cùng store/refresh như email.
- Nút ẩn khi biến `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*` chưa đặt.
- Huỷ hộp thoại = không lỗi; lỗi 401/501/429 có thông điệp riêng.

## Files

- Modify (API): `apps/api/src/modules/auth/google-token-verifier.ts` (+ `.spec.ts`), `apps/api/src/config/env.schema.ts`, `docs/environment-variables.md`, `docs/architecture/authentication.md`, file env mẫu của api và của mobile (chỉ thêm tên biến, không giá trị)
- Modify (mobile): `src/clients/auth-client.interface.ts`, `http-auth-client.ts` (+test), `auth-provider.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `apps/mobile/package.json` (expo-auth-session, expo-crypto qua `npx expo install`). Scheme `chatofy` đã có trong `app.json`.
- Create: `src/auth/google-sign-in.ts` (+ `.test.ts`: chọn client ID theo platform, ánh xạ lỗi)

## Steps

1. Spec API trước: audience danh sách; token sai audience → 401; cả hai biến trống → 501 như cũ.
2. Cài `expo-auth-session` bằng `npx expo install`; kiểm tra có cần rebuild dev build không.
3. Hook `useGoogleSignIn()` bao `useAuthRequest`; gửi `idToken` qua `AuthClient.signInWithGoogle`.
4. Chạy tay trên máy thật. Nếu Google chặn custom scheme cho client iOS → chuyển fallback `@react-native-google-signin`, ghi lại trong journal.

## Validation

`pnpm --filter api test -- google-token-verifier`; `pnpm --filter mobile test`; đăng nhập Google thật trên dev build (gate của chủ dự án) kèm kiểm tra refresh sau khi access token hết hạn.

## Risk / rollback

Allowlist chỉ nhận client ID có trong env, không wildcard. Rollback: bỏ biến env, API về hành vi cũ.
