import { NotImplementedException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { TranslatorService } from './interfaces/translator-service.interface';
import { TranslateGateway } from './translate.gateway';

describe('TranslateGateway', () => {
  let gateway: TranslateGateway;

  beforeEach(() => {
    // Handlers never reach the translator (they throw first), so a bare stub is enough.
    gateway = new TranslateGateway({} as TranslatorService);
  });

  const validFrame = {
    sessionId: 's1',
    encoding: 'pcm16',
    sampleRate: 16000,
    sequence: 0,
    timestamp: 0,
    payload: 'AAAA',
  };

  it('accepts a contract-valid session.start and throws NotImplemented', () => {
    expect(() =>
      gateway.handleSessionStart({
        type: 'client.session.start',
        direction: 'vi_to_en',
      }),
    ).toThrow(NotImplementedException);
  });

  it('accepts a contract-valid audio.frame and throws NotImplemented', () => {
    expect(() =>
      gateway.handleAudioFrame({
        type: 'client.audio.frame',
        frame: validFrame,
      }),
    ).toThrow(NotImplementedException);
  });

  it('accepts a contract-valid session.end and throws NotImplemented', () => {
    expect(() =>
      gateway.handleSessionEnd({ type: 'client.session.end' }),
    ).toThrow(NotImplementedException);
  });

  it('rejects a payload missing required fields', () => {
    expect(() =>
      gateway.handleSessionStart({ type: 'client.session.start' }),
    ).toThrow(WsException);
  });

  it('rejects the legacy pre-contract payload shape', () => {
    expect(() =>
      gateway.handleSessionStart({
        sessionId: 's1',
        sourceLang: 'vi',
        targetLang: 'en',
      }),
    ).toThrow(WsException);
  });

  it('rejects an event whose type does not match the subscribed handler', () => {
    expect(() =>
      gateway.handleAudioFrame({ type: 'client.session.end' }),
    ).toThrow(WsException);
  });
});
