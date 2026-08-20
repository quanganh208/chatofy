# Red team — shared shadcn UI package plan (v1)

4 reviewers dispatched, 3 delivered. 28 findings, 7 Critical. Verdict on v1: **BLOCKED**.
All Critical findings re-verified against source by the controller before acceptance.
Disposition: 28 accepted, 0 rejected. No finding failed the evidence filter.

Lenses dispatched: Assumption Destroyer (Scope Auditor) · Failure Mode Analyst (Flow
Tracer) · Security Adversary (Fact Checker) · Scope & Complexity Critic (Contract
Verifier).

**Coverage caveat: three of four lenses delivered.** Failure Mode Analyst went idle twice
without returning findings, including after a direct re-request. Its assigned territory —
install-time ordering, the Turborepo task graph, the Phase 5 rollback hole, the hybrid
popup state, content-script contamination, CI — is materially covered by findings C6,
H11, H12 and H21 from the other three, but that is coverage by overlap, not by the
dedicated pass. Treat build/install-ordering as the least independently reviewed area of
this plan.

## Critical

**C1 — Every guard the plan relies on lives in a package that cannot run tests.**
`packages/ui/package.json` scripts: `build`, `prepare`, `typecheck`, `clean`. devDeps:
`@chatofy/config`, `tsup`, `typescript`. No `test`, no vitest. `turbo.json:45` runs
`test` only where the script exists. v1 put `skin-guard.spec.ts` **and the `"use client"`
directive test — the build-vs-source gate, the single most load-bearing assertion in the
plan** — inside it. Green forever because never executed. → Phase 1.

**C2 — Generated `theme.css` is three defects in one.**
(a) `globals.css:12-15` states "there is deliberately no codegen"; v1 reverses it without
argument. (b) Emitting CSS from `tokens.ts` then comparing that CSS to `tokens.ts`
verifies a generator against itself — most of `token-parity.spec.ts` becomes
unfalsifiable, including the test built to catch "both schemes pointing at one palette".
(c) `globals.css:22` `--font-sans: var(--font-inter), …`; `--font-inter` is injected by
`next/font` at render time and has no source in `tokens.ts`
(`token-parity.spec.ts:107` `DECLARED_ELSEWHERE`). A shared file carrying it gives the
popup a dangling reference and silently drops its `system-ui` stack; a shared file
omitting it leaves web with two `@theme inline` blocks, and the spec reads only the
first — documented twice as deliberate (`token-parity.spec.ts:69-70`, `:297-301`).
→ Phase 3, generator dropped entirely.

**C3 — The extension toolchain cannot see `.tsx`.**
`apps/extension/tsconfig.json:16` includes `**/*.ts` only; no `jsx` compilerOption
anywhere; `package.json:16` eslint globs `.ts`; `vitest.config.ts:15-16` is
`environment: 'node'` + `src/**/*.spec.ts`. v1 lands 400+ lines of `.tsx` and then
asserts "`turbo lint typecheck test build` xanh" — green because no tool opens the files.
`apps/web/vitest.config.ts:18-19` blocks the planned "render story in test" the same way.
→ Phase 1.

**C4 — The 9 sideways checks abort the suite, and are vacuous where they pass.**
`e2e/run.mjs:1304-1306` does `const pane = document.querySelector('main');
pane.scrollWidth` with no null guard, after a fixed `waitForTimeout(400)`. Under React,
`<main>` mounts after async storage reads; a miss throws inside `p.evaluate` and aborts
the harness rather than failing a check. And on `<main hidden>` both dimensions are 0, so
`over <= 0` passes — already vacuous today in the `consent-unseen` state, visible in its
own output line. Authored by the controller earlier in this session. → Phase 2.

**C5 — The `var(--color-` content-script guard can never match.**
Proven empirically, not argued: compiling Tailwind v4 with this repo's `@theme inline`
shape emits `.bg-background { background-color: var(--background) }` — 0 occurrences of
`var(--color-`. `inline` makes utilities use the theme variable's value rather than
reference it. The guard is green on a clean build and on a fully contaminated one.
v1 promoted it to a plan-level Success Criterion. → Phase 6, replaced by a manifest check.

**C6 — Both `.output`-reading guards run where `.output` does not exist.**
`turbo.json:45-46` `"test": { "dependsOn": ["^build"] }` — the caret means _dependencies'_
builds, never `extension#build`. `.github/workflows/ci.yml` runs test and build as
separate jobs. Fresh checkout → ENOENT, and the repo's own precedent for that
(`3a738f3` "skip the replay suite when its fixtures are absent") makes "skip when absent"
the likely patch, i.e. a permanent green skip. → Phase 1 (own task), Phase 6.

**C7 — Deleting `main.ts` breaks a spec no phase mentions.**
`apps/extension/src/popup-structure.spec.ts:27` reads `../entrypoints/popup/main.ts` at
module load. v1's delete list names only `popup-style.spec.ts`. ENOENT at import, red for
a filesystem reason, and the cheapest fix under pressure discards the "every id the
script looks up is declared" invariant with no decision recorded. → Phase 7.

## High

- **H8** `.npmrc:2-3` `auto-install-peers=true` + `node-linker=hoisted` neutralise the
  peerDependency mitigation; web pins react `19.2.5`, mobile `19.2.0`. Two React copies
  reachable by one bundler is the classic Invalid-hook-call. → Phase 1.
- **H9** `@chatofy/ui` is a **devDependency** of `apps/web`, about to become a runtime
  import. → Phase 1.
- **H10** Mobile's only gate is `tsc`; `apps/mobile` has no `build` script; Metro never
  runs in CI. Duplicate-React is a resolution failure, invisible to `tsc`. → Phase 1.
- **H11** `@import 'tailwindcss'` brings Preflight, which resets `button`, `fieldset`,
  `legend`, `select`, `h1`, `p`, `input` — every element the vanilla popup styles. v1's
  "UI cũ chưa đụng nên phải nguyên vẹn" is an invalid inference: the phase changes the
  cascade without changing markup. → Phase 6.
- **H12** `tsup.config.ts:14` `clean: true` + `:16` `outDir: 'dist'`; a second config
  wipes the first's output. `files: ["dist"]` means anything outside is unpublished.
  → Phase 3.
- **H13** `--popover` self-contradiction: plan.md says re-skin `bg-popover`→`bg-card`,
  the next sentence says add the token, and Phase 2 added it to `globals.css` — the file
  the popup does not read. Also would fail `token-parity.spec.ts:216-221`
  ("declares no colour the mapping does not account for"). → resolved to re-skin.
- **H14** `theme-toggle.tsx` absent from the Create list while a later phase Modifies it.
- **H15** `lucide-react` and `@chatofy/types` missing from the dependency list;
  `direction-toggle.tsx:3-5` and `theme-toggle.tsx:5` need them.
- **H16** ThemeToggle persistence is sync on web (`localStorage`, and the file documents
  why the first render must be `system`) and async on the extension
  (`src/theme.ts:19,25` return Promises). A shared component must be fully controlled —
  a behaviour change to a documented hydration-safety property.
- **H17** Radix Select finishes the plan with zero consumers: v1's own Phase 5 criterion
  keeps two native `<select>` and only Theme converts. → Phase 7 converts `#voice`.
- **H18** "Add a render check and prove it red before the rewrite" is unachievable: the
  check exists at `e2e/run.mjs:262`, and `index.html`'s `#toggle` carries static text
  "Start", so a top-level throw still leaves it non-empty. → Phase 2 strengthens it.
- **H19** Eight new third-party packages enter an extension holding `tabCapture`,
  `scripting` and microphone access. `.github/dependabot.yml` is an explicit allow-list
  naming `react` as implicitly ignored; none of the eight appear. CI has no `pnpm audit`.
  → Phase 1.
- **H20** No a11y test exists anywhere in `apps/web` (only `design/token-*.spec.ts` and
  `lib/theme.spec.ts`), so v1's stated risk signal for the roving-tabindex→Radix swap
  cannot fire. → Phase 5 adds a keyboard test before the swap.
- **H21** Content-script CSS is emitted as a sibling asset registered in the manifest's
  `css` array and injected into the **host page**, not the shadow root. The damage is
  Preflight landing on meet.google.com plus a stable stylesheet in `document.styleSheets`
  — a Chatofy-user fingerprint, against the anti-detection invariant at
  `overlay-invariants.spec.ts:152-159` and the deliberate absence of
  `web_accessible_resources` (`wxt.config.ts:89-95`). → Phase 6 asserts on the manifest.
- **H22** Deleting the CSP rationale from `wxt.config.ts:11-12` and
  `packages/ui/README.md:19-20` trades a durable constraint for a transient observation.
  The constraint did not become false; it became satisfied. → Phase 8 rewrites it as a
  live constraint pointing at a gate that runs.
- **H23** `languageName` has two consumers — `direction-toggle.tsx:5` and
  `live-panel.tsx:5` — not one. → Phase 5 exports it from `/react`.

## Medium

- **M24** No `innerHTML`/`dangerouslySetInnerHTML` guard for the popup. The rule is
  asserted for `overlay.ts` only (`overlay-invariants.spec.ts:139-140`); the popup follows
  it by convention (`main.ts:41-43`), enforced by nothing. React makes the escape hatch one
  word, and the popup renders tab-derived (`main.ts:285`) and worker-derived
  (`main.ts:209`) strings. Three lines, mirrors the existing invariant.
- **M25** Consent is static markup today (`index.html:32-49`) and paints even if the
  script throws. Moving it into the React tree puts the recording disclosure in the
  failure domain, and `#toggle` is a sibling of `#consent`, not a child.
- **M26** `e2e/run.mjs:1350` hard-codes `shots.length === 20`; "e2e 46/0" is asserted in
  three phases while two of them change the count.
- **M27** `packages/ui/README.md:44` "**No dependencies.**" is outside v1's doc scope but
  is exactly the rule Phase 3 breaks. `docs/design-guidelines.md` contradicts nothing —
  it is an addition, not a correction. The `blockedBy` criterion was already satisfied.
- **M28** `rounded-md`→`rounded-[var(--radius-md)]` is a no-op (`globals.css:57` already
  declares `--radius-md`) and strictly worse. `e2e/run.mjs:1266-1271` wires any
  `pageerror` to a check named "the popup state stubs installed", so a React render throw
  reports under a misleading name; `:1279-1280` stubs `sendMessage` to resolve `undefined`
  for every type except `query`.

## Open, carried into the plan

1. `radix-ui` umbrella vs scoped `@radix-ui/react-*` — web uses scoped today.
2. Does WXT emit content-script CSS as manifest `css[]` or inline it? Not verifiable here
   (`node_modules` blocked); Phase 6 verifies against a real build before writing a guard.
3. Does `packages/ui` → `@chatofy/types` create a cycle? Unchecked.
