#!/usr/bin/env node
'use strict';

/**
 * Records the end of an agent session for skill self-improvement.
 *
 * The hook is a pipe: it hands the runtime's own hook payload to
 * `ak skills self-improve record`, which checks consent, reads the transcript
 * the payload names and appends a bounded, content-free event. Nothing here
 * reads the transcript, calls a model or decides anything, so the hook path
 * stays a single short subprocess. Claude Code and Codex record at SessionEnd.
 *
 * Like every hook it exits 0 with no output: a missing or old binary, a
 * disabled preference and a busy store are all ordinary states.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const { readRuntimeMarker } = require('./lib/runtime-state-identity.cjs');
const { AK_OPERATIONS, resolveAkBinary } = require('./lib/ak-prefs-client.cjs');

const MAX_STDIN_BYTES = 1024 * 1024;
const RECORD_TIMEOUT_MS = 2500;

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
  const raw = readStdin();
  if (!raw || !raw.trim()) return;
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const runtime = readRuntimeMarker();
  if (runtime !== 'claude-code' && runtime !== 'codex') return;
  if (payload.hook_event_name !== 'SessionEnd') return;
  const binary = runtime && resolveAkBinary();
  if (!binary) return;
  execFileSync(binary, AK_OPERATIONS[`self-improve-record-${runtime}`], {
    input: raw,
    timeout: RECORD_TIMEOUT_MS,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
}

try {
  main();
} catch (error) {
  if (process.env.AGENTKIT_HOOK_DEBUG) {
    process.stderr.write(`[agentkit] self-improve recorder: ${error && error.code ? error.code : 'failed'}\n`);
  }
}
process.exit(0);
