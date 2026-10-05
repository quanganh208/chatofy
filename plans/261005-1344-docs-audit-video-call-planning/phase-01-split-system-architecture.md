# Phase 01 — Split system-architecture.md

## Goal

Move content verbatim into topic files; keep `docs/system-architecture.md` as an index so every existing reference (docs links, code comments, `.env.example`) still lands somewhere useful.

## Target layout

| New file                                       | Sections moved                                                    | ~Lines |
| ---------------------------------------------- | ----------------------------------------------------------------- | ------ |
| `docs/architecture/contracts-and-languages.md` | Type Contract Standard, Response Envelope Architecture, Languages | 430    |
| `docs/architecture/ai-providers.md`            | AI Provider Abstraction                                           | 691    |
| `docs/architecture/authentication.md`          | Authentication                                                    | 470    |
| `docs/architecture/data-flow.md`               | Data Flow                                                         | 329    |
| `docs/architecture/modules-extension-ci.md`    | Module Organization, Browser extension path, CI/CD                | 294    |

## Steps

1. Cut by `## ` boundaries with a script (no rewording). Verify `cat` of new files equals old body minus index (diff line count).
2. Rewrite relative links inside moved content (`./x.md` → `../x.md`).
3. Index `system-architecture.md`: short overview, table "section → file", plus a `### Checklist: adding a language to the registry` stub and `## Browser extension path` stub that link to the new location (keeps inbound anchors alive). List the subsection phrases code comments cite (LID and audio-based detection, Bucket layout, token/cookie lifetimes, auto-attribution) with their new file.
4. Update README and PDR anchors to point at the new file directly.

## Validation

`wc -l docs/system-architecture.md docs/architecture/*.md` all ≤ 800; heading count before = after (excluding index stubs).

## Risk / rollback

Mechanical move; `git checkout docs/system-architecture.md && rm -r docs/architecture` rolls back.
