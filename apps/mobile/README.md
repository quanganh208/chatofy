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
