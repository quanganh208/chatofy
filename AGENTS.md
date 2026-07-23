# AGENTS.md

This file provides guidance to OpenCode when working with code in this repository.

## Project Overview

**Name:** chatofy
**Type:** Node.js/TypeScript (Turborepo + pnpm monorepo)
**Description:** Real-time voice translation app. Directions: vi→en (ElevenLabs voice) and en→vi (local VieNeu voice via a Python sidecar). Apps: NestJS API, Expo React Native mobile, Next.js web. See `./README.md` for structure and quick start.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Agent Toolkit

This repo runs the **AgentKit (AK) engineer kit**, installed project-native into `./.claude` with lifecycle metadata under `./.agentkit`.

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

## Development Principles

- **YAGNI**: You Aren't Gonna Need It - avoid over-engineering
- **KISS**: Keep It Simple, Stupid - prefer simple solutions
- **DRY**: Don't Repeat Yourself - eliminate code duplication

## Documentation

Keep all important docs in `./docs` folder:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
└── system-architecture.md
```

## External Files

Reference external instruction files in `opencode.json`:

```json
{
  "instructions": ["docs/*.md", ".opencode/agents/*.md"]
}
```
