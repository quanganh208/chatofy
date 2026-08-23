# Audit — OOP / clean code / redundancy

Date: 2026-08-23 · Branch: `main` · Scope: whole repo · Mode: exploration only, no code changed

## Verdict

Code is already clean and correctly architected. Findings are hygiene-scale: **~20 lines
across 5 files**, under 30 minutes of work. The short defect list is the audit result, not
an incomplete audit — every cheap falsifier was run and came back green.

## Evidence

| Probe                      | Result                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm knip`                | **0 unused files.** 11 unused exports, 5 stale config entries                                      |
| jscpd duplication (all TS) | **1.20%** duplicated lines (>5% would have falsified "clean")                                      |
| Suppression census         | **2** `eslint-disable`, **1** `@ts-ignore`/`expect-error`, **4** `any` — across 379 non-spec files |
| `pnpm lint`                | 10/10 tasks pass, **0 errors**, 3 warnings                                                         |
| `pnpm typecheck`           | **14/14 pass**                                                                                     |
| CI enforcement             | `.github/workflows/ci.yml` runs lint, typecheck, test, e2e (×2), build, extension e2e              |
| Tests                      | 88 spec files, 11 api e2e suites, 4 python test modules                                            |

Scale: 379 TS/TSX source files. api 138/20k LOC · extension 59/10.4k · realtime-client 29/8.5k ·
web 60/5.8k · ui 29/2.9k · ai-providers 22/2k · types 18/1.1k · mobile 19/540 · api-client 5/321.

## 1. OOP — correct, and correctly scoped

Not a monolithic "is it OOP" answer: OOP is applied where it earns its keep and deliberately
absent where it would be wrong.

**Ports-and-adapters, verified:**

- `apps/api` (71 classes) — `interfaces/` hold Symbol DI tokens (`MAIL_SENDER`,
  `USER_REPOSITORY`, `AUTH_ADAPTER`, `SESSION_STORE`) alongside `adapters/`, `repositories/`,
  `senders/`, `stores/`, `mappers/`. Consumers inject the **interface**, never the concrete
  class → real Dependency Inversion. 5 `MailSender` implementations (Smtp/Console/Noop/Guarded/
  Recording) behind one interface → real Liskov substitution.
- `packages/ai-providers` (12 classes) — four **narrow** ports (`stt-provider`,
  `tts-provider`, `translation-provider`, `realtime-provider`) rather than one fat
  `AIProvider`. Textbook Interface Segregation. Adapters per vendor + `registry/`.
- `services/local-stt`, `local-tts` — Python `ABC` + `@abstractmethod` Template Method:
  `transcribe()` is the template, `load()` abstract, `postprocess()` a defaulted hook.
  Modules are small (~80–100 LOC) and tested. Not held to the TS OOP standard, and shouldn't be.

**Correctly NOT OOP:** `apps/web` and `packages/ui` have **0 classes**. That is idiomatic
React, not a defect — introducing classes there would be a regression.

**Inheritance discipline:** almost all `implements <Port>`. `extends` is nearly all
`createZodDto(schema)` (nestjs-zod idiom) plus generic constraints. No deep hierarchies, no
god-classes found.

## 2. Redundant files — none

knip reports **zero unused files**. `dist/` outputs exist on disk but are gitignored with 0
tracked files — non-finding.

## 3. "Used but still redundant" — the real answer to your question

11 unused exports split into three classes. All verified by grep; **no spec imports any of
them**, so all are zero-risk.

**Class A — symbol used inside its own file; only the `export` keyword is redundant:**

| Symbol                                       | File                                                | Used at  |
| -------------------------------------------- | --------------------------------------------------- | -------- |
| `REGISTER_PURPOSE`, `PASSWORD_RESET_PURPOSE` | `apps/api/src/modules/auth/purpose-token.ts:51,53`  | 187–287  |
| `WEB_BASE_URL`                               | `apps/api/src/modules/auth/auth-flow.harness.ts:23` | :86      |
| `saveAccessToken`                            | `apps/extension/src/access-token.ts:23`             | :109     |
| `SITE_ENABLEMENT_KEY`                        | `apps/extension/src/site-enablement.ts:32`          | :134–154 |
| `ComposedGraph`                              | `apps/extension/src/microphone-patch.ts:48`         | :83      |

⚠️ Name collision: the harness-local `WEB_BASE_URL` constant is **unrelated** to the
`WEB_BASE_URL` env var in `env.schema.ts` / `main.ts` / `auth-mailer.ts`. Don't "fix" the wrong one.

⚠️ Judgment call, yours: `purpose-token.ts` is 314 lines of carefully-commented security code.
Its two constants may have been exported _intentionally_ as public vocabulary. Either drop the
`export` or add a knip ignore with a why-comment — a decision, not a defect.

**Class B — genuinely dead, delete:** `spacing` / `radii` / `typography` at
`apps/mobile/src/ui/theme.ts:66-68` are bare re-aliases of `space`/`radius`. Only `colors`,
`ColorScheme`, `ThemeColors` are ever imported. The file's own comment already says they
"were scaffolding no screen ever read".

**Class C — dead destructure members:** `signIn`/`signOut` at `apps/web/auth.ts:72`. Verified
all app code imports these from `next-auth/react` instead, and only `auth` + `handlers` are
imported from `@/../auth`. Safe to drop from the destructure.

**Class D — 5 stale `knip.json` entries** knip itself flags. Confirmed
`to-user.mapper.ts` IS used (`auth.service.ts:11,179,192`), so its `ignore` entry is genuinely
stale. Also: `@types/chrome`, `tailwindcss`, `tw-animate-css`, `ignoreBinaries: ["blue,cyan,green"]`
(the last is a malformed single string, not three entries).

## 4. Duplication — investigated, all deliberate and guarded

Three duplication suspicions were raised and **all three were falsified by evidence**:

- **`extension/popup/theme.css` ↔ `web/app/globals.css`** (~140 identical token lines) — this
  is deliberate _and test-guarded_. `apps/web/src/design/token-parity.spec.ts:50-53` reads
  **both** files and asserts parity against `packages/ui/src/tokens.ts` in both directions.
  The alternative was considered and rejected in writing: emitting from `tokens.ts` "would
  leave this spec comparing a generator against itself". Reason the files can't merge is real:
  the popup's `--font-sans` resolves through a `next/font`-injected variable and the popup has
  no Next.
- **`live-translate-socket.ts` ↔ `translate-socket.ts`** — documented: "A sibling of
  `TranslateSocket`, not a mode of it… Folding them together would put a branch in every
  method of both."
- **`translation-session.service.ts` ↔ `live-translate-session.service.ts`** — the two already
  share the three real abstractions (`outbound-audio-framer`, `stream-socket`,
  `turn-concurrency`) and diverge only where behaviour differs. Divergence justified with a
  _measured_ failure: cutting the stream at the last speech sample returned "However, the
  graft" and nothing more.

Remaining duplication is spec-file self-similarity (`translation-session.service.spec.ts`
repeats ~18-line blocks at 1011/1445/1510/1639). Optional test-helper extraction, low priority.

## 5. The 200-LOC guideline — trigger fired, consideration performed

`CLAUDE.md` says "**consider** modularizing" — a review trigger, not a limit. It fired on 14
production files (spec files excluded). Result of the consideration:

**Leave whole (cohesive state machines).** Splitting one invariant across files optimizes a
line-counter at the reader's expense: `conversation-session.ts` 697, `turn-pipeline.ts` 568,
`translation-session.service.ts` 556, `live-translate-session.service.ts` 552,
`translate.gateway.ts` 485, `capture-pump.ts` 482, `ordered-playback.ts` 470.

**Exempt — data, not logic:** `ui/src/tokens.ts` 335.

**Checked for accretion, cleared:** `extension/entrypoints/background.ts` 702. It is explicitly
the _wiring_ layer (Humble Object): 10 Chrome listener registrations plus small named handlers,
with all rule-bearing state deliberately pushed to `../src/` because `entrypoints/` isn't
covered by the unit suite. Not three concerns in a trench coat.

**One worth a look:** `ConversationSession.start()` spans lines 246→481 (~235 lines, of which
79 are comments → ~156 lines of code). It is a cancellable resource-acquisition sequence with
staleness checks at each `await` — a legitimate pattern, but the single largest method in the
repo. Optional decomposition into `acquireResources()` / `wireHandlers()` / `validateRuntime()`.
Not a defect; the one place where size is doing real work against the reader.

## Recommendation

**One hygiene PR, ~20 lines, under 30 minutes:**

1. Drop `export` on the 5 Class A symbols (or knip-ignore the two `purpose-token` constants — your call).
2. Delete the 3 dead `theme.ts` aliases (Class B).
3. Drop `signIn`/`signOut` from the `auth.ts:72` destructure (Class C).
4. Remove the 5 stale `knip.json` entries; fix `ignoreBinaries: ["blue,cyan,green"]` → likely `["blue","cyan","green"]` or delete.
5. Re-run `pnpm knip` → should exit 0.

**Do not do:** add OOP to `web`/`ui`; "de-duplicate" the token CSS or the socket/session twins;
split the cohesive state machines. Each would trade a documented, measured decision for a
metric.

**Optional, separate:** decompose `ConversationSession.start()`; extract spec helpers.

## Unresolved questions

1. `purpose-token.ts` — were `REGISTER_PURPOSE` / `PASSWORD_RESET_PURPOSE` exported
   intentionally as public vocabulary, or is the `export` vestigial?
2. `knip.json` `ignoreBinaries: ["blue,cyan,green"]` — one malformed string. Intended as three
   binaries, or dead config to delete?
3. Do you want `CLAUDE.md`'s 200-LOC guideline annotated with a cohesive-state-machine
   exemption? Your rule, your call — this audit only reports how it was applied.
