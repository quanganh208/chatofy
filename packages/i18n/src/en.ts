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
  'common.theme.light': 'Light',
  'common.theme.dark': 'Dark',
  'common.theme.system': 'Match system',
  'common.theme.label': 'Colour theme',
  // Account preferences: one copy per account, shared by every app and device.
  'common.preferences.title': 'Your preferences',
  'common.preferences.syncNote': 'Synced across your devices',
  'common.preferences.saving': 'Saving…',
  'common.preferences.saved': 'Saved',
  'common.preferences.saveRetrying': "Couldn't save, retrying",
  'common.preferences.saveRefused': "Couldn't save that change",
  'common.preferences.reset': 'Reset to defaults',
  'common.preferences.resetPending': 'Resetting…',
  'common.preferences.resetNote':
    'Theme, languages, voices, display and call settings go back to their defaults on all your devices. Your AI contexts, glossaries and history stay.',
  'common.preferences.resetFailed': "Couldn't reset. Check your connection and try again.",
  'common.preferences.resetDone': 'Preferences reset',
  // Mic processing: named as Saydi names them, because that is what people compare.
  'common.audio.title': 'Audio settings',
  'common.audio.echoCancellation': 'Echo cancellation',
  'common.audio.noiseSuppression': 'Noise suppression',
  'common.audio.autoGainControl': 'Automatic gain control',
  'common.audio.recommendation':
    'Recommended: off with headphones; may be on with external speakers.',
  'common.language.vietnamese': 'Tiếng Việt',
  'common.language.english': 'English',
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
  'common.conference.lobbyTitle': 'Video conference',
  'common.conference.create': 'Create a room',
  'common.conference.join': 'Join a room',
  'common.conference.yourName': 'Your name',
  'common.conference.yourNamePlaceholder': 'How others will see you',
  'common.conference.roomId': 'Room ID',
  'common.conference.roomIdPlaceholder': 'Enter a room ID to join',
  'common.conference.sourceLanguage': 'Your language',
  'common.conference.start': 'Start',
  'common.conference.leave': 'Leave',
  'common.conference.waiting': 'Waiting for others to join…',
  'common.conference.connecting': 'Connecting…',
  'common.conference.you': 'You',
  // The translated voice: what others hear this speaker's translation in.
  'common.conference.translatedVoice': 'Translated voice',
  'common.conference.translatedVoiceHint': 'Others hear your translated speech in this voice.',
  'common.conference.voiceFemale': 'Female',
  'common.conference.voiceMale': 'Male',
  'common.conference.muteMic': 'Mute microphone',
  'common.conference.unmuteMic': 'Unmute microphone',
  'common.conference.disableCamera': 'Turn off camera',
  'common.conference.enableCamera': 'Turn on camera',
  'common.conference.participants': 'Participants',
  'common.conference.cameraOff': 'Camera off',
  'common.conference.rosterTitle': 'In this call',
  'common.conference.hideRoster': 'Hide participants',
  // Flat side region — ghost/outline controls only; Leave stays the one accent control.
  'common.conference.chatTitle': 'Chat',
  'common.conference.chatPlaceholder': 'Type a message…',
  'common.conference.chatSend': 'Send',
  'common.conference.chatEmpty': 'No messages yet.',
  'common.conference.permissionDenied': 'Camera and microphone access is required.',
  'common.conference.permissionDeniedAudioOnly': 'No camera access — joining with audio only.',
  'common.conference.disconnected': 'Connection lost.',
  'common.conference.disconnectedHint': 'The call ended. Return to the lobby to rejoin.',
  'common.conference.backToLobby': 'Back to lobby',
  'common.conference.errorGeneric': 'Something went wrong.',
  // Quiet readout when the speaker's translation ended for good mid-call.
  'common.conference.translationEnded':
    'Translation stopped — others now hear you without it. Rejoin the call to restart it.',
  // The same readout, when the speaker ran out of credits.
  'common.conference.translationEndedNoCredits':
    'Translation stopped because your credits ran out — others now hear you without it.',
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
  'common.conference.createFailed': 'Could not create a room. Try again.',
  'common.conference.roomNotFound': 'This room does not exist.',
  'common.conference.roomEnded': 'This meeting has ended.',
  // The minutes strings themselves are `common.minutes.*`: the end screen
  // renders the same minutes panel as /translate and history.
  'common.conference.endedTitle': 'Meeting ended',
  'common.conference.endedLoading': 'Loading the meeting…',
  'common.conference.endedNotFound': 'You were not in this meeting, or it does not exist.',
  'common.conference.endedLoadFailed': 'Could not load this meeting. Try again later.',
  'common.conference.summaryDuration': 'Duration',
  'common.conference.summaryLanguages': 'Languages',
  'common.conference.durationMinutes': '{minutes} min',
  'common.conference.durationHours': '{hours} h {minutes} min',
  'common.conference.durationUnknown': 'Not recorded',
  // A participant who joined without a name.
  'common.conference.guest': 'Guest',
  'common.conference.chatRateLimited': 'Slow down — wait a few seconds before sending again.',
  'common.conference.chatNotSent': 'Message not sent.',

  // ---- common.billing: the credits words web and mobile both show ----
  // The section and block title on web Settings › Billing and mobile settings.
  'common.billing.title': 'Credits & plan',
  // Amounts are pre-formatted by the caller; English needs the singular by hand.
  'common.billing.creditAmount': '{credits} credits',
  'common.billing.creditAmountOne': '1 credit',
  'common.billing.totalCredits': 'Credits left',
  'common.billing.planCredits': 'Plan credits',
  'common.billing.planResetsOn': 'Reset on {date}',
  'common.billing.topupCredits': 'Top-up credits',
  'common.billing.topupNeverExpire': 'Never expire',
  'common.billing.currentPlan': 'Plan',
  'common.billing.planFree': 'Free',
  'common.billing.planPro': 'Pro',
  'common.billing.proSourcePolar': 'Card subscription, renews automatically',
  'common.billing.proSourceSepay': 'VietQR pass, ends {date}',
  'common.billing.loadFailed': 'Could not load your credits. Try again.',
  // Turn refused at start: the balance is under one credit.
  'common.billing.startRefused': 'You need at least 1 credit to start translating.',
  // The balance ran out mid-conversation; what was said is kept.
  'common.billing.exhausted':
    'Your credits ran out, so translation stopped. Everything said so far is saved to history.',
  // A notice, not a failure: the conversation keeps going. {credits} is a
  // formatted `common.billing.creditAmount` string, e.g. "2 credits".
  'common.billing.low': 'About {credits} left. Translation keeps going until they run out.',
  'common.billing.unavailable':
    'Your credits could not be checked just now, so translation did not start. Try again in a moment.',
  // Why buying is disabled for everyone but the owner.
  'common.billing.checkoutClosed':
    'Buying credits is not open to the public. Chatofy is a non-commercial thesis project, and only its owner can check out.',
  // Usage history rows.
  'common.billing.usageTitle': 'Usage',
  'common.billing.usageEmpty': 'Nothing used yet.',
  'common.billing.usageLoadFailed': 'Could not load your usage. Try again.',
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
  'common.minutes.failed': 'Could not generate minutes. Try again.',
  'common.minutes.summary': 'Summary',
  'common.minutes.keyPoints': 'Key points',
  'common.minutes.decisions': 'Decisions',
  'common.minutes.actionItems': 'Action items',
  'common.minutes.noActionItems': 'No action items.',
  'common.minutes.owner': 'Owner',
  'common.minutes.due': 'Due',
  'common.minutes.nothingSaid':
    'Nothing was said in this meeting, so there is nothing to summarize.',

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
  'web.chrome.navConference': 'Meetings',
  'web.chrome.navHistory': 'History',
  'web.chrome.navGlossary': 'Glossary',
  // Its own key rather than reusing `accountMenu`. That one names the avatar
  // control ("open your account menu"); this one names a destination, and a
  // locale may well want two different words.
  'web.chrome.navAccount': 'Account',
  'web.chrome.toggleSidebar': 'Toggle the sidebar',
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
  'web.chrome.confirmIrreversible': 'This cannot be undone.',
  'web.chrome.accountMenu': 'Account',
  'web.chrome.signedInAs': 'Signed in as',
  'web.chrome.getStarted': 'Get started',
  'web.chrome.openApp': 'Open Chatofy',

  // ---- web.auth ----
  'web.auth.name': 'Name',
  'web.auth.newPassword': 'New password',
  'web.auth.createAccount': 'Create account',
  'web.auth.createAccountHeading': 'Create an account',
  'web.auth.creatingAccount': 'Creating account…',
  'web.auth.haveAccountPrompt': 'Already have an account?',
  // Two of them, because they are two different strings in two places: the link
  // under the form is terse, the page it leads to is a question.
  'web.auth.forgotPasswordShort': 'Forgot password?',
  'web.auth.forgotPasswordLink': 'Forgot your password?',
  'web.auth.forgotPasswordBody':
    "Enter the email on your account and we'll send a link to reset it.",
  'web.auth.backToSignIn': 'Back to sign in',
  'web.auth.resetPasswordHeading': 'Reset your password',
  'web.auth.resetPasswordSubmit': 'Reset password',
  'web.auth.resetting': 'Resetting…',
  'web.auth.chooseNewPassword': 'Choose a new password for your account.',
  'web.auth.verifyEmailHeading': 'Verify your email',
  'web.auth.verifyEmailBody': 'Confirm below to finish creating your account.',
  'web.auth.checkYourEmail': 'Check your email for a link to finish creating your account.',
  'web.auth.resetLinkSent': 'If that email has an account, a reset link is on its way.',
  'web.auth.passwordTooShort': 'Password is too short',
  'web.auth.createFailed': 'Could not create the account. Try again.',
  'web.auth.resetFailed': 'Could not reset the password. Try again.',
  'web.auth.sendResetFailed': 'Could not send the reset link. Try again.',
  'web.auth.verifyFailed': 'Could not verify this link. Try again.',
  'web.auth.serverUnreachable': 'Cannot reach the server.',
  'web.auth.tookTooLong': 'That took too long — try again.',
  'web.auth.unexpectedResponse': 'Unexpected response from the server.',
  'web.auth.accountRequired':
    'Translating needs an account — every session and transcript belongs to one.',
  'web.auth.orContinueWithEmail': 'or continue with email',
  'web.auth.continueWithGoogle': 'Continue with Google',
  'web.auth.credentialsRejected': 'That email and password did not match an account.',
  'web.auth.sendResetLink': 'Send reset link',
  'web.auth.sending': 'Sending…',
  'web.auth.verifyEmailSubmit': 'Verify email',
  'web.auth.verifying': 'Verifying…',
  'web.auth.resetLinkMissingCode': 'That link is missing its reset code.',
  'web.auth.verifyLinkMissingCode': 'That link is missing its verification code.',
  'web.auth.accountExists': 'That account already exists.',
  // The two `?error=` values `auth.ts` can produce, worded apart on purpose: one is
  // about this account and the other is a fault on our side.
  'web.auth.googleRefused':
    'That Google account could not be used to sign in. If you already have a password for this email, sign in with it below.',
  'web.auth.signInServerFault':
    'Sign-in is unavailable right now — that is a problem on our side, not with your email or password. Try again in a moment.',
  'web.auth.signInUnavailable':
    'Sign-in is unavailable right now — that is a problem on our side, not with your account. Try again shortly, or sign in with your password below.',
  // What the api answers with, in the reader's language. The wire carries a code;
  // these are the words. See `authMessageCodeSchema` in `@chatofy/types`.
  'web.auth.noticeVerified': 'Your account is ready. Sign in below to get started.',
  'web.auth.noticeReset': 'Your password has been changed. Sign in with your new password.',

  // ---- web.meta: the browser tab, which is a string a person reads ----
  'web.meta.home': 'Chatofy — real-time voice translation for conversations and online meetings',
  'web.meta.homeDescription':
    'Chatofy translates speech in real time between Vietnamese, English and Chinese — in face-to-face conversations, in video meetings, and inside Google Meet, Zoom and Facebook calls.',
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
    'Chatofy plans: a free monthly allowance, Pro, and top-ups that never expire. One credit is one minute of translated captions.',

  // ---- web.translate ----
  'web.translate.startTranslating': 'Start translating',
  'web.translate.startConversation': 'Start conversation',
  'web.translate.end': 'End',
  'web.translate.pause': 'Pause',
  'web.translate.resume': 'Resume',
  'web.translate.notListening': 'Not listening',
  'web.translate.connecting': 'Connecting…',
  'web.translate.reconnecting': 'Reconnecting…',
  'web.translate.listening': 'Listening — just start talking',
  'web.translate.hearingYou': 'Hearing you…',
  'web.translate.translating': 'Translating…',
  'web.translate.speaking': 'Speaking',
  // The microphone is off and the conversation is not. Says the state, not the
  // action — the button beside it is what offers the way out.
  'web.translate.paused': 'Paused',
  // The microphone is already off; what is left is the last translation being
  // spoken. Named for what it is waiting on, so the wait does not read as a hang.
  'web.translate.finishing': 'Finishing — speaking the last translation',
  // Static, and read once. The number beside it changes every second, and a
  // screen reader announcing it every second would drown out the transcript.
  'web.translate.elapsedLabel': 'Time since this conversation started',
  'web.translate.transcriptEmpty': 'Nothing yet — start a conversation and both sides appear here.',
  // One per panel, because with the two panels side by side a single sentence
  // spanning both says nothing about which column is which. `transcriptEmpty`
  // above is still the wording where there is only one column to explain.
  'web.translate.panelSourceEmpty': 'What you say appears here.',
  'web.translate.panelTargetEmpty': 'The translation appears here.',
  'web.translate.speakTranslation': 'Speak translation',
  'web.translate.speakTranslationAria': 'Speak the translation aloud',
  // The panel header carries a MARK, not a control, so the state has to be in
  // words: an icon that differs only by a slash says nothing to a screen reader.
  'web.translate.speakOn': 'on',
  'web.translate.speakOff': 'off',
  // Why the toggle is refusing, said as the thing to do instead. The server skips
  // synthesis outright when this is off and decides that once, at session start,
  // so mid-conversation there is nothing to change.
  'web.translate.speakLocked': 'Set this before the conversation starts',
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
  'web.translate.paneSource': 'Source transcript',
  'web.translate.paneTarget': 'Translation transcript',
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
  // Two gears' worth of settings, named for what each is about. They were one,
  // which meant the icon at the bottom covered both the voice and the page layout
  // while the speaker in the panel header configured nothing.
  'web.translate.voiceSettings': 'Voice settings',
  'web.translate.voiceSettingsFor': 'Voice for {language}',
  'web.translate.displaySettings': 'Display settings',
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
  'web.translate.captionWindowFailed': 'Picture-in-picture could not open. Try again.',
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
  'web.translate.contextLocked': 'The context stays fixed until this conversation ends.',
  // Said beside Start, not instead of it: a stored selection that has not yet
  // resolved must not let a conversation start silently unhinted.
  'web.translate.contextLoading': 'Loading your AI Context…',
  'web.translate.contextUnavailable':
    'Could not load your AI Context. Starting now runs without it.',
  'web.translate.registerNeutral': 'Neutral',
  'web.translate.registerFormal': 'Formal',
  'web.translate.registerCasual': 'Casual',
  'web.translate.languagePair': 'Languages',
  'web.translate.languagePairSource': 'Source',
  'web.translate.languagePairTarget': 'Translation',
  // Interpolated, because the accessible name has to say what pressing it DOES:
  // "swap" alone is a verb with no object.
  'web.translate.languagePairSwap': 'Swap languages — translate {from} into {to}',
  // The same button while the source is Auto-detect: there is no source language
  // to trade places with, so the name says why it is off instead.
  'web.translate.languagePairSwapDetect': 'Swap languages — not available with Auto-detect',
  // The one-way source picker's first entry: leave the spoken language to be
  // recognised, turn by turn, and translate it into the chosen translation language.
  'web.translate.autoDetect': 'Auto-detect',
  // A readout under the source header, never a control: which way the running
  // conversation actually translates, as the server answered it.
  'web.translate.modeTwoWay': 'Both ways',
  'web.translate.modeOneWay': 'One way',
  // Beside a language the two-way page lists but cannot run: its turns cannot be
  // told apart from the other language's yet.
  'web.translate.twoWayLanguageUnavailable': 'not available two-way yet',
  // The accessible name beside a turn's short language tag.
  'web.translate.turnLanguage': 'Spoken in {language}',
  // A two-way conversation the service is running one way for now. Says what the
  // reader gets instead, so a reply that is not translated is not a surprise.
  'web.translate.twoWayUnavailable':
    'Translating one way for now: {from} into {to}. Anything said in {to} stays untranslated.',
  'web.translate.detectUnavailable':
    'Auto-detect is not available right now. Choose the language being spoken to continue.',
  'web.translate.detectBusy':
    'Auto-detect is busy right now. Try again in a moment, or choose the language being spoken.',
  'web.translate.voiceDefault': 'Default',
  'web.translate.voiceListFailed':
    'Could not load the voice list. The gender choice above still applies.',
  // On a turn whose translation was never played: the playback queue passed its
  // ceiling and dropped it, or the stall watchdog released it. Says what is
  // missing (the audio) and what is not (the text, which is right above it).
  //
  // The only thing that reports a dropped turn. A paragraph under the speed
  // control used to warn ahead of time that rates below 1× can cost whole turns;
  // it was removed as redundant, because this marks the turn that was actually
  // lost, at the moment it is lost, on the row it belongs to.
  'web.translate.turnUnheard': 'Not spoken — playback fell behind',
  'web.translate.transcriptListening':
    'Listening. The conversation will appear here as it is translated.',
  'web.translate.transcriptAttribution': 'Each turn can be marked with who said it.',
  // ---- the repaired line, and the words underneath it ----
  // Shown only on a turn that was repaired. Named for what it reveals — the
  // recognizer's own output — rather than "original", which a reader could take
  // to mean the audio, or the other language.
  'web.translate.sourceRawToggle': 'As heard',
  'web.translate.sourceRawLabel': 'Recognized:',
  // ---- who spoke ----
  // The fallback chip asks rather than naming anybody: a turn nobody attributed
  // must never read as a person, in any language.
  'web.translate.speakerUnknown': 'Who spoke?',
  'web.translate.speakerAsk': 'Say who spoke',
  // A turn the acoustic layer heard and has not placed yet. Distinct words from
  // `speakerUnknown`, because the two chips promise different things — this one
  // owes an answer and that one does not — and styling alone carries that
  // difference to sighted readers only.
  'web.translate.speakerPending': 'Working out who…',
  'web.translate.speakerPendingAria': 'Still working out who spoke. Say who, or wait.',
  'web.translate.speakerChange': 'Said by {name}. Change.',
  'web.translate.speakerNobody': 'Nobody',
  'web.translate.speakerAdd': 'Add a person',
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
  'web.translate.speakerRemoveBlockedAria': 'Cannot remove {name}: they are named on a turn',
  'web.translate.speakerLimit': 'Limit is {max} people',
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
  'web.translate.micBusy':
    'Another app is holding the microphone. Close it, then start the conversation again.',
  'web.translate.serviceUnreachable':
    'The translation service is unreachable. Starting a conversation will not work yet.',
  'web.translate.micFailed': 'The microphone could not be started.',
  'web.translate.micPausedDuringPlayback': 'Microphone paused while the translation plays',

  // A failed save, split by whether resending the SAME conversation could ever
  // work. Retryable offers a button; terminal does not, because it never could.
  'web.translate.saveFailedRetryable':
    'This conversation has not been saved yet. It will not appear in your history until it is.',
  'web.translate.saveFailedTerminal':
    'This conversation could not be saved, so it will not appear in your history and cannot be summarized.',
  // A different fact from either of the two above: the conversation IS in the
  // history, and only what was changed after it was stored is missing.
  'web.translate.saveEditsFailed':
    'Your latest changes were not saved. The conversation itself is in your history.',
  'web.translate.saveRetry': 'Save again',
  'web.translate.saving': 'Saving…',
  // The RECORDING failed, which is a different loss from the transcript failing
  // and has to read that way: the words are in the history either way, and only
  // the audio is missing. Saying "could not be saved" here would tell a reader
  // they lost the conversation.
  'web.translate.recordingFailedRetryable':
    'The recording has not been saved yet. The conversation itself is in your history.',
  'web.translate.recordingFailedTerminal':
    'The recording could not be saved, so this conversation has no audio to play back. The conversation itself is in your history.',
  'web.translate.recordingUploading': 'Saving the recording…',
  'web.translate.minutesNeedsSave': 'Minutes are generated from the saved conversation.',
  // ---- web.translate.minutes: LLM meeting minutes over a finished conversation ----
  'web.translate.minutesGenerating': 'Summarizing the conversation…',
  'web.translate.minutesEmpty':
    'No minutes yet. Generate them for a summary, key points, decisions and action items.',
  'web.translate.minutesNeedsTurns':
    'Have a conversation first — there is nothing to summarize yet.',
  'web.translate.minutesCopy': 'Copy',
  'web.translate.minutesCopiedToast': 'Minutes copied',
  'web.translate.minutesCopyFailed': 'The minutes could not be copied.',

  // ---- web.error: the boundaries every route group now has ----
  'web.error.title': 'Something went wrong',
  'web.error.retry': 'Try again',
  'web.error.appBody':
    'That did not load. Try again, and if it keeps happening the translation service may be unreachable.',
  'web.error.authBody':
    'That step could not be completed. The link may have expired — request a new one and try again.',
  'web.error.pageDidNotLoad': 'This page did not load. Try again.',
  'web.error.notFound': 'This page does not exist',
  'web.error.notFoundBody':
    'The address may have changed, or the link that brought you here may be out of date.',
  'web.error.goToStart': 'Go to the start',

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
    'Conversations you finish are saved here, so you can read them again and summarize them later.',
  'web.history.searchLabel': 'Search your conversations',
  'web.history.searchPlaceholder': 'Search…',
  'web.history.searchNoResults': 'No conversations match that.',
  // The recovery from a search that matched nothing. Without it the only way
  // back to the full list is selecting the field and deleting what you typed.
  'web.history.clearSearch': 'Clear search',
  'web.history.back': 'Back to history',
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
  'web.history.copyFailed': 'Could not copy the transcript.',
  'web.history.downloadTranscript': 'Download transcript',
  'web.history.downloadText': 'Text (.txt)',
  'web.history.downloadMarkdown': 'Markdown (.md)',
  'web.history.downloadMarkdownMinutes': 'with minutes',
  'web.history.downloadSubtitles': 'Subtitles (.srt)',
  // Why Subtitles is unavailable: a cue needs a start, and some lines have none.
  'web.history.subtitlesNeedTimes': 'Needs a time on every line',
  'web.history.downloadRecording': 'Download recording',
  'web.history.preparingDownload': 'Preparing the download…',
  'web.history.copying': 'Copying…',
  // The delete strip under a row, named for the conversation it deletes.
  'web.history.downloadFailed': 'Could not download it. Try again.',
  // The menu item: the ellipsis says another step follows before anything goes.
  'web.history.deleteChoice': 'Delete…',
  // Renaming, in place of the title.
  'web.history.renameLabel': 'Conversation title',
  'web.history.renameSave': 'Save',
  'web.history.renameSaving': 'Saving…',
  'web.history.renameHint': 'Up to {max} characters.',
  'web.history.renameEmpty': 'A title cannot be empty.',
  'web.history.renameTooLong': 'Keep the title to {max} characters.',
  'web.history.renameFailed': 'Could not rename this conversation. Try again.',
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
  'web.history.deleteConfirm': 'Delete this conversation and its minutes? This cannot be undone.',
  'web.history.deleting': 'Deleting…',
  'web.history.deleteFailed': 'Could not delete this conversation. It is still here.',
  'web.history.loading': 'Loading your conversations…',
  'web.history.loadFailed': 'Could not load your history. Try again.',
  'web.history.retry': 'Try again',
  'web.history.notFound': 'That conversation is no longer here.',
  // Names the two ways to arrive here, because the API answers a foreign id and
  // an absent one identically and the screen must not claim to tell them apart.
  'web.history.notFoundBody':
    'It may have been deleted, or we could not reach the server just now.',
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
  'web.history.recordingFailed': 'The recording could not be loaded.',
  'web.history.loadMore': 'Load more',
  // Beside the "Load more" control, not in place of the list: the conversations
  // already read are still on screen and still true.
  'web.history.loadMoreFailed': 'Could not load more conversations.',

  // ---- web.preferences ----
  // Rows on Settings › Translation and Settings › AI Context; the key names predate the
  // move into Settings.
  'web.preferences.audioHint': 'Applies from the next start.',
  'web.preferences.audio.echoCancellationHint':
    'Reduces speaker sound picked up by the microphone while a translation plays. When off, the microphone pauses while a translation plays.',
  'web.preferences.audio.noiseSuppressionHint': 'Filters microphone sound that is not speech.',
  'web.preferences.audio.autoGainControlHint': 'Automatically adjusts the microphone input level.',
  'web.preferences.audio.unsupported': 'Not supported by this browser.',
  'web.preferences.audio.conferenceNote':
    'In meetings, turning echo cancellation off makes other people hear their own echo.',
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
    'Tell the translator what a conversation is about before it hears any of it — the subject, names it should expect, and how particular terms should come out. Pick one when you start a conversation, here or in the browser extension.',
  'web.preferences.aiContext.empty': 'No contexts yet. Create one to get started.',
  'web.preferences.aiContext.new': 'New context',
  'web.preferences.aiContext.edit': 'Edit',
  // The library group's heading; the editor group beside it is titled for its draft.
  'web.preferences.aiContext.libraryTitle': 'Your contexts',
  // The editor group's heading when it holds a stored context.
  'web.preferences.aiContext.editTitle': 'Edit context',
  'web.preferences.aiContext.delete': 'Delete',
  'web.preferences.aiContext.deleting': 'Deleting…',
  'web.preferences.aiContext.deleteFailed': 'Could not delete this context. It is still here.',
  'web.preferences.aiContext.save': 'Save context',
  'web.preferences.aiContext.cancel': 'Cancel',
  'web.preferences.aiContext.saving': 'Saving…',
  'web.preferences.aiContext.name': 'Name',
  'web.preferences.aiContext.description': 'What the conversation is about',
  'web.preferences.aiContext.descriptionHint':
    'A few words, like "hotel check-in" or "cardiology consultation". It helps the translator choose between readings a sentence leaves open.',
  'web.preferences.aiContext.keywords': 'Names and terms to expect',
  'web.preferences.aiContext.keywordsHint':
    'Proper nouns, jargon, product names — the words most often heard wrong.',
  'web.preferences.aiContext.keywordTooLong':
    'One line is too long — at most {max} characters. Shorten it, or remove it.',
  'web.preferences.aiContext.keywordsTooMany':
    'That is {count} terms, and the limit is {max}. Remove some before saving.',
  'web.preferences.aiContext.glossary': 'Preferred renderings',
  // Says what a pair IS and what it is not, because the second half is the part
  // people get wrong: a pair is not a find-and-replace.
  'web.preferences.aiContext.glossaryHint':
    'How a particular term should come out. Write it in at least two of the languages; the translator uses the two a conversation is in, whichever way it runs, and only when the term is actually said.',
  'web.preferences.aiContext.glossaryTooLong':
    'A rendering is a word or a short phrase — at most {max} words. Shorten this pair, or remove it.',
  'web.preferences.aiContext.glossaryAdd': 'Add a pair',
  'web.preferences.aiContext.glossaryRemove': 'Remove this pair',
  'web.preferences.aiContext.glossaryLink': 'Glossary',
  'web.preferences.aiContext.glossaryLinkNone': 'None',
  'web.preferences.aiContext.glossaryLinkHint':
    'Terms from this glossary will guide the AI when translating.',
  'web.preferences.aiContext.register': 'Register',
  // The words explain the refusal rather than leaving a control dead.
  'web.preferences.aiContext.limitReached':
    'You have reached the maximum number of contexts. Delete one to create another.',
  'web.preferences.aiContext.saveFailed':
    'Could not save this context. Your changes are still here.',
  'web.preferences.aiContext.loadFailed':
    'Could not load your contexts. Your session is still valid.',

  // ---- web.account ----
  //
  // Nothing here may say sign-out-everywhere. Signing out discards this
  // browser's cookie; the API token it carried stays valid until it expires.
  // The one thing that revokes earlier tokens and closes open sockets is a
  // COMPLETED password reset, which is why that is where the stronger sentence
  // sits.
  'web.account.memberSince': 'Member since',
  'web.account.nameUnset': 'Not set',
  'web.account.loadFailed': 'Could not load your account details. Your session is still valid.',
  'web.account.avatarChange': 'Change photo',
  'web.account.avatarRemove': 'Remove photo',
  'web.account.avatarHint':
    'Shown beside your name here and in the sidebar. Square works best; we crop to the centre.',
  // Four distinct failures, because they need four different actions. Picking
  // another file, picking a smaller one, retrying, and telling whoever runs the
  // server are not the same next step, and one "upload failed" would hide which.
  'web.account.avatarNotAnImage': 'That file is not an image. Choose a JPEG, PNG or WebP.',
  'web.account.avatarTooLarge': 'That image is too large. Choose one under 256KB.',
  'web.account.avatarFailed': 'Could not save that photo. Try again.',
  // Covers BOTH 409s the API can send — storage not configured, and storage
  // unreachable — because the client cannot tell them apart: they share the
  // CONFLICT code, and rendering the API's own message verbatim would put
  // English in front of a Vietnamese reader. So it says what is true of both
  // (nothing changed) and offers the action that helps in either case.
  'web.account.avatarUnavailable':
    "Couldn't save that photo — nothing was changed. Try again; if it keeps failing, tell whoever runs this server.",
  'web.account.security': 'Security',
  'web.account.thisBrowser': 'This browser',
  'web.account.changePassword': 'Change password',
  'web.account.changePasswordHint':
    'Signs out your other devices and closes any translation or meeting still open. This browser stays signed in.',
  'web.account.currentPassword': 'Current password',
  'web.account.confirmNewPassword': 'Confirm new password',
  'web.account.changePasswordSubmit': 'Save new password',
  'web.account.changingPassword': 'Saving…',
  'web.account.changePasswordCancel': 'Cancel',
  'web.account.passwordsDoNotMatch': 'The two new passwords do not match.',
  'web.account.passwordChanged': 'Password changed. Your other devices have been signed out.',
  // One per failure, because each needs a different next step: retype, use the
  // reset flow, wait, sign in again, or retry. The API's own messages are English
  // and are never rendered.
  'web.account.currentPasswordWrong': 'Your current password is incorrect.',
  'web.account.noPasswordYet':
    'This account signs in with Google and has no password yet. Use "Forgot your password?" to set one.',
  'web.account.changePasswordThrottled': 'Too many attempts. Wait a minute and try again.',
  'web.account.changePasswordSessionExpired':
    'Your session has ended. Sign in again, then change your password.',
  'web.account.changePasswordInvalid': 'Check the new password and try again.',
  'web.account.changePasswordFailed':
    'Could not change the password — nothing was changed. Try again.',
  'web.account.signOutHint':
    'Signs out of this browser only. Other devices stay signed in until their session expires.',
  // Credits & plan: buying. The first offer's Buy is Billing's one filled control.
  'web.account.buyTitle': 'Buy credits',
  // Each offer's button; its accessible name adds the offer's own label.
  'web.account.buy': 'Buy',
  'web.account.buyProCard': 'Pro by card — {price} a month',
  'web.account.buyProPass': 'Pro for 30 days by VietQR — {price}',
  'web.account.buyTopupCard': '{credits} by card — {price}',
  'web.account.buyTopupQr': '{credits} by VietQR — {price}',
  'web.account.railSandboxCard': 'Card payments are in test mode: no real money is charged.',
  'web.account.railSandboxQr': 'VietQR is in test mode: no real money is charged.',
  'web.account.checkoutOpening': 'Opening checkout…',
  'web.account.checkoutFailed': 'Could not open checkout. Try again.',
  'web.account.checkoutReturned': 'Payment finished. Your balance is updated.',
  'web.account.manageSubscription': 'Manage subscription',
  'web.account.usageShowMore': 'Show more',
  // The VietQR panel, polled until the transfer lands or the order expires.
  'web.account.qrTitle': 'Scan with your banking app',
  'web.account.qrImageAlt': 'VietQR code to pay {amount}',
  'web.account.qrAmount': 'Amount',
  'web.account.qrCode': 'Transfer note',
  'web.account.qrCodeHint':
    'Keep the note exactly as shown — it is how the payment finds your order.',
  'web.account.qrCopy': 'Copy',
  'web.account.qrCopied': 'Copied',
  'web.account.qrWaiting': 'Waiting for your transfer…',
  'web.account.qrPaid': 'Payment received. Your balance is updated.',
  'web.account.qrExpired':
    'This code has expired. A transfer you already sent will still be credited; if you have not paid yet, start again.',
  'web.account.qrNeedsReview':
    "We received a payment we couldn't match automatically. It will be reviewed and credited by hand.",
  'web.account.qrClose': 'Close',

  // ---- web.settings ----
  // Settings: one dialog of five tabs in two groups, opened from the sidebar footer
  // over the current page. Each tab opens with its name and one line saying what it
  // holds.
  'web.settings.nav': 'Settings sections',
  'web.settings.groupPersonal': 'Personal',
  'web.settings.groupAccount': 'Account',
  'web.settings.general': 'General',
  'web.settings.translation': 'Translation',
  'web.settings.translationDescription':
    'What a new conversation starts with, and what the browser does to your microphone.',
  'web.settings.account': 'Account',
  'web.settings.accountDescription':
    "Your photo, name and email, your password, and this browser's session.",
  // The phone's back button from one tab to the list of all of them.
  // Said when Settings refuses to leave a tab (or close on Esc) over an unsaved draft.
  'web.settings.unsavedDraft': 'Save or cancel the AI context you are writing first.',
  'web.settings.backToList': 'Back to all settings',
  'web.settings.appearance': 'Appearance',
  'web.settings.appearanceDescription': 'The language Chatofy speaks to you in, and how it looks.',
  'web.settings.audioDescription':
    'What the browser does to your microphone before anything is translated.',
  'web.settings.billing': 'Billing',
  'web.settings.billingDescription': 'Your credits, your plan, and what they were spent on.',
  'web.settings.languageNote': 'Also the language of the emails we send you.',
  'web.settings.interfaceLanguage': 'Interface language',
  // Group headings on the Translation tab.
  'web.settings.groupLanguages': 'Languages',
  'web.settings.groupVoice': 'Voice',
  'web.settings.groupDisplay': 'Display',
  'web.settings.groupMicrophone': 'Microphone',
  'web.settings.groupDefaultContext': 'Default AI context',
  // Shown on the Translation tab while a conversation runs on the page under it.
  'web.settings.lockedWhileRunning':
    'Languages, voices and AI context are locked until the running conversation ends.',
  // What a toast calls the two language-pair rows on Defaults.
  'web.settings.oneWayPair': 'One-way languages',
  'web.settings.twoWayPair': 'Two-way languages',
  // Autosave, said once per setting. `{setting}` is the row's own label.
  'web.settings.saved': '{setting} saved',
  'web.settings.saveFailed': "Couldn't save {setting}. It still applies in this browser.",
  'web.settings.photoChoose': 'Choose an image',
  'web.settings.photoUpdated': 'Photo updated',
  'web.settings.photoRemoved': 'Photo removed',
  'web.settings.contextSaved': '“{name}” saved',
  'web.settings.contextDeleted': '“{name}” deleted',
  'web.settings.signOutTitle': 'Sign out of this browser?',
  'web.settings.signOutFailed': "Couldn't sign out. Try again.",

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
    'Real-time voice translation between Vietnamese, English and Chinese — for face-to-face conversations in the browser, video meetings, and calls in Google Meet, Zoom or Facebook.',
  'web.landing.meetingsStart': 'Create a meeting',
  'web.landing.demoListening': 'Listening',
  'web.landing.demoSourceOne': 'Chào anh, mình muốn hỏi về lịch họp chiều nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure — it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'Được thôi — cuộc họp đã dời sang bốn giờ.',

  'web.landing.howTitle': 'How it works',
  'web.landing.howBody': 'Three things worth knowing before you grant a microphone.',
  'web.landing.howOneTitle': 'Press start, then just talk',
  'web.landing.howOneBody':
    'No button to hold. Your turn ends when you pause, and the translation plays about a second later.',
  'web.landing.howTwoTitle': 'Automatic language detection',
  'web.landing.howTwoBody':
    'Chatofy tells Vietnamese and English apart as you speak. For Chinese, choose the language before you start.',
  'web.landing.howThreeTitle': "Hear the translation, don't read it",
  'web.landing.howThreeBody': 'It is spoken aloud. The text stays on screen for reference.',

  'web.landing.meetingsTitle': 'Multilingual meetings, translated live',
  'web.landing.meetingsBody':
    'Share one link, and every participant follows the meeting in their own language.',
  'web.landing.meetingsLinkTitle': 'Join with a link',
  'web.landing.meetingsLinkBody':
    'Anyone with an account opens the link to join. Nothing to install.',
  'web.landing.meetingsHearTitle': 'Subtitles and voice in your language',
  'web.landing.meetingsHearBody':
    'Each speaker is translated, subtitled and read aloud in the language you choose.',
  'web.landing.meetingsChatTitle': 'Messages translated automatically',
  'web.landing.meetingsChatBody': "Every message appears in the recipient's language.",
  'web.landing.meetingsMinutesTitle': 'Meeting minutes',
  'web.landing.meetingsMinutesBody':
    'After the meeting, generate minutes with a summary, decisions and action items from the end screen.',
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
  'web.landing.localTitle': 'How your recordings are handled',
  'web.landing.localBody':
    'The translation service receives text only, never your audio. Here is what is stored, and what is not.',
  'web.landing.localKeptHistory':
    'When a conversation ends, its recording and its words are saved to your history, so you can play it back and read it again.',
  'web.landing.localKeptLink':
    'The recording is kept at an unguessable address that anyone holding the link can open, so the link is what keeps it private.',
  'web.landing.localKeptPause':
    'Pausing a conversation pauses its recording too: what is said while it is paused is neither recorded nor translated.',
  'web.landing.localKeptDelete': 'Deleting a conversation deletes its recording with it.',
  'web.landing.localKeptMeeting':
    'Meetings store speech and messages as text, never audio. Everyone who took part can read them, and they cannot be deleted yet.',

  'web.landing.surfacesTitle': 'Where Chatofy runs',
  'web.landing.surfaceBrowserTitle': 'In the browser',
  'web.landing.surfaceBrowserBody':
    'Translate conversations or host meetings in the browser, with nothing to install.',
  'web.landing.surfaceExtensionTitle': 'Extension for Meet, Zoom and Facebook',
  'web.landing.surfaceExtensionBody': 'Two-way translation inside the call you are already in.',
  'web.landing.surfacePhoneTitle': 'On your phone',
  'web.landing.surfacePhoneBody':
    'In development. Supports joining meetings; not yet released in the app stores.',

  'web.landing.ctaTitle': 'Try one conversation',
  'web.landing.ctaBody': 'Needs a microphone and an account. No card.',
  'web.landing.navMenu': 'Menu',
  // Short forms for the header nav, which has to fit one line beside the brand at
  // 1024px. The section headings stay as written; these only point at them.
  'web.landing.navMeetings': 'Meetings',
  'web.landing.navHow': 'How it works',
  'web.landing.navLocal': 'Privacy',
  'web.landing.navSurfaces': 'Where it runs',
  // The part of `heroTitle` set in italic. Must appear verbatim inside it; the hero
  // falls back to an upright headline when it does not.
  'web.landing.heroTitleEmphasis': 'Be understood',

  // ---- web.pricing: the public /pricing page ----
  'web.pricing.title': 'Pricing',
  'web.pricing.intro':
    'Translation is paid for in credits. One credit is one minute of translated captions.',
  'web.pricing.notOpen':
    'Checkout is not open to the public: Chatofy is a non-commercial thesis, and only its owner can buy.',
  'web.pricing.startFree': 'Start free',
  'web.pricing.freeSummary': '{credits} credits every month. Unused credits do not carry over.',
  'web.pricing.proSummary': '{credits} credits each cycle, reset when the next one starts.',
  'web.pricing.proPriceCard': '{price} a month by card, renews automatically',
  'web.pricing.proPricePass': '{price} for 30 days by VietQR, does not renew',
  'web.pricing.topupsTitle': 'Top-ups',
  'web.pricing.topupsSummary': 'Credits that never expire, spent after your plan credits.',
  'web.pricing.topupPrice': '{usd} by card · {vnd} by VietQR',
  'web.pricing.footnoteUnits':
    'Captions use 1 credit a minute, or 2 with the translation spoken aloud. Meeting minutes use 3 credits each.',
  'web.pricing.footnoteLanguages':
    'Each extra language a meeting translates into adds the same again.',
  'web.pricing.pricesUnavailable': 'Prices are unavailable right now.',

  // ---- web.conference: video conferencing lobby + in-call screen ----
  'web.conference.joining': 'Joining…',
  // ---- web.conference: in-call control bar ----
  'web.conference.muted': 'Muted',
  'web.conference.showRoster': 'Show participants',
  // ---- web.conference: edge-case states (Phase 5) ----
  'web.conference.permissionDeniedHint':
    'Open your browser settings and allow access to the camera and microphone, then reload this page.',
  // ---- web.conference: audio unlock (Phase 1) ----
  // Inline notice when the browser's autoplay policy suspended a TTS AudioContext.
  // No card, no elevation — ghost button only; Leave stays the one accent control.
  'web.conference.audioBlocked': 'Sound is blocked by your browser.',
  'web.conference.enableAudio': 'Tap to enable sound',
  // ---- web.conference: landing and pre-join room ----
  'web.conference.newMeeting': 'New meeting',
  'web.conference.codeOrLink': 'Meeting code or link',
  'web.conference.codeOrLinkPlaceholder': 'Paste a link or enter a code',
  'web.conference.joinAction': 'Join',
  'web.conference.joiningAs': 'Joining as {name}',
  'web.conference.landingLead': 'Meet with translated speech and captions.',
  'web.conference.readyToJoin': 'Ready to join?',
  'web.conference.joinNow': 'Join now',
  'web.conference.microphone': 'Microphone',
  'web.conference.camera': 'Camera',
  'web.conference.defaultDevice': 'System default',
  'web.conference.noCameraPreview': 'Camera is off',
  'web.conference.micLevel': 'Microphone level',
  'web.conference.translatedVoiceChip': 'Voice: {gender} · {speed}×',
  'web.conference.translatedVoiceHint':
    'Others hear your translated speech in this voice. It is the same setting as on Translate.',
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
  'web.conference.codeInvalid': 'That is not a meeting code or invite link.',
  'web.conference.cancel': 'Cancel',
  'web.conference.createFailedToast': 'Could not start a meeting',
  'web.conference.minutesReady': 'Minutes are ready',
  'web.conference.minutesFailedToast': 'Could not generate the minutes',
  'web.meta.conference': 'Conference · Chatofy',
  'web.meta.glossary': 'Glossary · Chatofy',

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
  'mobile.conference.notAuthenticated': 'You need to sign in to join the call.',
  // ---- mobile.conference: translation UX (subtitles, transcript, language) ----
  // The picker only takes effect before joining; once in the call it is a readout.
  'mobile.conference.sourceLanguageLocked': 'Language is fixed for this call.',
  'mobile.conference.showTranscript': 'Show transcript',
  'mobile.conference.hideTranscript': 'Hide transcript',
  'mobile.conference.transcriptEmpty': 'Nothing has been said yet.',
  // ---- mobile.conference: in-meeting chat (translated per recipient) ----
  'mobile.conference.showChat': 'Show chat',
  'mobile.conference.hideChat': 'Hide chat',
  'mobile.conference.minutesGenerating': 'Summarizing the meeting…',
  'mobile.conference.minutesEmpty':
    'No minutes yet. Anyone who was in the meeting can generate them.',
  'mobile.tabs.conference': 'Conference',
  'mobile.auth.noAccountPrompt': 'No account yet?',
  'mobile.auth.linkExpired': 'This link has expired or was already used. Ask for a new one.',
  'mobile.auth.fillAllFields': 'Fill in every field.',
  'mobile.auth.nameTooLong': 'That name is too long.',
  'mobile.auth.invalidEmail': 'Enter a valid email address.',
  'mobile.auth.passwordTooLong': 'That password is too long.',
  'mobile.auth.passwordMismatch': 'The two passwords do not match.',
  'mobile.auth.confirmPassword': 'Confirm password',
  'mobile.auth.verifyDone': 'Your email is confirmed. You can sign in now.',
  'mobile.auth.resetDone': 'Your password has been changed. Sign in with the new one.',
  'mobile.auth.linkMissingToken': 'This link is incomplete. Open the link from the email again.',
  'mobile.translate.micDenied':
    'Chatofy needs the microphone to translate. Allow it in Settings, then try again.',
  'mobile.translate.micInUse':
    'A meeting is using the microphone. Leave the meeting, then start translating.',
  'mobile.translate.unheard': 'Not spoken aloud',
  'mobile.auth.signInTitle': 'Sign in',
  'mobile.auth.missingFields': 'Enter your email and password.',
  'mobile.auth.invalidCredentials': 'Email or password is incorrect.',
  'mobile.auth.tooManyAttempts': 'Too many attempts. Wait a minute and try again.',
  'mobile.auth.signInFailed': 'Could not sign in. Check your connection and try again.',
  'mobile.settings.signedInAs': 'Signed in as {email}',
  'mobile.settings.signedOut': 'You are not signed in.',
  'mobile.settings.audio.voiceProcessingHint':
    "Turns the phone's voice processing on or off. When off, the microphone pauses while a translation plays. Call audio is unchanged.",
  'mobile.settings.audio.lockedHint':
    'The phone turns this on and off together with echo cancellation.',

  // Buying happens on the web; the phone only links there.
  'mobile.settings.buyOnWeb': 'Buy credits on the web',

  // Account preferences on the phone's Settings.
  'mobile.settings.sync.note': 'Your translation settings sync across your devices.',
  'mobile.settings.sync.error': 'Could not save your settings. Retrying automatically.',
  'mobile.settings.sync.refused':
    'That change could not be saved, so your saved settings are shown.',
  'mobile.settings.sync.reset': 'Reset to defaults',
  'mobile.settings.sync.resetTitle': 'Reset all settings?',
  'mobile.settings.sync.resetBody':
    'Your language pairs, voices and call options go back to their defaults on every device.',
  'mobile.settings.sync.resetFailed': 'Could not reset your settings. Check your connection.',

  // ---- web.glossary ----
  'web.glossary.title': 'Glossaries',
  'web.glossary.new': 'New glossary',
  'web.glossary.loadFailed': 'Could not load your glossaries.',
  'web.glossary.emptyTitle': 'No glossaries yet',
  'web.glossary.emptyList':
    'A glossary keeps your names and terms translated the way you want. Press New glossary to make one.',
  'web.glossary.termCount': '{count} terms',
  'web.glossary.badgeInactive': 'Inactive',
  'web.glossary.delete': 'Delete',
  'web.glossary.nameLabel': 'Name',
  'web.glossary.descriptionLabel': 'Description',
  'web.glossary.sourceLangLabel': 'Source language',
  'web.glossary.createFailed': 'Could not create the glossary. Try again.',
  'web.glossary.creating': 'Creating…',
  'web.glossary.create': 'Create',
  'web.glossary.cancel': 'Cancel',
  'web.glossary.originalLabel': 'Original',
  'web.glossary.translationLabel': 'Translation',
  'web.glossary.targetLangLabel': 'Target language',
  'web.glossary.notesLabel': 'Notes',
  'web.glossary.notesPlaceholder': 'Optional note about this term',
  'web.glossary.addTermFailed': 'Could not add the term. Try again.',
  'web.glossary.adding': 'Adding…',
  'web.glossary.addTerm': 'Add term',
  'web.glossary.filterTerms': 'Filter terms…',
  'web.glossary.loadTermsFailed': 'Could not load the terms.',
  'web.glossary.noTermsMatch': 'No terms match that.',
  'web.glossary.noTerms': 'No terms yet.',
  'web.glossary.selectGlossary': 'Select a glossary to see its terms.',
  'web.glossary.termsHeading': 'Terms',
  'web.glossary.createTitle': 'New glossary',
  'web.glossary.createDescription': 'Name it for what it covers. You add terms after it is made.',
  'web.glossary.created': 'Glossary “{name}” created',
  'web.glossary.deleted': 'Glossary “{name}” deleted',
  'web.glossary.deleting': 'Deleting…',
  'web.glossary.deleteFailed': 'Could not delete the glossary. It is still here.',
  'web.glossary.deleteConsequence':
    'Every term in it is deleted too, and translation stops using them. This cannot be undone.',
  'web.glossary.activeLabel': 'Use while translating',
  'web.glossary.turnedOn': '“{name}” is used while translating',
  'web.glossary.turnedOff': '“{name}” is no longer used while translating',
  'web.glossary.toggleFailed': 'Could not change “{name}”.',
  'web.glossary.back': 'All glossaries',
  'web.glossary.editTerm': 'Edit',
  'web.glossary.editTermNamed': 'Edit {term}',
  'web.glossary.editTermTitle': 'Edit term',
  'web.glossary.termDescription':
    'The original is what is heard; the translation is what you want it to become.',
  'web.glossary.save': 'Save',
  'web.glossary.saving': 'Saving…',
  'web.glossary.updateTermFailed': 'Could not save the term. Try again.',
  'web.glossary.translatesTo': 'translates to',
  'web.glossary.termAdded': 'Added “{term}”',
  'web.glossary.termUpdated': 'Saved “{term}”',
  'web.glossary.termDeleted': 'Deleted “{term}”',
  'web.glossary.termDeleteFailed': 'Could not delete the term. It is still here.',
  'web.glossary.oldTermKept': 'The new “{term}” is saved, but the old version is still listed.',
} as const;

/** Every key any locale must carry. Derived, so a locale cannot drift from it. */
export type MessageKey = keyof typeof en;

/** A complete locale. `tsc` refuses one that is missing a key. */
export type Messages = Record<MessageKey, string>;
