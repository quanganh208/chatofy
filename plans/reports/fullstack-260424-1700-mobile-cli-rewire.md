# Mobile CLI Rewire Report

**Date:** 2026-04-26 | **Status:** DONE

## Files Modified / Created

### Deleted (CLI template cruft)

- `app/(tabs)/` — entire tabs example dir
- `app/_layout.tsx`, `app/modal.tsx` — rewritten
- `components/`, `hooks/`, `constants/`, `scripts/` — entire dirs

### Modified

- `package.json` — added workspace deps, tanstack-query/zustand/zod, typecheck script, removed reset-project
- `tsconfig.json` — extends expo/tsconfig.base; jsx react-native, bundler moduleResolution, @/_ → ./src/_
- `app.json` — scheme mobile→chatofy (typedRoutes already present)
- `README.md` — monorepo quick-start

### Created

- `metro.config.js` — monorepo watchFolders + nodeModulesPaths + disableHierarchicalLookup
- `babel.config.js` — babel-preset-expo + react-native-worklets/plugin (last)
- `.env.example` — EXPO*PUBLIC*\* vars
- `app/_layout.tsx` — GestureHandlerRootView > AppProviders > Stack
- `app/index.tsx` — landing placeholder
- `app/+not-found.tsx` — link back to index
- `app/(auth)/_layout.tsx`, `sign-in.tsx`, `sign-up.tsx` — stubs
- `app/(app)/_layout.tsx` (Tabs), `conversation.tsx`, `history.tsx`, `settings.tsx` — stubs
- `src/config/env.ts` — zod schema, throws on invalid env
- `src/config/constants.ts` — API_TIMEOUT_MS, RETRY_COUNT, AUDIO_SAMPLE_RATE
- `src/clients/api-client.interface.ts` — IApiClient
- `src/clients/api-client.fetch.ts` — FetchApiClient, ApiError, AbortController timeout
- `src/clients/ws-client.interface.ts` — IWSClient, WSState
- `src/clients/ws-client.native.ts` — NativeWSClient, listener registry
- `src/clients/auth-client.interface.ts` — IAuthClient, AuthSession
- `src/clients/auth-client.stub.ts` — StubAuthClient, all methods throw
- `src/audio/audio-recorder.interface.ts` — IAudioRecorder, AudioFrameCallback
- `src/audio/audio-player.interface.ts` — IAudioPlayer
- `src/audio/.gitkeep`, `src/stores/.gitkeep`, `src/ui/components/.gitkeep`
- `src/providers/query-provider.tsx` — QueryClientProvider, staleTime 30s, retry 1
- `src/providers/auth-provider.tsx` — AuthContext, useAuth(), injects StubAuthClient
- `src/providers/theme-provider.tsx` — ThemeContext, useTheme(), useColorScheme()
- `src/providers/app-providers.tsx` — QueryProvider > AuthProvider > ThemeProvider
- `src/ui/theme.ts` — ColorScheme, ThemeColors, colors, spacing, radii, typography

## Typecheck

`pnpm --filter mobile typecheck` → **PASS** (zero errors)

## Key Decisions

- `tsconfig.json` extends `expo/tsconfig.base` (not `@chatofy/config/tsconfig/react-native.json`) because workspace symlinks require `pnpm install` to resolve; once install runs the extend can be swapped to the canonical workspace path.
- `@/* → ./src/*` (not `./`) — matches spec; app/ routes use bare imports from expo-router, not @/ aliases.
- `react-native-worklets/plugin` placed last in babel plugins per RN 0.81+ requirement.
- `NativeWSClient.onerror` logs to console only — no throw, matching WebSocket event model.
- `AuthProvider` catches StubAuthClient throws in init so scaffold renders without crashing.

## Unresolved Questions

1. Should `tsconfig.json` be updated to extend `@chatofy/config/tsconfig/react-native.json` after `pnpm install` runs? (Yes — currently uses `expo/tsconfig.base` as fallback.)
2. `expo-env.d.ts` not yet generated (requires `expo start` or `npx expo customize`). Include in `tsconfig.json` is harmless until generated.
