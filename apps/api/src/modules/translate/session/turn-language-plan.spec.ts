import { describe, expect, it, vi } from 'vitest';
import {
  planDetectTurn,
  planForPair,
  planTurnLanguages,
} from './turn-language-plan';

describe('planTurnLanguages', () => {
  it('vi→en: recognises vi, targets en, speaks en', () => {
    const plan = planTurnLanguages(['vi', 'en'], ['vi']);

    expect(plan.targets).toEqual(['en']);
    expect(plan.recognition).toBe('vi');
    expect(plan.spoken).toBe('en');
    expect(plan.sourceLanguages).toEqual(['vi']);
    expect(plan.conversation).toEqual(['vi', 'en']);
  });

  it('en→vi: recognises en, targets vi, speaks vi', () => {
    const plan = planTurnLanguages(['en', 'vi'], ['en']);

    expect(plan.targets).toEqual(['vi']);
    expect(plan.recognition).toBe('en');
    expect(plan.spoken).toBe('vi');
  });

  // A turn that mixed languages targets the WHOLE conversation — every
  // listener needs the whole turn in their own language, including the parts
  // said in theirs — and is recognised and spoken as its first language until
  // a real multi-language identifier and a multi-target TTS exist.
  it('a turn mixing every conversation language targets all of them, and reads as the first', () => {
    const plan = planTurnLanguages(['vi', 'en'], ['vi', 'en']);

    expect(plan.targets).toEqual(['vi', 'en']);
    expect(plan.recognition).toBe('vi');
    expect(plan.spoken).toBe('vi');
  });

  it('voices the spoken language alone by default', () => {
    expect(planTurnLanguages(['vi', 'en'], ['vi']).voiced).toEqual(['en']);
  });
});

describe('planForPair', () => {
  it('asks the identifier about the declared source and plans from its answer', () => {
    const identify = vi.fn(() => ['en', 'vi'] as const);

    const plan = planForPair({ source: 'en', target: 'vi' }, { identify });

    expect(identify).toHaveBeenCalledExactlyOnceWith({ declared: 'en' });
    expect(plan).toEqual(planTurnLanguages(['en', 'vi'], ['en', 'vi']));
  });

  it('voices only the spoken language when no extra target is asked for', () => {
    const plan = planForPair(
      { source: 'vi', target: 'en' },
      { identify: () => ['vi'] },
    );

    expect(plan.targets).toEqual(['en']);
    expect(plan.voiced).toEqual(['en']);
  });

  it('extra targets widen the targets and are all voiced, the pair target first', () => {
    const plan = planForPair(
      { source: 'vi', target: 'en' },
      { identify: () => ['vi'] },
      ['zh'],
    );

    expect(plan.conversation).toEqual(['vi', 'en', 'zh']);
    expect(plan.targets).toEqual(['en', 'zh']);
    expect(plan.spoken).toBe('en');
    expect(plan.voiced).toEqual(['en', 'zh']);
    expect(plan.recognition).toBe('vi');
  });

  it('drops repeated extras and extras naming the pair source or target', () => {
    const plan = planForPair(
      { source: 'vi', target: 'en' },
      { identify: () => ['vi'] },
      ['zh', 'vi', 'en', 'zh'],
    );

    expect(plan.targets).toEqual(['en', 'zh']);
    expect(plan.voiced).toEqual(['en', 'zh']);
  });

  it('an extra list holding only the pair languages plans exactly the pair', () => {
    const identifier = { identify: () => ['vi'] as const };

    expect(
      planForPair({ source: 'vi', target: 'en' }, identifier, ['vi', 'en']),
    ).toEqual(planForPair({ source: 'vi', target: 'en' }, identifier));
  });
});

describe('planDetectTurn', () => {
  it('holds the conversation the client saves: the target first, then the rest of the registry', () => {
    expect(planDetectTurn('en', 'vi').conversation).toEqual(['en', 'vi', 'zh']);
    expect(planDetectTurn('vi', 'en').conversation).toEqual(['vi', 'en', 'zh']);
  });

  it('a turn heard in another language is translated into the target and spoken in it', () => {
    const plan = planDetectTurn('en', 'vi');

    expect(plan.recognition).toBe('vi');
    expect(plan.sourceLanguages).toEqual(['vi']);
    expect(plan.targets).toEqual(['en']);
    expect(plan.spoken).toBe('en');
  });

  it('a turn heard in the target is transcript only: no target and nothing to speak', () => {
    const plan = planDetectTurn('en', 'en');

    expect(plan.recognition).toBe('en');
    expect(plan.targets).toEqual([]);
    expect(plan.spoken).toBeNull();
    expect(plan.voiced).toEqual([]);
  });
});
