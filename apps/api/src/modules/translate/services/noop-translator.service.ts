import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  StreamConfig,
  StreamHandle,
  TranslatorService,
} from '../interfaces/translator-service.interface';

/**
 * Stub translator used when AI_REALTIME_PROVIDER=none.
 * All methods throw NotImplementedException — wire a real provider via TRANSLATOR_SERVICE token.
 */
@Injectable()
export class NoopTranslatorService implements TranslatorService {
  startStream(_clientId: string, _config: StreamConfig): Promise<StreamHandle> {
    throw new NotImplementedException('Translator provider not configured');
  }

  handleAudioFrame(_streamId: string, _frame: Buffer): Promise<void> {
    throw new NotImplementedException('Translator provider not configured');
  }

  endStream(_streamId: string): Promise<void> {
    throw new NotImplementedException('Translator provider not configured');
  }
}
