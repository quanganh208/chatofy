import { foldForMatch, normalizeTranscript } from '@chatofy/ai-providers';

// Escapes, not literals, wherever a case turns on an invisible or decomposed
// character. A reviewer cannot check a literal that renders as nothing, and a
// formatter that normalizes this file would silently delete the input.

describe('normalizeTranscript', () => {
  it('composes decomposed diacritics to one spelling', () => {
    // The same word twice: precomposed, and base letter + combining acute.
    // They render identically and compare unequal until composed.
    const decomposed = 'má';
    const precomposed = 'má';
    expect(decomposed).not.toBe(precomposed);
    expect(normalizeTranscript(decomposed)).toBe(precomposed);
  });

  it('removes zero-width characters that survive a copy-paste', () => {
    expect(normalizeTranscript('Chat​ofy')).toBe('Chatofy');
    expect(normalizeTranscript('﻿Xin chào')).toBe('Xin chào');
    expect(normalizeTranscript('Vin­Fast')).toBe('VinFast');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeTranscript('  xin\t\tchào\n bạn  ')).toBe('xin chào bạn');
  });

  it('keeps punctuation, casing, and spelling exactly as they were', () => {
    // Repair is the model's job under its own instruction. Doing it here would
    // change what the speaker said with nothing recording that it happened.
    expect(normalizeTranscript('i dont no, whats teh cost?')).toBe(
      'i dont no, whats teh cost?',
    );
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Tôi muốn đặt một bàn.';
    expect(normalizeTranscript(text)).toBe(text);
  });
});

describe('foldForMatch', () => {
  it('folds tone marks and case together', () => {
    expect(foldForMatch('Hòa')).toBe('hoa');
    expect(foldForMatch('HOA')).toBe('hoa');
  });

  it('folds d-stroke to d', () => {
    expect(foldForMatch('Đặt')).toBe('dat');
  });

  it('collapses the whole tone family to one key', () => {
    // Exactly the property that makes it useful for matching and unusable for
    // anything that has to preserve meaning.
    const family = ['mà', 'má', 'mả', 'mã', 'mạ', 'ma'];
    expect(new Set(family.map(foldForMatch)).size).toBe(1);
  });

  it('drops punctuation', () => {
    expect(foldForMatch('Xin chào, bạn!')).toBe('xin chao ban');
  });
});
