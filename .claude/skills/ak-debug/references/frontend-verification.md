# Frontend Verification

Visual verification of frontend implementations using `ak-agent-browser`, `ak-chrome-profile`,
Chrome MCP / `chrome-devtools-mcp`, or project-native browser tests. Skip it when the task did
not touch frontend files (`*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.html`, `*.css`, `*.scss`) or
UI behavior.

## Choose the Browser Path

Decide first whether the verification needs real Chrome profile state (login, cookies).

- **Not needed:** use `ak-agent-browser`, Chrome MCP for generic pages and low-level
  inspection, or the project's Playwright/Vitest/Cypress commands for repeatable evidence:
  ```bash
  agent-browser open http://localhost:3000
  agent-browser screenshot -o ./verification-screenshot.png
  ```
- **Needed:** invoke `ak-chrome-profile` and run `chrome-profile doctor`. If `ok=false`, follow
  that skill's setup playbook. If `ok=true`, start the dev server, then:
  1. `chrome-profile open --json <key> http://localhost:3000`
  2. List MCP pages/tabs and select the tab whose URL contains the returned `bind_selector`.
  3. Check that the selected tab URL also contains `cdp-profile=<key>`.
  4. Capture a screenshot or snapshot through the active MCP bridge.

  Do not create or navigate profile-scoped tabs with raw Chrome MCP tools.

## Check and Report

Read the screenshot with the `read_file` capability and check layout (no overflow or overlap),
rendered content, responsiveness when the viewport can be resized, interactions, and console
errors (for example `chrome__evaluate` with `JSON.stringify(window.__consoleErrors || [])`).
Console errors must be investigated before claiming done. Compare against the design spec or
the user's description.

This is the final gate after tests and build pass (see `verification.md`). If no browser tool
is available, skip it and say so in the report. Report format:

```
## Frontend Verification
- Method: [agent-browser | chrome-profile | Chrome MCP | project-native browser test | skipped]
- Screenshot: ./verification-screenshot.png
- Console errors: [none | list]
- Visual check: [pass | issues found]
- Responsive: [checked at X viewports | skipped]
```
