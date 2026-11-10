import { Module } from '@nestjs/common';

import { LlmCallSink } from './llm-call-sink';

/**
 * Usage metering: what each user's activity costs in paid model calls.
 *
 * Imported by every feature module that makes such calls rather than by the app
 * root. Nest builds a module once however often it is imported, so there is one
 * sink and one write buffer per process.
 */
@Module({
  providers: [LlmCallSink],
  exports: [LlmCallSink],
})
export class UsageModule {}
