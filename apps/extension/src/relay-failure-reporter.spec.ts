import { describe, expect, it } from 'vitest';
import { en, vi, zh } from '@chatofy/i18n';
import { RelayFailureReporter } from './relay-failure-reporter';

/** A reporter over a one-slot banner, the way the overlay's relay error behaves. */
function harness(dictionary: Record<string, string> = en) {
  const published: string[] = [];
  const logged: string[] = [];
  let banner: string | undefined;
  let clears = 0;
  let capturing = true;
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
    capturing: () => capturing,
    translate: (key) => dictionary[key] as string,
    log: (detail) => logged.push(detail),
  });
  return {
    reporter,
    published,
    logged,
    banner: () => banner,
    clears: () => clears,
    /** A stop or a capture error: the publisher emptied the slot, the worker resets. */
    stop: () => {
      banner = undefined;
      capturing = false;
      reporter.resetRelay();
    },
    /** A new capture's first status. */
    start: () => {
      capturing = true;
      reporter.refresh();
    },
    /** Apply the outbound setting the way `refreshSettingsHint` does. */
    settle: (outbound: boolean, prepared: boolean) =>
      reporter.settingsSettled(reporter.beginSettingsRun(), outbound, prepared),
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
    h.stop();
    h.start();
    h.reporter.relayFailed(UNREACHABLE, 'a');

    expect(h.published).toHaveLength(2);
  });

  it('does not re-derive a wiped failure on the next unrelated change', () => {
    const h = harness();
    h.reporter.relayFailed(UNREACHABLE, 'a');
    h.stop();
    h.start();

    h.settle(true, true);

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
      h.settle(true, true);

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

      h.settle(false, true);

      expect(h.banner()).toBeUndefined();
    });

    it('keeps a relay failure when preparing succeeds with outbound still on', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.settle(true, true);

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });
  });

  describe('capture lifecycle', () => {
    it('shows nothing while no capture is running', () => {
      const h = harness();
      h.stop();

      h.reporter.relayFailed(UNREACHABLE, 'a');
      h.settle(true, false);

      expect(h.published).toHaveLength(0);
      expect(h.banner()).toBeUndefined();
    });

    it('keeps a prepare failure across a stop and shows it again in the next capture', () => {
      // The failure belongs to the outbound setting, not to the capture it was
      // first shown in.
      const h = harness();
      h.settle(true, false);
      h.stop();
      expect(h.banner()).toBeUndefined();

      h.start();

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('drops a relay failure with the capture it belonged to', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a');
      h.stop();

      h.start();

      expect(h.banner()).toBeUndefined();
    });

    it('publishes nothing on a status that changes nothing', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a');

      h.reporter.refresh();
      h.reporter.refresh();

      expect(h.published).toHaveLength(1);
      expect(h.clears()).toBe(0);
    });
  });

  describe('fencing off the previous capture', () => {
    it('drops a failure from a send made before the reset', () => {
      const h = harness();
      const oldSend = h.reporter.nextSend();
      h.stop();
      h.start();

      h.reporter.relayFailed(UNREACHABLE, 'a', oldSend);

      expect(h.banner()).toBeUndefined();
      expect(h.logged).toHaveLength(0);
    });

    it('drops a failure landing between a new capture reset and its first status', () => {
      // Covers the no-tab failure too: it has no send of its own, so its fresh
      // number cannot place it before the reset.
      const h = harness();
      h.stop();

      h.reporter.relayFailed(LOST, 'a');
      h.start();

      expect(h.banner()).toBeUndefined();
    });

    it('still reports a send made in the new capture', () => {
      const h = harness();
      h.reporter.nextSend();
      h.stop();
      h.start();

      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });
  });

  describe('settings runs', () => {
    it('records no prepare failure when removing the patch fails with outbound off', () => {
      const h = harness();

      h.settle(false, false);

      expect(h.banner()).toBeUndefined();
      expect(h.published).toHaveLength(0);
    });

    it('clears a prepare failure once outbound is off, even if removing the patch fails', () => {
      const h = harness();
      h.settle(true, false);

      h.settle(false, false);

      expect(h.banner()).toBeUndefined();
    });

    it('applies only the newest run when runs settle out of order', () => {
      const h = harness();
      const older = h.reporter.beginSettingsRun();
      const newer = h.reporter.beginSettingsRun();

      h.reporter.settingsSettled(newer, true, true);
      h.reporter.settingsSettled(older, true, false);

      expect(h.banner()).toBeUndefined();
      expect(h.published).toHaveLength(0);
    });

    it('drops a failure from a send that was in flight when outbound went off', () => {
      const h = harness();
      const inFlight = h.reporter.nextSend();
      h.settle(false, true);

      h.reporter.relayFailed(UNREACHABLE, 'a', inFlight);

      expect(h.banner()).toBeUndefined();
    });

    it('still reports a failure from a send made after outbound came back', () => {
      const h = harness();
      h.reporter.nextSend();
      h.settle(false, true);
      h.settle(true, true);

      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });

    it('clears both failures at once when outbound goes off and preparing succeeds', () => {
      // One publish, not a relay banner surfacing between the two clears.
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.settle(true, false);

      h.settle(false, true);

      expect(h.banner()).toBeUndefined();
      expect(h.published).toHaveLength(2);
      expect(h.clears()).toBe(1);
    });
  });

  describe('page preparation', () => {
    it('logs nothing itself; the caller logs its own error', () => {
      const h = harness();

      h.settle(true, false);

      expect(h.logged).toHaveLength(0);
      expect(h.published).toEqual([en['extension.error.preparePageFailed']]);
    });

    it('clears when preparing succeeds', () => {
      const h = harness();
      h.settle(true, false);

      h.settle(true, true);

      expect(h.banner()).toBeUndefined();
    });

    it('takes precedence over a relay failure, without republishing', () => {
      const h = harness();
      h.settle(true, false);

      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
      expect(h.published).toHaveLength(1);
    });

    it('is not erased by a relay success while it is still true', () => {
      const h = harness();
      h.settle(true, false);
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());

      h.reporter.relayDelivered(h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('comes back after a relay failure and its recovery, if still true', () => {
      // The relay failure arrives first and owns the slot; the prepare failure
      // then takes precedence, and the relay recovering leaves it showing.
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.settle(true, false);

      h.reporter.relayDelivered(h.reporter.nextSend());

      expect(h.banner()).toBe(en['extension.error.preparePageFailed']);
    });

    it('hands the slot back to a relay failure that is still true', () => {
      const h = harness();
      h.reporter.relayFailed(UNREACHABLE, 'a', h.reporter.nextSend());
      h.settle(true, false);

      h.settle(true, true);

      expect(h.banner()).toBe(en[UNREACHABLE]);
    });
  });
});
