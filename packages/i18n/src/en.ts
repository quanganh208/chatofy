/**
 * English, and the shape every other locale is measured against.
 *
 * `as const` is load-bearing: `MessageKey` is derived from these keys, so a locale
 * that forgets one does not compile. That is the same parity-by-construction the
 * repo already trusts between `tokens.ts` and the stylesheets — except here `tsc`
 * IS the spec, and no test has to be written or maintained to enforce it.
 *
 * ## Namespaces
 *
 * `common.*` is vocabulary a second surface could want — theme labels, language
 * names. Nothing there may assume a page exists.
 *
 * `web.*` is this app, split by surface: `web.chrome.*`, `web.auth.*`,
 * `web.translate.*`, and later `web.landing.*`, `web.app.*`.
 *
 * ## Naming
 *
 * A key names WHAT IS SAID, never where it sits. `web.auth.passwordTooShort`
 * survives the control moving to another card; `web.auth.card3Line2` does not.
 *
 * ## What does not belong here
 *
 * Copy that names the pipeline. `docs/design-guidelines.md` § Copy register is the
 * authority and it governs each locale independently — a Vietnamese string is
 * reviewed against the rule, not against how literally it renders the English.
 */
export const en = {
  // ---- common: vocabulary a second surface could adopt unchanged ----
  // Navigation labels both apps use for the same destination.
  'common.nav.translate': 'Translate',
  'common.nav.settings': 'Settings',
  'common.nav.meetings': 'Meetings',
  'common.theme.light': 'Light',
  'common.theme.dark': 'Dark',
  'common.theme.system': 'Match system',
  'common.theme.label': 'Color theme',
  // Account preferences: one copy per account, shared by every app and device.
  'common.preferences.title': 'Your preferences',
  'common.preferences.syncNote': 'Synced across your devices',
  'common.preferences.saving': 'Saving…',
  'common.preferences.saved': 'Saved',
  'common.preferences.saveRetrying': 'Couldn’t save. Retrying…',
  'common.preferences.saveRefused': 'Couldn’t save that change',
  'common.preferences.reset': 'Reset to defaults',
  'common.preferences.resetPending': 'Resetting…',
  'common.preferences.resetNote':
    'Theme, languages, voices, display and meeting settings go back to their defaults on all your devices. Your AI Contexts, glossaries and history stay.',
  'common.preferences.resetFailed': 'Couldn’t reset. Check your connection and try again.',
  'common.preferences.resetDone': 'Preferences reset',
  // Mic processing: named as Saydi names them, because that is what people compare.
  'common.audio.title': 'Audio settings',
  'common.audio.echoCancellation': 'Echo cancellation',
  'common.audio.noiseSuppression': 'Noise suppression',
  'common.audio.autoGainControl': 'Automatic gain control',
  'common.audio.recommendation': 'Best off with headphones. Can stay on with external speakers.',
  'common.language.vietnamese': 'Tiếng Việt',
  'common.language.english': 'English',
  'common.language.chinese': '中文',
  'common.language.label': 'Language',

  // ---- common.languageName: a registry language's name in THIS locale ----
  //
  // Keyed by code rather than by pair: a history row or a glossary column names
  // one language at a time, and
  // keying by code is what makes adding a language a data change here rather
  // than a new pair of keys. Distinct from `common.language.*`, which names the
  // INTERFACE locale and reads identically regardless of which two languages a
  // conversation is between.
  'common.languageName.vi': 'Vietnamese',
  'common.languageName.en': 'English',
  'common.languageName.zh': 'Chinese',

  // ---- common.auth: the sign-in words web and mobile both show ----
  'common.auth.signOut': 'Sign out',
  'common.auth.signIn': 'Sign in',
  'common.auth.signingIn': 'Signing in…',
  'common.auth.email': 'Email',
  'common.auth.password': 'Password',

  // ---- common.conference: the meeting words web and mobile both show ----
  //
  // One key per string the two apps say identically, so they cannot drift apart:
  // they did, while each kept its own copy. A string that names something only one
  // platform has stays under `web.conference.*` or `mobile.conference.*` — the
  // permission hint points at a browser on one and the Settings app on the other.
  // `i18n-shared-keys.spec.ts` fails when a web key and a mobile key say the same
  // thing again.
  'common.conference.lobbyTitle': 'Video meetings',
  'common.conference.create': 'New meeting',
  'common.conference.join': 'Join meeting',
  'common.conference.yourName': 'Your name',
  'common.conference.yourNamePlaceholder': 'How others see you',
  'common.conference.roomId': 'Meeting code',
  'common.conference.roomIdPlaceholder': 'Enter a meeting code',
  'common.conference.sourceLanguage': 'Your language',
  'common.conference.start': 'Start',
  'common.conference.leave': 'Leave',
  'common.conference.waiting': 'Waiting for others to join…',
  'common.conference.connecting': 'Connecting…',
  'common.conference.you': 'You',
  // The translated voice: what others hear this speaker's translation in.
  'common.conference.translatedVoice': 'Translation voice',
  'common.conference.translatedVoiceHint': 'Others hear your translation in this voice.',
  'common.conference.voiceFemale': 'Female',
  'common.conference.voiceMale': 'Male',
  'common.conference.muteMic': 'Mute microphone',
  'common.conference.unmuteMic': 'Unmute microphone',
  'common.conference.disableCamera': 'Turn off camera',
  'common.conference.enableCamera': 'Turn on camera',
  'common.conference.participants': 'Participants',
  'common.conference.cameraOff': 'Camera off',
  'common.conference.rosterTitle': 'In this meeting',
  'common.conference.hideRoster': 'Hide participants',
  // Flat side region — ghost/outline controls only; Leave stays the one accent control.
  'common.conference.chatTitle': 'Chat',
  'common.conference.chatPlaceholder': 'Type a message…',
  'common.conference.chatSend': 'Send',
  'common.conference.chatEmpty': 'No messages yet.',
  'common.conference.permissionDenied': 'Chatofy needs your camera and microphone.',
  'common.conference.permissionDeniedAudioOnly': 'No camera access. Joining with audio only.',
  'common.conference.disconnected': 'Connection lost.',
  'common.conference.disconnectedHint': 'You’re disconnected from the meeting. Go back to rejoin.',
  'common.conference.backToLobby': 'Back to lobby',
  'common.conference.errorGeneric': 'Something went wrong. Try again.',
  // Quiet readout when the speaker's translation ended for good mid-call.
  'common.conference.translationEnded':
    'Your translation stopped, so others now hear you untranslated. Rejoin the meeting to restart it.',
  // The same readout, when the speaker ran out of credits.
  'common.conference.translationEndedNoCredits':
    'Your credits ran out, so translation stopped. Others now hear you untranslated.',
  // Badge on the local tile from [T1] (first audio frame) to [T2] (final subtitle).
  // Pure readout — no accent fill; Leave stays the one accent control.
  'common.conference.translating': 'Translating…',
  // Shown during a bounded auto-rejoin after an unexpected mid-call WS drop.
  // {attempt} is the current attempt number (1-based); {cap} is the maximum.
  // Leave stays the one accent control in this state too.
  'common.conference.reconnecting': 'Reconnecting ({attempt}/{cap})…',
  // A room exists only once POST /conference created it; the socket refuses a
  // join to an id it does not know, or to a meeting its owner ended.
  'common.conference.creating': 'Creating…',
  'common.conference.createFailed': 'Couldn’t create the meeting. Try again.',
  'common.conference.roomNotFound': 'This meeting doesn’t exist.',
  'common.conference.roomEnded': 'This meeting has ended.',
  // The minutes strings themselves are `common.minutes.*`: the end screen
  // renders the same minutes panel as /translate and history.
  'common.conference.endedTitle': 'Meeting ended',
  'common.conference.endedLoading': 'Loading the meeting…',
  'common.conference.endedNotFound': 'This meeting doesn’t exist, or you weren’t in it.',
  'common.conference.endedLoadFailed': 'Couldn’t load this meeting. Try again later.',
  'common.conference.summaryDuration': 'Duration',
  'common.conference.summaryLanguages': 'Languages',
  'common.conference.durationMinutes': '{minutes} min',
  'common.conference.durationHours': '{hours} h {minutes} min',
  'common.conference.durationUnknown': 'Not recorded',
  // A participant who joined without a name.
  'common.conference.guest': 'Guest',
  'common.conference.chatRateLimited': 'You’re sending too fast. Wait a few seconds.',
  'common.conference.chatNotSent': 'Message not sent. Try again.',

  // ---- common.billing: the credits words web and mobile both show ----
  // The section and block title on web Settings › Billing and mobile settings.
  'common.billing.title': 'Credits & plan',
  // Amounts are pre-formatted by the caller; English needs the singular by hand.
  'common.billing.creditAmount': '{credits} credits',
  'common.billing.creditAmountOne': '1 credit',
  'common.billing.totalCredits': 'Credits left',
  'common.billing.planCredits': 'Plan credits',
  'common.billing.planResetsOn': 'Resets on {date}',
  'common.billing.topupCredits': 'Top-up credits',
  'common.billing.topupNeverExpire': 'Never expire',
  'common.billing.currentPlan': 'Plan',
  'common.billing.planFree': 'Free',
  'common.billing.planPro': 'Pro',
  'common.billing.proSourcePolar': 'Card subscription, renews automatically',
  'common.billing.proSourceSepay': 'VietQR pass, ends {date}',
  'common.billing.loadFailed': 'Couldn’t load your credits. Try again.',
  // Turn refused at start: the balance is under one credit.
  'common.billing.startRefused': 'You need at least 1 credit to start translating.',
  // The balance ran out mid-conversation; what was said is kept.
  'common.billing.exhausted':
    'Your credits ran out, so translation stopped. Everything said so far is saved to History.',
  // A notice, not a failure: the conversation keeps going. {credits} is a
  // formatted `common.billing.creditAmount` string, e.g. "2 credits".
  'common.billing.low': 'About {credits} left. Translation keeps going until they run out.',
  'common.billing.unavailable':
    'We couldn’t check your credits, so translation didn’t start. Try again in a moment.',
  // Why buying is disabled for everyone but the owner.
  'common.billing.checkoutClosed':
    'Buying credits isn’t open to the public. Chatofy is a non-commercial thesis project, and only its owner can buy.',
  // Usage history rows.
  'common.billing.usageTitle': 'Usage',
  'common.billing.usageEmpty': 'Nothing used yet.',
  'common.billing.usageLoadFailed': 'Couldn’t load your usage. Try again.',
  'common.billing.usageKind.translate': 'Translation',
  'common.billing.usageKind.minutes': 'Meeting minutes',
  'common.billing.usageKind.grant': 'Credits added',
  'common.billing.usageKind.refund': 'Refund',
  'common.billing.usageKind.expire': 'Expired',
  'common.billing.usageKind.void': 'Removed',
  'common.billing.usageOpenConversation': 'Open conversation',

  // ---- common.minutes: LLM meeting minutes, on /translate, history and the meeting end screen ----
  'common.minutes.title': 'Meeting minutes',
  'common.minutes.generate': 'Generate minutes',
  'common.minutes.regenerate': 'Regenerate',
  'common.minutes.failed': 'Couldn’t generate minutes. Try again.',
  'common.minutes.summary': 'Summary',
  'common.minutes.keyPoints': 'Key points',
  'common.minutes.decisions': 'Decisions',
  'common.minutes.actionItems': 'Action items',
  'common.minutes.noActionItems': 'No action items.',
  'common.minutes.owner': 'Owner',
  'common.minutes.due': 'Due',
  'common.minutes.nothingSaid':
    'Nothing was said in this meeting, so there’s nothing to summarize.',

  'common.transcript': 'Transcript',

  // ---- web.chrome: the shell every route renders inside ----
  //
  // No brand key. "Chatofy" is a proper noun and reads identically in both
  // languages; putting it here would invite a translator to render it and buy
  // nothing in return.
  'web.chrome.skipToContent': 'Skip to content',
  'web.chrome.productNav': 'Product',
  // Two items, one per conversation mode: each is its own page.
  'web.chrome.navTranslate': 'One-way translation',
  'web.chrome.navTranslateTwoWay': 'Two-way translation',
  'web.chrome.navHistory': 'History',
  'web.chrome.navGlossary': 'Glossary',
  // Its own key rather than reusing `accountMenu`. That one names the avatar
  // control ("open your account menu"); this one names a destination, and a
  // locale may well want two different words.
  'web.chrome.navAccount': 'Account',
  'web.chrome.toggleSidebar': 'Show or hide sidebar',
  'web.chrome.sidebarWidth': 'Sidebar width',
  // The sidebar's two captions. Settings is not a group: it sits in the footer.
  'web.chrome.navGroupTranslate': 'Translate',
  'web.chrome.navGroupLibrary': 'Library',
  'web.chrome.breadcrumb': 'Breadcrumb',
  // The credit line under the name in the sidebar footer and the More sheet.
  // `{amount}` is already a counted phrase ("74 credits").
  'web.chrome.creditsLeft': '{amount} left',
  // The bottom tab bar below 768px. Short on purpose: four fit across a phone.
  'web.chrome.tabBar': 'Main',
  'web.chrome.tabHistory': 'History',
  'web.chrome.tabMore': 'More',
  'web.chrome.close': 'Close',
  // Toasts: the region's name, its close control, and the two actions a toast offers.
  'web.chrome.notifications': 'Notifications',
  'web.chrome.dismiss': 'Dismiss',
  'web.chrome.undo': 'Undo',
  'web.chrome.retry': 'Retry',
  // A destructive confirmation's title and its fallback line. `{action}` is the
  // caller's verb ("Delete"), `{name}` the thing it acts on.
  'web.chrome.confirmTitle': '{action}?',
  'web.chrome.confirmTitleNamed': '{action} “{name}”?',
  'web.chrome.confirmIrreversible': 'You can’t undo this.',
  'web.chrome.accountMenu': 'Account',
  'web.chrome.planAccountMenu': 'Account, {plan} plan',
  'web.chrome.planOpenBilling': 'Plan: {plan}. Open billing',
  'web.chrome.signedInAs': 'Signed in as',
  'web.chrome.getStarted': 'Get started',
  'web.chrome.openApp': 'Open Chatofy',

  // ---- web.auth ----
  'web.auth.name': 'Name',
  'web.auth.newPassword': 'New password',
  'web.auth.createAccount': 'Create account',
  'web.auth.createAccountHeading': 'Create your account',
  'web.auth.creatingAccount': 'Creating account…',
  'web.auth.haveAccountPrompt': 'Already have an account?',
  // Two of them, because they are two different strings in two places: the link
  // under the form is terse, the page it leads to is a question.
  'web.auth.forgotPasswordShort': 'Forgot password?',
  'web.auth.forgotPasswordLink': 'Forgot your password?',
  'web.auth.forgotPasswordBody':
    'Enter the email on your account and we’ll send a link to reset it.',
  'web.auth.backToSignIn': 'Back to sign in',
  'web.auth.resetPasswordHeading': 'Reset your password',
  'web.auth.resetPasswordSubmit': 'Reset password',
  'web.auth.resetting': 'Resetting…',
  'web.auth.chooseNewPassword': 'Choose a new password.',
  'web.auth.verifyEmailHeading': 'Verify your email',
  'web.auth.verifyEmailBody': 'Verify below to finish creating your account.',
  'web.auth.checkYourEmail': 'Check your email. We sent a link to finish creating your account.',
  'web.auth.resetLinkSent': 'If that email has an account, a reset link is on its way.',
  'web.auth.passwordTooShort': 'Password is too short',
  'web.auth.createFailed': 'Couldn’t create your account. Try again.',
  'web.auth.resetFailed': 'Couldn’t reset your password. Try again.',
  'web.auth.sendResetFailed': 'Couldn’t send the reset link. Try again.',
  'web.auth.verifyFailed': 'Couldn’t verify this link. Try again.',
  'web.auth.serverUnreachable': 'Can’t reach the server. Check your connection and try again.',
  'web.auth.tookTooLong': 'That took too long. Try again.',
  'web.auth.unexpectedResponse': 'Something went wrong on our end. Try again.',
  'web.auth.accountRequired':
    'You need an account to translate. Every conversation and transcript is saved to it.',
  'web.auth.showPassword': 'Show password',
  'web.auth.hidePassword': 'Hide password',
  'web.auth.passwordRequirement': 'At least {min} characters',
  'web.auth.panelTagline': 'Talk across languages, live.',
  'web.auth.panelBenefitLive':
    'Understand each other in real time, in Vietnamese, English and Chinese.',
  'web.auth.panelBenefitTranscript':
    'Every conversation is saved as a transcript you can read again.',
  'web.auth.panelBenefitMeetings':
    'Translated video meetings, plus captions in Meet, Zoom and Facebook calls.',
  'web.auth.orContinueWithEmail': 'or continue with email',
  'web.auth.continueWithGoogle': 'Continue with Google',
  'web.auth.credentialsRejected': 'That email and password don’t match. Try again.',
  'web.auth.sendResetLink': 'Send reset link',
  'web.auth.sending': 'Sending…',
  'web.auth.verifyEmailSubmit': 'Verify email',
  'web.auth.verifying': 'Verifying…',
  'web.auth.resetLinkMissingCode': 'This reset link is incomplete. Open it again from the email.',
  'web.auth.verifyLinkMissingCode':
    'This verification link is incomplete. Open it again from the email.',
  'web.auth.accountExists': 'An account with this email already exists. Sign in instead.',
  // The two `?error=` values `auth.ts` can produce, worded apart on purpose: one is
  // about this account and the other is a fault on our side.
  'web.auth.googleRefused':
    'Couldn’t sign in with that Google account. If you have a password for this email, sign in with it below.',
  'web.auth.signInServerFault':
    'Sign-in isn’t working right now. That’s a problem on our side, not with your email or password. Try again in a moment.',
  'web.auth.signInUnavailable':
    'Sign-in isn’t working right now. That’s a problem on our side, not with your account. Try again soon, or sign in with your password below.',
  // What the api answers with, in the reader's language. The wire carries a code;
  // these are the words. See `authMessageCodeSchema` in `@chatofy/types`.
  'web.auth.noticeVerified': 'Your account is ready. Sign in below to get started.',
  'web.auth.noticeReset': 'Password changed. Sign in with your new one.',

  // ---- web.meta: the browser tab, which is a string a person reads ----
  'web.meta.home': 'Chatofy — real-time voice translation for conversations and meetings',
  'web.meta.homeDescription':
    'Chatofy translates speech live between Vietnamese, English and Chinese: face to face, in video meetings, and inside Google Meet, Zoom and Facebook calls.',
  'web.meta.signIn': 'Sign in · Chatofy',
  'web.meta.register': 'Create account · Chatofy',
  'web.meta.verifyEmail': 'Verify email · Chatofy',
  'web.meta.forgotPassword': 'Forgot password · Chatofy',
  'web.meta.resetPassword': 'Reset password · Chatofy',
  'web.meta.translate': 'One-way translation · Chatofy',
  'web.meta.translateTwoWay': 'Two-way translation · Chatofy',
  'web.meta.history': 'History · Chatofy',
  'web.meta.pricing': 'Pricing · Chatofy',
  'web.meta.pricingDescription':
    'Chatofy plans: free credits every month, Pro, and top-ups that never expire. One credit is one minute of translated captions.',

  // ---- web.translate ----
  'web.translate.startTranslating': 'Start translating',
  'web.translate.startConversation': 'Start conversation',
  'web.translate.end': 'End',
  'web.translate.pause': 'Pause',
  'web.translate.resume': 'Resume',
  'web.translate.notListening': 'Not listening',
  'web.translate.connecting': 'Connecting…',
  'web.translate.reconnecting': 'Reconnecting…',
  'web.translate.listening': 'Listening. Start talking.',
  'web.translate.hearingYou': 'Hearing you…',
  'web.translate.translating': 'Translating…',
  'web.translate.speaking': 'Speaking',
  // The microphone is off and the conversation is not. Says the state, not the
  // action — the button beside it is what offers the way out.
  'web.translate.paused': 'Paused',
  // The microphone is already off; what is left is the last translation being
  // spoken. Named for what it is waiting on, so the wait does not read as a hang.
  'web.translate.finishing': 'Playing the last translation…',
  // Static, and read once. The number beside it changes every second, and a
  // screen reader announcing it every second would drown out the transcript.
  'web.translate.elapsedLabel': 'Time since this conversation started',
  'web.translate.transcriptEmpty': 'Nothing yet. Start a conversation and both sides show up here.',
  // One per panel, because with the two panels side by side a single sentence
  // spanning both says nothing about which column is which. `transcriptEmpty`
  // above is still the wording where there is only one column to explain.
  'web.translate.panelSourceEmpty': 'What you say shows up here.',
  'web.translate.panelTargetEmpty': 'The translation shows up here.',
  'web.translate.speakTranslation': 'Read aloud',
  'web.translate.speakTranslationAria': 'Read the translation aloud',
  // The panel header carries a MARK, not a control, so the state has to be in
  // words: an icon that differs only by a slash says nothing to a screen reader.
  'web.translate.speakOn': 'on',
  'web.translate.speakOff': 'off',
  // Why the toggle is refusing, said as the thing to do instead. The server skips
  // synthesis outright when this is off and decides that once, at session start,
  // so mid-conversation there is nothing to change.
  'web.translate.speakLocked': 'Set this before you start',
  'web.translate.voice': 'Voice',
  'web.translate.voiceFemale': 'Female',
  'web.translate.voiceMale': 'Male',
  // Widens the list below to every voice the backend published, across both
  // genders. Not itself a gender — it names no default, so choosing a voice by
  // name is the only thing to do here.
  'web.translate.voiceAll': 'All',
  'web.translate.voiceGender': 'Voice gender',
  'web.translate.speed': 'Speed',
  'web.translate.volume': 'Volume',
  'web.translate.volumeAria': 'Playback volume',
  // Scroll-region names. Two regions exist under `split`, and a screen reader
  // moving between them needs each to say which half of the conversation it holds.
  'web.translate.paneSource': 'Original',
  'web.translate.paneTarget': 'Translation',
  // ---- the display panel ----
  // Named after what the reader sees, never after the field. `displayMode` picks
  // how many streams there are; `paneLayout` only exists once there are two.
  'web.translate.speakerLabels': 'Speaker labels',
  'web.translate.translationOnly': 'Translation only',
  'web.translate.freeScroll': 'Free scroll',
  'web.translate.displayMode': 'Display mode',
  'web.translate.displayModeSplit': 'Split',
  'web.translate.displayModeList': 'List',
  'web.translate.textSize': 'Text size',
  'web.translate.paneLayout': 'Layout',
  'web.translate.paneLayoutRow': 'Row',
  'web.translate.paneLayoutColumn': 'Column',
  // Which end of the transcript the newest turn sits at, and the two headings the
  // arrangement tab groups its rows under.
  'web.translate.transcriptOrder': 'Transcript order',
  'web.translate.transcriptOrderOldest': 'Oldest first',
  'web.translate.transcriptOrderNewest': 'Newest first',
  'web.translate.displayGroupTranscript': 'Transcript',
  'web.translate.displayGroupPresentation': 'Presentation',
  // Two gears' worth of settings, named for what each is about. They were one,
  // which meant the icon at the bottom covered both the voice and the page layout
  // while the speaker in the panel header configured nothing.
  'web.translate.voiceSettings': 'Voice settings',
  'web.translate.voiceSettingsFor': 'Voice for {language}',
  'web.translate.displaySettings': 'Display settings',
  // The dock's visible button words. Each is contained in that button's accessible
  // name, so what a voice-control user reads is what they can say.
  'web.translate.dockDisplay': 'Display',
  'web.translate.dockCaptions': 'Captions',
  // ---- fullscreen, the caption window, and the reader's appearance ----
  // One button opens the floating captions; it is called picture-in-picture
  // where the browser can keep it on top and a mini window where it cannot.
  // Preset names are spoken by a screen reader in place of a swatch, so they
  // name the colour rather than its hex.
  'web.translate.fullscreen': 'Full screen',
  'web.translate.fullscreenExit': 'Exit full screen',
  'web.translate.pip': 'Picture-in-picture',
  'web.translate.miniWindow': 'Mini window',
  'web.translate.captionWindowBlocked':
    'The browser blocked the mini window. Allow pop-ups for this site and try again.',
  'web.translate.captionWindowFailed': 'Picture-in-picture didn’t open. Try again.',
  'web.translate.captionWindowTitle': 'Chatofy captions',
  'web.translate.captionStage': 'Captions',
  'web.translate.displayTabLayout': 'Arrangement',
  'web.translate.displayTabAppearance': 'Text & color',
  'web.translate.displayTabStage': 'Captions',
  'web.translate.colorTarget': 'Translation color',
  'web.translate.colorSource': 'Original color',
  'web.translate.colorSpeaker': 'Speaker name color',
  'web.translate.colorTime': 'Time color',
  'web.translate.background': 'Background',
  'web.translate.backgroundOpacity': 'Background opacity',
  'web.translate.colorDefault': 'Default',
  'web.translate.colorCustom': 'Custom color',
  'web.translate.colorHex': 'Hex code',
  'web.translate.colorPreset.muted': 'Stone',
  'web.translate.colorPreset.amber': 'Amber',
  'web.translate.colorPreset.yellow': 'Yellow',
  'web.translate.colorPreset.rose': 'Rose',
  'web.translate.colorPreset.violet': 'Violet',
  'web.translate.colorPreset.sky': 'Sky',
  'web.translate.colorPreset.emerald': 'Emerald',
  'web.translate.colorPreset.cream': 'Cream',
  'web.translate.colorPreset.mist': 'Mist',
  'web.translate.colorPreset.sage': 'Sage',
  'web.translate.colorPreset.black': 'Black',
  'web.translate.colorPreset.navy': 'Navy',
  'web.translate.colorPreset.white': 'White',
  'web.translate.contrastRatio': 'Contrast {ratio}:1',
  'web.translate.contrastLow': 'Hard to read: {ratio}:1 is under the 4.5:1 minimum.',
  'web.translate.contrastOtherLight': 'Hard to read in the light theme.',
  'web.translate.contrastOtherDark': 'Hard to read in the dark theme.',
  'web.translate.font': 'Font',
  'web.translate.fontSans': 'Sans',
  'web.translate.fontSerif': 'Serif',
  'web.translate.fontMono': 'Mono',
  'web.translate.fontLegible': 'Legible',
  'web.translate.lineHeight': 'Line spacing',
  'web.translate.lineHeightCompact': 'Compact',
  'web.translate.lineHeightNormal': 'Normal',
  'web.translate.lineHeightRelaxed': 'Relaxed',
  'web.translate.targetWeight': 'Translation weight',
  'web.translate.targetWeightRegular': 'Regular',
  'web.translate.targetWeightMedium': 'Medium',
  'web.translate.targetWeightSemibold': 'Semibold',
  'web.translate.targetWeightBold': 'Bold',
  'web.translate.align': 'Alignment',
  'web.translate.alignStart': 'Left',
  'web.translate.alignCenter': 'Center',
  'web.translate.showTime': 'Show time',
  'web.translate.appearanceReset': 'Reset to default',
  'web.translate.stageFollowPage': 'Same as page',
  // The context picker on /translate. Locked while a conversation runs, like every
  // other setting that travels on `client.session.start`.
  'web.translate.context': 'AI Context',
  'web.translate.contextNone': 'None',
  'web.translate.contextLocked': 'You can change the AI Context once this conversation ends.',
  // Said beside Start, not instead of it: a stored selection that has not yet
  // resolved must not let a conversation start silently unhinted.
  'web.translate.contextLoading': 'Loading your AI Context…',
  'web.translate.contextUnavailable':
    'Couldn’t load your AI Context. If you start now, it won’t be used.',
  'web.translate.registerNeutral': 'Neutral',
  'web.translate.registerFormal': 'Formal',
  'web.translate.registerCasual': 'Casual',
  'web.translate.languagePair': 'Languages',
  'web.translate.languagePairSource': 'Source',
  'web.translate.languagePairTarget': 'Translation',
  // Interpolated, because the accessible name has to say what pressing it DOES:
  // "swap" alone is a verb with no object.
  'web.translate.languagePairSwap': 'Swap languages: translate {from} into {to}',
  // The same button while the source is Auto-detect: there is no source language
  // to trade places with, so the name says why it is off instead.
  'web.translate.languagePairSwapDetect': 'Swap languages: not available with Auto-detect',
  // The one-way source picker's first entry: leave the spoken language to be
  // recognised, turn by turn, and translate it into the chosen translation language.
  'web.translate.autoDetect': 'Auto-detect',
  // A readout under the source header, never a control: which way the running
  // conversation actually translates, as the server answered it.
  'web.translate.modeTwoWay': 'Two-way',
  'web.translate.modeOneWay': 'One-way',
  // Beside a language the two-way page lists but cannot run: its turns cannot be
  // told apart from the other language's yet.
  'web.translate.twoWayLanguageUnavailable': 'not in two-way yet',
  // The accessible name beside a turn's short language tag.
  'web.translate.turnLanguage': 'Spoken in {language}',
  // A two-way conversation the service is running one way for now. Says what the
  // reader gets instead, so a reply that is not translated is not a surprise.
  'web.translate.twoWayUnavailable':
    'Translating one way for now, {from} into {to}. Anything said in {to} won’t be translated.',
  'web.translate.detectUnavailable':
    'Auto-detect isn’t available right now. Choose the spoken language to continue.',
  'web.translate.detectBusy':
    'Auto-detect is busy. Try again in a moment, or choose the spoken language.',
  'web.translate.voiceDefault': 'Default',
  'web.translate.voiceListFailed':
    'Couldn’t load the voice list. Your voice gender choice still applies.',
  // On a turn whose translation was never played: the playback queue passed its
  // ceiling and dropped it, or the stall watchdog released it. Says what is
  // missing (the audio) and what is not (the text, which is right above it).
  //
  // The only thing that reports a dropped turn. A paragraph under the speed
  // control used to warn ahead of time that rates below 1× can cost whole turns;
  // it was removed as redundant, because this marks the turn that was actually
  // lost, at the moment it is lost, on the row it belongs to.
  'web.translate.turnUnheard': 'Not read aloud. Playback fell behind.',
  'web.translate.transcriptListening':
    'Listening. The conversation shows up here as it’s translated.',
  'web.translate.transcriptAttribution': 'You can mark who said each turn.',
  // ---- the repaired line, and the words underneath it ----
  // Shown only on a turn that was repaired. Named for what it reveals — the
  // recognizer's own output — rather than "original", which a reader could take
  // to mean the audio, or the other language.
  'web.translate.sourceRawToggle': 'As heard',
  'web.translate.sourceRawLabel': 'Heard:',
  // ---- who spoke ----
  // The fallback chip asks rather than naming anybody: a turn nobody attributed
  // must never read as a person, in any language.
  'web.translate.speakerUnknown': 'Who spoke?',
  'web.translate.speakerAsk': 'Mark who spoke',
  // A turn the acoustic layer heard and has not placed yet. Distinct words from
  // `speakerUnknown`, because the two chips promise different things — this one
  // owes an answer and that one does not — and styling alone carries that
  // difference to sighted readers only.
  'web.translate.speakerPending': 'Working out who…',
  'web.translate.speakerPendingAria': 'Still working out who spoke. Mark it yourself, or wait.',
  'web.translate.speakerChange': 'Said by {name}. Change.',
  'web.translate.speakerNobody': 'Nobody',
  'web.translate.speakerAdd': 'Add person',
  // The chip's second face, holding what a picker cannot do. Named for the two
  // operations rather than "Manage people", which says a surface exists without
  // saying what it is for.
  'web.translate.speakerManage': 'Rename or remove',
  'web.translate.speakerManageDone': 'Done',
  // Interpolated with the number the roster assigns, so the placeholder name a
  // person then edits is in their language rather than always English.
  'web.translate.speakerDefault': 'Speaker {number}',
  'web.translate.speakerNameFor': 'Name for {name}',
  'web.translate.speakerRemove': 'Remove {name}',
  // Removal is refused while a turn still names somebody, and says so rather than
  // disappearing — the way out is to change that turn.
  'web.translate.speakerRemoveBlocked': '{name} is named on a turn. Change that turn first.',
  'web.translate.speakerRemoveBlockedAria': 'Can’t remove {name}: they’re named on a turn',
  'web.translate.speakerLimit': 'Up to {max} people',
  'web.translate.attributionStats':
    '{total} turns · {automatic} named automatically · {confirmed} marked by you · {fallback} left unmarked',
  'web.translate.attributionSuggestions':
    'suggestions: {agreed} agreed, {changed} changed, {unreviewed} not reviewed',
  'web.translate.micLevel': 'Microphone level',
  // Said in the reader's language, and each one ends in the action that clears it.
  // The browser's own wording is a `DOMException` message — English, and different
  // between versions. `lib/open-microphone.ts` is what maps a fault onto these.
  'web.translate.micNotFound': 'No microphone found. Plug one in to start a conversation.',
  'web.translate.micDenied':
    'The browser is blocking the microphone. Allow it from the address bar to start a conversation.',
  'web.translate.micBusy': 'Another app is using the microphone. Close it, then start again.',
  'web.translate.serviceUnreachable':
    'Can’t reach the translation service, so conversations can’t start yet. Try again soon.',
  'web.translate.micFailed': 'Couldn’t start the microphone. Try again.',
  'web.translate.micPausedDuringPlayback': 'Microphone paused while the translation plays',

  // A failed save, split by whether resending the SAME conversation could ever
  // work. Retryable offers a button; terminal does not, because it never could.
  'web.translate.saveFailedRetryable':
    'This conversation isn’t saved yet. It won’t appear in History until it is.',
  'web.translate.saveFailedTerminal':
    'This conversation couldn’t be saved. It won’t appear in History, and it can’t get minutes.',
  // A different fact from either of the two above: the conversation IS in the
  // history, and only what was changed after it was stored is missing.
  'web.translate.saveEditsFailed':
    'Your latest changes weren’t saved. The conversation itself is in History.',
  'web.translate.saveRetry': 'Save again',
  'web.translate.saving': 'Saving…',
  // The RECORDING failed, which is a different loss from the transcript failing
  // and has to read that way: the words are in the history either way, and only
  // the audio is missing. Saying "could not be saved" here would tell a reader
  // they lost the conversation.
  'web.translate.recordingFailedRetryable':
    'The recording isn’t saved yet. The conversation itself is in History.',
  'web.translate.recordingFailedTerminal':
    'The recording couldn’t be saved, so there’s no audio to play back. The conversation itself is in History.',
  'web.translate.recordingUploading': 'Saving the recording…',
  'web.translate.minutesNeedsSave': 'Minutes need the conversation to be saved first.',
  // ---- web.translate.minutes: LLM meeting minutes over a finished conversation ----
  'web.translate.minutesGenerating': 'Summarizing the conversation…',
  'web.translate.minutesEmpty':
    'No minutes yet. Generate them for a summary, key points, decisions and action items.',
  'web.translate.minutesNeedsTurns': 'Nothing to summarize yet. Have a conversation first.',
  'web.translate.minutesCopy': 'Copy',
  'web.translate.minutesCopiedToast': 'Minutes copied',
  'web.translate.minutesCopyFailed': 'Couldn’t copy the minutes. Try again.',

  // ---- web.error: the boundaries every route group now has ----
  'web.error.title': 'Something went wrong',
  'web.error.retry': 'Try again',
  'web.error.appBody':
    'This didn’t load. Try again. If it keeps happening, the translation service may be down.',
  'web.error.authBody':
    'That step didn’t work. The link may have expired, so request a new one and try again.',
  'web.error.pageDidNotLoad': 'This page didn’t load. Try again.',
  'web.error.notFound': 'This page doesn’t exist',
  'web.error.notFoundBody':
    'The address may have changed, or the link you followed is out of date.',
  'web.error.goToStart': 'Go home',

  // ---- web.languageShort: the two-letter tag beside `common.languageName` ----
  'web.languageShort.vi': 'VI',
  'web.languageShort.en': 'EN',
  'web.languageShort.zh': 'ZH',

  // ---- web.history: conversations this account has finished and kept ----
  //
  // `speakerA`/`speakerB` are here rather than in a database column on purpose.
  // A stored turn's `speakerLabel` is null when the reader never attributed the
  // block, and the fallback has to be a KEY so it renders in the reader's
  // language: an English "Speaker A" written into a row would be invisible to the
  // parity gate below and unfixable without a data migration.
  'web.history.empty': 'No conversations yet',
  'web.history.emptyBody':
    'Finished conversations are saved here, so you can read them again and summarize them later.',
  'web.history.searchLabel': 'Search your conversations',
  'web.history.searchPlaceholder': 'Search…',
  'web.history.searchNoResults': 'No conversations match that.',
  // The recovery from a search that matched nothing. Without it the only way
  // back to the full list is selecting the field and deleting what you typed.
  'web.history.clearSearch': 'Clear search',
  'web.history.back': 'Back to History',
  // The detail's overflow menu. Delete's second step happens beside the sentence
  // saying what it costs — under the header, or under the row it was chosen on.
  'web.history.moreActions': 'More actions',
  // The actions menu, shared by the detail header and every list row. A row's
  // trigger names its conversation: twenty identical "More actions" buttons in a
  // list say nothing about which one is about to act.
  'web.history.rowActions': 'More actions for {title}',
  'web.history.rename': 'Rename',
  'web.history.copyTranscript': 'Copy transcript',
  'web.history.transcriptCopied': 'Transcript copied',
  'web.history.copyFailed': 'Couldn’t copy the transcript. Try again.',
  'web.history.downloadTranscript': 'Download transcript',
  'web.history.downloadText': 'Text (.txt)',
  'web.history.downloadMarkdown': 'Markdown (.md)',
  'web.history.downloadMarkdownMinutes': 'with minutes',
  'web.history.downloadSubtitles': 'Subtitles (.srt)',
  // Why Subtitles is unavailable: a cue needs a start, and some lines have none.
  'web.history.subtitlesNeedTimes': 'Every line needs a time',
  'web.history.downloadRecording': 'Download recording',
  'web.history.preparingDownload': 'Preparing the download…',
  'web.history.copying': 'Copying…',
  // The delete strip under a row, named for the conversation it deletes.
  'web.history.downloadFailed': 'Couldn’t download it. Try again.',
  // The menu item: the ellipsis says another step follows before anything goes.
  'web.history.deleteChoice': 'Delete…',
  // Renaming, in place of the title.
  'web.history.renameLabel': 'Conversation title',
  'web.history.renameSave': 'Save',
  'web.history.renameSaving': 'Saving…',
  'web.history.renameHint': 'Up to {max} characters.',
  'web.history.renameEmpty': 'Enter a title.',
  'web.history.renameTooLong': 'Use {max} characters or fewer.',
  'web.history.renameFailed': 'Couldn’t rename this conversation. Try again.',
  'web.history.renameTitle': 'Rename conversation',
  'web.history.renamed': 'Conversation renamed',
  'web.history.deleted': 'Conversation deleted',
  'web.history.download': 'Download',
  'web.history.downloaded': 'Downloaded {file}',
  'web.history.tabMinutes': 'Minutes',
  // Read after the tab's name when minutes exist; the dot beside it is decoration.
  'web.history.tabMinutesReady': '(ready)',
  'web.history.listWidth': 'Conversation list width',
  'web.history.turnCount': '{count} lines',
  'web.history.turnCountOne': '1 line',
  'web.history.duration': '{minutes} min',
  // Stands in for the source of a conversation whose turns were each recognised.
  'web.history.autoDetect': 'Auto-detect',
  'web.history.minutesReady': 'Minutes',
  // How a conversation ran, as its history row names it: the kind word, then
  // the languages in full with a direction icon between them.
  'web.history.kindOneWay': 'One-way',
  'web.history.kindTwoWay': 'Two-way',
  // Spoken in place of the direction icon, which screen readers skip.
  'web.history.pairToSpoken': 'to',
  'web.history.pairAndSpoken': 'and',
  'web.history.timeRange': '{start}–{end}',
  'web.history.speakerCount': '{count} speakers',
  'web.history.speakerCountOne': '1 speaker',
  'web.history.speakersNamed': '{count} speakers: {names}',
  'web.history.speakersNamedOne': '1 speaker: {names}',
  'web.history.recording': 'Recording',
  'web.history.untitled': 'Untitled conversation',
  'web.history.cancel': 'Cancel',
  'web.history.delete': 'Delete',
  'web.history.deleteConfirm': 'Delete this conversation and its minutes? You can’t undo this.',
  'web.history.deleting': 'Deleting…',
  'web.history.deleteFailed': 'Couldn’t delete this conversation, so it’s still here. Try again.',
  'web.history.loading': 'Loading your conversations…',
  'web.history.loadFailed': 'Couldn’t load your history. Try again.',
  'web.history.retry': 'Try again',
  'web.history.notFound': 'That conversation is no longer here.',
  // Names the two ways to arrive here, because the API answers a foreign id and
  // an absent one identically and the screen must not claim to tell them apart.
  'web.history.notFoundBody': 'It may have been deleted, or we couldn’t reach the server just now.',
  'web.history.speakerA': 'Speaker A',
  'web.history.speakerB': 'Speaker B',
  // The recording bar. No key for the TIMES themselves — both locales write
  // `0:06` with latin digits and a colon, so a key there would be a translation
  // that can never differ from its source.
  'web.history.playRecording': 'Play the recording',
  'web.history.pauseRecording': 'Pause the recording',
  // The gutter button's accessible name. Tabbing to it would otherwise announce
  // a bare number with no hint that pressing it moves the player.
  'web.history.playFrom': 'Play from {time}',
  'web.history.recordingLabel': 'Position in the recording',
  'web.history.recordingFailed': 'Couldn’t load the recording. Reload the page to try again.',
  'web.history.loadMore': 'Load more',
  // Beside the "Load more" control, not in place of the list: the conversations
  // already read are still on screen and still true.
  'web.history.loadMoreFailed': 'Couldn’t load more conversations. Try again.',

  // ---- web.preferences ----
  // Rows on Settings › Translation and Settings › AI Context; the key names predate the
  // move into Settings.
  'web.preferences.audioHint': 'Applies next time you start.',
  'web.preferences.audio.echoCancellationHint':
    'Reduces how much sound from your speakers the microphone picks up. When off, the microphone pauses while a translation plays.',
  'web.preferences.audio.noiseSuppressionHint': 'Filters out sound that isn’t speech.',
  'web.preferences.audio.autoGainControlHint': 'Keeps your microphone volume steady.',
  'web.preferences.audio.unsupported': 'This browser doesn’t support it.',
  'web.preferences.audio.conferenceNote':
    'In meetings, turning echo cancellation off makes others hear their own echo.',
  // AI Context — the named library the translator is told about a KIND of
  // conversation from. Authored here; picked on Translate and in the extension.
  //
  // "AI Context" rather than "hints" or "glossary": the section holds four
  // different kinds of guidance and a name that picks one of them makes the other
  // three look misfiled.
  'web.preferences.aiContext': 'AI Context',
  // The Settings pane's one line under its title; aiContextHint below is the longer
  // explanation, shown as the library's note.
  'web.preferences.aiContextDescription':
    'What the translator should know before a conversation starts.',
  'web.preferences.aiContextHint':
    'Tell the translator what a conversation is about before it starts: the topic, the names to expect, and how certain terms should be translated. Pick one when you start a conversation, here or in the browser extension.',
  // The extension lists only personal contexts, so a team library must not promise it.
  'web.preferences.aiContextHintTeam':
    'Tell the translator what a conversation is about before it starts: the topic, the names to expect, and how certain terms should be translated. Pick one when you start a conversation on the web. The browser extension only lists your personal AI Contexts.',
  'web.preferences.aiContext.empty': 'No AI Contexts yet. Create one to get started.',
  'web.preferences.aiContext.new': 'New context',
  'web.preferences.aiContext.edit': 'Edit',
  'web.preferences.aiContext.viewOnly': 'View only',
  // The library group's heading; the editor group beside it is titled for its draft.
  'web.preferences.aiContext.libraryTitle': 'Your contexts',
  // The editor group's heading when it holds a stored context.
  'web.preferences.aiContext.editTitle': 'Edit context',
  'web.preferences.aiContext.delete': 'Delete',
  'web.preferences.aiContext.deleting': 'Deleting…',
  'web.preferences.aiContext.deleteFailed':
    'Couldn’t delete this context, so it’s still here. Try again.',
  'web.preferences.aiContext.save': 'Save context',
  'web.preferences.aiContext.cancel': 'Cancel',
  'web.preferences.aiContext.saving': 'Saving…',
  'web.preferences.aiContext.name': 'Name',
  'web.preferences.aiContext.description': 'What the conversation is about',
  'web.preferences.aiContext.descriptionHint':
    'A few words, like “hotel check-in” or “cardiology consultation”. It helps the translator pick the right meaning when a sentence could go either way.',
  'web.preferences.aiContext.keywords': 'Names and terms to expect',
  'web.preferences.aiContext.keywordsHint':
    'Names of people and places, jargon, product names. These are the words most often misheard.',
  'web.preferences.aiContext.keywordTooLong':
    'One line is too long. Keep each line to {max} characters, or remove it.',
  'web.preferences.aiContext.keywordsTooMany':
    'That’s {count} terms, and the limit is {max}. Remove some before saving.',
  'web.preferences.aiContext.glossary': 'Preferred translations',
  // Says what a pair IS and what it is not, because the second half is the part
  // people get wrong: a pair is not a find-and-replace.
  'web.preferences.aiContext.glossaryHint':
    'How a term should be translated. Write it in at least two languages. The translator uses the two languages of the conversation, in either direction, and only when the term is actually said.',
  'web.preferences.aiContext.glossaryTooLong':
    'Keep each one to a word or short phrase, up to {max} words. Shorten this pair, or remove it.',
  'web.preferences.aiContext.glossaryAdd': 'Add pair',
  'web.preferences.aiContext.glossaryRemove': 'Remove this pair',
  'web.preferences.aiContext.glossaryLink': 'Glossary',
  'web.preferences.aiContext.glossaryLinkNone': 'None',
  'web.preferences.aiContext.glossaryLinkHint': 'Terms from this glossary guide the translation.',
  'web.preferences.aiContext.register': 'Tone',
  // The words explain the refusal rather than leaving a control dead.
  'web.preferences.aiContext.limitReached':
    'You’ve reached the maximum number of contexts. Delete one to create another.',
  'web.preferences.aiContext.saveFailed':
    'Couldn’t save this context. Your changes are still here. Try again.',
  'web.preferences.aiContext.saveFailedElsewhere':
    '“{name}” wasn’t saved. Its draft is still in the library you opened it from.',
  'web.preferences.aiContext.loadFailed':
    'Couldn’t load your contexts. You’re still signed in. Check your connection and try again.',

  // ---- web.account ----
  //
  // Nothing here may say sign-out-everywhere. Signing out discards this
  // browser's cookie; the API token it carried stays valid until it expires.
  // The one thing that revokes earlier tokens and closes open sockets is a
  // COMPLETED password reset, which is why that is where the stronger sentence
  // sits.
  'web.account.memberSince': 'Member since',
  'web.account.nameUnset': 'Not set',
  'web.account.loadFailed':
    'Couldn’t load your account details. You’re still signed in. Check your connection and try again.',
  'web.account.avatarChange': 'Change photo',
  'web.account.avatarRemove': 'Remove photo',
  'web.account.avatarHint':
    'Shown next to your name here and in the sidebar. Square works best. We crop to the center.',
  // Four distinct failures, because they need four different actions. Picking
  // another file, picking a smaller one, retrying, and telling whoever runs the
  // server are not the same next step, and one "upload failed" would hide which.
  'web.account.avatarNotAnImage': 'That file isn’t an image. Choose a JPEG, PNG or WebP.',
  'web.account.avatarTooLarge': 'That image is too large. Choose one under 256 KB.',
  'web.account.avatarFailed': 'Couldn’t save that photo. Try again.',
  // Covers BOTH 409s the API can send — storage not configured, and storage
  // unreachable — because the client cannot tell them apart: they share the
  // CONFLICT code, and rendering the API's own message verbatim would put
  // English in front of a Vietnamese reader. So it says what is true of both
  // (nothing changed) and offers the action that helps in either case.
  'web.account.avatarUnavailable':
    'Couldn’t save that photo, so nothing changed. Try again. If it keeps failing, tell whoever runs this server.',
  'web.account.security': 'Security',
  'web.account.thisBrowser': 'This browser',
  'web.account.changePassword': 'Change password',
  'web.account.changePasswordHint':
    'Signs out your other devices and closes any open translation or meeting. This browser stays signed in.',
  'web.account.currentPassword': 'Current password',
  'web.account.confirmNewPassword': 'Confirm new password',
  'web.account.changePasswordSubmit': 'Save new password',
  'web.account.changingPassword': 'Saving…',
  'web.account.changePasswordCancel': 'Cancel',
  'web.account.passwordsDoNotMatch': 'The new passwords don’t match.',
  'web.account.passwordChanged': 'Password changed. Your other devices are signed out.',
  // One per failure, because each needs a different next step: retype, use the
  // reset flow, wait, sign in again, or retry. The API's own messages are English
  // and are never rendered.
  'web.account.currentPasswordWrong': 'That’s not your current password.',
  'web.account.noPasswordYet':
    'This account signs in with Google and has no password yet. Use “Forgot your password?” to set one.',
  'web.account.changePasswordThrottled': 'Too many attempts. Wait a minute and try again.',
  'web.account.changePasswordSessionExpired':
    'You’ve been signed out. Sign in again, then change your password.',
  'web.account.changePasswordInvalid': 'Check the new password and try again.',
  'web.account.changePasswordFailed':
    'Couldn’t change your password, so nothing changed. Try again.',
  'web.account.signOutHint':
    'Signs out this browser only. Other devices stay signed in until their sign-in expires.',
  // Credits & plan: buying. The first offer's Buy is Billing's one filled control.
  'web.account.buyTitle': 'Buy credits',
  // Each offer's button; its accessible name adds the offer's own label.
  'web.account.buy': 'Buy',
  'web.account.buyTopupCard': '{credits} by card — {price}',
  'web.account.buyTopupQr': '{credits} by VietQR — {price}',
  'web.account.railSandboxCard': 'Card payments are in test mode. No real money is charged.',
  'web.account.railSandboxQr': 'VietQR is in test mode. No real money is charged.',
  'web.account.checkoutOpening': 'Opening checkout…',
  'web.account.checkoutFailed': 'Couldn’t open checkout. Try again.',
  'web.account.checkoutReturned': 'Payment done. Your balance is updated.',
  'web.account.manageSubscription': 'Manage subscription',
  'web.account.usageShowMore': 'Show more',
  // Settings › Billing: the Free | Pro comparison, the top-up payment method, usage by day.
  'web.billing.planTitle': 'Plan',
  'web.billing.yourPlan': 'Your plan',
  'web.billing.freePrice': '{price} a month',
  'web.billing.priceCard': '{price}\u00a0a\u00a0month by card',
  'web.billing.pricePass': '{price} for 30 days by VietQR',
  'web.billing.featureCreditsMonthly': '{credits} credits every month',
  'web.billing.featureNoCarryOver': 'Unused credits don’t carry over',
  'web.billing.featureCreditsCycle': '{credits} credits each cycle',
  'web.billing.featureCycleReset': 'Resets when the next cycle starts',
  'web.billing.featurePayOptions': 'Card renews monthly. A VietQR pass lasts 30 days.',
  'web.billing.featureTopups': 'Add top-ups any time. They never expire.',
  'web.billing.upgradeCard': 'Upgrade by card',
  'web.billing.upgradeQr': 'Upgrade by VietQR',
  'web.billing.renewQr': 'Renew by VietQR',
  'web.billing.proRenewsOn': 'Card subscription, renews on {date}',
  'web.billing.payWith': 'Pay with',
  'web.billing.methodCard': 'Card',
  'web.billing.methodQr': 'VietQR',
  'web.billing.railSandboxBoth': 'Payments are in test mode. No real money is charged.',
  'web.billing.usageToday': 'Today',
  'web.billing.usageYesterday': 'Yesterday',
  // The VietQR panel, polled until the transfer lands or the order expires.
  'web.account.qrTitle': 'Scan with your banking app',
  'web.account.qrImageAlt': 'VietQR code to pay {amount}',
  'web.account.qrAmount': 'Amount',
  'web.account.qrCode': 'Transfer note',
  'web.account.qrCodeHint':
    'Keep the note exactly as shown. It’s how we match your payment to your order.',
  'web.account.qrCopy': 'Copy',
  'web.account.qrCopied': 'Copied',
  'web.account.qrWaiting': 'Waiting for your transfer…',
  'web.account.qrPaid': 'Payment received. Your balance is updated.',
  'web.account.qrExpired':
    'This code has expired. If you already sent a transfer, it’ll still be credited. If not, start again.',
  'web.account.qrNeedsReview':
    'We got a payment we couldn’t match automatically. We’ll check it and add your credits by hand.',
  'web.account.qrClose': 'Close',

  // ---- web.settings ----
  // Settings: one dialog of five tabs in two groups, opened from the sidebar footer
  // over the current page. Each tab opens with its name and one line saying what it
  // holds.
  'web.settings.nav': 'Settings sections',
  'web.settings.groupPersonal': 'Personal',
  'web.settings.groupAccount': 'Account',
  'web.settings.groupWorkspace': 'Workspace',
  'web.settings.general': 'General',
  'web.settings.translation': 'Translation',
  'web.settings.translationDescription':
    'What a new conversation starts with, and what the browser does to your microphone.',
  'web.settings.account': 'Account',
  'web.settings.accountDescription':
    'Your photo, name, email, password and sign-in on this browser.',
  // The phone's back button from one tab to the list of all of them.
  // Said when Settings refuses to leave a tab (or close on Esc) over an unsaved draft.
  'web.settings.unsavedDraft': 'Save or cancel the AI Context you’re writing first.',
  'web.settings.backToList': 'Back to all settings',
  'web.settings.appearance': 'Appearance',
  'web.settings.appearanceDescription': 'The language Chatofy speaks to you in, and how it looks.',
  'web.settings.audioDescription': 'What the browser does to your microphone before translating.',
  'web.settings.billing': 'Billing',
  'web.settings.billingDescription': 'Your credits, your plan, and what they were spent on.',
  'web.settings.languageNote': 'Chatofy’s emails to you use this language too.',
  'web.settings.interfaceLanguage': 'Interface language',
  // Group headings on the Translation tab.
  'web.settings.groupLanguages': 'Languages',
  'web.settings.groupVoice': 'Voice',
  'web.settings.groupDisplay': 'Display',
  'web.settings.groupMicrophone': 'Microphone',
  'web.settings.groupDefaultContext': 'Default AI Context',
  // Shown on the Translation tab while a conversation runs on the page under it.
  'web.settings.lockedWhileRunning':
    'Languages, voices and AI Context are locked until the current conversation ends.',
  // What a toast calls the two language-pair rows on Defaults.
  'web.settings.oneWayPair': 'One-way languages',
  'web.settings.twoWayPair': 'Two-way languages',
  // Autosave, said once per setting. `{setting}` is the row's own label.
  'web.settings.saved': '{setting} saved',
  'web.settings.saveFailed': 'Couldn’t save {setting}. It still applies in this browser.',
  'web.settings.photoChoose': 'Choose an image',
  'web.settings.photoUpdated': 'Photo updated',
  'web.settings.photoRemoved': 'Photo removed',
  'web.settings.contextSaved': '“{name}” saved',
  'web.settings.contextDeleted': '“{name}” deleted',
  'web.settings.signOutTitle': 'Sign out of this browser?',
  'web.settings.signOutFailed': 'Couldn’t sign out. Try again.',

  // ---- web.landing ----
  //
  // The copy register governs here hardest. `docs/design-guidelines.md` § Copy
  // register: name the wait, the outcome, or the next step — never the pipeline.
  // "Recognise, translate, speak" and every variant is banned, which is why the
  // privacy section talks about what is kept and what the translator sees rather
  // than about which component runs where.
  //
  // Every number below comes from `docs/development-journey.md`. There is exactly
  // one, "about a second" in `howOneBody`, from the measured ~0.9 s between the end
  // of a sentence and the start of playback. A thesis product with no users has
  // nothing else to count.
  //
  // Every scope claim is a fact about `main`: three languages in the registry, only
  // Vietnamese and English told apart automatically (on /translate), meetings
  // translating between all three. When one of those changes, the line saying it
  // changes with it.
  'web.landing.heroTitle': 'Speak your language. Be understood in theirs.',
  'web.landing.heroBody':
    'Live voice translation between Vietnamese, English and Chinese. Use it face to face in your browser, in video meetings, and on Google Meet, Zoom or Facebook calls.',
  'web.landing.meetingsStart': 'Create a meeting',
  'web.landing.demoListening': 'Listening',
  'web.landing.demoSourceOne': 'Chào anh, mình muốn hỏi về lịch họp chiều nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure — it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'Được thôi — cuộc họp đã dời sang bốn giờ.',

  'web.landing.howTitle': 'How it works',
  'web.landing.howBody': 'Three things to know before you turn on your microphone.',
  'web.landing.howOneTitle': 'Press start, then just talk',
  'web.landing.howOneBody':
    'No button to hold. Your turn ends when you pause, and the translation plays about a second later.',
  'web.landing.howTwoTitle': 'Auto-detect for Vietnamese and English',
  'web.landing.howTwoBody':
    'Chatofy tells Vietnamese and English apart as you speak. For Chinese, choose the language before you start.',
  'web.landing.howThreeTitle': 'Hear the translation, don’t read it',
  'web.landing.howThreeBody': 'It’s read aloud, and the text stays on screen too.',

  'web.landing.meetingsTitle': 'Meetings across languages, translated live',
  'web.landing.meetingsBody': 'Share one link. Everyone follows the meeting in their own language.',
  'web.landing.meetingsLinkTitle': 'Join with a link',
  'web.landing.meetingsLinkBody': 'Anyone with an account joins from the link. Nothing to install.',
  'web.landing.meetingsHearTitle': 'Captions and voice in your language',
  'web.landing.meetingsHearBody': 'Hear and read every speaker in the language you choose.',
  'web.landing.meetingsChatTitle': 'Translated chat',
  'web.landing.meetingsChatBody': 'Every message arrives in the reader’s language.',
  'web.landing.meetingsMinutesTitle': 'Meeting minutes',
  'web.landing.meetingsMinutesBody':
    'When the meeting ends, generate minutes with a summary, decisions and action items.',
  'web.landing.meetingsScope': 'Meetings translate between Vietnamese, English and Chinese.',

  // The product's only privacy notice: there is no separate privacy page, so this
  // copy has to change WITH the behaviour, never after it.
  //
  // It makes no claim about WHERE speech is processed. An earlier version said the
  // voice was heard "on your own computer"; that held for a self-hosted checkout,
  // but for anyone using the hosted service speech runs on Chatofy's server, not
  // the reader's device. What survives any hosting change is what the translator
  // receives (text, never audio) and what is kept, so that is what it says.
  //
  // The kept facts are the ones a reader would be surprised by later: the recording
  // is KEPT rather than merely used; it sits at an unguessable but public address,
  // so the link is the whole of its access control (see "Conversation recordings"
  // in `docs/deployment-guide.md`); a pause pauses the recorder too
  // (`use-conversation-recording.ts`); deleting deletes it; and a meeting keeps its
  // text, never audio — the `Conference*` tables hold turns, messages and minutes —
  // readable by every participant (`conference-access.ts`) with no way to delete it
  // yet. When meeting deletion ships, `localKeptMeeting` changes with it.
  //
  // `localBody` ("the translator only ever sees text") holds because no client offers
  // the `live` mode, which streams raw audio to a cloud model. Putting that mode back
  // in any UI makes this sentence false.
  //
  // `localTitle` is a section heading only; the header nav says `navLocal`.
  'web.landing.localTitle': 'What happens to your recordings',
  'web.landing.localBody':
    'The translation service receives text only, never your audio. Here’s what we keep, and what we don’t.',
  'web.landing.localKeptHistory':
    'When a conversation ends, its recording and transcript are saved to History. You can play it back and read it again.',
  'web.landing.localKeptLink':
    'The recording lives at an unguessable address. Anyone with the link can open it, so the link is what keeps it private.',
  'web.landing.localKeptPause':
    'Pausing a conversation pauses the recording too. Nothing said while paused is recorded or translated.',
  'web.landing.localKeptDelete': 'Deleting a conversation deletes its recording.',
  'web.landing.localKeptMeeting':
    'Meetings save speech and messages as text, never audio. Everyone who took part can read them. They can’t be deleted yet.',

  'web.landing.surfacesTitle': 'Where Chatofy runs',
  'web.landing.surfaceBrowserTitle': 'In the browser',
  'web.landing.surfaceBrowserBody':
    'Translate conversations or host meetings, with nothing to install.',
  'web.landing.surfaceExtensionTitle': 'Extension for Meet, Zoom and Facebook',
  'web.landing.surfaceExtensionBody': 'Two-way translation inside the call you’re already on.',
  'web.landing.surfacePhoneTitle': 'On your phone',
  'web.landing.surfacePhoneBody': 'Joins meetings. Not in the app stores yet.',

  'web.landing.ctaTitle': 'Try a conversation',
  'web.landing.ctaBody': 'All you need is a microphone and an account. No card required.',
  'web.landing.navMenu': 'Menu',
  // Short forms for the header nav, which has to fit one line beside the brand at
  // 1024px. The section headings stay as written; these only point at them.
  'web.landing.navHow': 'How it works',
  'web.landing.navLocal': 'Privacy',
  'web.landing.navSurfaces': 'Where it runs',
  // The part of `heroTitle` set in italic. Must appear verbatim inside it; the hero
  // falls back to an upright headline when it does not.
  'web.landing.heroTitleEmphasis': 'Be understood',

  // ---- the redesigned landing: modes, use cases, pricing teaser, FAQ, footer ----
  //
  // `mock*` strings are the bento's illustrations, not claims. The cross-language
  // ones (a source line and its translation) are the same in every locale, like the
  // hero's demo; the ones shown "in your language" are translated per locale.
  //
  // Every FAQ answer is traceable: languages and Auto-detect to `howTwoBody`; the
  // wait to `howOneBody`; headphones to `web.preferences.audio.echoCancellationHint`
  // (echo cancellation defaults on in `mic-processing.ts`; "not usually" because it
  // rests on the browser's echo cancellation); recordings to the `localKept*` lines;
  // cost to `web.pricing.notOpen`; Zoom's desktop app to the README's extension
  // section; accounts to `meetingsLinkBody` and `proxy.ts`.
  'web.landing.navModes': 'Features',
  'web.landing.navUseCases': 'Use cases',
  'web.landing.navPricing': 'Pricing',
  'web.landing.navFaq': 'FAQ',
  'web.landing.heroLanguagesLabel': 'Languages',
  'web.landing.heroPlatformsLabel': 'Works in',
  'web.landing.heroPlatformBrowser': 'Your browser',
  'web.landing.modesTitle': 'Everything a conversation needs',
  'web.landing.modesBody':
    'Talk face to face, follow a speaker, or run a whole meeting. Then keep what was said.',
  'web.landing.modeOneWayTitle': 'Follow a speaker',
  'web.landing.modeOneWayBody':
    'For a talk, a class or a tour. Pick the spoken language, or let Auto-detect tell Vietnamese from English, and hear it in yours.',
  'web.landing.modeTwoWayTitle': 'Talk face to face',
  'web.landing.modeTwoWayBody':
    'Two people, one screen. Each of you speaks your own language and hears the other in it. Vietnamese and English for now.',
  'web.landing.modeHistoryTitle': 'Every conversation, kept',
  'web.landing.modeHistoryBody':
    'Play back a finished conversation, read it again, download the transcript or subtitles, and generate minutes.',
  'web.landing.modeGlossaryTitle': 'Your names and terms',
  'web.landing.modeGlossaryBody':
    'Add your names and terms to a glossary, and your translations use them.',
  'web.landing.mockMeetingSubtitle': 'Let’s start with the launch plan.',
  'web.landing.mockMeetingMessage': 'I’ll send the slides after the meeting.',
  'web.landing.mockHistoryOne': 'Checking in at the hotel',
  'web.landing.mockHistoryTwo': 'Call with a supplier',
  'web.landing.mockHistoryThree': 'Lecture on the old quarter',
  'web.landing.useCasesTitle': 'Made for real situations',
  'web.landing.useCasesBody': 'Wherever two languages meet.',
  'web.landing.useTravelTitle': 'Traveling',
  'web.landing.useTravelBody':
    'Ask for directions, check in, order food. Each of you speaks your own language. Vietnamese and English for now.',
  'web.landing.useFamilyTitle': 'Family abroad',
  'web.landing.useFamilyBody':
    'Talk with relatives who speak another language, right in the Meet, Zoom or Facebook call you already use.',
  'web.landing.usePartnersTitle': 'Partners and customers',
  'web.landing.usePartnersBody':
    'Share one meeting link. Everyone follows in their own language, and you can generate minutes at the end.',
  'web.landing.useStudyTitle': 'Classes and lectures',
  'web.landing.useStudyBody':
    'Follow a lecture in another language, then read it again in History.',
  'web.landing.surfaceStatusBrowser': 'Available now',
  'web.landing.surfaceStatusExtension': 'Not in the Chrome Web Store yet',
  'web.landing.surfaceStatusPhone': 'In development',
  'web.landing.pricingTitle': 'Start with free credits',
  // `pricingBody` and `faqCostAnswer` promise a free monthly allowance and a flat cost
  // for minutes in words, with no number. The allowance is a `Plan` row: if Free is ever
  // switched off (0 credits, `plan-catalog.ts`), both lines change with it in every
  // locale. The flat cost is `credit-pricing.ts` (see credits-and-billing.md).
  'web.landing.pricingBody':
    'You pay in credits: by the minute while you translate, plus a small flat cost each time you generate minutes. Every account gets free credits each month.',
  'web.landing.pricingLink': 'See plans and top-ups',
  'web.landing.faqTitle': 'Questions, answered',
  'web.landing.faqLanguagesQuestion': 'Which languages does Chatofy translate?',
  'web.landing.faqLanguagesAnswer':
    'Vietnamese, English and Chinese. Auto-detect tells Vietnamese and English apart as you speak. For Chinese, choose the language before you start. Face-to-face conversations work between Vietnamese and English for now.',
  'web.landing.faqWaitQuestion': 'How long until I hear the translation?',
  'web.landing.faqWaitAnswer':
    'About a second after you pause. Your turn ends when you stop talking, so there’s no button to hold.',
  'web.landing.faqHeadphonesQuestion': 'Do I need headphones?',
  'web.landing.faqHeadphonesAnswer':
    'Not usually. Echo cancellation is on by default, so the microphone keeps listening while a translation plays through your speakers. With headphones, you can turn it off in the audio settings. The microphone then pauses while a translation plays.',
  'web.landing.faqRecordingsQuestion': 'What happens to my recordings?',
  'web.landing.faqRecordingsAnswer':
    'The translation service receives text only, never your audio. A finished conversation is saved to History with its recording. Deleting the conversation deletes the recording. Meetings keep text, never audio.',
  'web.landing.faqCostQuestion': 'What does it cost?',
  'web.landing.faqCostAnswer':
    'Every account gets free credits each month, spent by the minute while you translate, plus a small flat cost each time you generate minutes. Paid plans and top-ups are on the pricing page, but checkout isn’t open to the public.',
  'web.landing.faqExtensionQuestion': 'Does it work in Google Meet, Zoom or Facebook calls?',
  'web.landing.faqExtensionAnswer':
    'Yes, with the Chrome extension, which translates both ways inside the call. Zoom works in its web client, not the desktop app. The extension isn’t in the Chrome Web Store yet.',
  'web.landing.faqAccountQuestion': 'Can someone join a meeting without an account?',
  'web.landing.faqAccountAnswer':
    'Not yet. Anyone with an account can join from the meeting link, with nothing to install.',
  'web.landing.faqPhoneQuestion': 'Is there a phone app?',
  'web.landing.faqPhoneAnswer':
    'It’s in development. It can join meetings, but it isn’t in the app stores yet.',
  'web.landing.footerProduct': 'Product',
  'web.landing.footerOnThisPage': 'On this page',
  'web.landing.footerResources': 'Resources',
  'web.landing.footerLanguages': 'Languages',
  'web.landing.footerMarkdownHome': 'This page as Markdown',
  'web.landing.footerMarkdownPricing': 'Pricing as Markdown',
  'web.landing.mockOneWaySource': 'Today we will walk through the old quarter and its history.',
  'web.landing.mockOneWayTarget': '今天我们将走访老城区，了解它的历史。',
  'web.landing.mockTwoWaySourceOne': 'Anh có cần tôi gọi taxi không?',
  'web.landing.mockTwoWayTargetOne': 'Would you like me to call you a taxi?',
  'web.landing.mockTwoWaySourceTwo': 'Yes, please — to the airport.',
  'web.landing.mockTwoWayTargetTwo': 'Vâng, cho tôi ra sân bay.',
  'web.landing.mockTermOneSource': 'Phố cổ',
  'web.landing.mockTermOneTarget': 'Old Quarter',
  'web.landing.mockTermTwoSource': 'Bánh mì',
  'web.landing.mockTermTwoTarget': 'Banh mi',
  'web.landing.mockTermThreeSource': 'Hội An',
  'web.landing.mockTermThreeTarget': 'Hoi An',

  // ---- web.pricing: the public /pricing page ----
  'web.pricing.title': 'Pricing',
  'web.pricing.intro':
    'Translation is paid for in credits. One credit is one minute of translated captions.',
  'web.pricing.notOpen':
    'Checkout isn’t open to the public. Chatofy is a non-commercial thesis project, and only its owner can buy.',
  'web.pricing.startFree': 'Start free',
  'web.pricing.freeSummary': '{credits} credits every month. Unused credits don’t carry over.',
  'web.pricing.proSummary': '{credits} credits each cycle, reset when the next one starts.',
  'web.pricing.proPriceCard': '{price} a month by card, renews automatically',
  'web.pricing.proPricePass': '{price} for 30 days by VietQR, doesn’t renew',
  'web.pricing.topupsTitle': 'Top-ups',
  'web.pricing.topupsSummary': 'Credits that never expire, spent after your plan credits.',
  'web.pricing.topupPrice': '{usd} by card · {vnd} by VietQR',
  'web.pricing.footnoteUnits':
    'Captions use 1 credit a minute, or 2 with the translation spoken aloud. Meeting minutes use 3 credits each.',
  'web.pricing.footnoteLanguages':
    'Each extra language a meeting translates into costs the same again.',
  'web.pricing.pricesUnavailable': 'Prices aren’t available right now. Try again later.',

  // ---- web.conference: video conferencing lobby + in-call screen ----
  'web.conference.joining': 'Joining…',
  // ---- web.conference: in-call control bar ----
  'web.conference.muted': 'Muted',
  'web.conference.showRoster': 'Show participants',
  // ---- web.conference: edge-case states (Phase 5) ----
  'web.conference.permissionDeniedHint':
    'Allow camera and microphone access in your browser’s site settings, then reload this page.',
  // ---- web.conference: audio unlock (Phase 1) ----
  // Inline notice when the browser's autoplay policy suspended a TTS AudioContext.
  // No card, no elevation — ghost button only; Leave stays the one accent control.
  'web.conference.audioBlocked': 'Your browser is blocking sound.',
  'web.conference.enableAudio': 'Turn on sound',
  // ---- web.conference: landing and pre-join room ----
  'web.conference.newMeeting': 'New meeting',
  'web.conference.codeOrLink': 'Meeting code or link',
  'web.conference.codeOrLinkPlaceholder': 'Paste a link or enter a code',
  'web.conference.joinAction': 'Join',
  'web.conference.joiningAs': 'Joining as {name}',
  'web.conference.landingLead': 'Meet across languages, with translated speech and captions.',
  'web.conference.readyToJoin': 'Ready to join?',
  'web.conference.joinNow': 'Join now',
  'web.conference.microphone': 'Microphone',
  'web.conference.camera': 'Camera',
  'web.conference.defaultDevice': 'System default',
  'web.conference.noCameraPreview': 'Camera is off',
  'web.conference.micLevel': 'Microphone level',
  'web.conference.translatedVoiceChip': 'Voice: {gender} · {speed}×',
  'web.conference.translatedVoiceHint':
    'Others hear your translation in this voice. It’s the same setting as on Translate.',
  'web.conference.copyInviteLink': 'Copy invite link',
  'web.conference.showQr': 'Show QR code',
  'web.conference.qrTitle': 'Join from a phone',
  'web.conference.qrLabel': 'QR code to join the meeting',
  'web.conference.qrHint': 'Scan this with a phone camera to open the meeting.',
  'web.conference.micOn': 'Microphone on',
  'web.conference.micOff': 'Microphone muted',
  'web.conference.camOn': 'Camera on',
  'web.conference.camOff': 'Camera off',
  'web.conference.chatEmptyHint': 'Everyone reads messages in their own language.',
  'web.conference.inviteLinkCopied': 'Link copied',
  'web.conference.meetingCode': 'Meeting code',
  'web.conference.rosterWidth': 'Chat panel width',
  'web.conference.soundCaptionsTitle': 'Captions and sound',
  'web.conference.captionsShow': 'Show captions',
  'web.conference.captionSize': 'Caption size',
  'web.conference.originalVolume': 'Original voices',
  'web.conference.originalVolumeAria': 'Original voices volume',
  'web.conference.originalVolumeHint': 'Lower this to hear the translation more clearly.',
  'web.conference.roomGoneHint': 'Check the link, or ask whoever invited you for a new one.',
  'web.conference.lobbyHeading': 'Start or join a meeting',
  'web.conference.joinWithCode': 'Join with a code',
  'web.conference.joinDialogTitle': 'Join a meeting',
  'web.conference.joinDialogHint': 'Enter the meeting code, or paste the invite link.',
  'web.conference.codeInvalid': 'That isn’t a meeting code or invite link.',
  'web.conference.cancel': 'Cancel',
  'web.conference.createFailedToast': 'Couldn’t start the meeting',
  'web.conference.minutesReady': 'Minutes are ready',
  'web.conference.minutesFailedToast': 'Couldn’t create the minutes',
  'web.meta.conference': 'Meetings · Chatofy',
  'web.meta.glossary': 'Glossary · Chatofy',
  'web.meta.invite': 'Team invite · Chatofy',
  // The invite page. The team name is whatever its creator typed, so it always
  // renders as plain text: on its own line beside the team's tile, and in the
  // after-join toast.
  'web.invite.heading': 'Team invite',
  'web.invite.signInPrompt': 'Sign in with the email this invite was sent to.',
  'web.invite.createAccount': 'Create account',
  'web.invite.pendingAdmin': 'You’re invited to join a team as an admin.',
  'web.invite.pendingMember': 'You’re invited to join a team as a member.',
  'web.invite.invitedByAsAdmin': 'Invited by {email} · join as an admin',
  'web.invite.invitedByAsMember': 'Invited by {email} · join as a member',
  'web.invite.whatJoiningMeans':
    'You’ll share its glossaries and AI Contexts. Your history, meetings and credits stay yours.',
  'web.invite.join': 'Join team',
  'web.invite.joined': 'You joined the team.',
  'web.invite.openGlossary': 'Open glossaries',
  'web.invite.alreadyMember': 'You’re already in this team.',
  'web.invite.used': 'This invite has already been used.',
  'web.invite.revoked': 'This invite was withdrawn.',
  'web.invite.expired': 'This invite has expired. Ask for a new one.',
  'web.invite.wrongAccount':
    'This invite was sent to a different email. Sign in with that email to accept it.',
  'web.invite.invalid': 'This invite link doesn’t work. Ask for a new one.',
  'web.invite.loadFailed': 'Couldn’t load this invite. Try again.',
  'web.invite.teamCap': 'You’re already in {max} teams. Leave one to join this team.',
  'web.invite.teamFull': 'This team is full. Ask the owner to make room.',
  'web.invite.joinedToast': 'You joined {name}',
  'web.workspace.label': 'Workspace',
  'web.workspace.personal': 'Personal',
  'web.workspace.teamGlossaries': 'Team glossaries',
  'web.workspace.teamContexts': 'Team AI Contexts',
  'web.workspace.sharedWith': 'Shared with {count} members of {name}',
  'web.workspace.sharedWithOnlyYou': 'Only you are in {name} so far',
  'web.workspace.editOwn': 'you can edit what you made',
  'web.workspace.editAll': 'you can edit everything here',
  'web.workspace.switchTo': 'Switch workspace',
  'web.workspace.manageTeams': 'Manage teams',
  'web.workspace.manageTeam': 'Manage team',
  'web.workspace.createTeam': 'Create team',
  'web.workspace.teamSubline': 'Team · {role}',
  'web.workspace.current': 'Switch workspace, current: {name}',
  'web.settings.team': 'Team',
  'web.team.none': 'You’re not in a team yet.',
  'web.team.noneHint':
    'A team shares its glossaries and AI Contexts with everyone in it. Your history, meetings and credits stay yours.',
  'web.team.yourTeams': 'Your teams',
  'web.team.open': 'Open',
  'web.team.openTeam': 'Open {name}',
  'web.team.create': 'Create team',
  'web.team.nameLabel': 'Team name',
  'web.team.createSubmit': 'Create',
  'web.team.cancel': 'Cancel',
  'web.team.createRefused': 'You can be in up to {max} teams. Leave one to create another.',
  'web.team.roleOwner': 'Owner',
  'web.team.roleAdmin': 'Admin',
  'web.team.roleMember': 'Member',
  'web.team.members': 'Members',
  'web.team.you': 'You',
  'web.team.unnamed': 'Unnamed member',
  'web.team.roleLabel': 'Role',
  'web.team.remove': 'Remove',
  'web.team.removeConfirmTitle': 'Remove {name} from the team?',
  'web.team.removeConfirmBody':
    'They lose access to this team’s glossaries and AI Contexts right away. What they created stays in the team.',
  'web.team.inviteEmail': 'Email address',
  'web.team.inviteSubmit': 'Invite',
  'web.team.invitePending': 'Invite pending',
  'web.team.inviteExpired': 'Expired',
  'web.team.inviteRevoke': 'Withdraw invite',
  'web.team.inviteNote':
    'The invite link works once and expires in 7 days. To send a new one, withdraw this one and invite again.',
  'web.team.inviteRefused':
    'Can’t invite this address. It’s already in the team or was invited recently, or the team is full.',
  'web.team.inviteForbidden': 'Only the owner can invite an admin.',
  'web.team.inviteTooMany': 'Too many invites for now. Try again later.',
  'web.team.rename': 'Team name',
  'web.team.renameSubmit': 'Save name',
  'web.team.delete': 'Delete team',
  'web.team.deleteConfirmTitle': 'Delete {name}?',
  'web.team.deleteConfirmBody':
    'This deletes the team’s glossaries and AI Contexts for everyone in it. Type the team name to confirm.',
  'web.team.leave': 'Leave team',
  'web.team.leaveConfirmTitle': 'Leave {name}?',
  'web.team.leaveConfirmBody':
    'You lose access to its glossaries and AI Contexts. What you created stays in the team.',
  'web.team.loadFailed': 'Couldn’t load this team. Try again.',
  'web.team.retry': 'Try again',
  'web.team.actionFailed': 'That didn’t go through. Check your connection and try again.',
  'web.team.tabDescriptionPersonal':
    'Create a team or open one you’re in. A team shares its glossaries and AI Contexts.',
  'web.team.tabDescriptionTeam': 'Manage this team: its members, invites and name.',
  'web.team.headerSubline': '{role} · {count} / {max} members',
  'web.team.memberCount': '{count} members',
  'web.team.memberCountOne': '1 member',
  'web.team.inviteHeading': 'Invite people',
  'web.team.invitePendingUntil': 'Pending · expires {date}',
  'web.team.nameHeading': 'Team name',
  'web.team.dangerZone': 'Danger zone',
  'web.team.deleteRowLabel': 'Delete this team',
  'web.team.deleteRowNote':
    'Deletes its glossaries and AI Contexts for everyone. You can’t undo this.',
  'web.team.leaveRowLabel': 'Leave this team',
  'web.team.leaveRowNote':
    'You lose access to its glossaries and AI Contexts until someone invites you again.',
  'web.team.createdToast': '{name} created',
  'web.team.createdHint': 'Invite people to share glossaries and AI Contexts.',
  'web.team.leftToast': 'You left {name}',
  'web.team.deletedToast': '{name} was deleted',

  // ---- mobile.conference: the React Native conference lobby + call screen ----
  //
  // Only what the phone says differently from the browser, or says alone: the
  // permission hint points at the device's Settings app rather than a browser, and
  // there is no "reload the page" on a phone. Everything both apps say the same way
  // is `common.conference.*` — this once held a full copy, and the two drifted.
  'mobile.conference.ongoingTitle': 'In a meeting',
  'mobile.conference.ongoingBody':
    'Your microphone stays on while Chatofy is in the background. The camera turns off.',
  // ---- mobile.conference: error / edge states ----
  'mobile.conference.permissionDeniedHint':
    'Open Settings and allow this app to use the camera and microphone, then try again.',
  'mobile.conference.notAuthenticated': 'Sign in to join the meeting.',
  // ---- mobile.conference: translation UX (subtitles, transcript, language) ----
  // The picker only takes effect before joining; once in the call it is a readout.
  'mobile.conference.sourceLanguageLocked': 'Language is fixed for this meeting.',
  'mobile.conference.showTranscript': 'Show transcript',
  'mobile.conference.hideTranscript': 'Hide transcript',
  'mobile.conference.transcriptEmpty': 'Nothing has been said yet.',
  // ---- mobile.conference: in-meeting chat (translated per recipient) ----
  'mobile.conference.showChat': 'Show chat',
  'mobile.conference.hideChat': 'Hide chat',
  'mobile.conference.minutesGenerating': 'Summarizing the meeting…',
  'mobile.conference.minutesEmpty':
    'No minutes yet. Anyone who was in the meeting can generate them.',
  'mobile.auth.noAccountPrompt': 'No account yet?',
  'mobile.auth.linkExpired': 'This link has expired or was already used. Ask for a new one.',
  'mobile.auth.fillAllFields': 'Fill in every field.',
  'mobile.auth.nameTooLong': 'That name is too long.',
  'mobile.auth.invalidEmail': 'Enter a valid email address.',
  'mobile.auth.passwordTooLong': 'That password is too long.',
  'mobile.auth.passwordMismatch': 'The passwords don’t match.',
  'mobile.auth.confirmPassword': 'Confirm password',
  'mobile.auth.verifyDone': 'Your email is verified. You can sign in now.',
  'mobile.auth.resetDone': 'Password changed. Sign in with your new password.',
  'mobile.auth.linkMissingToken': 'This link is incomplete. Open the link from the email again.',
  'mobile.translate.micDenied':
    'Chatofy needs the microphone to translate. Allow it in Settings, then try again.',
  'mobile.translate.micInUse':
    'A meeting is using the microphone. Leave the meeting, then start translating.',
  'mobile.translate.unheard': 'Not read aloud',
  'mobile.auth.signInTitle': 'Sign in',
  'mobile.auth.missingFields': 'Enter your email and password.',
  'mobile.auth.invalidCredentials': 'Wrong email or password.',
  'mobile.auth.tooManyAttempts': 'Too many attempts. Wait a minute and try again.',
  'mobile.auth.signInFailed': 'Couldn’t sign in. Check your connection and try again.',
  'mobile.settings.signedInAs': 'Signed in as {email}',
  'mobile.settings.signedOut': 'You’re not signed in.',
  'mobile.settings.audio.voiceProcessingHint':
    'Turns the phone’s voice processing on or off. When off, the microphone pauses while a translation plays. Meeting audio isn’t affected.',
  'mobile.settings.audio.lockedHint':
    'The phone turns this on and off together with echo cancellation.',

  // Buying happens on the web; the phone only links there.
  'mobile.settings.buyOnWeb': 'Buy credits on the web',

  // Account preferences on the phone's Settings.
  'mobile.settings.sync.note': 'Your translation settings sync across your devices.',
  'mobile.settings.sync.error': 'Couldn’t save your settings. Retrying…',
  'mobile.settings.sync.refused': 'Couldn’t save that change, so your saved settings are shown.',
  'mobile.settings.sync.reset': 'Reset to defaults',
  'mobile.settings.sync.resetTitle': 'Reset all settings?',
  'mobile.settings.sync.resetBody':
    'Your language pairs, voices and meeting options go back to their defaults on every device.',
  'mobile.settings.sync.resetFailed':
    'Couldn’t reset your settings. Check your connection and try again.',

  // ---- web.glossary ----
  'web.glossary.title': 'Glossaries',
  'web.glossary.new': 'New glossary',
  'web.glossary.loadFailed': 'Couldn’t load your glossaries. Check your connection and try again.',
  'web.glossary.emptyTitle': 'No glossaries yet',
  'web.glossary.emptyList':
    'A glossary makes sure your names and terms are translated the way you want. Press New glossary to make one.',
  'web.glossary.termCount': '{count} terms',
  'web.glossary.badgeInactive': 'Off',
  'web.glossary.delete': 'Delete',
  'web.glossary.viewOnly': 'View only',
  'web.glossary.nameLabel': 'Name',
  'web.glossary.descriptionLabel': 'Description',
  'web.glossary.sourceLangLabel': 'Source language',
  'web.glossary.createFailed': 'Couldn’t create the glossary. Try again.',
  'web.glossary.creating': 'Creating…',
  'web.glossary.create': 'Create',
  'web.glossary.cancel': 'Cancel',
  'web.glossary.originalLabel': 'Original',
  'web.glossary.translationLabel': 'Translation',
  'web.glossary.targetLangLabel': 'Target language',
  'web.glossary.notesLabel': 'Notes',
  'web.glossary.notesPlaceholder': 'Add a note (optional)',
  'web.glossary.addTermFailed': 'Couldn’t add the term. Try again.',
  'web.glossary.adding': 'Adding…',
  'web.glossary.addTerm': 'Add term',
  'web.glossary.filterTerms': 'Filter terms…',
  'web.glossary.loadTermsFailed': 'Couldn’t load the terms. Try again.',
  'web.glossary.noTermsMatch': 'No terms match that.',
  'web.glossary.noTerms': 'No terms yet.',
  'web.glossary.selectGlossary': 'Choose a glossary to see its terms.',
  'web.glossary.termsHeading': 'Terms',
  'web.glossary.createTitle': 'New glossary',
  'web.glossary.createDescription': 'Name it for what it covers. You’ll add terms next.',
  'web.glossary.created': 'Glossary “{name}” created',
  'web.glossary.deleted': 'Glossary “{name}” deleted',
  'web.glossary.deleting': 'Deleting…',
  'web.glossary.deleteFailed': 'Couldn’t delete the glossary, so it’s still here. Try again.',
  'web.glossary.deleteConsequence':
    'All its terms are deleted too, and translations stop using them. You can’t undo this.',
  'web.glossary.activeLabel': 'Use while translating',
  'web.glossary.turnedOn': '“{name}” is used while translating',
  'web.glossary.turnedOff': '“{name}” is no longer used while translating',
  'web.glossary.toggleFailed': 'Couldn’t change “{name}”. Try again.',
  'web.glossary.back': 'All glossaries',
  'web.glossary.editTerm': 'Edit',
  'web.glossary.editTermNamed': 'Edit {term}',
  'web.glossary.editTermTitle': 'Edit term',
  'web.glossary.termDescription':
    'The original is what’s said. The translation is how you want it to come out.',
  'web.glossary.save': 'Save',
  'web.glossary.saving': 'Saving…',
  'web.glossary.updateTermFailed': 'Couldn’t save the term. Try again.',
  'web.glossary.translatesTo': 'translates to',
  'web.glossary.termAdded': 'Added “{term}”',
  'web.glossary.termUpdated': 'Saved “{term}”',
  'web.glossary.termDeleted': 'Deleted “{term}”',
  'web.glossary.termDeleteFailed': 'Couldn’t delete the term, so it’s still here. Try again.',
  'web.glossary.oldTermKept': 'The new “{term}” is saved, but the old one is still listed.',
  // ---- extension: the browser extension's popup, overlay, microphone page and manifest ----
  //
  // Only what the extension says and no other surface does. Words it shares with
  // web and mobile — sign-in fields, credits, mic processing names, the theme
  // toggle, language names — are read from `common.*` instead.
  //
  // The manifest strings reach Chrome through generated `_locales/*/messages.json`
  // (see `apps/extension/wxt.config.ts`), so they are plain text: no placeholders.
  'extension.manifest.name': 'Chatofy call translator',
  'extension.manifest.description':
    'Translates your browser calls both ways: what others say, and what you say.',
  'extension.manifest.toggleCommand': 'Start or stop Chatofy in this call’s tab',
  // The right-click menu item on a meeting page.
  'extension.menu.start': 'Chatofy: start translating',
  'extension.menu.stop': 'Chatofy: stop translating',

  // The recording notice, shown once before anything else in the popup.
  'extension.consent.title': 'Before you start',
  'extension.consent.recordsAudio': 'This records the meeting’s audio.',
  'extension.consent.whereAudioGoes':
    'Everything said in this tab is sent to your Chatofy server to be translated. Other people in the meeting aren’t told by their own app.',
  'extension.consent.loudspeaker':
    'If the translation plays through a loudspeaker, your microphone picks it up and the meeting hears it too.',
  'extension.consent.acknowledge': 'I understand',

  // The popup header's capture state, and the primary action.
  'extension.capture.recording': 'Recording',
  'extension.capture.idle': 'Idle',
  'extension.capture.start': 'Start',
  'extension.capture.stop': 'Stop',

  'extension.signIn.intro':
    'Chatofy translates through your account. Sign in to start translating.',

  // The language pair picker's words; the language names are `common.languageName.*`.
  'extension.languagePair.label': 'Languages',
  'extension.languagePair.source': 'Source',
  'extension.languagePair.translation': 'Translation',
  'extension.languagePair.swap': 'Swap languages: translate {from} into {to}',

  'extension.settings.context': 'AI Context',
  'extension.settings.noContext': 'No context',
  'extension.settings.speech': 'Speech',
  'extension.settings.voice': 'Voice',
  'extension.settings.voiceFemale': 'Female',
  'extension.settings.voiceMale': 'Male',
  'extension.settings.outbound': 'Also translate what I say',
  'extension.settings.microphoneNeeded':
    'Chrome hasn’t given Chatofy your microphone yet. Without it, nothing you say gets translated.',
  'extension.settings.allowMicrophone': 'Allow microphone',
  'extension.settings.audioProcessing': 'Audio processing',
  'extension.settings.echoCancellationDetail':
    'Removes the meeting audio your microphone picks up.',
  'extension.settings.noiseSuppressionDetail':
    'Filters steady background noise from your microphone.',
  'extension.settings.autoGainControlDetail': 'Evens out your microphone volume as you speak.',
  'extension.settings.appearance': 'Appearance',
  'extension.settings.runsOn': 'Runs on',
  'extension.settings.enableOnMeetings': 'Enable Chatofy on call pages',
  // Beside the platform the popup was opened over.
  'extension.settings.thisTab': 'this tab',
  'extension.settings.zoomDetail': 'web client only, not the desktop app',
  'extension.settings.facebookDetail': 'Messenger and group calls',
  'extension.settings.signedIn': 'Signed in',

  // The credits block in the popup. Amounts and plan names come from `common.billing.*`.
  'extension.credits.loading': 'Loading…',
  // {plan} is `common.billing.planFree` or `common.billing.planPro`.
  'extension.credits.plan': '{plan} plan',
  'extension.credits.buyOnWeb': 'Buy credits on the Chatofy website, under Account.',
  'extension.credits.signInToSee': 'Sign in to see your credits',
  'extension.credits.loadFailed': 'Couldn’t load your credits (HTTP {status}). Try again.',
  'extension.credits.usageLoadFailed': 'Couldn’t load your usage (HTTP {status}). Try again.',
  'extension.credits.unreadable': 'Couldn’t load your credits. Try again.',
  'extension.credits.usageUnreadable': 'Couldn’t load your usage. Try again.',
  // Mid-meeting: unlike web, there is no history page to point at.
  'extension.credits.exhausted':
    'Your credits ran out, so translation stopped. Buy more on the Chatofy website.',
  'extension.credits.lowUnknown':
    'Your credits are running low. Translation keeps going until they run out.',

  // The popup footer's one line about this tab.
  'extension.status.ready': 'Ready.',
  'extension.status.offOn': 'Chatofy is off on {site}.',
  'extension.status.unavailable': 'Not available on this tab.',
  'extension.status.noTab': 'No tab to capture.',
  'extension.status.capturing': 'Capturing this tab.',
  'extension.status.capturingForYou': 'Capturing this tab. Your speech is translated for you only.',
  'extension.status.capturingIntoMeeting':
    'Capturing this tab, and translating your speech into the meeting.',
  // A failure, named by which side of the meeting it belongs to.
  'extension.status.meetingAudioError': 'Meeting audio: {error}',
  'extension.status.microphoneError': 'Your microphone: {error}',

  // Why the tab under the popup cannot be captured.
  'extension.support.noTab': 'Open a meeting tab first.',
  'extension.support.notMeeting': 'This tab isn’t a meeting.',
  'extension.support.zoomDesktop':
    'This looks like Zoom, but not its web client. The desktop app isn’t a browser tab, so Chatofy can’t capture its audio. Use “Join from your browser” instead.',

  // Failures a capture reports, shown in the popup and the overlay.
  'extension.error.unreachable': 'Can’t reach {origin}. Check your connection and try again.',
  'extension.error.signInFailed': 'Couldn’t sign in (HTTP {status}). Try again.',
  'extension.error.signInFirst': 'Sign in from the Chatofy popup first',
  'extension.error.tabClosed': 'The meeting tab was reloaded or closed. Start Chatofy on it again.',
  'extension.error.microphoneFailed': 'Couldn’t translate what you say. Try again.',
  'extension.error.captureFailed': 'Couldn’t start translating. Try again.',
  'extension.error.tabCaptureFailed': 'Couldn’t translate this tab. Try again.',
  'extension.error.preparePageFailed':
    'Couldn’t set up your microphone on this page ({reason}). Try again.',
  'extension.error.contextsSignIn': 'Sign in to use an AI Context',
  'extension.error.contextsLoadFailed':
    'Couldn’t load your AI Contexts (HTTP {status}). Try again.',
  'extension.error.contextsUnreadable': 'Couldn’t load your AI Contexts. Try again.',
  // {action} is `extension.settings.allowMicrophone`, quoted as the button reads.
  'extension.error.microphoneBlocked':
    'Chrome hasn’t given Chatofy your microphone. Open the Chatofy popup and choose “{action}”.',

  // The page that raises Chrome's microphone prompt.
  'extension.microphone.pageTitle': 'Chatofy — microphone access',
  'extension.microphone.title': 'Chatofy needs your microphone',
  // One sentence in three parts, so the middle can be bold.
  'extension.microphone.whyBefore': 'This is what lets Chatofy translate ',
  'extension.microphone.whyEmphasis': 'what you say',
  'extension.microphone.whyAfter':
    ' into the meeting. Translating what others say doesn’t need it.',
  'extension.microphone.askOnce':
    'Chrome asks once and remembers the answer for Chatofy, not for one meeting. The microphone is only on while a capture is running.',
  'extension.microphone.granted':
    'Microphone allowed. You can close this tab and start translating.',
  'extension.microphone.refused': 'Chrome blocked the microphone.',
  'extension.microphone.openFailed': 'Couldn’t open the microphone: {error}',
  'extension.microphone.unknownError': 'unknown error',
  'extension.microphone.alreadyGranted': 'Chatofy already has your microphone. You’re all set.',
  // Around a chrome:// address, which stays as written.
  'extension.microphone.recoverBefore':
    'Chrome remembers an earlier refusal, so it won’t ask again. Paste ',
  'extension.microphone.recoverAfter':
    ' into the address bar, find Chatofy in the blocked list, and remove it. Then reopen this page.',

  // The overlay drawn over the meeting page.
  'extension.overlay.capturingIndicator': 'Chatofy is capturing this meeting’s audio',
  'extension.overlay.collapse': 'Collapse',
  'extension.overlay.collapseLabel': 'Collapse Chatofy',
  'extension.overlay.languagePair': 'Translate',
  // {source} and {target} are `common.languageName.*`.
  'extension.overlay.pairOption': '{source} into {target}',
  'extension.overlay.voice': 'Voice',
  'extension.overlay.voiceFemale': 'Female voice',
  'extension.overlay.voiceMale': 'Male voice',
  'extension.overlay.pillLive': 'Chatofy is capturing this meeting’s audio. Open to stop',
  'extension.overlay.pillIdle': 'Open Chatofy',
  'extension.overlay.firstTimeShortcut':
    'First time here: press {shortcut}, or right-click → Chatofy',
  'extension.overlay.firstTimeMenu': 'First time here: right-click → Chatofy',
  'extension.overlay.listening': 'Listening…',
  'extension.overlay.notCapturing': 'Not translating',
  // Marks the reader's own lines in the transcript.
  'extension.overlay.you': 'You',
  'extension.overlay.outboundSending': 'Your speech is being translated into the meeting.',
  'extension.overlay.outboundMuted':
    'You’re muted in the meeting, so nothing you say is captured or translated.',
  'extension.overlay.outboundUnpatchedShortcut':
    'Your speech is translated for you only. To send it to the meeting, reload this page, then press {shortcut} to start again.',
  'extension.overlay.outboundUnpatchedMenu':
    'Your speech is translated for you only. To send it to the meeting, reload this page, then right-click → Chatofy to start again.',
  'extension.overlay.outboundForYou':
    'Your speech is translated for you only. Others hear your own voice.',
} as const;

/** Every key any locale must carry. Derived, so a locale cannot drift from it. */
export type MessageKey = keyof typeof en;

/** A complete locale. `tsc` refuses one that is missing a key. */
export type Messages = Record<MessageKey, string>;
