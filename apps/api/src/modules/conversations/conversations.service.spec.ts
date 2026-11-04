import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ConversationsService,
  TITLE_RETRY_DELAY_MS,
} from './conversations.service';
import type {
  ConversationSummary,
  SaveConversationRequest,
} from '@chatofy/types';
import type { MinutesSummarizer } from '../minutes/minutes-summarizer.service';
import type { ConversationStore } from './interfaces/conversation-store.interface';
import {
  ConversationAudioUnavailableError,
  type ConversationAudioObject,
  type ConversationAudioStorage,
} from '../storage/interfaces/conversation-audio-storage.interface';

/**
 * The upload/delete orderings, driven directly rather than raced.
 *
 * These live here and not in the db-e2e suite because the failure they describe
 * is an ORDER, and firing two HTTP requests with `Promise.all` does not produce
 * a chosen order — on a warm local Postgres it resolves the same way almost
 * every time. A race test that passes against the bug is worse than no test,
 * because it reads as coverage. Driving the service with doubles lets each case
 * state the interleaving it means and get exactly that one.
 *
 * What the doubles stand in for is deliberately small: a key column and a set of
 * stored objects. Everything asserted below is about which of those two survives
 * the pair of operations, which is the whole of the contract at issue.
 */

/** Just enough store to hold one conversation's key. */
function makeStore(initial: { audioKey: string | null; exists: boolean }) {
  const state = { ...initial };
  const calls: string[] = [];

  const store = {
    calls,
    state,
    async findAudioKey(): Promise<string | null> {
      calls.push('findAudioKey');
      return state.audioKey;
    },
    async claimAudioKey(
      _ownerId: string,
      _conversationId: string,
      candidate: string,
    ): Promise<string | null> {
      calls.push('claimAudioKey');
      if (!state.exists) return null;
      state.audioKey ??= candidate;
      return state.audioKey;
    },
    async setAudio(): Promise<boolean> {
      calls.push('setAudio');
      return state.exists;
    },
    async removeReturningAudioKey(): Promise<{
      removed: boolean;
      audioKey: string | null;
    }> {
      calls.push('removeReturningAudioKey');
      if (!state.exists) return { removed: false, audioKey: null };
      state.exists = false;
      return { removed: true, audioKey: state.audioKey };
    },
  } as unknown as ConversationStore & { calls: string[]; state: typeof state };

  return store;
}

/** Object storage that records what is actually still held. */
function makeAudio(hooks: { onDelete?: (key: string) => void } = {}) {
  const objects = new Set<string>();

  const audio = {
    enabled: true as const,
    objects,
    async put(key: string): Promise<void> {
      objects.add(key);
    },
    async get(): Promise<ConversationAudioObject | null> {
      return null;
    },
    async delete(key: string): Promise<void> {
      objects.delete(key);
      // AFTER the removal, so a hook that stores the key models a PUT landing
      // once this delete has already been and gone — which is the interleaving
      // under test. Running it first would have the same call undo it.
      hooks.onDelete?.(key);
    },
  } as unknown as ConversationAudioStorage & { objects: Set<string> };

  return audio;
}

/** The recording cases never save, so a summarizer that is never reached. */
const noSummarizer = {
  get: () => {
    throw new Error('the recording cases never title');
  },
} as unknown as MinutesSummarizer;

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

describe('ConversationsService recording lifecycle', () => {
  it('leaves nothing stored when bytes land after the delete has read the key', async () => {
    // The ordering that strands an object, and the reason the cleanup after the
    // row delete cannot be conditioned on the key having CHANGED:
    //
    //   the row already names K, claimed by an earlier attempt whose PUT failed
    //   delete reads K
    //   delete removes K          -> a no-op, nothing is stored under it yet
    //   upload stores K           -> the bytes land here, mid-delete
    //   delete drops the row      -> still K, so a `!==` guard skips the cleanup
    //
    // Both reads see the SAME key, so comparing them skips precisely the case
    // that needs the second delete.
    const store = makeStore({
      audioKey: 'conversations/u1/abc.webm',
      exists: true,
    });
    let uploadLanded = false;

    const audio = makeAudio({
      onDelete: (key) => {
        // Stand in for the upload's PUT completing while the delete is between
        // its two statements. It runs once, on the first (no-op) delete.
        if (uploadLanded) return;
        uploadLanded = true;
        audio.objects.add(key);
      },
    });

    const service = new ConversationsService(store, audio, noSummarizer);
    await service.remove('u1', 'c1');

    expect(uploadLanded).toBe(true);
    // The bytes that appeared mid-delete are gone with the row.
    expect([...audio.objects]).toEqual([]);
    expect(store.calls).toEqual(['findAudioKey', 'removeReturningAudioKey']);
  });

  it('keeps both the row and the object when storage refuses the delete', async () => {
    // The object goes first precisely so this is recoverable: nothing was
    // removed, so the 409 the caller sees means a retry can still finish.
    const store = makeStore({
      audioKey: 'conversations/u1/abc.webm',
      exists: true,
    });
    const audio = makeAudio();
    audio.objects.add('conversations/u1/abc.webm');
    audio.delete = async () => {
      throw new ConversationAudioUnavailableError('unreachable');
    };

    const service = new ConversationsService(store, audio, noSummarizer);
    await expect(service.remove('u1', 'c1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(store.state.exists).toBe(true);
    expect([...audio.objects]).toEqual(['conversations/u1/abc.webm']);
    // The row delete was never reached.
    expect(store.calls).toEqual(['findAudioKey']);
  });

  it('cleans up the object when the row disappears mid-upload', async () => {
    // The mirror case: the row is gone by the time the timing write runs, so the
    // bytes just stored have nothing pointing at them and must not survive.
    const store = makeStore({ audioKey: null, exists: true });
    const audio = makeAudio();
    const service = new ConversationsService(store, audio, noSummarizer);

    store.setAudio = async () => {
      // The conversation was deleted from another tab after the PUT.
      store.state.exists = false;
      return false;
    };

    await expect(
      service.setAudio('u1', 'c1', webm, { offsetMs: 0, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect([...audio.objects]).toEqual([]);
  });

  it('answers 404 without storing anything when the caller owns no such row', async () => {
    const store = makeStore({ audioKey: null, exists: false });
    const audio = makeAudio();
    const service = new ConversationsService(store, audio, noSummarizer);

    await expect(
      service.setAudio('u1', 'c1', webm, { offsetMs: 0, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // A foreign id must not be able to put bytes in the bucket, which is why the
    // claim runs before the PUT rather than after it.
    expect([...audio.objects]).toEqual([]);
  });
});

describe('ConversationsService title pass', () => {
  const summary = (title: string | null): ConversationSummary => ({
    conversationId: 'c1',
    languages: ['vi', 'en'],
    startedAt: '2026-11-04T02:00:00.000Z',
    endedAt: '2026-11-04T02:10:00.000Z',
    turnCount: 2,
    preview: 'Mình muốn thuê căn hộ',
    hasMinutes: false,
    pausedMs: 0,
    title,
    kind: 'one-way',
    hasRecording: false,
    speakerCount: 2,
    speakers: ['Lan'],
  });

  const body = (
    over: Partial<SaveConversationRequest> = {},
  ): SaveConversationRequest => ({
    languages: ['vi', 'en'],
    startedAt: '2026-11-04T02:00:00.000Z',
    endedAt: '2026-11-04T02:10:00.000Z',
    audioOffsetMs: null,
    pausedMs: 0,
    titleLanguage: 'vi',
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a',
        speakerLabel: 'Lan',
        sourceText: 'Mình muốn thuê một căn hộ hai phòng ngủ ở quận ba',
        displayText: null,
        sourceLanguages: ['vi'],
        translations: {
          en: 'I want to rent a two-bedroom apartment in district three',
        },
        offsetMs: 0,
      },
      {
        position: 1,
        speakerRole: 'speaker_b',
        speakerLabel: null,
        sourceText: 'The rent is twelve million a month',
        displayText: null,
        sourceLanguages: ['en'],
        translations: { vi: 'Tiền thuê là mười hai triệu một tháng' },
        offsetMs: 4000,
      },
    ],
    ...over,
  });

  function setup(
    options: {
      stored?: string | null;
      title?: () => Promise<string>;
      getThrows?: boolean;
    } = {},
  ) {
    const setTitleIfEmpty = vi.fn(async () => true);
    const store = {
      save: vi.fn(async () => summary(options.stored ?? null)),
      setTitleIfEmpty,
    } as unknown as ConversationStore;
    const title = vi.fn(options.title ?? (async () => 'Hợp đồng'));
    const summarizer = {
      get: () => {
        if (options.getThrows) throw new Error('no summarizer configured');
        return { name: 'fake', summarize: vi.fn(), title };
      },
    } as unknown as MinutesSummarizer;
    const service = new ConversationsService(store, makeAudio(), summarizer);
    return { service, title, setTitleIfEmpty };
  }

  it("titles an untitled conversation once, in the reader's language", async () => {
    const { service, title, setTitleIfEmpty } = setup();

    await service.save('u1', 'c1', body());

    await vi.waitFor(() => expect(setTitleIfEmpty).toHaveBeenCalled());
    expect(title).toHaveBeenCalledTimes(1);
    const [request] = title.mock.calls[0] as unknown as [
      { transcript: string; language?: string },
    ];
    expect(request.transcript.startsWith('Lan: ')).toBe(true);
    expect(request.transcript).toContain('\nSpeaker B: The rent');
    expect(request.language).toBe('vi');
    expect(setTitleIfEmpty).toHaveBeenCalledWith('u1', 'c1', 'Hợp đồng');
  });

  it('leaves a titled conversation alone', async () => {
    const { service, title } = setup({ stored: 'Thuê căn hộ' });

    await service.save('u1', 'c1', body());

    expect(title).not.toHaveBeenCalled();
  });

  it('still answers the save when the title call fails, retry included', async () => {
    vi.useFakeTimers();
    try {
      const { service, title, setTitleIfEmpty } = setup({
        title: async () => {
          throw new Error('429');
        },
      });

      await expect(service.save('u1', 'c1', body())).resolves.toMatchObject({
        conversationId: 'c1',
      });
      await vi.advanceTimersByTimeAsync(TITLE_RETRY_DELAY_MS);
      expect(title).toHaveBeenCalledTimes(2);
      expect(setTitleIfEmpty).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries once after a pause, and stores what the retry returns', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { service, title, setTitleIfEmpty } = setup({
        title: async () => {
          calls += 1;
          if (calls === 1) throw new Error('504');
          return 'Hợp đồng';
        },
      });

      await service.save('u1', 'c1', body());
      await vi.advanceTimersByTimeAsync(TITLE_RETRY_DELAY_MS - 1);
      expect(title).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(title).toHaveBeenCalledTimes(2);
      await vi.waitFor(() =>
        expect(setTitleIfEmpty).toHaveBeenCalledWith('u1', 'c1', 'Hợp đồng'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('still answers the save when no summarizer is configured', async () => {
    const { service } = setup({ getThrows: true });

    await expect(service.save('u1', 'c1', body())).resolves.toMatchObject({
      conversationId: 'c1',
    });
  });

  it('asks once while a title for the same conversation is in flight', async () => {
    let finish: (title: string) => void = () => {};
    const { service, title } = setup({
      title: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });

    await service.save('u1', 'c1', body());
    await service.save('u1', 'c1', body());
    finish('Hợp đồng');

    expect(title).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed title on every later save', async () => {
    vi.useFakeTimers();
    try {
      const { service, title } = setup({
        title: async () => {
          throw new Error('429');
        },
      });

      await service.save('u1', 'c1', body());
      await vi.advanceTimersByTimeAsync(TITLE_RETRY_DELAY_MS);
      await service.save('u1', 'c1', body());
      await service.save('u1', 'c1', body());
      await vi.advanceTimersByTimeAsync(TITLE_RETRY_DELAY_MS);

      // The first save's attempt and its one retry — nothing for the later saves.
      expect(title).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures the bar on what was said, not on the speaker labels', async () => {
    const { service, title } = setup();
    const hello = {
      ...body().turns[0]!,
      speakerLabel: null,
      sourceText: 'xin chào',
    };

    await service.save(
      'u1',
      'c1',
      body({
        turns: [0, 1, 2].map((position) => ({ ...hello, position })),
      }),
    );

    expect(title).not.toHaveBeenCalled();
  });

  it('stores at most 80 characters of whatever comes back', async () => {
    const { service, setTitleIfEmpty } = setup({
      title: async () => 'x'.repeat(300),
    });

    await service.save('u1', 'c1', body());

    await vi.waitFor(() => expect(setTitleIfEmpty).toHaveBeenCalled());
    const [, , stored] = setTitleIfEmpty.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(stored).toHaveLength(80);
  });

  it('does not title a conversation too short to have a topic', async () => {
    const { service, title } = setup();

    await service.save(
      'u1',
      'c1',
      body({
        turns: [{ ...body().turns[0]!, sourceText: 'xin chào' }],
      }),
    );

    expect(title).not.toHaveBeenCalled();
  });
});
