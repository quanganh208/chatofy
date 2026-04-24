import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  StreamConfig,
  StreamHandle,
  TranslatorService,
} from '../interfaces/translator-service.interface.js';

/**
 * Stub TranslatorService — used when AI_REALTIME_PROVIDER=none.
 * All methods throw NotImplementedException.
 * Replace by binding TRANSLATOR_SERVICE to a real provider adapter.
 */
@Injectable()
export class NoopTranslatorService implements TranslatorService {
  startStream(_clientId: string, _config: StreamConfig): Promise<StreamHandle> {
    throw new NotImplementedException(
      'Translator provider not configured. Set AI_REALTIME_PROVIDER env var.',
    );
  }

  handleAudioFrame(_streamId: string, _frame: Buffer): Promise<void> {
    throw new NotImplementedException(
      'Translator provider not configured. Set AI_REALTIME_PROVIDER env var.',
    );
  }

  endStream(_streamId: string): Promise<void> {
    throw new NotImplementedException(
      'Translator provider not configured. Set AI_REALTIME_PROVIDER env var.',
    );
  }
}
