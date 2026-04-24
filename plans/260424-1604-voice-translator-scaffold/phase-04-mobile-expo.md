# Phase 4 — apps/mobile (Expo)

**Priority:** P1 | **Status:** pending | **Depends:** Phase 2

## Overview

Expo SDK 52 + expo-router skeleton. Interface-first SDK clients (API, Audio, Auth, WebSocket). Empty screens — no UI features yet.

## Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx                    # root Stack with providers
│   ├── index.tsx                      # landing screen placeholder
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx                # empty screen
│   │   └── sign-up.tsx                # empty screen
│   └── (app)/
│       ├── _layout.tsx                # tabs placeholder
│       ├── conversation.tsx           # translation screen stub
│       ├── history.tsx                # transcript history stub
│       └── settings.tsx               # settings stub
├── src/
│   ├── providers/
│   │   ├── app-providers.tsx          # compose QueryClient + Auth + Theme
│   │   ├── query-provider.tsx         # TanStack Query
│   │   └── auth-provider.tsx          # uses IAuthClient
│   ├── clients/
│   │   ├── api-client.interface.ts    # IApiClient
│   │   ├── api-client.fetch.ts        # default fetch-based adapter
│   │   ├── ws-client.interface.ts     # IWSClient
│   │   ├── ws-client.native.ts        # default WebSocket adapter
│   │   ├── auth-client.interface.ts   # IAuthClient (swap Supabase/BetterAuth)
│   │   └── auth-client.stub.ts        # throws NotImplemented
│   ├── audio/
│   │   ├── audio-recorder.interface.ts  # IAudioRecorder
│   │   ├── audio-player.interface.ts    # IAudioPlayer
│   │   └── .gitkeep                     # expo-av/react-native-audio-api adapters later
│   ├── config/
│   │   ├── env.ts                     # reads EXPO_PUBLIC_*, validates via zod
│   │   └── constants.ts
│   ├── stores/
│   │   └── .gitkeep                   # zustand stores added during feature impl
│   └── ui/
│       ├── theme.ts                   # color tokens, spacing
│       └── components/.gitkeep
├── assets/
│   ├── icon.png                       # Expo default
│   ├── splash.png
│   └── adaptive-icon.png
├── .env.example
├── app.json                           # Expo config
├── babel.config.js
├── metro.config.js                    # monorepo-aware (watchFolders, resolver.nodeModulesPaths)
├── tsconfig.json                      # extends @chatofy/config/tsconfig/react-native
├── eslint.config.mjs
├── index.ts                           # Expo entry
└── package.json
```

## Key Design

**Interface-first clients** — all external dependencies hidden:

- `IApiClient.request<T>(config)` → fetch adapter default; swap for axios/ky later
- `IWSClient` — connect/send/onMessage/disconnect contract; native WebSocket default
- `IAuthClient.signIn/signUp/signOut/getSession` — stub impl throws NotImplemented
- `IAudioRecorder.start/stop/onFrame` — deferred, contract defined

**providers/app-providers.tsx** composes:

- QueryClientProvider (TanStack)
- AuthProvider (consumes IAuthClient via context)
- ThemeProvider (light/dark)

## Metro Monorepo Config

- `watchFolders`: repo root
- `resolver.nodeModulesPaths`: project + root node_modules
- `resolver.disableHierarchicalLookup`: false

## Dependencies

- Runtime: `expo`, `expo-router`, `react`, `react-native`, `@tanstack/react-query`, `zustand`, `zod`, `expo-constants`, `expo-status-bar`
- Workspace: `@chatofy/types`, `@chatofy/config`
- Dev: `@types/react`, `typescript`, `eslint-config-expo`

## Env (.env.example)

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_WS_URL`
- `EXPO_PUBLIC_ENV` (dev/staging/prod)

## Success Criteria

- `pnpm --filter mobile run start` boots Metro without errors
- `pnpm --filter mobile run typecheck` passes
- Empty screens render on iOS simulator + Android emulator (manual check)
- Monorepo imports resolve (`@chatofy/types` in a screen)
