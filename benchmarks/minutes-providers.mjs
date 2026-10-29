// Which minutes summarizer a harness is measuring.
//
// Shared by `minutes-injection/run.mjs` and `minutes-quality/run.mjs` for the
// reason `translation-providers.mjs` gives: two definitions of the same host
// drift, and the one nobody is reading ends up producing a recorded number. It
// builds the SHIPPED provider classes from `packages/ai-providers` and never
// declares a prompt, so a harness cannot keep passing on a stale copy of it.
import {
  GeminiSummarizationProvider,
  OpenAiCompatibleSummarizationProvider,
} from '../packages/ai-providers/dist/index.js';
import { readApiKey } from './translation-providers.mjs';

/**
 * The two hosts that write minutes, as the API registers them.
 *
 * These mirror the `summarization` entries in
 * `apps/api/src/modules/translate/providers/register-default-providers.ts` and
 * `DEFAULT_MODELS` in `gemini-summarization-provider.ts`; change them together.
 * The harness measures one host at a time, so the API's failover from Command
 * Code to Gemini is deliberately not reproduced here.
 */
export const MINUTES_HOSTS = {
  commandcode: {
    baseUrl: 'https://api.commandcode.ai/provider/v1',
    model: 'google/gemini-3.7-flash',
  },
  gemini: { models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'] },
};

/** The minutes provider for one host; `models` overrides the host's own. */
export function makeMinutesProvider({ host, models = null }) {
  if (host === 'commandcode') {
    return new OpenAiCompatibleSummarizationProvider({
      apiKey: readApiKey('COMMAND_CODE_API_KEY'),
      baseUrl: MINUTES_HOSTS.commandcode.baseUrl,
      model: models?.[0] ?? MINUTES_HOSTS.commandcode.model,
      name: 'commandcode-minutes',
    });
  }
  if (host === 'gemini') {
    return new GeminiSummarizationProvider({
      apiKey: readApiKey('GEMINI_API_KEY'),
      models: models ?? MINUTES_HOSTS.gemini.models,
    });
  }
  throw new Error(`host must be gemini or commandcode, not ${host}`);
}
