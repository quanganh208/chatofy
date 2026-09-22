// Which translator a harness is measuring, and how fast it may be asked.
//
// Shared by `error-analysis/translate-rows.mjs` and `prompt-injection/run.mjs`
// rather than written twice, for the reason `live-translate/README.md` gives
// about its VAD: two definitions of the same thing drift, and the one nobody is
// reading is the one that ends up producing a recorded number. Both harnesses
// need the identical three decisions — which provider class, which key, how long
// to wait between requests — and those decisions belong to the host, not to the
// harness asking.
//
// It builds providers from `packages/ai-providers` and never declares a prompt.
// That is the rule both harnesses already state about themselves: a harness
// carrying its own copy of the instruction keeps passing after the real one has
// drifted, and has nothing to say about production.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  GeminiTranslationProvider,
  OpenAiCompatibleTranslationProvider,
} from '../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/**
 * The hosts a harness can be pointed at without being told how.
 *
 * Only two entries, and the restraint is deliberate: a preset is a claim that
 * the base URL, the key name and the vendor flags are right, and an unverified
 * claim in this table would be discovered as a failed benchmark run rather than
 * as a typo. Every host that is not here is still reachable — `--base-url`,
 * `--api-key-env` and `--extra-body` drive the same provider — so adding one is
 * a matter of running it first and writing it down after.
 */
export const PRESETS = {
  gemini: {
    kind: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    /**
     * Leads `FINAL_MODELS`, so this is the model that answers with the sentence
     * a user actually receives. `gemini-3.1-flash-lite` leads only
     * `SPECULATION_MODELS`, whose output is provisional and discarded — the two
     * are not interchangeable, and `error-analysis/README.md` records what
     * happened when a recorded arm confused them.
     */
    models: ['gemini-3.5-flash-lite'],
    /** ~14/min, just under the free tier's 15-per-minute per-model ceiling. */
    gapMs: 4300,
  },
  deepseek: {
    kind: 'openai-compatible',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash'],
    /**
     * Two hundred milliseconds, not four seconds, and the difference is the
     * whole reason this host is interesting: DeepSeek publishes a concurrency
     * limit of 2500 for `deepseek-flash` and meters spend rather than requests,
     * so the pacing that keeps a free Gemini key inside its 15/min ceiling buys
     * nothing here. It is above zero only to keep a failing run from spending a
     * corpus in one breath.
     */
    gapMs: 200,
    /**
     * Thinking mode is ENABLED BY DEFAULT on this host, at effort `high`. A
     * request without this flag measures a reasoning model — which is how the
     * published benchmarks came to report 0.92s for a model that answers a short
     * sentence in 852ms measured here.
     *
     * Note what it costs to turn off: in non-thinking mode DeepSeek pins
     * `temperature` to 1.0 and ignores whatever is sent. A benchmark therefore
     * cannot make this model's output deterministic, and repeated runs are the
     * only way to tell a real difference from sampling noise.
     */
    extraBody: { thinking: { type: 'disabled' } },
  },
};

/**
 * The key for one host; never printed.
 *
 * The environment wins, so this runs anywhere the key is exported. Reading
 * `apps/api/.env` is only a local convenience — it is where a key already lives
 * on a dev machine — and a missing file is not an error while the variable is
 * set.
 */
export function readApiKey(variable) {
  const fromEnv = process.env[variable]?.trim();
  if (fromEnv) return fromEnv;

  const envPath = resolve(REPO, 'apps/api/.env');
  let file = '';
  try {
    file = readFileSync(envPath, 'utf8');
  } catch (err) {
    // Only "the file isn't there" means "the key lives somewhere else". A
    // permission or encoding failure is a real problem, and reporting it as a
    // missing key would send someone looking in the wrong place.
    if (err?.code !== 'ENOENT') throw err;
    throw new Error(`set ${variable}, or put it in ${envPath}`);
  }
  const key = new RegExp(`^${variable}=(.*)$`, 'm').exec(file)?.[1]?.trim();
  if (!key) throw new Error(`${variable} not found in ${envPath}`);
  return key;
}

/**
 * The provider a harness will measure, plus the two defaults that belong to the
 * host rather than to the harness.
 *
 * `models` and `gapMs` come back resolved so a caller never has to know that a
 * free Gemini key needs 4.3 seconds between requests and a paid DeepSeek key
 * does not. An explicit `--model` or `--gap-ms` still wins: the preset supplies
 * a default, not a policy.
 */
export function makeTranslationProvider({
  preset = 'gemini',
  models,
  gapMs,
  baseUrl,
  apiKeyEnv,
  extraBody,
} = {}) {
  const known = PRESETS[preset];
  // An unknown preset is refused rather than treated as a bare OpenAI host: a
  // typo would otherwise produce a run against whatever `--base-url` happened
  // to be, or a confusing failure about a missing key.
  if (!known && preset !== 'openai-compatible') {
    throw new Error(
      `unknown --provider ${JSON.stringify(preset)}; known: ${Object.keys(PRESETS).join(', ')}, ` +
        'or openai-compatible with --base-url',
    );
  }
  const spec = known ?? { kind: 'openai-compatible' };

  const resolvedModels = models?.length ? models : spec.models;
  if (!resolvedModels?.length) throw new Error(`--model is required for --provider ${preset}`);

  const keyVariable = apiKeyEnv ?? spec.apiKeyEnv;
  if (!keyVariable) throw new Error(`--api-key-env is required for --provider ${preset}`);
  const apiKey = readApiKey(keyVariable);

  if (spec.kind === 'gemini') {
    return {
      provider: new GeminiTranslationProvider({ apiKey, models: resolvedModels }),
      models: resolvedModels,
      gapMs: gapMs ?? spec.gapMs,
      label: preset,
    };
  }

  const url = baseUrl ?? spec.baseUrl;
  if (!url) throw new Error(`--base-url is required for --provider ${preset}`);

  return {
    provider: new OpenAiCompatibleTranslationProvider({
      apiKey,
      baseUrl: url,
      models: resolvedModels,
      name: preset,
      extraBody: extraBody ?? spec.extraBody,
    }),
    models: resolvedModels,
    gapMs: gapMs ?? spec.gapMs ?? 200,
    label: preset,
  };
}

/**
 * The provider flags both harnesses accept, parsed out of an argv they still
 * own the rest of.
 *
 * Returns what it consumed alongside the leftovers, so each harness keeps its
 * own validation for its own flags instead of this file growing a parser for
 * every argument either of them will ever take.
 */
export function takeProviderArgs(argv) {
  const provider = {};
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const raw = argv[i + 1];
    const needsValue = () => {
      if (raw === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return raw;
    };

    if (flag === '--provider') provider.preset = needsValue();
    else if (flag === '--base-url') provider.baseUrl = needsValue();
    else if (flag === '--api-key-env') provider.apiKeyEnv = needsValue();
    else if (flag === '--extra-body') {
      const value = needsValue();
      try {
        provider.extraBody = JSON.parse(value);
      } catch (err) {
        throw new Error(`--extra-body is not valid JSON: ${err.message}`);
      }
    } else rest.push(flag);
  }

  return { provider, rest };
}
