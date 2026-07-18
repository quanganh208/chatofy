import { NotFoundException } from '@nestjs/common';
import { MemorySessionStore } from './memory-session.store';

describe('MemorySessionStore', () => {
  it('creates and retrieves a session', async () => {
    const store = new MemorySessionStore();
    const created = await store.createSession({ userId: 'u1' });
    const fetched = await store.getSession(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns null for an unknown session id', async () => {
    const store = new MemorySessionStore();
    await expect(store.getSession('missing')).resolves.toBeNull();
  });

  it('rejects updates to an unknown session id', async () => {
    const store = new MemorySessionStore();
    await expect(
      store.updateSession('missing', { status: 'active' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not let callers mutate internal state through returned records', async () => {
    const store = new MemorySessionStore();
    const created = await store.createSession({ userId: 'u1' });

    const fetched = await store.getSession(created.id);
    fetched!.status = 'ended';

    // The store's copy must be untouched by the caller-side mutation.
    await expect(store.getSession(created.id)).resolves.toMatchObject({
      status: 'idle',
    });
  });

  it('ignores explicitly-undefined update fields instead of clobbering values', async () => {
    const store = new MemorySessionStore();
    const created = await store.createSession({ userId: 'u1' });
    const ended = await store.endSession(created.id);
    expect(ended.endedAt).toBeInstanceOf(Date);

    const updated = await store.updateSession(created.id, {
      status: 'active',
      endedAt: undefined,
    });
    expect(updated.status).toBe('active');
    expect(updated.endedAt).toBeInstanceOf(Date); // preserved, not clobbered
  });
});
