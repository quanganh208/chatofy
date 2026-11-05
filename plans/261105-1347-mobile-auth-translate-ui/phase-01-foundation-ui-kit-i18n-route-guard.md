# Phase 1: Nền — kit UI, i18n, route guard

Status: done | Priority: P2 | Depends: none

## Context

Màn hiện có dùng StyleSheet thủ công (`sign-in.tsx` 194 dòng) với token `space/radius/fontSize/fontWeight` từ `@chatofy/ui` và `useTheme()`. Chưa có component dùng chung (`src/ui/components/.gitkeep`). Đọc `docs/design-guidelines.md` trước.

## Requirements

- Component dùng chung nhỏ: `Screen`, `TextField`, `PrimaryButton` (đúng 1 fill accent/màn), `GhostButton`, `InlineNotice`, `ListRow`. Chỉ tách những gì ≥2 màn dùng.
- Route guard: `(app)` yêu cầu session, `(auth)` chuyển sang `(app)` khi đã có session; `index.tsx` hết "coming soon".
- i18n: khóa `mobile.auth.*`, `mobile.translate.*`, `mobile.history.*` đủ en + vi.
- Đổi tab `conversation` thành `translate` (title, icon `mic-outline`); thứ tự tab: Translate, History, Conference, Settings.

## Files

- Create: `apps/mobile/src/ui/components/{screen,text-field,primary-button,ghost-button,inline-notice,list-row}.tsx`
- Create: `apps/mobile/src/auth/route-guard.ts` + `route-guard.test.ts` (hàm thuần quyết định redirect)
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/app/(app)/_layout.tsx`, `apps/mobile/app/(auth)/_layout.tsx`
- Rename: `app/(app)/conversation.tsx` → `app/(app)/translate.tsx` (nội dung ở phase 5)
- Refactor: `app/(auth)/sign-in.tsx` dùng kit (hành vi giữ nguyên)

## Steps

1. Đọc `docs/design-guidelines.md`, `src/ui/theme.ts`, `sign-in.tsx`.
2. Tạo component kit, mỗi file <200 dòng; nhận màu qua `useTheme()`.
3. Thêm redirect trong `(app)/_layout.tsx` (`Redirect` tới `/sign-in?next=` khi không session và không loading). Giữ hành vi conference cũ (stack tự gửi người chưa đăng nhập đi sign-in) không bị double redirect.
4. Thêm khóa i18n; chạy test `@chatofy/i18n`.
5. Refactor sign-in sang kit, chạy typecheck.

## Validation

- `pnpm --filter mobile typecheck && pnpm --filter mobile lint`
- `pnpm --filter @chatofy/i18n test` (i18n-shared-keys parity)
- `pnpm --filter mobile test` (route-guard)

## Risk / rollback

Guard sai gây vòng lặp redirect → tách hàm thuần có test. Rollback: revert layout.
