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
 * `docs/design-guidelines.md` Â§ Copy register governs **each locale independently**.
 * These strings are reviewed against the rule â€” name the wait, the outcome, or the
 * next step â€” not against how literally they render the English. English is the
 * reference for MEANING, not for structure: a natural Vietnamese rendering of a wait
 * description is exactly where the pipeline vocabulary the rule deleted creeps back
 * in, because "nháº­n dáº¡ng rá»“i dá»‹ch rá»“i Ä‘á»c" reads perfectly well and says the wrong
 * kind of thing.
 *
 * The reviewer test generalises: someone who cannot restate the consequence FROM THE
 * VIETNAMESE ALONE has found a bad translation, not a stylistic quibble.
 *
 * ## Address
 *
 * The reader is **"báº¡n"**, everywhere. Not "quÃ½ khÃ¡ch", which is the register of a
 * bank and wrong for a tool used daily, and not pronoun-avoidance, which is harder to
 * keep consistent than it looks and drifts into passive constructions.
 *
 * ## Length
 *
 * Vietnamese runs longer than English â€” often 20â€“30% â€” and the places that bite are
 * buttons and the uppercase label rows. `Be_Vietnam_Pro` already loads the
 * `vietnamese` subset, so diacritics need no font work; what needs checking is that
 * nothing overflows at 320px in this locale, which is a criterion of its own.
 *
 * The two demo lines on the landing page are NOT translated in the usual sense. They
 * are a conversation between a Vietnamese speaker and an English one, so each side
 * keeps its own language in both locales â€” translating the English half into
 * Vietnamese would show a Vietnamese person being answered in Vietnamese, which is
 * not what the product does.
 */
export const vi: Messages = {
  'common.theme.light': 'SÃ¡ng',
  'common.theme.dark': 'Tá»‘i',
  'common.theme.system': 'Theo há»‡ thá»‘ng',
  'common.theme.label': 'Giao diá»‡n mÃ u',

  'common.language.vietnamese': 'Tiáº¿ng Viá»‡t',
  'common.language.english': 'English',
  'common.language.label': 'NgÃ´n ngá»¯',

  // ---- common.languageName ----
  'common.languageName.vi': 'Tiáº¿ng Viá»‡t',
  'common.languageName.en': 'Tiáº¿ng Anh',
  'common.languageName.zh': 'Tiáº¿ng Trung',

  // ---- common.auth ----
  'common.auth.signOut': 'ÄÄƒng xuáº¥t',
  'common.auth.signIn': 'ÄÄƒng nháº­p',
  'common.auth.signingIn': 'Äang Ä‘Äƒng nháº­pâ€¦',
  'common.auth.email': 'Email',
  'common.auth.password': 'Máº­t kháº©u',

  // ---- common.conference ----
  'common.conference.lobbyTitle': 'Há»™i nghá»‹ video',
  'common.conference.create': 'Táº¡o phÃ²ng',
  'common.conference.join': 'Tham gia phÃ²ng',
  'common.conference.yourName': 'TÃªn cá»§a báº¡n',
  'common.conference.yourNamePlaceholder': 'NgÆ°á»i khÃ¡c sáº½ tháº¥y tÃªn nÃ y',
  'common.conference.roomId': 'MÃ£ phÃ²ng',
  'common.conference.roomIdPlaceholder': 'Nháº­p mÃ£ phÃ²ng Ä‘á»ƒ tham gia',
  'common.conference.sourceLanguage': 'NgÃ´n ngá»¯ cá»§a báº¡n',
  'common.conference.start': 'Báº¯t Ä‘áº§u',
  'common.conference.leave': 'Rá»i phÃ²ng',
  'common.conference.waiting': 'Äang chá» ngÆ°á»i khÃ¡c tham giaâ€¦',
  'common.conference.connecting': 'Äang káº¿t ná»‘iâ€¦',
  'common.conference.you': 'Báº¡n',
  // The translated voice: what others hear this speaker's translation in.
  'common.conference.translatedVoice': 'Giá»ng dá»‹ch',
  'common.conference.translatedVoiceHint': 'NgÆ°á»i khÃ¡c nghe báº£n dá»‹ch lá»i báº¡n báº±ng giá»ng nÃ y.',
  'common.conference.voiceFemale': 'Ná»¯',
  'common.conference.voiceMale': 'Nam',
  'common.conference.muteMic': 'Táº¯t micro',
  'common.conference.unmuteMic': 'Báº­t micro',
  'common.conference.disableCamera': 'Táº¯t camera',
  'common.conference.enableCamera': 'Báº­t camera',
  'common.conference.participants': 'NgÆ°á»i tham gia',
  'common.conference.cameraOff': 'Camera táº¯t',
  'common.conference.rosterTitle': 'Trong cuá»™c gá»i nÃ y',
  'common.conference.hideRoster': 'áº¨n danh sÃ¡ch',
  'common.conference.chatTitle': 'TrÃ² chuyá»‡n',
  'common.conference.chatPlaceholder': 'Nháº­p tin nháº¯nâ€¦',
  'common.conference.chatSend': 'Gá»­i',
  'common.conference.chatEmpty': 'ChÆ°a cÃ³ tin nháº¯n nÃ o.',
  'common.conference.permissionDenied': 'Cáº§n quyá»n truy cáº­p camera vÃ  micro.',
  'common.conference.permissionDeniedAudioOnly': 'KhÃ´ng cÃ³ camera â€” tham gia chá»‰ vá»›i Ã¢m thanh.',
  'common.conference.disconnected': 'Máº¥t káº¿t ná»‘i.',
  'common.conference.disconnectedHint': 'Cuá»™c gá»i Ä‘Ã£ káº¿t thÃºc. Quay láº¡i sáº£nh Ä‘á»ƒ tham gia láº¡i.',
  'common.conference.backToLobby': 'Vá» sáº£nh',
  'common.conference.errorGeneric': 'ÄÃ£ xáº£y ra lá»—i.',
  'common.conference.translationEnded':
    'ÄÃ£ dá»«ng dá»‹ch â€” má»i ngÆ°á»i giá» nghe báº¡n mÃ  khÃ´ng cÃ³ báº£n dá»‹ch. Tham gia láº¡i cuá»™c gá»i Ä‘á»ƒ báº­t láº¡i.',
  'common.conference.translating': 'Äang dá»‹châ€¦',
  'common.conference.reconnecting': 'Äang káº¿t ná»‘i láº¡i ({attempt}/{cap})â€¦',
  'common.conference.creating': 'Äang táº¡oâ€¦',
  'common.conference.createFailed': 'KhÃ´ng táº¡o Ä‘Æ°á»£c phÃ²ng. HÃ£y thá»­ láº¡i.',
  'common.conference.roomNotFound': 'PhÃ²ng nÃ y khÃ´ng tá»“n táº¡i.',
  'common.conference.roomEnded': 'Cuá»™c há»p nÃ y Ä‘Ã£ káº¿t thÃºc.',
  'common.conference.endedTitle': 'Cuá»™c há»p Ä‘Ã£ káº¿t thÃºc',
  'common.conference.endedLoading': 'Äang táº£i cuá»™c há»pâ€¦',
  'common.conference.endedNotFound':
    'Báº¡n khÃ´ng tham gia cuá»™c há»p nÃ y, hoáº·c cuá»™c há»p khÃ´ng tá»“n táº¡i.',
  'common.conference.endedLoadFailed': 'KhÃ´ng táº£i Ä‘Æ°á»£c cuá»™c há»p nÃ y. HÃ£y thá»­ láº¡i sau.',
  'common.conference.summaryDuration': 'Thá»i lÆ°á»£ng',
  'common.conference.summaryLanguages': 'NgÃ´n ngá»¯',
  'common.conference.durationMinutes': '{minutes} phÃºt',
  'common.conference.durationHours': '{hours} giá» {minutes} phÃºt',
  'common.conference.durationUnknown': 'KhÃ´ng ghi nháº­n',
  'common.conference.guest': 'KhÃ¡ch',
  'common.conference.chatRateLimited': 'Gá»­i cháº­m láº¡i â€” hÃ£y Ä‘á»£i vÃ i giÃ¢y rá»“i gá»­i tiáº¿p.',
  'common.conference.chatNotSent': 'ChÆ°a gá»­i Ä‘Æ°á»£c tin nháº¯n.',

  // ---- common.minutes ----
  'common.minutes.title': 'BiÃªn báº£n cuá»™c há»p',
  'common.minutes.generate': 'Táº¡o biÃªn báº£n',
  'common.minutes.regenerate': 'Táº¡o láº¡i',
  'common.minutes.failed': 'KhÃ´ng táº¡o Ä‘Æ°á»£c biÃªn báº£n. Thá»­ láº¡i nhÃ©.',
  'common.minutes.summary': 'TÃ³m táº¯t',
  'common.minutes.keyPoints': 'Ã chÃ­nh',
  'common.minutes.decisions': 'Quyáº¿t Ä‘á»‹nh',
  'common.minutes.actionItems': 'Viá»‡c cáº§n lÃ m',
  'common.minutes.noActionItems': 'KhÃ´ng cÃ³ viá»‡c cáº§n lÃ m.',
  'common.minutes.owner': 'Phá»¥ trÃ¡ch',
  'common.minutes.due': 'Háº¡n',
  'common.minutes.nothingSaid': 'Cuá»™c há»p nÃ y khÃ´ng cÃ³ ai nÃ³i gÃ¬ nÃªn khÃ´ng cÃ³ gÃ¬ Ä‘á»ƒ tÃ³m táº¯t.',

  'common.transcript': 'Báº£n ghi',

  'web.chrome.skipToContent': 'Tá»›i ná»™i dung chÃ­nh',
  'web.chrome.productNav': 'Sáº£n pháº©m',
  'web.chrome.navTranslate': 'Dá»‹ch',
  'web.chrome.navConference': 'Há»™i tháº£o',
  'web.chrome.navHistory': 'Lá»‹ch sá»­',
  'web.chrome.navPreferences': 'Tuá»³ chá»n',
  'web.chrome.navAccount': 'TÃ i khoáº£n',
  'web.chrome.toggleSidebar': 'ÄÃ³ng má»Ÿ thanh bÃªn',
  'web.chrome.accountMenu': 'TÃ i khoáº£n cá»§a báº¡n',
  'web.chrome.signedInAs': 'Äang Ä‘Äƒng nháº­p báº±ng',
  'web.chrome.getStarted': 'Báº¯t Ä‘áº§u',
  'web.chrome.openApp': 'Má»Ÿ Chatofy',

  'web.auth.name': 'TÃªn',
  'web.auth.newPassword': 'Máº­t kháº©u má»›i',
  'web.auth.createAccount': 'Táº¡o tÃ i khoáº£n',
  'web.auth.createAccountHeading': 'Táº¡o tÃ i khoáº£n',
  'web.auth.creatingAccount': 'Äang táº¡o tÃ i khoáº£nâ€¦',
  'web.auth.haveAccountPrompt': 'Báº¡n Ä‘Ã£ cÃ³ tÃ i khoáº£n?',
  'web.auth.forgotPasswordShort': 'QuÃªn máº­t kháº©u?',
  'web.auth.forgotPasswordLink': 'QuÃªn máº­t kháº©u?',
  'web.auth.forgotPasswordBody':
    'Nháº­p email cá»§a tÃ i khoáº£n, chÃºng tÃ´i sáº½ gá»­i cho báº¡n má»™t liÃªn káº¿t Ä‘á»ƒ Ä‘áº·t láº¡i máº­t kháº©u.',
  'web.auth.backToSignIn': 'Quay láº¡i Ä‘Äƒng nháº­p',
  'web.auth.resetPasswordHeading': 'Äáº·t láº¡i máº­t kháº©u',
  'web.auth.resetPasswordSubmit': 'Äáº·t láº¡i máº­t kháº©u',
  'web.auth.resetting': 'Äang Ä‘áº·t láº¡iâ€¦',
  'web.auth.chooseNewPassword': 'Chá»n máº­t kháº©u má»›i cho tÃ i khoáº£n cá»§a báº¡n.',
  'web.auth.verifyEmailHeading': 'XÃ¡c minh email',
  'web.auth.verifyEmailBody': 'XÃ¡c nháº­n bÃªn dÆ°á»›i Ä‘á»ƒ hoÃ n táº¥t viá»‡c táº¡o tÃ i khoáº£n.',
  'web.auth.checkYourEmail':
    'Kiá»ƒm tra email cá»§a báº¡n, trong Ä‘Ã³ cÃ³ liÃªn káº¿t Ä‘á»ƒ hoÃ n táº¥t viá»‡c táº¡o tÃ i khoáº£n.',
  'web.auth.resetLinkSent':
    'Náº¿u email Ä‘Ã³ cÃ³ tÃ i khoáº£n, liÃªn káº¿t Ä‘áº·t láº¡i máº­t kháº©u Ä‘ang trÃªn Ä‘Æ°á»ng tá»›i.',
  'web.auth.passwordTooShort': 'Máº­t kháº©u quÃ¡ ngáº¯n',
  'web.auth.createFailed': 'ChÆ°a táº¡o Ä‘Æ°á»£c tÃ i khoáº£n. Báº¡n thá»­ láº¡i nhÃ©.',
  'web.auth.resetFailed': 'ChÆ°a Ä‘áº·t láº¡i Ä‘Æ°á»£c máº­t kháº©u. Báº¡n thá»­ láº¡i nhÃ©.',
  'web.auth.sendResetFailed': 'ChÆ°a gá»­i Ä‘Æ°á»£c liÃªn káº¿t Ä‘áº·t láº¡i. Báº¡n thá»­ láº¡i nhÃ©.',
  'web.auth.verifyFailed': 'ChÆ°a xÃ¡c minh Ä‘Æ°á»£c liÃªn káº¿t nÃ y. Báº¡n thá»­ láº¡i nhÃ©.',
  'web.auth.serverUnreachable': 'KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c tá»›i mÃ¡y chá»§.',
  'web.auth.tookTooLong': 'LÃ¢u quÃ¡ â€” báº¡n thá»­ láº¡i nhÃ©.',
  'web.auth.unexpectedResponse': 'MÃ¡y chá»§ tráº£ vá» ná»™i dung khÃ´ng nhÆ° mong Ä‘á»£i.',
  'web.auth.accountRequired':
    'Muá»‘n dá»‹ch thÃ¬ cáº§n má»™t tÃ i khoáº£n â€” má»i cuá»™c há»™i thoáº¡i vÃ  báº£n ghi Ä‘á»u thuá»™c vá» má»™t tÃ i khoáº£n.',
  'web.auth.orContinueWithEmail': 'hoáº·c tiáº¿p tá»¥c báº±ng email',
  'web.auth.continueWithGoogle': 'Tiáº¿p tá»¥c vá»›i Google',
  'web.auth.credentialsRejected': 'Email vÃ  máº­t kháº©u nÃ y khÃ´ng khá»›p vá»›i tÃ i khoáº£n nÃ o.',
  'web.auth.sendResetLink': 'Gá»­i liÃªn káº¿t Ä‘áº·t láº¡i',
  'web.auth.sending': 'Äang gá»­iâ€¦',
  'web.auth.verifyEmailSubmit': 'XÃ¡c minh email',
  'web.auth.verifying': 'Äang xÃ¡c minhâ€¦',
  'web.auth.resetLinkMissingCode': 'LiÃªn káº¿t nÃ y thiáº¿u mÃ£ Ä‘áº·t láº¡i máº­t kháº©u.',
  'web.auth.verifyLinkMissingCode': 'LiÃªn káº¿t nÃ y thiáº¿u mÃ£ xÃ¡c minh.',
  'web.auth.accountExists': 'TÃ i khoáº£n Ä‘Ã³ Ä‘Ã£ tá»“n táº¡i.',
  'web.auth.googleRefused':
    'KhÃ´ng dÃ¹ng Ä‘Æ°á»£c tÃ i khoáº£n Google Ä‘Ã³ Ä‘á»ƒ Ä‘Äƒng nháº­p. Náº¿u email nÃ y Ä‘Ã£ cÃ³ máº­t kháº©u, báº¡n Ä‘Äƒng nháº­p báº±ng máº­t kháº©u bÃªn dÆ°á»›i.',
  'web.auth.signInServerFault':
    'Hiá»‡n chÆ°a Ä‘Äƒng nháº­p Ä‘Æ°á»£c â€” lá»—i náº±m á»Ÿ phÃ­a chÃºng tÃ´i, khÃ´ng pháº£i email hay máº­t kháº©u cá»§a báº¡n. Báº¡n thá»­ láº¡i sau giÃ¢y lÃ¡t.',
  'web.auth.signInUnavailable':
    'Hiá»‡n chÆ°a Ä‘Äƒng nháº­p Ä‘Æ°á»£c â€” lá»—i náº±m á»Ÿ phÃ­a chÃºng tÃ´i, khÃ´ng pháº£i tÃ i khoáº£n cá»§a báº¡n. Báº¡n thá»­ láº¡i sau Ã­t phÃºt, hoáº·c Ä‘Äƒng nháº­p báº±ng máº­t kháº©u bÃªn dÆ°á»›i.',
  'web.auth.noticeVerified': 'TÃ i khoáº£n cá»§a báº¡n Ä‘Ã£ sáºµn sÃ ng. ÄÄƒng nháº­p bÃªn dÆ°á»›i Ä‘á»ƒ báº¯t Ä‘áº§u.',
  'web.auth.noticeReset': 'Máº­t kháº©u cá»§a báº¡n Ä‘Ã£ Ä‘á»•i. ÄÄƒng nháº­p báº±ng máº­t kháº©u má»›i.',

  'web.meta.home': 'Chatofy â€” dá»‹ch giá»ng nÃ³i thá»i gian thá»±c cho trÃ² chuyá»‡n vÃ  há»p trá»±c tuyáº¿n',
  'web.meta.homeDescription':
    'Chatofy dá»‹ch giá»ng nÃ³i theo thá»i gian thá»±c giá»¯a tiáº¿ng Viá»‡t, tiáº¿ng Anh vÃ  tiáº¿ng Trung, khi trÃ² chuyá»‡n trá»±c tiáº¿p, trong cuá»™c há»p video vÃ  trÃªn Google Meet, Zoom, Facebook.',
  'web.meta.signIn': 'ÄÄƒng nháº­p Â· Chatofy',
  'web.meta.register': 'Táº¡o tÃ i khoáº£n Â· Chatofy',
  'web.meta.verifyEmail': 'XÃ¡c minh email Â· Chatofy',
  'web.meta.forgotPassword': 'QuÃªn máº­t kháº©u Â· Chatofy',
  'web.meta.resetPassword': 'Äáº·t láº¡i máº­t kháº©u Â· Chatofy',
  'web.meta.translate': 'Dá»‹ch Â· Chatofy',
  'web.meta.history': 'Lá»‹ch sá»­ Â· Chatofy',
  'web.meta.preferences': 'Tuá»³ chá»n Â· Chatofy',
  'web.meta.account': 'TÃ i khoáº£n Â· Chatofy',

  'web.translate.startTranslating': 'Báº¯t Ä‘áº§u dá»‹ch',
  'web.translate.startConversation': 'Báº¯t Ä‘áº§u há»™i thoáº¡i',
  'web.translate.end': 'Káº¿t thÃºc',
  'web.translate.pause': 'Táº¡m dá»«ng',
  'web.translate.resume': 'Tiáº¿p tá»¥c',
  'web.translate.notListening': 'ChÆ°a nghe',
  'web.translate.connecting': 'Äang káº¿t ná»‘iâ€¦',
  'web.translate.listening': 'Äang nghe â€” báº¡n cá»© nÃ³i',
  'web.translate.hearingYou': 'Äang nghe báº¡n nÃ³iâ€¦',
  'web.translate.translating': 'Äang dá»‹châ€¦',
  'web.translate.speaking': 'Äang Ä‘á»c',
  'web.translate.paused': 'ÄÃ£ táº¡m dá»«ng',
  'web.translate.finishing': 'Äang káº¿t thÃºc â€” Ä‘á»c ná»‘t báº£n dá»‹ch cuá»‘i',
  'web.translate.elapsedLabel': 'Thá»i gian tá»« khi báº¯t Ä‘áº§u há»™i thoáº¡i',
  'web.translate.transcriptEmpty':
    'ChÆ°a cÃ³ gÃ¬ â€” báº¯t Ä‘áº§u má»™t cuá»™c há»™i thoáº¡i vÃ  cáº£ hai bÃªn sáº½ hiá»‡n á»Ÿ Ä‘Ã¢y.',
  'web.translate.panelSourceEmpty': 'CÃ¢u báº¡n nÃ³i sáº½ hiá»‡n á»Ÿ Ä‘Ã¢y.',
  'web.translate.panelTargetEmpty': 'Báº£n dá»‹ch hiá»‡n á»Ÿ Ä‘Ã¢y.',
  'web.translate.speakTranslation': 'Äá»c báº£n dá»‹ch',
  'web.translate.speakTranslationAria': 'Äá»c báº£n dá»‹ch thÃ nh tiáº¿ng',
  'web.translate.speakOn': 'báº­t',
  'web.translate.speakOff': 'táº¯t',
  'web.translate.speakLocked': 'Chá»n trÆ°á»›c khi báº¯t Ä‘áº§u há»™i thoáº¡i',
  'web.translate.voice': 'Giá»ng Ä‘á»c',
  'web.translate.voiceFemale': 'Ná»¯',
  'web.translate.voiceMale': 'Nam',
  'web.translate.voiceAll': 'Táº¥t cáº£',
  'web.translate.voiceGender': 'Giá»›i tÃ­nh giá»ng Ä‘á»c',
  'web.translate.speed': 'Tá»‘c Ä‘á»™',
  'web.translate.volume': 'Ã‚m lÆ°á»£ng',
  'web.translate.volumeAria': 'Ã‚m lÆ°á»£ng phÃ¡t',
  'web.translate.paneSource': 'Báº£n ghi tiáº¿ng nguá»“n',
  'web.translate.paneTarget': 'Báº£n ghi báº£n dá»‹ch',
  'web.translate.speakerLabels': 'NhÃ£n ngÆ°á»i nÃ³i',
  'web.translate.translationOnly': 'Chá»‰ hiá»‡n báº£n dá»‹ch',
  'web.translate.freeScroll': 'Cuá»™n tá»± do',
  'web.translate.displayMode': 'Cháº¿ Ä‘á»™ hiá»ƒn thá»‹',
  'web.translate.displayModeSplit': 'Chia Ä‘Ã´i',
  'web.translate.displayModeList': 'Danh sÃ¡ch',
  'web.translate.textSize': 'Cá»¡ chá»¯',
  'web.translate.paneLayout': 'Bá»‘ cá»¥c',
  'web.translate.paneLayoutRow': 'Ngang',
  'web.translate.paneLayoutColumn': 'Dá»c',
  'web.translate.voiceSettings': 'CÃ i Ä‘áº·t giá»ng Ä‘á»c',
  'web.translate.displaySettings': 'CÃ i Ä‘áº·t hiá»ƒn thá»‹',
  'web.translate.context': 'Ngá»¯ cáº£nh AI',
  'web.translate.contextNone': 'KhÃ´ng dÃ¹ng',
  'web.translate.contextLocked': 'Ngá»¯ cáº£nh giá»¯ nguyÃªn cho tá»›i khi cuá»™c trÃ² chuyá»‡n nÃ y káº¿t thÃºc.',
  'web.translate.contextLoading': 'Äang táº£i Ngá»¯ cáº£nh AIâ€¦',
  'web.translate.contextUnavailable':
    'KhÃ´ng táº£i Ä‘Æ°á»£c Ngá»¯ cáº£nh AI. Báº¯t Ä‘áº§u ngay bÃ¢y giá» sáº½ khÃ´ng dÃ¹ng ngá»¯ cáº£nh nÃ y.',
  'web.translate.registerNeutral': 'Trung tÃ­nh',
  'web.translate.registerFormal': 'Trang trá»ng',
  'web.translate.registerCasual': 'ThÃ¢n máº­t',
  'web.translate.languagePair': 'NgÃ´n ngá»¯',
  'web.translate.languagePairSource': 'Nguá»“n',
  'web.translate.languagePairTarget': 'Báº£n dá»‹ch',
  'web.translate.languagePairSwap': 'Äáº£o ngÃ´n ngá»¯ â€” dá»‹ch {from} sang {to}',
  'web.translate.languagePairSwapDetect': 'Äáº£o ngÃ´n ngá»¯ â€” khÃ´ng dÃ¹ng Ä‘Æ°á»£c khi Tá»± nháº­n diá»‡n',
  'web.translate.autoDetect': 'Tá»± nháº­n diá»‡n',
  'web.translate.modeTwoWay': 'Hai chiá»u',
  'web.translate.modeOneWay': 'Má»™t chiá»u',
  'web.translate.turnLanguage': 'NÃ³i báº±ng {language}',
  'web.translate.twoWayUnavailable':
    'Táº¡m thá»i chá»‰ dá»‹ch má»™t chiá»u: {from} sang {to}. CÃ¢u nÃ³i báº±ng {to} sáº½ khÃ´ng Ä‘Æ°á»£c dá»‹ch.',
  'web.translate.detectUnavailable':
    'Hiá»‡n chÆ°a tá»± nháº­n diá»‡n Ä‘Æ°á»£c ngÃ´n ngá»¯. HÃ£y chá»n ngÃ´n ngá»¯ Ä‘ang nÃ³i Ä‘á»ƒ tiáº¿p tá»¥c.',
  'web.translate.detectBusy':
    'TÃ­nh nÄƒng tá»± nháº­n diá»‡n Ä‘ang báº­n. HÃ£y thá»­ láº¡i sau Ã­t phÃºt, hoáº·c chá»n ngÃ´n ngá»¯ Ä‘ang nÃ³i.',
  'web.translate.voiceDefault': 'Máº·c Ä‘á»‹nh',
  'web.translate.voiceListFailed':
    'ChÆ°a táº£i Ä‘Æ°á»£c danh sÃ¡ch giá»ng Ä‘á»c. Lá»±a chá»n giá»›i tÃ­nh giá»ng á»Ÿ trÃªn váº«n Ã¡p dá»¥ng.',
  'web.translate.turnUnheard': 'ChÆ°a Ä‘Æ°á»£c Ä‘á»c â€” phÃ¡t bá»‹ tá»¥t láº¡i',
  'web.translate.transcriptListening': 'Äang nghe. Cuá»™c há»™i thoáº¡i sáº½ hiá»‡n á»Ÿ Ä‘Ã¢y khi Ä‘Æ°á»£c dá»‹ch.',
  'web.translate.transcriptAttribution': 'Má»—i lÆ°á»£t nÃ³i cÃ³ thá»ƒ Ä‘Æ°á»£c Ä‘Ã¡nh dáº¥u lÃ  ai Ä‘Ã£ nÃ³i.',
  // Chá»‰ hiá»‡n á»Ÿ lÆ°á»£t Ä‘Ã£ Ä‘Æ°á»£c chá»‰nh láº¡i. "Báº£n mÃ¡y nghe" nÃ³i rÃµ Ä‘Ã³ lÃ  Ä‘áº§u ra thÃ´
  // cá»§a bá»™ nháº­n dáº¡ng, khÃ´ng pháº£i má»™t cÃ¡ch diá»…n Ä‘áº¡t khÃ¡c cá»§a cÃ¹ng má»™t cÃ¢u.
  'web.translate.sourceRawToggle': 'Báº£n mÃ¡y nghe',
  'web.translate.sourceRawLabel': 'MÃ¡y nháº­n dáº¡ng:',
  'web.translate.speakerUnknown': 'Ai Ä‘Ã£ nÃ³i?',
  'web.translate.speakerAsk': 'Cho biáº¿t ai Ä‘Ã£ nÃ³i',
  'web.translate.speakerPending': 'Äang xÃ¡c Ä‘á»‹nhâ€¦',
  'web.translate.speakerPendingAria': 'Äang xÃ¡c Ä‘á»‹nh ai Ä‘Ã£ nÃ³i. Cho biáº¿t ai, hoáº·c chá».',
  'web.translate.speakerChange': '{name} Ä‘Ã£ nÃ³i. Äá»•i.',
  'web.translate.speakerNobody': 'KhÃ´ng ai',
  'web.translate.speakerAdd': 'ThÃªm ngÆ°á»i',
  'web.translate.speakerManage': 'Äá»•i tÃªn hoáº·c xÃ³a',
  'web.translate.speakerManageDone': 'Xong',
  'web.translate.speakerDefault': 'NgÆ°á»i nÃ³i {number}',
  'web.translate.speakerRosterHint': 'ThÃªm nhá»¯ng ngÆ°á»i Ä‘ang nÃ³i Ä‘á»ƒ Ä‘Ã¡nh dáº¥u ai Ä‘Ã£ nÃ³i á»Ÿ má»—i lÆ°á»£t.',
  'web.translate.speakerNameFor': 'TÃªn cá»§a {name}',
  'web.translate.speakerRemove': 'XÃ³a {name}',
  'web.translate.speakerRemoveBlocked': '{name} Ä‘ang Ä‘Æ°á»£c gáº¯n cho má»™t lÆ°á»£t nÃ³i. Äá»•i lÆ°á»£t Ä‘Ã³ trÆ°á»›c.',
  'web.translate.speakerRemoveBlockedAria': 'KhÃ´ng xÃ³a Ä‘Æ°á»£c {name}: Ä‘ang Ä‘Æ°á»£c gáº¯n cho má»™t lÆ°á»£t nÃ³i',
  'web.translate.speakerLimit': 'Tá»‘i Ä‘a {max} ngÆ°á»i',
  'web.translate.attributionStats':
    '{total} lÆ°á»£t Â· {automatic} mÃ¡y tá»± Ä‘áº·t Â· {confirmed} báº¡n Ä‘Ã¡nh dáº¥u Â· {fallback} chÆ°a Ä‘Ã¡nh dáº¥u',
  'web.translate.attributionSuggestions':
    'gá»£i Ã½: {agreed} khá»›p, {changed} Ä‘Ã£ sá»­a, {unreviewed} chÆ°a xem',
  'web.translate.micLevel': 'Má»©c tÃ­n hiá»‡u micro',
  'web.translate.micNotFound': 'KhÃ´ng tÃ¬m tháº¥y micro. Báº¡n cáº¯m micro vÃ o Ä‘á»ƒ báº¯t Ä‘áº§u há»™i thoáº¡i nhÃ©.',
  'web.translate.micDenied':
    'TrÃ¬nh duyá»‡t Ä‘ang cháº·n micro. Báº¡n cho phÃ©p á»Ÿ thanh Ä‘á»‹a chá»‰ Ä‘á»ƒ báº¯t Ä‘áº§u há»™i thoáº¡i nhÃ©.',
  'web.translate.micBusy':
    'Má»™t á»©ng dá»¥ng khÃ¡c Ä‘ang giá»¯ micro. Báº¡n Ä‘Ã³ng á»©ng dá»¥ng Ä‘Ã³ rá»“i báº¯t Ä‘áº§u há»™i thoáº¡i láº¡i nhÃ©.',
  'web.translate.serviceUnreachable':
    'KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c tá»›i dá»‹ch vá»¥ dá»‹ch. BÃ¢y giá» chÆ°a báº¯t Ä‘áº§u há»™i thoáº¡i Ä‘Æ°á»£c Ä‘Ã¢u.',
  'web.translate.micFailed': 'ChÆ°a khá»Ÿi Ä‘á»™ng Ä‘Æ°á»£c micro.',

  'web.translate.saveFailedRetryable':
    'Cuá»™c há»™i thoáº¡i nÃ y chÆ°a Ä‘Æ°á»£c lÆ°u. NÃ³ sáº½ khÃ´ng xuáº¥t hiá»‡n trong lá»‹ch sá»­ cho Ä‘áº¿n khi lÆ°u xong.',
  'web.translate.saveFailedTerminal':
    'KhÃ´ng lÆ°u Ä‘Æ°á»£c cuá»™c há»™i thoáº¡i nÃ y, nÃªn nÃ³ sáº½ khÃ´ng xuáº¥t hiá»‡n trong lá»‹ch sá»­ vÃ  khÃ´ng thá»ƒ tÃ³m táº¯t.',
  'web.translate.saveEditsFailed':
    'Nhá»¯ng thay Ä‘á»•i má»›i nháº¥t chÆ°a Ä‘Æ°á»£c lÆ°u. Cuá»™c há»™i thoáº¡i váº«n náº±m trong lá»‹ch sá»­ cá»§a báº¡n.',
  'web.translate.saveRetry': 'LÆ°u láº¡i',
  'web.translate.saving': 'Äang lÆ°uâ€¦',
  'web.translate.recordingFailedRetryable':
    'Báº£n ghi Ã¢m chÆ°a Ä‘Æ°á»£c lÆ°u. Báº£n thÃ¢n cuá»™c há»™i thoáº¡i váº«n náº±m trong lá»‹ch sá»­ cá»§a báº¡n.',
  'web.translate.recordingFailedTerminal':
    'KhÃ´ng lÆ°u Ä‘Æ°á»£c báº£n ghi Ã¢m, nÃªn cuá»™c há»™i thoáº¡i nÃ y khÃ´ng cÃ³ tiáº¿ng Ä‘á»ƒ nghe láº¡i. Báº£n thÃ¢n cuá»™c há»™i thoáº¡i váº«n náº±m trong lá»‹ch sá»­ cá»§a báº¡n.',
  'web.translate.recordingUploading': 'Äang lÆ°u báº£n ghi Ã¢mâ€¦',
  'web.translate.minutesNeedsSave': 'BiÃªn báº£n Ä‘Æ°á»£c táº¡o tá»« cuá»™c há»™i thoáº¡i Ä‘Ã£ lÆ°u.',

  // ---- web.translate.minutes ----
  'web.translate.minutesGenerating': 'Äang tÃ³m táº¯t cuá»™c trÃ² chuyá»‡nâ€¦',
  'web.translate.minutesEmpty':
    'ChÆ°a cÃ³ biÃªn báº£n. Táº¡o biÃªn báº£n Ä‘á»ƒ cÃ³ pháº§n tÃ³m táº¯t, Ã½ chÃ­nh, quyáº¿t Ä‘á»‹nh vÃ  viá»‡c cáº§n lÃ m.',
  'web.translate.minutesNeedsTurns': 'HÃ£y trÃ² chuyá»‡n trÆ°á»›c Ä‘Ã£ â€” chÆ°a cÃ³ gÃ¬ Ä‘á»ƒ tÃ³m táº¯t.',
  'web.translate.minutesCopy': 'Sao chÃ©p',
  'web.translate.minutesCopied': 'ÄÃ£ sao chÃ©p',

  'web.error.title': 'CÃ³ gÃ¬ Ä‘Ã³ khÃ´ng á»•n',
  'web.error.retry': 'Thá»­ láº¡i',
  'web.error.appBody':
    'Trang nÃ y chÆ°a táº£i Ä‘Æ°á»£c. Báº¡n thá»­ láº¡i nhÃ©; náº¿u cá»© láº·p láº¡i thÃ¬ cÃ³ thá»ƒ mÃ¡y chá»§ dá»‹ch Ä‘ang khÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c.',
  'web.error.authBody':
    'BÆ°á»›c nÃ y chÆ°a hoÃ n táº¥t Ä‘Æ°á»£c. CÃ³ thá»ƒ liÃªn káº¿t Ä‘Ã£ háº¿t háº¡n â€” báº¡n xin má»™t liÃªn káº¿t má»›i rá»“i thá»­ láº¡i.',
  'web.error.pageDidNotLoad': 'Trang nÃ y chÆ°a táº£i Ä‘Æ°á»£c. Báº¡n thá»­ láº¡i nhÃ©.',
  'web.error.notFound': 'Trang nÃ y khÃ´ng tá»“n táº¡i',
  'web.error.notFoundBody': 'CÃ³ thá»ƒ Ä‘á»‹a chá»‰ Ä‘Ã£ Ä‘á»•i, hoáº·c liÃªn káº¿t dáº«n báº¡n tá»›i Ä‘Ã¢y Ä‘Ã£ cÅ©.',
  'web.error.goToStart': 'Vá» trang Ä‘áº§u',

  // ---- web.languageShort ----
  'web.languageShort.vi': 'Viá»‡t',
  'web.languageShort.en': 'Anh',
  'web.languageShort.zh': 'Trung',

  // ---- web.history ----
  'web.history.empty': 'ChÆ°a cÃ³ cuá»™c há»™i thoáº¡i nÃ o',
  'web.history.emptyBody':
    'Nhá»¯ng cuá»™c há»™i thoáº¡i báº¡n káº¿t thÃºc sáº½ Ä‘Æ°á»£c lÆ°u á»Ÿ Ä‘Ã¢y, Ä‘á»ƒ báº¡n Ä‘á»c láº¡i vÃ  tÃ³m táº¯t sau.',
  'web.history.searchLabel': 'TÃ¬m trong cÃ¡c cuá»™c há»™i thoáº¡i',
  'web.history.searchPlaceholder': 'TÃ¬mâ€¦',
  'web.history.searchNoResults': 'KhÃ´ng cÃ³ cuá»™c há»™i thoáº¡i nÃ o khá»›p.',
  'web.history.clearSearch': 'XoÃ¡ tÃ¬m kiáº¿m',
  'web.history.back': 'Quay láº¡i lá»‹ch sá»­',
  'web.history.turnCount': '{count} dÃ²ng',
  'web.history.turnCountOne': '1 dÃ²ng',
  'web.history.duration': '{minutes} phÃºt',
  'web.history.languagePair': '{from} â†’ {to}',
  'web.history.languagePairShort': '{from} â†’ {to}',
  'web.history.autoDetect': 'Tá»± nháº­n diá»‡n',
  'web.history.minutesReady': 'CÃ³ biÃªn báº£n',
  'web.history.cancel': 'Huá»·',
  'web.history.delete': 'XoÃ¡',
  'web.history.deleteConfirm': 'XoÃ¡ cuá»™c há»™i thoáº¡i nÃ y vÃ  biÃªn báº£n cá»§a nÃ³? KhÃ´ng thá»ƒ hoÃ n tÃ¡c.',
  'web.history.deleting': 'Äang xoÃ¡â€¦',
  'web.history.deleteFailed': 'KhÃ´ng xoÃ¡ Ä‘Æ°á»£c cuá»™c há»™i thoáº¡i nÃ y. NÃ³ váº«n cÃ²n á»Ÿ Ä‘Ã¢y.',
  'web.history.loading': 'Äang táº£i cÃ¡c cuá»™c há»™i thoáº¡iâ€¦',
  'web.history.loadFailed': 'KhÃ´ng táº£i Ä‘Æ°á»£c lá»‹ch sá»­. HÃ£y thá»­ láº¡i.',
  'web.history.retry': 'Thá»­ láº¡i',
  'web.history.notFound': 'Cuá»™c há»™i thoáº¡i nÃ y khÃ´ng cÃ²n ná»¯a.',
  'web.history.notFoundBody': 'CÃ³ thá»ƒ nÃ³ Ä‘Ã£ bá»‹ xoÃ¡, hoáº·c lÃºc nÃ y chÆ°a káº¿t ná»‘i Ä‘Æ°á»£c tá»›i mÃ¡y chá»§.',
  'web.history.speakerA': 'NgÆ°á»i nÃ³i A',
  'web.history.speakerB': 'NgÆ°á»i nÃ³i B',
  'web.history.playRecording': 'Nghe báº£n ghi Ã¢m',
  'web.history.pauseRecording': 'Táº¡m dá»«ng báº£n ghi Ã¢m',
  'web.history.playFrom': 'Nghe tá»« {time}',
  'web.history.recordingLabel': 'Vá»‹ trÃ­ trong báº£n ghi Ã¢m',
  'web.history.recordingFailed': 'KhÃ´ng táº£i Ä‘Æ°á»£c báº£n ghi Ã¢m.',
  'web.history.loadMore': 'Táº£i thÃªm',
  'web.history.loadMoreFailed': 'KhÃ´ng táº£i thÃªm Ä‘Æ°á»£c cuá»™c há»™i thoáº¡i nÃ o.',

  'web.preferences.conversation': 'Máº·c Ä‘á»‹nh cho há»™i thoáº¡i má»›i',
  'web.preferences.conversationHint':
    'Má»™t cuá»™c há»™i thoáº¡i má»›i báº¯t Ä‘áº§u tá»« nhá»¯ng lá»±a chá»n nÃ y. Trong lÃºc Ä‘ang dá»‹ch, báº¡n Ä‘á»•i ngay trÃªn trang Dá»‹ch â€” ngÃ´n ngá»¯ vÃ  giá»ng thÃ¬ cá»‘ Ä‘á»‹nh cho tá»›i khi cuá»™c Ä‘Ã³ káº¿t thÃºc.',
  // AI Context â€” thÆ° viá»‡n ngá»¯ cáº£nh Ä‘Ã£ Ä‘áº·t tÃªn.
  'web.preferences.aiContext': 'Ngá»¯ cáº£nh AI',
  'web.preferences.aiContextHint':
    'Cho trÃ¬nh dá»‹ch biáº¿t cuá»™c trÃ² chuyá»‡n nÃ³i vá» chuyá»‡n gÃ¬ trÆ°á»›c khi nÃ³ nghe báº¥t cá»© cÃ¢u nÃ o â€” chá»§ Ä‘á», nhá»¯ng cÃ¡i tÃªn sáº½ xuáº¥t hiá»‡n, vÃ  cÃ¡ch báº¡n muá»‘n má»™t sá»‘ tá»« Ä‘Æ°á»£c dá»‹ch ra. Khi báº¯t Ä‘áº§u má»™t cuá»™c trÃ² chuyá»‡n, báº¡n chá»n má»™t ngá»¯ cáº£nh á»Ÿ Ä‘Ã¢y hoáº·c trong tiá»‡n Ã­ch trÃ¬nh duyá»‡t.',
  'web.preferences.aiContext.empty': 'Báº¡n chÆ°a cÃ³ ngá»¯ cáº£nh nÃ o. HÃ£y táº¡o má»™t cÃ¡i Ä‘á»ƒ báº¯t Ä‘áº§u.',
  'web.preferences.aiContext.new': 'Ngá»¯ cáº£nh má»›i',
  'web.preferences.aiContext.edit': 'Sá»­a',
  'web.preferences.aiContext.delete': 'XoÃ¡',
  'web.preferences.aiContext.deleting': 'Äang xoÃ¡â€¦',
  'web.preferences.aiContext.deleteFailed': 'KhÃ´ng xoÃ¡ Ä‘Æ°á»£c ngá»¯ cáº£nh nÃ y. NÃ³ váº«n cÃ²n Ä‘Ã¢y.',
  'web.preferences.aiContext.save': 'LÆ°u ngá»¯ cáº£nh',
  'web.preferences.aiContext.cancel': 'Huá»·',
  'web.preferences.aiContext.saving': 'Äang lÆ°uâ€¦',
  'web.preferences.aiContext.name': 'TÃªn',
  'web.preferences.aiContext.description': 'Cuá»™c trÃ² chuyá»‡n nÃ³i vá» chuyá»‡n gÃ¬',
  'web.preferences.aiContext.descriptionHint':
    'VÃ i chá»¯ thÃ´i, vÃ­ dá»¥ "nháº­n phÃ²ng khÃ¡ch sáº¡n" hoáº·c "khÃ¡m tim máº¡ch". NÃ³ giÃºp trÃ¬nh dá»‹ch chá»n Ä‘Ãºng nghÄ©a khi má»™t cÃ¢u cÃ³ thá»ƒ hiá»ƒu theo nhiá»u cÃ¡ch.',
  'web.preferences.aiContext.keywords': 'TÃªn riÃªng vÃ  thuáº­t ngá»¯ sáº½ xuáº¥t hiá»‡n',
  'web.preferences.aiContext.keywordsHint':
    'TÃªn riÃªng, thuáº­t ngá»¯ chuyÃªn ngÃ nh, tÃªn sáº£n pháº©m â€” nhá»¯ng tá»« hay bá»‹ nghe nháº§m nháº¥t.',
  'web.preferences.aiContext.keywordTooLong':
    'Má»™t dÃ²ng dÃ i quÃ¡ â€” tá»‘i Ä‘a {max} kÃ½ tá»±. HÃ£y rÃºt gá»n hoáº·c xoÃ¡ dÃ²ng nÃ y.',
  'web.preferences.aiContext.keywordsTooMany':
    'Báº¡n Ä‘ang cÃ³ {count} tá»«, trong khi giá»›i háº¡n lÃ  {max}. HÃ£y bá»›t Ä‘i trÆ°á»›c khi lÆ°u.',
  'web.preferences.aiContext.glossary': 'CÃ¡ch dá»‹ch mong muá»‘n',
  'web.preferences.aiContext.glossaryHint':
    'CÃ¡ch báº¡n muá»‘n má»™t tá»« cá»¥ thá»ƒ Ä‘Æ°á»£c dá»‹ch ra. HÃ£y viáº¿t tá»« Ä‘Ã³ báº±ng Ã­t nháº¥t hai thá»© tiáº¿ng; trÃ¬nh dá»‹ch dÃ¹ng Ä‘Ãºng hai thá»© tiáº¿ng cá»§a cuá»™c há»™i thoáº¡i, theo chiá»u nÃ o cÅ©ng Ä‘Æ°á»£c, vÃ  chá»‰ khi tá»« Ä‘Ã³ thá»±c sá»± Ä‘Æ°á»£c nÃ³i ra.',
  'web.preferences.aiContext.glossaryTooLong':
    'CÃ¡ch dá»‹ch chá»‰ nÃªn lÃ  má»™t tá»« hoáº·c má»™t cá»¥m ngáº¯n â€” tá»‘i Ä‘a {max} chá»¯. HÃ£y rÃºt gá»n cáº·p nÃ y, hoáº·c xoÃ¡ nÃ³ Ä‘i.',
  'web.preferences.aiContext.glossaryAdd': 'ThÃªm má»™t cáº·p',
  'web.preferences.aiContext.glossaryRemove': 'XoÃ¡ cáº·p nÃ y',
  'web.preferences.aiContext.register': 'VÄƒn phong',
  'web.preferences.aiContext.limitReached':
    'Báº¡n Ä‘Ã£ Ä‘áº¡t sá»‘ ngá»¯ cáº£nh tá»‘i Ä‘a. HÃ£y xoÃ¡ bá»›t má»™t cÃ¡i Ä‘á»ƒ táº¡o cÃ¡i má»›i.',
  'web.preferences.aiContext.saveFailed':
    'KhÃ´ng lÆ°u Ä‘Æ°á»£c ngá»¯ cáº£nh nÃ y. Nhá»¯ng gÃ¬ báº¡n vá»«a nháº­p váº«n cÃ²n nguyÃªn.',
  'web.preferences.aiContext.loadFailed':
    'KhÃ´ng táº£i Ä‘Æ°á»£c danh sÃ¡ch ngá»¯ cáº£nh. PhiÃªn Ä‘Äƒng nháº­p cá»§a báº¡n váº«n cÃ²n hiá»‡u lá»±c.',
  'web.preferences.interface': 'Giao diá»‡n',

  'web.account.memberSince': 'Tham gia tá»«',
  'web.account.nameUnset': 'ChÆ°a Ä‘áº·t',
  'web.account.loadFailed':
    'ChÆ°a táº£i Ä‘Æ°á»£c thÃ´ng tin tÃ i khoáº£n. PhiÃªn Ä‘Äƒng nháº­p cá»§a báº¡n váº«n cÃ²n hiá»‡u lá»±c.',
  'web.account.avatarChange': 'Äá»•i áº£nh',
  'web.account.avatarRemove': 'XoÃ¡ áº£nh',
  'web.account.avatarHint':
    'Hiá»ƒn thá»‹ cáº¡nh tÃªn báº¡n á»Ÿ Ä‘Ã¢y vÃ  trong thanh bÃªn. áº¢nh vuÃ´ng lÃ  Ä‘áº¹p nháº¥t; chÃºng tÃ´i cáº¯t vÃ o giá»¯a.',
  'web.account.avatarNotAnImage': 'Tá»‡p Ä‘Ã³ khÃ´ng pháº£i áº£nh. HÃ£y chá»n JPEG, PNG hoáº·c WebP.',
  'web.account.avatarTooLarge': 'áº¢nh Ä‘Ã³ quÃ¡ lá»›n. HÃ£y chá»n áº£nh dÆ°á»›i 256KB.',
  'web.account.avatarFailed': 'ChÆ°a lÆ°u Ä‘Æ°á»£c áº£nh Ä‘Ã³. HÃ£y thá»­ láº¡i.',
  'web.account.avatarUnavailable':
    'ChÆ°a lÆ°u Ä‘Æ°á»£c áº£nh â€” khÃ´ng cÃ³ gÃ¬ bá»‹ thay Ä‘á»•i. HÃ£y thá»­ láº¡i; náº¿u váº«n lá»—i, hÃ£y bÃ¡o cho ngÆ°á»i quáº£n trá»‹ mÃ¡y chá»§.',
  'web.account.security': 'Báº£o máº­t',
  'web.account.changePassword': 'Äá»•i máº­t kháº©u',
  'web.account.changePasswordHint':
    'ChÃºng tÃ´i gá»­i cho báº¡n má»™t liÃªn káº¿t qua email. HoÃ n táº¥t liÃªn káº¿t Ä‘Ã³ cÅ©ng sáº½ vÃ´ hiá»‡u phiÃªn Ä‘Äƒng nháº­p trÃªn cÃ¡c thiáº¿t bá»‹ khÃ¡c cá»§a báº¡n vÃ  Ä‘Ã³ng cuá»™c dá»‹ch nÃ o cÃ²n Ä‘ang má»Ÿ.',
  'web.account.signOutHint':
    'Chá»‰ Ä‘Äƒng xuáº¥t khá»i trÃ¬nh duyá»‡t nÃ y. CÃ¡c thiáº¿t bá»‹ khÃ¡c váº«n Ä‘Äƒng nháº­p cho tá»›i khi phiÃªn cá»§a chÃºng háº¿t háº¡n.',

  'web.landing.heroTitle': 'NÃ³i báº±ng ngÃ´n ngá»¯ cá»§a báº¡n. ÄÆ°á»£c hiá»ƒu báº±ng ngÃ´n ngá»¯ cá»§a ngÆ°á»i nghe.',
  'web.landing.heroBody':
    'Dá»‹ch giá»ng nÃ³i theo thá»i gian thá»±c giá»¯a tiáº¿ng Viá»‡t, tiáº¿ng Anh vÃ  tiáº¿ng Trung â€” khi trÃ² chuyá»‡n trá»±c tiáº¿p trÃªn trÃ¬nh duyá»‡t, trong cuá»™c há»p video, hoáº·c ngay trong cuá»™c gá»i Google Meet, Zoom hoáº·c Facebook.',
  'web.landing.meetingsStart': 'Táº¡o cuá»™c há»p',
  'web.landing.demoListening': 'Äang nghe',
  'web.landing.demoSourceOne': 'ChÃ o anh, mÃ¬nh muá»‘n há»i vá» lá»‹ch há»p chiá»u nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure â€” it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'ÄÆ°á»£c thÃ´i â€” cuá»™c há»p Ä‘Ã£ dá»i sang bá»‘n giá».',
  'web.landing.howTitle': 'CÃ¡ch hoáº¡t Ä‘á»™ng',
  'web.landing.howBody': 'Ba Ä‘iá»u Ä‘Ã¡ng biáº¿t trÆ°á»›c khi báº¡n cáº¥p quyá»n micro.',
  'web.landing.howOneTitle': 'Báº¥m báº¯t Ä‘áº§u, rá»“i cá»© nÃ³i',
  'web.landing.howOneBody':
    'KhÃ´ng cáº§n giá»¯ nÃºt. LÆ°á»£t nÃ³i káº¿t thÃºc khi báº¡n dá»«ng láº¡i, vÃ  báº£n dá»‹ch Ä‘Æ°á»£c phÃ¡t sau khoáº£ng má»™t giÃ¢y.',
  'web.landing.howTwoTitle': 'Tá»± Ä‘á»™ng nháº­n biáº¿t ngÃ´n ngá»¯',
  'web.landing.howTwoBody':
    'Chatofy tá»± phÃ¢n biá»‡t tiáº¿ng Viá»‡t vÃ  tiáº¿ng Anh trong lÃºc báº¡n nÃ³i. Vá»›i tiáº¿ng Trung, báº¡n chá»n ngÃ´n ngá»¯ trÆ°á»›c khi báº¯t Ä‘áº§u.',
  'web.landing.howThreeTitle': 'Nghe báº£n dá»‹ch, khÃ´ng pháº£i Ä‘á»c',
  'web.landing.howThreeBody':
    'Báº£n dá»‹ch Ä‘Æ°á»£c Ä‘á»c thÃ nh tiáº¿ng. Pháº§n chá»¯ váº«n á»Ÿ láº¡i trÃªn mÃ n hÃ¬nh Ä‘á»ƒ báº¡n Ä‘á»‘i chiáº¿u.',
  'web.landing.meetingsTitle': 'Cuá»™c há»p Ä‘a ngÃ´n ngá»¯, dá»‹ch trá»±c tiáº¿p',
  'web.landing.meetingsBody':
    'Chia sáº» má»™t Ä‘Æ°á»ng liÃªn káº¿t; má»—i ngÆ°á»i tham gia nghe cuá»™c há»p báº±ng ngÃ´n ngá»¯ cá»§a mÃ¬nh.',
  'web.landing.meetingsLinkTitle': 'Tham gia báº±ng má»™t Ä‘Æ°á»ng liÃªn káº¿t',
  'web.landing.meetingsLinkBody':
    'NgÆ°á»i dÃ¹ng cÃ³ tÃ i khoáº£n chá»‰ cáº§n má»Ÿ liÃªn káº¿t Ä‘á»ƒ tham gia, khÃ´ng cáº§n cÃ i Ä‘áº·t.',
  'web.landing.meetingsHearTitle': 'Phá»¥ Ä‘á» vÃ  giá»ng Ä‘á»c theo ngÃ´n ngá»¯ cá»§a báº¡n',
  'web.landing.meetingsHearBody':
    'Lá»i cá»§a má»—i ngÆ°á»i Ä‘Æ°á»£c dá»‹ch, hiá»ƒn thá»‹ phá»¥ Ä‘á» vÃ  Ä‘á»c láº¡i báº±ng ngÃ´n ngá»¯ báº¡n chá»n.',
  'web.landing.meetingsChatTitle': 'Tin nháº¯n Ä‘Æ°á»£c dá»‹ch tá»± Ä‘á»™ng',
  'web.landing.meetingsChatBody': 'Má»—i tin nháº¯n hiá»ƒn thá»‹ theo ngÃ´n ngá»¯ cá»§a ngÆ°á»i nháº­n.',
  'web.landing.meetingsMinutesTitle': 'BiÃªn báº£n cuá»™c há»p',
  'web.landing.meetingsMinutesBody':
    'Sau buá»•i há»p, báº¡n cÃ³ thá»ƒ táº¡o biÃªn báº£n gá»“m tÃ³m táº¯t ná»™i dung, cÃ¡c quyáº¿t Ä‘á»‹nh vÃ  Ä‘áº§u viá»‡c ngay táº¡i mÃ n hÃ¬nh káº¿t thÃºc.',
  'web.landing.meetingsScope': 'Cuá»™c há»p há»— trá»£ dá»‹ch giá»¯a tiáº¿ng Viá»‡t, tiáº¿ng Anh vÃ  tiáº¿ng Trung.',
  // VÃ¬ sao khá»‘i nÃ y khÃ´ng nÃ³i giá»ng nÃ³i Ä‘Æ°á»£c xá»­ lÃ½ á»Ÿ Ä‘Ã¢u: xem chÃº thÃ­ch trong báº£n
  // tiáº¿ng Anh.
  'web.landing.localTitle': 'Dá»¯ liá»‡u ghi Ã¢m cá»§a báº¡n Ä‘Æ°á»£c xá»­ lÃ½ tháº¿ nÃ o',
  'web.landing.localBody':
    'Dá»‹ch vá»¥ dá»‹ch chá»‰ nháº­n vÄƒn báº£n, khÃ´ng bao giá» nháº­n Ã¢m thanh cá»§a báº¡n. DÆ°á»›i Ä‘Ã¢y lÃ  nhá»¯ng gÃ¬ Ä‘Æ°á»£c lÆ°u láº¡i vÃ  nhá»¯ng gÃ¬ khÃ´ng.',
  'web.landing.localKeptHistory':
    'Khi má»™t cuá»™c há»™i thoáº¡i káº¿t thÃºc, báº£n ghi Ã¢m cÃ¹ng pháº§n chá»¯ Ä‘Æ°á»£c lÆ°u vÃ o lá»‹ch sá»­ cá»§a báº¡n, Ä‘á»ƒ báº¡n nghe láº¡i vÃ  Ä‘á»c láº¡i.',
  'web.landing.localKeptLink':
    'Báº£n ghi Ã¢m Ä‘Æ°á»£c lÆ°u táº¡i má»™t Ä‘á»‹a chá»‰ khÃ³ Ä‘oÃ¡n mÃ  báº¥t ká»³ ai cÃ³ Ä‘Æ°á»ng liÃªn káº¿t Ä‘Ã³ cÅ©ng má»Ÿ Ä‘Æ°á»£c, nÃªn chÃ­nh Ä‘Æ°á»ng liÃªn káº¿t lÃ  thá»© giá»¯ cho nÃ³ riÃªng tÆ°.',
  'web.landing.localKeptPause':
    'Khi táº¡m dá»«ng cuá»™c há»™i thoáº¡i, báº£n ghi Ã¢m cÅ©ng táº¡m dá»«ng theo: nhá»¯ng gÃ¬ nÃ³i trong lÃºc táº¡m dá»«ng khÃ´ng Ä‘Æ°á»£c ghi láº¡i vÃ  khÃ´ng Ä‘Æ°á»£c dá»‹ch.',
  'web.landing.localKeptDelete': 'XoÃ¡ má»™t cuá»™c há»™i thoáº¡i sáº½ xoÃ¡ luÃ´n báº£n ghi Ã¢m cá»§a nÃ³.',
  'web.landing.localKeptMeeting':
    'Cuá»™c há»p lÆ°u lá»i nÃ³i vÃ  tin nháº¯n dÆ°á»›i dáº¡ng vÄƒn báº£n, khÃ´ng lÆ°u Ã¢m thanh. Má»i ngÆ°á»i Ä‘Ã£ tham gia Ä‘á»u Ä‘á»c Ä‘Æ°á»£c, vÃ  hiá»‡n chÆ°a cÃ³ cÃ¡ch xoÃ¡.',
  'web.landing.surfacesTitle': 'Chatofy cháº¡y á»Ÿ Ä‘Ã¢u',
  'web.landing.surfaceBrowserTitle': 'TrÃªn trÃ¬nh duyá»‡t',
  'web.landing.surfaceBrowserBody':
    'Dá»‹ch há»™i thoáº¡i hoáº·c tá»• chá»©c cuá»™c há»p ngay trÃªn trÃ¬nh duyá»‡t, khÃ´ng cáº§n cÃ i Ä‘áº·t.',
  'web.landing.surfaceExtensionTitle': 'Tiá»‡n Ã­ch cho Meet, Zoom vÃ  Facebook',
  'web.landing.surfaceExtensionBody': 'Dá»‹ch hai chiá»u ngay trong cuá»™c gá»i báº¡n Ä‘ang dÃ¹ng.',
  'web.landing.surfacePhoneTitle': 'TrÃªn Ä‘iá»‡n thoáº¡i',
  'web.landing.surfacePhoneBody':
    'Äang phÃ¡t triá»ƒn. ÄÃ£ há»— trá»£ tham gia cuá»™c há»p; chÆ°a phÃ¡t hÃ nh trÃªn kho á»©ng dá»¥ng.',
  'web.landing.ctaTitle': 'Thá»­ má»™t cuá»™c há»™i thoáº¡i',
  'web.landing.ctaBody': 'Cáº§n má»™t micro vÃ  má»™t tÃ i khoáº£n. KhÃ´ng cáº§n tháº».',
  'web.landing.navMenu': 'Danh má»¥c',
  'web.landing.navMeetings': 'Cuá»™c há»p',
  'web.landing.navHow': 'CÃ¡ch hoáº¡t Ä‘á»™ng',
  'web.landing.navLocal': 'RiÃªng tÆ°',
  'web.landing.navSurfaces': 'NÆ¡i dÃ¹ng',

  'web.landing.heroTitleEmphasis': 'ÄÆ°á»£c hiá»ƒu',

  // ---- web.conference ----
  'web.conference.joining': 'Äang tham giaâ€¦',
  // ---- web.conference: in-call control bar ----
  'web.conference.muted': 'ÄÃ£ táº¯t tiáº¿ng',
  'web.conference.showRoster': 'Xem danh sÃ¡ch',
  // ---- web.conference: tráº¡ng thÃ¡i ngoáº¡i lá»‡ (Phase 5) ----
  'web.conference.permissionDeniedHint':
    'Má»Ÿ cÃ i Ä‘áº·t trÃ¬nh duyá»‡t vÃ  cáº¥p quyá»n camera + micro, sau Ä‘Ã³ táº£i láº¡i trang.',
  // ---- web.conference: má»Ÿ khÃ³a Ã¢m thanh (Phase 1) ----
  'web.conference.audioBlocked': 'Ã‚m thanh bá»‹ cháº·n bá»Ÿi trÃ¬nh duyá»‡t.',
  'web.conference.enableAudio': 'Nháº¥n Ä‘á»ƒ báº­t Ã¢m thanh',
  // ---- web.conference: landing and pre-join room ----
  'web.conference.newMeeting': 'Cuá»™c há»p má»›i',
  'web.conference.codeOrLink': 'MÃ£ hoáº·c link cuá»™c há»p',
  'web.conference.codeOrLinkPlaceholder': 'DÃ¡n link hoáº·c nháº­p mÃ£',
  'web.conference.joinAction': 'Tham gia',
  'web.conference.joiningAs': 'Tham gia vá»›i tÃªn {name}',
  'web.conference.landingLead': 'Há»p vá»›i giá»ng nÃ³i vÃ  phá»¥ Ä‘á» Ä‘Æ°á»£c dá»‹ch.',
  'web.conference.readyToJoin': 'Sáºµn sÃ ng tham gia?',
  'web.conference.joinNow': 'Tham gia ngay',
  'web.conference.microphone': 'MicrÃ´',
  'web.conference.camera': 'Camera',
  'web.conference.defaultDevice': 'Máº·c Ä‘á»‹nh cá»§a há»‡ thá»‘ng',
  'web.conference.noCameraPreview': 'Camera Ä‘ang táº¯t',
  'web.conference.micLevel': 'Má»©c Ã¢m micrÃ´',
  'web.conference.translatedVoiceChip': 'Giá»ng: {gender} Â· {speed}Ã—',
  'web.conference.translatedVoiceHint':
    'NgÆ°á»i khÃ¡c nghe báº£n dá»‹ch lá»i báº¡n báº±ng giá»ng nÃ y. ÄÃ¢y cÅ©ng lÃ  cÃ i Ä‘áº·t á»Ÿ trang Dá»‹ch.',
  'web.conference.copyInviteLink': 'Sao chÃ©p link má»i',
  'web.conference.inviteLinkCopied': 'ÄÃ£ sao chÃ©p link',
  'web.conference.meetingCode': 'MÃ£ cuá»™c há»p',
  'web.conference.roomGoneHint': 'Kiá»ƒm tra láº¡i link, hoáº·c nhá» ngÆ°á»i má»i gá»­i link má»›i.',
  'web.meta.conference': 'Há»™i nghá»‹ Â· Chatofy',

  // ---- mobile.conference: sáº£nh vÃ  mÃ n hÃ¬nh gá»i cá»§a á»©ng dá»¥ng React Native ----
  'mobile.conference.ongoingTitle': 'Äang trong cuá»™c há»p',
  'mobile.conference.ongoingBody': 'Micro váº«n báº­t khi Chatofy cháº¡y ná»n. Camera sáº½ táº¯t.',
  // ---- mobile.conference: lá»—i vÃ  tráº¡ng thÃ¡i ngoáº¡i lá»‡ ----
  'mobile.conference.permissionDeniedHint':
    'Má»Ÿ CÃ i Ä‘áº·t vÃ  cho phÃ©p á»©ng dá»¥ng dÃ¹ng camera vÃ  micro, sau Ä‘Ã³ thá»­ láº¡i.',
  'mobile.conference.notAuthenticated': 'Báº¡n cáº§n Ä‘Äƒng nháº­p Ä‘á»ƒ tham gia cuá»™c gá»i.',
  // ---- mobile.conference: giao diá»‡n dá»‹ch (phá»¥ Ä‘á», báº£n ghi, ngÃ´n ngá»¯) ----
  'mobile.conference.sourceLanguageLocked': 'NgÃ´n ngá»¯ Ä‘Ã£ cá»‘ Ä‘á»‹nh cho cuá»™c gá»i nÃ y.',
  'mobile.conference.showTranscript': 'Hiá»‡n báº£n ghi',
  'mobile.conference.hideTranscript': 'áº¨n báº£n ghi',
  'mobile.conference.transcriptEmpty': 'ChÆ°a cÃ³ ai nÃ³i gÃ¬.',
  // ---- mobile.conference: in-meeting chat (translated per recipient) ----
  'mobile.conference.showChat': 'Hiá»‡n trÃ² chuyá»‡n',
  'mobile.conference.hideChat': 'áº¨n trÃ² chuyá»‡n',
  'mobile.conference.minutesGenerating': 'Äang tÃ³m táº¯t cuá»™c há»pâ€¦',
  'mobile.conference.minutesEmpty': 'ChÆ°a cÃ³ biÃªn báº£n. Ai Ä‘Ã£ tham gia cuá»™c há»p Ä‘á»u cÃ³ thá»ƒ táº¡o.',
  'mobile.home.comingSoon': 'sáº¯p ra máº¯t',
  'mobile.home.joinConference': 'Tham gia cuá»™c há»p',
  'mobile.home.signIn': 'ÄÄƒng nháº­p',
  'mobile.auth.signInTitle': 'ÄÄƒng nháº­p',
  'mobile.auth.missingFields': 'Nháº­p email vÃ  máº­t kháº©u.',
  'mobile.auth.invalidCredentials': 'Email hoáº·c máº­t kháº©u khÃ´ng Ä‘Ãºng.',
  'mobile.auth.tooManyAttempts': 'Thá»­ quÃ¡ nhiá»u láº§n. Äá»£i má»™t phÃºt rá»“i thá»­ láº¡i.',
  'mobile.auth.signInFailed': 'KhÃ´ng Ä‘Äƒng nháº­p Ä‘Æ°á»£c. Kiá»ƒm tra káº¿t ná»‘i rá»“i thá»­ láº¡i.',
  'mobile.auth.noAccount': 'ChÆ°a cÃ³ tÃ i khoáº£n? Táº¡o trÃªn trang web Chatofy rá»“i Ä‘Äƒng nháº­p á»Ÿ Ä‘Ã¢y.',
  'mobile.settings.signedInAs': 'Äang Ä‘Äƒng nháº­p: {email}',
  'mobile.settings.signedOut': 'Báº¡n chÆ°a Ä‘Äƒng nháº­p.',


  'web.chrome.navGlossary': 'Báº£ng thuáº­t ngá»¯',

  'web.meta.glossary': 'Báº£ng thuáº­t ngá»¯ Â· Chatofy',

  'web.glossary.title': 'Báº£ng thuáº­t ngá»¯',
  'web.glossary.new': 'Táº¡o má»›i',
  'web.glossary.loadFailed': 'KhÃ´ng thá»ƒ táº£i danh sÃ¡ch báº£ng thuáº­t ngá»¯.',
  'web.glossary.emptyList': 'ChÆ°a cÃ³ báº£ng thuáº­t ngá»¯ nÃ o.',
  'web.glossary.termCount': '{count} thuáº­t ngá»¯',
  'web.glossary.badgeActive': 'Äang dÃ¹ng',
  'web.glossary.badgeInactive': 'Táº¯t',
  'web.glossary.toggleActive': 'Báº­t/táº¯t',
  'web.glossary.delete': 'XoÃ¡',
  'web.glossary.nameLabel': 'TÃªn',
  'web.glossary.descriptionLabel': 'MÃ´ táº£',
  'web.glossary.sourceLangLabel': 'NgÃ´n ngá»¯ nguá»“n',
  'web.glossary.createFailed': 'KhÃ´ng thá»ƒ táº¡o báº£ng thuáº­t ngá»¯. HÃ£y thá»­ láº¡i.',
  'web.glossary.creating': 'Äang táº¡oâ€¦',
  'web.glossary.create': 'Táº¡o',
  'web.glossary.cancel': 'Huá»·',
  'web.glossary.setDefault': 'DÃ¹ng cho má»—i phiÃªn dá»‹ch',
  'web.glossary.originalLabel': 'Tá»« gá»‘c',
  'web.glossary.translationLabel': 'Báº£n dá»‹ch',
  'web.glossary.targetLangLabel': 'NgÃ´n ngá»¯ Ä‘Ã­ch',
  'web.glossary.notesLabel': 'Ghi chÃº',
  'web.glossary.notesPlaceholder': 'Ghi chÃº tuá»³ chá»n vá» thuáº­t ngá»¯ nÃ y',
  'web.glossary.addTermFailed': 'KhÃ´ng thá»ƒ thÃªm thuáº­t ngá»¯. HÃ£y thá»­ láº¡i.',
  'web.glossary.adding': 'Äang thÃªmâ€¦',
  'web.glossary.addTerm': 'ThÃªm thuáº­t ngá»¯',
  'web.glossary.filterTerms': 'Lá»c thuáº­t ngá»¯â€¦',
  'web.glossary.loadTermsFailed': 'KhÃ´ng thá»ƒ táº£i danh sÃ¡ch thuáº­t ngá»¯.',
  'web.glossary.noTermsMatch': 'KhÃ´ng cÃ³ thuáº­t ngá»¯ nÃ o khá»›p.',
  'web.glossary.noTerms': 'ChÆ°a cÃ³ thuáº­t ngá»¯ nÃ o.',
  'web.glossary.removeTerm': 'XoÃ¡ thuáº­t ngá»¯',
  'web.glossary.selectGlossary': 'Chá»n má»™t báº£ng thuáº­t ngá»¯ Ä‘á»ƒ xem ná»™i dung.',
  'web.glossary.termsHeading': 'Thuáº­t ngá»¯',
};

