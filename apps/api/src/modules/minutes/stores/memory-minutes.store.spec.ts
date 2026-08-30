import type { MeetingMinutes } from '@chatofy/types';
import { MemoryMinutesStore } from './memory-minutes.store';

const minutes = (sessionId: string, summary = 'summary'): MeetingMinutes => ({
  sessionId,
  status: 'ready',
  summary,
  keyPoints: [],
  decisions: [],
  actionItems: [],
  generatedAt: '2026-08-30T00:00:00.000Z',
  model: 'gemini-3.5-flash',
});

describe('MemoryMinutesStore', () => {
  it('stores and retrieves minutes for an owner + session', async () => {
    const store = new MemoryMinutesStore();
    const stored = await store.put('u1', minutes('s1'));
    await expect(store.get('u1', 's1')).resolves.toEqual(stored);
  });

  it("does not return another owner's minutes for the same sessionId", async () => {
    const store = new MemoryMinutesStore();
    await store.put('u1', minutes('s1'));
    // The IDOR guard: u2 asking for u1's sessionId sees nothing.
    await expect(store.get('u2', 's1')).resolves.toBeNull();
  });

  it('returns null for a session the owner has not generated', async () => {
    const store = new MemoryMinutesStore();
    await store.put('u1', minutes('s1'));
    await expect(store.get('u1', 's2')).resolves.toBeNull();
  });

  it('overwrites on regenerate rather than appending', async () => {
    const store = new MemoryMinutesStore();
    await store.put('u1', minutes('s1', 'first'));
    await store.put('u1', minutes('s1', 'second'));
    await expect(store.get('u1', 's1')).resolves.toMatchObject({
      summary: 'second',
    });
  });

  it("keeps two owners' minutes for the same sessionId separate", async () => {
    const store = new MemoryMinutesStore();
    await store.put('u1', minutes('s1', 'u1 minutes'));
    await store.put('u2', minutes('s1', 'u2 minutes'));
    await expect(store.get('u1', 's1')).resolves.toMatchObject({
      summary: 'u1 minutes',
    });
    await expect(store.get('u2', 's1')).resolves.toMatchObject({
      summary: 'u2 minutes',
    });
  });
});
