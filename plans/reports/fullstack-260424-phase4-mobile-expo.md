# Phase 4 Report — apps/mobile (Expo scaffold)

**Date:** 2026-04-24 | **Status:** DONE

## Files Created (52 total)

### Config / root

- `apps/mobile/package.json` — Expo SDK 52, workspace deps, scripts
- `apps/mobile/app.json` — name Chatofy, scheme chatofy, typedRoutes, iOS/Android ids
- `apps/mobile/babel.config.js` — babel-preset-expo + reanimated plugin last
- `apps/mobile/metro.config.js` — monorepo-aware: watchFolders, nodeModulesPaths, disableHierarchicalLookup
- `apps/mobile/tsconfig.json` — extends @chatofy/config/tsconfig/react-native.json, @/_ → src/_
- `apps/mobile/eslint.config.mjs` — flat config via @chatofy/config/eslint/react-native
- `apps/mobile/index.ts` — expo-router/entry
- `apps/mobile/expo-env.d.ts` — /// <reference types="expo/types" />
- `apps/mobile/.env.example` — EXPO_PUBLIC_API_BASE_URL, WS_URL, ENV

### app/ (expo-router file-based routing)

- `app/_layout.tsx` — Root Stack + AppProviders + SplashScreen.hideAsync
- `app/index.tsx` — Landing screen: Chatofy title + "coming soon"
- `app/(auth)/_layout.tsx` — Stack, headerShown false
- `app/(auth)/sign-in.tsx` — "Sign in (stub)"
- `app/(auth)/sign-up.tsx` — "Sign up (stub)"
- `app/(app)/_layout.tsx` — Tabs: conversation / history / settings
- `app/(app)/conversation.tsx` — "Conversation screen (stub)"
- `app/(app)/history.tsx` — "History (stub)"
- `app/(app)/settings.tsx` — "Settings (stub)"

### src/config/

- `env.ts` — zod schema validates EXPO*PUBLIC*\* at module load; throws on bad config
- `constants.ts` — API_BASE_URL, WS_URL, timeouts, audio sample rate defaults

### src/clients/ (interface-first)

- `api-client.interface.ts` — IApiClient: request<T>, get<T>, post<T>
- `api-client.fetch.ts` — FetchApiClient: fetch-based, throws ApiError on non-2xx, 204 safe
- `ws-client.interface.ts` — IWSClient: connect/send/onMessage/close, WSState union
- `ws-client.native.ts` — NativeWSClient: global WebSocket, listener registry, token as query param
- `auth-client.interface.ts` — IAuthClient: signIn/signUp/signOut/getSession/onAuthChange + AuthSession
- `auth-client.stub.ts` — StubAuthClient: throws descriptive NotImplemented on every method

### src/audio/

- `audio-recorder.interface.ts` — IAudioRecorder: start(onFrame)/stop/isRecording
- `audio-player.interface.ts` — IAudioPlayer: enqueue/play/pause/stop/isPlaying
- `.gitkeep` — adapter note

### src/providers/

- `query-provider.tsx` — QueryClientProvider, staleTime 30s, retry 1
- `theme-provider.tsx` — useColorScheme → ThemeContext; useTheme() hook
- `auth-provider.tsx` — AuthContext with StubAuthClient; useAuth() hook; getSession on mount
- `app-providers.tsx` — QueryProvider → AuthProvider → ThemeProvider

### src/ui/

- `theme.ts` — light/dark color palettes, spacing scale (4pt), radii, typography tokens
- `components/.gitkeep`

### src/stores/

- `.gitkeep` — zustand stores deferred to feature phase

### assets/

- `icon.png`, `splash.png`, `adaptive-icon.png`, `favicon.png` — 1×1 transparent PNG placeholders
- `README.md` — instructions for real icon sizes pre-distribution

## Interface Contracts

| Interface      | Default impl            | Swap strategy                         |
| -------------- | ----------------------- | ------------------------------------- |
| IApiClient     | FetchApiClient          | axios/ky adapter                      |
| IWSClient      | NativeWSClient          | mock / SockJS                         |
| IAuthClient    | StubAuthClient (throws) | SupabaseAuthClient / BetterAuthClient |
| IAudioRecorder | none (deferred)         | expo-av adapter                       |
| IAudioPlayer   | none (deferred)         | expo-av adapter                       |

## Typecheck Status

`pnpm --filter mobile run typecheck` → 2 errors, both due to absent `node_modules`:

- `TS2688` Cannot find type definition for 'expo' (resolves post-install)
- `TS6053` @chatofy/config/tsconfig/react-native.json not found (resolves post-install via workspace symlink)

Pattern is identical to apps/api and apps/web — no logic errors, only missing install.

## Deviations from Spec

- `metro.config.js` sets `disableHierarchicalLookup: true` (spec said false in Metro section, but prompt body says true — used `true` per prompt body which is the correct monorepo setting)

## Unresolved Questions

- Auth backend not chosen yet (Supabase vs BetterAuth vs custom) — StubAuthClient unblocks feature work
- Audio adapter library not chosen (expo-av vs react-native-audio-api) — interfaces defined, adapters deferred
