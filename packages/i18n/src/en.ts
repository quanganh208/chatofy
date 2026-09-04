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
  'web.chrome.navTranslate': 'Translate',
  'web.chrome.navHistory': 'History',
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
  'web.meta.history': 'History · Chatofy',
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
  'web.translate.headphonesHint':
    'Headphones help — the microphone stays open while the translation is spoken.',
  'web.translate.voiceGender': 'Voice gender',
  'web.translate.speed': 'Speed',
  'web.translate.volume': 'Volume',
  'web.translate.volumeAria': 'Playback volume',
  'web.translate.transcript': 'Transcript',
  'web.translate.transcriptStacked': 'Stacked',
  'web.translate.transcriptColumns': 'Columns',
  'web.translate.settings': 'Conversation settings',
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
  'web.translate.speakerRosterHint':
    'Add the people talking and each turn can be marked with who said it.',
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
  'web.translate.minutesNeedsSave': 'Minutes are generated from the saved conversation.',
  // ---- web.translate.minutes: LLM meeting minutes over a finished conversation ----
  'web.translate.minutesTitle': 'Meeting minutes',
  'web.translate.minutesGenerate': 'Generate minutes',
  'web.translate.minutesRegenerate': 'Regenerate',
  'web.translate.minutesGenerating': 'Summarizing the conversation…',
  'web.translate.minutesEmpty': 'No minutes yet — generate them once the conversation has ended.',
  'web.translate.minutesNeedsTurns':
    'Have a conversation first — there is nothing to summarize yet.',
  'web.translate.minutesFailed': 'Could not generate minutes. Try again.',
  'web.translate.minutesSummary': 'Summary',
  'web.translate.minutesKeyPoints': 'Key points',
  'web.translate.minutesDecisions': 'Decisions',
  'web.translate.minutesActionItems': 'Action items',
  'web.translate.minutesNoActionItems': 'No action items.',
  'web.translate.minutesOwner': 'Owner',
  'web.translate.minutesDue': 'Due',
  'web.translate.minutesCopy': 'Copy',
  'web.translate.minutesCopied': 'Copied',

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
  'web.history.turnCount': '{count} lines',
  'web.history.duration': '{minutes} min',
  // The long pair is the ACCESSIBLE name; the short pair is what is drawn on a
  // row. "Vietnamese → English" is 21 characters printed once per row, which at
  // eight rows is the loudest thing on a screen whose subject is the previews.
  'web.history.directionViToEn': 'Vietnamese → English',
  'web.history.directionEnToVi': 'English → Vietnamese',
  'web.history.directionShortViToEn': 'VI → EN',
  'web.history.directionShortEnToVi': 'EN → VI',
  'web.history.minutesReady': 'Minutes',
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
  'web.history.loadMore': 'Load more',
  // Beside the "Load more" control, not in place of the list: the conversations
  // already read are still on screen and still true.
  'web.history.loadMoreFailed': 'Could not load more conversations.',

  // ---- web.preferences ----
  // Named as DEFAULTS, because that is what this page holds now. The settings a
  // running conversation can still change moved onto `/translate` itself, so a
  // second copy of the same panel here needed a distinction a reader could say
  // out loud — and "where a new conversation starts from" is it.
  'web.preferences.conversation': 'Defaults for new conversations',
  'web.preferences.conversationHint':
    'A new conversation starts from these. While one is running you change what you can on the Translate page — direction and voice stay fixed until it ends.',
  'web.preferences.interface': 'Interface',

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
  'web.account.avatar': 'Photo',
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

  // AMENDED when conversation history shipped, and the amendment is the point.
  //
  // This block used to say "nothing uploaded" and "only the words themselves
  // cross the network, TO BE TRANSLATED". The first was unqualified and the
  // second was a purpose limitation — and with history on by default and no
  // retention limit, the words now cross the network AND are kept, with the
  // speaker names the reader typed. There is no separate privacy surface in this
  // product; this copy IS the notice, so it had to change with the behaviour
  // rather than after it.
  //
  // What stays true, and is still worth saying first: the audio never leaves the
  // machine. That is the claim the local speech stack actually earns.
  'web.landing.localTitle': 'Your voice stays on your machine',
  'web.landing.localBody':
    'What you say is heard on your own computer — no key to obtain, and the audio is never uploaded. The words themselves cross the network to be translated, and are saved to your history so you can read them again. You can delete any conversation.',
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
