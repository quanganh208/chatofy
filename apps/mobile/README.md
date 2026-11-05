# Chatofy Mobile

Expo SDK 58 + expo-router app, part of the Chatofy monorepo.
It signs in and registers against the real auth client (email or Google), translates live speech, keeps a History of saved conversations and joins video meetings. It needs a development build: the native audio and WebRTC modules do not run in Expo Go.

## Quick Start

```bash
# From monorepo root
pnpm --filter mobile start

# Platform-specific
pnpm --filter mobile ios
pnpm --filter mobile android

# Type check
pnpm --filter mobile typecheck
```

## Environment

Copy `.env.example` to `.env.local` and fill in values before starting:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

## Structure

```
app/          expo-router file-based routes
src/
  clients/    interface-first API / WS / Auth clients
  providers/  React context providers (Query, Auth, Theme)
  config/     env validation + constants
  auth/       route guard, form rules, error wording, Google sign-in rules
  translate/  live translation: session hook, mode rules, settings, save, mic lock
  history/    how a stored conversation is described
  conference/ video meetings
  components/ screen-specific components (translate, conference, auth)
  ui/         theme tokens + shared components (Screen, TextField, buttons, sheet)
```

## Screens

```
app/
  index.tsx                 cold start: the app for a session, sign-in without one
  (auth)/                   sign-in, sign-up, forgot-password, verify-email, reset-password
  (app)/                    signed-in tabs (a signed-out visitor is sent to sign-in)
    translate.tsx           live translation
    history/                saved conversations: list, then one conversation
    conference/             video meetings
    settings.tsx            account and sign out
```

**Email links open the app.** Registering or asking for a reset sends `client: 'mobile'`,
so the mail carries `chatofy://verify-email?token=…` (or `reset-password`). The api
chooses that link from its own `MOBILE_LINK_SCHEME`; see
`docs/architecture/authentication.md`. To try it without mail, open the link the api
prints to its console: `xcrun simctl openurl booted "chatofy://verify-email?token=…"`
or `adb shell am start -a android.intent.action.VIEW -d "chatofy://verify-email?token=…"`.

**Google sign-in** shows only on a platform that has a client id in `.env`
(`EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS` / `_ANDROID` / `_WEB`); the api must list the same
ids in `AUTH_GOOGLE_MOBILE_IDS`. Steps: `docs/environment-variables.md`, "Google sign-in".

## Translate screen

One screen for every way a conversation can run, speaking the same `/ws/translate`
contract as the web client (types from `@chatofy/types`, session and capture from
`@chatofy/realtime-client`, microphone from `src/conference/native-audio-capture.ts`).
Code is in `src/translate/` and `src/components/translate/`.

- **Source picker decides the mode.** A named source starts a two-way conversation
  where `canIdentify(pair, true)` holds (vi↔en); `detect` identifies each turn and is
  offered only where `canIdentify(pair, false)` holds; pairs with Chinese stay one-way.
  The rule is `src/translate/translate-mode.ts`.
- **What the server granted is what is shown.** `mode` on `server.session.ready` drives
  the "translating one way for now" line; `language_unavailable` is worded from its
  `detail` (`translate-refusal.ts`).
- **The translation pane is chosen per turn,** from the language the turn was spoken in,
  not from the pair's output language (`turn-display.ts`).
- **Voices** are sent per output language (`voices`), with a gender for the whole
  conversation. The speak switch and the voice list lock once a conversation runs,
  because the server decides whether to synthesize speech once, at start.
- **Saving.** A finished conversation is stored with `PUT /conversations/:id` using
  the projection web uses (`toConversationTurns`); an auto-detected one is stored with
  `detectConversationLanguages(target)`. A failed save offers a retry only when
  resending could help. The conversation then appears in History.
- **One microphone owner.** A meeting and the translate screen cannot both record
  (`src/translate/mic-lock.ts`): whichever starts second is told why and the first is
  not stopped. Leaving the translate tab ends its conversation.
- **Not here:** glossaries, translation contexts, speaker labelling, recording and
  replay of the audio, and a fullscreen or floating caption view.
