import { DuplicateGlossaryTermError } from '../interfaces/glossary-store.interface';
import { MemoryGlossaryStore } from './memory-glossary.store';

const term = (vi: string, en: string, keepVerbatim = false) => ({
  vi,
  en,
  keepVerbatim,
});

describe('MemoryGlossaryStore', () => {
  let store: MemoryGlossaryStore;

  beforeEach(() => {
    store = new MemoryGlossaryStore();
  });

  it('creates a term with a minted id and timestamps, then lists it', async () => {
    const created = await store.create('alice', term('xin chào', 'hello'));
    expect(created).toMatchObject({
      vi: 'xin chào',
      en: 'hello',
      keepVerbatim: false,
    });
    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toEqual(expect.any(String));

    const list = await store.list('alice');
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
  });

  it('rejects a duplicate (vi, en) pair for the same owner', async () => {
    await store.create('alice', term('a', 'b'));
    await expect(store.create('alice', term('a', 'b'))).rejects.toBeInstanceOf(
      DuplicateGlossaryTermError,
    );
  });

  it('lets two owners hold the same pair without collision', async () => {
    await store.create('alice', term('a', 'b'));
    await expect(store.create('bob', term('a', 'b'))).resolves.toMatchObject({
      vi: 'a',
    });
    expect(await store.list('alice')).toHaveLength(1);
    expect(await store.list('bob')).toHaveLength(1);
  });

  it('updates a term and refreshes updatedAt', async () => {
    const created = await store.create('alice', term('a', 'b'));
    const updated = await store.update('alice', created.id, {
      keepVerbatim: true,
    });
    expect(updated).toMatchObject({ id: created.id, keepVerbatim: true });
  });

  it('returns null updating a term the caller does not own', async () => {
    const created = await store.create('alice', term('a', 'b'));
    expect(
      await store.update('bob', created.id, { keepVerbatim: true }),
    ).toBeNull();
  });

  it('is a no-op, not a conflict, to patch a term to its own pair', async () => {
    const created = await store.create('alice', term('a', 'b'));
    await expect(
      store.update('alice', created.id, { vi: 'a', en: 'b' }),
    ).resolves.toMatchObject({ id: created.id });
  });

  it('rejects a patch that collides with another of the caller terms', async () => {
    await store.create('alice', term('a', 'b'));
    const second = await store.create('alice', term('c', 'd'));
    await expect(
      store.update('alice', second.id, { vi: 'a', en: 'b' }),
    ).rejects.toBeInstanceOf(DuplicateGlossaryTermError);
  });

  it('removes and returns the deleted term, and null when absent', async () => {
    const created = await store.create('alice', term('a', 'b'));
    expect(await store.remove('alice', created.id)).toMatchObject({
      id: created.id,
    });
    expect(await store.list('alice')).toHaveLength(0);
    expect(await store.remove('alice', created.id)).toBeNull();
  });

  describe('importTerms', () => {
    it('merge upserts: existing pair keeps its id and refreshes keepVerbatim, new pairs are added', async () => {
      const existing = await store.create('alice', term('a', 'b', false));
      const result = await store.importTerms(
        'alice',
        [term('a', 'b', true), term('c', 'd')],
        'merge',
      );
      expect(result).toHaveLength(2);
      const kept = result.find((t) => t.vi === 'a');
      expect(kept).toMatchObject({ id: existing.id, keepVerbatim: true });
    });

    it('replace wipes the existing glossary first', async () => {
      await store.create('alice', term('old', 'gone'));
      const result = await store.importTerms(
        'alice',
        [term('new', 'fresh')],
        'replace',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ vi: 'new', en: 'fresh' });
    });

    it('replace does not touch another owner glossary', async () => {
      await store.create('bob', term('bobs', 'term'));
      await store.importTerms('alice', [term('x', 'y')], 'replace');
      expect(await store.list('bob')).toHaveLength(1);
    });
  });
});
