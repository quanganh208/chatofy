# Phase 5: Translate — màn hình

Status: done | Priority: P1 | Depends: 4

## Context

Một màn `app/(app)/translate.tsx` thay cho trang web `/translate`, `/translate/one-way`, `/translate/two-way`. Quy tắc UI của repo: một control accent fill mỗi màn-trạng-thái; Start là control đó khi chưa chạy, Stop khi đang chạy là outline/destructive không phải accent fill; chỉ tối đa hai bề mặt nổi (`.claude/rules/development-rules.md`, `docs/design-guidelines.md`).

## Requirements

- Thanh trên: source picker (tên ngôn ngữ + "Auto-detect"), nút đổi chiều, target picker. Chọn cặp khi đang chạy bị khóa.
- Vùng chính: phụ đề live (liveTurns) và danh sách turn đã xong, mỗi turn có nhãn ngôn ngữ; ở two-way/detect, ô dịch chọn theo ngôn ngữ của turn, không theo `pair.target`.
- Dải trạng thái: báo "đang chạy one-way" khi `mode` bị hạ (`modeReason`), thông điệp cho `language_unavailable` (`language_detection`, `lid_capacity`), mất mạng, cần đăng nhập lại.
- Điều khiển: Start/Stop, công tắc TTS, mở sheet voice (theo ngôn ngữ đầu ra), mic permission denied có hướng dẫn mở Settings.
- Kết thúc: lưu hội thoại (`saveConversation`; detect lưu bằng `detectConversationLanguages(target)`), hiện kết quả lưu/lỗi và nút thử lại; không mất bản chép khi lưu lỗi.
- Giữ màn sáng khi đang chạy (`expo-keep-awake` nếu đã có; nếu chưa, không thêm dependency, ghi vào phần chưa chốt).

## Files

- Create: `apps/mobile/src/components/translate/{language-bar.tsx, language-picker-sheet.tsx, turn-list.tsx, live-turn-line.tsx, status-strip.tsx, translate-controls.tsx, voice-sheet.tsx}`
- Create: `apps/mobile/src/translate/{turn-display.ts, turn-display.test.ts, save-conversation.ts, save-conversation.test.ts}` (chọn ngôn ngữ ô dịch theo turn; dựng body lưu)
- Modify: `apps/mobile/app/(app)/translate.tsx`, `packages/i18n/src/{en,vi}.ts`
- Reuse: `src/components/conference/language-picker.tsx` và `voice-gender-picker.tsx` nếu khớp, không thì giữ riêng

## Steps

1. Đọc `docs/design-guidelines.md`, `apps/web/src/components/translate/{session-controls,caption-stage,live-turn-line}.tsx` để lấy ngữ nghĩa, không sao chép layout desktop.
2. `turn-display.ts` + test; `save-conversation.ts` + test (khớp `SaveConversationRequest`).
3. Dựng thành phần từ dưới lên; mỗi file <200 dòng.
4. Ghép màn; kiểm tra accent budget bằng tay (không có gate happy-dom cho RN).
5. Duyệt bằng mắt ở 375×812 và 768×1024, sáng và tối.

## Validation

`pnpm --filter mobile test && typecheck && lint`; chạy tay đủ 3 chế độ; ép `lid_capacity` bằng cấu hình dev để thấy dải báo hạ chế độ.

## Risk

Danh sách turn dài làm render chậm → `FlatList` có `keyExtractor` theo `sessionId`, không dùng ScrollView lồng.
