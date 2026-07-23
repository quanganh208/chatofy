#!/usr/bin/env node
/**
 * Plan Subagent Stop Hook - Next Step Reminder
 *
 * Fires when Plan subagent completes. Presents user-choice next steps before implementation.
 * Also outputs full absolute path so new sessions (after /clear) can find the plan in worktrees.
 *
 * Exit Codes:
 *   0 - Success (non-blocking)
 */

// Crash wrapper
try {
  const fs = require('fs');
  const path = require('path');
  const { isHookEnabled, readSessionState, toDisplayPath } = require('./lib/ck-config-utils.cjs');

  // Early exit if hook disabled in config
  if (!isHookEnabled('cook-after-plan-reminder')) {
    process.exit(0);
  }

  async function main() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (!stdin) process.exit(0);
    let payload = {};
    try {
      payload = JSON.parse(stdin);
    } catch (_) {
      payload = {};
    }

    // Get active plan path from session state
    const sessionId = process.env.CK_SESSION_ID;
    let planPath = null;

    if (sessionId) {
      const state = readSessionState(sessionId);
      if (state?.activePlan) {
        planPath = state.activePlan;
        // Ensure it's absolute
        if (!path.isAbsolute(planPath) && state.sessionOrigin) {
          planPath = path.resolve(state.sessionOrigin, planPath);
        }
      }
    }

    // Output neutral next-step options with full absolute path if available.
    // Codex Stop hooks require JSON stdout on exit 0; plain text is invalid.
    const lines = [
      'Planning complete. Stop here and ask the user which next step they want: implement, validate, red-team, revise, or end.'
    ];
    if (planPath) {
      // This lands inside a command the model runs verbatim and unquoted, so a
      // backslash path would lose its separators the moment it reaches a shell.
      // path.join hands back native separators; render it before interpolating.
      const planMdPath = toDisplayPath(path.join(planPath, 'plan.md'));
      lines.push(`Optional implementation command after user approval: /ak:cook ${planMdPath}`);
    } else {
      // Fallback when plan path unavailable
      lines.push('Optional implementation command after user approval: /ak:cook {full-absolute-path-to-plan.md}');
    }
    lines.push('Add --auto only if the user explicitly asks for autonomous implementation.');

    if (payload && typeof payload.model === 'string') {
      process.stdout.write(JSON.stringify({
        continue: true,
        systemMessage: lines.join('\n')
      }));
    } else {
      console.log(lines.join('\n'));
    }

    process.exit(0);
  } catch (error) {
    // Silent fail - non-blocking
    process.exit(0);
  }
  }

  main();
} catch (e) {
  // Minimal crash logging (zero deps — only Node builtins)
  try {
    const fs = require('fs');
    const p = require('path');
    const logDir = p.join(__dirname, '.logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(p.join(logDir, 'hook-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), hook: p.basename(__filename, '.cjs'), status: 'crash', error: e.message }) + '\n');
  } catch (_) {}
  process.exit(0); // fail-open
}
