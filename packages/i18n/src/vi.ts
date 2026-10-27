import type { Messages } from './en.js';

/**
 * Vietnamese.
 *
 * Typed `Messages`, so a key added to `en.ts` and forgotten here is a compile error
 * rather than an English string surfacing on a Vietnamese page months later. That is
 * the whole reason the dictionary is an object literal and not a JSON file.
 *
 * ## The register
 *
 * `docs/design-guidelines.md` § Copy register governs **each locale independently**.
 * These strings are reviewed against the rule — name the wait, the outcome, or the
 * next step — not against how literally they render the English. English is the
 * reference for MEANING, not for structure: a natural Vietnamese rendering of a wait
 * description is exactly where the pipeline vocabulary the rule deleted creeps back
 * in, because "nhận dạng rồi dịch rồi đọc" reads perfectly well and says the wrong
 * kind of thing.
 *
 * The reviewer test generalises: someone who cannot restate the consequence FROM THE
 * VIETNAMESE ALONE has found a bad translation, not a stylistic quibble.
 *
 * ## Address
 *
 * The reader is **"bạn"**, everywhere. Not "quý khách", which is the register of a
 * bank and wrong for a tool used daily, and not pronoun-avoidance, which is harder to
 * keep consistent than it looks and drifts into passive constructions.
 *
 * ## Length
 *
 * Vietnamese runs longer than English — often 20–30% — and the places that bite are
 * buttons and the uppercase label rows. `Be_Vietnam_Pro` already loads the
 * `vietnamese` subset, so diacritics need no font work; what needs checking is that
 * nothing overflows at 320px in this locale, which is a criterion of its own.
 *
 * The two demo lines on the landing page are NOT translated in the usual sense. They
 * are a conversation between a Vietnamese speaker and an English one, so each side
 * keeps its own language in both locales — translating the English half into
 * Vietnamese would show a Vietnamese person being answered in Vietnamese, which is
 * not what the product does.
 */
export const vi: Messages = {
  'common.theme.light': 'Sáng',
  'common.theme.dark': 'Tối',
  'common.theme.system': 'Theo hệ thống',
  'common.theme.label': 'Giao diện màu',

  'common.language.vietnamese': 'Tiếng Việt',
  'common.language.english': 'English',
  'common.language.label': 'Ngôn ngữ',

  // ---- common.languageName ----
  'common.languageName.vi': 'Tiếng Việt',
  'common.languageName.en': 'Tiếng Anh',
  'common.languageName.zh': 'Tiếng Trung',

  // ---- common.auth ----
  'common.auth.signOut': 'Đăng xuất',
  'common.auth.signIn': 'Đăng nhập',
  'common.auth.signingIn': 'Đang đăng nhập…',
  'common.auth.email': 'Email',
  'common.auth.password': 'Mật khẩu',

  // ---- common.conference ----
  'common.conference.lobbyTitle': 'Hội nghị video',
  'common.conference.create': 'Tạo phòng',
  'common.conference.join': 'Tham gia phòng',
  'common.conference.yourName': 'Tên của bạn',
  'common.conference.yourNamePlaceholder': 'Người khác sẽ thấy tên này',
  'common.conference.roomId': 'Mã phòng',
  'common.conference.roomIdPlaceholder': 'Nhập mã phòng để tham gia',
  'common.conference.sourceLanguage': 'Ngôn ngữ của bạn',
  'common.conference.start': 'Bắt đầu',
  'common.conference.leave': 'Rời phòng',
  'common.conference.waiting': 'Đang chờ người khác tham gia…',
  'common.conference.connecting': 'Đang kết nối…',
  'common.conference.you': 'Bạn',
  // The translated voice: what others hear this speaker's translation in.
  'common.conference.translatedVoice': 'Giọng dịch',
  'common.conference.translatedVoiceHint': 'Người khác nghe bản dịch lời bạn bằng giọng này.',
  'common.conference.voiceFemale': 'Nữ',
  'common.conference.voiceMale': 'Nam',
  'common.conference.muteMic': 'Tắt micro',
  'common.conference.unmuteMic': 'Bật micro',
  'common.conference.disableCamera': 'Tắt camera',
  'common.conference.enableCamera': 'Bật camera',
  'common.conference.participants': 'Người tham gia',
  'common.conference.cameraOff': 'Camera tắt',
  'common.conference.rosterTitle': 'Trong cuộc gọi này',
  'common.conference.hideRoster': 'Ẩn danh sách',
  'common.conference.chatTitle': 'Trò chuyện',
  'common.conference.chatPlaceholder': 'Nhập tin nhắn…',
  'common.conference.chatSend': 'Gửi',
  'common.conference.chatEmpty': 'Chưa có tin nhắn nào.',
  'common.conference.permissionDenied': 'Cần quyền truy cập camera và micro.',
  'common.conference.permissionDeniedAudioOnly': 'Không có camera — tham gia chỉ với âm thanh.',
  'common.conference.disconnected': 'Mất kết nối.',
  'common.conference.disconnectedHint': 'Cuộc gọi đã kết thúc. Quay lại sảnh để tham gia lại.',
  'common.conference.backToLobby': 'Về sảnh',
  'common.conference.errorGeneric': 'Đã xảy ra lỗi.',
  'common.conference.translationEnded':
    'Đã dừng dịch — mọi người giờ nghe bạn mà không có bản dịch. Tham gia lại cuộc gọi để bật lại.',
  'common.conference.translating': 'Đang dịch…',
  'common.conference.reconnecting': 'Đang kết nối lại ({attempt}/{cap})…',
  'common.conference.creating': 'Đang tạo…',
  'common.conference.createFailed': 'Không tạo được phòng. Hãy thử lại.',
  'common.conference.roomNotFound': 'Phòng này không tồn tại.',
  'common.conference.roomEnded': 'Cuộc họp này đã kết thúc.',
  'common.conference.endedTitle': 'Cuộc họp đã kết thúc',
  'common.conference.endedLoading': 'Đang tải cuộc họp…',
  'common.conference.endedNotFound':
    'Bạn không tham gia cuộc họp này, hoặc cuộc họp không tồn tại.',
  'common.conference.endedLoadFailed': 'Không tải được cuộc họp này. Hãy thử lại sau.',
  'common.conference.summaryDuration': 'Thời lượng',
  'common.conference.summaryLanguages': 'Ngôn ngữ',
  'common.conference.durationMinutes': '{minutes} phút',
  'common.conference.durationHours': '{hours} giờ {minutes} phút',
  'common.conference.durationUnknown': 'Không ghi nhận',
  'common.conference.guest': 'Khách',
  'common.conference.chatRateLimited': 'Gửi chậm lại — hãy đợi vài giây rồi gửi tiếp.',
  'common.conference.chatNotSent': 'Chưa gửi được tin nhắn.',

  // ---- common.minutes ----
  'common.minutes.title': 'Biên bản cuộc họp',
  'common.minutes.generate': 'Tạo biên bản',
  'common.minutes.regenerate': 'Tạo lại',
  'common.minutes.failed': 'Không tạo được biên bản. Thử lại nhé.',
  'common.minutes.summary': 'Tóm tắt',
  'common.minutes.keyPoints': 'Ý chính',
  'common.minutes.decisions': 'Quyết định',
  'common.minutes.actionItems': 'Việc cần làm',
  'common.minutes.noActionItems': 'Không có việc cần làm.',
  'common.minutes.owner': 'Phụ trách',
  'common.minutes.due': 'Hạn',
  'common.minutes.nothingSaid': 'Cuộc họp này không có ai nói gì nên không có gì để tóm tắt.',

  'common.transcript': 'Bản ghi',

  'web.chrome.skipToContent': 'Tới nội dung chính',
  'web.chrome.productNav': 'Sản phẩm',
  'web.chrome.navTranslate': 'Dịch',
  'web.chrome.navConference': 'Hội thảo',
  'web.chrome.navHistory': 'Lịch sử',
  'web.chrome.navPreferences': 'Tuỳ chọn',
  'web.chrome.navAccount': 'Tài khoản',
  'web.chrome.toggleSidebar': 'Đóng mở thanh bên',
  'web.chrome.accountMenu': 'Tài khoản của bạn',
  'web.chrome.signedInAs': 'Đang đăng nhập bằng',
  'web.chrome.getStarted': 'Bắt đầu',
  'web.chrome.openApp': 'Mở Chatofy',

  'web.auth.name': 'Tên',
  'web.auth.newPassword': 'Mật khẩu mới',
  'web.auth.createAccount': 'Tạo tài khoản',
  'web.auth.createAccountHeading': 'Tạo tài khoản',
  'web.auth.creatingAccount': 'Đang tạo tài khoản…',
  'web.auth.haveAccountPrompt': 'Bạn đã có tài khoản?',
  'web.auth.forgotPasswordShort': 'Quên mật khẩu?',
  'web.auth.forgotPasswordLink': 'Quên mật khẩu?',
  'web.auth.forgotPasswordBody':
    'Nhập email của tài khoản, chúng tôi sẽ gửi cho bạn một liên kết để đặt lại mật khẩu.',
  'web.auth.backToSignIn': 'Quay lại đăng nhập',
  'web.auth.resetPasswordHeading': 'Đặt lại mật khẩu',
  'web.auth.resetPasswordSubmit': 'Đặt lại mật khẩu',
  'web.auth.resetting': 'Đang đặt lại…',
  'web.auth.chooseNewPassword': 'Chọn mật khẩu mới cho tài khoản của bạn.',
  'web.auth.verifyEmailHeading': 'Xác minh email',
  'web.auth.verifyEmailBody': 'Xác nhận bên dưới để hoàn tất việc tạo tài khoản.',
  'web.auth.checkYourEmail':
    'Kiểm tra email của bạn, trong đó có liên kết để hoàn tất việc tạo tài khoản.',
  'web.auth.resetLinkSent':
    'Nếu email đó có tài khoản, liên kết đặt lại mật khẩu đang trên đường tới.',
  'web.auth.passwordTooShort': 'Mật khẩu quá ngắn',
  'web.auth.createFailed': 'Chưa tạo được tài khoản. Bạn thử lại nhé.',
  'web.auth.resetFailed': 'Chưa đặt lại được mật khẩu. Bạn thử lại nhé.',
  'web.auth.sendResetFailed': 'Chưa gửi được liên kết đặt lại. Bạn thử lại nhé.',
  'web.auth.verifyFailed': 'Chưa xác minh được liên kết này. Bạn thử lại nhé.',
  'web.auth.serverUnreachable': 'Không kết nối được tới máy chủ.',
  'web.auth.tookTooLong': 'Lâu quá — bạn thử lại nhé.',
  'web.auth.unexpectedResponse': 'Máy chủ trả về nội dung không như mong đợi.',
  'web.auth.accountRequired':
    'Muốn dịch thì cần một tài khoản — mọi cuộc hội thoại và bản ghi đều thuộc về một tài khoản.',
  'web.auth.orContinueWithEmail': 'hoặc tiếp tục bằng email',
  'web.auth.continueWithGoogle': 'Tiếp tục với Google',
  'web.auth.credentialsRejected': 'Email và mật khẩu này không khớp với tài khoản nào.',
  'web.auth.sendResetLink': 'Gửi liên kết đặt lại',
  'web.auth.sending': 'Đang gửi…',
  'web.auth.verifyEmailSubmit': 'Xác minh email',
  'web.auth.verifying': 'Đang xác minh…',
  'web.auth.resetLinkMissingCode': 'Liên kết này thiếu mã đặt lại mật khẩu.',
  'web.auth.verifyLinkMissingCode': 'Liên kết này thiếu mã xác minh.',
  'web.auth.accountExists': 'Tài khoản đó đã tồn tại.',
  'web.auth.googleRefused':
    'Không dùng được tài khoản Google đó để đăng nhập. Nếu email này đã có mật khẩu, bạn đăng nhập bằng mật khẩu bên dưới.',
  'web.auth.signInServerFault':
    'Hiện chưa đăng nhập được — lỗi nằm ở phía chúng tôi, không phải email hay mật khẩu của bạn. Bạn thử lại sau giây lát.',
  'web.auth.signInUnavailable':
    'Hiện chưa đăng nhập được — lỗi nằm ở phía chúng tôi, không phải tài khoản của bạn. Bạn thử lại sau ít phút, hoặc đăng nhập bằng mật khẩu bên dưới.',
  'web.auth.noticeVerified': 'Tài khoản của bạn đã sẵn sàng. Đăng nhập bên dưới để bắt đầu.',
  'web.auth.noticeReset': 'Mật khẩu của bạn đã đổi. Đăng nhập bằng mật khẩu mới.',

  'web.meta.home': 'Chatofy — dịch giọng nói thời gian thực cho trò chuyện và họp trực tuyến',
  'web.meta.homeDescription':
    'Chatofy dịch giọng nói theo thời gian thực giữa tiếng Việt, tiếng Anh và tiếng Trung, khi trò chuyện trực tiếp, trong cuộc họp video và trên Google Meet, Zoom, Facebook.',
  'web.meta.signIn': 'Đăng nhập · Chatofy',
  'web.meta.register': 'Tạo tài khoản · Chatofy',
  'web.meta.verifyEmail': 'Xác minh email · Chatofy',
  'web.meta.forgotPassword': 'Quên mật khẩu · Chatofy',
  'web.meta.resetPassword': 'Đặt lại mật khẩu · Chatofy',
  'web.meta.translate': 'Dịch · Chatofy',
  'web.meta.history': 'Lịch sử · Chatofy',
  'web.meta.preferences': 'Tuỳ chọn · Chatofy',
  'web.meta.account': 'Tài khoản · Chatofy',

  'web.translate.startTranslating': 'Bắt đầu dịch',
  'web.translate.startConversation': 'Bắt đầu hội thoại',
  'web.translate.end': 'Kết thúc',
  'web.translate.pause': 'Tạm dừng',
  'web.translate.resume': 'Tiếp tục',
  'web.translate.notListening': 'Chưa nghe',
  'web.translate.connecting': 'Đang kết nối…',
  'web.translate.listening': 'Đang nghe — bạn cứ nói',
  'web.translate.hearingYou': 'Đang nghe bạn nói…',
  'web.translate.translating': 'Đang dịch…',
  'web.translate.speaking': 'Đang đọc',
  'web.translate.paused': 'Đã tạm dừng',
  'web.translate.finishing': 'Đang kết thúc — đọc nốt bản dịch cuối',
  'web.translate.elapsedLabel': 'Thời gian từ khi bắt đầu hội thoại',
  'web.translate.transcriptEmpty':
    'Chưa có gì — bắt đầu một cuộc hội thoại và cả hai bên sẽ hiện ở đây.',
  'web.translate.panelSourceEmpty': 'Câu bạn nói sẽ hiện ở đây.',
  'web.translate.panelTargetEmpty': 'Bản dịch hiện ở đây.',
  'web.translate.speakTranslation': 'Đọc bản dịch',
  'web.translate.speakTranslationAria': 'Đọc bản dịch thành tiếng',
  'web.translate.speakOn': 'bật',
  'web.translate.speakOff': 'tắt',
  'web.translate.speakLocked': 'Chọn trước khi bắt đầu hội thoại',
  'web.translate.voice': 'Giọng đọc',
  'web.translate.voiceFemale': 'Nữ',
  'web.translate.voiceMale': 'Nam',
  'web.translate.voiceAll': 'Tất cả',
  'web.translate.voiceGender': 'Giới tính giọng đọc',
  'web.translate.speed': 'Tốc độ',
  'web.translate.volume': 'Âm lượng',
  'web.translate.volumeAria': 'Âm lượng phát',
  'web.translate.paneSource': 'Bản ghi tiếng nguồn',
  'web.translate.paneTarget': 'Bản ghi bản dịch',
  'web.translate.speakerLabels': 'Nhãn người nói',
  'web.translate.translationOnly': 'Chỉ hiện bản dịch',
  'web.translate.freeScroll': 'Cuộn tự do',
  'web.translate.displayMode': 'Chế độ hiển thị',
  'web.translate.displayModeSplit': 'Chia đôi',
  'web.translate.displayModeList': 'Danh sách',
  'web.translate.textSize': 'Cỡ chữ',
  'web.translate.paneLayout': 'Bố cục',
  'web.translate.paneLayoutRow': 'Ngang',
  'web.translate.paneLayoutColumn': 'Dọc',
  'web.translate.voiceSettings': 'Cài đặt giọng đọc',
  'web.translate.displaySettings': 'Cài đặt hiển thị',
  'web.translate.context': 'Ngữ cảnh AI',
  'web.translate.contextNone': 'Không dùng',
  'web.translate.contextLocked': 'Ngữ cảnh giữ nguyên cho tới khi cuộc trò chuyện này kết thúc.',
  'web.translate.contextLoading': 'Đang tải Ngữ cảnh AI…',
  'web.translate.contextUnavailable':
    'Không tải được Ngữ cảnh AI. Bắt đầu ngay bây giờ sẽ không dùng ngữ cảnh này.',
  'web.translate.registerNeutral': 'Trung tính',
  'web.translate.registerFormal': 'Trang trọng',
  'web.translate.registerCasual': 'Thân mật',
  'web.translate.languagePair': 'Ngôn ngữ',
  'web.translate.languagePairSource': 'Nguồn',
  'web.translate.languagePairTarget': 'Bản dịch',
  'web.translate.languagePairSwap': 'Đảo ngôn ngữ — dịch {from} sang {to}',
  'web.translate.languagePairSwapDetect': 'Đảo ngôn ngữ — không dùng được khi Tự nhận diện',
  'web.translate.autoDetect': 'Tự nhận diện',
  'web.translate.modeTwoWay': 'Hai chiều',
  'web.translate.modeOneWay': 'Một chiều',
  'web.translate.turnLanguage': 'Nói bằng {language}',
  'web.translate.twoWayUnavailable':
    'Tạm thời chỉ dịch một chiều: {from} sang {to}. Câu nói bằng {to} sẽ không được dịch.',
  'web.translate.detectUnavailable':
    'Hiện chưa tự nhận diện được ngôn ngữ. Hãy chọn ngôn ngữ đang nói để tiếp tục.',
  'web.translate.detectBusy':
    'Tính năng tự nhận diện đang bận. Hãy thử lại sau ít phút, hoặc chọn ngôn ngữ đang nói.',
  'web.translate.voiceDefault': 'Mặc định',
  'web.translate.voiceListFailed':
    'Chưa tải được danh sách giọng đọc. Lựa chọn giới tính giọng ở trên vẫn áp dụng.',
  'web.translate.turnUnheard': 'Chưa được đọc — phát bị tụt lại',
  'web.translate.transcriptListening': 'Đang nghe. Cuộc hội thoại sẽ hiện ở đây khi được dịch.',
  'web.translate.transcriptAttribution': 'Mỗi lượt nói có thể được đánh dấu là ai đã nói.',
  // Chỉ hiện ở lượt đã được chỉnh lại. "Bản máy nghe" nói rõ đó là đầu ra thô
  // của bộ nhận dạng, không phải một cách diễn đạt khác của cùng một câu.
  'web.translate.sourceRawToggle': 'Bản máy nghe',
  'web.translate.sourceRawLabel': 'Máy nhận dạng:',
  'web.translate.speakerUnknown': 'Ai đã nói?',
  'web.translate.speakerAsk': 'Cho biết ai đã nói',
  'web.translate.speakerPending': 'Đang xác định…',
  'web.translate.speakerPendingAria': 'Đang xác định ai đã nói. Cho biết ai, hoặc chờ.',
  'web.translate.speakerChange': '{name} đã nói. Đổi.',
  'web.translate.speakerNobody': 'Không ai',
  'web.translate.speakerAdd': 'Thêm người',
  'web.translate.speakerManage': 'Đổi tên hoặc xóa',
  'web.translate.speakerManageDone': 'Xong',
  'web.translate.speakerDefault': 'Người nói {number}',
  'web.translate.speakerRosterHint': 'Thêm những người đang nói để đánh dấu ai đã nói ở mỗi lượt.',
  'web.translate.speakerNameFor': 'Tên của {name}',
  'web.translate.speakerRemove': 'Xóa {name}',
  'web.translate.speakerRemoveBlocked': '{name} đang được gắn cho một lượt nói. Đổi lượt đó trước.',
  'web.translate.speakerRemoveBlockedAria': 'Không xóa được {name}: đang được gắn cho một lượt nói',
  'web.translate.speakerLimit': 'Tối đa {max} người',
  'web.translate.attributionStats':
    '{total} lượt · {automatic} máy tự đặt · {confirmed} bạn đánh dấu · {fallback} chưa đánh dấu',
  'web.translate.attributionSuggestions':
    'gợi ý: {agreed} khớp, {changed} đã sửa, {unreviewed} chưa xem',
  'web.translate.micLevel': 'Mức tín hiệu micro',
  'web.translate.micNotFound': 'Không tìm thấy micro. Bạn cắm micro vào để bắt đầu hội thoại nhé.',
  'web.translate.micDenied':
    'Trình duyệt đang chặn micro. Bạn cho phép ở thanh địa chỉ để bắt đầu hội thoại nhé.',
  'web.translate.micBusy':
    'Một ứng dụng khác đang giữ micro. Bạn đóng ứng dụng đó rồi bắt đầu hội thoại lại nhé.',
  'web.translate.serviceUnreachable':
    'Không kết nối được tới dịch vụ dịch. Bây giờ chưa bắt đầu hội thoại được đâu.',
  'web.translate.micFailed': 'Chưa khởi động được micro.',

  'web.translate.saveFailedRetryable':
    'Cuộc hội thoại này chưa được lưu. Nó sẽ không xuất hiện trong lịch sử cho đến khi lưu xong.',
  'web.translate.saveFailedTerminal':
    'Không lưu được cuộc hội thoại này, nên nó sẽ không xuất hiện trong lịch sử và không thể tóm tắt.',
  'web.translate.saveEditsFailed':
    'Những thay đổi mới nhất chưa được lưu. Cuộc hội thoại vẫn nằm trong lịch sử của bạn.',
  'web.translate.saveRetry': 'Lưu lại',
  'web.translate.saving': 'Đang lưu…',
  'web.translate.recordingFailedRetryable':
    'Bản ghi âm chưa được lưu. Bản thân cuộc hội thoại vẫn nằm trong lịch sử của bạn.',
  'web.translate.recordingFailedTerminal':
    'Không lưu được bản ghi âm, nên cuộc hội thoại này không có tiếng để nghe lại. Bản thân cuộc hội thoại vẫn nằm trong lịch sử của bạn.',
  'web.translate.recordingUploading': 'Đang lưu bản ghi âm…',
  'web.translate.minutesNeedsSave': 'Biên bản được tạo từ cuộc hội thoại đã lưu.',

  // ---- web.translate.minutes ----
  'web.translate.minutesGenerating': 'Đang tóm tắt cuộc trò chuyện…',
  'web.translate.minutesEmpty':
    'Chưa có biên bản. Tạo biên bản để có phần tóm tắt, ý chính, quyết định và việc cần làm.',
  'web.translate.minutesNeedsTurns': 'Hãy trò chuyện trước đã — chưa có gì để tóm tắt.',
  'web.translate.minutesCopy': 'Sao chép',
  'web.translate.minutesCopied': 'Đã sao chép',

  'web.error.title': 'Có gì đó không ổn',
  'web.error.retry': 'Thử lại',
  'web.error.appBody':
    'Trang này chưa tải được. Bạn thử lại nhé; nếu cứ lặp lại thì có thể máy chủ dịch đang không kết nối được.',
  'web.error.authBody':
    'Bước này chưa hoàn tất được. Có thể liên kết đã hết hạn — bạn xin một liên kết mới rồi thử lại.',
  'web.error.pageDidNotLoad': 'Trang này chưa tải được. Bạn thử lại nhé.',
  'web.error.notFound': 'Trang này không tồn tại',
  'web.error.notFoundBody': 'Có thể địa chỉ đã đổi, hoặc liên kết dẫn bạn tới đây đã cũ.',
  'web.error.goToStart': 'Về trang đầu',

  // ---- web.languageShort ----
  'web.languageShort.vi': 'Việt',
  'web.languageShort.en': 'Anh',
  'web.languageShort.zh': 'Trung',

  // ---- web.history ----
  'web.history.empty': 'Chưa có cuộc hội thoại nào',
  'web.history.emptyBody':
    'Những cuộc hội thoại bạn kết thúc sẽ được lưu ở đây, để bạn đọc lại và tóm tắt sau.',
  'web.history.searchLabel': 'Tìm trong các cuộc hội thoại',
  'web.history.searchPlaceholder': 'Tìm…',
  'web.history.searchNoResults': 'Không có cuộc hội thoại nào khớp.',
  'web.history.clearSearch': 'Xoá tìm kiếm',
  'web.history.back': 'Quay lại lịch sử',
  'web.history.turnCount': '{count} dòng',
  'web.history.turnCountOne': '1 dòng',
  'web.history.duration': '{minutes} phút',
  'web.history.languagePair': '{from} → {to}',
  'web.history.languagePairShort': '{from} → {to}',
  'web.history.autoDetect': 'Tự nhận diện',
  'web.history.minutesReady': 'Có biên bản',
  'web.history.cancel': 'Huỷ',
  'web.history.delete': 'Xoá',
  'web.history.deleteConfirm': 'Xoá cuộc hội thoại này và biên bản của nó? Không thể hoàn tác.',
  'web.history.deleting': 'Đang xoá…',
  'web.history.deleteFailed': 'Không xoá được cuộc hội thoại này. Nó vẫn còn ở đây.',
  'web.history.loading': 'Đang tải các cuộc hội thoại…',
  'web.history.loadFailed': 'Không tải được lịch sử. Hãy thử lại.',
  'web.history.retry': 'Thử lại',
  'web.history.notFound': 'Cuộc hội thoại này không còn nữa.',
  'web.history.notFoundBody': 'Có thể nó đã bị xoá, hoặc lúc này chưa kết nối được tới máy chủ.',
  'web.history.speakerA': 'Người nói A',
  'web.history.speakerB': 'Người nói B',
  'web.history.playRecording': 'Nghe bản ghi âm',
  'web.history.pauseRecording': 'Tạm dừng bản ghi âm',
  'web.history.playFrom': 'Nghe từ {time}',
  'web.history.recordingLabel': 'Vị trí trong bản ghi âm',
  'web.history.recordingFailed': 'Không tải được bản ghi âm.',
  'web.history.loadMore': 'Tải thêm',
  'web.history.loadMoreFailed': 'Không tải thêm được cuộc hội thoại nào.',

  'web.preferences.conversation': 'Mặc định cho hội thoại mới',
  'web.preferences.conversationHint':
    'Một cuộc hội thoại mới bắt đầu từ những lựa chọn này. Trong lúc đang dịch, bạn đổi ngay trên trang Dịch — ngôn ngữ và giọng thì cố định cho tới khi cuộc đó kết thúc.',
  // AI Context — thư viện ngữ cảnh đã đặt tên.
  'web.preferences.aiContext': 'Ngữ cảnh AI',
  'web.preferences.aiContextHint':
    'Cho trình dịch biết cuộc trò chuyện nói về chuyện gì trước khi nó nghe bất cứ câu nào — chủ đề, những cái tên sẽ xuất hiện, và cách bạn muốn một số từ được dịch ra. Khi bắt đầu một cuộc trò chuyện, bạn chọn một ngữ cảnh ở đây hoặc trong tiện ích trình duyệt.',
  'web.preferences.aiContext.empty': 'Bạn chưa có ngữ cảnh nào. Hãy tạo một cái để bắt đầu.',
  'web.preferences.aiContext.new': 'Ngữ cảnh mới',
  'web.preferences.aiContext.edit': 'Sửa',
  'web.preferences.aiContext.delete': 'Xoá',
  'web.preferences.aiContext.deleting': 'Đang xoá…',
  'web.preferences.aiContext.deleteFailed': 'Không xoá được ngữ cảnh này. Nó vẫn còn đây.',
  'web.preferences.aiContext.save': 'Lưu ngữ cảnh',
  'web.preferences.aiContext.cancel': 'Huỷ',
  'web.preferences.aiContext.saving': 'Đang lưu…',
  'web.preferences.aiContext.name': 'Tên',
  'web.preferences.aiContext.description': 'Cuộc trò chuyện nói về chuyện gì',
  'web.preferences.aiContext.descriptionHint':
    'Vài chữ thôi, ví dụ "nhận phòng khách sạn" hoặc "khám tim mạch". Nó giúp trình dịch chọn đúng nghĩa khi một câu có thể hiểu theo nhiều cách.',
  'web.preferences.aiContext.keywords': 'Tên riêng và thuật ngữ sẽ xuất hiện',
  'web.preferences.aiContext.keywordsHint':
    'Tên riêng, thuật ngữ chuyên ngành, tên sản phẩm — những từ hay bị nghe nhầm nhất.',
  'web.preferences.aiContext.keywordTooLong':
    'Một dòng dài quá — tối đa {max} ký tự. Hãy rút gọn hoặc xoá dòng này.',
  'web.preferences.aiContext.keywordsTooMany':
    'Bạn đang có {count} từ, trong khi giới hạn là {max}. Hãy bớt đi trước khi lưu.',
  'web.preferences.aiContext.glossary': 'Cách dịch mong muốn',
  'web.preferences.aiContext.glossaryHint':
    'Cách bạn muốn một từ cụ thể được dịch ra. Hãy viết từ đó bằng ít nhất hai thứ tiếng; trình dịch dùng đúng hai thứ tiếng của cuộc hội thoại, theo chiều nào cũng được, và chỉ khi từ đó thực sự được nói ra.',
  'web.preferences.aiContext.glossaryTooLong':
    'Cách dịch chỉ nên là một từ hoặc một cụm ngắn — tối đa {max} chữ. Hãy rút gọn cặp này, hoặc xoá nó đi.',
  'web.preferences.aiContext.glossaryAdd': 'Thêm một cặp',
  'web.preferences.aiContext.glossaryRemove': 'Xoá cặp này',
  'web.preferences.aiContext.register': 'Văn phong',
  'web.preferences.aiContext.limitReached':
    'Bạn đã đạt số ngữ cảnh tối đa. Hãy xoá bớt một cái để tạo cái mới.',
  'web.preferences.aiContext.saveFailed':
    'Không lưu được ngữ cảnh này. Những gì bạn vừa nhập vẫn còn nguyên.',
  'web.preferences.aiContext.loadFailed':
    'Không tải được danh sách ngữ cảnh. Phiên đăng nhập của bạn vẫn còn hiệu lực.',
  'web.preferences.interface': 'Giao diện',

  'web.account.memberSince': 'Tham gia từ',
  'web.account.nameUnset': 'Chưa đặt',
  'web.account.loadFailed':
    'Chưa tải được thông tin tài khoản. Phiên đăng nhập của bạn vẫn còn hiệu lực.',
  'web.account.avatarChange': 'Đổi ảnh',
  'web.account.avatarRemove': 'Xoá ảnh',
  'web.account.avatarHint':
    'Hiển thị cạnh tên bạn ở đây và trong thanh bên. Ảnh vuông là đẹp nhất; chúng tôi cắt vào giữa.',
  'web.account.avatarNotAnImage': 'Tệp đó không phải ảnh. Hãy chọn JPEG, PNG hoặc WebP.',
  'web.account.avatarTooLarge': 'Ảnh đó quá lớn. Hãy chọn ảnh dưới 256KB.',
  'web.account.avatarFailed': 'Chưa lưu được ảnh đó. Hãy thử lại.',
  'web.account.avatarUnavailable':
    'Chưa lưu được ảnh — không có gì bị thay đổi. Hãy thử lại; nếu vẫn lỗi, hãy báo cho người quản trị máy chủ.',
  'web.account.security': 'Bảo mật',
  'web.account.changePassword': 'Đổi mật khẩu',
  'web.account.changePasswordHint':
    'Chúng tôi gửi cho bạn một liên kết qua email. Hoàn tất liên kết đó cũng sẽ vô hiệu phiên đăng nhập trên các thiết bị khác của bạn và đóng cuộc dịch nào còn đang mở.',
  'web.account.signOutHint':
    'Chỉ đăng xuất khỏi trình duyệt này. Các thiết bị khác vẫn đăng nhập cho tới khi phiên của chúng hết hạn.',

  'web.landing.heroTitle': 'Nói bằng ngôn ngữ của bạn. Được hiểu bằng ngôn ngữ của người nghe.',
  'web.landing.heroBody':
    'Dịch giọng nói theo thời gian thực giữa tiếng Việt, tiếng Anh và tiếng Trung — khi trò chuyện trực tiếp trên trình duyệt, trong cuộc họp video, hoặc ngay trong cuộc gọi Google Meet, Zoom hoặc Facebook.',
  'web.landing.meetingsStart': 'Tạo cuộc họp',
  'web.landing.demoListening': 'Đang nghe',
  'web.landing.demoSourceOne': 'Chào anh, mình muốn hỏi về lịch họp chiều nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure — it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'Được thôi — cuộc họp đã dời sang bốn giờ.',
  'web.landing.howTitle': 'Cách hoạt động',
  'web.landing.howBody': 'Ba điều đáng biết trước khi bạn cấp quyền micro.',
  'web.landing.howOneTitle': 'Bấm bắt đầu, rồi cứ nói',
  'web.landing.howOneBody':
    'Không cần giữ nút. Lượt nói kết thúc khi bạn dừng lại, và bản dịch được phát sau khoảng một giây.',
  'web.landing.howTwoTitle': 'Tự động nhận biết ngôn ngữ',
  'web.landing.howTwoBody':
    'Chatofy tự phân biệt tiếng Việt và tiếng Anh trong lúc bạn nói. Với tiếng Trung, bạn chọn ngôn ngữ trước khi bắt đầu.',
  'web.landing.howThreeTitle': 'Nghe bản dịch, không phải đọc',
  'web.landing.howThreeBody':
    'Bản dịch được đọc thành tiếng. Phần chữ vẫn ở lại trên màn hình để bạn đối chiếu.',
  'web.landing.meetingsTitle': 'Cuộc họp đa ngôn ngữ, dịch trực tiếp',
  'web.landing.meetingsBody':
    'Chia sẻ một đường liên kết; mỗi người tham gia nghe cuộc họp bằng ngôn ngữ của mình.',
  'web.landing.meetingsLinkTitle': 'Tham gia bằng một đường liên kết',
  'web.landing.meetingsLinkBody':
    'Người dùng có tài khoản chỉ cần mở liên kết để tham gia, không cần cài đặt.',
  'web.landing.meetingsHearTitle': 'Phụ đề và giọng đọc theo ngôn ngữ của bạn',
  'web.landing.meetingsHearBody':
    'Lời của mỗi người được dịch, hiển thị phụ đề và đọc lại bằng ngôn ngữ bạn chọn.',
  'web.landing.meetingsChatTitle': 'Tin nhắn được dịch tự động',
  'web.landing.meetingsChatBody': 'Mỗi tin nhắn hiển thị theo ngôn ngữ của người nhận.',
  'web.landing.meetingsMinutesTitle': 'Biên bản cuộc họp',
  'web.landing.meetingsMinutesBody':
    'Sau buổi họp, bạn có thể tạo biên bản gồm tóm tắt nội dung, các quyết định và đầu việc ngay tại màn hình kết thúc.',
  'web.landing.meetingsScope': 'Cuộc họp hỗ trợ dịch giữa tiếng Việt, tiếng Anh và tiếng Trung.',
  // Vì sao khối này không nói giọng nói được xử lý ở đâu: xem chú thích trong bản
  // tiếng Anh.
  'web.landing.localTitle': 'Dữ liệu ghi âm của bạn được xử lý thế nào',
  'web.landing.localBody':
    'Dịch vụ dịch chỉ nhận văn bản, không bao giờ nhận âm thanh của bạn. Dưới đây là những gì được lưu lại và những gì không.',
  'web.landing.localKeptHistory':
    'Khi một cuộc hội thoại kết thúc, bản ghi âm cùng phần chữ được lưu vào lịch sử của bạn, để bạn nghe lại và đọc lại.',
  'web.landing.localKeptLink':
    'Bản ghi âm được lưu tại một địa chỉ khó đoán mà bất kỳ ai có đường liên kết đó cũng mở được, nên chính đường liên kết là thứ giữ cho nó riêng tư.',
  'web.landing.localKeptPause':
    'Khi tạm dừng cuộc hội thoại, bản ghi âm cũng tạm dừng theo: những gì nói trong lúc tạm dừng không được ghi lại và không được dịch.',
  'web.landing.localKeptDelete': 'Xoá một cuộc hội thoại sẽ xoá luôn bản ghi âm của nó.',
  'web.landing.localKeptMeeting':
    'Cuộc họp lưu lời nói và tin nhắn dưới dạng văn bản, không lưu âm thanh. Mọi người đã tham gia đều đọc được, và hiện chưa có cách xoá.',
  'web.landing.surfacesTitle': 'Chatofy chạy ở đâu',
  'web.landing.surfaceBrowserTitle': 'Trên trình duyệt',
  'web.landing.surfaceBrowserBody':
    'Dịch hội thoại hoặc tổ chức cuộc họp ngay trên trình duyệt, không cần cài đặt.',
  'web.landing.surfaceExtensionTitle': 'Tiện ích cho Meet, Zoom và Facebook',
  'web.landing.surfaceExtensionBody': 'Dịch hai chiều ngay trong cuộc gọi bạn đang dùng.',
  'web.landing.surfacePhoneTitle': 'Trên điện thoại',
  'web.landing.surfacePhoneBody':
    'Đang phát triển. Đã hỗ trợ tham gia cuộc họp; chưa phát hành trên kho ứng dụng.',
  'web.landing.ctaTitle': 'Thử một cuộc hội thoại',
  'web.landing.ctaBody': 'Cần một micro và một tài khoản. Không cần thẻ.',
  'web.landing.navMenu': 'Danh mục',
  'web.landing.navMeetings': 'Cuộc họp',
  'web.landing.navHow': 'Cách hoạt động',
  'web.landing.navLocal': 'Riêng tư',
  'web.landing.navSurfaces': 'Nơi dùng',
  'web.landing.heroTitleEmphasis': 'Được hiểu',

  // ---- web.conference ----
  'web.conference.joining': 'Đang tham gia…',
  // ---- web.conference: in-call control bar ----
  'web.conference.muted': 'Đã tắt tiếng',
  'web.conference.showRoster': 'Xem danh sách',
  // ---- web.conference: trạng thái ngoại lệ (Phase 5) ----
  'web.conference.permissionDeniedHint':
    'Mở cài đặt trình duyệt và cấp quyền camera + micro, sau đó tải lại trang.',
  // ---- web.conference: mở khóa âm thanh (Phase 1) ----
  'web.conference.audioBlocked': 'Âm thanh bị chặn bởi trình duyệt.',
  'web.conference.enableAudio': 'Nhấn để bật âm thanh',
  // ---- web.conference: landing and pre-join room ----
  'web.conference.newMeeting': 'Cuộc họp mới',
  'web.conference.codeOrLink': 'Mã hoặc link cuộc họp',
  'web.conference.codeOrLinkPlaceholder': 'Dán link hoặc nhập mã',
  'web.conference.joinAction': 'Tham gia',
  'web.conference.joiningAs': 'Tham gia với tên {name}',
  'web.conference.landingLead': 'Họp với giọng nói và phụ đề được dịch.',
  'web.conference.readyToJoin': 'Sẵn sàng tham gia?',
  'web.conference.joinNow': 'Tham gia ngay',
  'web.conference.microphone': 'Micrô',
  'web.conference.camera': 'Camera',
  'web.conference.defaultDevice': 'Mặc định của hệ thống',
  'web.conference.noCameraPreview': 'Camera đang tắt',
  'web.conference.micLevel': 'Mức âm micrô',
  'web.conference.translatedVoiceChip': 'Giọng: {gender} · {speed}×',
  'web.conference.translatedVoiceHint':
    'Người khác nghe bản dịch lời bạn bằng giọng này. Đây cũng là cài đặt ở trang Dịch.',
  'web.conference.copyInviteLink': 'Sao chép link mời',
  'web.conference.inviteLinkCopied': 'Đã sao chép link',
  'web.conference.meetingCode': 'Mã cuộc họp',
  'web.conference.roomGoneHint': 'Kiểm tra lại link, hoặc nhờ người mời gửi link mới.',
  'web.meta.conference': 'Hội nghị · Chatofy',

  // ---- mobile.conference: sảnh và màn hình gọi của ứng dụng React Native ----
  'mobile.conference.ongoingTitle': 'Đang trong cuộc họp',
  'mobile.conference.ongoingBody': 'Micro vẫn bật khi Chatofy chạy nền. Camera sẽ tắt.',
  // ---- mobile.conference: lỗi và trạng thái ngoại lệ ----
  'mobile.conference.permissionDeniedHint':
    'Mở Cài đặt và cho phép ứng dụng dùng camera và micro, sau đó thử lại.',
  'mobile.conference.notAuthenticated': 'Bạn cần đăng nhập để tham gia cuộc gọi.',
  // ---- mobile.conference: giao diện dịch (phụ đề, bản ghi, ngôn ngữ) ----
  'mobile.conference.sourceLanguageLocked': 'Ngôn ngữ đã cố định cho cuộc gọi này.',
  'mobile.conference.showTranscript': 'Hiện bản ghi',
  'mobile.conference.hideTranscript': 'Ẩn bản ghi',
  'mobile.conference.transcriptEmpty': 'Chưa có ai nói gì.',
  // ---- mobile.conference: in-meeting chat (translated per recipient) ----
  'mobile.conference.showChat': 'Hiện trò chuyện',
  'mobile.conference.hideChat': 'Ẩn trò chuyện',
  'mobile.conference.minutesGenerating': 'Đang tóm tắt cuộc họp…',
  'mobile.conference.minutesEmpty': 'Chưa có biên bản. Ai đã tham gia cuộc họp đều có thể tạo.',
  'mobile.home.comingSoon': 'sắp ra mắt',
  'mobile.home.joinConference': 'Tham gia cuộc họp',
  'mobile.home.signIn': 'Đăng nhập',
  'mobile.auth.signInTitle': 'Đăng nhập',
  'mobile.auth.missingFields': 'Nhập email và mật khẩu.',
  'mobile.auth.invalidCredentials': 'Email hoặc mật khẩu không đúng.',
  'mobile.auth.tooManyAttempts': 'Thử quá nhiều lần. Đợi một phút rồi thử lại.',
  'mobile.auth.signInFailed': 'Không đăng nhập được. Kiểm tra kết nối rồi thử lại.',
  'mobile.auth.noAccount': 'Chưa có tài khoản? Tạo trên trang web Chatofy rồi đăng nhập ở đây.',
  'mobile.settings.signedInAs': 'Đang đăng nhập: {email}',
  'mobile.settings.signedOut': 'Bạn chưa đăng nhập.',
};
