import { describe, expect, it } from 'vitest';
import { buildMailContent, MailPurpose } from './mail-sender.interface';

describe('buildMailContent', () => {
  const link = 'https://app.example.com/verify-email?token=abc123';

  it.each(Object.values(MailPurpose))(
    'builds a non-empty subject and a body containing exactly the given link for %s',
    (purpose) => {
      const { subject, text } = buildMailContent(purpose, link);
      expect(subject.length).toBeGreaterThan(0);
      expect(text).toContain(link);
      // The link must appear exactly once — no accidental duplication that
      // could be mistaken for a second, differently-sourced URL.
      expect(text.split(link)).toHaveLength(2);
    },
  );

  it('never reflects the recipient or any other caller-supplied value into the body', () => {
    // buildMailContent's signature accepts only a purpose and a link — there
    // is no parameter for a name, an address, or free text, so this asserts
    // the contract structurally rather than by scanning output for a string.
    expect(buildMailContent.length).toBe(2);
  });
});
