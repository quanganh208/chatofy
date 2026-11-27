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
    /** Something else emptied the slot — a stop, a capture error, a new capture. */
    wipe: () => {
      banner = undefined;
      reporter.reset();
    },
  };
}

const LOST = 'extension.error.relayTabLost' as const;
const UNREACHABLE = 'extension.error.relayTabUnreachable' as const;

describe('RelayFailureReporter', () => {
  it('publishes the reader-language sentence and keeps the English for the console', () => {
    const h = harness(vi);

    h.reporter.relayFailed(LOST, 'the meeting tab is no longer being tracked');

    expect(h.published).toEqual([vi[LOST]]);
    expect(h.logged).toEqual(['the meeting tab is no longer being tracked']);
  });

  it('does not republish the failure already showing', () => {
    const h = harness();

    h.reporter.relayFailed(UNREACHABLE, 'a');
    h.reporter.relayFailed(UNREACHABLE, 'a');

    expect(h.published).toHaveLength(1);
    expect(h.logged).toHaveLength(1);
  });

  it('publishes again when the failure changes kind', () => {
    const h = harness(zh);

    h.reporter.relayFailed(LOST, 'a');
    h.reporter.relayFailed(UNREACHABLE, 'b');

    expect(h.published).toEqual([zh[LOST], zh[UNREACHABLE]]);
  });

  it('shows the same failure again once something else cleared the banner', () => {
    const h = harness();

    h.reporter.relayFailed(UNREACHABLE, 'a');
    h.wipe();
    h.reporter.relayFailed(UNREACHABLE, 'a');

    expect(h.published).toHaveLength(2);
  });

  it('does not re-derive a wiped failure on the next unrelated change', () => {
    const h = harness();
    h.reporter.relayFailed(UNREACHABLE, 'a');
    h.wipe();

    h.reporter.preparedPage(true);

    expect(h.banner()).toBeUndefined();
    expect(h.published).toHaveLength(1);
  });

  describe('relay recovery', () => {
    it('clears a relay failure once a later send gets through', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.reporter.relayDelivered(h.reporter.nextSend());

      expect(h.banner()).toBeUndefined();
    });

    it('publishes nothing while the derived text is unchanged', () => {
      // A healthy relay calls this on every frame.
      const h = harness();

      h.reporter.relayDelivered(h.reporter.nextSend());
      h.reporter.relayDelivered(h.reporter.nextSend());
      h.reporter.preparedPage(true);

      expect(h.published).toHaveLength(0);
      expect(h.clears()).toBe(0);
    });

    it('shows the same failure once more after a recovery, then dedupes again', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.reporter.relayDelivered(h.reporter.nextSend());

      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      expect(h.published).toHaveLength(2);
      expect(h.banner()).toBe(en[UNREACHABLE]);
    });

    it('does not let an older success clear a newer failure', () => {
      // Frame N's success settling after frame N+1's failure.
      const h = harness();
      const older = h.reporter.nextSend();
      const newer = h.reporter.nextSend();

      h.reporter.relayFailed(UNREACHABLE, 'a', newer);
      h.reporter.relayDelivered(older);

      expect(h.banner()).toBe(en[UNREACHABLE]);
      expect(h.clears()).toBe(0);
    });

    it('does not let an in-flight success clear a failure with no send behind it', () => {
      const h = harness();
      const inFlight = h.reporter.nextSend();

      h.reporter.relayFailed(LOST, 'a');
      h.reporter.relayDelivered(inFlight);

      expect(h.banner()).toBe(en[LOST]);
    });

    it('clears a relay failure when outbound is turned off', () => {
      // No frame is relayed with outbound off, so no delivery would ever clear it.
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.reporter.preparedPage(false);

      expect(h.banner()).toBeUndefined();
    });

    it('keeps a relay failure when preparing succeeds with outbound still on', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.reporter.preparedPage(true);

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });
  });

  describe('page preparation', () => {
    it('logs nothing itself; the caller logs its own error', () => {
      const h = harness();

      h.reporter.preparePageFailed();

      expect(h.logged).toHaveLength(0);
      expect(h.published).toEqual([en['extension.error.preparePageFailed']]);
    });

    it('clears when preparing succeeds', () => {
      const h = harness();
      h.reporter.preparePageFailed();

      h.reporter.preparedPage(true);

      expect(h.banner()).toBeUndefined();
    });

    it('takes precedence over a relay failure, without republishing', () => {
      const h = harness();
      h.reporter.preparePageFailed();

      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
      expect(h.published).toHaveLength(1);
    });

    it('is not erased by a relay success while it is still true', () => {
      const h = harness();
      h.reporter.preparePageFailed();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.reporter.relayDelivered(h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('comes back after a relay failure and its recovery, if still true', () => {
      // The relay failure arrives first and owns the slot; the prepare failure
      // then takes precedence, and the relay recovering leaves it showing.
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.reporter.preparePageFailed();

      h.reporter.relayDelivered(h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('hands the slot back to a relay failure that is still true', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.reporter.preparePageFailed();

      h.reporter.preparedPage(true);

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });
  });
});
