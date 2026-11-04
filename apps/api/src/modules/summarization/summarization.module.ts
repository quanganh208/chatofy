import { Module } from '@nestjs/common';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { MinutesSummarizer } from '../minutes/minutes-summarizer.service';
import { registerDefaultProviders } from '../translate/providers/register-default-providers';

/**
 * The one summarizer, for minutes and for conversation titles.
 *
 * Its own module because the two owners point at each other: `MinutesModule`
 * imports `ConversationsModule` to read a stored transcript, and
 * `ConversationsModule` needs the summarizer to title what it saves. Both import
 * this instead, so there is no cycle and one cached provider rather than two.
 */
@Module({
  providers: [
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    MinutesSummarizer,
  ],
  exports: [ProviderRegistry, MinutesSummarizer],
})
export class SummarizationModule {}
