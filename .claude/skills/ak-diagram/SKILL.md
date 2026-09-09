---
name: ak:diagram
description: >-
  Unified interactive diagram surface — compile typed JSON IR into deterministic, interactive
  architecture maps, technical workflows, API sequences, data pipelines, and state lifecycles
  (inspired by Archify); render Mermaid and editorial templates; export to SVG, self-contained
  HTML readers, PNG, and video. Use when the user requests an interactive system map, an
  Archify-style diagram, a grounded reader with shortest-route (R), reach tracing, role lenses (L),
  presentation stage (F), guided story chapters ([/]), or browser-free offline compilation.
  Distinct from ak:excalidraw (freeform editable canvas), ak:tech-graph (publication SVG/PNG),
  and ak:mermaidjs-v11 (raw markdown inline diagrams).
user-invocable: true
when_to_use: >-
  Choose ak:diagram when the desired artifact is a validated interactive system map,
  typed JSON IR diagram, or self-contained HTML reader with grounded graph queries. Route to
  ak:excalidraw for whiteboard sketches, ak:tech-graph for static publication charts, or
  ak:mermaidjs-v11 for inline markdown diagrams.
category: dev-tools
keywords: [diagram, archify, architecture, workflow, sequence, dataflow, lifecycle, interactive-map, system-map, visual-map, reader-runtime]
argument-hint: "[input-file] [--format <svg|fragment|html>] [--preset <classic|signal-flow|blueprint|editorial>] [--theme <light|dark>] [--out <path>]"
license: MIT
metadata:
  author: agentkit
  version: "2.1.0"
  upstream_templates: cathrynlavery/diagram-design (MIT)
  upstream_compiler: tt-a1i/archify v2.16.0 (MIT, commit c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de)
  vendored_mermaid_version: "11.4.1"
---

# ak:diagram — Unified System Map & Interactive Diagram Surface

Compile typed JSON IR specifications into deterministic SVGs, embeddable fragments, and self-contained interactive HTML readers without browser dependencies.

## Archetype Decision Matrix

| User Intent | Archetype | Primary Entities | Key Fields |
|---|---|---|---|
| System topology, microservices, boundaries | `architecture` | `components`, `boundaries`, `connections` | `role`, `layer` (0–10), `kind` |
| Multi-step execution, lane handoffs, decisions | `workflow` | `lanes`, `steps`, `transitions` | `kind`, `lane`, `condition` |
| Ordered API calls, request/response timing | `sequence` | `participants`, `messages` | `kind: sync-call \| return` |
| ETL pipelines, stream processing, data lineage | `dataflow` | `stages`, `nodes`, `flows` | `stage`, `role`, `classification` |
| Finite state machines, status transitions | `lifecycle` | `states`, `transitions`, `lanes` | `kind: initial \| active \| ...` |

## 5-Step Execution Playbook

1. **Select Archetype**: Match user intent to one of the 5 archetypes above.
2. **Author Typed JSON IR**:
   - Set envelope: `{"schema_version": 1, "diagram_type": "<type>", "meta": {...}}`.
   - Set visual preset: `classic` (clean slate), `signal-flow` (emerald/cyan glow), `blueprint` (technical dark blue), or `editorial` (warm serif).
   - Set theme: `light` or `dark`. For finite motion, set `animation: "trace"` ($\le 8\text{s}$).
   - Optional guided story: add `meta.views: [{"id": "ch1", "title": "...", "narrative": "...", "focus_nodes": [...]}]` (max 5 chapters).
3. **Apply Schema Invariants**:
   - Use strict role enums on nodes (compiler validates node roles at compile time).
   - Keep IDs alphanumeric + hyphens (`^[a-zA-Z0-9_-]{1,64}$`).
   - For `workflow`, ensure lane names have adequate horizontal space (`currentX >= 240`).
4. **Compile Offline (Zero Browser)**:
   ```bash
   node scripts/compiler/compile.mjs --input diagram.json --format html --out ./build/diagram.html --preset signal-flow --theme dark
   node scripts/compiler/compile.mjs --input diagram.json --format svg --out ./build/diagram.svg --preset signal-flow --theme dark
   ```
5. **Deliver & Embed**: Deliver the self-contained `.html` (interactive reader with keyboard shortcuts) or clean vector `.svg`.

## Schema Cheat Sheet & Valid Enums

### 1. Architecture (`diagram_type: "architecture"`)
- `components[]` (1–250): `role`: `frontend` | `backend` | `database` | `cache` | `queue` | `storage` | `gateway` | `auth` | `external` | `worker` (default `backend`). `layer`: integer 0–10.
- `boundaries[]`: `role`: `cloud` | `vpc` | `cluster` | `trust-boundary` | `private-network` | `external-zone`.
- `connections[]` ($\le 1000$): `kind`: `sync` | `async` | `stream` | `fallback` | `bi-directional`.

### 2. Workflow (`diagram_type: "workflow"`)
- `lanes[]`: `role`: `user` | `frontend` | `orchestrator` | `worker` | `approver` | `system`.
- `steps[]` (1–250): `kind`: `start` | `action` | `decision` | `wait` | `subprocess` | `terminal-success` | `terminal-failure`.
- `transitions[]` ($\le 1000$): `kind`: `normal` | `branch-true` | `branch-false` | `retry` | `exception`.

### 3. Sequence (`diagram_type: "sequence"`)
- `participants[]` (2–50): `role`: `client` | `service` | `database` | `gateway` | `external` | `queue`.
- `messages[]` (1–500): `kind`: `sync-call` | `async-signal` | `return` | `self-call` | `error` (only `return` renders dashed line).

### 4. Dataflow (`diagram_type: "dataflow"`)
- `stages[]`: `id`, `label`, `order` (integer).
- `nodes[]` (1–250): `role`: `source` | `transform` | `store` | `sink` | `consumer` | `filter` | `governance`. `classification`: `public` | `internal` | `confidential` | `pii` | `restricted`.
- `flows[]` ($\le 1000$): `from`, `to`, `label`.

### 5. Lifecycle (`diagram_type: "lifecycle"`)
- `states[]` (1–250): `kind`: `initial` | `active` | `waiting` | `failure-recoverable` | `failure-fatal` | `terminal-success` | `terminal-cancelled`.
- `transitions[]` ($\le 1000$): `kind`: `normal` | `retry` | `timeout` | `cancel` | `fail`.

## Grounded Reader Shortcuts

Interactive HTML readers include built-in client-side capabilities operating on authored topology:
- **Search (`/`)**: Case-folded label and ID search with highlight.
- **Node Focus (Click)**: Isolates component and direct edges.
- **Shortest Route (`R`)**: Highlights BFS shortest path between two selected nodes.
- **Role Lens (`L`)**: Filters nodes by semantic role (`gateway`, `database`, etc.).
- **Presentation Stage (`F`)**: Toggles distraction-free full-window view (`Esc` to exit).
- **Guided Stories (`[` / `]`)**: Advances through authored `meta.views` chapters.
- **Theme Toggle (`☀️/🌙`)**: Switches between light and dark palette without geometry shift.

## Common Commands

```bash
# Compile typed IR to standalone interactive HTML reader
node scripts/compiler/compile.mjs --input diagram.json --format html --out ./build/diagram.html

# Compile typed IR to clean vector SVG
node scripts/compiler/compile.mjs --input diagram.json --format svg --out ./build/diagram.svg

# Compile to embeddable scoped HTML fragment
node scripts/compiler/compile.mjs --input diagram.json --format fragment --preset signal-flow --theme dark

# Legacy Python wrapper (auto-detects typed IR vs Mermaid vs legacy template)
python3 scripts/render.py --input diagram.json --out ./build/
```

## Security & Boundaries

- **Zero Network**: Compilation operates offline in pure Node.js; no remote calls, telemetry, or font downloads.
- **Deterministic**: Compiling identical IR bytes emits identical SHA-256 output bytes across environments.
- **Finite Motion**: All animations are finite ($\le 8\text{s}$) and automatically disabled under `prefers-reduced-motion: reduce`.
- **Scope Limit**: For freeform whiteboard sketching, use `ak:excalidraw`. For static print infographics, use `ak:tech-graph`. For raw markdown inline doc blocks, use `ak:mermaidjs-v11`.
