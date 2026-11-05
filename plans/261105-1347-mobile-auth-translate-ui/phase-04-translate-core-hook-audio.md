# Phase 4: Translate — lõi hook, audio vào/ra, settings

Status: done | Priority: P1 | Depends: 1

## Context

Web chạy phiên bằng `useStreamingTranslate` (749 dòng) quanh `ConversationSession` + `TranslateSocket`. Mobile đã dùng cùng session cho cuộc họp: mic `NativePcmRecorder` + `pushedCaptureDeps`. Phát TTS: `NativeTranslationAudioSink` gắn `speakerSocketId` của cuộc họp (resequencer + `PcmPlaybackQueue` trên `react-native-audio-api`). Contract wire ở `apps/mobile/README.md` (mục "Translation screen"). Quy tắc chọn chế độ ở `apps/web/src/lib/translate-settings.ts` (`asksTwoWay`, `canIdentify`).

## Requirements

- `useTranslateConversation(options)` cho mobile: start/stop, `status`, `turns`, `liveTurns`, `mode`/`modeReason` từ `server.session.ready`, lỗi `language_unavailable` (+`detail`), ngôn ngữ theo turn (final `segment.sourceLanguages` là chuẩn).
- Chọn chế độ thuần: từ (source, target) → one-way / two-way / detect; `detect` chỉ khi `canIdentify(pair,false)`, `twoWay` chỉ khi `canIdentify(pair,true)`; cặp có zh luôn one-way.
- Sink TTS một luồng (`NativeTranslationSink`, khóa theo `turnKey`), gain ≤ 1, voices theo ngôn ngữ (`listVoices`).
- Settings bền (SecureStore hoặc AsyncStorage-tương đương đã có): cặp ngôn ngữ, giọng theo ngôn ngữ, bật/tắt TTS.
- Khóa mic: chặn bên mở sau và báo rõ ("đang họp, hãy rời cuộc họp trước" và ngược lại); không tự dừng bên đang chạy (một cờ trạng thái chung).
- Lỗi auth giữa phiên → đóng phiên + trạng thái "cần đăng nhập lại".
- Không làm: speaker attribution, glossary, context, recording/upload.

## Files

- Create: `apps/mobile/src/translate/{use-translate-conversation.ts, translate-mode.ts, translate-mode.test.ts, translate-settings-store.ts, translate-settings-store.test.ts, native-translate-audio-sink.ts, mic-lock.ts, mic-lock.test.ts, translate-refusal.ts, translate-refusal.test.ts}`
- Create: `apps/mobile/src/translate/translate-api.ts` (`listVoices`, `saveConversation`, `listConversations`, `getConversation` qua `createApiClient`, dùng chung schema của `@chatofy/types`; tách cùng pattern `src/clients/api-client.ts`)
- Modify: `apps/mobile/src/conference/use-conference-native.ts` (chỉ chạm `mic-lock` khi vào/ra họp)
- Reuse, không sửa: `native-pcm-recorder.ts`, `native-audio-capture.ts`, `conference-config.ts`

## Steps

1. Đọc `conversation-session.ts` (deps, listeners, `ServerErrorCause`) và phần dùng nó trong `use-conference-native.ts` + `conference-cascade-leg-native.ts` để lấy đúng cách nối mic native.
2. Viết `translate-mode.ts` + test (ma trận ngôn ngữ vi/en/zh × source cụ thể/detect).
3. Viết sink một luồng dựa `PcmPlaybackQueue` + `base64ToPcm16`; smoke bắt buộc trên máy thật (rủi ro chưa kiểm chứng trên một luồng duy nhất).
4. Viết hook; bắt `server.session.ready.mode`, `server.error`, ngôn ngữ theo turn; `ConversationSession` phải được dọn ở unmount.
5. Settings store + mic-lock + test.

## Validation

- `pnpm --filter mobile test` các test thuần ở trên.
- `pnpm --filter mobile typecheck`.
- Smoke thiết bị: nói vi → thấy partial → final → nghe TTS en; two-way đảo chiều; detect gán nhãn ngôn ngữ.

## Risk / rollback

- Hai consumer mic: mic-lock + iOS audio session `playAndRecord` đã cấu hình trong `NativeAudioCapture`; nếu xung đột, ưu tiên chặn vào translate khi đang họp.
- Echo loa→mic: `CASCADE_RUNTIME_OPTIONS` chấp nhận full duplex; thêm công tắc TTS để người dùng tự tránh.
- Rollback: tab translate trở lại stub, không ảnh hưởng conference.
