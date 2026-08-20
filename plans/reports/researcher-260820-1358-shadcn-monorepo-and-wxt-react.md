# Research: shadcn monorepo + WXT/React facts

Date: 2026-08-20. Verified against live docs/repos/registry, not memory.

## 1. shadcn in a pnpm monorepo with Tailwind v4

Official docs: https://ui.shadcn.com/docs/monorepo (fetched via source MDX, `shadcn-ui/ui` repo `apps/v4/content/docs/(root)/monorepo.mdx`, and the `templates/next-monorepo` reference template — both current as of 2026-08-20).

- Init: `npx shadcn@latest init --monorepo` (or `--no-monorepo` to skip the prompt). Creates two workspaces (`apps/web`, `packages/ui`) + Turborepo.
- **`-c, --cwd <cwd>`** is the flag for targeting a workspace — confirmed on `init`, `add`, `apply`, `search` (source: `shadcn-ui/ui` skills/cli.md, raw-fetched). Docs' own workflow is `cd apps/web && npx shadcn@latest add <component>` rather than `--cwd` from repo root, but both work.
- Every workspace needs its own `components.json`. Exact shapes (verbatim from docs):

  `apps/web/components.json`:

  ```json
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "base-nova",
    "rsc": true,
    "tsx": true,
    "tailwind": {
      "config": "",
      "css": "../../packages/ui/src/styles/globals.css",
      "baseColor": "neutral",
      "cssVariables": true
    },
    "iconLibrary": "lucide",
    "aliases": {
      "components": "@/components",
      "hooks": "@/hooks",
      "lib": "@/lib",
      "utils": "@workspace/ui/lib/utils",
      "ui": "@workspace/ui/components"
    }
  }
  ```

  `packages/ui/components.json`:

  ```json
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "base-nova",
    "rsc": true,
    "tsx": true,
    "tailwind": {
      "config": "",
      "css": "src/styles/globals.css",
      "baseColor": "neutral",
      "cssVariables": true
    },
    "iconLibrary": "lucide",
    "aliases": {
      "components": "@workspace/ui/components",
      "utils": "@workspace/ui/lib/utils",
      "hooks": "@workspace/ui/hooks",
      "lib": "@workspace/ui/lib",
      "ui": "@workspace/ui/components"
    }
  }
  ```

  `style`/`iconLibrary`/`baseColor` must match across every `components.json`. **For Tailwind v4, `tailwind.config` must be `""` (empty).**

- Tailwind theme CSS lives in the shared package: `packages/ui/src/styles/globals.css`, referenced by the app's `tailwind.css` path pointing at it.
- `@source` directive: **relative glob paths, NOT a package name.** Verbatim from the reference template's actual `packages/ui/src/styles/globals.css`:
  ```css
  @import 'tailwindcss';
  @source "../../../apps/**/*.{ts,tsx}";
  @source "../../../components/**/*.{ts,tsx}";
  @source "../**/*.{ts,tsx}";
  ```
  Paths are resolved relative to the CSS file. This is how the consuming app's classnames get scanned — the _shared package's_ CSS file reaches out and globs the _app's_ source, the opposite direction of what's usually assumed. Community reports confirm `@source` **cannot reliably reach into `node_modules`** even for workspace-linked packages (github.com/tailwindlabs/tailwindcss discussions #18770, #19314) — glob against source paths, not `node_modules/@scope/pkg`.
- Alternative `package.json#imports`-based alias scheme is also documented (no `tsconfig.json` paths needed), using local `#...` aliases + `exports` map — optional, not required.

## 2. Ship source vs build for shared shadcn package

**shadcn's own monorepo template ships raw, unbuilt `.tsx`/`.ts` source — it does NOT build `packages/ui`.** Confirmed by inspecting the actual `templates/next-monorepo/packages/ui/package.json`: no build script, no tsup/tsdown, no `main`/`module`/`dist`. Only:

```json
"exports": {
  "./globals.css": "./src/styles/globals.css",
  "./postcss.config": "./postcss.config.mjs",
  "./lib/*": "./src/lib/*.ts",
  "./components/*": "./src/components/*.tsx",
  "./hooks/*": "./src/hooks/*.ts"
}
```

- Next side: `apps/web/next.config.ts` sets **`transpilePackages: ["@workspace/ui"]`** — required because Next's SWC/webpack pipeline otherwise won't transform TS/JSX from a package it treats as an external dependency.
- Vite side (`templates/vite-monorepo`): **no transpilePackages equivalent exists, and none is needed.** `apps/web/vite.config.ts` has zero special handling for `@workspace/ui` beyond it being a normal `workspace:*` dependency + `@vitejs/plugin-react`. Vite/esbuild transforms pnpm-symlinked workspace source directly as part of normal module graph resolution; it doesn't require pre-bundling or an allowlist the way Next's webpack/SWC pipeline does. (This is Vite's documented default dep-handling behavior; no dedicated doc page states "no transpilePackages needed" because the problem doesn't arise.)

**Implication for chatofy:** the project already committed to _building_ `packages/ui` with tsup (for Metro/RN + npm-package-style consumption), which diverges from shadcn's own reference approach. That's a valid, deliberate choice (Metro's own transform pipeline is not guaranteed to handle arbitrary raw TSX the way Vite/Next's SWC does, and a built package gives one predictable JS+d.ts contract across 3 different bundlers) — but it reintroduces the `"use client"`-preservation problem that shadcn's own template sidesteps by shipping source. See Q3.

## 3. `"use client"` preservation with tsup

esbuild strips leading directives from bundled output by default (github.com/evanw/esbuild/issues/3115, open request since 2023, no native esbuild fix shipped).

- **Current known-good fix:** `esbuild-plugin-preserve-directives` (npm, github.com/Seojunhwan/esbuild-plugin-preserve-directives). Works with tsup via `esbuildPlugins`:
  ```ts
  import { defineConfig } from 'tsup';
  import { preserveDirectivesPlugin } from 'esbuild-plugin-preserve-directives';

  export default defineConfig({
    metafile: true, // required for per-chunk accuracy
    esbuildPlugins: [
      preserveDirectivesPlugin({
        directives: ['use client', 'use strict'],
        include: /\.(js|ts|jsx|tsx)$/,
        exclude: /node_modules/,
      }),
    ],
  });
  ```
  `metafile: true` is required so the plugin can map directives to the correct output chunk. UNVERIFIED: exact current maintenance cadence/last-publish date of this plugin — search results didn't surface it; treat as a small single-maintainer package, spot-check `npm view esbuild-plugin-preserve-directives time` before depending on it long-term.
- **Known-good alternative that avoids the problem entirely: don't build with esbuild/tsup.**
  - Option A (what shadcn does): ship raw source + `transpilePackages` (Next-only escape hatch, doesn't help Metro/RN).
  - Option B: switch the build tool to **tsdown** (Rolldown-based, the maintained successor positioned as a tsup replacement, github.com/rolldown/tsdown). Rolldown preserves `"use client"` natively when `output.preserveModules` is enabled (rolldown.rs/in-depth/directives) — no plugin needed. A Jan-2026 tsdown issue (github.com/sxzz/rolldown-plugin-dts/issues/174) shows the ecosystem is still actively shaking out edge cases (banner directive leaking into `.d.ts` output), so treat tsdown's directive handling as newer/less battle-tested than the mature `esbuild-plugin-preserve-directives` + tsup combo.
  - Rollup equivalent for reference only (not your bundler): `rollup-plugin-preserve-directives` + `preserveModules: true`.

**Flux flag:** this whole area (directive preservation across esbuild/rolldown/rollup) is actively evolving in 2026 as tsdown adoption grows. tsup itself has no native fix; you depend on either a third-party esbuild plugin or a bundler switch.

## 4. React inside a WXT MV3 extension

- Official module: **`@wxt-dev/module-react`** (npm, github.com/wxt-dev/wxt `packages/module-react`). Install: `pnpm i react react-dom` + `pnpm i -D @wxt-dev/module-react`, then:
  ```ts
  // wxt.config.ts
  export default defineConfig({
    modules: ['@wxt-dev/module-react'],
    react: { vite: {/* optional vite react-plugin opts */} },
  });
  ```
  Enables React in HTML pages (popup, options) and content scripts.
- **Production CSP / eval:** MV3's `extension_pages` CSP hard-forbids `unsafe-eval`/`unsafe-inline`; Chrome rejects install-time if you try to add them (developer.chrome.com/docs/extensions/reference/manifest/content-security-policy). WXT's production build goes through Vite's standard production bundling (no `eval`, no dev-only `new Function` codepaths) — this is standard Vite prod-build behavior, not a WXT-specific claim I found explicitly documented; I did not find a WXT doc page that states "prod build is CSP-clean" in so many words. Treat as **high-confidence but not directly WXT-doc-cited**; verify by inspecting your actual `.output/chrome-mv3/*.js` for `eval(`/`new Function(` post-build if this matters for a store submission.
- **Dev mode does need something special:** WXT injects a `localhost` CSP entry to support Vite's HMR client, but Chrome MV3 forbids `http://` origins in `extension_pages` CSP. This is a known friction point (dev.to/toyama0919/chrome-126-broke-my-wxt-extension-dev-setup...); some devs strip the injected localhost CSP entry via a WXT build hook when Chrome version enforcement breaks it. Chrome added a `localhost`/`127.0.0.1` allowance for **unpacked** dev extensions specifically to support this (chrome v110+), so it self-resolves for unpacked/dev use but is version-sensitive — flagged as in-flux.
- **Popup entrypoint trap:** WXT's own docs (wxt.dev/guide/essentials/entrypoints) don't call out a popup-specific gotcha themselves. The real trap is general MV3 behavior, not WXT-specific: **the popup's JS context is destroyed the instant it loses focus/closes**, so any in-flight async work (fetch, timers, promises awaiting a response) is silently killed — no unmount cleanup runs, no error surfaces. Standard mitigation: keep authoritative state in the background service worker + `chrome.storage`, treat the popup as a disposable view. Also: `root.unmount()` (React 19 `createRoot`) is one-way — don't try to `render()` again on an unmounted root; create a fresh root if you ever need to remock a popup's DOM node (applies more to content-script UI than popup, but worth noting since the same React root APIs are used).

## 5. Radix UI + React 19.2

Checked directly against the npm registry (2026-08-20), not blog posts:

- `radix-ui@1.6.7` (latest): `peerDependencies.react = "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"`.
- `@radix-ui/react-select@2.3.7` (latest): identical peer range.
- **Conclusion: full, clean React 19.2 support, no peer-dep warnings expected, no packages found lagging.** Earlier 2025 GitHub issues about React-19 peer conflicts (excalidraw/excalidraw#9253, #9435; radix-ui/primitives#2909, #3314) are all resolved in current releases — those were transitional pre-19.0-stable pains, not current-state facts.
- **`radix-ui` umbrella package is the currently recommended install** over per-primitive `@radix-ui/react-*` packages — it re-exports every primitive from one place, avoiding duplicate/conflicting transitive versions (radix-ui.com/primitives/docs/overview/releases). Per-primitive packages (`@radix-ui/react-select`, etc.) still work and remain published/maintained for existing consumers; both are viable, umbrella is simpler for new code.

## 6. Bundle weight (React 19 + react-dom + Radix Select + Radix Checkbox)

Pulled live from bundlephobia's API (2026-08-20), not cached blog numbers:

| Package                              | min     | gzip    |
| ------------------------------------ | ------- | ------- |
| `react@19.2.0`                       | 7.65 KB | 2.93 KB |
| `react-dom@19.2.0` (main entry only) | 3.70 KB | 1.41 KB |
| `@radix-ui/react-select@2.2.6`       | 71.4 KB | 24.7 KB |
| `@radix-ui/react-checkbox@1.3.3`     | 10.7 KB | 4.1 KB  |

**Caveat, important:** bundlephobia's `react-dom` figure measures only its package-root entry, not the `react-dom/client` subpath your app actually imports (which pulls in the full reconciler/scheduler and is what real bundlers tree-shake against). That entry-point figure understates real-world cost. The widely-cited, more representative figure for **React + ReactDOM bundled together in a real app** is **~36–40 KB gzip** (Preact's own comparison marketing, corroborated across multiple 2025/2026 write-ups) — use that instead of the raw `react-dom` package number above.

**Defensible order-of-magnitude total for React 19 + ReactDOM + Radix Select + Radix Checkbox, bundled and tree-shaken:**

- ~38 KB gzip (React+ReactDOM) + ~25 KB gzip (Select, incl. its own deps: floating-ui, react-remove-scroll, etc.) + ~2-3 KB incremental for Checkbox (shares several deps with Select — `@radix-ui/react-context`, `-primitive`, `-slot`, `-use-controllable-state` — so its listed 4.1 KB gzip mostly double-counts once Select is already in the bundle)
- **≈ 65–70 KB gzip total**, order of magnitude confirmed, not a precise number — real figure depends on your bundler's dedup and what else is already in the popup bundle. For an MV3 popup this is a meaningful but not alarming chunk (well under typical 1-2 MB extension size limits, but worth being deliberate about since popup load time is user-visible).

## 7. Tailwind v4 in a WXT extension

**Yes, documented and working — via the Vite plugin, not PostCSS.** Confirmed directly from the official `wxt-dev/examples` repo (`examples/tailwindcss`, raw-fetched 2026-08-20):

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: () => ({ plugins: [tailwindcss()] }),
});
```

package.json: `@tailwindcss/vite@^4.1.4`, `tailwindcss@^4.0.9`, on `wxt@^0.20.5` — current major versions, compatible with your `wxt@^0.21.2`.

- The example's README explicitly follows Tailwind's own "Using Vite" install guide (tailwindcss.com/docs/installation/using-vite) — no WXT-specific PostCSS workaround needed; the plugin approach is the one WXT ships in its own examples repo.
- This is a `@tailwindcss/vite` plugin registration in `wxt.config.ts`'s `vite()` hook — it applies globally to whatever Vite builds (HTML pages like `popup.html`, and content scripts if you choose to use it there). **Per your scope note, only the popup-page usage is in scope here** — confirmed working for HTML/page entrypoints; not evaluated for shadow-DOM content-script injection as instructed.

---

## Unresolved / could not verify

- Exact current maintenance status (last publish date, open-issue count) of `esbuild-plugin-preserve-directives` — recommend a quick `npm view` check before adopting long-term.
- Whether WXT's production build is _explicitly documented_ as eval-free — inferred from Vite's standard prod pipeline, not a direct WXT doc citation. Recommend grepping the built `.output` bundle once you have one.
- Real gzip delta of adding Radix Checkbox once Select's shared deps are already bundled — bundlephobia numbers are per-package in isolation, not a true marginal-cost measurement; treat the 65-70 KB total as directional.

Status: DONE
Summary: All 7 questions answered with primary-source citations (official docs, live npm registry, reference-template source code). Two areas flagged as actively in flux: tsup/esbuild "use client" preservation (third-party-plugin-dependent, tsdown alternative still maturing) and WXT's dev-mode CSP/localhost HMR handling (Chrome-version-sensitive).
Concerns: chatofy's decision to build `packages/ui` with tsup (for Metro/RN) diverges from shadcn's own reference monorepo approach (ships raw source + `transpilePackages`), which reintroduces the "use client" directive-preservation problem shadcn's template avoids by construction — flagged in Q2/Q3, not a blocker, just worth the team being aware it's a self-inflicted complexity from the RN requirement.
