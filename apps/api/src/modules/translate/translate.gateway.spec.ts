import { WsException } from '@nestjs/websockets';
import { TranslateGateway } from './translate.gateway';
import type {
  StreamSocket,
  TranslationSessionService,
} from './services/translation-session.service';

describe('TranslateGateway', () => {
  let sessions: jest.Mocked<
    Pick<
      TranslationSessionService,
      'start' | 'pushFrame' | 'speculate' | 'end' | 'disconnect'
    >
  >;
  let gateway: TranslateGateway;
  const socket: StreamSocket = { send: jest.fn() };

  beforeEach(() => {
    sessions = {
      start: jest.fn(),
      pushFrame: jest.fn(),
      speculate: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    gateway = new TranslateGateway(
      sessions as unknown as TranslationSessionService,
    );
  });

  const validFrame = {
    sessionId: 's1',
    encoding: 'pcm16',
    sampleRate: 16000,
    sequence: 0,
    timestamp: 0,
    payload: 'AAAA',
  };

  // The gateway is transport only: its whole job is to reject anything the
  // shared contract does not describe, then hand the rest to the state machine.
  describe('delegation', () => {
    it('passes valid session.start options to the session service', () => {
      gateway.handleSessionStart(
        {
          type: 'client.session.start',
          direction: 'vi_to_en',
          voiceGender: 'male',
        },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(socket, {
        direction: 'vi_to_en',
        voiceGender: 'male',
      });
    });

    it('defaults the voice for a start that names no gender', () => {
      // The field is optional on the wire so an older client keeps working; by
      // the time it reaches the state machine it must already be decided.
      gateway.handleSessionStart(
        { type: 'client.session.start', direction: 'vi_to_en' },
        socket,
      );
      expect(sessions.start).toHaveBeenCalledWith(socket, {
        direction: 'vi_to_en',
        voiceGender: 'female',
      });
    });

    it('passes a valid audio.frame to the session service', () => {
      gateway.handleAudioFrame(
        { type: 'client.audio.frame', frame: validFrame },
        socket,
      );
      expect(sessions.pushFrame).toHaveBeenCalledWith(socket, validFrame);
    });

    it('passes a suspected end of speech to the session service', () => {
      gateway.handleTurnSpeculate({ type: 'client.turn.speculate' }, socket);
      expect(sessions.speculate).toHaveBeenCalledWith(socket);
    });

    it('awaits the turn on session.end', async () => {
      await gateway.handleSessionEnd({ type: 'client.session.end' }, socket);
      expect(sessions.end).toHaveBeenCalledWith(socket);
    });

    it('releases the turn when the socket drops', () => {
      gateway.handleDisconnect(socket);
      expect(sessions.disconnect).toHaveBeenCalledWith(socket);
    });
  });

  describe('contract validation', () => {
    it('rejects a payload missing required fields', () => {
      expect(() =>
        gateway.handleSessionStart({ type: 'client.session.start' }, socket),
      ).toThrow(WsException);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('rejects the legacy pre-contract payload shape', () => {
      expect(() =>
        gateway.handleSessionStart(
          { sessionId: 's1', sourceLang: 'vi', targetLang: 'en' },
          socket,
        ),
      ).toThrow(WsException);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('rejects an event whose type does not match the subscribed handler', () => {
      expect(() =>
        gateway.handleAudioFrame({ type: 'client.session.end' }, socket),
      ).toThrow(WsException);
      expect(sessions.pushFrame).not.toHaveBeenCalled();
    });
  });
});
