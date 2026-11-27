import { describe, expect, it } from 'vitest';
import { en, vi, zh } from '@chatofy/i18n';
import { RelayFailureReporter } from './relay-failure-reporter';

function harness(dictionary: Record<string, string> = en) {
  const published: string[] = [];
  const logged: string[] = [];
  const reporter = new RelayFailureReporter(
    (message) => published.push(message),
    (key) => dictionary[key] as string,
    (detail) => logged.push(detail),
  );
  return { reporter, published, logged };
}

describe('RelayFailureReporter', () => {
  it('publishes the reader-language sentence and keeps the English for the console', () => {
    const h = harness(vi);

    h.reporter.report('extension.error.relayTabLost', 'the meeting tab is no longer being tracked');

    expect(h.published).toEqual([vi['extension.error.relayTabLost']]);
    expect(h.logged).toEqual(['the meeting tab is no longer being tracked']);
    expect(h.published[0]).not.toContain('meeting tab');
  });

  it('does not republish the failure already showing', () => {
    const h = harness();

    h.reporter.report('extension.error.relayTabUnreachable', 'a');
    h.reporter.report('extension.error.relayTabUnreachable', 'a');

    expect(h.published).toHaveLength(1);
    expect(h.logged).toHaveLength(1);
  });

  it('publishes again when the failure changes kind or after a reset', () => {
    const h = harness(zh);

    h.reporter.report('extension.error.relayTabLost', 'a');
    h.reporter.report('extension.error.relayTabUnreachable', 'b');
    h.reporter.reset();
    h.reporter.report('extension.error.relayTabUnreachable', 'b');

    expect(h.published).toEqual([
      zh['extension.error.relayTabLost'],
      zh['extension.error.relayTabUnreachable'],
      zh['extension.error.relayTabUnreachable'],
    ]);
  });
});
