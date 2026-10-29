import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type SummarizationProvider,
} from '@chatofy/ai-providers';
import { Env } from '../../config/env.schema';
import type { AiProviderResolveConfig } from '../translate/providers/register-default-providers';

/**
 * The one summarization provider, resolved once and kept warm.
 *
 * Shared by both owners of minutes — a stored conversation and a conference
 * room — so there is one place that decides which summarizer runs, and one
 * cached instance rather than one per caller.
 *
 * Selected by name from `AI_SUMMARIZATION_PROVIDER`. Unset, it follows the
 * translation provider — `commandcode` there means `commandcode` here, anything
 * else `gemini` — so a deployment that only set
 * `AI_TRANSLATION_PROVIDER=commandcode` keeps its minutes on Command Code. The
 * keys are read here and passed raw; splitting a comma-separated Gemini pool
 * is the provider's job.
 */
@Injectable()
export class MinutesSummarizer {
  private provider: SummarizationProvider | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
  ) {}

  get(): SummarizationProvider {
    this.provider ??= this.registry.resolve('summarization', this.name(), {
      geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
      commandCodeApiKey: this.config.get('COMMAND_CODE_API_KEY', {
        infer: true,
      }),
    } satisfies AiProviderResolveConfig);
    return this.provider;
  }

  /** The registry entry that writes minutes. */
  private name(): string {
    const chosen = this.config.get('AI_SUMMARIZATION_PROVIDER', {
      infer: true,
    });
    if (chosen) return chosen;
    return this.config.get('AI_TRANSLATION_PROVIDER', { infer: true }) ===
      'commandcode'
      ? 'commandcode'
      : 'gemini';
  }
}
