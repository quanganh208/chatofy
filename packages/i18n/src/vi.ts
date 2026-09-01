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

  'web.chrome.signOut': 'Đăng xuất',
  'web.chrome.backToTranslator': 'Quay lại trình dịch',
  'web.chrome.skipToContent': 'Tới nội dung chính',
  'web.chrome.productNav': 'Sản phẩm',
  'web.chrome.navDashboard': 'Bảng điều khiển',
  'web.chrome.navTranslate': 'Dịch',
  'web.chrome.navGlossary': 'Từ điển thuật ngữ',
  'web.chrome.navPreferences': 'Tuỳ chọn',
  'web.chrome.navAccount': 'Tài khoản',
  'web.chrome.toggleSidebar': 'Đóng mở thanh bên',
  'web.chrome.accountMenu': 'Tài khoản của bạn',
  'web.chrome.signedInAs': 'Đang đăng nhập bằng',
  'web.chrome.getStarted': 'Bắt đầu',
  'web.chrome.openApp': 'Mở Chatofy',

  'web.auth.signIn': 'Đăng nhập',
  'web.auth.signingIn': 'Đang đăng nhập…',
  'web.auth.email': 'Email',
  'web.auth.password': 'Mật khẩu',
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
  'web.auth.signInUnavailable':
    'Hiện chưa đăng nhập được — lỗi nằm ở phía chúng tôi, không phải tài khoản của bạn. Bạn thử lại sau ít phút, hoặc đăng nhập bằng mật khẩu bên dưới.',
  'web.auth.noticeVerified': 'Tài khoản của bạn đã sẵn sàng. Đăng nhập bên dưới để bắt đầu.',
  'web.auth.noticeReset': 'Mật khẩu của bạn đã đổi. Đăng nhập bằng mật khẩu mới.',

  'web.meta.home': 'Chatofy — nói tiếng Việt, được nghe bằng tiếng Anh',
  'web.meta.homeDescription':
    'Dịch giọng nói thời gian thực, cả hai chiều. Giọng nói của bạn được xử lý ngay trên máy bạn; chỉ phần chữ là đi qua mạng.',
  'web.meta.signIn': 'Đăng nhập · Chatofy',
  'web.meta.register': 'Tạo tài khoản · Chatofy',
  'web.meta.verifyEmail': 'Xác minh email · Chatofy',
  'web.meta.forgotPassword': 'Quên mật khẩu · Chatofy',
  'web.meta.resetPassword': 'Đặt lại mật khẩu · Chatofy',
  'web.meta.translate': 'Dịch · Chatofy',
  'web.meta.dashboard': 'Bảng điều khiển · Chatofy',
  'web.meta.preferences': 'Tuỳ chọn · Chatofy',
  'web.meta.account': 'Tài khoản · Chatofy',
  'web.meta.glossary': 'Từ điển thuật ngữ · Chatofy',

  // ---- web.glossary ----
  'web.glossary.title': 'Từ điển thuật ngữ',
  'web.glossary.hint':
    'Các cặp thuật ngữ được áp dụng cho mọi bản dịch trong tài khoản của bạn, để thuật ngữ chuyên ngành luôn nhất quán. Thêm cặp Việt ⇄ Anh, hoặc đánh dấu tên thương hiệu/sản phẩm để giữ nguyên.',
  'web.glossary.viLabel': 'Tiếng Việt',
  'web.glossary.enLabel': 'Tiếng Anh',
  'web.glossary.viPlaceholder': 'nhồi máu cơ tim',
  'web.glossary.enPlaceholder': 'myocardial infarction',
  'web.glossary.keepVerbatim': 'Giữ nguyên',
  'web.glossary.keepVerbatimHint': 'Không dịch — giữ nguyên tên này ở cả hai chiều.',
  'web.glossary.verbatimBadge': 'giữ nguyên',
  'web.glossary.add': 'Thêm thuật ngữ',
  'web.glossary.adding': 'Đang thêm…',
  'web.glossary.save': 'Lưu',
  'web.glossary.cancel': 'Huỷ',
  'web.glossary.edit': 'Sửa',
  'web.glossary.delete': 'Xoá',
  'web.glossary.empty': 'Chưa có thuật ngữ nào — thêm mục đầu tiên ở trên.',
  'web.glossary.loadError': 'Không tải được từ điển. Thử lại.',
  'web.glossary.saveError': 'Không lưu được thay đổi. Thử lại.',
  'web.glossary.duplicateError': 'Cặp thuật ngữ này đã có trong từ điển.',
  'web.glossary.import': 'Nhập CSV',
  'web.glossary.importHint':
    'Tệp CSV với các cột Tiếng Việt, Tiếng Anh, giữ-nguyên (true/false) — gộp vào từ điển của bạn.',
  'web.glossary.importEmpty': 'Tệp không có dòng thuật ngữ nào.',
  'web.glossary.importError': 'Không nhập được tệp. Kiểm tra các cột rồi thử lại.',

  'web.translate.startTranslating': 'Bắt đầu dịch',
  'web.translate.startConversation': 'Bắt đầu hội thoại',
  'web.translate.end': 'Kết thúc',
  'web.translate.notListening': 'Chưa nghe',
  'web.translate.connecting': 'Đang kết nối…',
  'web.translate.listening': 'Đang nghe — bạn cứ nói',
  'web.translate.hearingYou': 'Đang nghe bạn nói…',
  'web.translate.translating': 'Đang dịch…',
  'web.translate.speaking': 'Đang đọc',
  'web.translate.openingSession': 'Đang mở phiên…',
  'web.translate.transcriptEmpty':
    'Chưa có gì — bắt đầu một cuộc hội thoại và cả hai bên sẽ hiện ở đây.',
  'web.translate.speakTranslation': 'Đọc bản dịch',
  'web.translate.speakTranslationAria': 'Đọc bản dịch thành tiếng',
  'web.translate.voice': 'Giọng đọc',
  'web.translate.voiceFemale': 'Nữ',
  'web.translate.voiceMale': 'Nam',
  'web.translate.speed': 'Tốc độ',
  'web.translate.volume': 'Âm lượng',
  'web.translate.volumeAria': 'Âm lượng phát',
  'web.translate.transcript': 'Bản ghi',
  'web.translate.transcriptStacked': 'Xếp chồng',
  'web.translate.transcriptColumns': 'Hai cột',
  'web.translate.settings': 'Cài đặt cuộc hội thoại',
  'web.translate.speakNaturally':
    'Bạn cứ nói tự nhiên rồi ngừng. Bản dịch sẽ tự phát — không phải bấm nút nào.',
  'web.translate.direction': 'Hướng dịch',
  'web.translate.directionSource': 'Nguồn',
  'web.translate.directionTarget': 'Bản dịch',
  'web.translate.directionSwap': 'Đảo chiều — dịch {from} sang {to}',
  'web.translate.voiceDefault': 'Mặc định',
  'web.translate.voiceListFailed':
    'Chưa tải được danh sách giọng đọc. Lựa chọn giới tính giọng ở trên vẫn áp dụng.',
  'web.translate.speedHint':
    'Giọng tiếng Việt không chỉnh được tốc độ, nên mục này chỉ áp dụng khi dịch sang tiếng Anh.',
  'web.translate.transcriptHint':
    'Kiểu hai cột đặt câu gốc cạnh bản dịch, và tự xếp chồng lại trên màn hình hẹp.',
  'web.translate.transcriptListening': 'Đang nghe. Cuộc hội thoại sẽ hiện ở đây khi được dịch.',
  'web.translate.transcriptAttribution': 'Mỗi lượt nói có thể được đánh dấu là ai đã nói.',
  // Chỉ hiện ở lượt đã được chỉnh lại. "Bản máy nghe" nói rõ đó là đầu ra thô
  // của bộ nhận dạng, không phải một cách diễn đạt khác của cùng một câu.
  'web.translate.sourceRawToggle': 'Bản máy nghe',
  'web.translate.sourceRawLabel': 'Máy nhận dạng:',
  'web.translate.speakerUnknown': 'Ai đã nói?',
  'web.translate.speakerAsk': 'Cho biết ai đã nói',
  'web.translate.speakerChange': '{name} đã nói. Đổi.',
  'web.translate.speakerNobody': 'Không ai',
  'web.translate.speakerAdd': 'Thêm người',
  'web.translate.speakerDefault': 'Người nói {number}',
  'web.translate.speakerRosterHint': 'Thêm những người đang nói để đánh dấu ai đã nói ở mỗi lượt.',
  'web.translate.speakerNameFor': 'Tên của {name}',
  'web.translate.speakerRemove': 'Xóa {name}',
  'web.translate.speakerRemoveBlocked': '{name} đang được gắn cho một lượt nói. Đổi lượt đó trước.',
  'web.translate.speakerRemoveBlockedAria': 'Không xóa được {name}: đang được gắn cho một lượt nói',
  'web.translate.speakerLimit': 'Tối đa {max} người',
  'web.translate.attributionStats':
    '{total} lượt · {confirmed} đã đánh dấu · {fallback} chưa đánh dấu',
  'web.translate.attributionSuggestions':
    'gợi ý: {agreed} khớp, {changed} đã sửa, {unreviewed} chưa xem',
  'web.translate.micLevel': 'Mức tín hiệu micro',
  'web.translate.micNotFound':
    'Không tìm thấy micro. Bạn cắm micro vào rồi bắt đầu hội thoại lại nhé.',
  'web.translate.micDenied':
    'Trình duyệt đang chặn micro. Bạn cho phép ở thanh địa chỉ rồi bắt đầu hội thoại lại nhé.',
  'web.translate.micBusy':
    'Một ứng dụng khác đang giữ micro. Bạn đóng ứng dụng đó rồi bắt đầu hội thoại lại nhé.',
  'web.translate.micFailed': 'Chưa khởi động được micro.',
  'web.translate.recorded': 'Đã ghi xong — sẵn sàng dịch',
  'web.translate.noAudioYet': 'Chưa có âm thanh — ghi âm hoặc tải lên một tệp',
  'web.translate.result': 'Kết quả',
  'web.translate.liveFollowing': 'Trực tiếp — bạn cứ nói, bản dịch chạy theo',
  'web.translate.stopped': 'Đã dừng',
  'web.translate.languageMismatch':
    'Nghe như đây là {heard}, nhưng hướng dịch ở trên đang chờ {expected}. Bạn đổi hướng lại, hoặc cứ tiếp tục — dù sao bản dịch cũng có thể sai.',
  'web.translate.liveTranslation': 'Bản dịch trực tiếp',
  'web.translate.baselineHeading': 'Dịch một bản ghi',
  'web.translate.baselineViToEn': 'Ghi âm tiếng Việt và nghe bản dịch tiếng Anh.',
  'web.translate.baselineEnToVi': 'Ghi âm tiếng Anh và nghe bản dịch tiếng Việt.',

  // ---- web.translate.minutes ----
  'web.translate.minutesTitle': 'Biên bản cuộc họp',
  'web.translate.minutesGenerate': 'Tạo biên bản',
  'web.translate.minutesRegenerate': 'Tạo lại',
  'web.translate.minutesGenerating': 'Đang tóm tắt cuộc trò chuyện…',
  'web.translate.minutesEmpty': 'Chưa có biên bản — tạo sau khi cuộc trò chuyện kết thúc.',
  'web.translate.minutesNeedsTurns': 'Hãy trò chuyện trước đã — chưa có gì để tóm tắt.',
  'web.translate.minutesFailed': 'Không tạo được biên bản. Thử lại nhé.',
  'web.translate.minutesSummary': 'Tóm tắt',
  'web.translate.minutesKeyPoints': 'Ý chính',
  'web.translate.minutesDecisions': 'Quyết định',
  'web.translate.minutesActionItems': 'Việc cần làm',
  'web.translate.minutesNoActionItems': 'Không có việc cần làm.',
  'web.translate.minutesOwner': 'Phụ trách',
  'web.translate.minutesDue': 'Hạn',
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

  'web.dashboard.start': 'Bắt đầu',
  'web.dashboard.startConversation': 'Bắt đầu một cuộc hội thoại',
  'web.dashboard.startHint': 'Giọng đọc, tốc độ và âm lượng chỉnh ngay trong lúc dịch.',
  'web.dashboard.readiness': 'Sẵn sàng',
  'web.dashboard.microphone': 'Micro',
  'web.dashboard.micGranted': 'Đã cấp quyền',
  'web.dashboard.micDenied': 'Đã từ chối',
  'web.dashboard.micPrompt': 'Chưa hỏi',
  'web.dashboard.micUnknown': 'Không biết được',
  'web.dashboard.micAbsent': 'Không có micro',
  'web.dashboard.service': 'Máy chủ dịch',
  'web.dashboard.serviceChecking': 'Đang kiểm tra…',
  'web.dashboard.serviceReachable': 'Kết nối được',
  'web.dashboard.serviceUnreachable': 'Không kết nối được',
  'web.dashboard.headphones': 'Tai nghe',
  'web.dashboard.headphonesRecommended': 'Nên dùng',
  'web.dashboard.alsoRunsOn': 'Còn chạy ở đâu',
  'web.dashboard.extension': 'Tiện ích trình duyệt',
  'web.dashboard.extensionWhat':
    'Dịch một cuộc họp ngay trong trình duyệt — Google Meet, Zoom, hay một cuộc gọi Facebook.',
  'web.dashboard.mobile': 'Ứng dụng di động',
  'web.dashboard.mobileWhat': 'Vẫn trình dịch đó, trên điện thoại.',
  'web.dashboard.unreleased': 'Chưa phát hành',

  'web.preferences.conversation': 'Hội thoại',
  'web.preferences.conversationHint':
    'Những mục này áp dụng cho mọi cuộc hội thoại. Ở đây bạn sửa được hướng dịch và giọng đọc vì chưa có cuộc nào đang chạy — trong lúc đang dịch thì hai mục đó cố định cho tới khi kết thúc.',
  'web.preferences.interface': 'Giao diện',

  'web.account.identity': 'Danh tính',
  'web.account.memberSince': 'Tham gia từ',
  'web.account.nameUnset': 'Chưa đặt',
  'web.account.loading': 'Đang tải thông tin của bạn…',
  'web.account.loadFailed':
    'Chưa tải được thông tin tài khoản. Phiên đăng nhập của bạn vẫn còn hiệu lực.',
  'web.account.avatar': 'Ảnh đại diện',
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

  'web.landing.heroTitle': 'Nói tiếng Việt. Được nghe bằng tiếng Anh.',
  'web.landing.heroBody':
    'Dịch giọng nói thời gian thực, cả hai chiều. Giọng nói của bạn được xử lý ngay trên máy bạn — chỉ phần chữ là đi qua mạng.',
  'web.landing.heroSeeHow': 'Xem cách hoạt động',
  'web.landing.demoListening': 'Đang nghe',
  'web.landing.demoSourceOne': 'Chào anh, mình muốn hỏi về lịch họp chiều nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure — it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'Được thôi — cuộc họp đã dời sang bốn giờ.',
  'web.landing.howTitle': 'Cách hoạt động',
  'web.landing.howBody': 'Ba điều đáng biết trước khi bạn cấp quyền micro.',
  'web.landing.howOneTitle': 'Bấm bắt đầu, rồi cứ nói',
  'web.landing.howOneBody': 'Không cần giữ nút, không phải chờ tín hiệu nào.',
  'web.landing.howTwoTitle': 'Không có nút dừng',
  'web.landing.howTwoBody':
    'Lượt nói kết thúc khi bạn ngừng nói. Khoảng một giây sau là bản dịch phát.',
  'web.landing.howThreeTitle': 'Nghe bản dịch, không phải đọc',
  'web.landing.howThreeBody':
    'Bản dịch được đọc thành tiếng. Phần chữ vẫn ở lại trên màn hình để bạn đối chiếu.',
  'web.landing.localTitle': 'Giọng nói của bạn ở lại trên máy bạn',
  'web.landing.localBody':
    'Những gì bạn nói được xử lý ngay trên máy tính của bạn — không cần xin khoá nào, không tải gì lên. Chỉ phần chữ là đi qua mạng, để được dịch.',
  'web.landing.hopOnDevice': 'Trên máy',
  'web.landing.hopOverNetwork': 'Qua mạng',
  'web.landing.hopHears': 'Nghe những gì bạn vừa nói',
  'web.landing.hopTranslates': 'Dịch nghĩa',
  'web.landing.hopSpeaks': 'Đọc bản dịch thành tiếng',
  'web.landing.surfacesTitle': 'Chatofy chạy ở đâu',
  'web.landing.surfaceBrowserTitle': 'Trên trình duyệt',
  'web.landing.surfaceBrowserBody': 'Mở là nói được. Không phải cài gì.',
  'web.landing.surfaceExtensionTitle': 'Tiện ích cho cuộc họp',
  'web.landing.surfaceExtensionBody': 'Dịch hai chiều ngay trong tab Meet hoặc Zoom.',
  'web.landing.surfacePhoneTitle': 'Trên điện thoại',
  'web.landing.surfacePhoneBody': 'Cho lúc nói chuyện trực tiếp.',
  'web.landing.ctaTitle': 'Thử một cuộc hội thoại',
  'web.landing.ctaBody': 'Cần một micro và một tài khoản. Không cần thẻ.',
  'web.landing.navMenu': 'Danh mục',
};
