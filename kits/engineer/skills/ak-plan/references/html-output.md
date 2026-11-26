# HTML Plan Output Contract (`--html`)

When `--html` is passed, `plan.html` is the primary, authoritative user-facing plan artifact produced after validation and red-team gates.

## Shared Composition Contract

Follow the shared HTML composition contract in `../../ak-preview/references/html-skill-composition.md`:
1. **Activate `ak-frontend-design` first** for page layout architecture, typography hierarchy, tokens, responsive shell, modal styling, and accessibility.
2. **Activate `ak-diagram` second** (when installed) to author and compile typed JSON IR for architecture, sequence, and implementation workflow diagrams.
3. **Fallback**: If `ak-diagram` is absent, produce clean semantic inline SVG/CSS with `<title>` and `<desc>`.

## AK Render Route (Opt-in)

With `--ak-render`, or when the project has an `.ak-render/` directory, write `plan.page.yaml` beside `plan.html` and compile it per `../../ak-preview/references/ak-render-route.md` (block mapping for `ak-plan` is listed there). The required sections below still apply; phase details become `accordion` items instead of modals, and local images are referenced by relative path instead of data URIs. Design Direction and the editorial visual layer apply to the default route only. If that route cannot run, use the default route and state the reason in the report.

## Artifact Rules

- **Location**: Write `plan.html` in the active plan directory (`plans/<slug>/plan.html`) after re-reading `plan.md` and every `phase-*.md`.
- **Self-contained**: Inline CSS and JavaScript, 0 build steps, 0 network-required assets. Safe to open directly via `file://`; verify no local asset paths are missing.
- **Companion `plan.md`**: Keep `plan.md` as a concise metadata index for GitHub/cook compatibility; do not duplicate the full plan body.
- **Embedded Visuals**: When image generation is available, generate 1-3 watercolor technical sketches, keep sources under `{plan-dir}/assets/`, and embed selected images as data URIs.
- Responsive and keyboard-accessible, with interactive tabs, filters, or toggles where useful.

## Required Sections & Features

1. **Header & Roadmap**: Plan title, status, metadata, and overview roadmap.
2. **Visible Phase Outlines**: Every phase shows title, priority, status, dependencies, objective, 3–6 key bullets, touched files, success criteria, and validation gates.
3. **Phase Detail Modals**: Clicking a phase opens a keyboard-accessible modal displaying the complete phase markdown rendered (headings, lists, checkboxes, tables, code fences, links, frontmatter metadata).
4. **Implementation Workflow Diagram**: At least one visual diagram (architecture, sequence, or workflow) rendered inline via `ak-diagram` typed IR.
5. **Annotated UI/UX Mockups**: When the plan touches UI/UX, embed annotated mockups derived from the project design guidelines (`docs/design-guidelines.md` when present), with callouts tied to design tokens, interaction states, and acceptance criteria.
6. **Open Questions & Citations**: Visible URL citations for external docs and GitHub issues; clear list of unresolved questions (or "None").

## Design Direction

Use editorial magazine styling: warm paper `#faf7f2`, paper panels `#f0ebe1`, ink `#0a0a0a`, muted `#6b6258`, accent red `#b8232c`, serif headings, monospace labels, and hairline dividers. No gradients, shadows, rounded cards, pure white backgrounds, emoji icons, or generic SaaS styling.

## Editorial Visual Layer

For KPI tiles or comparison panels, prefer AntV Infographic or diagram-design Quadrant when enabled (`.prefs.visual`). Kill switches: `--no-antv`, `--no-diagram-design`, `--no-editorial-visuals`. See `../../ak-preview/references/html-diagram-design.md` and `../../ak-preview/references/html-antv-infographic.md`.
