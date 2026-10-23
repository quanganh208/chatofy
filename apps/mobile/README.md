# Chatofy Mobile

Expo SDK 54 + expo-router app, part of the Chatofy monorepo.

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
  audio/      audio recorder/player interfaces
  stores/     zustand stores (added per feature)
  ui/         design tokens + shared components
```

## Translation screen (not built yet)

The mobile translate screen is planned separately. When it is built it speaks
the same `/ws/translate` contract as the web client, from `@chatofy/types`:

- **Source picker.** A concrete source starts a two-way turn
  (`client.session.start` with `twoWay: true`). The source `'detect'` starts a
  one-way turn into the target. Offer `'detect'` only when
  `canIdentify(pair, false)` holds, and send `twoWay` only when
  `canIdentify(pair, true)` holds. `turnCandidates` lists the languages a turn
  may come back in.
- **What the server granted.** Read `mode` (and `modeReason`) on
  `server.session.ready`. A missing `mode` means `declared`. A two-way start
  can come back `declared`, for example `lid_capacity`, so show that one-way
  is running. A refused detect start answers `server.error`
  `language_unavailable` with a `detail`.
- **Per-turn language.** Partials and deltas carry `language` once the server
  locks it. The final's `segment.sourceLanguages` is authoritative and may
  correct a partial's label. Pick the translation pane per turn, not from
  `pair.target`.
- **Voices.** Send `voices` keyed by language, so a reversed turn speaks in
  the voice chosen for its language.
- **Saving.** A detect conversation is saved with
  `detectConversationLanguages(target)`, and `isAutoDetectConversation`
  recognises one when it is read back.
