import { describe, expect, it, vi } from 'vitest';
import type { ConferencePeerLifecycle } from '../conference-peer-lifecycle.service';
import type { ConferenceSocketRegistry } from '../conference-socket-registry.service';
import type { ConferenceSocket } from '../conference-socket';
import type { ConferencePersistenceService } from './conference-persistence.service';
import { ConferenceTranslationRelay } from './conference-translation-relay.service';
import { ConferenceTranslationRouter } from './conference-translation-router.service';

const TURN = '6f1d2a8e-3b4c-4d5e-8f60-718293a4b5c6';
const OTHER_TURN = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';

const peer = (sourceLanguage: string) => ({
  participantId: `p-${sourceLanguage}`,
  sourceLanguage,
  displayName: sourceLanguage,
  limits: {},
  persistedTurns: new Map<string, Promise<string | null>>(),
});

function setup() {
  const speaker = peer('vi');
  const listener = peer('en');
  const room = {
    id: 'room',
    peers: new Map([
      ['s-speaker', speaker],
      ['s-listener', listener],
    ]),
  };
  let resolveRow!: (id: string | null) => void;
  const row = new Promise<string | null>((resolve) => {
    resolveRow = resolve;
  });
  const persistence = {
    recordTurn: vi.fn(() => row),
    reviseTurn: vi.fn(() => Promise.resolve()),
  };
  const sent: { to: string; event: string; data: unknown }[] = [];
  const relay = new ConferenceTranslationRelay(
    {
      resolvePeer: () => ({ room, peer: speaker, socketId: 's-speaker' }),
    } as unknown as ConferencePeerLifecycle,
    {
      sendTo: (to: string, event: string, data: unknown) =>
        sent.push({ to, event, data }),
    } as unknown as ConferenceSocketRegistry,
    new ConferenceTranslationRouter(),
    persistence as unknown as ConferencePersistenceService,
  );
  const ws = { send: vi.fn(), readyState: 1 } as unknown as ConferenceSocket;
  const final = (turnId = TURN) =>
    relay.relay(ws, {
      subtitle: {
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        sourceText: 'xin chào',
        translatedText: 'hello',
        isFinal: true,
        turnId,
      },
    });
  const revise = (translations: Record<string, string>, turnId = TURN) =>
    relay.relay(ws, { revision: { turnId, translations } });
  const revisions = () =>
    sent.filter((s) => s.event === 'conference.translation.revised');
  return { final, revise, revisions, persistence, resolveRow, speaker };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a revision of a finished turn', () => {
  it('updates the turn its own peer finalized and tells the listener', async () => {
    const { final, revise, revisions, persistence, resolveRow } = setup();
    final();
    resolveRow('row-1');
    revise({ en: 'Hello there.' });
    await settle();
    expect(persistence.reviseTurn).toHaveBeenCalledWith('row-1', {
      en: 'Hello there.',
    });
    expect(revisions()).toEqual([
      {
        to: 's-listener',
        event: 'conference.translation.revised',
        data: {
          speakerSocketId: 's-speaker',
          turnId: TURN,
          translatedText: 'Hello there.',
        },
      },
    ]);
  });

  it('ignores a turn this peer never finalized', async () => {
    const { final, revise, revisions, persistence, resolveRow } = setup();
    final();
    resolveRow('row-1');
    revise({ en: 'forged' }, OTHER_TURN);
    await settle();
    expect(persistence.reviseTurn).not.toHaveBeenCalled();
    expect(revisions()).toEqual([]);
  });

  it('waits for the row, when it lands before the insert returned', async () => {
    const { final, revise, persistence, resolveRow } = setup();
    final();
    revise({ en: 'Hello there.' });
    await settle();
    expect(persistence.reviseTurn).not.toHaveBeenCalled();
    resolveRow('row-1');
    await settle();
    expect(persistence.reviseTurn).toHaveBeenCalledTimes(1);
  });

  it('applies two revisions of one turn in order, not at once', async () => {
    const { final, revise, persistence, resolveRow } = setup();
    let release!: () => void;
    persistence.reviseTurn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    final();
    resolveRow('row-1');
    revise({ en: 'first' });
    revise({ en: 'second' });
    await settle();
    expect(persistence.reviseTurn).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(persistence.reviseTurn).toHaveBeenLastCalledWith('row-1', {
      en: 'second',
    });
  });

  it('keeps nothing for a language nobody else in the room speaks', async () => {
    const { final, revise, persistence, resolveRow } = setup();
    final();
    resolveRow('row-1');
    revise({ zh: '你好' });
    await settle();
    expect(persistence.reviseTurn).not.toHaveBeenCalled();
  });

  it('changes nothing when the row was never stored', async () => {
    const { final, revise, persistence, resolveRow } = setup();
    final();
    resolveRow(null);
    revise({ en: 'Hello there.' });
    await settle();
    expect(persistence.reviseTurn).not.toHaveBeenCalled();
  });
});
