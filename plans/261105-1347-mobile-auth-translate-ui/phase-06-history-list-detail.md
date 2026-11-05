# Phase 6: History — danh sách và chi tiết

Status: done | Priority: P2 | Depends: 1 (UI), 4 (translate-api)

## Context

API: `GET /conversations` (keyset cursor, `q` tìm kiếm tối thiểu `SEARCH_LIMITS.MIN_CHARS`), `GET /conversations/:id`, `DELETE /conversations/:id`. Web: `use-conversation-history.ts` (phân trang keyset, lỗi trang đầu và lỗi tải thêm tách riêng). `isAutoDetectConversation` nhận diện hội thoại detect khi đọc lại.

## Requirements

- `history.tsx`: danh sách `FlatList` phân trang cursor, kéo để tải lại, ô tìm kiếm có debounce, trạng thái rỗng/lỗi/đang tải; lỗi trang tiếp theo không xóa các hàng đã tải.
- `history/[conversationId].tsx`: chi tiết (cặp ngôn ngữ, thời gian, các turn nguồn + dịch; hội thoại detect dùng ngôn ngữ theo turn), nút xóa có xác nhận.
- Không làm: audio, minutes, glossary.

## Files

- Create: `apps/mobile/app/(app)/history/_layout.tsx`, `history/index.tsx`, `history/[conversationId].tsx` (thay `app/(app)/history.tsx`)
- Create: `apps/mobile/src/history/{use-conversation-history.ts, history-pager.ts, history-pager.test.ts, conversation-detail-view.ts, conversation-detail-view.test.ts}`
- Modify: `apps/mobile/app/(app)/_layout.tsx` (route `history` thành nhóm), `packages/i18n/src/{en,vi}.ts`

## Steps

1. Đọc `use-conversation-history.ts`, `apps/web/src/components/history/*` và schema `conversationSummarySchema` / detail.
2. `history-pager.ts` thuần (gộp trang, dedupe theo id, trạng thái lỗi) + test.
3. `conversation-detail-view.ts` thuần (ghép turn thành dòng hiển thị) + test.
4. Dựng 2 màn; không dùng control accent fill (theo web: History không tiêu accent).

## Validation

`pnpm --filter mobile test && typecheck && lint`; lưu một hội thoại từ translate rồi thấy trong History và mở được; xóa xong biến mất.

## Risk

Đổi `history.tsx` thành thư mục làm đổi route `/history` → cập nhật typed routes (`expo-env.d.ts` sinh lại khi chạy `expo start`).
