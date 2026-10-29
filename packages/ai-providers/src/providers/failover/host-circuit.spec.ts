import { describe, expect, it } from 'vitest';

import { ProviderConnectionError, ProviderResponseError } from '../../errors/provider-errors.js';
import { HostCircuit, isCredentialError, isUsageLimitError } from './host-circuit.js';

/** Recorded from Command Code on 2026-10-28 once the plan's window was spent. */
const USAGE_LIMIT_BODY =
  '{"error":{"message":"You\'ve reached your 5-hour usage limit for your plan. Your limit resets at ' +
  '2026-10-28T13:12:27.471Z. Please wait for the window to reset or upgrade your plan to continue.",' +
  '"type":"rate_limit_error","code":"RATE_LIMITED"}}';
/** Recorded the same day: one upstream model briefly out, the host otherwise fine. */
const UPSTREAM_BUSY_BODY =
  '{"error":{"message":"Upstream model provider is temporarily unavailable. Please try again in a moment.",' +
  '"type":"rate_limit_error"}}';

const answered = (status: number, body: string) =>
  new ProviderResponseError(`commandcode m answered ${status}: ${body}`, status);

describe('isUsageLimitError', () => {
  it('recognizes the spent-window 429', () => {
    expect(isUsageLimitError(answered(429, USAGE_LIMIT_BODY))).toBe(true);
  });

  it('does not mistake a transient upstream 429 for it', () => {
    expect(isUsageLimitError(answered(429, UPSTREAM_BUSY_BODY))).toBe(false);
  });

  it('needs the status as well as the words', () => {
    expect(isUsageLimitError(answered(500, USAGE_LIMIT_BODY))).toBe(false);
    expect(isUsageLimitError(new ProviderConnectionError('usage limit'))).toBe(false);
  });
});

describe('isCredentialError', () => {
  it('is 401 and 403 only', () => {
    expect(isCredentialError(answered(401, ''))).toBe(true);
    expect(isCredentialError(answered(403, 'MODEL_NOT_IN_PLAN'))).toBe(true);
    expect(isCredentialError(answered(400, ''))).toBe(false);
  });
});

describe('HostCircuit', () => {
  it('stays open for the cooldown, then closes and says so', () => {
    let now = 0;
    const transitions: string[] = [];
    const circuit = new HostCircuit({
      cooldownMs: 1000,
      now: () => now,
      onTransition: (state, reason) => transitions.push(`${state}:${reason}`),
    });

    expect(circuit.isOpen()).toBe(false);
    circuit.trip('usage limit');
    now = 999;
    expect(circuit.isOpen()).toBe(true);
    now = 1000;
    expect(circuit.isOpen()).toBe(false);
    expect(circuit.isOpen()).toBe(false);
    expect(transitions).toEqual(['open:usage limit', 'closed:cooldown elapsed']);
  });

  it('extends an open circuit without announcing it twice', () => {
    let now = 0;
    const transitions: string[] = [];
    const circuit = new HostCircuit({
      cooldownMs: 1000,
      now: () => now,
      onTransition: (state) => transitions.push(state),
    });
    circuit.trip('a');
    now = 500;
    circuit.trip('b');
    now = 1400;
    expect(circuit.isOpen()).toBe(true);
    expect(transitions).toEqual(['open']);
  });
});
