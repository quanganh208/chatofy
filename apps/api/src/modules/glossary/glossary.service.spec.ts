import { ConflictException, NotFoundException } from '@nestjs/common';
import { GLOSSARY_LIMITS, type GlossaryTermRecord } from '@chatofy/types';
import {
  DuplicateGlossaryTermError,
  type GlossaryStore,
} from './interfaces/glossary-store.interface';
import { GlossaryService } from './glossary.service';

/** A GlossaryStore stub whose behavior each test sets directly. */
function fakeStore(overrides: Partial<GlossaryStore> = {}): GlossaryStore {
  return {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    importTerms: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const record = (vi: string, en: string): GlossaryTermRecord => ({
  id: `${vi}-${en}`,
  vi,
  en,
  keepVerbatim: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const full = (): GlossaryTermRecord[] =>
  Array.from({ length: GLOSSARY_LIMITS.MAX_TERMS }, (_, i) =>
    record(`v${i}`, `e${i}`),
  );

describe('GlossaryService', () => {
  it('maps a duplicate-pair store error to 409 Conflict on create', async () => {
    const store = fakeStore({
      create: jest
        .fn()
        .mockRejectedValue(new DuplicateGlossaryTermError('a', 'b')),
    });
    const service = new GlossaryService(store);
    await expect(
      service.create('alice', { vi: 'a', en: 'b', keepVerbatim: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses create once the glossary is at the ceiling', async () => {
    const create = jest.fn();
    const store = fakeStore({
      list: jest.fn().mockResolvedValue(full()),
      create,
    });
    const service = new GlossaryService(store);
    await expect(
      service.create('alice', { vi: 'x', en: 'y', keepVerbatim: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('404s an update that the store reports absent/not-owned', async () => {
    const store = fakeStore({ update: jest.fn().mockResolvedValue(null) });
    const service = new GlossaryService(store);
    await expect(
      service.update('alice', 'missing', { keepVerbatim: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a duplicate-pair store error to 409 on update', async () => {
    const store = fakeStore({
      update: jest
        .fn()
        .mockRejectedValue(new DuplicateGlossaryTermError('a', 'b')),
    });
    const service = new GlossaryService(store);
    await expect(
      service.update('alice', 'id', { vi: 'a', en: 'b' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s a remove the store reports absent/not-owned', async () => {
    const store = fakeStore({ remove: jest.fn().mockResolvedValue(null) });
    const service = new GlossaryService(store);
    await expect(service.remove('alice', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a merge import that would push the total past the ceiling', async () => {
    const importTerms = jest.fn();
    const store = fakeStore({
      list: jest.fn().mockResolvedValue(full()),
      importTerms,
    });
    const service = new GlossaryService(store);
    await expect(
      service.import('alice', {
        mode: 'merge',
        terms: [{ vi: 'new', en: 'pair', keepVerbatim: false }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(importTerms).not.toHaveBeenCalled();
  });

  it('allows a merge of ONLY-existing pairs even at the ceiling (no net add)', async () => {
    const existing = full();
    const first = existing[0]!;
    const importTerms = jest.fn().mockResolvedValue(existing);
    const store = fakeStore({
      list: jest.fn().mockResolvedValue(existing),
      importTerms,
    });
    const service = new GlossaryService(store);
    await expect(
      service.import('alice', {
        mode: 'merge',
        terms: [{ vi: first.vi, en: first.en, keepVerbatim: true }],
      }),
    ).resolves.toBeDefined();
    expect(importTerms).toHaveBeenCalled();
  });

  it('does not apply the ceiling to a replace import (payload already capped)', async () => {
    const list = jest.fn().mockResolvedValue(full());
    const importTerms = jest.fn().mockResolvedValue([]);
    const store = fakeStore({ list, importTerms });
    const service = new GlossaryService(store);
    await expect(
      service.import('alice', {
        mode: 'replace',
        terms: [{ vi: 'x', en: 'y', keepVerbatim: false }],
      }),
    ).resolves.toBeDefined();
    expect(importTerms).toHaveBeenCalledWith(
      'alice',
      expect.any(Array),
      'replace',
    );
    expect(list).not.toHaveBeenCalled();
  });
});
