import { describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
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

    const service = new ConversationsService(store, audio);
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

    const service = new ConversationsService(store, audio);
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
    const service = new ConversationsService(store, audio);

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
    const service = new ConversationsService(store, audio);

    await expect(
      service.setAudio('u1', 'c1', webm, { offsetMs: 0, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // A foreign id must not be able to put bytes in the bucket, which is why the
    // claim runs before the PUT rather than after it.
    expect([...audio.objects]).toEqual([]);
  });
});
