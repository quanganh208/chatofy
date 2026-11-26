'use strict';

/**
 * storage-gc.cjs - Age-based sweep for Claude Code and Codex session-file bloat.
 *
 * Targets Claude Code auxiliary directories that Claude's own
 * `cleanupPeriodDays` setting does not cover (file-history/, shell-snapshots/,
 * todos/) and the Codex sessions directory (Codex has no equivalent native
 * cleanup). Deletes only regular files/directories older than `maxAgeDays`
 * AND older than a 1-hour minimum-age floor (never touches a recently written
 * entry, regardless of maxAgeDays). Symlinks and unreadable/unknown-layout
 * entries are skipped, never followed or hard-failed on — a sweep target that
 * cannot be enumerated is reported back to the caller for logging, not thrown.
 *
 * Zero runtime dependency: pure Node stdlib (fs, path, os). Per-file
 * operations only, no shared lock — safe to run concurrently from parallel
 * sessions. The daily once-per-calendar-day rate limit is a separate concern
 * owned by the caller (an O_EXCL lockfile claim), not this module.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MAX_AGE_DAYS = 30;
const MIN_AGE_FLOOR_MS = 60 * 60 * 1000; // 1 hour — never delete a recently written entry.

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
function resolveHome(environment) {
  return environment.HOME || environment.USERPROFILE || os.homedir();
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
function claudeHome(environment) {
  return environment.AGENTKIT_CLAUDE_HOME || path.join(resolveHome(environment), '.claude');
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string}
 */
function codexHome(environment) {
  return environment.CODEX_HOME || path.join(resolveHome(environment), '.codex');
}

/**
 * Default sweep targets: the three Claude auxiliary dirs `cleanupPeriodDays`
 * does not cover, plus the Codex sessions dir.
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {{path: string, label: string}[]}
 */
function defaultTargets(environment = process.env) {
  const claude = claudeHome(environment);
  const codex = codexHome(environment);
  return [
    { path: path.join(claude, 'file-history'), label: 'claude-file-history' },
    { path: path.join(claude, 'shell-snapshots'), label: 'claude-shell-snapshots' },
    { path: path.join(claude, 'todos'), label: 'claude-todos' },
    { path: path.join(codex, 'sessions'), label: 'codex-sessions' }
  ];
}

/**
 * Recursively walk `basePath`. For every REGULAR FILE (not directory),
 * apply the age+floor filter and delete if old. After processing children,
 * try to remove any nested directory that is now empty (never the sweep
 * root itself). Symlinks are always skipped without following.
 *
 * Nested-directory correctness matters for the Codex sessions target
 * (`~/.codex/sessions/YYYY/MM/DD/*.jsonl`): a POSIX directory's mtime
 * updates only on direct-child changes, so gating on the top-level YYYY/
 * dir's mtime would wipe a whole year of nested sessions when a user
 * touches only old subdirs — the exact data-loss risk this walker exists
 * to prevent. Matches the intended `find -mtime +N -type f -delete` +
 * `find -type d -empty -delete` semantics from the brainstorm target.
 *
 * @param {string} basePath - directory being walked in this call
 * @param {string} rootPath - the sweep target root (never removed)
 * @param {boolean} isRoot - true only for the top-level call
 * @param {number} maxAgeMs
 * @param {number} minAgeFloorMs
 * @param {boolean} dryRun
 * @param {number} now
 * @param {object} result - mutated in place
 */
function walkAndSweep(basePath, rootPath, isRoot, maxAgeMs, minAgeFloorMs, dryRun, now, result) {
  let entries;
  try {
    entries = fs.readdirSync(basePath, { withFileTypes: true });
  } catch (error) {
    if (isRoot) {
      if (error && error.code === 'ENOENT') {
        result.missing = true;
        return;
      }
      result.unknownLayout = true;
      result.errors.push({ name: '.', message: error.message });
      return;
    }
    result.errors.push({ name: path.relative(rootPath, basePath) || '.', message: error.message });
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(basePath, entry.name);
    const relName = path.relative(rootPath, entryPath) || entry.name;
    let stats;
    try {
      stats = fs.lstatSync(entryPath);
    } catch (error) {
      result.skipped.push({ name: relName, reason: `unreadable: ${error.message}` });
      continue;
    }

    if (stats.isSymbolicLink()) {
      result.skipped.push({ name: relName, reason: 'symlink' });
      continue;
    }

    if (stats.isDirectory()) {
      walkAndSweep(entryPath, rootPath, false, maxAgeMs, minAgeFloorMs, dryRun, now, result);
      if (!dryRun) {
        try { fs.rmdirSync(entryPath); } catch (_) { /* non-empty or busy — leave in place */ }
      }
      continue;
    }

    if (!stats.isFile()) {
      // Neither symlink nor regular file nor directory (socket, fifo, block/char device).
      // Never delete these; a sweep target's job is disk pressure from log/session files.
      result.skipped.push({ name: relName, reason: 'non-regular-file' });
      continue;
    }

    const ageMs = now - stats.mtimeMs;
    if (ageMs < minAgeFloorMs) {
      result.skipped.push({ name: relName, reason: 'within-min-age-floor' });
      continue;
    }
    if (ageMs < maxAgeMs) {
      result.skipped.push({ name: relName, reason: 'within-max-age' });
      continue;
    }

    if (dryRun) {
      result.deleted.push({ name: relName, path: entryPath, ageMs, dryRun: true });
      continue;
    }

    try {
      fs.unlinkSync(entryPath);
      result.deleted.push({ name: relName, path: entryPath, ageMs, dryRun: false });
    } catch (error) {
      result.errors.push({ name: relName, message: error.message });
    }
  }
}

/**
 * Sweep a single target directory recursively. Never throws — all failure
 * modes are reported in the returned result so the caller can
 * log-and-continue.
 * @param {{path: string, label: string}} target
 * @param {number} maxAgeMs
 * @param {number} minAgeFloorMs
 * @param {boolean} dryRun
 * @param {number} now
 */
function sweepTarget(target, maxAgeMs, minAgeFloorMs, dryRun, now) {
  const result = {
    label: target.label,
    path: target.path,
    missing: false,
    unknownLayout: false,
    deleted: [],
    skipped: [],
    errors: []
  };
  walkAndSweep(target.path, target.path, true, maxAgeMs, minAgeFloorMs, dryRun, now, result);
  return result;
}

/**
 * Sweep all targets for entries older than `maxAgeDays` AND older than the
 * unconditional 1-hour minimum-age floor.
 * @param {object} [options]
 * @param {{path: string, label: string}[]} [options.targets] - Defaults to
 *   the four Claude aux + Codex sessions targets.
 * @param {number} [options.maxAgeDays] - Defaults to 30.
 * @param {boolean} [options.dryRun] - When true (or when
 *   `AGENTKIT_STORAGE_GC_DRY_RUN=1` is set in `environment`), reports the
 *   deletion plan without touching disk.
 * @param {NodeJS.ProcessEnv} [options.environment] - Defaults to process.env.
 * @param {number} [options.now] - Defaults to Date.now(); injectable for tests.
 * @returns {{dryRun: boolean, maxAgeDays: number, results: object[]}}
 */
function sweep(options = {}) {
  const environment = options.environment || process.env;
  const now = options.now != null ? options.now : Date.now();
  const maxAgeDays = options.maxAgeDays != null ? options.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
  const dryRun = Boolean(options.dryRun) || environment.AGENTKIT_STORAGE_GC_DRY_RUN === '1';
  const targets = options.targets && options.targets.length ? options.targets : defaultTargets(environment);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const results = targets.map((target) => sweepTarget(target, maxAgeMs, MIN_AGE_FLOOR_MS, dryRun, now));

  return { dryRun, maxAgeDays, results };
}

module.exports = {
  DEFAULT_MAX_AGE_DAYS,
  MIN_AGE_FLOOR_MS,
  defaultTargets,
  sweep
};
