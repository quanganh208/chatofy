import { describe, expect, it } from 'vitest';
import { en, vi, zh } from '@chatofy/i18n';
import { RelayFailureReporter } from './relay-failure-reporter';

/** A reporter over a one-slot banner, the way the overlay's relay error behaves. */
function harness(dictionary: Record<string, string> = en) {
  const published: string[] = [];
  const logged: string[] = [];
  let banner: string | undefined;
  let clears = 0;
  const reporter = new RelayFailureReporter({
    publish: (message) => {
      banner = message;
      published.push(message);
    },
    clear: () => {
      banner = undefined;
      clears += 1;
    },
    showing: () => banner,
    translate: (key) => dictionary[key] as string,
    log: (detail) => logged.push(detail),
  });
  return {
    reporter,
    published,
    logged,
    banner: () => banner,
    clears: () => clears,
    clear: () => (banner = undefined),
  };
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

  describe('recovery', () => {
    const RELAY = ['extension.error.relayTabLost', 'extension.error.relayTabUnreachable'] as const;
    const PREPARE = ['extension.error.preparePageFailed'] as const;

    it('clears a relay failure once the relay works again', () => {
      const h = harness();
      h.reporter.report('extension.error.relayTabUnreachable', 'a');

      h.reporter.recover(RELAY);

      expect(h.banner()).toBeUndefined();
    });

    it('does nothing while nothing is showing', () => {
      // Recovery is checked on every relayed frame of a healthy relay.
      const h = harness();

      h.reporter.recover(RELAY);
      h.reporter.recover(RELAY);

      expect(h.clears()).toBe(0);
    });

    it('shows the same failure once more after a recovery, then dedupes again', () => {
      const h = harness();
      h.reporter.report('extension.error.relayTabUnreachable', 'a');
      h.reporter.recover(RELAY);

      h.reporter.report('extension.error.relayTabUnreachable', 'a');
      h.reporter.report('extension.error.relayTabUnreachable', 'a');

      expect(h.published).toHaveLength(2);
      expect(h.banner()).toBe(en['extension.error.relayTabUnreachable']);
    });

    it('leaves a page-preparation failure alone when the relay recovers', () => {
      const h = harness();
      h.reporter.report('extension.error.preparePageFailed');

      h.reporter.recover(RELAY);

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('clears a page-preparation failure when preparing succeeds', () => {
      const h = harness();
      h.reporter.report('extension.error.preparePageFailed');

      h.reporter.recover(PREPARE);

      expect(h.banner()).toBeUndefined();
    });

    it('leaves a relay failure alone when preparing succeeds', () => {
      const h = harness();
      h.reporter.report('extension.error.relayTabLost', 'a');

      h.reporter.recover(PREPARE);

      expect(h.banner()).toBe(en['extension.error.relayTabLost']);
    });

    it('logs nothing for a failure reported without a detail', () => {
      const h = harness();

      h.reporter.report('extension.error.preparePageFailed');

      expect(h.logged).toHaveLength(0);
      expect(h.published).toEqual([en['extension.error.preparePageFailed']]);
    });
  });
});
