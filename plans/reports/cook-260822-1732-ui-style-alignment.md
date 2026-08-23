# Cook report — UI style alignment (direction C1 + Be Vietnam Pro)

Plan: `plans/260822-1625-ui-style-alignment/plan.md` · mode `--auto` · all 5 phases complete.
Branch `feat/auth-nest-idp`. Nothing committed — working tree only.

## Gates

| Gate                               | Result                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm turbo run test`              | 11/11 tasks green                                                             |
| `pnpm turbo run typecheck`         | 14/14 green                                                                   |
| `pnpm turbo run lint`              | 10/10 green (1 pre-existing warning, `theme-toggle-connected.tsx`, untouched) |
| `pnpm --filter extension test:e2e` | 78 passed, 0 failed                                                           |
| `knip`                             | same findings as baseline; `Input`/`insetField` not reported                  |

Every new assertion was mutation-tested — reverted the fix, confirmed red, restored.

## Phases

**1 — One typeface.** Web swapped Inter → Be Vietnam Pro (`next/font`, static family, explicit weights, var renamed `--font-be-vietnam`). Popup declares the same family from four committed woff2 subsets. `scripts/build-fonts.mjs` + `fonts.lock.json` pin the upstream commit, the exact `pyftsubset` flags, and SHA-256 of every source TTF and emitted woff2; a plain run re-verifies. +60.0 KB woff2, +4.4 KB OFL; build output 623→688 KB.

Verified via CDP (`CSS.getPlatformFontsForNode`), not by eye: both surfaces paint **Be Vietnam Pro** for latin, for `ẫ ệ ợ ữ ỹ ẳ ộ ắ ề Đ` (one family, no fallback substitution) and for SemiBold. No runtime request to googleapis/gstatic on either.

Phase 1 step 0 was already done — the signed-out e2e scenario exists (commit a31b1b1), so red-team finding A was stale on that point.

**2 — `Input`.** New primitive, 40px, `--text-body`, inset recess via `shadow-field` (composes into `--tw-shadow`, so the focus ring lands _on_ the recess). Six states, `aria-invalid`-driven. `insetField` added to `tokens.ts`; `--inset-field` declared in both stylesheets and mapped in the parity spec.

**3 — Button C1 (the gate).** Quiet button is now fill + `--elevation-sm` + inset hairline ring, no border. Measured in Chrome, both themes: hover `translate 0px -1px` + `elevation-md`; active `0px 1px` + `elevation-sm`; disabled drops shadow and movement. Under forced `prefers-reduced-motion: reduce` the **movement** is zeroed (not just the easing) while the fill step survives. `toggle.tsx` aligned; it deliberately does not lift.

**4 — Adoption.** Both hand-rolled field strings gone. Google button full-width with the four-colour mark. Login page: `text-title`, `Card` inside the existing `<Suspense>`, separator gated on `googleConfigured`. `Select` decided — trigger follows the _field_, 40px. `DirectionToggle`'s inert `hover:border-muted-foreground` replaced.

Both sign-in surfaces now measure identically: every control **40px / 14px**.

Security fix: `?next=` is clamped to a same-origin path (`same-origin-path.ts`) and the cast that hid it is gone. Rejects absolute, protocol-relative, backslash-normalised (`/\evil.example`), `javascript:`, relative and control-character forms.

**5 — Docs and floors.** Rewrote the superseded rule everywhere it was stated, including a **variant wording in the popup's `theme.css` that the plan's literal grep would have missed**. `docs/design-guidelines.md` gains a "Control depth" rule, the C1 record with its measured cost (1.13:1 / 1.17:1), the rejected C2 alternative, and the escalation list. Focus contradiction settled on the shipped 3px form — `app-shell.tsx` **and** `segmented-control.tsx` (a second instance the plan had not spotted). `contrast-floors.spec.ts` rows rescoped, Alert block marked as the recorded exception. New `app-skin-guard.spec.ts`: recursive walk, per-root floor, widened pattern.

## Three defects found that the plan did not predict

1. **`tailwind-merge` was dropping the type scale.** It files `text-body` as a _colour_, so any variant setting an ink colour lost its size. `Button` shipped 12px in the popup, 16px on web, 14px for `outline` alone — invisible in source. Fixed in `cn()` via `extendTailwindMerge`, with `type-scale-merge.spec.ts` (64 cases). **This was the one product-visible change beyond plan scope and you approved it.**
2. **C1 would have silently disabled the Alert's WCAG hue border.** The override sets a border _colour_; its 1px came from the `outline` variant C1 removes. The border would have disappeared while `skin-guard.spec.ts` kept finding the class string it greps for — the exact failure its own comment warns about. `alert.tsx` now sets the width; the guard asserts it. This is why `skin-guard.spec.ts` is modified rather than "unmodified" as phase 3 asked: an assertion was **added**, none relaxed.
3. **Tailwind v4 `translate-*` writes the CSS `translate` property, not `transform`.** The plan's step 2 ("add `transform` to the transition list") would have transitioned a property nothing writes — the lift would still happen, as one instant jump, with the source reading as eased. Caught by measuring the compiled stylesheet.

Also fixed: `layerColours()` in `token-parity.spec.ts` truncated at the first `)`, so it could not see a `light-dark()` with `rgba()` on **both** sides. Latent because every elevation layer has `transparent` on one side; `--inset-field` is the first token that does not.

## Deviations, stated

- **`insetField` is a top-level export**, not nested in `surfaceEdge` as phase 2 suggested — `surfaceEdge` entries are single colours compared with `halves()`, and this is an elevation-shaped layer list. Same justification (translucent, never enters the contrast table).
- **One transition duration** (`--duration-base`) for all four properties on `Button`, not the mockup's split. A single `transition-duration` utility cannot vary by property, and the arbitrary `[transition:…]` shorthand that could would hide the transition from `skin-guard`'s scan.
- **`hover:bg-border`, not the mockup's `hover:bg-muted`** — in this palette `--muted` and `--secondary` are the same value, so the mockup's hover changed no fill. Matters most under reduced motion, where the lift is suppressed.
- **`Input` fills `bg-background`**, not the mockup's `--card`; on a `Card` ground a `--card` fill would have had no contrast at all against it.
- **`/login` static rendering** — criterion unmeetable, premise false. `ƒ /login` before and after; `await auth()` reads the session cookie. Boundary kept and asserted for the day that changes.
- **`apps/web/vitest.config.ts`** now includes `app/**` — a spec written beside a route was being collected by nothing.

## Unresolved

- The four woff2 binaries are committed but unreviewed by a human; `fonts.lock.json` is the integrity anchor, and a re-run needs `fonttools[woff]`.
- `checkbox.tsx` and `radio-group.tsx` keep `border-border-control`. Correct under the new rule (their shape _is_ their edge) and now documented as escalation cases — but they were never named in the plan, so confirm that reading.
- Screenshot review of the popup and login page is still a human step; the e2e writes 21 states to `apps/extension/e2e/screenshots/`.
