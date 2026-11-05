---
title: 'Mobile UI: auth và translate'
description: 'Register/forgot/Google sign-in, màn translate (one-way, two-way, auto-detect, TTS) và History trên apps/mobile.'
status: completed
priority: P2
effort: 6d
branch: quanganh208/feat/mobile-auth-translate-ui
tags: [frontend, auth, feature]
blockedBy: []
blocks: []
created: 2026-11-05
---

# Mobile UI: auth và translate

## Outcome

Trên dev build: đăng ký, đăng nhập (email + Google), quên mật khẩu; dịch trực tiếp trong MỘT màn
(one-way, two-way vi↔en, auto-detect) với phụ đề live, TTS, voice picker, lưu khi kết thúc;
tab History có danh sách + chi tiết.

## Non-goals

Glossary, translation-contexts, account/preferences, avatar, tab Settings, ghi/phát lại audio,
caption window nổi/fullscreen, ngôn ngữ UI theo locale, universal/app links https, đổi API ngoài: allowlist audience Google (phase 3) và cờ `client` cho link mail (phase 7).

## Evidence (đã kiểm tra trong repo)

- Sign-in thật đã có: `apps/mobile/app/(auth)/sign-in.tsx`, `src/clients/http-auth-client.ts`, SecureStore, refresh.
- Stub: `app/(auth)/sign-up.tsx`, `app/(app)/{conversation,history}.tsx`. `settings.tsx` giữ nguyên.
- Lõi dùng lại: `ConversationSession`, `TranslateSocket`, `pushedCaptureDeps`, `PcmPlaybackQueue`,
  `base64ToPcm16` (`@chatofy/realtime-client`); mic `src/conference/native-pcm-recorder.ts` + `native-audio-capture.ts`;
  phát `src/conference/native-audio-playback.ts` (gắn theo `speakerSocketId` của cuộc họp); `TRANSLATE_WS_URL` ở `conference-config.ts`.
- Web để đối chiếu: `apps/web/src/hooks/use-streaming-translate.ts` (749 dòng), `use-conversation-save.ts`, `use-conversation-history.ts`, `use-voice-catalog.ts`, `lib/translate-settings.ts`, `clients/api-client.ts` (`saveConversation`, `listConversations`, `getConversation`, `listVoices`, `register`, `forgotPassword`).
- API: `POST /auth/google` nhận `{idToken}`, nhưng `GoogleTokenVerifier` chỉ có MỘT audience là `AUTH_GOOGLE_ID`
  (`docs/environment-variables.md` mục "Google sign-in" nói rõ mobile sẽ cần biến mới).
- Mail verify/reset dựng link từ `WEB_BASE_URL` (`auth-mailer.ts`) => mở web, không mở app.

## Quyết định đã chốt trong plan (cần xác nhận ở validate)

1. Link email mở vào app (chủ dự án chọn deep link). API nhận cờ enum `client: 'web'|'mobile'` và chọn giữa hai origin đã cấu hình (`WEB_BASE_URL`, `MOBILE_LINK_BASE_URL`, mặc định `chatofy://`); không bao giờ nhận URL từ request (phase 7). App có màn verify-email và reset-password.
2. Google: expo-auth-session + expo-web-browser (PKCE, lấy id_token), không thêm native module. Fallback `@react-native-google-signin` nếu Google chặn custom scheme.
3. Một hook `useTranslateConversation` riêng cho mobile, bám web hook nhưng chỉ phần cần: không speaker attribution, không glossary/context, không recording/upload.

## Rủi ro (đọc trước)

1. Hai consumer mic (họp và translate). Đã chốt: chặn bên mở sau và báo rõ, không tự dừng bên đang chạy.
2. Cần Google client ID iOS/Android do chủ dự án tạo; API cần biến allowlist mới.
3. `NativeTranslationAudioSink` gắn với `speakerSocketId` của cuộc họp; translate cần sink 1 luồng, theo `turnKey`.
4. `tab conversation` hiện là stub trong `(app)/_layout.tsx` với tên "Conversation"; đổi tên route thành translate là đổi deep link nội bộ.

## Phases

| #   | Phase                                               | Phụ thuộc   | File                                                         |
| --- | --------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| 1   | Nền: kit UI, i18n, route guard                      | —           | [phase-01](./phase-01-foundation-ui-kit-i18n-route-guard.md) |
| 2   | Auth email: register, forgot, notice                | 1           | [phase-02](./phase-02-auth-register-forgot-password.md)      |
| 3   | Google sign-in (API allowlist + mobile)             | 1           | [phase-03](./phase-03-google-sign-in.md)                     |
| 4   | Translate: lõi hook, audio in/out, settings         | 1           | [phase-04](./phase-04-translate-core-hook-audio.md)          |
| 5   | Translate: màn hình                                 | 4           | [phase-05](./phase-05-translate-screen.md)                   |
| 6   | History: danh sách + chi tiết                       | 1, 5 (save) | [phase-06](./phase-06-history-list-detail.md)                |
| 7   | Deep link verify/reset (API cờ client + màn mobile) | 2           | [phase-07](./phase-07-email-deep-links.md)                   |
| 8   | Verify, docs, nghiệm thu                            | 2–7         | [phase-08](./phase-08-verification-docs.md)                  |

Phase 2, 3, 4 có file riêng biệt nên chạy song song được sau phase 1 (ngoại lệ: phase 2 và 3 cùng sửa `sign-in.tsx` và `auth-provider.tsx` => làm tuần tự 2 rồi 3).

## Acceptance (từ contract)

1. register → mail → mở deep link → verify → sign-in; forgot → mail → deep link → đặt mật khẩu → sign-in, chạy với API dev.
2. Google sign-in qua `POST /auth/google` ra session hợp lệ và qua refresh rotation.
3. Translate chạy 3 chế độ; `mode: declared` hiển thị "đang chạy one-way"; `language_unavailable` hiển thị.
4. Kết thúc thì lưu, History thấy và mở được chi tiết.
5. `pnpm --filter mobile typecheck|lint|test` + i18n parity pass; có test logic thuần.
6. Mắt ở 375×812, 768×1024, sáng/tối; chạy máy thật là gate của chủ dự án.

## Red-team ngắn (tự rà)

- Assumption: `PcmPlaybackQueue` chạy trên `react-native-audio-api` — đã đúng cho họp (`native-audio-playback.ts`), nhưng chưa thử với một luồng duy nhất => phase 4 có bước smoke bắt buộc.
- Failure: refresh token hết hạn giữa phiên WS => `getAccessToken` đã xử lý; phase 4 phải đóng phiên và hiển thị "đăng nhập lại" thay vì treo.
- Scope: History chi tiết không cần audio; không kéo `/conversations/:id/audio` vào.
- Security: id_token Google không log; PKCE verifier không lưu ngoài bộ nhớ; không đưa client ID vào repo ngoài `.env.example`.

## Kết quả (2026-11-05)

Phase 1-8 đã làm. Khác kế hoạch, có chủ đích:

- Cờ `client` lạ đọc thành `web` (như `locale`), không trả 400; biến cấu hình là `MOBILE_LINK_SCHEME` (chỉ scheme), không phải URL đầy đủ.
- Hàm gọi API của translate/history nằm chung `src/clients/api-client.ts`, không có `translate-api.ts` riêng.
- History dùng `useInfiniteQuery` của React Query thay cho hook phân trang tự viết; chi tiết dùng `useQuery`.
- Mic lock: translate tự kết thúc khi rời tab, nên cuộc họp chỉ cần acquire/release.
- Thêm phụ thuộc: `expo-auth-session`, `expo-crypto`, `zod` (mobile). Cần build lại dev client.
  Chưa kiểm được trong repo (không có thiết bị): chạy máy thật, kiểm bằng mắt 375/768 sáng-tối, Google sign-in thật, TTS một luồng.

## Câu hỏi chưa chốt

- Google client ID iOS/Android: chưa có; phase 3 kèm hướng dẫn tạo trong docs, nút Google ẩn tới khi đặt biến.
- Trước khi phát hành store: custom scheme có thể bị app khác chiếm trên Android; cần app links (ngoài đợt này).
