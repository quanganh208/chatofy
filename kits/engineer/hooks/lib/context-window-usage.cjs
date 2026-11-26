'use strict';

/**
 * Context-window pressure for the statusline.
 *
 * Claude Code compacts at CLAUDE_CODE_AUTO_COMPACT_WINDOW when that is set below
 * the model window, so pressure has to be measured against the window that
 * actually triggers compaction. The setting is read from the process env first
 * (Claude Code exports settings `env` to the statusline command), then from the
 * `env` block of local, project, and user settings in that precedence order.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTO_COMPACT_WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

// Positive base-10 integer, or null. Rejects decimals, signs, units and blanks.
function parseWindow(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readSettingsEnvValue(file, key) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const block = settings && typeof settings === 'object' ? settings.env : null;
    if (!block || typeof block !== 'object' || !Object.prototype.hasOwnProperty.call(block, key)) {
      return undefined;
    }
    return block[key];
  } catch {
    return undefined;
  }
}

function settingsFiles(projectDir, envObj) {
  const files = [];
  if (projectDir) {
    files.push(path.join(projectDir, '.claude', 'settings.local.json'));
    files.push(path.join(projectDir, '.claude', 'settings.json'));
  }
  const configDir = typeof envObj.CLAUDE_CONFIG_DIR === 'string' ? envObj.CLAUDE_CONFIG_DIR.trim() : '';
  files.push(path.join(configDir || path.join(os.homedir(), '.claude'), 'settings.json'));
  return files;
}

function isDefined(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Resolve the configured auto-compact window. A blank value counts as unset.
 * The first source that defines the key wins, valid or not, so an invalid
 * higher-precedence value disables the override instead of silently falling
 * through to a lower scope.
 */
function resolveAutoCompactWindow({ env: envObj = process.env, projectDir = '' } = {}) {
  if (isDefined(envObj[AUTO_COMPACT_WINDOW_KEY])) {
    return parseWindow(envObj[AUTO_COMPACT_WINDOW_KEY]);
  }
  for (const file of settingsFiles(projectDir, envObj)) {
    const value = readSettingsEnvValue(file, AUTO_COMPACT_WINDOW_KEY);
    if (isDefined(value)) return parseWindow(value);
  }
  return null;
}

/**
 * Compute the context percentage shown by the statusline.
 *
 * A compact window counts only when it is below the model window and above
 * the autocompact buffer. Without one this is the pre-existing behavior:
 * Claude Code's `used_percentage` when present, else tokens plus the
 * autocompact buffer over the model window. With a compact window below the
 * model window, the percentage is recomputed against that window because
 * `used_percentage` is measured against the full model window.
 */
function computeContextPercent({ contextWindow, autocompactBuffer, autoCompactWindow = null }) {
  const usage = contextWindow?.current_usage || {};
  const contextSize = contextWindow?.context_window_size || 0;
  const totalTokens = (usage.input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0);
  const result = { percent: 0, totalTokens: 0, windowSize: contextSize, compactWindowApplied: false };
  if (!(contextSize > 0)) return result;
  result.totalTokens = totalTokens;

  // A window at or below the buffer would pin the display at 100% from the first
  // prompt, so such a value is ignored rather than trusted.
  if (autoCompactWindow && autoCompactWindow < contextSize && autoCompactWindow > autocompactBuffer) {
    result.windowSize = autoCompactWindow;
    result.compactWindowApplied = true;
    result.percent = Math.min(100, Math.round(((totalTokens + autocompactBuffer) / autoCompactWindow) * 100));
    return result;
  }

  const preCalc = contextWindow?.used_percentage;
  if (typeof preCalc === 'number' && preCalc >= 0) {
    result.percent = Math.round(preCalc);
  } else if (contextSize > autocompactBuffer) {
    result.percent = Math.min(100, Math.round(((totalTokens + autocompactBuffer) / contextSize) * 100));
  }
  return result;
}

module.exports = {
  AUTO_COMPACT_WINDOW_KEY,
  computeContextPercent,
  parseWindow,
  resolveAutoCompactWindow
};
