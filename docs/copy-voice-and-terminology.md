# Copy voice and terminology

The contract every rewrite of interface copy follows, in English, Vietnamese and
Chinese: the web app (`packages/i18n/src/{en,vi,zh}.ts`), mobile (`mobile.*` keys),
the extension, and the four mails (`apps/api/src/modules/mail/interfaces/mail-sender.interface.ts`).

It sits under [design-guidelines.md § Copy register](./design-guidelines.md#copy-register),
which still decides WHAT may be said (the wait, the outcome, the next step — never the
pipeline). This file decides HOW it sounds and WHICH word names each thing.

**The voice, in one line:** concise and friendly, as if the product had been written
in each language first. Not corporate, not cute, no slang.

**The test:** read the string aloud to a native speaker who has never seen the English.
If they can tell it was translated, it fails. English is the reference for meaning,
never for sentence structure.

Every "before" below is a real string at the time of writing; the key is cited so it
can be found. The "after" is a model, not a final string — the writer still owns it.

---

## 1. Voice rules

### 1.1 English

| #   | Rule                                                                                                                                                                                                                         | Before → after                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **One idea per sentence.** Body text ≤ 20 words a sentence; status lines and toasts ≤ 8 words.                                                                                                                               | `web.translate.saveFailedTerminal` "This conversation could not be saved, so it will not appear in your history and cannot be summarized." → "This conversation couldn't be saved. It won't appear in History, and it can't get minutes." |
| E2  | **Use contractions** (couldn't, won't, you're, isn't). The file mixes "Could not" and "Couldn't"; contractions win everywhere.                                                                                               | `common.conference.createFailed` "Could not create a room. Try again." → "Couldn't create the meeting. Try again."                                                                                                                        |
| E3  | **Errors say what happened, then the next step.** Never a bare "Something went wrong." or a bare failure with no way out.                                                                                                    | `web.glossary.loadFailed` "Could not load your glossaries." → "Couldn't load your glossaries. Check your connection and try again."                                                                                                       |
| E4  | **Buttons and menu items start with a verb, sentence case, no full stop.** Labels and headings are nouns. 1–3 words for a button.                                                                                            | `web.team.inviteRevoke` "Withdraw" → "Withdraw invite"; `web.chrome.toggleSidebar` "Toggle the sidebar" → "Show or hide sidebar"                                                                                                          |
| E5  | **Plain words over system words.** No "unexpected response", "session is still valid", "invalid". Say it the way a person would.                                                                                             | `web.auth.unexpectedResponse` "Unexpected response from the server." → "The server sent back something odd. Try again." ; `web.account.loadFailed` "…Your session is still valid." → "…You're still signed in."                           |
| E6  | **No mechanism words** (Copy register). Recognised, transcribed, synthesised, pipeline, model names are not product words.                                                                                                   | `web.translate.sourceRawLabel` "Recognized:" → "Heard:"                                                                                                                                                                                   |
| E7  | **Punctuation:** at most one spaced em dash (" — ") per string, and prefer a full stop over it. "…" is the single character U+2026, only on in-progress states and placeholders. Curly quotes “ ” and apostrophe ’ in prose. | `web.auth.tookTooLong` "That took too long — try again." → "That took too long. Try again."                                                                                                                                               |
| E8  | **American spelling**, one way everywhere: color, center, canceled, traveling, summarize.                                                                                                                                    | `common.theme.label` "Colour theme" → "Color theme"; `web.landing.useTravelTitle` "Travelling" → "Traveling"; `web.account.avatarHint` "centre" → "center"                                                                                |
| E9  | **One term per concept** (§2). In particular a Chatofy meeting is a _meeting_, never a room, conference or call; _call_ is only a Meet, Zoom or Facebook call.                                                               | `common.conference.create` "Create a room" → "New meeting"; `common.conference.disconnectedHint` "The call ended. Return to the lobby to rejoin." → "You're disconnected from the meeting. Go back to rejoin."                            |
| E10 | **Talk to "you"; say "we" only for our own failure.**                                                                                                                                                                        | `web.auth.signInServerFault` is the model: "…that is a problem on our side, not with your email or password."                                                                                                                             |

### 1.2 Vietnamese

Address and register are already decided in design-guidelines ("bạn", never "quý
khách"); these rules make the rest checkable.

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                          | Before → after                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **Start from the Vietnamese sentence, not the English frame.** If the English has two parallel halves, the Vietnamese does not have to.                                                                                                                                                                                                                                                       | `web.landing.heroTitle` "Nói bằng ngôn ngữ của bạn. Được hiểu bằng ngôn ngữ của người nghe." → "Cứ nói tiếng của bạn. Người nghe vẫn hiểu bằng tiếng của họ." (`heroTitleEmphasis` must then be a substring, e.g. "vẫn hiểu")    |
| V2  | **Active voice. No "được … bởi", no "bị … bởi"; "được/bị" only when there is truly no actor.** Name the actor and make it the subject.                                                                                                                                                                                                                                                        | `web.conference.audioBlocked` "Âm thanh bị chặn bởi trình duyệt." → "Trình duyệt đang chặn âm thanh."; `common.billing.exhausted` "Mọi điều đã nói được lưu vào lịch sử." → "Những gì đã nói vẫn có trong Lịch sử."              |
| V3  | **No "việc …" nominalisations and no English articles ("một", "một cái", "các") unless the count matters.**                                                                                                                                                                                                                                                                                   | `common.billing.low` "Việc dịch vẫn tiếp tục cho tới khi hết." → "Bạn vẫn dịch được tới khi hết điểm."; `web.preferences.aiContext.empty` "Hãy tạo một cái để bắt đầu." → "Tạo ngữ cảnh đầu tiên để bắt đầu."                    |
| V4  | **"bạn" when the sentence needs a subject; drop it when it doesn't.** Never "quý khách", "vui lòng", "người dùng" for the reader. "Chúng tôi" only for our own failure or our own action.                                                                                                                                                                                                     | `web.auth.checkYourEmail` "Kiểm tra email của bạn, trong đó có liên kết để hoàn tất việc tạo tài khoản." → "Mở email chúng tôi vừa gửi và bấm liên kết trong đó để tạo xong tài khoản."                                          |
| V5  | **Errors: "Chưa … được" when retrying may work, "Không … được" when it won't; say what happened in plain words, then one fixed next step: "Bạn thử lại nhé."** The owner chose this friendly close for errors; keep it identical everywhere so it reads as one voice, and say the cause before it rather than a vague "Lâu quá". Where retrying cannot help, name the real next step instead. | `web.auth.tookTooLong` "Lâu quá — bạn thử lại nhé." → "Máy chủ phản hồi chậm. Bạn thử lại nhé."; `common.minutes.failed` "Không tạo được biên bản. Thử lại nhé." → "Chưa tạo được biên bản. Bạn thử lại nhé."                    |
| V6  | **Buttons: verb first, 1–3 words, no "Hãy", no "Nhấn để", no full stop; sentence case** (only the first letter and proper nouns capitalised).                                                                                                                                                                                                                                                 | `web.conference.enableAudio` "Nhấn để bật âm thanh" → "Bật âm thanh"; `web.conference.showRoster` "Xem danh sách" → "Hiện người tham gia"                                                                                        |
| V7  | **Punctuation: no em dash.** Use a comma, colon or full stop. No "+" or "/" for "và"/"hoặc". "…" is U+2026.                                                                                                                                                                                                                                                                                   | `web.translate.listening` "Đang nghe — bạn cứ nói" → "Đang nghe, bạn cứ nói"; `web.conference.permissionDeniedHint` "camera + micro" → "camera và micro"; `mobile.settings.audio.voiceProcessingHint` "Bật/tắt" → "Bật hoặc tắt" |
| V8  | **Old-style tone placement, the majority form in the file:** xoá, huỷ, tuỳ, hoà, khoá.                                                                                                                                                                                                                                                                                                        | `web.team.delete` "Xóa nhóm" → "Xoá nhóm"; `web.team.cancel` "Hủy" → "Huỷ"; `mobile.settings.sync.resetBody` "tùy chọn" → "tuỳ chọn"                                                                                             |
| V9  | **Vietnamese words, not English loanwords**, for every term in §2. Only brands, file formats and "Pro" stay English.                                                                                                                                                                                                                                                                          | `web.history.copyTranscript` "Sao chép transcript" → "Sao chép bản chép lời"; `web.conference.copyInviteLink` "Sao chép link mời" → "Sao chép liên kết mời"; `common.billing.creditAmount` "{credits} credit" → "{credits} điểm" |
| V10 | **Length:** a button may run ~1.3× the English, not more; check 320 px. Cut words before shrinking type.                                                                                                                                                                                                                                                                                      | `web.translate.speakTranslationAria` "Đọc bản dịch thành tiếng" stays an aria label; the visible `speakTranslation` "Đọc bản dịch" is the button.                                                                                |

### 1.3 Chinese (Simplified, zh-CN)

| #   | Rule                                                                                                                                                                                                                                                                             | Before → after                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z1  | **你, never 您.** "请" only in front of a next step, once per string. Do not soften a plain fact with 请.                                                                                                                                                                        | `web.history.renameTooLong` "标题请控制在 {max} 个字符以内。" → "标题最多 {max} 个字。"                                                                                                                                                                                                       |
| Z2  | **No 欧化中文:** no 被 unless the event is adverse and has no actor; no 进行 / 对…进行; no "一个" article; no 的的 chains (max one 的 per clause).                                                                                                                               | `web.invite.used` "此邀请已被使用。" → "这个邀请已经用过了。"; `web.translate.minutesNeedsTurns` "先进行一段对话吧，现在还没有可总结的内容。" → "还没有可总结的内容，先开始对话吧。"; `common.billing.checkoutClosed` "Chatofy 是一个非商业的毕业设计项目" → "Chatofy 是非商业的毕业设计项目" |
| Z3  | **Say it the Chinese way, not the English way.** Topic first, short clauses, no 所以/因为 where a comma does the work.                                                                                                                                                           | `web.landing.heroTitle` "说你自己的语言，让对方用他们的语言听懂。" → "各说各的语言，照样听得懂。"; `common.billing.unavailable` "暂时无法核对你的点数，所以翻译没有开始。" → "暂时查不到你的点数，翻译没有开始。"                                                                             |
| Z4  | **Errors: 没能 + verb for an attempt that failed; 无法 for a standing inability; then 请重试 / 请稍后再试.**                                                                                                                                                                     | `web.glossary.createFailed` "无法创建术语表，请重试。" → "没能创建术语表，请重试。"; `web.auth.serverUnreachable` "无法连接服务器。" → "连不上服务器，请检查网络后重试。"                                                                                                                     |
| Z5  | **Full-width punctuation** （，。：；？！（）“”）; **no 破折号 ——** and no em dash at all (the webfont draws U+2014 as two Latin dashes); "…" single U+2026 on in-progress states.                                                                                               | `web.account.buyTopupCard` "{credits}，银行卡支付 — {price}" → "{credits}，银行卡付款 {price}"; `web.auth.panelBenefitLive` "实时听懂彼此——越南语、英语和中文。" → "越南语、英语、中文，实时听懂彼此。"                                                                                       |
| Z6  | **Spacing:** one half-width space between Chinese and Latin letters or digits ("1 点", "打开 Chatofy"); none next to full-width punctuation; text placeholders (`{name}`, `{language}`, `{term}`, `{setting}`) take no space, numeric ones (`{count}`, `{max}`, `{credits}`) do. | `web.workspace.sharedWithOnlyYou` "{name} 目前只有你一人" → "{name}目前只有你一个人"                                                                                                                                                                                                          |
| Z7  | **Buttons: verb first, 2–4 characters, no 。**; no 点按以 / 点击以.                                                                                                                                                                                                              | `web.conference.enableAudio` "点按以开启声音" → "打开声音"; `web.translate.speakTranslationAria` "大声朗读译文" → "朗读译文"                                                                                                                                                                  |
| Z8  | **这 in sentences; 此 only in labels of ≤ 6 characters.**                                                                                                                                                                                                                        | `web.invite.expired` "此邀请已过期，请索取新的邀请。" → "这个邀请已过期，请让对方重新邀请你。"                                                                                                                                                                                                |
| Z9  | **Measure words:** 位 for people, 条 for messages and terms, 段 for turns, 份 for minutes, 点 for credits.                                                                                                                                                                       | `web.team.memberCount` "{count} 名成员" → "{count} 位成员"; `web.glossary.termCount` "{count} 个术语" → "{count} 条术语"                                                                                                                                                                      |

---

## 2. Terminology

One term per concept per locale, used in every surface (web, mobile, extension, mail).
Sentence case: capitalise a term only where the sentence or label would capitalise any
word. The **Reject** column lists variants found in the current files — grep them away.

### Product surfaces and features

| Concept (en)                       | vi                    | zh              | Reject (found in files) / note                                                                                                                  |
| ---------------------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Translate (nav, verb)              | Dịch                  | 翻译            | —                                                                                                                                               |
| One-way translation (feature)      | Dịch một chiều        | 单向翻译        | en "One way", "Both ways" (`web.translate.modeOneWay`, `modeTwoWay`) → "One-way", "Two-way"                                                     |
| Two-way translation (feature)      | Dịch hai chiều        | 双向翻译        | —                                                                                                                                               |
| conversation (a translate session) | cuộc trò chuyện       | 对话            | vi "cuộc hội thoại", "hội thoại" (45 uses); zh 会话 (`web.auth.accountRequired`)                                                                |
| meeting (Chatofy video meeting)    | cuộc họp              | 会议            | en "room", "conference", "call" for our meeting; vi "phòng", "Hội nghị video", "cuộc gọi"; zh 会议室, 视频会议 as a title, 通话 for our meeting |
| Meetings (nav)                     | Cuộc họp              | 会议            | en `mobile.tabs.conference` "Conference" → "Meetings"                                                                                           |
| call (Meet / Zoom / Facebook only) | cuộc gọi              | 通话            | only for third-party calls                                                                                                                      |
| meeting code                       | mã cuộc họp           | 会议号          | vi "Mã phòng"; zh 会议室 ID, 会议代码                                                                                                           |
| invite link (meeting)              | liên kết mời          | 邀请链接        | vi "link mời", "link"                                                                                                                           |
| participant                        | người tham gia        | 参会者          | zh 发言者 for participants                                                                                                                      |
| lobby (meeting start page)         | trang cuộc họp        | 会议首页        | vi "sảnh"; zh 大厅                                                                                                                              |
| meeting chat                       | tin nhắn              | 聊天            | vi "Trò chuyện" as the panel name (clashes with conversation) → "Tin nhắn"                                                                      |
| minutes                            | biên bản              | 纪要            | zh 会议纪要 only where en says "Meeting minutes"; 摘要 is "summary"                                                                             |
| summary (section of minutes)       | tóm tắt               | 摘要            | —                                                                                                                                               |
| action items                       | việc cần làm          | 待办事项        | vi "đầu việc"                                                                                                                                   |
| transcript                         | bản chép lời          | 文字记录        | vi "bản ghi" (clashes with recording), "bản ghi chữ", "transcript"; zh bare 记录                                                                |
| recording (audio)                  | bản ghi âm            | 录音            | vi "dữ liệu ghi âm"                                                                                                                             |
| captions (live on-screen text)     | phụ đề                | 字幕            | en: "captions" on screen; "subtitles" only for the .srt download                                                                                |
| subtitles (.srt file)              | phụ đề                | 字幕            | —                                                                                                                                               |
| translation (the output text)      | bản dịch              | 译文            | —                                                                                                                                               |
| original (what was said)           | lời gốc               | 原文            | vi "chữ gốc", "câu gốc"; glossary column keeps "từ gốc"                                                                                         |
| voice (the reading voice)          | giọng đọc             | 音色            | vi "giọng" alone, "Giọng dịch"; zh 声音, 语音 for the voice                                                                                     |
| read aloud / speak (verb)          | đọc                   | 朗读            | vi "đọc thành tiếng" only where "read on screen" could be meant; zh 大声朗读                                                                    |
| speaker (who said a turn)          | người nói             | 说话人          | zh 发言者                                                                                                                                       |
| turn (one stretch of speech)       | lượt nói              | 一段话 / 段     | zh 一轮, 发言                                                                                                                                   |
| Auto-detect (language)             | Tự nhận diện          | 自动检测        | vi "Tự động nhận biết", "Tính năng tự nhận diện"; zh 自动识别 (识别 is banned pipeline vocabulary)                                              |
| AI Context                         | Ngữ cảnh AI           | AI 语境         | vi/zh "AI Context" (9 uses, team strings); zh 背景 (means caption background). Inside the context editor the short "ngữ cảnh" / "语境" is fine  |
| glossary                           | bảng thuật ngữ        | 术语表          | vi "Bộ từ điển" (`web.preferences.aiContext.glossaryLink`)                                                                                      |
| term (glossary entry)              | thuật ngữ             | 术语            | —                                                                                                                                               |
| preferred rendering (in a context) | cách dịch mong muốn   | 指定译法        | —                                                                                                                                               |
| register (formal / casual)         | văn phong             | 语气            | zh 语体 is linguistics jargon                                                                                                                   |
| History                            | Lịch sử               | 历史记录        | zh 历史 alone (`web.chrome.tabHistory`)                                                                                                         |
| Library (nav group)                | Thư viện              | 资料库          | —                                                                                                                                               |
| extension                          | tiện ích              | 扩展程序        | zh 扩展 alone; vi "extension"                                                                                                                   |
| Chrome Web Store                   | Chrome Web Store      | Chrome 应用商店 | —                                                                                                                                               |
| phone app                          | ứng dụng điện thoại   | 手机 App        | zh 手机应用                                                                                                                                     |
| Settings                           | Cài đặt               | 设置            | zh 偏好设置 → 设置                                                                                                                              |
| preferences                        | tuỳ chọn              | 设置            | —                                                                                                                                               |
| microphone                         | micro                 | 麦克风          | vi "micrô"                                                                                                                                      |
| mute / unmute                      | tắt micro / bật micro | 静音 / 取消静音 | zh 关闭麦克风 for mute                                                                                                                          |
| camera                             | camera                | 摄像头          | —                                                                                                                                               |
| echo cancellation                  | khử vọng              | 回声消除        | —                                                                                                                                               |
| headphones                         | tai nghe              | 耳机            | —                                                                                                                                               |

### Account

| Concept (en)             | vi                        | zh       | Reject / note                                      |
| ------------------------ | ------------------------- | -------- | -------------------------------------------------- |
| account                  | tài khoản                 | 账号     | zh 账户 (33 uses; it reads as a bank account)      |
| sign in                  | đăng nhập                 | 登录     | —                                                  |
| create account / sign up | tạo tài khoản             | 注册     | zh 创建账户                                        |
| sign out                 | đăng xuất                 | 退出登录 | —                                                  |
| password                 | mật khẩu                  | 密码     | —                                                  |
| forgot password          | quên mật khẩu             | 忘记密码 | —                                                  |
| reset password           | đặt lại mật khẩu          | 重置密码 | —                                                  |
| reset link               | liên kết đặt lại mật khẩu | 重置链接 | —                                                  |
| verify email             | xác minh email            | 验证邮箱 | vi "xác nhận email" (`mobile.auth.verifyDone`)     |
| email (address)          | email                     | 邮箱     | zh 邮箱地址 only where the address itself is meant |
| link (generic)           | liên kết                  | 链接     | vi "link", "đường liên kết"                        |
| profile photo            | ảnh đại diện              | 头像     | vi "ảnh" alone in labels                           |
| signed in (session)      | đang đăng nhập            | 已登录   | vi "phiên đăng nhập … còn hiệu lực"; zh 登录状态   |

### Teams

| Concept (en)         | vi                  | zh       | Reject / note |
| -------------------- | ------------------- | -------- | ------------- |
| team                 | nhóm                | 团队     | —             |
| workspace            | không gian làm việc | 工作区   | —             |
| personal (workspace) | cá nhân             | 个人     | —             |
| owner                | chủ nhóm            | 所有者   | —             |
| admin                | quản trị viên       | 管理员   | —             |
| member               | thành viên          | 成员     | —             |
| invite (noun / verb) | lời mời / mời       | 邀请     | —             |
| withdraw an invite   | thu hồi             | 撤回     | vi "rút lại"  |
| leave team           | rời nhóm            | 退出团队 | —             |

### Credits and billing

| Concept (en)               | vi                             | zh                     | Reject / note                                                                                                                                     |
| -------------------------- | ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| credit(s)                  | điểm                           | 点数 (count: "{n} 点") | vi "credit", "Credit" (93 uses); zh 额度 (`web.invite.whatJoiningMeans`, `web.team.noneHint`). "Free allowance" → vi "điểm miễn phí", zh 免费点数 |
| plan                       | gói                            | 套餐                   | —                                                                                                                                                 |
| Free (plan)                | Miễn phí                       | 免费版                 | —                                                                                                                                                 |
| Pro (plan)                 | Pro                            | Pro                    | never translated                                                                                                                                  |
| top-up                     | nạp thêm (noun: điểm nạp thêm) | 充值 (noun: 充值点数)  | vi "gói nạp thêm", "Credit nạp thêm"                                                                                                              |
| subscription (card)        | thuê bao                       | 订阅                   | —                                                                                                                                                 |
| VietQR pass (30 days)      | gói 30 ngày qua VietQR         | VietQR 30 天套餐       | zh 通行证                                                                                                                                         |
| billing (settings section) | Điểm và gói                    | 点数与套餐             | vi "Thanh toán"; zh 账单 — the section holds credits, plan and usage                                                                              |
| usage (credit ledger)      | biến động điểm                 | 点数明细               | vi "Lịch sử sử dụng" (clashes with History); zh 使用记录                                                                                          |
| checkout / pay             | thanh toán                     | 付款                   | zh 支付, 支付页面 → 付款, 付款页面; "buy credits" stays 购买点数                                                                                  |
| pricing (page)             | Bảng giá                       | 价格                   | —                                                                                                                                                 |
| test mode                  | chế độ thử                     | 测试模式               | —                                                                                                                                                 |

### Language names

Language names go through `common.languageName.<code>` (design-guidelines § Under three
languages); codes are never shown. `common.language.*` are endonyms for the interface
switcher and do not change.

| en                                           | vi (mid-sentence lower-case "tiếng") | zh                  |
| -------------------------------------------- | ------------------------------------ | ------------------- |
| Vietnamese                                   | Tiếng Việt                           | 越南语              |
| English                                      | Tiếng Anh                            | 英语                |
| Chinese                                      | Tiếng Trung                          | 中文                |
| source language / target language (glossary) | ngôn ngữ gốc / ngôn ngữ dịch         | 原文语言 / 译文语言 |

vi rejects "ngôn ngữ nguồn", "ngôn ngữ đích"; zh rejects 源语言, 目标语言 — both are
translator jargon.

---

## 3. Invariants writers must not break

### Mechanical

- **Keys never change.** `MessageKey` is derived from `en.ts`; `vi.ts` and `zh.ts` are
  typed `Messages`. Rewrite values only.
- **`{placeholder}` names are copied verbatim**, the same set in every locale. Words
  around a placeholder may move; the placeholder may not be renamed, dropped or added.
- **Singular/plural pairs stay pairs** (`…One` keys such as `common.billing.creditAmountOne`,
  `web.team.memberCountOne`).
- **`web.landing.heroTitleEmphasis` is a substring of `web.landing.heroTitle`** in the
  same locale (`apps/web/src/components/marketing/hero.tsx`), or empty (zh today).
- **The landing ban list still applies:** `apps/web/src/components/marketing/landing-copy.spec.ts`
  checks every locale for pipeline words, engine names and language codes.
- **zh never contains U+2014** (Z5).
- **Specs that assert copy are updated with the copy**, never loosened.

### Untranslated

- **Chatofy** — never translated, transliterated or declined.
- **Pro**, **VietQR**, **Google**, **Google Meet**, **Meet**, **Zoom**, **Facebook**,
  **Chrome**, **Chrome Web Store** (zh: Chrome 应用商店), **Markdown**, **JPEG/PNG/WebP**,
  file extensions (.txt, .md, .srt).
- **Landing demo lines keep each speaker's own language in every locale**:
  `web.landing.demoSourceOne` / `demoTargetOne` / `demoSourceTwo` / `demoTargetTwo`,
  `mockTwoWaySourceOne/TargetOne/SourceTwo/TargetTwo`, `mockOneWaySource/Target`,
  `mockTermOne/Two/ThreeSource/Target`. They are identical across `en`, `vi`, `zh`; a
  rewrite may improve them only in their own language and copies the result to all
  three files.
- **Endonyms** `common.language.vietnamese/english/chinese` stay "Tiếng Việt", "English", "中文".

### Product claims (meaning fixed; wording free)

Languages and modes

- Three languages: Vietnamese, English, Chinese.
- Auto-detect tells Vietnamese and English apart; for Chinese the reader picks the language before starting.
- Two-way (face to face) works between Vietnamese and English only, "for now".
- No button to hold; a turn ends at a pause; the translation plays about a second later.
- The translation is spoken aloud; the text stays on screen.

Recording and privacy

- The translation service receives text only, never audio.
- A finished conversation is saved to History with its recording; it can be played back and read again.
- The recording sits at an unguessable address that anyone with the link can open; the link is what keeps it private.
- Pausing a conversation pauses the recording; speech while paused is neither recorded nor translated.
- Deleting a conversation deletes its recording.
- Meetings store speech and messages as text, never audio; everyone who took part can read them; they cannot be deleted yet.
- Extension disclosure (`popup/index.html` `#consent`): it records the meeting's audio, sends it to the Chatofy server, other participants are not told by their own client, and a loudspeaker leaks the translation into the meeting. Exempt from shortening (design-guidelines § Copy register).

Meetings, extension, phone

- Anyone with an account joins from the link, nothing to install; no account, no join (yet).
- Every participant hears and reads others in their own language; chat messages arrive in the recipient's language; minutes (summary, decisions, action items) from the end screen.
- Extension: Chrome, two-way inside Meet, Zoom (web client only, not the desktop app) and Facebook calls; not in the Chrome Web Store yet.
- Phone app: in development, can join meetings, not in the app stores.
- Echo cancellation is on by default; with headphones it can be turned off, and then the microphone pauses while a translation plays.

Credits and pricing

- Every account gets free credits each month; unused credits do not carry over.
- 1 credit = 1 minute of translated captions; 2 with the translation spoken aloud; minutes cost 3 credits each; each extra meeting language adds the same again.
- Pro: credits per cycle, reset when the next cycle starts; by card renews monthly, by VietQR lasts 30 days and does not renew.
- Top-ups never expire and are spent after plan credits.
- Trying it needs a microphone and an account, no card (`web.landing.ctaBody`).
- Checkout is not open to the public: Chatofy is a non-commercial thesis project and only its owner can buy.
- Test mode charges no real money.
- When credits run out, translation stops and everything said so far is saved to History; at least 1 credit is needed to start.

Teams and account

- A team shares only glossaries and AI Contexts; history, meetings and credits stay personal.
- An invite link works once and expires in 7 days; a team member's own creations stay in the team after they leave or are removed; deleting a team deletes its glossaries and AI Contexts for everyone.
- Changing the password signs out other devices and closes any open translation or meeting; this browser stays signed in.
- The interface language is also the language of the emails Chatofy sends.
