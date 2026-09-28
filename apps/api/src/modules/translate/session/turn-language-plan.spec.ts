import { describe, expect, it } from 'vitest';
import { planTurnLanguages } from './turn-language-plan';

describe('planTurnLanguages', () => {
  it('vi_to_en: recognises vi, targets en, speaks en', () => {
    const plan = planTurnLanguages(['vi', 'en'], ['vi']);

    expect(plan.targets).toEqual(['en']);
    expect(plan.recognition).toBe('vi');
    expect(plan.spoken).toBe('en');
    expect(plan.sourceLanguages).toEqual(['vi']);
    expect(plan.conversation).toEqual(['vi', 'en']);
  });

  it('en_to_vi: recognises en, targets vi, speaks vi', () => {
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
});
