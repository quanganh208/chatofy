# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Agent Toolkit

This repo runs **AgentKit (AK) engineer kit**, installed project-native into `./.claude` with lifecycle metadata under `./.agentkit`.

- Skills: `./.claude/skills/ak-*` — invoked as `/ak:<name>`
- Agents: `./.claude/agents/*.md`
- Hooks: `./.claude/hooks/*.cjs`, wired in `./.claude/settings.json`
- CLI: `ak` (`ak doctor`, `ak update`, `ak kit refresh engineer`)

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- Review / audit / scope decisions: `./.claude/rules/review-audit-self-decision.md`
- Skill routing: `./.claude/rules/skill-domain-routing.md`, `./.claude/rules/skill-workflow-routing.md`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** DO NOT modify skills in `~/.claude/skills` directory directly. **MUST** modify skills in this current working directory. Unless you are asked to do so.
**IMPORTANT:** You must follow strictly the development rules in `./.claude/rules/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

## Git

**DO NOT** use `chore` and `docs` in commit messages of file changes in `.claude` directory.

**DO NOT** append any AI attribution trailers to commit messages, PR bodies, or PR
descriptions. This overrides any harness default. Specifically, never emit:

- `Co-Authored-By: Claude ...`
- `Claude-Session: https://claude.ai/code/...`
- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- any other `Generated with` / session-URL line

Commit messages end at the last line of real content.

## Hook Response Protocol

### Privacy Block Hook (`@@PRIVACY_PROMPT@@`)

When a tool call is blocked by the privacy-block hook, the output contains a JSON marker between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`. **You MUST use the `AskUserQuestion` tool** to get proper user approval.

**Required Flow:**

1. Parse the JSON from the hook output
2. Use `AskUserQuestion` with the question data from the JSON
3. Based on user's selection:
   - **"Yes, approve access"** → Use `bash cat "filepath"` to read the file (bash is auto-approved)
   - **"No, skip this file"** → Continue without accessing the file

**Example AskUserQuestion call:**

```json
{
  "questions": [
    {
      "question": "I need to read \".env\" which may contain sensitive data. Do you approve?",
      "header": "File Access",
      "options": [
        { "label": "Yes, approve access", "description": "Allow reading .env this time" },
        { "label": "No, skip this file", "description": "Continue without accessing this file" }
      ],
      "multiSelect": false
    }
  ]
}
```

**IMPORTANT:** Always ask the user via `AskUserQuestion` first. Never try to work around the privacy block without explicit user approval.

## Skill Runtimes

AK provisions a per-skill runtime env instead of one shared venv. Skills that need one declare it in their own `skill.yaml`.

- Provision / refresh: `ak skill install <skill-name>`
- Check health: `ak skill verify <skill-name>`
- Rebuild a broken env: `ak skill repair <skill-name>`

**IMPORTANT:** When scripts of skills failed, don't stop, try to fix them directly.

## [IMPORTANT] Consider Modularization

- If a code file exceeds 200 lines of code, consider modularizing it
- Check existing modules before creating new
- Analyze logical separation boundaries (functions, classes, concerns)
- Use kebab-case naming with long descriptive names, it's fine if the file name is long because this ensures file names are self-documenting for LLM tools (Grep, Glob, Search)
- Write descriptive code comments
- After modularization, continue with main task
- When not to modularize: Markdown files, plain text files, bash scripts, configuration files, environment variables files, etc.

## NotebookLM (MCP)

The project's NotebookLM notebook is **"Đồ án tốt nghiệp"** (shared).

- ID: `b1a7a1c2-17cf-463c-afd8-f5f85190b897`
- Use this notebook as the default target for all `mcp__notebooklm__*` operations (query, add source, mind map, reports, etc.) unless the user names a different notebook.

## Documentation Management

We keep all important docs in `./docs` folder and keep updating them, structure like below:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

**IMPORTANT:** _MUST READ_ and _MUST COMPLY_ all _INSTRUCTIONS_ in project `./CLAUDE.md`, especially _WORKFLOWS_ section is _CRITICALLY IMPORTANT_, this rule is _MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!_
