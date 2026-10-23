import { describe, expect, it } from 'vitest';
import { LidAdmission } from './lid-admission';

describe('LidAdmission', () => {
  it('admits one identifying socket per user', () => {
    const admission = new LidAdmission();

    expect(admission.admit('s1', 'alice')).toBe(true);
    expect(admission.admit('s2', 'alice')).toBe(false);
    expect(admission.admit('s3', 'bob')).toBe(true);
  });

  it('keeps an admitted socket admitted across turns', () => {
    const admission = new LidAdmission();
    admission.admit('s1', 'alice');

    expect(admission.admit('s1', 'alice')).toBe(true);
    expect(admission.size).toBe(1);
  });

  it('caps the process at its total, whoever asks', () => {
    const admission = new LidAdmission(1, 2);

    expect(admission.admit('s1', 'a')).toBe(true);
    expect(admission.admit('s2', 'b')).toBe(true);
    expect(admission.admit('s3', 'c')).toBe(false);
  });

  it('frees the slot when the socket closes', () => {
    const admission = new LidAdmission();
    admission.admit('s1', 'alice');
    admission.release('s1');

    expect(admission.admit('s2', 'alice')).toBe(true);
    admission.release('unknown');
    expect(admission.size).toBe(1);
  });
});
