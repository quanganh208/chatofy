// Typed-decision models: TypeSafe Jev and Gemini Decision 1.
//
// Neither writes text. Each takes a state and named questions (noul = P(yes),
// choice = probabilities over options) and answers every question at once.
// The two hosts share the question shapes, so one runner can ask either:
//   noul:   { type: 'noul', instructions }
//   choice: { type: 'choice', instructions, criteria: { option: description } }
//
// Keys are read from the environment, else the repo-root .env, and are never
// logged. Every HTTP attempt, retries included, takes one unit from a
// CallCounter, so a cap set before a run cannot be overshot by back-off.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HERE } from './rows.mjs';

export const JEV_MODEL = 'jev-1.14.0';
export const GEMINI_DECISION_MODEL = 'gemini-decision-1';
const JEV_API = 'https://api.typesafe.ai/v1/systemone';
const GEMINI_DECISIONS_API = 'https://generativelanguage.googleapis.com/v1beta/decisions';
/** Attempts one question set may spend beyond a full cycle of keys. */
const EXTRA_ATTEMPTS = 5;
/** Statuses worth another attempt: rate limits, overload and gateway hiccups. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const REFUSED = new Set([429, 503, 529]);

/** A key from the environment, else from the repo-root .env; '' when absent. */
export function loadKey(name, envPath = resolve(HERE, '..', '..', '.env')) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  return line
    ? line
        .slice(name.length + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    : '';
}

/** Thrown when a CallCounter is spent; a runner stops the sitting on it. */
export class CallCapReached extends Error {
  constructor(cap) {
    super(`call cap ${cap} reached`);
    this.code = 'CALL_CAP';
  }
}

/** Thrown when every attempt was refused or failed in transit; a runner stops on it too. */
export class HostUnavailable extends Error {
  constructor(message) {
    super(message);
    this.code = 'HOST_UNAVAILABLE';
  }
}

/** A hard ceiling on HTTP attempts across a whole sitting. */
export class CallCounter {
  constructor(cap, already = 0) {
    this.cap = cap;
    this.used = already;
  }

  take() {
    if (this.used >= this.cap) throw new CallCapReached(this.cap);
    this.used += 1;
  }
}

/**
 * A text state as stable labelled lines. Gemini takes one input string; Jev
 * takes the object itself. `context` (earlier turns) is numbered.
 */
export function renderState(state) {
  const lines = [];
  for (const [key, value] of Object.entries(state)) {
    if (key === 'context' && Array.isArray(value)) {
      lines.push('context (earlier turns, oldest first):');
      value.forEach((turn, i) =>
        lines.push(`  ${i + 1}. source: ${turn.source} | translation: ${turn.translation}`),
      );
    } else {
      lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Throws unless every question came back with a finite answer: a 200 with a
 * hollow body must not be recorded as an answer, or a resume would skip it.
 */
export function checkAnswers(answers, questions) {
  for (const [key, question] of Object.entries(questions)) {
    const answer = answers?.[key];
    const value =
      question.type === 'noul'
        ? answer?.noul
        : question.type === 'choice'
          ? Object.values(answer?.probabilities ?? {}).reduce((a, b) => a + b, 0) || NaN
          : answer?.score;
    if (!Number.isFinite(value)) throw new Error(`answer for ${key} is missing or not a number`);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const backoff = (n) => Math.min(60_000, 3000 * 2 ** n);

/** Spaces call starts at least `minGapMs` apart. Sequential use only. */
function pacer(minGapMs) {
  let last = 0;
  return async () => {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

/**
 * One question set against a host with `keys`.
 *
 * A refusal (429/503/529) moves to the next key; once every key has refused
 * in a row it backs off, and with more than one key that is the sign they
 * share a project's quota. Gateway errors and dropped connections back off
 * on the same key. The whole set may spend `keys + EXTRA_ATTEMPTS` attempts.
 */
async function ask({ url, headersFor, keys, body, questions, counter, pace, log, onSharedQuota }) {
  if (!counter) throw new Error('a CallCounter is required');
  let index = 0;
  let refusedInRow = 0;
  let waits = 0;
  let lastProblem = 'no attempt made';
  for (let attempt = 0; attempt < keys.length + EXTRA_ATTEMPTS; attempt += 1) {
    await pace();
    counter.take();
    const started = Date.now();
    let status;
    let text;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersFor(keys[index % keys.length]) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      lastProblem = `transport: ${error.message}`;
      await sleep(backoff(waits++));
      continue;
    }
    const ms = Date.now() - started;
    if (RETRYABLE.has(status)) {
      lastProblem = `HTTP ${status}`;
      if (REFUSED.has(status)) {
        refusedInRow += 1;
        if (refusedInRow >= keys.length) {
          if (keys.length > 1) onSharedQuota();
          refusedInRow = 0;
          await sleep(backoff(waits++));
        }
        index += 1;
      } else {
        await sleep(backoff(waits++));
      }
      continue;
    }
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}: ${text.slice(0, 200)}`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${status}: unparseable body ${text.slice(0, 200)}`);
    }
    checkAnswers(json.answers, questions);
    return { json, ms };
  }
  log(`giving up on one question set: ${lastProblem}`);
  throw new HostUnavailable(`every attempt failed (${lastProblem})`);
}

/** Jev on TypeSafe. */
export function jevAsker({
  model = JEV_MODEL,
  counter,
  minGapMs = 1500,
  key = loadKey('TYPESAFE_API_KEY'),
  log = (line) => console.error(line),
} = {}) {
  if (!key) throw new Error('TYPESAFE_API_KEY is not set in the environment or the repo-root .env');
  const pace = pacer(minGapMs);
  return async (state, questions) => {
    const { json, ms } = await ask({
      url: JEV_API,
      headersFor: (k) => ({ authorization: `Bearer ${k}` }),
      keys: [key],
      body: { model, state, questions },
      questions,
      counter,
      pace,
      log,
      onSharedQuota: () => {},
    });
    return { answers: json.answers, usage: json.usage ?? null, ms, servedBy: json.model ?? model };
  };
}

/** Gemini Decision 1. GEMINI_API_KEY may hold several comma-separated keys. */
export function geminiDecisionAsker({
  model = GEMINI_DECISION_MODEL,
  counter,
  minGapMs = 1500,
  keys = loadKey('GEMINI_API_KEY')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  log = (line) => console.error(line),
} = {}) {
  if (!keys.length)
    throw new Error('GEMINI_API_KEY is not set in the environment or the repo-root .env');
  const pace = pacer(minGapMs);
  let warned = false;
  const onSharedQuota = () => {
    if (!warned) log('same-project quota suspected: every key refused in a row, backing off');
    warned = true;
  };
  return async (state, questions) => {
    const input = typeof state === 'string' || Array.isArray(state) ? state : renderState(state);
    const { json, ms } = await ask({
      url: GEMINI_DECISIONS_API,
      headersFor: (k) => ({ 'x-goog-api-key': k }),
      keys,
      body: { model, input, questions },
      questions,
      counter,
      pace,
      log,
      onSharedQuota,
    });
    return {
      answers: json.answers,
      usage: json.usage ?? null,
      ms,
      servedBy: json.model ?? json.modelVersion ?? model,
    };
  };
}

/** The asker for a `--model` name. */
export function askerFor(name, options) {
  if (name === 'jev') return jevAsker(options);
  if (name === 'gemini') return geminiDecisionAsker(options);
  throw new Error(`unknown model ${name}; use jev or gemini`);
}
