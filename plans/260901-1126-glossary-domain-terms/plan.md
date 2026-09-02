# Glossary — domain terminology dictionary for consistent translation

**Status:** implemented (all four phases). Client methods landed in the web-local
client `apps/web/src/clients/api-client.ts` rather than the shared
`packages/api-client` (the shared package is a thin fetch wrapper); the
`benchmarks/prompt-injection` glossary case was added 2026-09-02.
**Date:** 2026-09-01.
**Depends on:** the translation hints feature (`TranslationHints` in
`packages/ai-providers`, `<context>` block in `prompt-builder.ts`) and the
authenticated live socket (`apps/api` `translate` module, `ws-auth.ts`).

## Problem

Domain terms (medical, legal, technical) are rendered inconsistently or wrongly
by the general Gemini MT model, and brand / product names get translated when
they should stay verbatim. The existing `hints.hotwords` only tells the model a
term _may appear_ — it does not enforce a source→target rendering, and there is
no place to keep a user's preferred term pairs across sessions. A glossary gives
each user a saved set of term **pairs** (vi ⇄ en) plus **keep-verbatim** entries,
applied automatically to every translation on their authenticated session.

## Approach — Hybrid (prompt-bias + deterministic keep-verbatim)

Two enforcement paths, matched to what each entry needs:

- **Term pairs → prompt-bias.** Injected as conditional "preferred rendering"
  lines into the existing `<context>` data block, reusing every prompt-injection
  defense already in `prompt-builder.ts`. Worded conditionally ("When the speaker
  says X, render it as Y") so it never violates the standing rule _"never let a
  term put words into a sentence that did not contain them."_ Morphology and word
  order stay the model's job — safe, natural output.
- **Keep-verbatim → deterministic.** For proper nouns that must appear identically
  in both languages, prompt-bias is the primary path AND a lightweight post-pass
  restores the exact spelling if the model translated it. Deterministic replace is
  safe _only_ here because the string is identical on both sides — no morphology
  risk, no reordering.

```
                    ┌─ user glossary (server, per user) ─┐
                    │  pairs {vi,en}  +  keepVerbatim[]   │
                    └──────────────┬─────────────────────┘
   authed WS turn ─┐               │ merged server-side into hints
                   ▼               ▼
            client hints ──▶ buildContextBlock ──▶ <context> "preferred renderings"
                                                    + "keep exactly" lines
                                          │
                                          ▼  Gemini translate (prompt-bias)
                                    model output
                                          │
                                          ▼  deterministic keep-verbatim post-pass
                                    final translation
```

## Key design decisions

1. **Glossary lives server-side, owner-scoped, merged on the authed socket.**
   The live WS is authenticated (`ws-auth.ts`), so the server knows the user and
   loads their glossary at session start, converting it into extended hints and
   merging with any client-sent hints. Consequence: the extension and mobile apps
   get the glossary automatically through the socket with **no client work** —
   only `apps/web` needs a management UI in v1.

2. **One glossary list per user in v1.** No named collections, no domain tagging.
   Modeled so a future `name`/domain column is additive, not a rewrite.

3. **Store as language-symmetric pairs, not source/target.** Columns `vi` + `en`
   apply in both directions; the session's source→target picks which column is the
   trigger and which is the rendering. A keep-verbatim proper noun stores the same
   string in both columns with `keepVerbatim = true`, so it works vi→en and en→vi.

4. **Glossary text is DATA, sanitized like hint text.** It comes from an
   authenticated user (less hostile than the socket hint path) but is still passed
   through `asTranscriptData` (strips angle brackets), capped, and fold-matched.
   It is never instruction. A glossary prompt-injection benchmark case proves a
   crafted term cannot flip behavior.

5. **Deterministic match = fold-insensitive, whole-token, longest-first.** Reuse
   `foldForMatch` (already tone/diacritic-insensitive) so "Hoà"/"Hòa" match; match
   on word boundaries to avoid substring hits; apply longer terms before shorter
   to avoid partial overwrites. Keep-verbatim only.

6. **Applied to every session for the user; no per-session toggle in v1.** A
   session-level on/off switch is future work (see Out of scope).

## Data model (Prisma)

New model, owner-scoped exactly like `MeetingMinutes` (plain `ownerId` column, no
`User` relation, so the glossary can be pruned/migrated without touching identity):

```prisma
model GlossaryTerm {
  id           String   @id @default(cuid())
  ownerId      String   // authenticated user; half of the uniqueness key
  vi           String
  en           String
  keepVerbatim Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([ownerId, vi, en])
  @@index([ownerId])
}
```

## Caps (bound prompt cost, in `packages/types`)

- `MAX_GLOSSARY_TERMS = 200` — a user's glossary injected per turn; caps the
  context cost the same way `MAX_HOTWORDS = 48` does today.
- `MAX_TERM_CHARS = 64` — per side, matching `MAX_HOTWORD_CHARS`.
  Over-cap terms are dropped at the injection boundary (never rejected mid-turn).

## Where it slots

| Layer                         | Change                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma`             | `GlossaryTerm` model + migration                                                                                                                                                 |
| `packages/types`              | zod schemas (term, create/update/list requests, CSV row), caps constants, extended `TranslationHints` term shape                                                                 |
| `packages/ai-providers`       | extend `TranslationHints` with a `terms` field; `buildContextBlock` renders pairs + keep-verbatim lines; keep-verbatim post-pass helper (fold-match, whole-token, longest-first) |
| `apps/api` translate module   | load user glossary at session start, merge into hints; apply keep-verbatim post-pass after the model returns                                                                     |
| `apps/api` glossary module    | new `GlossaryModule`: controller (`/glossary/terms` CRUD + CSV import), service, Prisma store, owner-scoping / IDOR guard                                                        |
| `packages/api-client`         | glossary CRUD + import client methods                                                                                                                                            |
| `apps/web`                    | glossary management page: list / add / edit / delete + CSV import                                                                                                                |
| `packages/i18n`               | vi/en strings for the management UI                                                                                                                                              |
| `benchmarks/prompt-injection` | a glossary case: a crafted term must not inject words or be obeyed                                                                                                               |
| `docs`                        | `system-architecture.md` + `codebase-summary.md` glossary sections                                                                                                               |

## Phases (when approved)

1. **Data + contracts.** `GlossaryTerm` model + migration; zod schemas and caps
   in `packages/types`; extend `TranslationHints` term shape. Unit tests for the
   schemas and caps.
2. **API CRUD.** `GlossaryModule` (controller / service / Prisma store),
   owner-scoping + IDOR guard (mirroring the minutes store), DTO validation, CSV
   import endpoint; `api-client` methods. e2e in-memory + Postgres.
3. **Translation integration.** `buildContextBlock` renders pairs (conditional
   wording) + keep-verbatim ("output exactly, do not translate") lines; server
   loads + merges the glossary into hints at session start; deterministic
   keep-verbatim post-pass in the pipeline. Unit tests for context rendering,
   merge, fold-match/longest-first replace, caps; the new injection benchmark case.
4. **Web UI + i18n + docs.** Management page (CRUD + CSV import), i18n strings,
   architecture + codebase-summary updates.

## Out of scope (v1)

- Multiple named glossaries / domain-tagged collections switchable per session.
- Per-session enable/disable toggle (v1 always applies the user's list).
- Sharing or publishing glossaries between users; a curated public domain pack.
- Languages beyond vi/en; fuzzy or semantic term matching (v1 is exact fold-match).
- Auto-suggesting terms from past transcripts.

## Resolved decisions (2026-09-01, with user)

- **Mechanism → Hybrid.** Prompt-bias for pairs; deterministic replace only for
  keep-verbatim.
- **v1 scope → term pairs + keep-verbatim flag, one list per user.**
- **Storage → server-persisted per user** (new Prisma model), merged server-side
  into hints on the authenticated socket.
- **Management → REST API + Web UI**, including CSV import.
