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
  async startStream(
    _clientId: string,
    _config: StreamConfig,
  ): Promise<StreamHandle> {
    throw new NotImplementedException('Translator provider not configured');
  }

  async handleAudioFrame(_streamId: string, _frame: Buffer): Promise<void> {
    throw new NotImplementedException('Translator provider not configured');
  }

  async endStream(_streamId: string): Promise<void> {
    throw new NotImplementedException('Translator provider not configured');
  }
}
