import { describe, expect, it } from 'vitest';
import { en, vi, zh } from '@chatofy/i18n';
import { RelayFailureReporter } from './relay-failure-reporter';

/** A reporter over a one-slot banner, the way the overlay's outbound error behaves. */
function harness(dictionary: Record<string, string> = en) {
  const published: string[] = [];
  const logged: string[] = [];
  let banner: string | undefined;
  const reporter = new RelayFailureReporter(
    (message) => {
      banner = message;
      published.push(message);
    },
    () => banner,
    (key) => dictionary[key] as string,
    (detail) => logged.push(detail),
  );
  return { reporter, published, logged, clear: () => (banner = undefined) };
}

describe('RelayFailureReporter', () => {
  it('publishes the reader-language sentence and keeps the English for the console', () => {
    const h = harness(vi);

    h.reporter.report('extension.error.relayTabLost', 'the meeting tab is no longer being tracked');

    expect(h.published).toEqual([vi['extension.error.relayTabLost']]);
    expect(h.logged).toEqual(['the meeting tab is no longer being tracked']);
  });

  it('does not republish the failure already showing', () => {
    const h = harness();

    h.reporter.report('extension.error.relayTabUnreachable', 'a');
    h.reporter.report('extension.error.relayTabUnreachable', 'a');

    expect(h.published).toHaveLength(1);
    expect(h.logged).toHaveLength(1);
  });

  it('publishes again when the failure changes kind', () => {
    const h = harness(zh);

    h.reporter.report('extension.error.relayTabLost', 'a');
    h.reporter.report('extension.error.relayTabUnreachable', 'b');

    expect(h.published).toEqual([
      zh['extension.error.relayTabLost'],
      zh['extension.error.relayTabUnreachable'],
    ]);
  });

  it('shows the same failure again once something else cleared the banner', () => {
    const h = harness();

    h.reporter.report('extension.error.relayTabUnreachable', 'a');
    h.clear();
    h.reporter.report('extension.error.relayTabUnreachable', 'a');

    expect(h.published).toHaveLength(2);
  });
});
