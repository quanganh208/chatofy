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
  'web.chrome.skipToContent': 'Skip to content',
  'web.chrome.productNav': 'Product',
  'web.chrome.navTranslate': 'Translate',
  'web.chrome.navConference': 'Conference',
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
  'web.meta.translate': 'Translate · Chatofy',
  'web.meta.history': 'History · Chatofy',
  'web.meta.preferences': 'Preferences · Chatofy',
  'web.meta.account': 'Account · Chatofy',

  // ---- web.translate ----
  'web.translate.startTranslating': 'Start translating',
  'web.translate.startConversation': 'Start conversation',
  'web.translate.end': 'End',
  'web.translate.pause': 'Pause',
  'web.translate.resume': 'Resume',
  'web.translate.notListening': 'Not listening',
  'web.translate.connecting': 'Connecting…',
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
  'web.translate.transcript': 'Transcript',
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
  'web.translate.displaySettings': 'Display settings',
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
  // The source picker's first entry: leave the spoken language to be recognised,
  // turn by turn, and translate it into the chosen translation language.
  'web.translate.autoDetect': 'Auto-detect',
  // A readout under the source header, never a control: which way the running
  // conversation actually translates, as the server answered it.
  'web.translate.modeTwoWay': 'Both ways',
  'web.translate.modeOneWay': 'One way',
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
  'web.translate.minutesTitle': 'Meeting minutes',
  'web.translate.minutesGenerate': 'Generate minutes',
  'web.translate.minutesRegenerate': 'Regenerate',
  'web.translate.minutesGenerating': 'Summarizing the conversation…',
  'web.translate.minutesEmpty':
    'No minutes yet. Generate them for a summary, key points, decisions and action items.',
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

  // ---- web.languageName / web.languageShort: a registry language's name in
  // THIS locale ----
  //
  // Keyed by code rather than by pair, unlike `web.history.languagePair*`
  // below: a history row or a glossary column names one language at a time, and
  // keying by code is what makes adding a language a data change here rather
  // than a new pair of keys. Distinct from `common.language.*`, which names the
  // INTERFACE locale and reads identically regardless of which two languages a
  // conversation is between.
  'web.languageName.vi': 'Vietnamese',
  'web.languageName.en': 'English',
  'web.languageName.zh': 'Chinese',
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
  'web.history.turnCount': '{count} lines',
  'web.history.turnCountOne': '1 line',
  'web.history.duration': '{minutes} min',
  // `languagePair` is the ACCESSIBLE name; `languagePairShort` is what is drawn on a
  // row. "Vietnamese → English" is 21 characters printed once per row, which at
  // eight rows is the loudest thing on a screen whose subject is the previews.
  // Both take the language names as `{from}`/`{to}` — see `web.languageName.*`
  // and `web.languageShort.*` above — rather than naming a pair, which is
  // what lets a third language reuse the same two templates.
  'web.history.languagePair': '{from} → {to}',
  'web.history.languagePairShort': '{from} → {to}',
  // Stands in for the source of a conversation whose turns were each recognised.
  'web.history.autoDetect': 'Auto-detect',
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
  // Named as DEFAULTS, because that is what this page holds now. The settings a
  // running conversation can still change moved onto `/translate` itself, so a
  // second copy of the same panel here needed a distinction a reader could say
  // out loud — and "where a new conversation starts from" is it.
  'web.preferences.conversation': 'Defaults for new conversations',
  'web.preferences.conversationHint':
    'A new conversation starts from these. While one is running you change what you can on the Translate page — languages and voice stay fixed until it ends.',
  // AI Context — the named library the translator is told about a KIND of
  // conversation from. Authored here; picked on Translate and in the extension.
  //
  // "AI Context" rather than "hints" or "glossary": the section holds four
  // different kinds of guidance and a name that picks one of them makes the other
  // three look misfiled.
  'web.preferences.aiContext': 'AI Context',
  'web.preferences.aiContextHint':
    'Tell the translator what a conversation is about before it hears any of it — the subject, names it should expect, and how particular terms should come out. Pick one when you start a conversation, here or in the browser extension.',
  'web.preferences.aiContext.empty': 'No contexts yet. Create one to get started.',
  'web.preferences.aiContext.new': 'New context',
  'web.preferences.aiContext.edit': 'Edit',
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
  'web.preferences.aiContext.register': 'Register',
  // The words explain the refusal rather than leaving a control dead.
  'web.preferences.aiContext.limitReached':
    'You have reached the maximum number of contexts. Delete one to create another.',
  'web.preferences.aiContext.saveFailed':
    'Could not save this context. Your changes are still here.',
  'web.preferences.aiContext.loadFailed':
    'Could not load your contexts. Your session is still valid.',
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

  // ---- web.conference: video conferencing lobby + in-call screen ----
  'web.conference.lobbyTitle': 'Video conference',
  'web.conference.create': 'Create a room',
  'web.conference.join': 'Join a room',
  'web.conference.yourName': 'Your name',
  'web.conference.yourNamePlaceholder': 'How others will see you',
  'web.conference.roomId': 'Room ID',
  'web.conference.roomIdPlaceholder': 'Enter a room ID to join',
  'web.conference.sourceLanguage': 'Your language',
  'web.conference.sourceLanguageVi': 'Tiếng Việt',
  'web.conference.sourceLanguageEn': 'English',
  'web.conference.sourceLanguageZh': '中文',
  'web.conference.start': 'Start',
  'web.conference.joining': 'Joining…',
  'web.conference.leave': 'Leave',
  'web.conference.waiting': 'Waiting for others to join…',
  'web.conference.connecting': 'Connecting…',
  'web.conference.nameRequired': 'Enter your name to continue.',
  'web.conference.roomRequired': 'Enter a room ID to join.',
  'web.conference.you': 'You',
  // ---- web.conference: in-call control bar ----
  'web.conference.muteMic': 'Mute microphone',
  'web.conference.unmuteMic': 'Unmute microphone',
  'web.conference.disableCamera': 'Turn off camera',
  'web.conference.enableCamera': 'Turn on camera',
  'web.conference.participants': 'Participants',
  'web.conference.cameraOff': 'Camera off',
  'web.conference.muted': 'Muted',
  'web.conference.rosterTitle': 'In this call',
  'web.conference.hideRoster': 'Hide participants',
  'web.conference.showRoster': 'Show participants',
  // ---- web.conference: in-meeting chat (Phase 4) ----
  // Flat side region — ghost/outline controls only; Leave stays the one accent control.
  'web.conference.chatTitle': 'Chat',
  'web.conference.chatPlaceholder': 'Type a message…',
  'web.conference.chatSend': 'Send',
  'web.conference.chatEmpty': 'No messages yet.',
  // ---- web.conference: edge-case states (Phase 5) ----
  'web.conference.permissionDenied': 'Camera and microphone access is required.',
  'web.conference.permissionDeniedHint':
    'Open your browser settings and allow access to the camera and microphone, then reload this page.',
  'web.conference.permissionDeniedAudioOnly': 'No camera access — joining with audio only.',
  'web.conference.disconnected': 'Connection lost.',
  'web.conference.disconnectedHint': 'The call ended. Return to the lobby to rejoin.',
  'web.conference.backToLobby': 'Back to lobby',
  'web.conference.errorGeneric': 'Something went wrong.',
  // ---- web.conference: audio unlock (Phase 1) ----
  // Inline notice when the browser's autoplay policy suspended a TTS AudioContext.
  // No card, no elevation — ghost button only; Leave stays the one accent control.
  'web.conference.audioBlocked': 'Sound is blocked by your browser.',
  'web.conference.enableAudio': 'Tap to enable sound',
  // Quiet readout when the speaker's translation ended for good mid-call.
  'web.conference.translationEnded':
    'Translation stopped — others now hear you without it. Rejoin the call to restart it.',
  // ---- web.conference: translating indicator (Phase 2) ----
  // Badge on the local tile from [T1] (first audio frame) to [T2] (final subtitle).
  // Pure readout — no accent fill; Leave stays the one accent control.
  'web.conference.translating': 'Translating…',
  // ---- web.conference: auto-reconnect (Phase 4) ----
  // Shown during a bounded auto-rejoin after an unexpected mid-call WS drop.
  // {attempt} is the current attempt number (1-based); {cap} is the maximum.
  // Leave stays the one accent control in this state too.
  'web.conference.reconnecting': 'Reconnecting ({attempt}/{cap})…',
  // ---- web.conference: room lifecycle ----
  // A room exists only once POST /conference created it; the socket refuses a
  // join to an id it does not know, or to a meeting its owner ended.
  'web.conference.creating': 'Creating…',
  'web.conference.createFailed': 'Could not create a room. Try again.',
  'web.conference.roomNotFound': 'This room does not exist.',
  'web.conference.roomEnded': 'This meeting has ended.',
  // ---- web.conference: the end screen, after Leave or the owner ending it ----
  // The minutes strings themselves are `web.translate.minutes*`: the end screen
  // renders the same minutes panel as /translate and history.
  'web.conference.endedTitle': 'Meeting ended',
  'web.conference.endedLoading': 'Loading the meeting…',
  'web.conference.endedNotFound': 'You were not in this meeting, or it does not exist.',
  'web.conference.endedLoadFailed': 'Could not load this meeting. Try again later.',
  'web.conference.summaryDuration': 'Duration',
  'web.conference.summaryLanguages': 'Languages',
  'web.conference.durationMinutes': '{minutes} min',
  'web.conference.durationHours': '{hours} h {minutes} min',
  'web.conference.durationUnknown': 'Not recorded',
  // A participant who joined without a name.
  'web.conference.guest': 'Guest',
  'web.conference.minutesNothingSaid':
    'Nothing was said in this meeting, so there is nothing to summarize.',
  'web.conference.chatRateLimited': 'Slow down — wait a few seconds before sending again.',
  'web.conference.chatNotSent': 'Message not sent.',
  'web.meta.conference': 'Conference · Chatofy',

  // ---- mobile.conference: the React Native conference lobby + call screen ----
  //
  // A separate namespace from `web.conference.*` because a few strings name a
  // surface the other cannot have: the permission hint points at the device's
  // settings app rather than a browser, and there is no "reload the page" on a
  // phone. The shared vocabulary could in principle be reused, but keeping the
  // mobile set whole lets each platform word a prompt the way it expects without
  // one leaking into the other.
  'mobile.conference.lobbyTitle': 'Video conference',
  'mobile.conference.yourName': 'Your name',
  'mobile.conference.yourNamePlaceholder': 'How others will see you',
  'mobile.conference.roomId': 'Room ID',
  'mobile.conference.roomIdPlaceholder': 'Enter a room ID to join',
  'mobile.conference.start': 'Start',
  'mobile.conference.ongoingTitle': 'In a meeting',
  'mobile.conference.ongoingBody':
    'Your microphone stays on while Chatofy is in the background. The camera turns off.',
  'mobile.conference.leave': 'Leave',
  'mobile.conference.you': 'You',
  'mobile.conference.connecting': 'Connecting…',
  'mobile.conference.waiting': 'Waiting for others to join…',
  // {attempt} is the current attempt (1-based); {cap} is the maximum.
  'mobile.conference.reconnecting': 'Reconnecting ({attempt}/{cap})…',
  // ---- mobile.conference: in-call controls (readouts + toggles) ----
  'mobile.conference.muteMic': 'Mute microphone',
  'mobile.conference.unmuteMic': 'Unmute microphone',
  'mobile.conference.disableCamera': 'Turn off camera',
  'mobile.conference.enableCamera': 'Turn on camera',
  'mobile.conference.participants': 'Participants',
  'mobile.conference.cameraOff': 'Camera off',
  'mobile.conference.rosterTitle': 'In this call',
  'mobile.conference.hideRoster': 'Hide participants',
  // ---- mobile.conference: error / edge states ----
  'mobile.conference.permissionDenied': 'Camera and microphone access is required.',
  'mobile.conference.permissionDeniedHint':
    'Open Settings and allow this app to use the camera and microphone, then try again.',
  'mobile.conference.permissionDeniedAudioOnly': 'No camera access — joining with audio only.',
  'mobile.conference.translationEnded':
    'Translation stopped — others now hear you without it. Rejoin the call to restart it.',
  'mobile.conference.notAuthenticated': 'You need to sign in to join the call.',
  'mobile.conference.disconnected': 'Connection lost.',
  'mobile.conference.disconnectedHint': 'The call ended. Return to the lobby to rejoin.',
  'mobile.conference.backToLobby': 'Back to lobby',
  'mobile.conference.errorGeneric': 'Something went wrong.',
  // ---- mobile.conference: translation UX (subtitles, transcript, language) ----
  'mobile.conference.translating': 'Translating…',
  'mobile.conference.sourceLanguage': 'Your language',
  'mobile.conference.sourceLanguageVi': 'Tiếng Việt',
  'mobile.conference.sourceLanguageEn': 'English',
  'mobile.conference.sourceLanguageZh': '中文',
  // The picker only takes effect before joining; once in the call it is a readout.
  'mobile.conference.sourceLanguageLocked': 'Language is fixed for this call.',
  'mobile.conference.transcript': 'Transcript',
  'mobile.conference.showTranscript': 'Show transcript',
  'mobile.conference.hideTranscript': 'Hide transcript',
  'mobile.conference.transcriptEmpty': 'Nothing has been said yet.',
  // ---- mobile.conference: in-meeting chat (translated per recipient) ----
  'mobile.conference.chat': 'Chat',
  'mobile.conference.showChat': 'Show chat',
  'mobile.conference.hideChat': 'Hide chat',
  'mobile.conference.chatPlaceholder': 'Type a message…',
  'mobile.conference.chatSend': 'Send',
  'mobile.conference.chatEmpty': 'No messages yet.',
  'mobile.conference.creating': 'Creating…',
  'mobile.conference.create': 'Create a room',
  'mobile.conference.join': 'Join a room',
  'mobile.conference.createFailed': 'Could not create a room. Try again.',
  'mobile.conference.roomNotFound': 'This room does not exist.',
  'mobile.conference.roomEnded': 'This meeting has ended.',
  'mobile.conference.chatRateLimited': 'Slow down — wait a few seconds before sending again.',
  'mobile.conference.chatNotSent': 'Message not sent.',
  'mobile.conference.endedTitle': 'Meeting ended',
  'mobile.conference.endedLoading': 'Loading the meeting…',
  'mobile.conference.endedNotFound': 'You were not in this meeting, or it does not exist.',
  'mobile.conference.endedLoadFailed': 'Could not load this meeting. Try again later.',
  'mobile.conference.summaryDuration': 'Duration',
  'mobile.conference.summaryLanguages': 'Languages',
  'mobile.conference.durationMinutes': '{minutes} min',
  'mobile.conference.durationHours': '{hours} h {minutes} min',
  'mobile.conference.durationUnknown': 'Not recorded',
  'mobile.conference.guest': 'Guest',
  'mobile.conference.minutesTitle': 'Meeting minutes',
  'mobile.conference.minutesGenerate': 'Generate minutes',
  'mobile.conference.minutesRegenerate': 'Regenerate',
  'mobile.conference.minutesGenerating': 'Summarizing the meeting…',
  'mobile.conference.minutesFailed': 'Could not generate minutes. Try again.',
  'mobile.conference.minutesNothingSaid':
    'Nothing was said in this meeting, so there is nothing to summarize.',
  'mobile.conference.minutesEmpty':
    'No minutes yet. Anyone who was in the meeting can generate them.',
  'mobile.conference.minutesSummary': 'Summary',
  'mobile.conference.minutesKeyPoints': 'Key points',
  'mobile.conference.minutesDecisions': 'Decisions',
  'mobile.conference.minutesActionItems': 'Action items',
  'mobile.conference.minutesNoActionItems': 'No action items.',
  'mobile.conference.minutesOwner': 'Owner',
  'mobile.conference.minutesDue': 'Due',
  'mobile.languageName.vi': 'Vietnamese',
  'mobile.languageName.en': 'English',
  'mobile.languageName.zh': 'Chinese',
  'mobile.home.comingSoon': 'coming soon',
  'mobile.home.joinConference': 'Join a conference',
  'mobile.home.signIn': 'Sign in',
  'mobile.auth.signInTitle': 'Sign in',
  'mobile.auth.email': 'Email',
  'mobile.auth.password': 'Password',
  'mobile.auth.signIn': 'Sign in',
  'mobile.auth.signingIn': 'Signing in…',
  'mobile.auth.missingFields': 'Enter your email and password.',
  'mobile.auth.invalidCredentials': 'Email or password is incorrect.',
  'mobile.auth.tooManyAttempts': 'Too many attempts. Wait a minute and try again.',
  'mobile.auth.signInFailed': 'Could not sign in. Check your connection and try again.',
  'mobile.auth.noAccount': 'No account yet? Create one on the Chatofy website, then sign in here.',
  'mobile.settings.signedInAs': 'Signed in as {email}',
  'mobile.settings.signedOut': 'You are not signed in.',
  'mobile.settings.signOut': 'Sign out',
} as const;

/** Every key any locale must carry. Derived, so a locale cannot drift from it. */
export type MessageKey = keyof typeof en;

/** A complete locale. `tsc` refuses one that is missing a key. */
export type Messages = Record<MessageKey, string>;
