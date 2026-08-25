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
  'common.theme.light': 'Light',
  'common.theme.dark': 'Dark',
  'common.theme.system': 'Match system',
  'common.theme.label': 'Colour theme',
  'common.language.vietnamese': 'Tiếng Việt',
  'common.language.english': 'English',
  'common.language.label': 'Language',

  // ---- web.chrome: the shell every route renders inside ----
  //
  // No brand key. "Chatofy" is a proper noun and reads identically in both
  // languages; putting it here would invite a translator to render it and buy
  // nothing in return.
  'web.chrome.signOut': 'Sign out',
  'web.chrome.backToTranslator': 'Back to the translator',
  'web.chrome.skipToContent': 'Skip to content',
  'web.chrome.productNav': 'Product',
  'web.chrome.navDashboard': 'Dashboard',
  'web.chrome.navTranslate': 'Translate',
  'web.chrome.navPreferences': 'Preferences',
  // Its own key rather than reusing `accountMenu`. That one names the avatar
  // control ("open your account menu"); this one names a destination, and a
  // locale may well want two different words.
  'web.chrome.navAccount': 'Account',
  'web.chrome.toggleSidebar': 'Toggle the sidebar',
  'web.chrome.accountMenu': 'Account',
  'web.chrome.signedInAs': 'Signed in as',
  'web.chrome.getStarted': 'Get started',
  'web.chrome.openApp': 'Open Chatofy',

  // ---- web.auth ----
  'web.auth.signIn': 'Sign in',
  'web.auth.signingIn': 'Signing in…',
  'web.auth.email': 'Email',
  'web.auth.password': 'Password',
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
  'web.auth.signInUnavailable':
    'Sign-in is unavailable right now — that is a problem on our side, not with your account. Try again shortly, or sign in with your password below.',
  // What the api answers with, in the reader's language. The wire carries a code;
  // these are the words. See `authMessageCodeSchema` in `@chatofy/types`.
  'web.auth.noticeVerified': 'Your account is ready. Sign in below to get started.',
  'web.auth.noticeReset': 'Your password has been changed. Sign in with your new password.',

  // ---- web.meta: the browser tab, which is a string a person reads ----
  'web.meta.home': 'Chatofy — speak Vietnamese, be heard in English',
  'web.meta.homeDescription':
    'Real-time voice translation in both directions. Your voice is handled on your own machine; only the words cross the network.',
  'web.meta.signIn': 'Sign in · Chatofy',
  'web.meta.register': 'Create account · Chatofy',
  'web.meta.verifyEmail': 'Verify email · Chatofy',
  'web.meta.forgotPassword': 'Forgot password · Chatofy',
  'web.meta.resetPassword': 'Reset password · Chatofy',
  'web.meta.translate': 'Translate · Chatofy',
  'web.meta.dashboard': 'Dashboard · Chatofy',
  'web.meta.preferences': 'Preferences · Chatofy',
  'web.meta.account': 'Account · Chatofy',

  // ---- web.translate ----
  'web.translate.startTranslating': 'Start translating',
  'web.translate.startConversation': 'Start conversation',
  'web.translate.end': 'End',
  'web.translate.notListening': 'Not listening',
  'web.translate.connecting': 'Connecting…',
  'web.translate.listening': 'Listening — just start talking',
  'web.translate.hearingYou': 'Hearing you…',
  'web.translate.translating': 'Translating…',
  'web.translate.speaking': 'Speaking',
  'web.translate.openingSession': 'Opening the session…',
  'web.translate.transcriptEmpty': 'Nothing yet — start a conversation and both sides appear here.',
  'web.translate.speakTranslation': 'Speak translation',
  'web.translate.speakTranslationAria': 'Speak the translation aloud',
  'web.translate.voice': 'Voice',
  'web.translate.voiceFemale': 'Female',
  'web.translate.voiceMale': 'Male',
  'web.translate.speed': 'Speed',
  'web.translate.volume': 'Volume',
  'web.translate.volumeAria': 'Playback volume',
  'web.translate.transcript': 'Transcript',
  'web.translate.transcriptStacked': 'Stacked',
  'web.translate.transcriptColumns': 'Columns',
  'web.translate.settings': 'Conversation settings',
  'web.translate.speakNaturally':
    'Speak naturally and pause. The translation plays back on its own — no button to press.',
  'web.translate.direction': 'Direction',
  'web.translate.directionSource': 'Source',
  'web.translate.directionTarget': 'Translation',
  // Interpolated, because the accessible name has to say what pressing it DOES:
  // "swap" alone is a verb with no object.
  'web.translate.directionSwap': 'Swap direction — translate {from} into {to}',
  'web.translate.voiceDefault': 'Default',
  'web.translate.voiceListFailed':
    'Could not load the voice list. The gender choice above still applies.',
  'web.translate.speedHint':
    'The Vietnamese voice has no rate control, so speed applies only when translating into English.',
  'web.translate.transcriptHint':
    'Columns show the original beside its translation, and stack again on a narrow screen.',
  'web.translate.transcriptListening':
    'Listening. The conversation will appear here as it is translated.',
  'web.translate.transcriptAttribution': 'Each turn can be marked with who said it.',
  'web.translate.micLevel': 'Microphone level',
  // Said in the reader's language, and each one ends in the action that clears it.
  // The browser's own wording is a `DOMException` message — English, and different
  // between versions. `lib/open-microphone.ts` is what maps a fault onto these.
  'web.translate.micNotFound':
    'No microphone found. Plug one in, then start the conversation again.',
  'web.translate.micDenied':
    'The browser is blocking the microphone. Allow it from the address bar, then start the conversation again.',
  'web.translate.micBusy':
    'Another app is holding the microphone. Close it, then start the conversation again.',
  'web.translate.micFailed': 'The microphone could not be started.',
  'web.translate.recorded': 'Recorded — ready to translate',
  'web.translate.noAudioYet': 'No audio yet — record or upload a file',
  'web.translate.result': 'Result',
  'web.translate.liveFollowing': 'Live — keep talking, the translation follows',
  'web.translate.stopped': 'Stopped',
  'web.translate.languageMismatch':
    'This sounds like {heard}, but the direction above expects {expected}. Switch the direction, or carry on — the translation may be wrong either way.',
  'web.translate.liveTranslation': 'Live translation',
  'web.translate.baselineHeading': 'Translate a recording',
  'web.translate.baselineViToEn': 'Record Vietnamese speech and hear the English translation.',
  'web.translate.baselineEnToVi': 'Record English speech and hear the Vietnamese translation.',

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

  // ---- web.dashboard: the post-login hub ----
  //
  // Nothing here counts, charts or times anything, and no key below could be
  // used to. There is one model in the schema — `User` — so a number on this
  // page would be invented, and the landing's privacy claim is that nothing is
  // kept. The readiness words are the opposite case: each one is a real answer
  // the browser or the server gave, INCLUDING the ones that admit ignorance.
  'web.dashboard.start': 'Start',
  'web.dashboard.startConversation': 'Start a conversation',
  'web.dashboard.startHint': 'Voice, rate and volume are set while translating.',
  'web.dashboard.readiness': 'Readiness',
  'web.dashboard.microphone': 'Microphone',
  'web.dashboard.micGranted': 'Granted',
  'web.dashboard.micDenied': 'Denied',
  'web.dashboard.micPrompt': 'Not asked yet',
  'web.dashboard.micUnknown': 'Cannot tell',
  'web.dashboard.micAbsent': 'None found',
  'web.dashboard.service': 'Translation service',
  'web.dashboard.serviceChecking': 'Checking…',
  'web.dashboard.serviceReachable': 'Reachable',
  'web.dashboard.serviceUnreachable': 'Unreachable',
  'web.dashboard.headphones': 'Headphones',
  'web.dashboard.headphonesRecommended': 'Recommended',
  'web.dashboard.alsoRunsOn': 'Also runs on',
  'web.dashboard.extension': 'Browser extension',
  'web.dashboard.extensionWhat':
    'Translates a meeting in the browser — Google Meet, Zoom, a Facebook call.',
  'web.dashboard.mobile': 'Mobile app',
  'web.dashboard.mobileWhat': 'The same translator, on a phone.',
  'web.dashboard.unreleased': 'Not released yet',

  // ---- web.preferences ----
  'web.preferences.conversation': 'Conversation',
  'web.preferences.conversationHint':
    'These apply to every conversation. Direction and voice are editable here because nothing is running — inside a conversation they are fixed until it ends.',
  'web.preferences.interface': 'Interface',

  // ---- web.account ----
  //
  // Nothing here may say sign-out-everywhere. Signing out discards this
  // browser's cookie; the API token it carried stays valid until it expires.
  // The one thing that revokes earlier tokens and closes open sockets is a
  // COMPLETED password reset, which is why that is where the stronger sentence
  // sits.
  'web.account.identity': 'Identity',
  'web.account.memberSince': 'Member since',
  'web.account.nameUnset': 'Not set',
  'web.account.loading': 'Loading your details…',
  'web.account.loadFailed': 'Could not load your account details. Your session is still valid.',
  'web.account.security': 'Security',
  'web.account.changePassword': 'Change password',
  'web.account.changePasswordHint':
    'We email you a link. Completing it also invalidates sessions on your other devices and closes any translation still open.',
  'web.account.signOutHint':
    'Signs out of this browser only. Other devices stay signed in until their session expires.',

  // ---- web.landing ----
  //
  // The copy register governs here hardest. `docs/design-guidelines.md` § Copy
  // register: name the wait, the outcome, or the next step — never the pipeline.
  // "Recognise, translate, speak" and every variant is banned, which is why the
  // privacy section talks about a voice staying on a machine rather than about
  // which component runs where.
  //
  // Every number below comes from `docs/development-journey.md`. There is exactly
  // one, "about a second", from the measured ~0.9 s between the end of a sentence
  // and the start of playback. A thesis product with no users has nothing else to
  // count.
  'web.landing.heroTitle': 'Speak Vietnamese. Be heard in English.',
  'web.landing.heroBody':
    'Real-time voice translation, both directions. Your voice is handled on your own machine — only the words cross the network.',
  'web.landing.heroSeeHow': 'See how it works',
  'web.landing.demoListening': 'Listening',
  'web.landing.demoSourceOne': 'Chào anh, mình muốn hỏi về lịch họp chiều nay.',
  'web.landing.demoTargetOne': "Hi, I'd like to ask about this afternoon's meeting schedule.",
  'web.landing.demoSourceTwo': "Sure — it's been moved to four o'clock.",
  'web.landing.demoTargetTwo': 'Được thôi — cuộc họp đã dời sang bốn giờ.',

  'web.landing.howTitle': 'How it works',
  'web.landing.howBody': 'Three things worth knowing before you grant a microphone.',
  'web.landing.howOneTitle': 'Press start, then just talk',
  'web.landing.howOneBody': 'No button to hold, no signal to wait for.',
  'web.landing.howTwoTitle': 'There is no stop button',
  'web.landing.howTwoBody':
    'The turn ends when you stop talking. The translation plays about a second later.',
  'web.landing.howThreeTitle': "Hear the translation, don't read it",
  'web.landing.howThreeBody': 'It is spoken aloud. The text stays on screen for reference.',

  'web.landing.localTitle': 'Your voice stays on your machine',
  'web.landing.localBody':
    'What you say is handled on your own computer — no key to obtain, nothing uploaded. Only the words themselves cross the network, to be translated.',
  'web.landing.hopOnDevice': 'On device',
  'web.landing.hopOverNetwork': 'Over the network',
  'web.landing.hopHears': 'Hears what you said',
  'web.landing.hopTranslates': 'Translates the meaning',
  'web.landing.hopSpeaks': 'Speaks the translation',

  'web.landing.surfacesTitle': 'Where Chatofy runs',
  'web.landing.surfaceBrowserTitle': 'In the browser',
  'web.landing.surfaceBrowserBody': 'Open it and talk. Nothing to install.',
  'web.landing.surfaceExtensionTitle': 'Extension for meetings',
  'web.landing.surfaceExtensionBody': 'Two-way translation inside a Meet or Zoom tab.',
  'web.landing.surfacePhoneTitle': 'On your phone',
  'web.landing.surfacePhoneBody': 'For talking face to face.',

  'web.landing.ctaTitle': 'Try one conversation',
  'web.landing.ctaBody': 'Needs a microphone and an account. No card.',
  'web.landing.navMenu': 'Menu',
} as const;

/** Every key any locale must carry. Derived, so a locale cannot drift from it. */
export type MessageKey = keyof typeof en;

/** A complete locale. `tsc` refuses one that is missing a key. */
export type Messages = Record<MessageKey, string>;
