# GitHub & AgentWiki Publishing (`--github`, `--wiki`)

## GitHub Issue Integration (`--github`)

When `--github` is passed, create or update a GitHub issue after plan validation and red-team gates:

1. **Prerequisites**: Ensure `gh` CLI is installed and authenticated (`gh auth status`). If unauthenticated, report the error without failing plan creation.
2. **Issue Content**:
   - Issue Title: `Plan: {plan-title}` (or comment on source issue if one exists).
   - Plan Summary: Objectives, phases roadmap, estimated effort.
   - Links: Repo-relative link to `plan.md` (and `plan.html` when `--html` is active).
   - Labels: Apply `ready to review` label after gates pass.
3. **Combined `--html --github`**: `plan.html` remains the authoritative plan. `plan.md` acts as the concise index satisfying GitHub issue link requirements.

## AgentWiki Publishing (`--wiki`)

When `--wiki` is passed, publish the reviewed plan to AgentWiki after the final plan gates (and after `plan.html` exists when `--html` is also present):

1. **CLI / MCP Availability**: Use the CLI when `command -v agentwiki && agentwiki whoami` succeeds; otherwise use AgentWiki MCP document/upload/share/static-site tools when exposed. If neither is available or authenticated, skip publishing without failing plan creation and report the exact missing capability.
2. **Private-First Default**: If phase details are split across files, first write `{plan-dir}/wiki-publish.md` as a concise combined document and upload that instead of `plan.md`.
   ```bash
   agentwiki doc upload "{plan-dir}/plan.md" \
     --title "{plan-title}" \
     --category "plans" \
     --tags "plan,{repo-slug}" \
     --json
   agentwiki doc share <id> --json
   ```
3. **Public Publish**: Run `agentwiki doc publish <id>` only when the user explicitly requests public visibility.
4. **HTML Site Upload**: When combined with `--html`, keep `plan.html` local and upload it as a static site only upon explicit request:
   ```bash
   agentwiki sites upload "{plan-dir}/plan.html" --title "{plan-title}" --json
   ```
5. **Redaction**: Do not publish secrets, tokens, raw logs, private env values, customer data, or local-only absolute paths.
6. **Output**: Include the returned URL in the final handoff response, record it in `plan.md`, and add it to the GitHub issue when `--github` is active.
