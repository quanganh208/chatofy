import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type SummarizationProvider,
} from '@chatofy/ai-providers';
import { Env } from '../../config/env.schema';

/**
 * The one summarization provider, resolved once and kept warm.
 *
 * Shared by both owners of minutes — a stored conversation and a conference
 * room — so there is one place that decides which summarizer runs, and one
 * cached instance rather than one per caller.
 *
 * `resolveOnly`, like the realtime and speaker-embedding providers: no env var
 * selects a summarizer, so a second registration should be a loud error rather
 * than a silent pick. The Gemini key is read here and passed raw — splitting a
 * comma-separated pool is the provider's job.
 */
@Injectable()
export class MinutesSummarizer {
  private provider: SummarizationProvider | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
  ) {}

  get(): SummarizationProvider {
    this.provider ??= this.registry.resolveOnly('summarization', {
      geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
    });
    return this.provider;
  }
}
