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
  'web.auth.forgotPasswordLink': 'Forgot your password?',
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
} as const;

/** Every key any locale must carry. Derived, so a locale cannot drift from it. */
export type MessageKey = keyof typeof en;

/** A complete locale. `tsc` refuses one that is missing a key. */
export type Messages = Record<MessageKey, string>;
