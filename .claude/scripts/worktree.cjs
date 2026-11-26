#!/usr/bin/env node
/**
 * Backward-compatible wrapper for worktree CLI.
 *
 * Canonical implementation:
 *   .claude/skills/ak-worktree/scripts/worktree.cjs
 *
 * Codex installs place skills under .agents/skills/ beside the .codex/ runtime
 * root instead of a skills/ sibling of this wrapper.
 */

const fs = require('fs');
const path = require('path');

const emittedPath = path.join(__dirname, '../skills/ak-worktree/scripts/worktree.cjs');
const codexPath = path.join(__dirname, '../../.agents/skills/ak-worktree/scripts/worktree.cjs');

require([emittedPath, codexPath].find((candidate) => fs.existsSync(candidate)) || emittedPath);
