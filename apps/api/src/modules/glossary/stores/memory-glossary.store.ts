import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { GlossaryTerm, GlossaryTermRecord } from '@chatofy/types';
import {
  DuplicateGlossaryTermError,
  type GlossaryImportMode,
  type GlossaryStore,
} from '../interfaces/glossary-store.interface';

/**
 * Process-local glossary store — dev and test default.
 *
 * State lives in one process and dies with it. That is the seam a
 * PrismaGlossaryStore fills when a user's glossary must outlive a restart or be
 * read on another instance. The exact-pair uniqueness and owner scoping it
 * enforces here are the same ones the Postgres compound key enforces there, so
 * nothing above the store branches on which is behind it.
 */
@Injectable()
export class MemoryGlossaryStore implements GlossaryStore {
  // Keyed by owner first — the security boundary — then by term id.
  private readonly byOwner = new Map<string, Map<string, GlossaryTermRecord>>();

  list(ownerId: string): Promise<GlossaryTermRecord[]> {
    return Promise.resolve([...this.termsOf(ownerId).values()]);
  }

  create(ownerId: string, term: GlossaryTerm): Promise<GlossaryTermRecord> {
    const terms = this.termsOf(ownerId);
    if (this.findPair(terms, term.vi, term.en)) {
      // A rejected promise, not a synchronous throw: the method returns a
      // Promise, so a caller that only `.catch()`es must still see the error.
      return Promise.reject(new DuplicateGlossaryTermError(term.vi, term.en));
    }
    const record = stamp(term);
    terms.set(record.id, record);
    return Promise.resolve(record);
  }

  update(
    ownerId: string,
    id: string,
    patch: Partial<GlossaryTerm>,
  ): Promise<GlossaryTermRecord | null> {
    const terms = this.termsOf(ownerId);
    const current = terms.get(id);
    if (!current) return Promise.resolve(null);

    const next: GlossaryTermRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    // A pair collision against a DIFFERENT term is the duplicate error; patching
    // a term to the value it already has is a no-op, not a conflict.
    const clash = this.findPair(terms, next.vi, next.en);
    if (clash && clash.id !== id) {
      return Promise.reject(new DuplicateGlossaryTermError(next.vi, next.en));
    }
    terms.set(id, next);
    return Promise.resolve(next);
  }

  remove(ownerId: string, id: string): Promise<GlossaryTermRecord | null> {
    const terms = this.termsOf(ownerId);
    const current = terms.get(id);
    if (!current) return Promise.resolve(null);
    terms.delete(id);
    return Promise.resolve(current);
  }

  importTerms(
    ownerId: string,
    incoming: readonly GlossaryTerm[],
    mode: GlossaryImportMode,
  ): Promise<GlossaryTermRecord[]> {
    const terms =
      mode === 'replace'
        ? new Map<string, GlossaryTermRecord>()
        : this.termsOf(ownerId);
    if (mode === 'replace') this.byOwner.set(ownerId, terms);

    for (const term of incoming) {
      const existing = this.findPair(terms, term.vi, term.en);
      if (existing) {
        terms.set(existing.id, {
          ...existing,
          keepVerbatim: term.keepVerbatim,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const record = stamp(term);
        terms.set(record.id, record);
      }
    }
    return Promise.resolve([...terms.values()]);
  }

  private termsOf(ownerId: string): Map<string, GlossaryTermRecord> {
    let terms = this.byOwner.get(ownerId);
    if (!terms) {
      terms = new Map();
      this.byOwner.set(ownerId, terms);
    }
    return terms;
  }

  private findPair(
    terms: Map<string, GlossaryTermRecord>,
    vi: string,
    en: string,
  ): GlossaryTermRecord | undefined {
    for (const record of terms.values()) {
      if (record.vi === vi && record.en === en) return record;
    }
    return undefined;
  }
}

/** Mint id + timestamps for a new record. */
function stamp(term: GlossaryTerm): GlossaryTermRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    vi: term.vi,
    en: term.en,
    keepVerbatim: term.keepVerbatim,
    createdAt: now,
    updatedAt: now,
  };
}
