#!/usr/bin/env node
'use strict';

/**
 * Shows the skill self-improvement nudge at the start of a session.
 *
 * The hook is a pipe: it hands the runtime's SessionStart payload to
 * `ak skills self-improve nudge`, which checks consent, screens the stored
 * events, records what it shows so a finding is shown once, and returns one
 * factual line. The hook prints that line and nothing else. It never calls a
 * model, never decides anything and never blocks the session.
 *
 * Like every hook it exits 0: a missing or old binary, a disabled preference,
 * a busy store and an unsupported runtime all print nothing.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { readRuntimeMarker } = require('./lib/runtime-state-identity.cjs');
const { AK_OPERATIONS, resolveAkBinary } = require('./lib/ak-prefs-client.cjs');

const MAX_STDIN_BYTES = 1024 * 1024;
const NUDGE_TIMEOUT_MS = 2500;
const MAX_LINE_CHARS = 1200;
const SELF_IMPROVE_RUN_ENV = 'AGENTKIT_SELF_IMPROVE_RUN';

function readStdin() {
  const chunks = [];
  let total = 0;
  const buffer = Buffer.alloc(64 * 1024);
  for (;;) {
    let count;
    try {
      count = fs.readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error && (error.code === 'EOF' || error.code === 'EAGAIN')) break;
      throw error;
    }
    if (count === 0) break;
    total += count;
    if (total > MAX_STDIN_BYTES) return null;
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function main() {
  if (process.env[SELF_IMPROVE_RUN_ENV]) return;
  const raw = readStdin();
  if (!raw || !raw.trim()) return;
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  if (payload.hook_event_name !== 'SessionStart') return;
  const runtime = readRuntimeMarker();
  if (runtime !== 'claude-code' && runtime !== 'codex') return;
  const binary = resolveAkBinary();
  if (!binary) return;
  const stdout = execFileSync(binary, AK_OPERATIONS[`self-improve-nudge-${runtime}`], {
    input: raw,
    timeout: NUDGE_TIMEOUT_MS,
    env: process.env,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const envelope = JSON.parse(stdout);
  const line = envelope && envelope.data && envelope.data.line;
  if (typeof line !== 'string' || !line || line.length > MAX_LINE_CHARS || /[\r\n]/.test(line)) return;
  process.stdout.write(`${line}\n`);
}

try {
  main();
} catch (error) {
  if (process.env.AGENTKIT_HOOK_DEBUG) {
    process.stderr.write(`[agentkit] self-improve nudge: ${error && error.code ? error.code : 'failed'}\n`);
  }
}
process.exit(0);
